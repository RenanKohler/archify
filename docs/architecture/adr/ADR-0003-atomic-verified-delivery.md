# ADR-0003 — Atomic verified delivery

## Status

Observed

## Context

`commandDeliver` in `archify/bin/archify.mjs` creates a private staging directory beside the output target, freezes the specification bytes into a snapshot, renders that snapshot, runs `archify/scripts/check-render-output.mjs` against the candidate, builds a receipt with SHA-256 and byte counts for both specification and artifact, and only then renames the candidate onto the target. Every failure path reports a stage and leaves the previous artifact untouched.

## Decision

Delivery is staged and atomic: generation, verification, and commitment are separate, and an artifact becomes visible only after it passes verification.

## Evidence

- `archify/bin/archify.mjs`
- `archify/scripts/check-render-output.mjs`
- `archify/references/delivery-contract.md`

## Rationale

Unknown unless explicitly documented.

## Consequences

### Observed

A failed render or a failed artifact check cannot corrupt a previously delivered file, and the receipt lets a reader confirm which bytes were verified.

### Expected trade-offs

Analysis, not authors' intent: delivery costs an extra render plus filesystem staging, and the staging directory must live on the same filesystem as the target for the rename to stay atomic.
