// OpenAPI validation for the reverse-engineering pipeline.
//
// The contract requires an extracted `docs/api/openapi.yaml` to be a valid
// OpenAPI document before delivery, and forbids inventing descriptions, status
// codes, formats, or examples the code does not evidence. This validator checks
// the structure the standard requires and returns the observed operation list
// so the bundle can cross-check it against sequence diagrams.

import { parseYaml, YamlError } from './yaml.mjs';
import { reverseDiagnostic } from './diagnostics.mjs';

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const PARAMETER_LOCATIONS = new Set(['path', 'query', 'header', 'cookie']);
const STATUS_CODE = /^(?:default|[1-5](?:\d\d|XX))$/;

function diagnostic(artifact, code, contractCode, message, options = {}) {
  return reverseDiagnostic({ code: `reverse/${code}`, contractCode, message, artifact, ...options });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolvePointer(document, pointer) {
  if (!pointer.startsWith('#/')) return undefined;
  let node = document;
  for (const rawSegment of pointer.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(node) && !Array.isArray(node)) return undefined;
    node = Array.isArray(node) ? node[Number(segment)] : node[segment];
    if (node === undefined) return undefined;
  }
  return node;
}

function collectRefs(node, path, found) {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => collectRefs(entry, `${path}/${index}`, found));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') found.push({ pointer: value, path: `${path}/$ref` });
    else collectRefs(value, `${path}/${key}`, found);
  }
}

function templatedParameters(pathKey) {
  return [...pathKey.matchAll(/\{([^}]*)\}/g)].map((match) => match[1]);
}

function parameterNames(document, parameters, location) {
  const names = [];
  for (const parameter of parameters) {
    const resolved = isPlainObject(parameter) && typeof parameter.$ref === 'string'
      ? resolvePointer(document, parameter.$ref)
      : parameter;
    if (!isPlainObject(resolved)) continue;
    if (resolved.in === location) names.push(resolved.name);
  }
  return names;
}

