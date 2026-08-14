# Archify — Architecture (arc42)

Derived from repository evidence at revision `992d9a68ff1827e9699722f7f1946cbeb57484fc`. Every claim below resolves to an entry in [`evidence.json`](evidence.json) through the canonical [`system-model.json`](system-model.json). Sections without evidence say so.

## 1. Introduction and Goals

Archify is an agent skill that turns a typed JSON specification, or an existing repository, into a self-contained interactive HTML diagram and into evidence-backed architecture documentation. `archify/package.json` declares the package; `archify/SKILL.md` is the agent-facing entrypoint and describes the bounded authoring path.

Quality goals stated in the repository, rather than inferred: validation precedes delivery, a non-zero command is never reported as success, and automated receipts never claim visual review. Status: observed.

## 2. Architecture Constraints

- Zero runtime dependencies. `archify/package.json` declares no `dependencies`; schema validation ships as committed standalone validators (`archify/renderers/shared/generated-validators.mjs`), and the packaged skill smoke test rejects any dependency metadata. Status: observed.
- Node.js 18 or newer (`engines` in `archify/package.json`). Status: observed.
- Chrome/Chromium is optional and external: `archify/bin/visual-check.mjs` resolves it through `ARCHIFY_CHROME` and reports `skipped` when it is unavailable. Status: observed.
- Git is required for evidence verification in both the diagram evidence path and the reverse pipeline. Status: observed.

## 3. Context and Scope

See [`c4/context.mmd`](c4/context.mmd). The authoring agent drives the CLI; the CLI writes one delivered HTML artifact that a reader opens in a browser; Git and Chrome/Chromium are the only external systems reached, and both are invoked as local processes.

## 4. Solution Strategy

One CLI process routes every command (`archify/bin/archify.mjs`). Diagram generation is delegated to five typed renderers that share a runtime (`archify/renderers/shared/cli.mjs`) responsible for schema validation, repository-evidence verification, and template application. Acceptance is separated from generation: the final artifact checker (`archify/scripts/check-render-output.mjs`) runs against the rendered candidate, and only a passing candidate is renamed onto the target. Status: observed.

## 5. Building Block View

See [`c4/container.mmd`](c4/container.mmd) and [`dependencies.mmd`](dependencies.mmd). The dependency map is built from real imports and spawned processes, not directory adjacency.

| Building block | Responsibility | Status |
|---|---|---|
| Archify CLI | Command routing, staged delivery, receipts | observed |
| Typed renderers | Architecture, workflow, sequence, data-flow, lifecycle SVG/HTML | observed |
| Shared renderer runtime | Schema validation, evidence verification, template application | observed |
| Standalone schema validators | Zero-dependency JSON IR validation | observed |
| Repository evidence verifier | Pinned-revision source verification for diagrams | observed |
| Final artifact checker | Artifact and composition checks on rendered HTML | observed |
| Architecture Delta | Before / Delta / After comparison of two validated snapshots | observed |
| Visual-check runtime | Containment measurement and captures through Chrome | observed |
| Last-good live preview | Loopback authoring server that only advances on verified output | observed |
| Reverse Docs-as-Code pipeline | Inventory, evidence, canonical model, artifact validation, freeze | observed |

## 6. Runtime View

- [`sequences/deliver-artifact.mmd`](sequences/deliver-artifact.mmd) — the delivery path from command to atomic commit.
- [`sequences/reverse-validate.mmd`](sequences/reverse-validate.mmd) — validation and freeze of a documentation bundle.
- [`lifecycles/delivery-stages.mmd`](lifecycles/delivery-stages.mmd) — the exact delivery stages reported in failure receipts.
- [`dataflows/docs-as-code.mmd`](dataflows/docs-as-code.mmd) — how repository facts become frozen artifacts.

## 7. Deployment View

Not identified from repository evidence. The repository contains no Dockerfile, container orchestration, or infrastructure-as-code; distribution is a skill package (`archify.zip`) installed into an agent's skills directory, and every command runs locally in the agent's process space. Status: observed for the absence of infrastructure files, unknown for any hosted deployment.

## 8. Cross-cutting Concepts

- **Structured diagnostics.** Failures are returned as one machine receipt with stable codes, subjects, evidence, and supported fixes (`archify/renderers/shared/diagnostics.mjs`, `archify/reverse/diagnostics.mjs`). Status: observed.
- **Atomic delivery.** A candidate is rendered and checked in a private same-directory staging folder; only a passing candidate replaces the target. Status: observed.
- **Evidence separation.** Deterministic receipts and visual review are kept apart; `visual-check` always reports `visualReview: "pending"`. Status: observed.
- **Secret handling.** The reverse pipeline scans generated artifacts for credential values and fails delivery instead of publishing them; matched values are never copied into the receipt. Status: observed.

## 9. Architecture Decisions

Retrospective ADRs derived from the repository:

- [ADR-0001 — Typed JSON IR with per-type renderers](adr/ADR-0001-typed-json-ir.md)
- [ADR-0002 — Zero-dependency runtime with committed standalone validators](adr/ADR-0002-zero-dependency-runtime.md)
- [ADR-0003 — Atomic verified delivery](adr/ADR-0003-atomic-verified-delivery.md)
- [ADR-0004 — Revision-pinned evidence for reverse engineering](adr/ADR-0004-revision-pinned-evidence.md)

## 10. Quality Requirements

Enforced mechanically rather than described: schema validation, artifact checks, composition profiles, golden renders, package smoke tests, release identity checks, and the reverse-pipeline validators. The CI workflow runs the suite on Node 18, 20, 22, and 24. Status: observed.

Runtime performance targets, availability targets, and accessibility conformance levels: not identified from repository evidence.

## 11. Risks and Technical Debt

- Chrome/Chromium availability is environmental; visual evidence degrades to `skipped` rather than failing, so a run without captures proves less than it appears to. Status: observed.
- The reverse pipeline's YAML support is a deliberate subset and fails closed on anchors, aliases, tags, and multi-document files. A repository whose OpenAPI document uses those constructs cannot be validated without a change here. Status: observed.
- Repository evidence for diagrams is restricted to `architecture` diagrams and public GitHub URLs (`archify/renderers/shared/repository-evidence.mjs`). Status: observed.

## 12. Glossary

| Term | Meaning |
|---|---|
| Artifact | The self-contained HTML file produced by a renderer |
| Candidate | A rendered but not yet accepted artifact in private staging |
| Canonical model | `system-model.json`, the single source for every derived artifact |
| Evidence | A file, symbol, or line range that exists at the pinned revision |
| Freeze | Recording per-artifact hashes so later edits are detectable |
| Observed / inferred / unknown | Confirmed by code, hypothesised from structure, or unproven |
