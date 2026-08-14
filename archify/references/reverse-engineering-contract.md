# Reverse-engineering contract (Docs-as-Code)

Read this reference when the task is to derive architecture documentation from an existing repository instead of authoring a diagram from a description. It defines what may be claimed, what must be proven, which artifacts are produced, and which validations gate delivery.

The output of this mode is versionable Docs-as-Code derived from evidence, never speculative narrative.

## 1. Evidence First

Every architectural claim resolves to evidence found in the repository: source files, configuration, manifests, infrastructure files, migrations, contracts, schemas, tests, existing documentation, CI/CD configuration, dependency-injection registration, routing, observability, messaging, and persistence configuration.

Never derive runtime causality from a folder name, a class name, file proximity, a presumed convention, or the architecture a framework is usually associated with. The presence of two components does not prove that they communicate.

When evidence is insufficient, record `unknown` or `inferred`. Never convert an inference into a fact.

## 2. Observed, inferred, unknown

| Status | Meaning | Example |
|---|---|---|
| `observed` | Confirmed directly by code or configuration. | `POST /orders` is registered in `OrdersController.Create()`. |
| `inferred` | Sufficient structural evidence for a technical hypothesis, no direct proof of intent. | The Domain/Application/Infrastructure split is consistent with Clean Architecture. |
| `unknown` | Not enough evidence. | The original motivation for adopting Redis is not documented. |

Never remove this distinction to make a document read more assertively. `observed` and `inferred` require at least one evidence reference; `unknown` carries none.

## 3. Canonical artifact first

Build the canonical structural model before any narrative artifact. The model is the single source for every other artifact; never keep semantically different versions of the architecture in separate documents.

`docs/architecture/system-model.json`:

```json
{
  "schema_version": 1,
  "elements": [
    {
      "id": "cmp-orders-api",
      "name": "Orders API",
      "kind": "container",
      "status": "observed",
      "evidence": ["ev-orders-program", "ev-orders-controller"]
    }
  ],
  "relationships": [
    {
      "id": "rel-api-orders-db",
      "source": "cmp-orders-api",
      "target": "ds-orders-db",
      "type": "sql",
      "status": "observed",
      "evidence": ["ev-orders-dbcontext"]
    }
  ]
}
```

Element `kind` is one of `system`, `actor`, `container`, `component`, `datastore`, `external`, `endpoint`, `message`, `queue`, `topic`, `flow`, `entity`, `boundary`, `deployment`. Ids are stable, unique, and lowercase. A relationship carries its own evidence; it never inherits proof from its endpoints.

## 4. Deterministic extraction

Do not hand-write anything that can be determined mechanically: endpoints, HTTP methods, dependencies, projects, packages, DI registrations, entities, tables, topics, queues, consumers, producers, environment variables, containers, ports, and health checks. Extract them from the repository, then record the evidence that produced them.

## 5. Evidence index

`docs/architecture/evidence.json` is written before the architectural documents:

```json
{
  "schema_version": 1,
  "repository": { "url": "https://github.com/owner/repository", "revision": "<40-character commit SHA>" },
  "evidence": [
    {
      "id": "ev-orders-controller",
      "file": "src/Orders.Api/Controllers/OrdersController.cs",
      "symbol": "OrdersController",
      "line": 12,
      "end_line": 48,
      "supports": ["cmp-orders-api", "flow-create-order"]
    }
  ]
}
```

Validation reads the pinned revision from Git: the file must exist as a blob at that revision, the line range must exist, and a declared `symbol` must appear inside the referenced range. Never record evidence for something that was not actually inspected.

`supports` is a back-reference: every id a model element cites must list that element back, so traceability is checkable in both directions.

## 6. Discovery strategy

Analysis is top-down and bounded. Do not read files indiscriminately.

Run Phase 0 first:

```bash
node bin/archify.mjs reverse inventory --repo-root <repository> --out docs/architecture/repository-inventory.md
```

The inventory classifies tracked files at the pinned revision into languages, build manifests, entrypoints, infrastructure, CI/CD, configuration, and existing documentation. `node_modules`, `vendor`, `dist`, `build`, `coverage`, `.idea`, `.vscode`, and lockfiles are excluded; `bin/` and `obj/` are excluded only when the repository contains .NET projects, because they are build output there and source elsewhere. Do not ignore a lockfile when it is the only proof of a specific dependency version.

Then work in order: evidence collection → canonical system model → artifact generation → validation → targeted correction → cross-artifact consistency → freeze → manifest → delivery. Do not jump to diagrams before entrypoints, runtime boundaries, storage, transports, and deployment configuration are understood.

