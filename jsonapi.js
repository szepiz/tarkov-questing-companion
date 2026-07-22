// tarkov.dev JSON API client + adapter.
//
// The GraphQL API (api.tarkov.dev/graphql) is deprecated — "maintenance mode,
// schema changes will not be made" — and spent 2026-07-22 returning 503 on
// every query while the site kept working, because the site had moved to
// https://json.tarkov.dev/. This module fetches the JSON API and adapts its
// payloads into the EXACT shape the old GraphQL query produced, so the cache
// file, questIndex() and the whole renderer stay untouched.
//
// JSON API mechanics (see DEV-NOTES §12):
//   GET json.tarkov.dev/{mode}/tasks        data: string fields are locale
//                                           placeholder KEYS ("<id> name")
//   GET json.tarkov.dev/{mode}/tasks_en     flat { "<key>": "English string" }
//   payload.translations                    JSONPath list naming the fields
//                                           that are placeholders
//   Ids everywhere (trader/map/item/questItem) — resolved via the small _en
//   locale files ("<traderId> Nickname", "<mapId> Name", "<itemId> Name"),
//   never the multi-MB data endpoints.

'use strict';

const JSON_API = 'https://json.tarkov.dev/';

async function fetchJson(path, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(JSON_API + path, {
        headers: { Accept: 'application/json' },
        cache: 'no-cache',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`JSON API ${path} responded ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr;
}

// ---- string hygiene ----
// The JSON API's text is double-encoded UTF-8 (’ arrives as the bytes of "â€™"
// re-encoded — c3 a2 c2 80 c2 99) and a handful of locale values carry stray
// whitespace / trailing newlines ("Arena Business [PVE ZONE]\n"). Repair is
// only attempted when every char is ≤ U+00FF and at least one is ≥ U+0080 —
// a correctly-encoded string (pure ASCII, or containing real ’ U+2019) can
// never match, so the repair cannot corrupt good text.
function cleanString(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  if (/[\u0080-\u00ff]/.test(out) && !/[\u0100-\uffff]/.test(out)) {
    const repaired = Buffer.from(out, 'latin1').toString('utf8');
    if (!repaired.includes('�')) out = repaired;
  }
  return out.trim();
}

function cleanDeep(node) {
  if (typeof node === 'string') return cleanString(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = cleanDeep(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = cleanDeep(node[k]);
    return node;
  }
  return node;
}

// ---- translations ----
// payload.translations is a list of JSONPath expressions like
//   $.data.tasks.*.objectives[*].description
// naming every field whose value is a locale key. Only two constructs appear
// (".*" over object values, "[*]" over an array field), so a tiny interpreter
// is enough — and stays faithful to what the site itself does (its bundle
// walks the same list with a JSONPath lib and substitutes en[value] ?? value).
function applyTranslations(payload, en) {
  const dict = en && en.data ? en.data : {};
  for (const path of payload.translations || []) {
    const segs = path.replace(/^\$\.?/, '').split('.');
    substitute(payload, segs, 0, dict);
  }
  return payload;
}

function substitute(node, segs, i, dict) {
  if (node == null) return;
  if (i === segs.length - 1) {
    // leaf: replace node[field] (or each element of node[field] for "[*]")
    const seg = segs[i];
    const arr = seg.endsWith('[*]');
    const field = arr ? seg.slice(0, -3) : seg;
    if (arr) {
      const v = node[field];
      if (Array.isArray(v)) for (let k = 0; k < v.length; k++) {
        if (typeof v[k] === 'string' && dict[v[k]] !== undefined) v[k] = dict[v[k]];
      }
    } else if (typeof node[field] === 'string' && dict[node[field]] !== undefined) {
      node[field] = dict[node[field]];
    }
    return;
  }
  const seg = segs[i];
  if (seg === '*') {
    for (const v of Object.values(node)) substitute(v, segs, i + 1, dict);
  } else if (seg.endsWith('[*]')) {
    const v = node[seg.slice(0, -3)];
    if (Array.isArray(v)) for (const el of v) substitute(el, segs, i + 1, dict);
  } else {
    substitute(node[seg], segs, i + 1, dict);
  }
}

// ---- adaptation to the GraphQL cache shape ----

function makeNames({ tasksEn, mapsEn, tradersEn, itemsEn }) {
  const get = (dict, key, fb) => {
    const v = dict && dict.data ? dict.data[key] : undefined;
    return typeof v === 'string' ? v : fb;
  };
  return {
    task: id => get(tasksEn, `${id} name`, id),
    map: id => get(mapsEn, `${id} Name`, id),
    trader: id => get(tradersEn, `${id} Nickname`, id),
    item: id => get(itemsEn, `${id} Name`, id),
  };
}

const nameObj = (names, kind) => id => (id == null ? null : { name: names[kind](id) });
const nameList = (names, kind) => ids => (Array.isArray(ids) ? ids.map(id => ({ name: names[kind](id) })) : []);

// One JSON-API objective -> the shape the old GraphQL query selected for it.
// Extra JSON fields (outlines, buildAttributes, shotType…) are dropped on
// purpose: the cache shape is the contract the renderer was tested against.
function adaptObjective(o, names, questItemName) {
  const item = nameObj(names, 'item');
  const items = nameList(names, 'item');
  const zones = zs => (Array.isArray(zs) ? zs.map(z => ({
    position: z.position ? { x: z.position.x, y: z.position.y, z: z.position.z } : null,
    map: z.map != null ? { name: names.map(z.map) } : null,
  })) : []);
  const out = {
    id: o.id,
    type: o.type,
    description: o.description,
    optional: !!o.optional,
    maps: (o.maps || []).map(id => ({ name: names.map(id) })),
  };
  // requiredKeys is [[Item]] — alternative key SETS, nested on purpose
  const keys = o.requiredKeys;
  out.requiredKeys = Array.isArray(keys) && keys.length
    ? keys.map(set => (Array.isArray(set) ? items(set) : items([set])))
    : null;
  out.zones = zones(o.zones);
  switch (o.type) {
    case 'findItem': case 'giveItem': case 'plantItem': case 'sellItem':
      out.items = items(o.items);
      out.count = o.count != null ? o.count : null;
      out.foundInRaid = !!o.foundInRaid;
      break;
    case 'findQuestItem': case 'giveQuestItem': case 'plantQuestItem':
      out.questItem = o.questItem != null ? { name: questItemName(o.questItem) } : null;
      out.count = o.count != null ? o.count : null;
      // null (not []) when absent — the GraphQL cache stored null there
      out.possibleLocations = Array.isArray(o.possibleLocations)
        ? o.possibleLocations.map(pl => ({
            positions: (pl.positions || []).map(p => ({ x: p.x, y: p.y, z: p.z })),
            map: pl.map != null ? { name: names.map(pl.map) } : null,
          }))
        : null;
      break;
    case 'shoot':
      out.count = o.count != null ? o.count : null;
      break;
    case 'extract':
      out.exitName = o.exitName != null ? o.exitName : null;
      break;
    case 'mark':
      out.markerItem = item(o.markerItem);
      break;
    case 'useItem':
      out.useAny = items(o.useAny);
      out.count = o.count != null ? o.count : null;
      break;
    case 'buildWeapon':
      out.item = item(o.item);
      break;
  }
  return out;
}

function adaptTask(t, names, questItemName) {
  return {
    id: t.id,
    name: t.name,
    kappaRequired: !!t.kappaRequired,
    lightkeeperRequired: !!t.lightkeeperRequired,
    minPlayerLevel: t.minPlayerLevel != null ? t.minPlayerLevel : null,
    restartable: !!t.restartable,
    // upstream builds some links from names that end in "\n" — encoded as %0A
    wikiLink: t.wikiLink != null ? String(t.wikiLink).replace(/(?:%0A|%0D)+$/i, '') : null,
    trader: t.trader != null ? { name: names.trader(t.trader) } : null,
    map: t.map != null ? { name: names.map(t.map) } : null,
    taskRequirements: (t.taskRequirements || []).map(r => ({
      task: { id: r.task, name: names.task(r.task) },
      status: r.status || [],
    })),
    objectives: (t.objectives || []).map(o => adaptObjective(o, names, questItemName)),
  };
}

// Fetch + adapt one game mode. Locale files are fetched per mode (cheap, and
// keeps any future per-mode naming differences correct).
async function fetchMode(mode, shared = {}) {
  const [payload, tasksEn] = await Promise.all([
    fetchJson(`${mode}/tasks`),
    fetchJson(`${mode}/tasks_en`),
  ]);
  // the small name dictionaries are mode-independent — share across modes
  if (!shared.mapsEn) {
    [shared.mapsEn, shared.tradersEn, shared.itemsEn] = await Promise.all([
      fetchJson(`${mode}/maps_en`),
      fetchJson(`${mode}/traders_en`),
      fetchJson(`${mode}/items_en`),
    ]);
    cleanDeep(shared.mapsEn); cleanDeep(shared.tradersEn); cleanDeep(shared.itemsEn);
  }
  cleanDeep(tasksEn);          // names resolved via makeNames read this directly
  applyTranslations(payload, tasksEn);
  cleanDeep(payload);          // wikiLinks etc. carry the same mojibake
  const names = makeNames({ tasksEn, mapsEn: shared.mapsEn, tradersEn: shared.tradersEn, itemsEn: shared.itemsEn });
  const qItems = (payload.data && payload.data.questItems) || {};
  const questItemName = id => (qItems[id] && typeof qItems[id].name === 'string' ? qItems[id].name : names.item(id));
  const tasks = Object.values((payload.data && payload.data.tasks) || {});
  if (!tasks.length) throw new Error(`JSON API returned no tasks for ${mode}`);
  return tasks.map(t => adaptTask(t, names, questItemName));
}

// -> { regular: [...], pve: [...] } in the exact old cache shape.
async function fetchAllModes() {
  const shared = {};
  const regular = await fetchMode('regular', shared);
  const pve = await fetchMode('pve', shared);
  return { regular, pve };
}

module.exports = { fetchAllModes, fetchMode, fetchJson, applyTranslations, adaptTask, makeNames, cleanDeep, cleanString };
