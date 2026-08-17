// Docs-as-Code bundle validation, cross-artifact consistency, and freeze.
//
// Execution contract: inventory → evidence → canonical model → artifacts →
// validation → targeted correction → cross-artifact consistency → freeze →
// manifest. This module owns everything from "validation" onward. No artifact
// is accepted because it was generated; it is accepted because it parsed, its
// evidence resolved, and it did not contradict the canonical model.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { reverseDiagnostic, summarize } from './diagnostics.mjs';
import { openRepository, validateEvidenceIndex, validateSystemModel } from './model.mjs';
import { validateMermaid } from './mermaid.mjs';
import { validateOpenApi } from './openapi.mjs';

const EVIDENCE_INDEX = 'architecture/evidence.json';
const SYSTEM_MODEL = 'architecture/system-model.json';
const MANIFEST = 'architecture/manifest.json';
const OPENAPI = 'api/openapi.yaml';

const RECOMMENDED = [
  'architecture/architecture.md',
  'architecture/repository-inventory.md',
  'architecture/traceability.md',
  'architecture/coverage.md',
];

const SECRET_PATTERNS = [
  { code: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: 'private-key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { code: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { code: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { code: 'credential-in-url', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i },
  {
    code: 'assigned-secret',
    // A credential name may be prefixed (DATABASE_PASSWORD, NPM_TOKEN, apiKey),
    // so the leading word boundary is written explicitly instead of relying on
    // \b. The value must look like a credential rather than prose: at least
    // eight unbroken characters carrying both a digit and a letter. Redacted,
    // empty, and environment-reference values are documentation, not leaks.
    pattern: /(?:^|[^A-Za-z0-9_])[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|credential|passphrase|api[_-]?key)\s*[:=]\s*(?!["']?(?:<|\$|\{|\*|redacted|null|""|''|env:|process\.env))["']?(?=[^\s"'`<>,;)]*\d)(?=[^\s"'`<>,;)]*[A-Za-z])[^\s"'`<>,;)]{8,}/i,
  },
];

const HTTP_MESSAGE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)/;
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function diagnostic(code, contractCode, message, options = {}) {
  return reverseDiagnostic({ code: `reverse/${code}`, contractCode, message, ...options });
}

function walk(root, prefix = '') {
  const entries = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...walk(root, relative));
    else if (entry.isFile()) entries.push(relative);
  }
  return entries.sort();
}

function readJson(absolutePath) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(source);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function artifactType(relativePath, mermaidHeader) {
  if (relativePath === EVIDENCE_INDEX) return 'evidence-index';
  if (relativePath === SYSTEM_MODEL) return 'system-model';
  if (relativePath === OPENAPI) return 'openapi';
  if (relativePath.endsWith('.mmd')) return mermaidHeader?.artifact || 'mermaid';
  if (relativePath.startsWith('architecture/adr/')) return 'adr';
  if (relativePath === 'architecture/architecture.md') return 'arc42';
  if (relativePath === 'architecture/traceability.md') return 'traceability';
  if (relativePath === 'architecture/coverage.md') return 'coverage';
  if (relativePath === 'architecture/repository-inventory.md') return 'repository-inventory';
  if (relativePath === 'architecture/domain.md') return 'domain';
  if (relativePath.endsWith('.md')) return 'markdown';
  return 'other';
}

