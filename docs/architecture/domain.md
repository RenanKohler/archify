# Domain

Observable rules only. Each rule is enforced by code at the pinned revision; rules that could not be traced to an enforcement point are not listed.

## Diagram authoring

| Rule | Enforcement | Status |
|---|---|---|
| A diagram is one of `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`. | `TYPES` in `archify/bin/archify.mjs`; any other value exits with an unknown-type failure. | observed |
| Unknown fields in a specification are rejected rather than ignored. | `additionalProperties: false` throughout `archify/schemas/`, compiled into `archify/renderers/shared/generated-validators.mjs`. | observed |
| A rendered candidate replaces the target only after every artifact check passes. | `commandDeliver` in `archify/bin/archify.mjs` renames the candidate after the checker exits 0. | observed |
| A failed delivery preserves the previous artifact. | The candidate lives in a private staging directory that is removed in the `finally` block. | observed |
| Automated visual evidence never claims perceptual review. | `runVisualCheck` always reports `visualReview: "pending"`. | observed |

## Repository evidence for diagrams

| Rule | Enforcement | Status |
|---|---|---|
| Source evidence requires a full 40-character commit SHA and a public GitHub URL. | `verifyRepositoryEvidence` in `archify/renderers/shared/repository-evidence.mjs`. | observed |
| An evidence path may not escape the repository or address `.git`. | `verifiedSourcePath` in the same module. | observed |
| A declared line range must exist in the blob at the pinned revision. | Line-count comparison in the same module. | observed |
| Repository evidence is accepted for `architecture` diagrams only. | `assertEvidenceType` in `archify/bin/archify.mjs`. | observed |

## Reverse Docs-as-Code

| Rule | Enforcement | Status |
|---|---|---|
| An evidence entry must resolve to a file that exists at the pinned revision; a declared symbol must appear in the referenced range. | `validateEvidenceIndex` in `archify/reverse/model.mjs`. | observed |
| `observed` and `inferred` require evidence; `unknown` may not carry any. | `validateSystemModel` in the same module. | observed |
| A relationship carries its own evidence, and each cited evidence entry must name that relationship in `supports`. | Back-reference check in `validateSystemModel`. | observed |
| A diagram may not render an element or relationship that the canonical model does not contain. | `checkDiagramTraceability` in `archify/reverse/bundle.mjs`. | observed |
| A sequence message that names an HTTP route must match an operation in the OpenAPI document when one exists. | `checkEndpointConsistency` in the same module. | observed |
| A generated artifact containing a credential value fails validation, and the value is never copied into the receipt. | `scanSecrets` in the same module. | observed |
| `freeze` does not write a manifest while errors remain; a frozen artifact that changes is reported. | `freezeBundle` and `checkManifest` in the same module. | observed |

## Not domain rules

Reading, rendering, and writing files are mechanics rather than business rules and are documented in the runtime views instead. The repository models no end-user business domain: Archify's subject matter is documentation and diagram production itself. Status: observed.
