# API Mocker

A local tool that mocks your front-end APIs, so you can build and demo a UI without the real backend.

## Requirements

Node.js 18 or later (https://nodejs.org). Nothing else to install.

## Start

- **Windows:** double-click `start.bat`
- **Mac / Linux:** run `./start.sh` (run `chmod +x start.sh` once if needed)

Keep the window open while you use the app. Close it (or press `Ctrl+C`) to stop.

| What                           | URL                   |
| ------------------------------ | --------------------- |
| Admin UI (manage mocks)        | http://localhost:4001 |
| Mock API (your app calls this) | http://localhost:4000 |

## Load the mock APIs and data

1. Open http://localhost:4001 and go to **Import / Export**.
2. Pick **Merge** (add to what you have) or **Overwrite** (replace all endpoints).
3. Keep "Reset stored data of imported entities to the file's seed data" ticked to load the sample data.
4. Choose a file from the `configs/` folder, for example `rebate-management.json`.

You should now see the endpoints under **Endpoints** and the sample data under **Entities**.

## Point your app at the mock

Set your front end's API base URL to `http://localhost:4000` plus the API's path, then restart the app.
For the rebate app, add this to `.env.local` and restart `npm run dev`:

```
VITE_REBATE_API_BASE=http://localhost:4000/api/rms/crs/rebates
VITE_REBATE_BFF_API_BASE=http://localhost:4000/api/rms/crs/rebates-bff
VITE_BYPASS_AUTH=true
```

Do not add a trailing slash to the base URL. Without `VITE_REBATE_BFF_API_BASE`, the customer list, add and
delete calls go to the app's own dev server instead of the mock and fail.

## Try the edge cases

Open an endpoint and make a different scenario active to force an error (for example "Server Error").
Switch back to "Success" afterwards. Some requests trigger errors on their own; for the rebate config:

| Request                                     | Result                      |
| ------------------------------------------- | --------------------------- |
| Rebate `ERROR500`                           | 500                         |
| Rebate `GATEWAY504`                         | 504                         |
| Unknown rebate ID                           | 404                         |
| Rebate `PENDING01` / `HISTORY01`            | Pending / historical rebate |
| Add customer `99999` / `88888`              | 409 / 422                   |
| Edit customer with vendor `99999` / `88888` | 422 / 409                   |
| Delete customer `123457` (`TEST1234`)       | 409                         |
| Delete tier `386` (`TEST1234`)              | 409                         |
| Edit tier `387` / `388` (`TEST1234`)        | 409 / 422                   |
| Save a rebate named `FAIL`                  | 400                         |
| Add a note `FAIL`                           | 500                         |

To reset the sample data, use **Reseed** on an entity (Entities screen) or import the config again.

## Share your own setup

On **Import / Export**, click **Export config.json**. Tick "Use current stored data as seed data" to include
the data as it is now. Send the file to a teammate to import the same way.

## Notes

- Your data is saved in a `data/` folder next to `mocker.js`. To upgrade, replace everything except `data/`.
- To change ports, set `MOCK_PORT` and `ADMIN_PORT` before starting (or edit them under Settings and restart).
- If a port is already in use, close the other program or change the port as above.
