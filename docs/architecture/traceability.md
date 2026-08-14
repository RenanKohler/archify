# Traceability

Every element and relationship rendered by an artifact in this bundle, with the evidence that supports it and its confidence. Ids match [`system-model.json`](system-model.json) and [`evidence.json`](evidence.json).

| Artifact | Element | Evidence | Confidence |
|---|---|---|---|
| C4 Context | Archify skill package | ev-package-manifest `archify/package.json` | observed |
| C4 Context | Authoring agent | ev-skill-entry `archify/SKILL.md` | inferred |
| C4 Context | Artifact reader | ev-viewer-template `archify/assets/template.html` | inferred |
| C4 Context | Delivered HTML artifact | ev-delivery-commit `archify/bin/archify.mjs` | observed |
| C4 Context | Git | ev-repository-evidence-git `archify/renderers/shared/repository-evidence.mjs` | observed |
| C4 Context | Chrome / Chromium | ev-visual-check-chrome `archify/bin/visual-check.mjs` | observed |
| C4 Container | Archify CLI | ev-cli-router `archify/bin/archify.mjs` | observed |
| C4 Container | Typed renderers | ev-renderer-architecture `archify/renderers/architecture/render-architecture.mjs` | observed |
| C4 Container | Shared renderer runtime | ev-runtime-template-read `archify/renderers/shared/cli.mjs` | observed |
| C4 Container | Standalone schema validators | ev-generated-validators `archify/renderers/shared/validator.mjs` | observed |
| C4 Container | Repository evidence verifier | ev-repository-evidence-verify `archify/renderers/shared/repository-evidence.mjs` | observed |
| C4 Container | Final artifact checker | ev-artifact-checker `archify/scripts/check-render-output.mjs` | observed |
| C4 Container | Reverse Docs-as-Code pipeline | ev-reverse-bundle `archify/reverse/bundle.mjs` | observed |
| C4 Container | CLI → typed renderers | ev-cli-renderer-path `archify/bin/archify.mjs` | observed |
| C4 Container | CLI → final artifact checker | ev-cli-checker-spawn `archify/bin/archify.mjs` | observed |
| C4 Container | CLI → reverse pipeline | ev-cli-reverse-import `archify/bin/archify.mjs` | observed |
| C4 Container | Renderer runtime → schema validators | ev-runtime-validator-import `archify/renderers/shared/cli.mjs` | observed |
| C4 Container | Renderer runtime → evidence verifier | ev-runtime-evidence-import `archify/renderers/shared/cli.mjs` | observed |
| C4 Container | Evidence verifier → Git | ev-repository-evidence-git `archify/renderers/shared/repository-evidence.mjs` | observed |
| C4 Container | Reverse pipeline → Git | ev-reverse-git-spawn `archify/reverse/model.mjs` | observed |
| Sequence deliver-artifact | Deliver a validated artifact | ev-runtime-template-read, ev-artifact-checker, ev-delivery-commit | observed |
| Sequence reverse-validate | Validate and freeze a bundle | ev-reverse-bundle, ev-reverse-evidence-check, ev-reverse-freeze | observed |
| Lifecycle delivery-stages | Delivery stages | ev-delivery-stages, ev-delivery-commit `archify/bin/archify.mjs` | observed |
| Data flow docs-as-code | Reverse Docs-as-Code pipeline | ev-reverse-inventory `archify/reverse/inventory.mjs` | observed |
| Dependencies | Architecture Delta | ev-delta-compare `archify/delta/architecture-delta.mjs` | observed |
| Dependencies | Visual-check runtime | ev-visual-check-runtime `archify/bin/visual-check.mjs` | observed |
| Dependencies | Last-good live preview | ev-preview-server `archify/bin/preview.mjs` | observed |
| ADR-0001 | Typed JSON IR | ev-generated-validators, ev-renderer-architecture | observed |
| ADR-0002 | Zero-dependency runtime | ev-package-manifest, ev-generated-validators | observed |
| ADR-0003 | Atomic verified delivery | ev-delivery-commit, ev-artifact-checker | observed |
| ADR-0004 | Revision-pinned evidence | ev-reverse-evidence-check, ev-reverse-freeze | observed |
| Architecture style | Command-routed pipeline with typed renderers behind one shared runtime | multiple real imports in `dependencies.mmd` | inferred |