## 7. Artifacts

Create only the artifacts that apply to the repository.

```
docs/
├── api/
│   └── openapi.yaml
└── architecture/
    ├── README.md
    ├── architecture.md            arc42-structured SAD
    ├── repository-inventory.md    Phase 0 output
    ├── domain.md                  observable domain rules
    ├── evidence.json              evidence index
    ├── system-model.json          canonical model
    ├── manifest.json              delivery manifest (written by freeze)
    ├── coverage.md                what was and was not analyzed
    ├── traceability.md            artifact → element → evidence → confidence
    ├── c4/{context,container}.mmd
    ├── sequences/<flow-id>.mmd
    ├── dataflows/<flow-id>.mmd
    ├── lifecycles/<entity>.mmd
    ├── dependencies.mmd
    ├── deployment.mmd
    └── adr/ADR-0001-*.md
```

Every `.mmd` file declares its canonical ids in header comments so traceability is machine-checkable:

```
%% archify:artifact c4-container
%% archify:elements act-user, cmp-orders-api, ds-orders-db
%% archify:relationships rel-user-api, rel-api-orders-db
flowchart LR
    user[User]
    api[Orders API]
    db[(PostgreSQL)]

    user -->|HTTPS| api
    api -->|SQL| db
```

Supported `archify:artifact` kinds: `c4-context`, `c4-container`, `c4-component`, `sequence`, `dataflow`, `lifecycle`, `dependencies`, `deployment`. Supported Mermaid headers: `flowchart <TB|TD|BT|RL|LR>`, `sequenceDiagram`, `stateDiagram-v2`, and native `C4Context`/`C4Container` where the renderer supports them.

### Topology (C4)

Map actors, system boundary, containers, databases, message brokers, external systems, trust boundaries, and deployment boundaries. Every relation must represent observed communication. Do not add a relation to make a diagram look complete.

### Sequence diagrams

Select architecturally relevant flows (authentication, order creation, payment, event publication, asynchronous processing, webhook, upload, external integration). Do not generate one diagram per endpoint. Trace the flow through code: entrypoint → controller/route → application layer → domain logic → repository → datastore → broker/external dependency. Include a call only when its order can be proven.

### Data flow, lifecycle

Generate a data flow when pipelines, messaging, or relevant data movement exist; identify origin, destination, transformation, storage, transport, schema, classification, and sync/async. Generate a lifecycle only for states found in code or contracts; never invent an intermediate state. Retries appear as real transitions when the code proves them.

### OpenAPI

Extract method, path, path/query parameters, headers, request body, response schema, status codes, and authentication from controllers, route definitions, DTOs, validators, attributes, annotations, middleware, and tests. Never invent a description, status code, `required` flag, format, validation rule, or example the code does not evidence. When the standard requires a field that cannot be determined, use the minimal valid representation and record the limitation in `coverage.md`.

### Domain

Record only observable business rules — `Order.Cancel()` rejects cancellation when `Status == Shipped`. Do not turn CRUD operations into domain rules.

### Architectural pattern

Classify with structural evidence and real dependencies: dependency direction, interfaces, composition root, dependency injection, project references, runtime boundaries, and communication mechanisms. Folder names alone never justify a classification. Record the result as `observed` when explicit or documented and `inferred` when derived from structure.

### arc42 / SAD

`architecture.md` follows arc42: Introduction and Goals, Architecture Constraints, Context and Scope, Solution Strategy, Building Block View, Runtime View, Deployment View, Cross-cutting Concepts, Architecture Decisions, Quality Requirements, Risks and Technical Debt, Glossary. Do not fill a section to complete the template; write `Not identified from repository evidence.` instead.

### Retrospective ADRs

Create an ADR only for architecturally relevant decisions: primary database, message broker, main framework, authentication strategy, distributed cache, persistence, inter-service communication, modularization, deployment. Use `Status: Observed` or `Status: Inferred`, list `Evidence` as repository paths, and keep `Rationale` as `Unknown unless explicitly documented.`

The presence of Kafka proves the adoption of Kafka. It does not prove why Kafka was chosen. Never fabricate the historical motivation for a decision.

## 8. Validation pipeline

No artifact is complete because it was generated. The flow is:

```
candidate → validate → diagnose → targeted correction → validate again → accepted → freeze → deliver
```

```bash
node bin/archify.mjs reverse validate docs --repo-root <repository> --json
node bin/archify.mjs reverse freeze docs --repo-root <repository> --json
```

