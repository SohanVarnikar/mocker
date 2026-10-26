# API Mocker

A local, developer-facing tool for mocking front-end APIs during development. Define
mock HTTP endpoints (GET/POST/PUT/PATCH/DELETE) with a Web UI, link them to simple
file-backed "entities" so writes persist and are reflected across endpoints (just like
a real backend), and simulate different success/error scenarios on demand — all without
needing the real backend to exist yet.

See [PRD.md](./PRD.md) for the full product requirements and [wireframes/](./wireframes)
for the static UI wireframes this app is modeled after.

## Project layout

```
mocker/
  server/       Express-based mock HTTP server + admin API (Node.js, JavaScript)
    src/
      mockServer.js     Dynamically serves mocked endpoints on port 4000
      adminServer.js    Admin REST API (+ serves the built admin UI in production)
      config.js         Loads/persists endpoint & entity definitions (data/config/*.json, seeds/*.json)
      store.js          Cached, file-backed entity "database" (data/store/*.json), paging/search, seed date tokens
      entityOperations.js  list/getById/create/update/delete against an entity, incl. scoping
      relations.js      Entity relations: expand/embed, reference validation, onDelete rules
      normalize.js      Normalizes endpoint/entity definitions on save and import
      templating.js     Renders response body templates (:id, {{request.body.x}}, {{result}}, ...)
    data/
      config/           Endpoint/entity/settings definitions (safe to version control)
        seeds/          Seed data per entity, one <entity>.json file each
      store/            Generated entity data files (the mock "database"; gitignored)
  configs/      Shareable mock configs (endpoints + entities + seed data) to import in the UI
  admin-ui/     Vue 3 + Vite single-page app for managing mocks (dark-mode only, minimalist)
  wireframes/   Static HTML/CSS wireframes used to design the admin UI
```

## Getting started

Requires Node.js 18+.

```bash
npm install       # installs dependencies for both workspaces
npm run dev       # runs the mock server, admin API, and Vue dev server together
```

- Mock server: http://localhost:4000 (this is what your front-end app calls)
- Admin UI (dev mode, hot reload): http://localhost:5173
- Admin API (used internally by the UI): http://localhost:4001

## Production / single-command run

```bash
npm start
```

This builds the Vue admin UI and starts the server, which serves the built UI and the
admin API together on port 4001, alongside the mock server on port 4000.

## Portable app (share without the source)

```bash
npm run package
```

Builds `dist-app/` and `api-mocker.zip` containing `mocker.js` (the whole server in one file), the
built admin UI (`ui/`), `configs/`, `start.bat` / `start.sh`, and a user `README.md` (source:
`scripts/package-readme.md`). Teammates only need Node.js 18+:

1. Unzip anywhere and run `start.bat` (Windows) or `./start.sh` (Mac/Linux).
2. Open http://localhost:4001 and import a file from `configs/` (Import / Export).

Their data is stored in a `data/` folder created next to `mocker.js`, so upgrading means replacing
everything except `data/`. Set `MOCKER_DATA_DIR` / `MOCKER_UI_DIR` to relocate the data or UI folder,
and `MOCK_PORT` / `ADMIN_PORT` to change ports.

## How it works

- **Endpoints** are defined with a method + path (supports `:param` segments), an
  optional description/tag, and one or more **response scenarios** (status code, delay,
  headers, JSON body template). Exactly one scenario is "active" at a time — switch it
  in the UI to simulate success, validation errors, 404s, 500s, etc.
- **Entities** are simple named data stores backed by a JSON file under
  `server/data/store/`. Link an endpoint's scenario to an entity + operation
  (`list`, `getById`, `create`, `update`, `delete`) so calls to that endpoint read/write
  the entity's file — this is what makes a `POST` create data that a later `GET`/`PUT`
  can see and modify.
- Response bodies support simple templating: `:id` (path params), `{{request.body.field}}`,
  `{{request.query.field}}`, `{{result}}` / `{{result.field}}` (the entity operation's
  result), `{{now}}`, and `{{uuid}}`.
