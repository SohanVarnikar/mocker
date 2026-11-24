import { readEntityRecords, writeEntityRecords, nextEntityId, resolveSeedTokens } from "./store.js";
import { deleteRecords } from "./relations.js";
import { configStore } from "./config.js";
import { httpError } from "./asyncRouter.js";
import { inScope, scopeValues, dateOnly, mergeDeep } from "./entityOperations.js";

const STATUS_NAMES = {
  400: "BAD_REQUEST",
  404: "NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
};
const DATE_HINT = "YYYY-MM-DD or MM/DD/YYYY";

/** A file-level upload error with a body like the BFF's EpsApiError: { status, message, errors }. */
function uploadError(status, messages) {
  const errors = [].concat(messages);
  const message = errors.join(" ");
  return Object.assign(httpError(status, message), {
    body: { status: STATUS_NAMES[status] || String(status), message, errors },
  });
}

function getPath(obj, dotted) {
  let cur = obj;
  for (const seg of String(dotted).split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Returns a copy of `obj` with the dotted path set, copying the objects along the path. */
function setPath(obj, dotted, value) {
  const segments = dotted.split(".");
  const out = { ...obj };
  let cur = out;
  for (const seg of segments.slice(0, -1)) {
    cur[seg] = cur[seg] && typeof cur[seg] === "object" ? { ...cur[seg] } : {};
    cur = cur[seg];
  }
  cur[segments[segments.length - 1]] = value;
  return out;
}

const conditionsHold = (conditions, ctx) =>
  Object.entries(conditions).every(([dotted, expected]) => {
    const actual = getPath(ctx, dotted);
    return actual != null && String(actual) === String(expected);
  });

function compareNullsLast(a, b) {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Calendar date and wall-clock time of `date` in an IANA time zone (default UTC). */
function zonedDateTime(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function findLinkedRecord(link, params) {
  const idField = link.idField || "id";
  const id = params[link.idParam];
  const record = readEntityRecords(link.entity).find((r) => String(r?.[idField]) === String(id));
  if (!record) throw httpError(404, `${link.entity} with ${idField} ${id} was not found`);
  return record;
}

// ---------------------------------------------------------------------------------------------
// CSV text

/** Parses RFC 4180 CSV into records of raw (untrimmed) values; throws on malformed quoting. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let afterQuotes = false;
  let pending = false;
  const endField = () => {
    record.push(field);
    field = "";
    afterQuotes = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    pending = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
        afterQuotes = true;
      }
      continue;
    }
    if (c === ",") {
      endField();
      pending = true;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      pending = true;
      if (afterQuotes) {
        if (c !== " " && c !== "\t") throw new Error(`Invalid character after a quoted value in record ${records.length + 1}`);
      } else if (c === '"' && field.trim() === "") {
        inQuotes = true;
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (inQuotes) throw new Error("The text ends inside a quoted value");
  if (pending) endRecord();
  return records;
}

function csvValue(value) {
  if (value == null) return "";
  const text = String(value);
  if (!text) return "";
  const quote =
    /[",\r\n]/.test(text) || text.charCodeAt(0) <= 0x23 || text.charCodeAt(text.length - 1) <= 0x20;
  return quote ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Formats rows (arrays of values) as CSV with CRLF line endings, like Apache Commons CSV. */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvValue).join(",")).join("\r\n") + "\r\n";
}

function formatValue(value, format) {
  if (format === "yesno") return value === true ? "Y" : value === false ? "N" : "";
  return value;
}

// ---------------------------------------------------------------------------------------------
// export

/**
 * `export`: the records in scope as CSV text (an empty string when there are none, like the BFF).
 * Configured by `entityLink.export`:
 *   columns   [{ header, field, format?: "yesno", when?, unless? }]; `when` / `unless` map dotted
 *             paths (e.g. "parent.valueType") to a value and keep / drop the column when all match
 *   each      array field: one row per item, with the item's fields over the record's
 *   sortBy    field or fields to sort the rows by (empty values last)
 *   parent    { entity, idParam, idField? }: record available to when / unless as `parent`;
 *             404 when it does not exist
 */
export function performExport(entity, config, params, scope) {
  if (!Array.isArray(config?.columns) || !config.columns.length) {
    throw httpError(500, 'The "export" operation needs entityLink.export with "columns"');
  }
  const parent = config.parent ? findLinkedRecord(config.parent, params) : null;
  const records = readEntityRecords(entity.name).filter((r) => inScope(r, scope));
  const rows = config.each
    ? records.flatMap((r) => (Array.isArray(r[config.each]) ? r[config.each] : []).map((item) => ({ ...r, ...item })))
    : [...records];
  if (!rows.length) return "";

  const sortBy = [].concat(config.sortBy || []);
  rows.sort((a, b) => {
    for (const field of sortBy) {
      const diff = compareNullsLast(getPath(a, field), getPath(b, field));
      if (diff) return diff;
    }
    return 0;
  });
  const ctx = { parent };
  const columns = config.columns.filter(
    (c) => (!c.when || conditionsHold(c.when, ctx)) && !(c.unless && conditionsHold(c.unless, ctx)),
  );
  return toCsv([
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => formatValue(getPath(row, c.field), c.format))),
  ]);
}

