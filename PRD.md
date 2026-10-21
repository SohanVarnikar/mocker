# Product Requirements Document: API Mocker

|                     |                     |
| ------------------- | ------------------- |
| **Document Status** | Draft v1.0          |
| **Author**          | Product/Engineering |
| **Last Updated**    | 2026-09-22          |

## 1. Overview

**API Mocker** is a local, developer-facing Node.js application that lets front-end developers create and run mock HTTP APIs without depending on a real backend. It provides a Web UI for defining mock endpoints (method, path, request/response shape, status codes) and a mock server that serves those definitions to the front-end application under development. Mocked "write" operations (POST/PUT/PATCH/DELETE) persist data to local JSON files so that subsequent reads/updates reflect prior changes — simulating a real, stateful backend without needing a database.

This is **not a production system**. It is a local development/testing tool intended to unblock UI developers when a real API is unavailable, incomplete, or unreliable.

## 2. Problem Statement

Front-end developers are frequently blocked by backend dependencies:

- The real API isn't built yet (parallel FE/BE development).
- The real API exists but isn't reachable (auth, network, environment issues).
- The FE developer needs to test edge cases (errors, empty states, slow responses) that are hard to reproduce against a real backend on demand.

Existing solutions (hand-written mock servers, browser network-tab overrides, ad-hoc JSON files) are either too rigid, not stateful, or require significant setup/maintenance. There is no simple, self-managed tool where a FE developer can define an endpoint, its expected request/response contract, and have it behave like a real stateful API — including simulating success/failure scenarios on demand.

## 3. Goals

- G1: Let a developer define a mock endpoint (method + path) with a request schema/example and one or more response definitions (status code + body) in under a few minutes via a Web UI.
- G2: Support all common HTTP methods: GET, POST, PUT, PATCH, DELETE (and allow arbitrary/custom methods if needed).
- G3: Persist data created/updated through mocked "write" endpoints to local file-based storage, so mocked state is consistent across calls and survives server restarts.
- G4: Allow multiple endpoints to be linked to the same underlying "entity" data store, so a POST on one endpoint and a PUT/DELETE on another endpoint both affect the same stored records consistently.
- G5: Allow a developer to switch which response scenario (e.g., 200 success, 404 not found, 500 server error, validation error) an endpoint returns, to test how the UI handles each case.
- G6: Run entirely locally in a Node.js environment with minimal setup (`npm install && npm start`), no external DB or cloud dependency required.
- G7: Keep the tool simple — favor convention and a small, understandable feature set over a fully general-purpose mocking framework.

## 4. Non-Goals

- NG1: Not intended for production traffic, load testing, or performance benchmarking.
- NG2: Not a full API gateway, contract-testing tool, or service-virtualization platform.
- NG3: Not a replacement for real backend integration testing before release.
- NG4: No requirement for multi-user concurrent editing, authentication/authorization of the mock admin UI itself (assume trusted local single-user usage), or team-wide hosted deployment (v1 is local-first; see Future Enhancements for shared/hosted use).
- NG5: No built-in data validation engine beyond basic JSON schema/shape checks (best-effort, not a strict contract enforcement tool).

## 5. Target Users / Personas

- **Primary: Front-End Developer** — building UI features against an API that doesn't exist yet or is unavailable; wants realistic, stateful, controllable responses.
- **Secondary: QA/Manual Tester** — wants to force specific error/success scenarios to verify UI handles them correctly.
- **Secondary: Full-stack Developer prototyping** — wants to sketch out an API contract before implementing the real backend.

## 6. Key Concepts / Domain Model

| Concept               | Description                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mock Endpoint**     | A single definition of `{ method, path, description }` plus one or more **Response Scenarios**. This is what the mock server matches incoming requests against.                                                                      |
| **Response Scenario** | A named variant of a response for an endpoint: `{ name, statusCode, headers, body/body template, isActive }`. Only one scenario per endpoint is "active" at a time (i.e., what the server currently returns), switchable via the UI. |
| **Entity**            | A logical data resource (e.g., "User", "Order") backed by a local JSON file acting as its mock data store (a simple array/collection of records).                                                                                    |
| **Entity Link**       | An association between a Mock Endpoint and an Entity + an operation type (list, get-by-id, create, update, delete, replace) that tells the mock server how to read/write the entity's file store when that endpoint is invoked.      |
| **Request Log**       | A record of each incoming request the mock server received and how it responded, for debugging in the UI.                                                                                                                            |

## 7. User Stories / Functional Requirements

### 7.1 Endpoint Management

