# Archify architecture documentation

Evidence-backed Docs-as-Code for this repository, generated and validated by `archify reverse` at revision `992d9a68ff1827e9699722f7f1946cbeb57484fc`.

Regenerate and re-verify:

```bash
cd archify
node bin/archify.mjs reverse inventory --repo-root .. --out ../docs/architecture/repository-inventory.md
node bin/archify.mjs reverse validate ../docs --repo-root .. --json
node bin/archify.mjs reverse freeze ../docs --repo-root .. --json
```

| Artifact | Contents |
|---|---|
| [`evidence.json`](evidence.json) | Every inspected file, symbol, and line range, and what it supports |
| [`system-model.json`](system-model.json) | The canonical elements and relationships, each observed, inferred, or unknown |
| [`architecture.md`](architecture.md) | arc42-structured architecture description |
| [`domain.md`](domain.md) | Rules enforced by code, with their enforcement points |
| [`repository-inventory.md`](repository-inventory.md) | Phase 0 inventory of tracked files |
| [`traceability.md`](traceability.md) | Artifact → element → evidence → confidence |
| [`coverage.md`](coverage.md) | What was analyzed, what was not, and which artifacts are deliberately absent |
| `manifest.json` | Frozen delivery manifest with a SHA-256 per artifact |
| [`c4/context.mmd`](c4/context.mmd), [`c4/container.mmd`](c4/container.mmd) | System context and container views |
| [`sequences/`](sequences/) | Delivery and reverse-validation runtime views |
| [`dataflows/docs-as-code.mmd`](dataflows/docs-as-code.mmd) | How repository facts become frozen artifacts |
| [`lifecycles/delivery-stages.mmd`](lifecycles/delivery-stages.mmd) | Delivery stages as reported in receipts |
| [`dependencies.mmd`](dependencies.mmd) | Module dependency map from real imports and spawned processes |
| [`adr/`](adr/) | Retrospective ADRs, with rationale left unknown where it is undocumented |

The contract these artifacts follow is [`archify/references/reverse-engineering-contract.md`](../../archify/references/reverse-engineering-contract.md). Editing an artifact after freeze is reported by the next `reverse validate` run; regenerate and re-freeze instead.
