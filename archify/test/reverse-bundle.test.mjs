import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRepository, removeRepository, write } from './reverse-fixture.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

const SOURCE_FILES = {
  'src/orders-controller.mjs': `export class OrdersController {
  async create(command) {
    const order = await this.handler.createOrder(command);
    return { status: 201, body: order };
  }
}
`,
  'src/orders-store.mjs': `export class OrdersStore {
  insert(order) {
    return this.sql\`INSERT INTO orders\`;
  }
}
`,
};

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
  return { ...result, receipt: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function bundle(docsRoot, revision, overrides = {}) {
  const files = {
    'architecture/evidence.json': JSON.stringify({
      schema_version: 1,
      repository: { url: 'https://github.com/archify/reverse-fixture', revision },
      evidence: [
        {
          id: 'ev-orders-controller',
          file: 'src/orders-controller.mjs',
          symbol: 'OrdersController',
          line: 1,
          end_line: 6,
          supports: ['cmp-orders-api', 'rel-user-api', 'flow-create-order'],
        },
        {
          id: 'ev-orders-store',
          file: 'src/orders-store.mjs',
          symbol: 'OrdersStore',
          supports: ['ds-orders-db', 'rel-api-orders-db'],
        },
        { id: 'ev-actor-user', file: 'src/orders-controller.mjs', supports: ['act-user'] },
      ],
    }, null, 2),
    'architecture/system-model.json': JSON.stringify({
      schema_version: 1,
      elements: [
        { id: 'act-user', name: 'API client', kind: 'actor', status: 'inferred', evidence: ['ev-actor-user'] },
        { id: 'cmp-orders-api', name: 'Orders API', kind: 'container', status: 'observed', evidence: ['ev-orders-controller'] },
        { id: 'ds-orders-db', name: 'Orders store', kind: 'datastore', status: 'observed', evidence: ['ev-orders-store'] },
        { id: 'flow-create-order', name: 'Create order', kind: 'flow', status: 'observed', evidence: ['ev-orders-controller'] },
      ],
      relationships: [
        { id: 'rel-user-api', source: 'act-user', target: 'cmp-orders-api', type: 'http', status: 'observed', evidence: ['ev-orders-controller'] },
        { id: 'rel-api-orders-db', source: 'cmp-orders-api', target: 'ds-orders-db', type: 'sql', status: 'observed', evidence: ['ev-orders-store'] },
      ],
    }, null, 2),
    'architecture/c4/container.mmd': `%% archify:artifact c4-container
%% archify:elements act-user, cmp-orders-api, ds-orders-db
%% archify:relationships rel-user-api, rel-api-orders-db
flowchart LR
    user[API client]
    api[Orders API]
    db[(Orders store)]

    user -->|HTTPS| api
    api -->|SQL| db
`,
    'architecture/sequences/create-order.mmd': `%% archify:artifact sequence
%% archify:elements act-user, cmp-orders-api, ds-orders-db, flow-create-order
%% archify:relationships rel-user-api, rel-api-orders-db
sequenceDiagram
    participant Client
    participant API
    participant Store
    Client->>API: POST /orders
    API->>Store: INSERT INTO orders
    API-->>Client: 201 Created
`,
    'architecture/architecture.md': `# Architecture

## Context and Scope

See the [container view](c4/container.mmd).

## Deployment View

Not identified from repository evidence.
`,
    'architecture/repository-inventory.md': '# Repository Inventory\n\nStatus: observed.\n',
    'architecture/traceability.md': `# Traceability

| Artifact | Element | Evidence | Confidence |
|---|---|---|---|
| C4 Container | Orders API | ev-orders-controller \`src/orders-controller.mjs\` | observed |
| Sequence create-order | Orders store | ev-orders-store \`src/orders-store.mjs\` | observed |
`,
    'architecture/coverage.md': '# Coverage\n\nControllers: 1/1\nDatastores: 1/1\n\nNot analyzed:\n- none\n',
    'api/openapi.yaml': `openapi: 3.1.0
info:
  title: Orders API
  version: "1.0"
paths:
  /orders:
    post:
      responses:
        "201":
          description: Created
`,
    ...overrides,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === null) continue;
    write(docsRoot, relativePath, content);
  }
}

function withBundle(run_, overrides = {}) {
  const fixture = createRepository(SOURCE_FILES);
  try {
    const docsRoot = path.join(fixture.root, 'docs');
    bundle(docsRoot, fixture.revision, overrides);
    run_({ ...fixture, docsRoot });
  } finally {
    removeRepository(fixture.root);
  }
}