export function validateOpenApi(source, { artifact = 'openapi.yaml' } = {}) {
  const diagnostics = [];
  let document;
  try {
    document = parseYaml(source);
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    diagnostics.push(diagnostic(artifact, 'yaml-parse', 'SYNTAX_INVALID', `YAML could not be parsed: ${error.message}`, {
      subject: { line: error.line },
      supportedFixes: ['repair the YAML syntax, then validate the document again'],
    }));
    return { ok: false, document: null, operations: [], diagnostics };
  }

  if (!isPlainObject(document)) {
    diagnostics.push(diagnostic(artifact, 'openapi-root', 'SYNTAX_INVALID', 'OpenAPI document root must be a mapping.', {
      supportedFixes: ['write the document as a YAML mapping with openapi, info, and paths'],
    }));
    return { ok: false, document: null, operations: [], diagnostics };
  }

  if (typeof document.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(document.openapi)) {
    diagnostics.push(diagnostic(artifact, 'openapi-version', 'SPEC_INVALID',
      'Document must declare an OpenAPI 3.0.x or 3.1.x version.', {
        subject: { path: '/openapi' },
        evidence: { version: document.openapi ?? null },
        supportedFixes: ['set openapi to a supported 3.0.x or 3.1.x version'],
      }));
  }
  if (!isPlainObject(document.info) || typeof document.info.title !== 'string' || !document.info.title
    || (typeof document.info.version !== 'string' && typeof document.info.version !== 'number')) {
    diagnostics.push(diagnostic(artifact, 'openapi-info', 'SPEC_INVALID',
      'info requires a non-empty title and a version.', {
        subject: { path: '/info' },
        supportedFixes: ['add info.title and info.version derived from repository evidence'],
      }));
  }

  const operations = [];
  if (!isPlainObject(document.paths)) {
    diagnostics.push(diagnostic(artifact, 'openapi-paths', 'SPEC_INVALID', 'paths must be a mapping of route templates.', {
      subject: { path: '/paths' },
      supportedFixes: ['add one paths entry per observed route'],
    }));
  } else {
    for (const [pathKey, pathItem] of Object.entries(document.paths)) {
      if (!pathKey.startsWith('/')) {
        diagnostics.push(diagnostic(artifact, 'openapi-path-key', 'SPEC_INVALID',
          `Path "${pathKey}" must start with "/".`, {
            subject: { path: `/paths/${pathKey}` },
            supportedFixes: ['write the observed route as an absolute path template'],
          }));
        continue;
      }
      if (!isPlainObject(pathItem)) {
        diagnostics.push(diagnostic(artifact, 'openapi-path-item', 'SPEC_INVALID',
          `Path item "${pathKey}" must be a mapping.`, { subject: { path: `/paths/${pathKey}` } }));
        continue;
      }
      const templated = templatedParameters(pathKey);
      if (templated.some((name) => !name)) {
        diagnostics.push(diagnostic(artifact, 'openapi-path-template', 'SPEC_INVALID',
          `Path "${pathKey}" contains an empty template parameter.`, {
            subject: { path: `/paths/${pathKey}` },
            supportedFixes: ['name every path template parameter'],
          }));
      }
      const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === 'parameters' || method === 'summary' || method === 'description' || method === 'servers' || method === '$ref') continue;
        if (!METHODS.has(method)) {
          diagnostics.push(diagnostic(artifact, 'openapi-method', 'SPEC_INVALID',
            `"${method}" is not an HTTP method supported by OpenAPI.`, {
              subject: { path: `/paths/${pathKey}/${method}` },
              evidence: { supported: [...METHODS] },
              supportedFixes: ['use one observed HTTP method'],
            }));
          continue;
        }
        if (!isPlainObject(operation)) {
          diagnostics.push(diagnostic(artifact, 'openapi-operation', 'SPEC_INVALID',
            `Operation ${method.toUpperCase()} ${pathKey} must be a mapping.`, {
              subject: { path: `/paths/${pathKey}/${method}` },
            }));
          continue;
        }
        operations.push({
          method: method.toUpperCase(),
          path: pathKey,
          operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
        });
        if (!isPlainObject(operation.responses) || Object.keys(operation.responses).length === 0) {
          diagnostics.push(diagnostic(artifact, 'openapi-responses', 'SPEC_INVALID',
            `Operation ${method.toUpperCase()} ${pathKey} requires at least one response.`, {
              subject: { path: `/paths/${pathKey}/${method}/responses` },
              supportedFixes: ['declare only the status codes the code evidences'],
            }));
        } else {
          for (const status of Object.keys(operation.responses)) {
            if (!STATUS_CODE.test(String(status))) {
              diagnostics.push(diagnostic(artifact, 'openapi-status-code', 'SPEC_INVALID',
                `"${status}" is not a valid response key for ${method.toUpperCase()} ${pathKey}.`, {
                  subject: { path: `/paths/${pathKey}/${method}/responses/${status}` },
                  supportedFixes: ['use a three-digit status code, a 1XX-5XX range, or default'],
                }));
            }
          }
        }
        const parameters = [...sharedParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
        for (const parameter of parameters) {
          const resolved = isPlainObject(parameter) && typeof parameter.$ref === 'string'
            ? resolvePointer(document, parameter.$ref)
            : parameter;
          if (!isPlainObject(resolved)) continue;
          if (typeof resolved.name !== 'string' || !PARAMETER_LOCATIONS.has(resolved.in)) {
            diagnostics.push(diagnostic(artifact, 'openapi-parameter', 'SPEC_INVALID',
              `A parameter of ${method.toUpperCase()} ${pathKey} requires name and a valid in.`, {
                subject: { path: `/paths/${pathKey}/${method}/parameters` },
                evidence: { locations: [...PARAMETER_LOCATIONS] },
                supportedFixes: ['declare name and in for every observed parameter'],
              }));
            continue;
          }
          if (resolved.in === 'path' && resolved.required !== true) {
            diagnostics.push(diagnostic(artifact, 'openapi-path-parameter-required', 'SPEC_INVALID',
              `Path parameter "${resolved.name}" of ${method.toUpperCase()} ${pathKey} must set required: true.`, {
                subject: { path: `/paths/${pathKey}/${method}/parameters` },
                supportedFixes: ['set required: true on every path parameter'],
              }));
          }
        }
        const declared = new Set(parameterNames(document, parameters, 'path'));
        for (const name of templated) {
          if (name && !declared.has(name)) {
            diagnostics.push(diagnostic(artifact, 'openapi-path-parameter-missing', 'SPEC_INVALID',
              `Path template "{${name}}" of ${method.toUpperCase()} ${pathKey} has no matching path parameter.`, {
                subject: { path: `/paths/${pathKey}/${method}/parameters` },
                supportedFixes: [`declare the path parameter "${name}"`],
              }));
          }
        }
      }
    }
  }

  const refs = [];
  collectRefs(document, '', refs);
  for (const { pointer, path } of refs) {
    if (!pointer.startsWith('#')) {
      diagnostics.push(diagnostic(artifact, 'openapi-ref-external', 'SPEC_INVALID',
        `External $ref "${pointer}" cannot be verified inside a single delivered document.`, {
          subject: { path },
          supportedFixes: ['inline the referenced schema under components'],
        }));
      continue;
    }
    if (resolvePointer(document, pointer) === undefined) {
      diagnostics.push(diagnostic(artifact, 'openapi-ref-unresolved', 'TRACEABILITY_MISSING',
        `$ref "${pointer}" does not resolve inside the document.`, {
          subject: { path },
          supportedFixes: ['add the referenced component or correct the pointer'],
        }));
    }
  }

  const schemes = isPlainObject(document.components?.securitySchemes) ? document.components.securitySchemes : {};
  const securityRequirements = [
    ...(Array.isArray(document.security) ? document.security : []),
    ...operations.flatMap(({ method, path: pathKey }) => {
      const operation = document.paths?.[pathKey]?.[method.toLowerCase()];
      return Array.isArray(operation?.security) ? operation.security : [];
    }),
  ];
  for (const requirement of securityRequirements) {
    if (!isPlainObject(requirement)) continue;
    for (const name of Object.keys(requirement)) {
      if (!(name in schemes)) {
        diagnostics.push(diagnostic(artifact, 'openapi-security-scheme', 'TRACEABILITY_MISSING',
          `Security requirement "${name}" has no matching components.securitySchemes entry.`, {
            subject: { path: '/security' },
            supportedFixes: ['declare the observed security scheme under components.securitySchemes'],
          }));
      }
    }
  }

  return {
    ok: diagnostics.every((entry) => entry.severity !== 'error'),
    document,
    operations,
    diagnostics,
  };
}
