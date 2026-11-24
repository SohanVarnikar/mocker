import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const config = JSON.parse(await readFile(new URL("../../configs/rebate-management.json", import.meta.url), "utf8"));
const api = "/api/rms/crs/rebates";
const bff = "/api/rms/crs/rebates-bff";
const csvHeader = "Customer Number,Vendor Number,Payment Type,Effective Date,End Date\r\n";
const servers = [];
let dataDir, mockUrl, adminUrl, parseCsv, readEntityRecords, writeEntityRecords;

async function request(url, { status = 200, ...options } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), ...options });
  const text = await response.text();
  assert.equal(response.status, status, `${options.method || "GET"} ${url}: ${text.slice(0, 1000)}`);
  return {
    text,
    headers: response.headers,
    data: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : undefined,
  };
}

const get = (route) => request(mockUrl + route);
const json = (route, method, body, status = 200, base = mockUrl) =>
  request(base + route, {
    method, status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
const customers = async (id) => (await get(`${bff}/${id}/accounts`)).data;
const revert = (id, status = 204) =>
  request(`${mockUrl}${api}/${id}/account-uploads/revert-latest`, { method: "POST", status });

function upload(id, text, { user = "csv-user", filename = "accounts.csv", status = 201 } = {}) {
  const form = new FormData();
  if (text !== null) form.append("file", new Blob([text], { type: "text/csv" }), filename);
  if (user !== null) form.append("user", user);
  return request(`${mockUrl}${bff}/${id}/accounts/upload`, { method: "POST", body: form, status });
}

function assertCounts(response, created, ended, errors) {
  for (const [name, value] of Object.entries({ Created: created, Ended: ended, Error: errors })) {
    const header = `X-Account-Upload-${name}-Count`;
    assert.equal(response.headers.get(header), String(value));
    assert.ok(response.headers.get("access-control-expose-headers")?.includes(header));
  }
}

async function selectScenario(endpointId, scenarioId) {
  const endpoint = (await request(`${adminUrl}/api/endpoints/${endpointId}`)).data;
  await json(`/api/endpoints/${endpointId}`, "PUT", { ...endpoint, activeScenarioId: scenarioId }, 200, adminUrl);
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mocker-rebate-test-"));
  process.env.MOCKER_DATA_DIR = dataDir;
  const [{ createMockServer }, { createAdminServer }, csv, store] = await Promise.all([
    import("../src/mockServer.js"),
    import("../src/adminServer.js"),
    import("../src/csvOperations.js"),
    import("../src/store.js"),
  ]);
  ({ parseCsv } = csv);
  ({ readEntityRecords, writeEntityRecords } = store);
  for (const app of [createMockServer(), createAdminServer()]) {
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
  }
  [mockUrl, adminUrl] = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
    server.closeAllConnections();
  })));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await json("/api/config/import", "POST", { ...config, mode: "overwrite", reseed: true }, 200, adminUrl);
});

test("merging the updated config keeps the new config route reachable and existing routes intact", async () => {
  const previous = config.endpoints.filter((endpoint) => endpoint.id !== "ep-rebate-config");
  await json("/api/config/import", "POST", { endpoints: previous, mode: "overwrite" }, 200, adminUrl);
  const extra = {
    id: "unrelated", method: "GET", path: "/unrelated",
    scenarios: [{ id: "ok", body: '{"kept": true}' }],
  };
  await json("/api/endpoints", "POST", extra, 201, adminUrl);
  await json("/api/config/import", "POST", { ...config, mode: "merge", reseed: true }, 200, adminUrl);

  const enums = (await get(`${api}/config?SALE_TYPE=true&REBATE_AMOUNT_TYPE=true`)).data;
  assert.deepEqual(enums.saleTypes.map((option) => option.code), ["NET_SALES", "ELIGIBLE_SALES"]);
  assert.deepEqual(enums.rebateAmountTypes.map((option) => option.code), ["REBATE_AMOUNT", "REBATE_PERCENTAGE"]);
  assert.equal((await get(`${api}/TEST1234`)).data.id, "TEST1234");
  assert.deepEqual((await get("/unrelated")).data, { kept: true });
  const endpoints = (await request(`${adminUrl}/api/endpoints`)).data;
  assert.equal(new Set(endpoints.map((endpoint) => endpoint.id)).size, endpoints.length);
});