// ---------------------------------------------------------------------------------------------
// import

function formatSize(bytes) {
  const mb = 1024 * 1024;
  return bytes >= mb ? `${Math.floor(bytes / mb)} MB` : `${Math.max(1, Math.floor(bytes / 1024))} KB`;
}

/** Strict YYYY-MM-DD or M/D/YYYY -> YYYY-MM-DD, else null. */
function parseDate(text) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  let y, mo, d;
  if (m) [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) [mo, d, y] = [m[1], m[2], m[3]].map(Number);
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

// Header names match ignoring case and anything but letters and digits; extra columns are ignored.
function resolveColumns(header, columns) {
  const key = (text) => String(text).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const byKey = new Map(columns.map((c) => [key(c.header), c]));
  const found = new Map();
  header.forEach((name, index) => {
    const col = byKey.get(key(name));
    if (col) found.set(col, [...(found.get(col) || []), index]);
  });
  const problems = [...found]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([col]) => `The file has more than one '${col.header}' column`);
  const missing = columns.filter((c) => !found.has(c)).map((c) => c.header);
  if (missing.length) {
    problems.push(`The file is missing the required column(s): ${missing.join(", ")}. Please use the upload template.`);
  }
  if (problems.length) throw uploadError(400, problems);
  return new Map([...found].map(([col, indexes]) => [col.field, indexes[0]]));
}

function parseRow(row, columns) {
  const values = {};
  const errors = [];
  const fail = (col, message) => {
    errors.push(rowError(row, col.header, message));
    values[col.field] = null;
  };
  for (const col of columns) {
    const text = row.raw[col.field];
    values[col.field] = null;
    if (text == null) {
      if (col.required) fail(col, `${col.header} is required`);
    } else if (col.type === "integer") {
      if (!/^\d{1,18}$/.test(text) || (col.positive && Number(text) === 0)) {
        fail(col, `${col.header} must be a ${col.positive ? "positive " : ""}whole number`);
      } else if (col.maxDigits && Number(text) >= 10 ** col.maxDigits) {
        fail(col, `${col.header} must be at most ${col.maxDigits} digits`);
      } else {
        values[col.field] = Number(text);
      }
    } else if (col.type === "date") {
      const date = parseDate(text);
      if (!date) fail(col, `${col.header} must be a valid date in ${DATE_HINT} format`);
      else values[col.field] = date;
    } else {
      values[col.field] = col.lowercase ? text.toLowerCase() : text;
    }
  }
  return { values, errors };
}

const rowError = (row, field, message) => ({ line: row.line, raw: row.raw, field, message });