- FR1: As a developer, I can create a mock endpoint by specifying HTTP method (GET/POST/PUT/PATCH/DELETE/other), a path (supporting path params like `/users/:id`), and an optional description/tag/group name.
- FR2: As a developer, I can define the expected request shape (example JSON body, query params, path params) for documentation/reference purposes.
- FR3: As a developer, I can define one or more response scenarios per endpoint, each with a name (e.g. "Success", "Validation Error", "Server Error"), an HTTP status code, headers, and a response body (static JSON or a template referencing entity data).
- FR4: As a developer, I can mark exactly one response scenario per endpoint as "active"; the mock server returns that scenario's response when the endpoint is called.
- FR5: As a developer, I can toggle the active scenario at any time (via the UI) without restarting the mock server, including simulating an artificial delay (latency) per scenario to test loading states.
- FR6: As a developer, I can enable/disable an endpoint entirely (disabled endpoints return 404 or pass through, per configuration).
- FR7: As a developer, I can group/tag endpoints (e.g., by feature or resource) for easier navigation in the UI.
- FR8: As a developer, I can view a list/search of all defined endpoints with method, path, and current active scenario at a glance.

### 7.2 Stateful Entity Storage

- FR9: As a developer, I can define an Entity (e.g., "products") backed by a local JSON file store, with an optional seed dataset (initial records) and an id field name (default `id`, auto-incrementing or UUID).
- FR10: As a developer, I can link a mock endpoint to an Entity with an operation type:
  - `list` (GET collection, with optional basic filtering/pagination),
  - `getById` (GET single record by path param),
  - `create` (POST — appends a new record to the entity store, auto-generating id and returning it),
  - `update` (PUT/PATCH — merges/replaces a record by id in the store),
  - `delete` (DELETE — removes a record by id from the store).
