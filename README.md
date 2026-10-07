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
      config.js         Loads/persists endpoint & entity definitions (data/config/*.json)
      store.js          File-backed entity "database" (data/store/*.json), scoping, seed date tokens
      normalize.js      Normalizes endpoint/entity definitions on save and import
      templating.js     Renders response body templates (:id, {{request.body.x}}, {{result}}, ...)
    data/
      config/           Endpoint/entity/settings definitions (safe to version control)
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
- All configuration lives in human-readable JSON under `server/data/config/` and can be
  exported/imported from the "Import / Export" screen to share a mock setup with a team.

## Sharing configs and mock data

`configs/` holds shareable config files, each a single JSON file with `endpoints` and `entities`
(entities carry the mock data as `seedData`). Commit them so teammates get the same mocks.

### Import a config

1. Start the app (`npm run dev`) and open **Import / Export** in the admin UI.
2. Pick **Merge** (add/update, keep other endpoints) or **Overwrite** (replace all endpoints).
3. Leave "Reset stored data of imported entities to the file's seed data" ticked to load the
   file's mock data; untick it to keep your local data. Overwrite always resets it.
4. Choose the file, e.g. `configs/rebate-management.json`.

The same can be done with `POST http://localhost:4001/api/config/import` and a body of
`{ "mode": "merge", "reseed": true, "endpoints": [...], "entities": [...] }`.

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
      "entityLink": { "entityName": "notes", "operation": "list" },
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
- **`match`** on a scenario maps a dotted path (`request.body.*`, `request.query.*`, `params.*`) to an
  expected value. A scenario whose conditions all match wins over the active scenario, so edge
  cases trigger from the request itself. It is preserved on save but not yet editable in the UI.
- **Order matters**: endpoints match in definition order, so put fixed paths
  (`/rebates/program-types`) before parameterised ones (`/rebates/:rebateId`).

### Pointing a front end at the mock

Call `http://localhost:4000` directly (CORS is on by default). For a Vite app, put the base URL in
`.env.local` (not `.env.production`) and restart its dev server. Example for the rebate app:

```
VITE_REBATE_API_BASE=http://localhost:4000/api/rms/crs/rebates   # no trailing slash
VITE_BYPASS_AUTH=true                                            # skip the auth check
```

`configs/rebate-management.json` mocks the rebate UI's APIs. Rebate IDs to try: `TEST1234` (active),
`PENDING01` (pending, no notes/customers), `HISTORY01` (historical, read-only), `EDGECASE1`
(boundary values), `ERROR500` (500), `GATEWAY504` (504), any other ID (404). Other triggers: add a
customer `99999` (409) or `88888` (422); save a rebate named `FAIL` (400); add a note `FAIL` (500).

## Demo data

The repo ships with a small seeded example (a `products` CRUD flow, a `users` list, and
an `auth/login` endpoint) so you can try the app immediately. Reset your local mock data
at any time by deleting the files in `server/data/store/` (they'll be recreated from seed
data on next server start) or using **Reseed** / **Clear All** in the Entities screen.