const listValues = (values) => {
  const quoted = values.map((v) => `'${v}'`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}` : quoted[0];
};

// Like the BFF, values starting with a formula character are prefixed with ' in the error file.
const escapeFormula = (value) => (value != null && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

function importResult(createdCount, endedCount, errors, columns) {
  const sorted = [...errors].sort((a, b) => a.line - b.line);
  return {
    createdCount,
    endedCount,
    errorCount: new Set(errors.map((e) => e.line)).size,
    errors: sorted.map(({ line, field, message }) => ({ line, field, message })),
    errorCsv: sorted.length
      ? toCsv([
          ["Line", ...columns.map((c) => c.header), "Field", "Error Message"],
          ...sorted.map((e) => [
            e.line,
            ...columns.map((c) => escapeFormula(e.raw[c.field])),
            escapeFormula(e.field),
            escapeFormula(e.message),
          ]),
        ])
      : "",
  };
}

const compareIds = (a, b) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

/**
 * `import`: applies an uploaded CSV file (multipart part) to the records in scope, mimicking the
 * rebate BFF's customer upload. Each row either creates a record or, when an active record (no end
 * date, or ending today or later) with the same key exists, sets that record's end date. Rows with
 * errors are skipped and reported; the rest are applied. Configured by `entityLink.import`:
 *   columns          [{ header, field, type?: "integer" | "date", required?, positive?, maxDigits?,
 *                    lowercase?, requiredOnCreate?, values?, minDigits?, requiredWhen? }]
 *                    (requiredOnCreate / values / minDigits / requiredWhen apply to new records only)
 *   keyField         field matching a row to an existing record; duplicate keys reject every line
 *   startField / endField   record date fields (default "effectiveDate" / "endDate")
 *   bounds           { entity, idParam, label, startField?, endField? }: new records must lie within
 *                    the dates of this record, end dates must not pass its end date
 *   reject           { keyValue: message }: rows creating a record with this key are rejected
 *   userFields       { create: [paths], update: [paths] } set to the uploading user
 *   fileField / userField   multipart parts (default "file" / "user")
 *   maxBytes / maxRows      file limits; recordLabel names a record in messages; timeZone for "today"
 * With entityLink.batches each import that changed something is recorded for `revertLatest`.
 * File-level problems throw 400 / 413 / 415 with an EpsApiError-like body. Returns
 * { createdCount, endedCount, errorCount, errors, errorCsv } (errorCsv is "" without errors).
 */
export async function performImport(entity, config, params, body, files, scope, batches) {
  const columns = Array.isArray(config?.columns) ? config.columns : [];
  const keyField = config?.keyField;
  const keyCol = columns.find((c) => c.field === keyField);
  if (!keyCol) {
    throw httpError(500, 'The "import" operation needs entityLink.import with "columns" and a "keyField" among them');
  }
  const fileField = config.fileField || "file";
  const userField = config.userField || "user";
  const fields = body && typeof body === "object" ? body : {};
  const file = files?.[fileField];

  if (fields[userField] === undefined) throw uploadError(400, `${userField} is required`);
  if (!file || !file.size) throw uploadError(400, "Please select a .csv file to upload");
  const fileProblems = [];
  let fileStatus;
  if (!/\.csv$/i.test(String(file.filename || "").trim())) {
    fileProblems.push("The file must be of .csv format");
    fileStatus = 415;
  }
  if (config.maxBytes && file.size > config.maxBytes) {
    fileProblems.push(`The file is larger than the maximum of ${formatSize(config.maxBytes)}`);
    fileStatus ??= 413;
  }
  if (fileProblems.length) throw uploadError(fileStatus, fileProblems);
  const user = String(fields[userField]).trim();
  if (!user) throw uploadError(400, `${userField} is required`);

  let records;
  try {
    records = parseCsv(file.text.replace(/^\uFEFF/, ""));
  } catch {
    throw uploadError(400, "The file is not a valid CSV file");
  }
  if (!records.length) throw uploadError(400, "The file is empty");
  const indexes = resolveColumns(records[0], columns);
  const rows = [];
  records.slice(1).forEach((record, i) => {
    if (record.every((v) => !v.trim())) return;
    const raw = {};
    for (const col of columns) raw[col.field] = (record[indexes.get(col.field)] ?? "").trim() || null;
    // CSV record number: the header is line 1
    rows.push({ line: i + 2, raw });
  });
  if (!rows.length) throw uploadError(400, "The file does not contain any rows");
  if (config.maxRows && rows.length > config.maxRows) {
    throw uploadError(413, `The file has more than the maximum of ${config.maxRows} rows`);
  }

  const errors = [];
  for (const row of rows) {
    const parsed = parseRow(row, columns);
    row.values = parsed.values;
    row.valid = !parsed.errors.length;
    errors.push(...parsed.errors);
  }

  // Every line of a key that appears more than once is rejected, even if another line has errors.
  const linesByKey = new Map();
  for (const row of rows) {
    const key = row.values[keyField];
    if (key != null) linesByKey.set(String(key), [...(linesByKey.get(String(key)) || []), row.line]);
  }
  const uniqueRows = [];
  for (const row of rows.filter((r) => r.valid)) {
    const lines = linesByKey.get(String(row.values[keyField])) || [];
    if (lines.length > 1) {
      errors.push(rowError(row, keyCol.header, `${keyCol.header} appears more than once in the file (lines ${lines.join(", ")})`));
    } else {
      uniqueRows.push(row);
    }
  }
  if (!uniqueRows.length) return importResult(0, 0, errors, columns);

  const startField = config.startField || "effectiveDate";
  const endField = config.endField || "endDate";
  const labelOf = (field) => columns.find((c) => c.field === field)?.header || field;
  const startLabel = labelOf(startField);
  const endLabel = labelOf(endField);
  const recordLabel = config.recordLabel || entity.name;
  const idField = entity.idField || "id";
  const timeZone = config.timeZone || batches?.timeZone;
  const today = zonedDateTime(new Date(), timeZone).date;

  const bounds = config.bounds;
  const parent = bounds ? findLinkedRecord(bounds, params) : null;
  const parentLabel = bounds?.label || bounds?.entity;
  const parentStart = parent ? dateOnly(parent[bounds.startField || "effectiveDate"]) : null;
  const parentEnd = parent ? dateOnly(parent[bounds.endField || "endDate"]) : null;

  const active = new Map();
  for (const record of readEntityRecords(entity.name)) {
    if (!inScope(record, scope) || record[keyField] == null) continue;
    const end = dateOnly(record[endField]);
    if (end && end < today) continue;
    const key = String(record[keyField]);
    const previous = active.get(key);
    if (!previous || compareIds(record[idField], previous[idField]) > 0) active.set(key, record);
  }

  const validateExisting = (row, existing) => {
    const out = [];
    const end = row.values[endField];
    const existingStart = dateOnly(existing[startField]);
    if (end == null) {
      out.push(rowError(row, endLabel, `${endLabel} is required to end an existing ${recordLabel}`));
    } else if (existingStart && end < existingStart) {
      out.push(rowError(row, endLabel, `${endLabel} cannot be before the ${recordLabel}'s ${startLabel} of ${existingStart}`));
    } else if (parentEnd && end > parentEnd) {
      out.push(rowError(row, endLabel, `${endLabel} cannot be after the ${parentLabel}'s ${endLabel} of ${parentEnd}`));
    }
    for (const col of columns) {
      const value = row.values[col.field];
      if (col.field === keyField || col.field === endField || value == null) continue;
      const current = existing[col.field];
      const same =
        col.type === "date"
          ? value === dateOnly(current)
          : String(value).toLowerCase() === String(current ?? "").toLowerCase();
      if (!same) {
        out.push(rowError(row, col.header, `${col.header} cannot be changed on an existing ${recordLabel}; only the ${endLabel} can be updated`));
      }
    }
    return out;
  };

  const validateNew = (row) => {
    const out = [];
    const v = row.values;
    for (const col of columns) {
      const value = v[col.field];
      if (value == null) {
        if (col.requiredOnCreate) out.push(rowError(row, col.header, `${col.header} is required`));
      } else if (Array.isArray(col.values) && !col.values.map(String).includes(String(value))) {
        out.push(rowError(row, col.header, `${col.header} must be ${listValues(col.values)}`));
      }
    }
    const start = v[startField];
    const end = v[endField];
    if (start != null && end != null && end < start) {
      out.push(rowError(row, endLabel, `${endLabel} cannot be before the ${startLabel}`));
    }
    for (const col of columns) {
      const value = v[col.field];
      const condition = Object.entries(col.requiredWhen || {}).find(
        ([field, expected]) => v[field] != null && String(v[field]) === String(expected),
      );
      if (value == null && condition) {
        out.push(rowError(row, col.header, `${col.header} is required for ${condition[1]} ${labelOf(condition[0]).toLowerCase()}`));
      } else if (value != null && col.minDigits && Number(value) < 10 ** (col.minDigits - 1)) {
        out.push(rowError(row, col.header, `${col.header} must be at least ${col.minDigits} digits`));
      }
    }
    if (start && parentStart && start < parentStart) {
      out.push(rowError(row, startLabel, `${startLabel} cannot be before the ${parentLabel}'s ${startLabel} of ${parentStart}`));
    }
    if (start && parentEnd && start > parentEnd) {
      out.push(rowError(row, startLabel, `${startLabel} cannot be after the ${parentLabel}'s ${endLabel} of ${parentEnd}`));
    }
    if (end && parentEnd && end > parentEnd) {
      out.push(rowError(row, endLabel, `${endLabel} cannot be after the ${parentLabel}'s ${endLabel} of ${parentEnd}`));
    }
    const rejection = config.reject?.[String(v[keyField])];
    if (rejection) out.push(rowError(row, keyCol.header, rejection));
    return out;
  };

  const toCreate = [];
  const toEnd = [];
  for (const row of uniqueRows) {
    const existing = active.get(String(row.values[keyField]));
    const rowErrors = existing ? validateExisting(row, existing) : validateNew(row);
    if (rowErrors.length) errors.push(...rowErrors);
    else if (existing) toEnd.push({ row, existing });
    else toCreate.push(row);
  }
  if (!toCreate.length && !toEnd.length) return importResult(0, 0, errors, columns);

  const now = new Date().toISOString();
  const userFields = config.userFields || {};
  const stored = readEntityRecords(entity.name);
  let nextId = nextEntityId(entity, stored);
  const created = toCreate.map((row) => {
    const id = entity.idStrategy === "uuid" ? nextEntityId(entity, []) : nextId++;
    const values = Object.fromEntries(columns.map((c) => [c.field, row.values[c.field]]));
    let record = {
      [idField]: id,
      ...mergeDeep(resolveSeedTokens(entity.defaults || {}), values),
      ...scope,
      createdAt: now,
    };
    for (const path of userFields.create || []) record = setPath(record, path, user);
    return record;
  });
  const updates = new Map();
  for (const { row, existing } of toEnd) {
    let record = { ...existing, [endField]: row.values[endField], updatedAt: now };
    for (const path of userFields.update || []) record = setPath(record, path, user);
    updates.set(existing, record);
  }
  await writeEntityRecords(entity.name, [...stored.map((r) => updates.get(r) || r), ...created]);

  if (batches?.entity) {
    await recordBatch(batches, params, {
      user,
      uploadedAt: now,
      created: created.map((r) => r[idField]),
      updated: toEnd.map(({ existing }) => ({ id: existing[idField], before: { ...existing } })),
    });
  }
  return importResult(created.length, toEnd.length, errors, columns);
}