- Entities can declare **relations** to other entities (see below) so responses can include
  related records and deletes can cascade, like a real database.
- All configuration lives in human-readable JSON under `server/data/config/` and can be
  exported/imported from the "Import / Export" screen to share a mock setup with a team.
  Entity definitions are in `entities.json`; each entity's seed data is in its own
  `seeds/<entity>.json` file so editing one entity never rewrites the others' data
  (older `entities.json` files with inline `seedData` are migrated automatically on start).

## Working with large datasets

- Entity records are cached in memory and indexed by id, so mock requests don't re-read the
  store file. Saves update the cache immediately, and bursts of saves are combined into a
  single atomic disk write. Editing a `data/store/*.json` file by hand is picked up automatically.
- The entity screen pages, searches and sorts records on the server, so it stays fast with
  100k+ records. Edit single records from the table instead of the Raw JSON tab, which asks
  before loading more than 2,000 records into the browser. For bulk edits, use **Export JSON**,
  edit the file in your editor, then **Import JSON**.
- **Save as Seed** makes the current records the entity's seed data (what **Reseed** and config
  export use).
- The admin API accepts request bodies (config imports, raw record saves) up to 200 MB.

## Entity relations

Declare relations on the entity that holds the reference (the "foreign key"), from the
entity's **Relations** tab or in config:

```jsonc
{
  "name": "notes",
  "relations": [
    {
      "field": "rebateId",     // field on notes that holds the referenced id
      "entity": "rebates",     // referenced entity (matched on its idField)
      "as": "rebate",          // name used when expanding (defaults to the field minus "Id")
      "onDelete": "cascade",   // none | cascade | setNull | restrict (default none)
      "validate": true         // reject creates/updates whose rebateId matches no rebate
    }
  ]
}
```

- **Expand** (many-to-one): `GET /notes?_expand=rebate` adds `note.rebate` with the full rebate.
- **Embed** (one-to-many): `GET /rebates/A1?_embed=notes` adds `rebate.notes` with its notes.
- Instead of query params, set **Expand** / **Embed** on the endpoint's entity link, so your
  front end gets the related data from its normal URLs (`entityLink.expand` / `entityLink.embed`).
- **onDelete** applies when a referenced record is deleted through a mock endpoint or the
  admin UI. `restrict` blocks the delete with a 409; `cascade` deletes children recursively;
  `setNull` clears the reference. Deletes report affected records under `related`.
- In the entity table, reference fields link to the referenced record, and ⤵ shows a record's children.

## Sharing configs and mock data

`configs/` holds shareable config files, each a single JSON file with `endpoints` and `entities`
(entities carry the mock data as `seedData`). Commit them so teammates get the same mocks.

### Import a config

1. Start the app (`npm run dev`) and open **Import / Export** in the admin UI.
2. Pick **Merge** (add/update, keep other endpoints) or **Overwrite** (replace all endpoints).
3. Leave "Reset stored data of imported entities to the file's seed data" ticked to load the
   file's mock data; untick it to keep your local data. Overwrite always resets it.
4. Choose or drop the file, e.g. `configs/rebate-management.json`. A banner shows progress, then
   how many endpoints/entities were added or updated and which entities were reseeded, or why
   the import failed (invalid JSON, not a config file, too large, ...). Nothing is written if
   the file fails validation.

The same can be done with `POST http://localhost:4001/api/config/import` and a body of
`{ "mode": "merge", "reseed": true, "endpoints": [...], "entities": [...] }`. It responds with
`{ mode, endpoints: { added, updated }, entities: { added, updated }, reseeded, totals }`.

### Share your own setup

Use **Export Configuration** and tick "Use current stored data as seed data" to share the dataset
as it is now; leave it unticked to export the original seed data. Endpoints without an `id` update
the existing endpoint with the same method + path, so re-importing never duplicates them.

### Config file reference