function contractCodes(receipt) {
  return receipt.diagnostics.map((entry) => entry.contractCode);
}

test('a complete evidence-backed bundle validates and freezes', () => {
  withBundle(({ root, docsRoot, revision }) => {
    const validated = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    assert.equal(validated.receipt.ok, true, JSON.stringify(validated.receipt.diagnostics, null, 2));
    assert.equal(validated.receipt.evidenceVerified, true);
    assert.equal(validated.receipt.coverage.elements, 4);
    assert.equal(validated.receipt.coverage.relationships, 2);
    assert.equal(validated.receipt.coverage.observed, 5);
    assert.equal(validated.receipt.coverage.inferred, 1);
    assert.equal(validated.receipt.summary.errors, 0);

    const frozen = run(['reverse', 'freeze', docsRoot, '--repo-root', root, '--generated-at', '2026-01-01T00:00:00Z', '--json']);
    assert.equal(frozen.status, 0, frozen.stderr || frozen.stdout);
    assert.equal(frozen.receipt.frozen, true);

    const manifest = JSON.parse(fs.readFileSync(path.join(docsRoot, 'architecture/manifest.json'), 'utf8'));
    assert.equal(manifest.revision, revision);
    assert.equal(manifest.generatedAt, '2026-01-01T00:00:00Z');
    assert.ok(manifest.artifacts.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
    assert.ok(manifest.artifacts.some((entry) => entry.type === 'openapi'));
    assert.ok(manifest.artifacts.some((entry) => entry.type === 'c4-container'));
    assert.ok(!manifest.artifacts.some((entry) => entry.path.endsWith('manifest.json')));

    const revalidated = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']);
    assert.equal(revalidated.receipt.ok, true, JSON.stringify(revalidated.receipt.diagnostics, null, 2));
  });
});

test('an artifact edited after freeze is reported and never silently accepted', () => {
  withBundle(({ root, docsRoot }) => {
    assert.equal(run(['reverse', 'freeze', docsRoot, '--repo-root', root, '--json']).receipt.frozen, true);
    fs.appendFileSync(path.join(docsRoot, 'architecture/coverage.md'), '\nControllers: 99/1\n');
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, false);
    assert.ok(contractCodes(receipt).includes('FROZEN_ARTIFACT_MODIFIED'));
  });
});

test('freeze refuses to write a manifest while validation errors remain', () => {
  withBundle(({ root, docsRoot }) => {
    const result = run(['reverse', 'freeze', docsRoot, '--repo-root', root, '--json']);
    assert.equal(result.receipt.frozen, false);
    assert.equal(result.status, 1);
    assert.ok(contractCodes(result.receipt).includes('EVIDENCE_MISSING'));
    assert.equal(fs.existsSync(path.join(docsRoot, 'architecture/manifest.json')), false);
  }, {
    'architecture/evidence.json': JSON.stringify({
      schema_version: 1,
      repository: { url: 'https://github.com/archify/reverse-fixture', revision: '0'.repeat(40) },
      evidence: [{ id: 'ev-ghost', file: 'src/ghost.mjs', supports: ['cmp-orders-api'] }],
    }, null, 2),
  });
});

test('a diagram may not render an element the canonical model does not contain', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, false);
    assert.ok(contractCodes(receipt).includes('TRACEABILITY_MISSING'));
    assert.ok(receipt.diagnostics.some((entry) => entry.code === 'reverse/traceability-unknown-element'));
  }, {
    'architecture/c4/container.mmd': `%% archify:artifact c4-container
%% archify:elements cmp-orders-api, ds-redis-cache
flowchart LR
    api[Orders API]
    cache[(Redis)]

    api -->|GET| cache
`,
  });
});

test('a diagram without traceability headers is rejected', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, false);
    assert.ok(receipt.diagnostics.some((entry) => entry.code === 'reverse/traceability-missing'));
  }, {
    'architecture/c4/context.mmd': 'flowchart LR\n    user[User] --> api[Orders API]\n',
  });
});

test('a sequence message contradicting the OpenAPI document is rejected', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, false);
    const contradiction = receipt.diagnostics.find((entry) => entry.code === 'reverse/consistency-endpoint');
    assert.ok(contradiction);
    assert.equal(contradiction.contractCode, 'CONSISTENCY_CONTRADICTION');
    assert.equal(contradiction.subject.method, 'PUT');
  }, {
    'architecture/sequences/create-order.mmd': `%% archify:artifact sequence
%% archify:elements act-user, cmp-orders-api, flow-create-order
%% archify:relationships rel-user-api
sequenceDiagram
    participant Client
    participant API
    Client->>API: PUT /orders
    API-->>Client: 201 Created
`,
  });
});

