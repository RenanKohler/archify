# ADR-0001 — Typed JSON IR with one renderer per diagram type

## Status

Observed

## Context

The repository defines five JSON schemas (`archify/schemas/architecture.schema.json`, `workflow`, `sequence`, `dataflow`, `lifecycle`) plus a shared `common.schema.json`, and one renderer module per type under `archify/renderers/`. Every renderer imports the same runtime, `archify/renderers/shared/cli.mjs`, which loads and validates the specification before any layout work.

## Decision

Diagrams are produced from a typed JSON intermediate representation, validated per type, and rendered by a dedicated renderer for that type rather than by a general-purpose layout engine.

## Evidence

- `archify/schemas/README.md`
- `archify/schemas/architecture.schema.json`
- `archify/renderers/architecture/render-architecture.mjs`
- `archify/renderers/shared/cli.mjs`
- `archify/renderers/shared/validator.mjs`

## Rationale

Unknown unless explicitly documented. `archify/SKILL.md` and `DESIGN.md` describe the resulting contract, not the deliberation that produced it.

## Consequences

### Observed

Unknown fields are rejected at the schema boundary, and each renderer owns its own geometry rules; a change to one diagram type cannot silently alter another. Regeneration is deterministic enough that golden renders are compared byte-for-byte in `archify/test/golden.mjs`.

### Expected trade-offs

Analysis, not authors' intent: a per-type renderer multiplies the surface that must be kept consistent, and adding a sixth diagram type requires a schema, a renderer, examples, and checker coverage rather than configuration.