```jsonc
{
  "entities": [
    {
      "name": "notes",
      "idField": "id",
      "idParam": "noteId",
      "idStrategy": "increment", // or "uuid"
      "scope": { "rebateId": "rebateId" }, // record field -> path param
      "defaults": { "createdBy": "mock-user" }, // merged into records made by `create`
      "relations": [{ "field": "rebateId", "entity": "rebates", "onDelete": "cascade" }],
      "seedData": [
        { "id": 1, "rebateId": "A1", "note": "...", "date": "{{today+30d}}" },
      ],
    },
  ],
  "endpoints": [
    {
      "id": "ep-notes-list",
      "method": "GET",
      "path": "/api/rebates/:rebateId/notes",
      "entityLink": { "entityName": "notes", "operation": "list", "expand": ["rebate"] },
      "activeScenarioId": "sc-ok",
      "scenarios": [
        {
          "id": "sc-ok",
          "name": "Success",
          "statusCode": 200,
          "delayMs": 0,
          "headers": "Content-Type: application/json",
          "body": "{{result}}",
          "usesEntity": true,
        },
        {
          "id": "sc-fail",
          "name": "note FAIL -> 500",
          "statusCode": 500,
          "usesEntity": false,
          "match": { "request.body.note": "FAIL" },
          "body": "{ \"message\": \"boom\" }",
        },
      ],
    },
  ],
}
```

- **`seedData`** is the mock data. String values that are exactly `"{{today}}"`, `"{{today+30d}}"`,
  `"{{today-30d}}"` (YYYY-MM-DD) or `"{{now-1d}}"` (ISO timestamp) are resolved each time the
  entity is seeded, so date-based edge cases ("starts in the future") stay valid.
- **`scope`** makes nested routes like `/rebates/:rebateId/notes` list/modify only that parent's
  records, and `create` stamps the parent value on the new record.
- **`defaults`** (date tokens allowed) fill fields the request body doesn't send on `create`.
  `create` and `update` merge nested objects, so a body with `{ "trackingInfo": { "updatedBy": "x" } }`
  keeps the stored `trackingInfo.createdBy`. Arrays and other values are replaced.
