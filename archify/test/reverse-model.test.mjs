import test from 'node:test';
import assert from 'node:assert/strict';

import { openRepository, validateEvidenceIndex, validateSystemModel } from '../reverse/model.mjs';
import { classifyFiles } from '../reverse/inventory.mjs';
import { createRepository, removeRepository } from './reverse-fixture.mjs';

const SOURCE = `export class OrdersController {
  create(command) {
    return this.handler.createOrder(command);
  }
}
`;

function evidenceIndex(revision, overrides = {}) {
  return {
    schema_version: 1,
    repository: { url: 'https://github.com/archify/reverse-fixture', revision },
    evidence: [
      {
        id: 'ev-orders-controller',
        file: 'src/orders-controller.mjs',
        symbol: 'OrdersController',
        line: 1,
        end_line: 5,
        supports: ['cmp-orders-api'],
      },
      {
        id: 'ev-orders-store',
        file: 'src/orders-store.mjs',
        symbol: 'OrdersStore',
        supports: ['ds-orders-db', 'rel-api-orders-db'],
      },
    ],
    ...overrides,
  };
}

function systemModel(overrides = {}) {
  return {
    schema_version: 1,
    elements: [
      { id: 'cmp-orders-api', name: 'Orders API', kind: 'container', status: 'observed', evidence: ['ev-orders-controller'] },
      { id: 'ds-orders-db', name: 'Orders Store', kind: 'datastore', status: 'observed', evidence: ['ev-orders-store'] },
    ],
    relationships: [
      {
        id: 'rel-api-orders-db',
        source: 'cmp-orders-api',
        target: 'ds-orders-db',
        type: 'sql',
        status: 'observed',
        evidence: ['ev-orders-store'],
      },
    ],
    ...overrides,
  };
}

function withRepository(run) {
  const fixture = createRepository({
    'src/orders-controller.mjs': SOURCE,
    'src/orders-store.mjs': 'export class OrdersStore {}\n',
  });
  try {
    const opened = openRepository(fixture.root);
    assert.equal(opened.ok, true, opened.reason);
    run({ ...fixture, repository: opened.repository });
  } finally {
    removeRepository(fixture.root);
  }
}

function codes(result) {
  return result.diagnostics.map((entry) => entry.code);
}

test('evidence verifies files, line ranges, and symbols at the pinned revision', () => {
  withRepository(({ revision, repository }) => {
    const result = validateEvidenceIndex(evidenceIndex(revision), { repository });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.verified, true);
    assert.equal(result.entries.size, 2);
    assert.equal(result.entries.get('ev-orders-controller').verified, true);
  });
});

test('evidence pointing at a missing file, range, or symbol never validates', () => {
  withRepository(({ revision, repository }) => {
    const index = evidenceIndex(revision);
    index.evidence.push(
      { id: 'ev-ghost-file', file: 'src/ghost.mjs', supports: ['cmp-ghost'] },
      { id: 'ev-ghost-line', file: 'src/orders-store.mjs', line: 400, supports: ['cmp-ghost'] },
      { id: 'ev-ghost-symbol', file: 'src/orders-store.mjs', symbol: 'PaymentsStore', supports: ['cmp-ghost'] },
      { id: 'ev-escape', file: '../outside.mjs', supports: ['cmp-ghost'] },
    );
    const result = validateEvidenceIndex(index, { repository });
    assert.equal(result.ok, false);
    const reported = codes(result);
    assert.ok(reported.includes('reverse/evidence-file-missing'));
    assert.ok(reported.includes('reverse/evidence-line-out-of-range'));
    assert.ok(reported.includes('reverse/evidence-symbol-missing'));
    assert.ok(reported.includes('reverse/evidence-file'));
  });
});

test('an unpinned or unavailable revision is reported before any file check', () => {
  withRepository(({ repository }) => {
    const unpinned = validateEvidenceIndex(evidenceIndex('main'), { repository });
    assert.equal(unpinned.ok, false);
    assert.ok(codes(unpinned).includes('reverse/evidence-revision'));

    const unavailable = validateEvidenceIndex(evidenceIndex('0'.repeat(40)), { repository });
    assert.equal(unavailable.ok, false);
    assert.ok(codes(unavailable).includes('reverse/evidence-revision-unavailable'));
  });
});