test("create returns a persisted rebate with mapped types and preserves literal user text", async () => {
  assert.deepEqual((await get(`${bff}/rebate-defaults`)).data, {
    rebatePastDueMax: 500, rebateCloseToTarget: 750,
  });
  const body = {
    name: "API integration rebate", effectiveDate: "2026-01-01",
    customerCategoryId: 10, programTypeId: 1, frequencyType: "Monthly",
    salesTargetType: "ELIGIBLE_SALES", rebateAmountType: "REBATE_PERCENTAGE",
    description: 'Literal :customer and {{request.body.name}} with "quotes"',
    status: "active", pastDueMax: 500, closeToTarget: 750, audit: { createdBy: "api-user" },
  };
  const { data: created } = await json(`${api}/`, "POST", body, 201);
  assert.ok(created.id);
  assert.equal(created.salesType, "eligible");
  assert.equal(created.valueType, "percent");
  assert.equal(created.description, body.description);
  assert.equal(created.endDate, null);
  assert.equal(created.pastDueMax, 500);
  assert.equal(created.shareable, false);
  assert.equal(created.trackingInfo.createdBy, "api-user");
  assert.equal(created.trackingInfo.updatedAt, null);
  assert.deepEqual((await get(`${api}/${created.id}`)).data, created);
  const persisted = JSON.parse(await readFile(path.join(dataDir, "store/rebates.json"), "utf8"));
  assert.deepEqual(persisted.find((rebate) => rebate.id === created.id), created);
  assert.deepEqual(await customers(created.id), {
    updatedByUploadToday: false, lastUploadUser: null, lastUploadTime: null, accounts: [],
  });
  const rejected = await json(`${api}`, "POST", { ...body, name: "FAIL" }, 400);
  assert.equal(rejected.data.message, "Rebate name is not allowed");
  assert.equal(readEntityRecords("rebates").length, persisted.length);
  await selectScenario("ep-rebate-defaults", "sc-empty");
  assert.equal((await get(`${bff}/rebate-defaults`)).text, "");
});