- **`relations`** link records to other entities; see [Entity relations](#entity-relations).
  `entityLink.expand` / `entityLink.embed` include related records in that endpoint's result.
- **`entityLink.bodyTemplate`** (config only) reshapes the request body before the entity operation
  stores it. It uses the same tokens as response bodies, e.g.
  `"{ \"amount\": {{request.body.amount}}, \"trackingInfo\": { \"createdBy\": \"{{request.body.user}}\", \"createdAt\": \"{{now}}\" } }"`.
- **`entityLink.nested`** (config only) makes the operation work on the items of an array field inside a
  record, e.g. the `versions` of a tier. The record is found by the entity's `idParam` (and `scope`):

  ```jsonc
  "entityLink": {
    "entityName": "tiers",
    "operation": "create",              // list | getById | create | update | delete
    "nested": {
      "field": "versions",              // array field holding the items
      "idParam": "versionId",           // path param with the item id (getById/update/delete)
      "idField": "id",                  // default "id"; new ids are unique across all records
      "defaults": {},                   // fields for items made by `create`
      "deleteParentWhenEmpty": true,    // `delete` of the last item removes the whole record
      // `create` only: ends the item named by request.body.baseVersionId the day before the
      // new item's effectiveDate, or removes it when the new item starts on or before it.
      "supersede": { "idFrom": "baseVersionId", "startField": "effectiveDate", "endField": "endDate" }
    }
  }
  ```

  The admin UI keeps `nested` and `bodyTemplate` when you save the endpoint, but doesn't edit them yet.
- **`match`** on a scenario maps a dotted path (`request.body.*`, `request.query.*`, `params.*`) to an
  expected value. A scenario whose conditions all match wins over the active scenario, so edge
  cases trigger from the request itself. It is preserved on save but not yet editable in the UI.
- **Order matters**: endpoints match in definition order, so put fixed paths
  (`/rebates/program-types`) before parameterised ones (`/rebates/:rebateId`).

### Pointing a front end at the mock

Call `http://localhost:4000` directly (CORS is on by default). For a Vite app, put the base URL in
`.env.local` (not `.env.production`) and restart its dev server. Example for the rebate app:

```
VITE_REBATE_API_BASE=http://localhost:4000/api/rms/crs/rebates             # no trailing slash
VITE_REBATE_BFF_API_BASE=http://localhost:4000/api/rms/crs/rebates-bff     # customer list/add/delete
VITE_BYPASS_AUTH=true                                                      # skip the auth check
```

Without `VITE_REBATE_BFF_API_BASE` the rebate app sends the customer list, add and delete calls to
`/RebateManagement/rebates-bff/...` on its own dev server (proxied to `localhost:8080`), not to the mock.
Customer edit uses `VITE_REBATE_API_BASE` (`PUT .../rebates/{rebateId}/accounts/{accountId}`).

`configs/rebate-management.json` mocks the rebate UI's APIs. Rebate IDs to try: `TEST1234` (active),
`PENDING01` (pending, no notes/customers/tiers), `PENDING02` (pending, with customers and percentage tiers),
`HISTORY01` (historical, read-only), `EDGECASE1` (boundary values, starts and ends today), `NOEND01`
(active, no End Date, two open-ended tiers), `ERROR500` (500), `GATEWAY504` (504), any other ID (404).
Other triggers: add a customer `99999` (409) or `88888` (422); save a rebate named `FAIL` (400); add a
note `FAIL` (500); add a tier with percentage `77` (500).
For client-side pagination, `PAGE01`, `PAGE24`, `PAGE25`, `PAGE26`, `PAGE50`, `PAGE51`, `PAGE100` and
`PAGE101` each have that many customers and that many single-version tiers.

**Customers** (`TEST1234`, rebate runs today-90d to today+270d): the customer name says which case it
covers: future start (deletable), started / starts today (Effective Date locked, not deletable), starts
tomorrow, unknown type and inactive (warning rows), Check without a vendor, a 3-digit vendor, End before
Effective, Effective after the rebate end, End after the rebate end, and long values. `PENDING02` adds
customers that start before the rebate and one exactly on its bounds. Edit with vendor `99999` returns
422 (plain-string body) and `88888` returns 409; deleting customer `123457` returns 409.

**Tiers** hold a `versions` array (one table row per version, deliberately not sorted). `TEST1234`
uses rebate amounts and `PENDING02` rebate percentages, both increasing with the tier percentage:

| `TEST1234` tier | Versions                                                              | Cases                               |
| --------------- | --------------------------------------------------------------------- | ----------------------------------- |
| 2% (`1`)        | ended (today-90d) + current (today-30d)                               | trash disabled, past Effective Date |
| 5% (`2`, `383`) | one future version each, overlapping                                  | duplicate percentage, deletable     |
| 8% (`384`)      | starts today                                                          | trash disabled                      |
| 10% (`385`)     | current (ends today) + starts tomorrow                                | delete one version, tier remains    |
| 12% (`386`)     | future                                                                | delete returns 409                  |
| 15% (`387`)     | future                                                                | edit returns 409                    |
| 20% (`388`)     | current, decimal values                                               | edit returns 422                    |
| 25% (`389`)     | ended + current + future                                              | three versions                      |

`NOEND01` has 5% (`394`) and 10% (`395`) tiers, both starting today+10d with no End Date.

Add tier (`POST .../tiers`) stores the tier with one version built from the request body as sent
(the UI sends strings, so they come back as strings) and does no tier validation. Deleting a tier's
last version removes the tier; a `tierId` / `versionId` pair that doesn't match returns
404. Edit tier (`POST .../tiers/{tierId}/changes`) ends `baseVersionId` the day before the new
`effectiveDate` and adds the new version, created by `user`. When the new version starts on or before
the base version, it replaces the base version (backend behaviour for this case is still open).
`includeHistorical` is ignored: ended versions are always returned.

## Demo data

The repo ships with a small seeded example (a `products` CRUD flow, a `users` list, and
an `auth/login` endpoint) so you can try the app immediately. Reset your local mock data
at any time by deleting the files in `server/data/store/` (they'll be recreated from seed
data on next server start) or using **Reseed** / **Clear All** in the Entities screen.