Both commands take the documentation root and consider only its `architecture/` and `api/` subtrees, so a landing page, a generated gallery, or images living beside the bundle are neither validated nor frozen.

`reverse validate` parses every artifact (JSON, YAML/OpenAPI, Mermaid), verifies evidence against the pinned revision, checks internal links, checks the traceability matrix, checks cross-artifact consistency, and scans for leaked secret values. `--strict` promotes missing contract artifacts from warning to error; `freeze` always runs strict, refuses to write a manifest while errors remain, and then writes `manifest.json` with a SHA-256 per artifact plus the repository revision, the collected warnings, and the collected unknowns.

Re-running `reverse validate` on a frozen bundle compares each artifact against the manifest hash, so an edit after acceptance is reported as `FROZEN_ARTIFACT_MODIFIED`. Do not change an accepted artifact without running the pipeline again.

Diagnostics carry both a machine code and the contract vocabulary:

| `contractCode` | Meaning |
|---|---|
| `EVIDENCE_MISSING` | A claim cites evidence that does not exist, or a file/symbol/line is not present at the pinned revision. |
| `EVIDENCE_UNPINNED` | The evidence index does not pin a resolvable full commit SHA. |
| `EVIDENCE_ORPHAN` | An evidence entry supports no canonical model id. |
| `TRACEABILITY_MISSING` | An artifact renders or cites something that is not traceable to the canonical model. |
| `STATUS_INCONSISTENT` | A status is missing, unsupported, or contradicts its evidence. |
| `CONSISTENCY_CONTRADICTION` | Two artifacts disagree, for example a sequence message with no matching OpenAPI operation. |
| `DUPLICATE_RELATIONSHIP`, `ID_DUPLICATE` | Repeated relationship or repeated id. |
| `ARTIFACT_MISSING`, `MANIFEST_INCOMPLETE` | A contract artifact is absent or is not listed in the manifest. |
| `FROZEN_ARTIFACT_MODIFIED` | An accepted artifact changed after freeze. |
| `SECRET_LEAKED` | A generated artifact contains a value that looks like a credential. |
| `LINK_BROKEN`, `SYNTAX_INVALID`, `SPEC_INVALID` | Broken internal link, unparsable artifact, invalid OpenAPI structure. |

Correct only the diagnosed problem. Do not rewrite a whole artifact to resolve a localized error, and validate again after each correction.

## 9. Consistency

Artifacts may not contradict each other. If OpenAPI declares `POST /orders`, a sequence diagram may not declare `PUT /orders`. If a C4 container diagram shows `Orders API → PostgreSQL` and no evidence supports that communication, remove the relation or mark it as inferred in the model. The canonical model is the reference for cross-artifact consistency.

## 10. Visual quality

Diagrams exist as versionable Mermaid source; a rendered HTML/SVG version is additional, never a replacement. Prefer one obvious main path, 6–12 primary elements, short branches, short semantic labels, no crossings, no redundant relations, and correct direction. A label that carries protocol, direction, action, sync/async behavior, a security boundary, or a cross-boundary mechanism is architectural information and is not removed for layout.

Repair order when a diagram has problems: semantic error → element without evidence → relation without evidence → wrong direction → overlap → crossing → unreadable label → excessive density. Semantics outrank aesthetics.

For a polished explorable HTML version of a validated model, author an Archify diagram from the same canonical ids and deliver it with `deliver` as usual.

## 11. Unknowns and secrets

Missing information stays missing. Do not fill gaps with generic knowledge; write `Unknown`, `Not identified`, `Not evidenced`, or `Inferred`. `### Disaster Recovery\n\nNot identified from repository evidence.` is preferable to a fabricated description.

Never copy the value of an API key, token, password, connection-string password, private key, certificate, or secret. Replace it with `<redacted>`. Recording that the secret exists and what it is for is allowed: "Orders API uses a PostgreSQL connection string provided by environment variable `DATABASE_URL`."

## 12. Handoff

Report a structured summary and never claim more than the receipts prove:

```
repository_revision: <commit>
architecture_style: <observed|inferred|unknown>
artifacts_generated: <count>
validation_errors: 0
validation_warnings: <count>
unresolved_unknowns: <count>
```

Then list the generated artifact paths. Do not write "fully documented", "complete architecture", "100% coverage", or "validated" without the corresponding objective evidence. Measure coverage before reporting it, and state what was not analyzed.

Priority order: correctness > traceability > consistency > completeness > visual polish. An incomplete but verifiable diagram is better than a complete diagram based on assumptions, and an explicit `unknown` is better than an invented fact.
