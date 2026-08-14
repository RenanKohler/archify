import test from 'node:test';
import assert from 'node:assert/strict';

import { validateMermaid } from '../reverse/mermaid.mjs';

function codes(result) {
  return result.diagnostics.map((entry) => entry.code);
}

test('flowchart topology parses nodes, relationships, and labels', () => {
  const result = validateMermaid([
    '%% archify:artifact c4-container',
    '%% archify:elements act_user, api, db',
    '%% archify:relationships rel-user-api',
    'flowchart LR',
    '    act_user[User]',
    '    api[Orders API]',
    '    db[(PostgreSQL)]',
    '',
    '    act_user -->|HTTPS| api',
    '    api -->|SQL| db',
  ].join('\n'));

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.kind, 'flowchart');
  assert.equal(result.header.artifact, 'c4-container');
  assert.deepEqual(result.header.elements, ['act_user', 'api', 'db']);
  assert.deepEqual(result.nodes, ['act_user', 'api', 'db']);
  assert.deepEqual(result.edges.map((edge) => `${edge.from}-${edge.label}->${edge.to}`), [
    'act_user-HTTPS->api',
    'api-SQL->db',
  ]);
});

test('flowchart keeps the attached label form and the plain chain form apart', () => {
  const labelled = validateMermaid('flowchart LR\n    api-- publishes -->broker');
  assert.equal(labelled.ok, true, JSON.stringify(labelled.diagnostics));
  assert.deepEqual(labelled.edges, [{ from: 'api', to: 'broker', label: 'publishes', line: 2 }]);

  const chain = validateMermaid('flowchart LR\n    api --- worker --> broker');
  assert.equal(chain.ok, true, JSON.stringify(chain.diagnostics));
  assert.deepEqual(chain.edges.map((edge) => [edge.from, edge.to]), [['api', 'worker'], ['worker', 'broker']]);
});

test('unbalanced brackets and unclosed subgraphs fail as syntax errors', () => {
  const unbalanced = validateMermaid('flowchart TD\n    api[Orders API\n    api --> db[(Store)]');
  assert.equal(unbalanced.ok, false);
  assert.ok(codes(unbalanced).includes('reverse/mermaid-unbalanced'));

  const unclosed = validateMermaid('flowchart TD\n    subgraph Platform\n    api[API]');
  assert.equal(unclosed.ok, false);
  assert.ok(codes(unclosed).includes('reverse/mermaid-block-unbalanced'));
});

test('sequence diagram collects ordered messages and rejects undeclared participants', () => {
  const result = validateMermaid([
    'sequenceDiagram',
    '    participant Client',
    '    participant API as Orders API',
    '    Client->>API: POST /orders',
    '    API-->>Client: 201 Created',
  ].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.kind, 'sequence');
  assert.deepEqual(result.edges.map((edge) => edge.label), ['POST /orders', '201 Created']);

  const undeclared = validateMermaid([
    'sequenceDiagram',
    '    participant Client',
    '    Client->>Worker: enqueue',
  ].join('\n'));
  assert.equal(undeclared.ok, false);
  assert.ok(codes(undeclared).includes('reverse/mermaid-participant-undeclared'));
});

test('sequence blocks must close', () => {
  const result = validateMermaid('sequenceDiagram\n    participant A\n    loop retry\n    A->>A: retry');
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('reverse/mermaid-block-unbalanced'));
});

test('state diagram collects transitions and rejects unsupported statements', () => {
  const result = validateMermaid([
    '%% archify:artifact lifecycle',
    '%% archify:elements ent-order',
    'stateDiagram-v2',
    '    [*] --> Created',
    '    Created --> Paid: payment confirmed',
    '    Paid --> Shipped: shipment created',
    '    Created --> Cancelled: cancellation',
  ].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.kind, 'state');
  assert.ok(result.nodes.includes('Cancelled'));
  assert.equal(result.edges.length, 4);

  const broken = validateMermaid('stateDiagram-v2\n    Created ==> Paid');
  assert.equal(broken.ok, false);
  assert.ok(codes(broken).includes('reverse/mermaid-statement-unknown'));
});

test('native C4 statements are parsed and unknown headers are rejected', () => {
  const result = validateMermaid([
    'C4Container',
    '    Person(user, "User", "Places orders")',
    '    Container(api, "Orders API", "ASP.NET Core")',
    '    Rel(user, api, "Places order", "HTTPS")',
  ].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.edges, [{ from: 'user', to: 'api', label: 'Places order', line: 4 }]);

  const unsupported = validateMermaid('erDiagram\n    ORDER ||--o{ LINE : contains');
  assert.equal(unsupported.ok, false);
  assert.ok(codes(unsupported).includes('reverse/mermaid-header-unsupported'));
});

test('an unknown archify:artifact kind is reported', () => {
  const result = validateMermaid('%% archify:artifact topology\nflowchart LR\n    a[A]');
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('reverse/artifact-kind-unknown'));
});