test("CSV exports reflect stored rows, quoting, dynamic tier columns and empty datasets", async () => {
  await json(`${api}/TEST1234/accounts/123445`, "PUT", { customerName: 'Parts, "West"\nDepot' });
  const accounts = (await customers("TEST1234")).accounts;
  const exported = await get(`${bff}/TEST1234/accounts/export`);
  assert.match(exported.headers.get("content-type"), /^text\/csv/);
  assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="rebate-TEST1234-accounts.csv"');
  assert.ok(exported.text.includes('"Parts, ""West""\nDepot"'));
  const rows = parseCsv(exported.text);
  assert.deepEqual(rows[0], [
    "Customer Number", "Customer Name", "Customer Type", "Inactive", "Group Code", "Vendor Number",
    "Payment Type", "Parent Portfolio", "Child or Generic Portfolio", "Effective Date", "End Date",
  ]);
  assert.deepEqual(rows.slice(1).map((row) => row[0]), [...accounts]
    .sort((a, b) => a.customerNumber - b.customerNumber).map((account) => String(account.customerNumber)));
  assert.equal(rows.length, accounts.length + 1);
  assert.equal(rows.find((row) => row[1] === 'Parts, "West"\nDepot')[3], "N");

  for (const [id, sales, value] of [
    ["TEST1234", "Net Sales", "Rebate Amount"],
    ["PENDING02", "Eligible Sales", "Rebate Percent"],
    ["HISTORY01", "Net Sales", "Rebate Percent"],
  ]) {
    const tiers = (await get(`${api}/${id}/tiers?includeHistorical=${id === "HISTORY01"}`)).data;
    const csv = parseCsv((await get(`${bff}/${id}/tiers/export`)).text);
    assert.deepEqual(csv[0], ["Tier Percentage", sales, value, "Effective Date", "End Date", "Created By", "Edited By"]);
    const versions = tiers.flatMap((tier) => tier.versions.map((version) => ({ percentage: tier.percentage, ...version })))
      .sort((a, b) => a.percentage - b.percentage || a.effectiveDate.localeCompare(b.effectiveDate));
    assert.deepEqual(csv.slice(1), versions.map((version) => [
      version.percentage, version.salesAmount, value === "Rebate Amount" ? version.rebateAmount : version.rebatePercent,
      version.effectiveDate, version.endDate, version.trackingInfo.createdBy, version.trackingInfo.updatedBy,
    ].map((item) => item == null ? "" : String(item))));
  }
  for (const entity of ["accounts", "tiers"]) {
    const empty = await get(`${bff}/PENDING01/${entity}/export`);
    assert.equal(empty.text, "");
    assert.equal(empty.headers.get("content-type"), null);
  }
  const pending = (await get(`${api}/PENDING01`)).data;
  for (const percentage of ["10", "2.5", "2.05", "2"]) {
    await json(`${api}/PENDING01/tiers`, "POST", {
      percentage, salesAmount: "10000", rebateAmount: "100", rebatePercent: null,
      effectiveDate: pending.effectiveDate, endDate: pending.endDate, user: "tester",
    }, 201);
  }
  const createdTiers = parseCsv((await get(`${bff}/PENDING01/tiers/export`)).text);
  assert.deepEqual(createdTiers.slice(1).map((row) => row[0]), ["2", "2.05", "2.5", "10"]);
});