// ---------------------------------------------------------------------------------------------
// import batches (entityLink.batches = { entity, timeZone })

function batchEntityOf(batches, operation) {
  const entity = batches?.entity && configStore.getEntity(batches.entity);
  if (!entity) {
    throw httpError(500, `The "${operation}" operation needs entityLink.batches with an existing "entity"`);
  }
  return entity;
}

async function recordBatch(batches, params, entry) {
  const batchEntity = batchEntityOf(batches, "import");
  const list = readEntityRecords(batchEntity.name);
  const batch = {
    [batchEntity.idField || "id"]: nextEntityId(batchEntity, list),
    ...scopeValues(batchEntity, params),
    ...entry,
  };
  await writeEntityRecords(batchEntity.name, [...list, batch]);
}

function latestBatch(batchEntity, batches, params, { todayOnly = false } = {}) {
  const scope = scopeValues(batchEntity, params);
  const today = zonedDateTime(new Date(), batches.timeZone).date;
  let latest = null;
  for (const batch of readEntityRecords(batchEntity.name)) {
    if (!inScope(batch, scope)) continue;
    const at = Date.parse(batch.uploadedAt);
    if (Number.isNaN(at)) continue;
    if (todayOnly && zonedDateTime(new Date(at), batches.timeZone).date !== today) continue;
    if (!latest || at >= Date.parse(latest.uploadedAt)) latest = batch;
  }
  return latest;
}