function pathMatcher(template) {
  const escaped = template
    .split('/')
    .map((segment) => (/^\{[^}]+\}$/.test(segment)
      ? '[^/]+'
      : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

function scanSecrets(relativePath, source, diagnostics) {
  const lines = source.split(/\r\n|\n|\r/);
  for (const [index, line] of lines.entries()) {
    for (const { code, pattern } of SECRET_PATTERNS) {
      if (!pattern.test(line)) continue;
      diagnostics.push(diagnostic('secret-value', 'SECRET_LEAKED',
        `Possible ${code.replaceAll('-', ' ')} value in a generated artifact.`, {
          artifact: relativePath,
          subject: { line: index + 1 },
          // The matched value is deliberately not copied into the receipt.
          evidence: { pattern: code },
          supportedFixes: ['replace the value with <redacted> and describe only the architectural purpose of the secret'],
        }));
      break;
    }
  }
}

function checkMarkdownLinks(docsRoot, relativePath, source, diagnostics) {
  MARKDOWN_LINK.lastIndex = 0;
  for (const match of source.matchAll(MARKDOWN_LINK)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    const [filePart] = target.split('#');
    if (!filePart) continue;
    const resolved = path.resolve(path.dirname(path.join(docsRoot, relativePath)), decodeURIComponent(filePart));
    if (!fs.existsSync(resolved)) {
      diagnostics.push(diagnostic('link-broken', 'LINK_BROKEN', `Internal link "${target}" does not resolve.`, {
        artifact: relativePath,
        subject: { target },
        supportedFixes: ['point the link at an existing file, or remove it'],
      }));
    }
  }
}

export function validateBundle({ docsRoot, repoRoot, strict = false, checkFrozen = true } = {}) {
  const resolvedDocs = path.resolve(docsRoot);
  const diagnostics = [];
  const artifacts = [];

  if (!fs.existsSync(resolvedDocs) || !fs.statSync(resolvedDocs).isDirectory()) {
    diagnostics.push(diagnostic('docs-root-missing', 'ARTIFACT_MISSING',
      `Documentation root "${resolvedDocs}" is not a directory.`, {
        supportedFixes: ['generate the docs-as-code bundle before validating it'],
      }));
    return receipt({ resolvedDocs, repository: null, artifacts, diagnostics, model: null, evidence: null });
  }

  const opened = openRepository(repoRoot || resolvedDocs);
  if (!opened.ok) {
    diagnostics.push(diagnostic('repository-unavailable', 'EVIDENCE_UNVERIFIABLE',
      `Evidence cannot be verified: ${opened.reason}.`, {
        supportedFixes: ['run the command with --repo-root pointing at the analyzed Git checkout'],
      }));
  }
  const repository = opened.ok ? opened.repository : null;

  // The bundle owns `architecture/` and `api/` only. A documentation root may
  // also carry an unrelated site (landing pages, generated galleries, images);
  // hashing those into the manifest would make an accepted bundle drift for
  // reasons that have nothing to do with the architecture it describes.
  const files = walk(resolvedDocs).filter((relativePath) => (
    relativePath.startsWith('architecture/') || relativePath.startsWith('api/')
  ));
  const fileSet = new Set(files);

  for (const required of [EVIDENCE_INDEX, SYSTEM_MODEL]) {
    if (!fileSet.has(required)) {
      diagnostics.push(diagnostic('artifact-missing', 'ARTIFACT_MISSING', `Required artifact ${required} is missing.`, {
        artifact: required,
        supportedFixes: ['generate the evidence index and the canonical system model before any narrative artifact'],
      }));
    }
  }
  for (const recommended of RECOMMENDED) {
    if (!fileSet.has(recommended)) {
      diagnostics.push(diagnostic('artifact-missing', 'ARTIFACT_MISSING', `Contract artifact ${recommended} is missing.`, {
        severity: strict ? 'error' : 'warning',
        artifact: recommended,
        supportedFixes: ['generate the artifact, or record explicitly why it does not apply to this repository'],
      }));
    }
  }

  let evidence = null;
  let model = null;

  if (fileSet.has(EVIDENCE_INDEX)) {
    try {
      const index = readJson(path.join(resolvedDocs, EVIDENCE_INDEX));
      evidence = validateEvidenceIndex(index, { repository, artifact: EVIDENCE_INDEX });
      diagnostics.push(...evidence.diagnostics);
    } catch (error) {
      diagnostics.push(diagnostic('evidence-parse', 'SYNTAX_INVALID', `Evidence index could not be read: ${error.message}`, {
        artifact: EVIDENCE_INDEX,
        supportedFixes: ['repair the JSON syntax and validate again'],
      }));
    }
  }

  if (fileSet.has(SYSTEM_MODEL)) {
    try {
      const canonical = readJson(path.join(resolvedDocs, SYSTEM_MODEL));
      model = validateSystemModel(canonical, { evidence: evidence?.entries, artifact: SYSTEM_MODEL });
      diagnostics.push(...model.diagnostics);
    } catch (error) {
      diagnostics.push(diagnostic('model-parse', 'SYNTAX_INVALID', `System model could not be read: ${error.message}`, {
        artifact: SYSTEM_MODEL,
        supportedFixes: ['repair the JSON syntax and validate again'],
      }));
    }
  }

  const modelIds = new Set([
    ...(model ? model.elements.keys() : []),
    ...(model ? model.relationships.keys() : []),
  ]);

  const sequences = [];
  let openapi = null;

  for (const relativePath of files) {
    const absolutePath = path.join(resolvedDocs, relativePath);
    const buffer = fs.readFileSync(absolutePath);
    const isText = !buffer.includes(0);
    const source = isText ? buffer.toString('utf8') : '';
    let header = null;
    let validation = 'passed';

    if (isText) scanSecrets(relativePath, source, diagnostics);
    if (isText && relativePath.endsWith('.md')) checkMarkdownLinks(resolvedDocs, relativePath, source, diagnostics);

    if (relativePath.endsWith('.mmd')) {
      const result = validateMermaid(source, { artifact: relativePath });
      diagnostics.push(...result.diagnostics);
      header = result.header;
      if (!result.ok) validation = 'failed';
      if (result.kind === 'sequence') sequences.push({ artifact: relativePath, edges: result.edges });
      checkDiagramTraceability({ relativePath, result, model, modelIds, diagnostics });
    } else if (relativePath === OPENAPI) {
      openapi = validateOpenApi(source, { artifact: relativePath });
      diagnostics.push(...openapi.diagnostics);
      if (!openapi.ok) validation = 'failed';
    } else if (relativePath.endsWith('.json') && relativePath !== MANIFEST) {
      try {
        JSON.parse(source);
      } catch (error) {
        diagnostics.push(diagnostic('json-parse', 'SYNTAX_INVALID', `JSON artifact could not be parsed: ${error.message}`, {
          artifact: relativePath,
          supportedFixes: ['repair the JSON syntax and validate again'],
        }));
        validation = 'failed';
      }
    }

    if (relativePath === 'architecture/traceability.md') {
      checkTraceabilityMatrix({ relativePath, source, evidence, modelIds, repository, diagnostics });
    }

    if (relativePath !== MANIFEST) {
      artifacts.push({
        path: relativePath,
        type: artifactType(relativePath, header),
        validation,
        sha256: sha256(buffer),
        bytes: buffer.byteLength,
      });
    }
  }

  if (openapi) checkEndpointConsistency({ openapi, sequences, diagnostics });
  if (fileSet.has(MANIFEST) && checkFrozen) checkManifest({ resolvedDocs, artifacts, evidence, diagnostics });

  return receipt({ resolvedDocs, repository, artifacts, diagnostics, model, evidence });
}

function checkDiagramTraceability({ relativePath, result, model, modelIds, diagnostics }) {
  const declared = [...(result.header.elements || []), ...(result.header.relationships || [])];
  if (!result.header.artifact || !declared.length) {
    diagnostics.push(diagnostic('traceability-missing', 'TRACEABILITY_MISSING',
      'Diagram does not declare which canonical model ids it renders.', {
        artifact: relativePath,
        supportedFixes: [
          'add "%% archify:artifact <kind>" and "%% archify:elements <id>, <id>" headers',
          'add "%% archify:relationships <id>" for every rendered relationship',
        ],
      }));
    return;
  }
  if (!model) return;
  for (const id of result.header.elements || []) {
    if (!model.elements.has(id)) {
      diagnostics.push(diagnostic('traceability-unknown-element', 'TRACEABILITY_MISSING',
        `Diagram declares element "${id}", which is not in the canonical system model.`, {
          artifact: relativePath,
          subject: { elementId: id },
          supportedFixes: ['declare the element in system-model.json with its evidence, or remove it from the diagram'],
        }));
    }
  }
  for (const id of result.header.relationships || []) {
    const relationship = model.relationships.get(id);
    if (!relationship) {
      diagnostics.push(diagnostic('traceability-unknown-relationship', 'TRACEABILITY_MISSING',
        `Diagram declares relationship "${id}", which is not in the canonical system model.`, {
          artifact: relativePath,
          subject: { relationshipId: id },
          supportedFixes: ['declare the relationship with independent evidence, or remove it from the diagram'],
        }));
      continue;
    }
    for (const endpoint of [relationship.source, relationship.target]) {
      if (!(result.header.elements || []).includes(endpoint) && modelIds.has(endpoint)) {
        diagnostics.push(diagnostic('traceability-endpoint-undeclared', 'TRACEABILITY_MISSING',
          `Diagram renders relationship "${id}" without declaring its endpoint "${endpoint}".`, {
            artifact: relativePath,
            subject: { relationshipId: id, elementId: endpoint },
            supportedFixes: [`add "${endpoint}" to the %% archify:elements header`],
          }));
      }
    }
  }
}

function checkTraceabilityMatrix({ relativePath, source, evidence, modelIds, repository, diagnostics }) {
  const evidenceIds = new Set((source.match(/\bev-[a-z0-9][a-z0-9._-]*/g) || []));
  for (const id of evidenceIds) {
    if (evidence && !evidence.entries.has(id)) {
      diagnostics.push(diagnostic('traceability-evidence-unknown', 'TRACEABILITY_MISSING',
        `Traceability matrix cites evidence "${id}", which is not in the evidence index.`, {
          artifact: relativePath,
          subject: { evidenceId: id },
          supportedFixes: ['add the evidence entry, or cite an existing evidence id'],
        }));
    }
  }
  const referencedPaths = [...source.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter((value) => value.includes('/') && /\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/.test(value));
  for (const reference of new Set(referencedPaths)) {
    if (!repository || !evidence?.revision || !evidence.verified) continue;
    const filePart = reference.split(':')[0];
    if (repository.blob(evidence.revision, filePart) === null) {
      diagnostics.push(diagnostic('traceability-evidence-missing', 'EVIDENCE_MISSING',
        `Traceability matrix cites \`${filePart}\`, which is not a file at revision ${evidence.revision}.`, {
          artifact: relativePath,
          subject: { file: filePart },
          supportedFixes: ['cite a file that exists at the pinned revision'],
        }));
    }
  }
  const rows = source.split(/\r\n|\n|\r/).filter((line) => line.trim().startsWith('|') && line.includes('|'));
  if (rows.length < 2) {
    diagnostics.push(diagnostic('traceability-empty', 'TRACEABILITY_MISSING',
      'Traceability matrix contains no artifact rows.', {
        artifact: relativePath,
        supportedFixes: ['record one row per artifact element with its evidence and confidence'],
      }));
  }
  for (const id of evidenceIds) {
    if (!evidence) break;
    const entry = evidence.entries.get(id);
    if (entry && !entry.supports.some((supported) => modelIds.has(supported))) {
      diagnostics.push(diagnostic('traceability-orphan-row', 'EVIDENCE_ORPHAN',
        `Traceability matrix cites evidence "${id}", which supports no canonical model id.`, {
          severity: 'warning',
          artifact: relativePath,
          subject: { evidenceId: id },
          supportedFixes: ['link the evidence to a model element or relationship'],
        }));
    }
  }
}

function checkEndpointConsistency({ openapi, sequences, diagnostics }) {
  const operations = openapi.operations.map((operation) => ({
    ...operation,
    matcher: pathMatcher(operation.path),
  }));
  for (const sequence of sequences) {
    for (const edge of sequence.edges) {
      const match = String(edge.label || '').match(HTTP_MESSAGE);
      if (!match) continue;
      const [, method, routePath] = match;
      const route = routePath.replace(/[?#].*$/, '');
      const supported = operations.some((operation) => (
        operation.method === method && (operation.path === route || operation.matcher.test(route))
      ));
      if (!supported) {
        diagnostics.push(diagnostic('consistency-endpoint', 'CONSISTENCY_CONTRADICTION',
          `Sequence message "${method} ${route}" has no matching operation in the OpenAPI document.`, {
            artifact: sequence.artifact,
            subject: { line: edge.line, method, path: route },
            evidence: { operations: operations.map((operation) => `${operation.method} ${operation.path}`) },
            supportedFixes: [
              'correct the message so it matches the observed route',
              'add the observed operation to docs/api/openapi.yaml',
            ],
          }));
      }
    }
  }
}

function checkManifest({ resolvedDocs, artifacts, evidence, diagnostics }) {
  let manifest;
  try {
    manifest = readJson(path.join(resolvedDocs, MANIFEST));
  } catch (error) {
    diagnostics.push(diagnostic('manifest-parse', 'SYNTAX_INVALID', `Manifest could not be read: ${error.message}`, {
      artifact: MANIFEST,
      supportedFixes: ['regenerate the manifest with `archify reverse freeze`'],
    }));
    return;
  }
  const listed = new Map((Array.isArray(manifest.artifacts) ? manifest.artifacts : [])
    .filter((entry) => entry && typeof entry.path === 'string')
    .map((entry) => [entry.path, entry]));
  const generated = new Map(artifacts.map((entry) => [entry.path, entry]));

  if (evidence?.revision && manifest.revision && manifest.revision.toLowerCase() !== evidence.revision) {
    diagnostics.push(diagnostic('manifest-revision', 'FROZEN_ARTIFACT_MODIFIED',
      `Manifest pins revision ${manifest.revision}, but the evidence index pins ${evidence.revision}.`, {
        artifact: MANIFEST,
        supportedFixes: ['re-run the pipeline against one revision, then freeze again'],
      }));
  }
  for (const [artifactPath, entry] of listed) {
    const current = generated.get(artifactPath);
    if (!current) {
      diagnostics.push(diagnostic('manifest-artifact-missing', 'FROZEN_ARTIFACT_MODIFIED',
        `Manifest lists ${artifactPath}, which is no longer part of the bundle.`, {
          artifact: MANIFEST,
          subject: { path: artifactPath },
          supportedFixes: ['restore the artifact, or freeze the bundle again'],
        }));
      continue;
    }
    if (entry.sha256 && entry.sha256 !== current.sha256) {
      diagnostics.push(diagnostic('manifest-artifact-modified', 'FROZEN_ARTIFACT_MODIFIED',
        `${artifactPath} changed after it was frozen.`, {
          artifact: MANIFEST,
          subject: { path: artifactPath },
          evidence: { frozen: entry.sha256, current: current.sha256 },
          supportedFixes: ['re-run validation and freeze the bundle again'],
        }));
    }
  }
  for (const artifactPath of generated.keys()) {
    if (!listed.has(artifactPath)) {
      diagnostics.push(diagnostic('manifest-artifact-unlisted', 'MANIFEST_INCOMPLETE',
        `${artifactPath} is not listed in the delivery manifest.`, {
          severity: 'warning',
          artifact: MANIFEST,
          subject: { path: artifactPath },
          supportedFixes: ['freeze the bundle again so the manifest lists every delivered artifact'],
        }));
    }
  }
}

function receipt({ resolvedDocs, repository, artifacts, diagnostics, model, evidence }) {
  const summary = summarize(diagnostics);
  const statuses = { observed: 0, inferred: 0, unknown: 0 };
  const unknowns = [];
  if (model) {
    for (const entry of [...model.elements.values(), ...model.relationships.values()]) {
      if (entry.status in statuses) statuses[entry.status] += 1;
      if (entry.status === 'unknown') {
        unknowns.push({ id: entry.id, name: entry.name || `${entry.source} → ${entry.target}` });
      }
    }
  }
  return {
    schemaVersion: 1,
    ok: summary.errors === 0,
    command: 'reverse validate',
    docs: resolvedDocs,
    repository: repository
      ? { root: repository.root, url: evidence?.repositoryUrl || repository.originUrl(), revision: evidence?.revision || null }
      : null,
    evidenceVerified: Boolean(evidence?.verified),
    coverage: {
      artifacts: artifacts.length,
      elements: model ? model.elements.size : 0,
      relationships: model ? model.relationships.size : 0,
      evidence: evidence ? evidence.entries.size : 0,
      ...statuses,
    },
    unknowns,
    artifacts,
    summary,
    diagnostics,
  };
}

export function freezeBundle({ docsRoot, repoRoot, generatedAt } = {}) {
  const validation = validateBundle({ docsRoot, repoRoot, strict: true, checkFrozen: false });
  if (!validation.ok) {
    return { ...validation, command: 'reverse freeze', frozen: false };
  }
  const resolvedDocs = path.resolve(docsRoot);
  const manifest = {
    schema_version: 1,
    generatedAt: generatedAt || new Date().toISOString(),
    repository: validation.repository?.url || null,
    revision: validation.repository?.revision || null,
    artifacts: validation.artifacts.map((entry) => ({
      path: entry.path,
      type: entry.type,
      validation: entry.validation,
      sha256: entry.sha256,
      bytes: entry.bytes,
    })),
    warnings: validation.diagnostics
      .filter((entry) => entry.severity === 'warning')
      .map((entry) => ({ code: entry.code, contractCode: entry.contractCode, artifact: entry.artifact || null, message: entry.message })),
    unknowns: validation.unknowns,
  };
  const manifestPath = path.join(resolvedDocs, MANIFEST);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    ...validation,
    command: 'reverse freeze',
    frozen: true,
    manifest: manifestPath,
    manifestSha256: sha256(fs.readFileSync(manifestPath)),
  };
}