test('a canonical model with two-way traceability validates', () => {
  withRepository(({ revision, repository }) => {
    const evidence = validateEvidenceIndex(evidenceIndex(revision), { repository });
    const model = validateSystemModel(systemModel(), { evidence: evidence.entries });
    assert.equal(model.ok, true, JSON.stringify(model.diagnostics));
    assert.equal(model.elements.size, 2);
    assert.equal(model.relationships.size, 1);
  });
});

test('observed claims require evidence and unknown claims may not cite any', () => {
  withRepository(({ revision, repository }) => {
    const evidence = validateEvidenceIndex(evidenceIndex(revision), { repository });
    const model = validateSystemModel(systemModel({
      elements: [
        { id: 'cmp-orders-api', name: 'Orders API', kind: 'container', status: 'observed', evidence: [] },
        { id: 'ds-orders-db', name: 'Orders Store', kind: 'datastore', status: 'unknown', evidence: ['ev-orders-store'] },
      ],
    }), { evidence: evidence.entries });
    assert.equal(model.ok, false);
    const reported = codes(model);
    assert.ok(reported.includes('reverse/model-evidence-required'));
    assert.ok(reported.includes('reverse/model-unknown-with-evidence'));
  });
});

test('a relationship needs its own evidence back-reference and real endpoints', () => {
  withRepository(({ revision, repository }) => {
    const evidence = validateEvidenceIndex(evidenceIndex(revision), { repository });
    const model = validateSystemModel(systemModel({
      relationships: [
        {
          id: 'rel-api-cache',
          source: 'cmp-orders-api',
          target: 'ds-cache',
          type: 'redis',
          status: 'observed',
          evidence: ['ev-orders-controller'],
        },
      ],
    }), { evidence: evidence.entries });
    assert.equal(model.ok, false);
    const reported = codes(model);
    assert.ok(reported.includes('reverse/model-relationship-endpoint'));
    assert.ok(reported.includes('reverse/model-evidence-backreference'));
  });
});

test('unsupported kinds, statuses, and duplicate ids are rejected', () => {
  const model = validateSystemModel({
    schema_version: 1,
    elements: [
      { id: 'cmp-api', name: 'API', kind: 'microservice', status: 'observed', evidence: ['ev-x'] },
      { id: 'cmp-api', name: 'API again', kind: 'container', status: 'guessed', evidence: ['ev-x'] },
    ],
    relationships: [],
  });
  assert.equal(model.ok, false);
  const reported = codes(model);
  assert.ok(reported.includes('reverse/model-element-kind'));
  assert.ok(reported.includes('reverse/model-id-duplicate'));
});

test('evidence that supports nothing in the model is reported as a warning, not an error', () => {
  withRepository(({ revision, repository }) => {
    const index = evidenceIndex(revision);
    index.evidence.push({ id: 'ev-unused', file: 'src/orders-store.mjs', supports: ['cmp-not-modelled'] });
    const evidence = validateEvidenceIndex(index, { repository });
    const model = validateSystemModel(systemModel(), { evidence: evidence.entries });
    const orphan = model.diagnostics.find((entry) => entry.code === 'reverse/evidence-orphan');
    assert.ok(orphan);
    assert.equal(orphan.severity, 'warning');
    assert.equal(model.ok, true);
  });
});

test('the inventory classifier ignores build output only where it is build output', () => {
  const files = [
    'src/Orders.Api/Program.cs',
    'src/Orders.Api/Orders.Api.csproj',
    'src/Orders.Api/bin/Debug/Orders.Api.dll',
    'node_modules/left-pad/index.js',
    'package-lock.json',
    'docker-compose.yml',
    '.github/workflows/ci.yml',
  ];
  const dotnet = classifyFiles(files, { dotnet: true });
  assert.equal(dotnet.fileCount, 4, 'bin output, node_modules, and the lockfile are excluded');
  assert.equal(dotnet.ignoredCount, 3);
  assert.deepEqual(dotnet.entrypoints, ['src/Orders.Api/Program.cs']);
  assert.deepEqual(dotnet.infrastructure, ['docker-compose.yml']);
  assert.deepEqual(dotnet.ci, ['.github/workflows/ci.yml']);

  const node = classifyFiles(['bin/archify.mjs', 'package.json'], { dotnet: false });
  assert.equal(node.fileCount, 2);
});
