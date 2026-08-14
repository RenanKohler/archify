import test from 'node:test';
import assert from 'node:assert/strict';

import { parseYaml, YamlError } from '../reverse/yaml.mjs';
import { validateOpenApi } from '../reverse/openapi.mjs';

const VALID = `openapi: 3.1.0
info:
  title: Orders API
  version: "1.0"
paths:
  /orders:
    post:
      operationId: createOrder
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrder'
      responses:
        "201":
          description: Created
  /orders/{orderId}:
    get:
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Found
        "404":
          description: Unknown order
components:
  schemas:
    CreateOrder:
      type: object
      required:
        - sku
      properties:
        sku:
          type: string
`;

function codes(result) {
  return result.diagnostics.map((entry) => entry.code);
}

test('the YAML subset parses block mappings, sequences, and scalars', () => {
  const document = parseYaml(VALID);
  assert.equal(document.openapi, '3.1.0');
  assert.equal(document.info.title, 'Orders API');
  assert.equal(document.info.version, '1.0');
  assert.deepEqual(document.components.schemas.CreateOrder.required, ['sku']);
  assert.equal(document.paths['/orders'].post.requestBody.required, true);
  assert.equal(
    document.paths['/orders'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/CreateOrder',
  );
});

test('the YAML subset parses block scalars, flow collections, and comments', () => {
  const document = parseYaml([
    '# leading comment',
    'servers: [https://example.test, https://staging.example.test]',
    'contact: {name: Platform, url: https://example.test}',
    'notes: |',
    '  first line',
    '  second line',
    'flag: true  # trailing comment',
    'count: 12',
  ].join('\n'));
  assert.deepEqual(document.servers, ['https://example.test', 'https://staging.example.test']);
  assert.deepEqual(document.contact, { name: 'Platform', url: 'https://example.test' });
  assert.equal(document.notes, 'first line\nsecond line\n');
  assert.equal(document.flag, true);
  assert.equal(document.count, 12);
});

test('the YAML subset fails closed on constructs it cannot represent', () => {
  assert.throws(() => parseYaml('base: &anchor\n  a: 1\nuse: *anchor'), YamlError);
  assert.throws(() => parseYaml('a: 1\n---\nb: 2'), YamlError);
  assert.throws(() => parseYaml('a: 1\n\tb: 2'), YamlError);
  assert.throws(() => parseYaml('a: 1\na: 2'), YamlError);
});

test('a valid OpenAPI document reports its observed operations', () => {
  const result = validateOpenApi(VALID);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.operations.map((operation) => `${operation.method} ${operation.path}`), [
    'POST /orders',
    'GET /orders/{orderId}',
  ]);
});

test('unresolved $ref, missing responses, and invalid versions are rejected', () => {
  const result = validateOpenApi(`openapi: 2.0.0
info:
  title: Orders API
paths:
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Missing'
`);
  assert.equal(result.ok, false);
  const reported = codes(result);
  assert.ok(reported.includes('reverse/openapi-version'));
  assert.ok(reported.includes('reverse/openapi-info'));
  assert.ok(reported.includes('reverse/openapi-responses'));
  assert.ok(reported.includes('reverse/openapi-ref-unresolved'));
});

test('path templates require a declared required path parameter', () => {
  const result = validateOpenApi(`openapi: 3.0.3
info:
  title: Orders API
  version: "1.0"
paths:
  /orders/{orderId}:
    get:
      parameters:
        - name: orderId
          in: path
      responses:
        "200":
          description: Found
  /shipments/{shipmentId}:
    get:
      responses:
        "200":
          description: Found
`);
  assert.equal(result.ok, false);
  const reported = codes(result);
  assert.ok(reported.includes('reverse/openapi-path-parameter-required'));
  assert.ok(reported.includes('reverse/openapi-path-parameter-missing'));
});

test('security requirements must resolve to a declared scheme', () => {
  const result = validateOpenApi(`openapi: 3.1.0
info:
  title: Orders API
  version: "1.0"
security:
  - bearerAuth: []
paths:
  /orders:
    get:
      responses:
        "200":
          description: Listed
`);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('reverse/openapi-security-scheme'));
});

test('unparsable YAML is reported as one syntax diagnostic', () => {
  const result = validateOpenApi('openapi: 3.1.0\ninfo:\n\ttitle: Orders API\n');
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['reverse/yaml-parse']);
  assert.equal(result.diagnostics[0].contractCode, 'SYNTAX_INVALID');
});
