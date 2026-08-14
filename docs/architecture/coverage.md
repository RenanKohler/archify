# Coverage

Measured at revision `992d9a68ff1827e9699722f7f1946cbeb57484fc`.

## Analyzed

| Surface | Count |
|---|---|
| Tracked files at the revision | 423 |
| Files inside the discovery policy | 422 |
| CLI commands routed in `archify/bin/archify.mjs` | 13 |
| Typed renderers | 5/5 |
| JSON IR schemas | 6/6 (five diagram types plus shared `$defs`) |
| Feature modules read for this bundle | `bin/`, `renderers/shared/`, `delta/`, `reverse/`, `scripts/check-render-output.mjs` |
| Evidence entries resolved against Git | 36/36 |
| Canonical elements | 20 |
| Canonical relationships | 19 |

## Not analyzed

- `archify/test/`, `integrations/deepseek-harness/test/`, and `benchmarks/` — test and benchmark code was not modelled; it constrains behavior but is not part of the runtime topology.
- `archify/renderers/*/render-*.mjs` internals — each renderer is modelled as one building block. Geometry, layout, and legend internals were not decomposed.
- `docs/gallery/`, `docs/cases/`, `examples/` — generated artifacts and fixtures.
- `experiments/`, `.github/` beyond identifying the CI workflows.

## Deliberately absent artifacts

- `docs/api/openapi.yaml` — the repository exposes no HTTP API contract. `archify/bin/preview.mjs` starts a loopback-only development server that serves one artifact; it has no documented public routes, so no OpenAPI document was fabricated for it.
- `docs/architecture/deployment.mmd` — no Dockerfile, Kubernetes manifest, Helm chart, or infrastructure-as-code exists in the repository. Deployment is therefore recorded as `Not identified from repository evidence.` in [`architecture.md`](architecture.md).

## Known limits of this bundle

- Confidence levels are per element and relationship, not per sentence of prose.
- The bundle describes exactly one commit. It goes stale as the repository moves and must be regenerated and re-frozen rather than edited.
