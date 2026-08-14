// Evidence index and canonical system model validation.
//
// Evidence First: every architectural claim in a generated artifact resolves to
// an evidence entry, and every evidence entry resolves to a file that exists at
// the pinned revision. Observed, inferred, and unknown stay distinct: this
// module refuses to let an unverifiable claim be recorded as observed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reverseDiagnostic } from './diagnostics.mjs';

const REVISION = /^[a-f0-9]{40}$/i;
const EVIDENCE_ID = /^ev-[a-z0-9][a-z0-9._-]*$/;
const ELEMENT_ID = /^[a-z0-9][a-z0-9._-]*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export const ELEMENT_KINDS = new Set([
  'system',
  'actor',
  'container',
  'component',
  'datastore',
  'external',
  'endpoint',
  'message',
  'queue',
  'topic',
  'flow',
  'entity',
  'boundary',
  'deployment',
]);

export const STATUSES = new Set(['observed', 'inferred', 'unknown']);

function diagnostic(artifact, code, contractCode, message, options = {}) {
  return reverseDiagnostic({ code: `reverse/${code}`, contractCode, message, artifact, ...options });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class Repository {
  constructor(root) {
    this.root = root;
  }

  run(args) {
    return spawnSync('git', ['-C', this.root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  }

  hasCommit(revision) {
    return this.run(['cat-file', '-e', `${revision}^{commit}`]).status === 0;
  }

  head() {
    const result = this.run(['rev-parse', 'HEAD']);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  originUrl() {
    const result = this.run(['remote', 'get-url', 'origin']);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  blob(revision, filePath) {
    const type = this.run(['cat-file', '-t', `${revision}:${filePath}`]);
    if (type.status !== 0 || type.stdout.trim() !== 'blob') return null;
    const content = this.run(['show', `${revision}:${filePath}`]);
    return content.status === 0 ? content.stdout : null;
  }
}

export function openRepository(repoRootInput) {
  const requested = path.resolve(repoRootInput || process.cwd());
  if (!fs.existsSync(requested)) return { ok: false, reason: `"${requested}" does not exist` };
  const top = spawnSync('git', ['-C', requested, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.error) return { ok: false, reason: `Git is unavailable: ${top.error.message}` };
  if (top.status !== 0) return { ok: false, reason: `"${requested}" is not inside a Git repository` };
  return { ok: true, repository: new Repository(fs.realpathSync(top.stdout.trim())) };
}

export function repositoryRelativePath(value) {
  const filePath = String(value || '');
  if (!filePath || filePath.startsWith('/') || filePath.includes('\\') || CONTROL_CHARACTER.test(filePath)) return null;
  const segments = filePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  if (segments[0] === '.git') return null;
  return segments.join('/');
}

function lineCount(content) {
  if (!content.length) return 0;
  return content.split(/\r\n|\n|\r/).length - (/(?:\r\n|\n|\r)$/.test(content) ? 1 : 0);
}

function sliceLines(content, from, to) {
  return content.split(/\r\n|\n|\r/).slice(from - 1, to).join('\n');
}

export function validateEvidenceIndex(index, { repository, artifact = 'evidence.json' } = {}) {
  const diagnostics = [];
  const entries = new Map();

  if (!isPlainObject(index)) {
    diagnostics.push(diagnostic(artifact, 'evidence-root', 'SYNTAX_INVALID', 'Evidence index root must be an object.', {
      supportedFixes: ['write evidence.json as an object with schema_version, repository, and evidence'],
    }));
    return { ok: false, entries, revision: null, diagnostics };
  }
  if (index.schema_version !== 1) {
    diagnostics.push(diagnostic(artifact, 'evidence-schema-version', 'SYNTAX_INVALID',
      'Evidence index requires "schema_version": 1.', {
        subject: { path: '/schema_version' },
        supportedFixes: ['set schema_version to 1'],
      }));
  }

  const repositoryMeta = isPlainObject(index.repository) ? index.repository : null;
  const revision = typeof repositoryMeta?.revision === 'string' ? repositoryMeta.revision.toLowerCase() : null;
  if (!revision || !REVISION.test(revision)) {
    diagnostics.push(diagnostic(artifact, 'evidence-revision', 'EVIDENCE_UNPINNED',
      'Evidence index must pin one full 40-character commit SHA.', {
        subject: { path: '/repository/revision' },
        evidence: { revision: repositoryMeta?.revision ?? null },
        supportedFixes: ['record the analyzed revision from `git rev-parse HEAD`'],
      }));
  } else if (repository && !repository.hasCommit(revision)) {
    diagnostics.push(diagnostic(artifact, 'evidence-revision-unavailable', 'EVIDENCE_UNPINNED',
      `Revision ${revision} is not available in the local repository.`, {
        subject: { path: '/repository/revision' },
        supportedFixes: ['fetch the pinned commit or re-pin an available revision'],
      }));
  }

  const list = Array.isArray(index.evidence) ? index.evidence : null;
  if (!list || list.length === 0) {
    diagnostics.push(diagnostic(artifact, 'evidence-empty', 'EVIDENCE_MISSING',
      'Evidence index must contain at least one inspected entry.', {
        subject: { path: '/evidence' },
        supportedFixes: ['record one entry per inspected file, symbol, or configuration'],
      }));
    return { ok: false, entries, revision, diagnostics };
  }

  const verifiable = Boolean(repository) && Boolean(revision) && REVISION.test(revision || '')
    && repository.hasCommit(revision);

  for (const [position, entry] of list.entries()) {
    const where = `/evidence/${position}`;
    if (!isPlainObject(entry)) {
      diagnostics.push(diagnostic(artifact, 'evidence-entry', 'SYNTAX_INVALID', 'Evidence entry must be an object.', {
        subject: { path: where },
      }));
      continue;
    }
    if (typeof entry.id !== 'string' || !EVIDENCE_ID.test(entry.id)) {
      diagnostics.push(diagnostic(artifact, 'evidence-id', 'SYNTAX_INVALID',
        `Evidence id ${JSON.stringify(entry.id ?? null)} must match ev-<slug>.`, {
          subject: { path: `${where}/id` },
          supportedFixes: ['use a stable lowercase id prefixed with "ev-"'],
        }));
      continue;
    }
    if (entries.has(entry.id)) {
      diagnostics.push(diagnostic(artifact, 'evidence-id-duplicate', 'ID_DUPLICATE',
        `Evidence id "${entry.id}" is declared more than once.`, {
          subject: { path: `${where}/id` },
          supportedFixes: ['make every evidence id unique'],
        }));
      continue;
    }
    const filePath = repositoryRelativePath(entry.file);
    if (!filePath) {
      diagnostics.push(diagnostic(artifact, 'evidence-file', 'EVIDENCE_MISSING',
        `Evidence "${entry.id}" must reference a repository-relative POSIX path.`, {
          subject: { path: `${where}/file`, evidenceId: entry.id },
          evidence: { authoredPath: entry.file ?? null },
          supportedFixes: ['use a path relative to the repository root with forward slashes'],
        }));
      continue;
    }
    const supports = Array.isArray(entry.supports) ? entry.supports.filter((value) => typeof value === 'string' && value) : [];
    if (!supports.length) {
      diagnostics.push(diagnostic(artifact, 'evidence-supports', 'TRACEABILITY_MISSING',
        `Evidence "${entry.id}" must declare which model ids it supports.`, {
          subject: { path: `${where}/supports`, evidenceId: entry.id },
          supportedFixes: ['list the element or relationship ids this evidence proves'],
        }));
    }
    if (entry.end_line !== undefined && entry.line === undefined) {
      diagnostics.push(diagnostic(artifact, 'evidence-line-required', 'SYNTAX_INVALID',
        `Evidence "${entry.id}" declares end_line without line.`, {
          subject: { path: `${where}/end_line`, evidenceId: entry.id },
          supportedFixes: ['add line or remove end_line'],
        }));
    }
    for (const field of ['line', 'end_line']) {
      const value = entry[field];
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
        diagnostics.push(diagnostic(artifact, 'evidence-line-invalid', 'SYNTAX_INVALID',
          `Evidence "${entry.id}" ${field} must be a positive integer.`, {
            subject: { path: `${where}/${field}`, evidenceId: entry.id },
          }));
      }
    }
    if (Number.isInteger(entry.line) && Number.isInteger(entry.end_line) && entry.end_line < entry.line) {
      diagnostics.push(diagnostic(artifact, 'evidence-line-range', 'SYNTAX_INVALID',
        `Evidence "${entry.id}" end_line must be greater than or equal to line.`, {
          subject: { path: where, evidenceId: entry.id },
        }));
    }

    const record = {
      id: entry.id,
      file: filePath,
      ...(Number.isInteger(entry.line) ? { line: entry.line } : {}),
      ...(Number.isInteger(entry.end_line) ? { endLine: entry.end_line } : {}),
      ...(typeof entry.symbol === 'string' ? { symbol: entry.symbol } : {}),
      supports,
      verified: false,
    };

    if (verifiable) {
      const content = repository.blob(revision, filePath);
      if (content === null) {
        diagnostics.push(diagnostic(artifact, 'evidence-file-missing', 'EVIDENCE_MISSING',
          `Evidence "${entry.id}" references ${filePath}, which is not a file at revision ${revision}.`, {
            subject: { path: `${where}/file`, evidenceId: entry.id },
            evidence: { file: filePath, revision },
            supportedFixes: ['reference a file that exists at the pinned revision'],
          }));
      } else {
        const total = lineCount(content);
        const requested = record.endLine || record.line;
        if (requested && requested > total) {
          diagnostics.push(diagnostic(artifact, 'evidence-line-out-of-range', 'EVIDENCE_MISSING',
            `Evidence "${entry.id}" requests line ${requested} but ${filePath} has ${total} lines at revision ${revision}.`, {
              subject: { path: where, evidenceId: entry.id },
              evidence: { file: filePath, requestedLine: requested, lineCount: total, revision },
              supportedFixes: ['use a line range that exists at the pinned revision'],
            }));
        } else if (record.symbol) {
          const scope = record.line ? sliceLines(content, record.line, record.endLine || record.line) : content;
          if (!scope.includes(record.symbol)) {
            diagnostics.push(diagnostic(artifact, 'evidence-symbol-missing', 'EVIDENCE_MISSING',
              `Evidence "${entry.id}" declares symbol "${record.symbol}", which does not appear in ${filePath}${record.line ? ` lines ${record.line}-${record.endLine || record.line}` : ''} at revision ${revision}.`, {
                subject: { path: `${where}/symbol`, evidenceId: entry.id },
                evidence: { file: filePath, symbol: record.symbol, revision },
                supportedFixes: ['name a symbol that exists in the referenced range, or remove the symbol'],
              }));
          } else {
            record.verified = true;
          }
        } else {
          record.verified = true;
        }
      }
    }
    entries.set(entry.id, record);
  }

  return {
    ok: diagnostics.every((entry) => entry.severity !== 'error'),
    entries,
    revision,
    repositoryUrl: typeof repositoryMeta?.url === 'string' ? repositoryMeta.url : null,
    verified: verifiable,
    diagnostics,
  };
}

export function validateSystemModel(model, { evidence, artifact = 'system-model.json' } = {}) {
  const diagnostics = [];
  const elements = new Map();
  const relationships = new Map();
  const referencedEvidence = new Set();

  if (!isPlainObject(model)) {
    diagnostics.push(diagnostic(artifact, 'model-root', 'SYNTAX_INVALID', 'System model root must be an object.', {
      supportedFixes: ['write system-model.json as an object with elements and relationships'],
    }));
    return { ok: false, elements, relationships, referencedEvidence, diagnostics };
  }
  if (model.schema_version !== 1) {
    diagnostics.push(diagnostic(artifact, 'model-schema-version', 'SYNTAX_INVALID',
      'System model requires "schema_version": 1.', {
        subject: { path: '/schema_version' },
        supportedFixes: ['set schema_version to 1'],
      }));
  }

  const declaredElements = Array.isArray(model.elements) ? model.elements : [];
  const declaredRelationships = Array.isArray(model.relationships) ? model.relationships : [];
  if (!declaredElements.length) {
    diagnostics.push(diagnostic(artifact, 'model-elements-empty', 'SYNTAX_INVALID',
      'System model must declare at least one element.', {
        subject: { path: '/elements' },
        supportedFixes: ['record the observed systems, containers, components, and datastores'],
      }));
  }

  const checkEvidence = (id, list, where, status, subjectKey) => {
    const ids = Array.isArray(list) ? list.filter((value) => typeof value === 'string' && value) : [];
    if (status !== 'unknown' && !ids.length) {
      diagnostics.push(diagnostic(artifact, 'model-evidence-required', 'EVIDENCE_MISSING',
        `${subjectKey} "${id}" is ${status} and must cite at least one evidence id.`, {
          subject: { path: `${where}/evidence`, [subjectKey === 'Relationship' ? 'relationshipId' : 'elementId']: id },
          supportedFixes: ['cite the evidence that proves this claim, or lower the status to unknown'],
        }));
    }
    if (status === 'unknown' && ids.length) {
      diagnostics.push(diagnostic(artifact, 'model-unknown-with-evidence', 'STATUS_INCONSISTENT',
        `${subjectKey} "${id}" is unknown but cites evidence.`, {
          subject: { path: `${where}/evidence`, [subjectKey === 'Relationship' ? 'relationshipId' : 'elementId']: id },
          supportedFixes: ['raise the status to inferred or observed, or remove the evidence'],
        }));
    }
    for (const evidenceId of ids) {
      referencedEvidence.add(evidenceId);
      if (!evidence) continue;
      const entry = evidence.get(evidenceId);
      if (!entry) {
        diagnostics.push(diagnostic(artifact, 'model-evidence-unknown', 'EVIDENCE_MISSING',
          `${subjectKey} "${id}" cites evidence "${evidenceId}", which is not in the evidence index.`, {
            subject: { path: `${where}/evidence`, evidenceId },
            supportedFixes: ['add the evidence entry, or cite an existing evidence id'],
          }));
        continue;
      }
      if (!entry.supports.includes(id)) {
        diagnostics.push(diagnostic(artifact, 'model-evidence-backreference', 'TRACEABILITY_MISSING',
          `Evidence "${evidenceId}" does not declare that it supports "${id}".`, {
            subject: { path: `${where}/evidence`, evidenceId },
            evidence: { supports: entry.supports },
            supportedFixes: [`add "${id}" to the supports list of "${evidenceId}"`],
          }));
      }
    }
    return ids;
  };

  for (const [position, element] of declaredElements.entries()) {
    const where = `/elements/${position}`;
    if (!isPlainObject(element)) {
      diagnostics.push(diagnostic(artifact, 'model-element', 'SYNTAX_INVALID', 'Element must be an object.', {
        subject: { path: where },
      }));
      continue;
    }
    if (typeof element.id !== 'string' || !ELEMENT_ID.test(element.id)) {
      diagnostics.push(diagnostic(artifact, 'model-element-id', 'SYNTAX_INVALID',
        `Element id ${JSON.stringify(element.id ?? null)} must be a stable lowercase slug.`, {
          subject: { path: `${where}/id` },
          supportedFixes: ['use a stable lowercase id, for example cmp-orders-api'],
        }));
      continue;
    }
    if (elements.has(element.id) || relationships.has(element.id)) {
      diagnostics.push(diagnostic(artifact, 'model-id-duplicate', 'ID_DUPLICATE',
        `Model id "${element.id}" is declared more than once.`, {
          subject: { path: `${where}/id`, elementId: element.id },
          supportedFixes: ['make every model id unique'],
        }));
      continue;
    }
    if (typeof element.name !== 'string' || !element.name.trim()) {
      diagnostics.push(diagnostic(artifact, 'model-element-name', 'SYNTAX_INVALID',
        `Element "${element.id}" requires a name.`, { subject: { path: `${where}/name`, elementId: element.id } }));
    }
    if (!ELEMENT_KINDS.has(element.kind)) {
      diagnostics.push(diagnostic(artifact, 'model-element-kind', 'SYNTAX_INVALID',
        `Element "${element.id}" has unsupported kind ${JSON.stringify(element.kind ?? null)}.`, {
          subject: { path: `${where}/kind`, elementId: element.id },
          evidence: { supported: [...ELEMENT_KINDS] },
          supportedFixes: ['use one supported element kind'],
        }));
    }
    if (!STATUSES.has(element.status)) {
      diagnostics.push(diagnostic(artifact, 'model-status', 'STATUS_INCONSISTENT',
        `Element "${element.id}" must declare status observed, inferred, or unknown.`, {
          subject: { path: `${where}/status`, elementId: element.id },
          supportedFixes: ['classify the element as observed, inferred, or unknown'],
        }));
    }
    const evidenceIds = checkEvidence(element.id, element.evidence, where, element.status, 'Element');
    elements.set(element.id, {
      id: element.id,
      name: element.name,
      kind: element.kind,
      status: element.status,
      evidence: evidenceIds,
      ...(typeof element.parent === 'string' ? { parent: element.parent } : {}),
    });
  }

  for (const element of elements.values()) {
    if (element.parent && !elements.has(element.parent)) {
      diagnostics.push(diagnostic(artifact, 'model-parent-unknown', 'TRACEABILITY_MISSING',
        `Element "${element.id}" declares parent "${element.parent}", which is not an element.`, {
          subject: { elementId: element.id },
          supportedFixes: ['declare the parent element or remove the parent reference'],
        }));
    }
  }

  const pairs = new Set();
  for (const [position, relationship] of declaredRelationships.entries()) {
    const where = `/relationships/${position}`;
    if (!isPlainObject(relationship)) {
      diagnostics.push(diagnostic(artifact, 'model-relationship', 'SYNTAX_INVALID', 'Relationship must be an object.', {
        subject: { path: where },
      }));
      continue;
    }
    if (typeof relationship.id !== 'string' || !ELEMENT_ID.test(relationship.id)) {
      diagnostics.push(diagnostic(artifact, 'model-relationship-id', 'SYNTAX_INVALID',
        `Relationship id ${JSON.stringify(relationship.id ?? null)} must be a stable lowercase slug.`, {
          subject: { path: `${where}/id` },
          supportedFixes: ['use a stable lowercase id, for example rel-api-orders-db'],
        }));
      continue;
    }
    if (elements.has(relationship.id) || relationships.has(relationship.id)) {
      diagnostics.push(diagnostic(artifact, 'model-id-duplicate', 'ID_DUPLICATE',
        `Model id "${relationship.id}" is declared more than once.`, {
          subject: { path: `${where}/id`, relationshipId: relationship.id },
          supportedFixes: ['make every model id unique'],
        }));
      continue;
    }
    for (const side of ['source', 'target']) {
      if (typeof relationship[side] !== 'string' || !elements.has(relationship[side])) {
        diagnostics.push(diagnostic(artifact, 'model-relationship-endpoint', 'TRACEABILITY_MISSING',
          `Relationship "${relationship.id}" ${side} ${JSON.stringify(relationship[side] ?? null)} is not a declared element.`, {
            subject: { path: `${where}/${side}`, relationshipId: relationship.id },
            supportedFixes: ['declare the element, or remove the unsupported relationship'],
          }));
      }
    }
    if (typeof relationship.type !== 'string' || !relationship.type.trim()) {
      diagnostics.push(diagnostic(artifact, 'model-relationship-type', 'SYNTAX_INVALID',
        `Relationship "${relationship.id}" requires a communication type, for example http, sql, or event.`, {
          subject: { path: `${where}/type`, relationshipId: relationship.id },
        }));
    }
    if (!STATUSES.has(relationship.status)) {
      diagnostics.push(diagnostic(artifact, 'model-status', 'STATUS_INCONSISTENT',
        `Relationship "${relationship.id}" must declare status observed, inferred, or unknown.`, {
          subject: { path: `${where}/status`, relationshipId: relationship.id },
          supportedFixes: ['classify the relationship as observed, inferred, or unknown'],
        }));
    }
    const evidenceIds = checkEvidence(relationship.id, relationship.evidence, where, relationship.status, 'Relationship');
    const pair = `${relationship.source}→${relationship.target}:${relationship.type}`;
    if (pairs.has(pair)) {
      diagnostics.push(diagnostic(artifact, 'model-relationship-duplicate', 'DUPLICATE_RELATIONSHIP',
        `Relationship "${relationship.id}" repeats ${pair}.`, {
          severity: 'warning',
          subject: { relationshipId: relationship.id },
          supportedFixes: ['merge repeated relationships, or differentiate their communication type'],
        }));
    }
    pairs.add(pair);
    relationships.set(relationship.id, {
      id: relationship.id,
      source: relationship.source,
      target: relationship.target,
      type: relationship.type,
      status: relationship.status,
      evidence: evidenceIds,
      ...(typeof relationship.label === 'string' ? { label: relationship.label } : {}),
    });
  }

  if (evidence) {
    for (const entry of evidence.values()) {
      const supported = entry.supports.filter((id) => elements.has(id) || relationships.has(id));
      if (entry.supports.length && !supported.length) {
        diagnostics.push(diagnostic(artifact, 'evidence-orphan', 'EVIDENCE_ORPHAN',
          `Evidence "${entry.id}" supports ids that are not in the system model.`, {
            severity: 'warning',
            subject: { evidenceId: entry.id },
            evidence: { supports: entry.supports },
            supportedFixes: ['add the missing model element, or remove the unused evidence entry'],
          }));
      }
    }
  }

  return {
    ok: diagnostics.every((entry) => entry.severity !== 'error'),
    elements,
    relationships,
    referencedEvidence,
    diagnostics,
  };
}