- FR11: As a developer, when I call a `create`-linked endpoint, the new record is persisted to the entity's file store immediately, and is retrievable by subsequently calling `list`/`getById`-linked endpoints for the same entity.
- FR12: As a developer, when I call an `update`-linked endpoint for a given id, the stored record is modified, and future `list`/`getById` calls reflect the change.
- FR13: As a developer, when I call a `delete`-linked endpoint for a given id, the record is removed from the store, and future reads no longer return it.
- FR14: As a developer, I can view and manually edit/reset the current contents of an Entity's data store from the UI (view raw JSON, edit a record, clear/reseed all data).
- FR15: An endpoint linked to an Entity still supports overriding with a non-success Response Scenario (e.g., force a 500 error) — in that case the entity store is untouched and the overriding scenario response is returned instead of performing the entity operation.
- FR15a: An Entity can declare a `scope` mapping record fields to path params (e.g. `rebateId`), so nested routes (`/rebates/:rebateId/notes`) only list/modify that parent's records, and `create` stamps the parent value on the new record.
- FR15b: An Entity can declare `defaults` applied to records made by `create`, and its seed data can use date tokens (`{{today+30d}}`, `{{now-1d}}`) that are resolved each time it is seeded, so date-dependent edge cases stay valid.
- FR15c: An Entity can declare `relations` (a field referencing another entity's id). Linked endpoints can expand referenced records (`?_expand=` or `entityLink.expand`) and embed referencing records (`?_embed=` or `entityLink.embed`); relations can validate that references exist and define what happens on delete (`none`, `cascade`, `setNull`, `restrict`).
- FR15d: The entity data view pages, searches and sorts records on the server, and the Raw JSON editor asks before loading very large datasets.

### 7.3 Response/Status Simulation

- FR16: As a developer, I can define scenarios for common outcomes: success (2xx), client error (4xx, e.g. 400 validation, 401, 403, 404, 409), and server error (5xx), each with a custom body (e.g., error message shape matching what the real API would return).
- FR17: As a developer, I can configure an artificial response delay (ms) per scenario to simulate slow networks/loading states.
- FR18: As a developer, response bodies can reference request input via simple templating (e.g., echo path param `:id`, echo request body fields, insert current timestamp, insert generated id) so responses feel dynamic without full scripting.
- FR18a: A Response Scenario can declare a `match` (dotted request paths such as `request.body.*`, `request.query.*`, `params.*` mapped to expected values). A scenario whose conditions all match is returned in preference to the active scenario, so edge cases can be triggered by request input.

### 7.4 Web UI & Management

- FR19: The Web UI provides views to: list endpoints, create/edit an endpoint and its scenarios, manage entities and their stored data, and view a request log (recent requests/responses with timestamps, matched endpoint, scenario used, and status code).
- FR20: The Web UI runs on a different port from the mock API server (or a distinct route prefix, e.g. `/__admin`), so it never collides with mocked application paths.
- FR21: Configuration (endpoints, scenarios, entity links) is persisted to local JSON files so it survives restarts and can optionally be checked into source control / shared across a team by committing the config files.
- FR22: As a developer, I can import/export the full mock configuration (endpoints + entities) as JSON, to share a mock setup with teammates or back it up.
- FR22a: Entity seed data is part of the shared configuration. Importing can reset stored data to the file's seed data (always on Overwrite, optional on Merge), and exporting can snapshot the current stored data as seed data.
- FR22b: Imports are validated and normalized; endpoints without an `id` update the existing endpoint with the same method + path instead of duplicating it.
- FR22c: The UI shows clear progress while an import runs and a success summary (added/updated/reseeded counts) or the failure reason afterwards. A file that fails validation changes nothing.

### 7.5 Mock Server Runtime

- FR23: The mock server listens on a configurable port and dynamically serves all currently defined, enabled endpoints matching method + path (including path params), returning the active scenario's response.
- FR24: Unmatched requests return a clear 404 with a helpful message (e.g., "No mock defined for GET /foo").
- FR25: CORS is enabled by default (configurable) so the mock server can be called directly from a FE app running on a different local port.
- FR26: Changes made in the Web UI (new/edited endpoints, scenario toggles, entity data edits) take effect immediately without restarting the mock server process.

## 8. Non-Functional Requirements

- NFR1: **Simplicity** — setup should be `npm install` + one start command; no external services (DB, cloud, Docker) required.
- NFR2: **Runtime** — must run on Node.js (LTS versions), cross-platform (Windows/macOS/Linux).
- NFR3: **Performance** — response times dominated by configured artificial delay only; entity records are cached in memory and indexed, and writes are coalesced, so datasets of 100k+ records stay responsive.
- NFR4: **Reliability of local state** — entity file writes should be atomic enough to avoid corruption on concurrent requests (basic write queue/lock per entity file is acceptable).
- NFR5: **Portability of config** — all mock definitions and entity data are plain human-readable JSON files on disk, so they can be manually inspected, edited, version-controlled, or reset by deleting files.
- NFR6: **No production hardening required** — no need for auth, rate limiting, HTTPS, horizontal scaling, or high availability.

## 9. Proposed Architecture (High-Level)

- **Runtime**: Node.js (Express or similar minimal HTTP framework) for both the mock API server and the admin API backing the Web UI.
- **Two logical servers, one process**:
  1. _Mock Server_ — dynamically registers routes from the current endpoint definitions; on each request, looks up the matching endpoint + active scenario, performs entity read/write if linked, applies delay/templating, and responds.
  2. _Admin/UI Server_ — serves the Web UI (a lightweight SPA or server-rendered pages) and a REST API for managing endpoints, scenarios, entities, and viewing logs; mounted on a distinct port or `/__admin` prefix.
- **Storage**: A `data/` directory containing:
  - `config/endpoints.json` — endpoint + scenario definitions.
  - `config/entities.json` — entity definitions (schema/id field/links).
  - `store/<entity>.json` — one file per entity holding its current records (the "mock database").
  - `logs/requests.log` (optional, rolling) — recent request/response log for the UI.
- **Live reload**: In-memory route table rebuilt whenever config changes via the admin API (no process restart needed).

## 10. Example Workflow

1. Developer creates Entity `products` seeded with 3 sample products.
2. Developer creates endpoint `GET /api/products` → linked to `products` (`list` operation), active scenario "Success" (200, returns all products).
3. Developer creates endpoint `POST /api/products` → linked to `products` (`create` operation), active scenario "Success" (201, returns created product with generated id).
4. Developer creates endpoint `PUT /api/products/:id` → linked to `products` (`update` operation), with two scenarios: "Success" (200) and "Not Found" (404) for testing error handling.
5. FE app calls `POST /api/products` with a new product → it's appended to `store/products.json`.
6. FE app calls `GET /api/products` → the newly created product appears in the response.
7. FE app calls `PUT /api/products/:id` for that product → the stored record is updated.
8. Developer switches the `PUT` endpoint's active scenario to "Not Found" to verify the UI shows an error toast correctly, then switches back to "Success".

## 11. Success Metrics

- Time to first working mock endpoint after install: < 5 minutes.
- A FE developer can fully build and demo a CRUD UI feature without any real backend running.
- Reduction in FE developer-reported "blocked by backend" time during parallel development sprints.

## 12. Risks & Assumptions

- **Assumption**: Single local developer usage; no need for concurrent multi-user editing of the same config.
- **Assumption**: Data volumes are small (dev/test scale), so JSON file storage is sufficient — no need for a real database.
- **Risk**: Divergence between mock contract and real API contract if not kept in sync manually (mitigated by keeping definitions simple and exportable/shareable, and by treating this strictly as a dev-time tool, not a contract-testing system).
- **Risk**: File-based storage could get corrupted with rapid concurrent writes; mitigate with simple per-file write serialization.

## 13. Future Enhancements (Out of Scope for v1)

- Editing scenario `match` conditions in the UI (currently JSON/import only) and richer operators beyond equality.
- Scripted/dynamic response logic (e.g., JS function per scenario) for advanced use cases.
- Shared/hosted mode for a team (multi-user, remote server) instead of purely local.
- OpenAPI/Swagger import to bulk-generate endpoints from an existing spec.
- Record & replay: capture real API responses and convert them into mock scenarios.
- Basic auth on the admin UI when running in shared mode.