test("mixed uploads persist valid changes, report rejected rows, and revert in reverse order", async () => {
  const original = await customers("UPLOAD01");
  const otherRebate = await customers("UPLOAD02");
  const { effectiveDate, endDate } = (await get(`${api}/UPLOAD01`)).data;
  const result = await upload("UPLOAD01", csvHeader + [
    `70001,12345,CHECK,${effectiveDate},`,
    `61001,,,,${endDate}`,
    `88888,,credit,${effectiveDate},`,
    `77777,,credit,${effectiveDate},`,
    `70003,,check,${effectiveDate},`,
    `70004,,credit,${effectiveDate},`,
    `70004,,credit,invalid,`,
  ].join("\r\n"));
  assertCounts(result, 1, 1, 5);
  assert.match(result.headers.get("content-type"), /^text\/csv/);
  const errors = parseCsv(result.text);
  assert.deepEqual(errors[0], [
    "Line", "Customer Number", "Vendor Number", "Payment Type", "Effective Date", "End Date", "Field", "Error Message",
  ]);
  assert.deepEqual(errors.slice(1).map((row) => row[0]), ["4", "5", "6", "7", "8"]);
  assert.match(errors.find((row) => row[0] === "7")[7], /lines 7, 8/);
  const changed = await customers("UPLOAD01");
  assert.equal(changed.updatedByUploadToday, true);
  assert.equal(changed.lastUploadUser, "csv-user");
  assert.match(changed.lastUploadTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.equal(changed.accounts.length, original.accounts.length + 1);
  assert.equal(changed.accounts.find((account) => account.customerNumber === 61001).endDate, endDate);
  const added = changed.accounts.find((account) => account.customerNumber === 70001);
  assert.equal(added.paymentType, "check");
  assert.equal(added.loadUser, "csv-user");
  assert.equal(added.trackingInfo.createdBy, "csv-user");
  const disk = JSON.parse(await readFile(path.join(dataDir, "store/accounts.json"), "utf8"));
  assert.deepEqual(disk.filter((account) => account.rebateId === "UPLOAD01"), changed.accounts);
  const history = JSON.parse(await readFile(path.join(dataDir, "store/account-uploads.json"), "utf8"));
  assert.deepEqual(history.at(-1).created, [added.id]);

  const [year, month, day] = effectiveDate.split("-");
  const success = await upload("UPLOAD01",
    `\uFEFFcustomer number,vendor number,payment type,effective date,end date\r\n70002,,credit,${month}/${day}/${year},`,
    { user: "second-user" });
  assertCounts(success, 1, 0, 0);
  assert.equal(success.text, "");
  assert.equal(success.headers.get("content-type"), null);
  assert.equal((await customers("UPLOAD01")).lastUploadUser, "second-user");
  assert.equal((await revert("UPLOAD01")).text, "");
  assert.deepEqual(await customers("UPLOAD01"), changed);
  await revert("UPLOAD01");
  assert.deepEqual(await customers("UPLOAD01"), original);
  assert.deepEqual(await customers("UPLOAD02"), otherRebate);
  await selectScenario("ep-accounts-list", "sc-array");
  assert.deepEqual((await get(`${bff}/UPLOAD01/accounts`)).data, original.accounts);
});

test("upload validation rejects invalid files without changing data", async () => {
  const original = await customers("UPLOAD01");
  const effectiveDate = (await get(`${api}/UPLOAD01`)).data.effectiveDate;
  const valid = csvHeader + `70001,,credit,${effectiveDate},`;
  for (const [text, options, status, message] of [
    [valid, { user: null }, 400, /user is required/],
    [valid, { user: " " }, 400, /user is required/],
    [null, {}, 400, /select a .csv file/],
    ["", {}, 400, /select a .csv file/],
    [csvHeader, {}, 400, /does not contain any rows/],
    ["Customer Number\r\n70001", {}, 400, /missing the required column/],
    [csvHeader.trim() + ",Customer Number\r\n70001", {}, 400, /more than one 'Customer Number'/],
    [csvHeader + '"unterminated', {}, 400, /not a valid CSV/],
    [valid, { filename: "accounts.txt" }, 415, /must be of .csv format/],
  ]) {
    const result = await upload("UPLOAD01", text, { ...options, status });
    assert.match(result.data.message, message);
    assert.ok(Array.isArray(result.data.errors));
  }
  assert.deepEqual(await customers("UPLOAD01"), original);
});

test("upload enforces the exact 10 MB and 10,000 row boundaries", async () => {
  const date = (await get(`${api}/UPLOAD01`)).data.effectiveDate;
  const valid = csvHeader + `70001,,credit,${date},\r\n`;
  const maxBytes = 10 * 1024 * 1024;
  const atLimit = valid + " ".repeat(maxBytes - Buffer.byteLength(valid));
  assert.equal(Buffer.byteLength(atLimit), maxBytes);
  const accepted = await upload("UPLOAD01", atLimit);
  assertCounts(accepted, 1, 0, 0);
  const tooLarge = await upload("UPLOAD01", atLimit + " ", { status: 413 });
  assert.match(tooLarge.data.message, /maximum of 10 MB/);

  const rows = Array.from({ length: 10000 }, (_, i) => `${800000 + i},,credit,${date},\r\n`).join("");
  const acceptedRows = await upload("UPLOAD01", csvHeader + rows);
  assertCounts(acceptedRows, 10000, 0, 0);
  const count = (await customers("UPLOAD01")).accounts.length;
  const tooMany = await upload("UPLOAD01", csvHeader + rows + `900000,,credit,${date},`, { status: 413 });
  assert.match(tooMany.data.message, /maximum of 10000 rows/);
  assert.equal((await customers("UPLOAD01")).accounts.length, count);
});

test("seeded upload states cover successful revert, no upload today, and failure", async () => {
  const accounts = readEntityRecords("accounts");
  assert.equal(new Set(accounts.map((account) => account.id)).size, accounts.length);
  for (const batch of readEntityRecords("account-uploads")) {
    for (const id of [...batch.created, ...batch.updated.map((item) => item.id)]) {
      assert.ok(accounts.some((account) => account.id === id && account.rebateId === batch.rebateId));
    }
  }
  const today = await customers("UPLOAD01");
  assert.equal(today.updatedByUploadToday, true);
  assert.equal(today.lastUploadUser, "jdoe");
  await revert("UPLOAD01");
  const reverted = await customers("UPLOAD01");
  assert.equal(reverted.updatedByUploadToday, false);
  assert.equal(reverted.lastUploadTime, null);
  assert.deepEqual(reverted.accounts.map((account) => account.customerNumber), [61001, 61002]);
  assert.equal(reverted.accounts[1].endDate, null);
  assert.equal(reverted.accounts[1].trackingInfo.updatedBy, null);
  assert.match((await revert("UPLOAD01", 404)).data.message, /No upload from today found/);
  assert.equal((await customers("UPLOAD02")).updatedByUploadToday, false);
  await revert("UPLOAD02", 404);
  const failing = await customers("UPLOAD03");
  assert.equal(failing.updatedByUploadToday, true);
  await revert("UPLOAD03", 500);
  assert.deepEqual(await customers("UPLOAD03"), failing);
});

test("latest upload uses insertion order for equal timestamps and the Chicago calendar day", async () => {
  const now = new Date();
  const first = { id: 100, rebateId: "PENDING01", uploadedAt: now.toISOString(), user: "first", created: [], updated: [] };
  const second = { ...first, id: 101, user: "second" };
  await writeEntityRecords("account-uploads", [first, second]);
  assert.equal((await customers("PENDING01")).lastUploadUser, "second");
  await revert("PENDING01");
  assert.equal((await customers("PENDING01")).lastUploadUser, "first");
  const localTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(now).replace(" ", "T");
  assert.equal((await customers("PENDING01")).lastUploadTime, localTime);
  const previousDay = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  await writeEntityRecords("account-uploads", [{ ...first, uploadedAt: previousDay.toISOString() }]);
  assert.equal((await customers("PENDING01")).updatedByUploadToday, false);
  await revert("PENDING01", 404);
});

test("multipart framing preserves boundary-like file text and rejects truncated requests", async () => {
  const boundary = "mocker-test-boundary";
  const date = (await get(`${api}/UPLOAD01`)).data.effectiveDate;
  const content = csvHeader.trim() + `,Extra\r\n70001,,credit,${date},,text--${boundary}-not-a-delimiter\r\n` +
    `70002,,credit,${date},,\r\n`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="user"\r\n\r\ncsv-user\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="accounts.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  const url = `${mockUrl}${bff}/UPLOAD01/accounts/upload`;
  const headers = { "Content-Type": `multipart/form-data; boundary="${boundary}"` };
  assertCounts(await request(url, { method: "POST", body, headers, status: 201 }), 2, 0, 0);
  const original = await customers("UPLOAD01");
  await request(url, { method: "POST", body: body.slice(0, -6), headers, status: 400 });
  assert.deepEqual(await customers("UPLOAD01"), original);
});

test("existing JSON CRUD, tier versions and both customer delete routes still work", async () => {
  assert.equal((await get("/RebateManagement/teamnet/checkAuthentication")).data, true);
  for (const lookup of ["program-types", "customer-categories", "frequency-types"]) {
    assert.ok((await get(`${api}/${lookup}`)).data.length);
  }
  assert.ok(Array.isArray((await get(`${bff}/TEST1234/group-codes`)).data));
  await request(`${mockUrl}${api}/ERROR500`, { status: 500 });
  await request(`${mockUrl}${api}/GATEWAY504`, { status: 504 });
  const rebate = (await get(`${api}/TEST1234`)).data;
  assert.equal((await json(`${api}/TEST1234`, "PUT", { ...rebate, closeToTarget: 123 })).data.closeToTarget, 123);
  await json(`${api}/TEST1234/invoice-item-flags`, "PATCH", { priceMods: !rebate.priceMods });
  assert.equal((await get(`${api}/TEST1234`)).data.priceMods, !rebate.priceMods);
  const note = (await json(`${api}/TEST1234/notes`, "POST", { note: "Integration note", createdBy: "tester" }, 201)).data;
  await json(`${api}/TEST1234/notes/${note.id}`, "PUT", { note: "Edited note", updatedBy: "editor" });
  assert.ok((await get(`${api}/TEST1234/notes`)).data.some((item) => item.note === "Edited note"));
  for (const base of [api, bff]) {
    const added = (await json(`${bff}/TEST1234/accounts`, "POST", {
      customerNumber: 70001, paymentType: "credit", effectiveDate: rebate.endDate,
      trackingInfo: { createdBy: "tester" },
    }, 201)).data;
    await json(`${api}/TEST1234/accounts/${added.id}`, "PUT", { endDate: null, trackingInfo: { updatedBy: "editor" } });
    await request(`${mockUrl}${base}/TEST1234/accounts/${added.id}?user=tester`, { method: "DELETE" });
    assert.ok(!(await customers("TEST1234")).accounts.some((account) => account.id === added.id));
  }
  const tier = (await json(`${api}/TEST1234/tiers`, "POST", {
    percentage: "33", salesAmount: "10000", rebateAmount: "100", rebatePercent: null,
    effectiveDate: rebate.effectiveDate, endDate: rebate.endDate, user: "tester",
  }, 201)).data;
  const changed = (await json(`${api}/TEST1234/tiers/${tier.id}/changes`, "POST", {
    baseVersionId: tier.versions[0].id, salesAmount: 12000, rebateAmount: 150, rebatePercent: null,
    effectiveDate: rebate.endDate, endDate: rebate.endDate, user: "editor",
  }, 201)).data;
  const stored = (await get(`${api}/TEST1234/tiers?includeHistorical=false`)).data.find((item) => item.id === tier.id);
  assert.equal(stored.versions.length, 2);
  assert.equal(stored.versions[1].id, changed.id);
  await request(`${mockUrl}${api}/TEST1234/tiers/${tier.id}/versions/${changed.id}?user=tester`, { method: "DELETE" });
  assert.equal((await get(`${api}/TEST1234/tiers`)).data.find((item) => item.id === tier.id).versions.length, 1);
  const pending = (await get(`${api}/ENDALL11`)).data;
  await json(`${api}/ENDALL11/tiers/endAll`, "POST", { endDate: pending.effectiveDate, user: "tester" });
  assert.deepEqual((await get(`${api}/ENDALL11/tiers`)).data, []);
});

test("exclusion lists return each rebate's seeded rows and the BFF route mirrors the rebate route", async () => {
  const query = "exclusions?includeHistorical=false";
  const exclusions = (await get(`${api}/TEST1234/${query}`)).data;
  assert.ok(exclusions.length > 10);
  assert.ok(exclusions.every((row) => row.rebateId === "TEST1234" && Array.isArray(row.categoryDetails)));
  assert.deepEqual((await get(`${bff}/TEST1234/${query}`)).data, exclusions);
  const customerExclusions = (await get(`${api}/TEST1234/customer-exclusions`)).data;
  assert.ok(customerExclusions.length > 10);
  assert.ok(customerExclusions.every((row) => row.customerNumber && row.customerName));
  const today = new Date().toISOString().slice(0, 10);
  for (const route of ["exclusions", "customer-exclusions"]) {
    assert.deepEqual((await get(`${api}/PENDING01/${route}`)).data, []);
    assert.ok((await get(`${api}/HISTORY01/${route}`)).data.some((row) => row.endDate && row.endDate < today));
  }
  await selectScenario("ep-exclusions-list", "sc-not-found");
  await request(`${mockUrl}${api}/TEST1234/${query}`, { status: 404 });
});