/**
 * `revertLatest`: undoes the latest import batch of today (in batches.timeZone) for the scope:
 * records it created are deleted and records it ended get their previous values back
 * (`before`: a full snapshot replaces the record, a partial one is merged). 404 without such a batch.
 */
export async function performRevertLatest(entity, batches, params, scope) {
  const batchEntity = batchEntityOf(batches, "revertLatest");
  const latest = latestBatch(batchEntity, batches, params, { todayOnly: true });
  if (!latest) {
    const where = Object.entries(scope).map(([field, value]) => `${field} ${value}`).join(", ");
    const message = `No upload from today found${where ? ` for ${where}` : ""}`;
    throw Object.assign(httpError(404, message), { body: { message } });
  }
  const idField = entity.idField || "id";
  const createdIds = new Set((latest.created || []).map(String));
  const restores = new Map((latest.updated || []).map((u) => [String(u.id), u.before || {}]));

  let restored = 0;
  const records = readEntityRecords(entity.name).map((record) => {
    const before = inScope(record, scope) && restores.get(String(record[idField]));
    if (!before) return record;
    restored += 1;
    return idField in before ? { ...before } : { ...record, ...before };
  });
  await writeEntityRecords(entity.name, records);
  const toRemove = readEntityRecords(entity.name).filter(
    (r) => inScope(r, scope) && createdIds.has(String(r[idField])),
  );
  if (toRemove.length) await deleteRecords(entity, toRemove);

  const batchIdField = batchEntity.idField || "id";
  await writeEntityRecords(
    batchEntity.name,
    readEntityRecords(batchEntity.name).filter((b) => String(b[batchIdField]) !== String(latest[batchIdField])),
  );
  return { reverted: latest[batchIdField], user: latest.user ?? null, removed: toRemove.length, restored };
}

/**
 * The latest import batch for the request's scope, for `{{lastImport.*}}` in templates:
 * { today: uploaded today in batches.timeZone, user, time: "YYYY-MM-DDTHH:mm:ss" in that zone }.
 */
export function describeLastImport(batches, params) {
  const batchEntity = batches?.entity && configStore.getEntity(batches.entity);
  const latest = batchEntity ? latestBatch(batchEntity, batches, params) : null;
  if (!latest) return { today: false, user: null, time: null };
  const at = zonedDateTime(new Date(latest.uploadedAt), batches.timeZone);
  return {
    today: at.date === zonedDateTime(new Date(), batches.timeZone).date,
    user: latest.user ?? null,
    time: `${at.date}T${at.time}`,
  };
}
