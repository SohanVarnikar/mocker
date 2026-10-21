import { configStore } from "./config.js";
import { indexBy, readEntityRecords, writeEntityRecords } from "./store.js";
import { httpError } from "./asyncRouter.js";

/**
 * Relations are declared on the entity that holds the foreign key, e.g. on "notes":
 *   { "field": "rebateId", "entity": "rebates", "as": "rebate", "onDelete": "cascade", "validate": true }
 *
 * - expand (many-to-one): adds `note.rebate` = the rebates record whose id equals note.rebateId
 * - embed (one-to-many):  adds `rebate.notes` = all notes records pointing at that rebate
 * - validate:             rejects creates/updates whose rebateId matches no rebates record
 * - onDelete:             what happens to notes when their rebate is deleted
 *                         ("none" | "cascade" | "setNull" | "restrict")
 */

/** Relations on other entities (or this one) that point at `entityName`. */
export function incomingRelations(entityName) {
  const out = [];
  for (const child of configStore.listEntities()) {
    for (const rel of child.relations || []) {
      if (rel.entity === entityName) out.push({ child, rel });
    }
  }
  return out;
}

/** Accepts arrays and comma-separated strings (from query params or config). */
export function toNameSet(...sources) {
  const names = new Set();
  for (const source of sources) {
    const list = Array.isArray(source) ? source : source == null ? [] : [source];
    for (const item of list) {
      for (const part of String(item).split(",")) {
        const name = part.trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function findTarget(rel, value) {
  const target = configStore.getEntity(rel.entity);
  if (!target || value == null) return null;
  return indexBy(target.name, target.idField || "id").get(String(value))?.[0] ?? null;
}

/** Returns copies of the record(s) with requested relations expanded/embedded. */
export function withRelations(entity, data, { expand, embed } = {}) {
  const expandNames = expand instanceof Set ? expand : toNameSet(expand);
  const embedNames = embed instanceof Set ? embed : toNameSet(embed);
  const toExpand = (entity.relations || []).filter(
    (rel) => expandNames.has(rel.as) || expandNames.has(rel.field),
  );
  const seenChildren = new Set();
  const toEmbed = incomingRelations(entity.name).filter(({ child }) => {
    if (!embedNames.has(child.name) || seenChildren.has(child.name)) return false;
    seenChildren.add(child.name);
    return true;
  });
  if (!toExpand.length && !toEmbed.length) return data;

  const idField = entity.idField || "id";
  const decorate = (record) => {
    if (!record || typeof record !== "object") return record;
    const out = { ...record };
    for (const rel of toExpand) out[rel.as] = findTarget(rel, record[rel.field]);
    for (const { child, rel } of toEmbed) {
      const id = record[idField];
      out[child.name] = id == null ? [] : indexBy(child.name, rel.field).get(String(id)) || [];
    }
    return out;
  };
  return Array.isArray(data) ? data.map(decorate) : decorate(data);
}

/** Throws 400 if a relation marked `validate` points at a record that doesn't exist. */
export function validateReferences(entity, record) {
  for (const rel of entity.relations || []) {
    if (!rel.validate) continue;
    const value = record?.[rel.field];
    if (value == null || value === "") continue;
    if (!configStore.getEntity(rel.entity)) continue;
    if (!findTarget(rel, value)) {
      throw httpError(
        400,
        `${entity.name}.${rel.field} "${value}" does not match any ${rel.entity} record`,
      );
    }
  }
}

/**
 * Deletes records from `entity` and applies onDelete rules of relations pointing at it
 * (recursively for cascades). Nothing is written if any "restrict" rule blocks the delete.
 * Returns a summary of affected related records, e.g. { notes: { deleted: 3, unlinked: 0 } }.
 */
export async function deleteRecords(entity, recordsToRemove) {
  const plan = new Map();
  const planFor = (ent) => {
    let p = plan.get(ent.name);
    if (!p) {
      p = { remove: new Set(), nullify: new Map() };
      plan.set(ent.name, p);
    }
    return p;
  };

  const visit = (ent, removed) => {
    const idField = ent.idField || "id";
    const ids = removed.map((r) => r?.[idField]).filter((v) => v != null).map(String);
    if (!ids.length) return;
    for (const { child, rel } of incomingRelations(ent.name)) {
      const onDelete = rel.onDelete || "none";
      if (onDelete === "none") continue;
      const index = indexBy(child.name, rel.field);
      const alreadyRemoved = plan.get(child.name)?.remove;
      const affected = ids
        .flatMap((id) => index.get(id) || [])
        .filter((r) => !alreadyRemoved?.has(r));
      if (!affected.length) continue;
      if (onDelete === "restrict") {
        throw httpError(
          409,
          `Cannot delete ${ent.name} record: ${affected.length} ${child.name} record(s) still reference it via "${rel.field}"`,
        );
      }
      const p = planFor(child);
      if (onDelete === "setNull") {
        for (const r of affected) {
          if (!p.nullify.has(r)) p.nullify.set(r, new Set());
          p.nullify.get(r).add(rel.field);
        }
      } else if (onDelete === "cascade") {
        const fresh = affected.filter((r) => !p.remove.has(r));
        for (const r of fresh) p.remove.add(r);
        visit(child, fresh);
      }
    }
  };

  const root = planFor(entity);
  for (const r of recordsToRemove) root.remove.add(r);
  visit(entity, recordsToRemove);

  const summary = {};
  const writes = [];
  for (const [name, p] of plan) {
    let deleted = 0;
    let unlinked = 0;
    const next = [];
    for (const record of readEntityRecords(name)) {
      if (p.remove.has(record)) {
        deleted++;
        continue;
      }
      const fields = p.nullify.get(record);
      if (fields) {
        const copy = { ...record };
        for (const f of fields) copy[f] = null;
        next.push(copy);
        unlinked++;
      } else {
        next.push(record);
      }
    }
    if (deleted || unlinked) writes.push(writeEntityRecords(name, next));
    if (name !== entity.name && (deleted || unlinked)) summary[name] = { deleted, unlinked };
  }
  await Promise.all(writes);
  return summary;
}
