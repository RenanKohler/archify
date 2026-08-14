# ADR-0002 — Zero-dependency runtime with committed standalone validators

## Status

Observed

## Context

`archify/package.json` declares `ajv` only under `devDependencies`, and `archify/scripts/generate-validators.mjs` compiles the schemas into `archify/renderers/shared/generated-validators.mjs`, which is committed. `scripts/build-zip.sh` strips `scripts`, `devDependencies`, and `package-lock.json` from the packaged skill, and `scripts/package-smoke.mjs` fails if the packaged `package.json` declares any dependency field.

## Decision

The installed skill runs with no `npm install` step: schema validation uses committed standalone validators, and the build removes every dependency declaration from the distributed package.

## Evidence

- `archify/package.json`
- `archify/scripts/generate-validators.mjs`
- `archify/renderers/shared/generated-validators.mjs`
- `scripts/build-zip.sh`
- `scripts/package-smoke.mjs`

## Rationale

Unknown unless explicitly documented.

## Consequences

### Observed

The packaged skill is validated on Ubuntu, macOS, and Windows without installing anything, and `npm run check:validators` fails when the committed validators drift from the schemas.

### Expected trade-offs

Analysis, not authors' intent: generated code must be regenerated and reviewed with every schema change, and features that would need a third-party parser have to be implemented in-repository — the reverse pipeline's bounded YAML subset in `archify/reverse/yaml.mjs` is an instance of that cost.