test('a leaked credential value and a broken link fail delivery', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, false);
    const codes = contractCodes(receipt);
    assert.ok(codes.includes('SECRET_LEAKED'));
    assert.ok(codes.includes('LINK_BROKEN'));
    const secret = receipt.diagnostics.find((entry) => entry.contractCode === 'SECRET_LEAKED');
    assert.equal(JSON.stringify(secret).includes('sup3rs3cretvalue'), false, 'a receipt must never copy the matched value');
  }, {
    'architecture/architecture.md': `# Architecture

## Cross-cutting Concepts

The service reads DATABASE_PASSWORD=sup3rs3cretvalue at startup.

See the [deployment view](deployment.mmd).
`,
  });
});

test('a prefixed credential assignment is caught, and credential prose is not', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    const leaks = receipt.diagnostics.filter((entry) => entry.contractCode === 'SECRET_LEAKED');
    assert.deepEqual(leaks.map((entry) => entry.subject.line), [5, 7]);
    assert.equal(JSON.stringify(receipt).includes('npm_9fQ2xLmTb7WcV1s0KpR4Ye8Zu'), false);
  }, {
    'architecture/coverage.md': `# Coverage

Controllers: 1/1

NPM_TOKEN=npm_9fQ2xLmTb7WcV1s0KpR4Ye8Zu

DATABASE_PASSWORD=sup3rs3cretvalue

The release job reads a bearer token: Authorization headers are set by the caller.
Rotation is documented at token: rotation-playbook.
`,
  });
});

test('a redacted secret and a documented environment variable stay clean', () => {
  withBundle(({ root, docsRoot }) => {
    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.diagnostics.some((entry) => entry.contractCode === 'SECRET_LEAKED'), false);
    assert.equal(receipt.ok, true, JSON.stringify(receipt.diagnostics, null, 2));
  }, {
    'architecture/architecture.md': `# Architecture

## Cross-cutting Concepts

Orders API reads a PostgreSQL connection string from environment variable \`DATABASE_URL\`.
The value is \`<redacted>\`; password: <redacted>.

## Deployment View

Not identified from repository evidence.
`,
  });
});

test('missing contract artifacts warn during validate and block freeze', () => {
  withBundle(({ root, docsRoot }) => {
    const validated = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(validated.ok, true);
    assert.equal(validated.summary.warnings >= 1, true);
    assert.ok(validated.diagnostics.some((entry) => (
      entry.severity === 'warning' && entry.artifact === 'architecture/coverage.md'
    )));

    const strict = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--strict', '--json']).receipt;
    assert.equal(strict.ok, false);

    const frozen = run(['reverse', 'freeze', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(frozen.frozen, false);
  }, { 'architecture/coverage.md': null });
});

test('an unrelated site beside the bundle is neither validated nor frozen', () => {
  withBundle(({ root, docsRoot }) => {
    write(docsRoot, 'index.html', '<!doctype html><p>landing page</p>');
    write(docsRoot, 'assets/broken.md', '[missing](./nowhere.md)\n\nDATABASE_PASSWORD=sup3rs3cretvalue\n');

    const receipt = run(['reverse', 'validate', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(receipt.ok, true, JSON.stringify(receipt.diagnostics, null, 2));
    assert.equal(receipt.artifacts.some((entry) => entry.path.startsWith('assets/')), false);
    assert.equal(receipt.artifacts.some((entry) => entry.path === 'index.html'), false);

    const frozen = run(['reverse', 'freeze', docsRoot, '--repo-root', root, '--json']).receipt;
    assert.equal(frozen.frozen, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(docsRoot, 'architecture/manifest.json'), 'utf8'));
    assert.ok(manifest.artifacts.every((entry) => (
      entry.path.startsWith('architecture/') || entry.path.startsWith('api/')
    )));
  });
});

test('the inventory command writes a bounded observed markdown surface', () => {
  withBundle(({ root, docsRoot }) => {
    const target = path.join(docsRoot, 'architecture/repository-inventory.md');
    const result = run(['reverse', 'inventory', '--repo-root', root, '--out', target, '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.receipt.ok, true);
    const markdown = fs.readFileSync(target, 'utf8');
    assert.match(markdown, /# Repository Inventory/);
    assert.match(markdown, /Status: observed\./);
    assert.match(markdown, /src\/orders-controller\.mjs|JavaScript/);
    assert.match(markdown, /Not identified from repository evidence\./);
  });
});
