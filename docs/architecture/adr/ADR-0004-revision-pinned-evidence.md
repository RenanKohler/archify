# ADR-0004 — Revision-pinned evidence for reverse engineering

## Status

Observed

## Context

`archify/reverse/model.mjs` resolves every evidence entry through Git objects at a pinned 40-character commit SHA: the file must exist as a blob at that revision, a declared line range must exist in it, and a declared symbol must appear inside the referenced range. `archify/reverse/bundle.mjs` then refuses to freeze a bundle while errors remain and records a SHA-256 per artifact so later edits are detectable.

## Decision

Reverse-engineered documentation is bound to one commit. Claims are verified against Git rather than against the working tree, and acceptance is recorded as hashes in `manifest.json`.

## Evidence

- `archify/reverse/model.mjs`
- `archify/reverse/bundle.mjs`
- `archify/references/reverse-engineering-contract.md`

## Rationale

Unknown unless explicitly documented.

## Consequences

### Observed

Documentation cannot cite a file that does not exist at the recorded revision, and an artifact edited after acceptance is reported as `FROZEN_ARTIFACT_MODIFIED` on the next validation.

### Expected trade-offs

Analysis, not authors' intent: the bundle describes one commit, so it goes stale as the repository moves and must be regenerated and re-frozen; verification also requires a local Git checkout, which makes validation unavailable where only a file export is present.
