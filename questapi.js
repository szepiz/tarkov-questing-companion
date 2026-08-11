// Quest data client.
//
// Replaces the tarkov.dev JSON API as the app's source. The data now comes from
// this project's own published file:
//
//   https://szepiz.github.io/tarkov-quest-data/api/quests.json
//
// which is built from tarkov.dev, the wiki, tarkov-data-overlay and SPT, with
// 304 in-game observations graded against all four. What that buys the app:
//
//   - the ~91 quests 1.1.0 renamed arrive under their CURRENT names
//   - the 29 quests that no longer exist arrive marked `removedFromGame`
//   - every value carries the date it was last known to be true, so a field the
//     app can date better locally still wins (see mergeContract in the file)
//
// It is also cheaper. The old path was 9 requests and about 9.1 MB per refresh
// (three modes of tasks + tasks_en, plus a 1.6 MB item dictionary). This is one
// request of about 1.9 MB, with every id already resolved to English.
//
// The adapted shape is UNCHANGED: this module emits exactly what jsonapi.js
// emitted, so the cache file, questIndex() and the whole renderer are untouched.
// That is deliberate. Swapping the source and reshaping the data in one step
// would leave no way to tell which of the two broke something.

'use strict';

// GitHub Pages, not raw.githubusercontent.com.
//
// raw is not meant to back an application and behaves like it: it served a stale
// blob for a long window after a push, while the GitHub API reported the new one
// at the same moment, and a cache-busting query string did not shift it. Pages
// is a real CDN, purges on deploy, states its cache window (max-age=600) and
// returns application/json instead of text/plain.
//
// raw stays as a FALLBACK. Both serve the same file out of the same commit, so a
// second URL costs nothing and covers a Pages build being mid-deploy.
const API_URL = 'https://szepiz.github.io/tarkov-quest-data/api/quests.json';
const API_URL_FALLBACK = 'https://raw.githubusercontent.com/szepiz/tarkov-quest-data/main/api/quests.json';

const UA = (() => {
  let v = '';
  try { v = '/' + require('./package.json').version; } catch { /* packaged oddly */ }
  return `TarkovQuestingCompanion${v} (+https://github.com/szepiz/tarkov-questing-companion)`;
})();

async function fetchPayload({ retries = 3, timeoutMs = 45000, url = API_URL, fallbackUrl = API_URL_FALLBACK } = {}) {
  const urls = [url, fallbackUrl].filter(Boolean);
  let lastErr;
  for (const target of urls) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(target, {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          cache: 'no-cache',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`quest data responded ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  throw lastErr;
}

// ---- adaptation back to the shape the renderer was built against ----
//
// The published file uses plain strings where the old GraphQL shape used
// `{ name }` objects. Wrapping them here keeps the change to one file.
const nameOf = (s) => (s == null ? null : { name: s });
const nameList = (a) => (Array.isArray(a) ? a.map((s) => ({ name: s })) : []);

function adaptObjective(o) {
  const out = {
    id: o.id,
    type: o.type,
    description: o.description,
    optional: !!o.optional,
    maps: nameList(o.maps),
    // alternative key SETS: bring every key in any one set
    requiredKeys: Array.isArray(o.requiredKeys) && o.requiredKeys.length
      ? o.requiredKeys.map((set) => nameList(set))
      : null,
    zones: Array.isArray(o.zones)
      ? o.zones.map((z) => ({ position: z.position || null, map: nameOf(z.map) }))
      : [],
  };
  switch (o.type) {
    case 'findItem': case 'giveItem': case 'plantItem': case 'sellItem':
      out.items = nameList(o.items);
      out.count = o.count != null ? o.count : null;
      out.foundInRaid = !!o.foundInRaid;
      break;
    case 'findQuestItem': case 'giveQuestItem': case 'plantQuestItem':
      out.questItem = nameOf(o.questItem);
      out.count = o.count != null ? o.count : null;
      // null, not [], when absent: the cache shape distinguishes them
      out.possibleLocations = Array.isArray(o.possibleLocations)
        ? o.possibleLocations.map((pl) => ({ positions: pl.positions || [], map: nameOf(pl.map) }))
        : null;
      break;
    case 'shoot':
      out.count = o.count != null ? o.count : null;
      break;
    case 'extract':
      out.exitName = o.exitName != null ? o.exitName : null;
      break;
    case 'mark':
      out.markerItem = nameOf(o.markerItem);
      break;
    case 'useItem':
      out.useAny = nameList(o.useAny);
      out.count = o.count != null ? o.count : null;
      break;
    case 'buildWeapon':
      out.item = nameOf(o.item);
      break;
  }
  return out;
}

// One published quest -> one task, for one mode.
//
// `modeOverrides` matters and is easy to skip: the three modes agree on almost
// everything, but Provide Viewership carries a different level and a different
// prerequisite in PvP than in PvE. Applying the base values everywhere would be
// right 537 times and quietly wrong once.
function adaptQuest(q, mode, nameById) {
  const o = (q.modeOverrides && q.modeOverrides[mode]) || {};
  const has = (f) => Object.prototype.hasOwnProperty.call(o, f);
  const val = (f) => (has(f) ? o[f] : q[f]);

  return {
    id: q.id,
    name: q.name,
    kappaRequired: !!val('kappaRequired'),
    lightkeeperRequired: !!val('lightkeeperRequired'),
    minPlayerLevel: val('minPlayerLevel') != null ? val('minPlayerLevel') : null,
    restartable: !!q.restartable,
    wikiLink: q.wikiLink || null,
    factionName: q.faction || null,
    trader: nameOf(val('trader')),
    map: nameOf(val('map')),
    // The published file stores a prerequisite as a bare id, since the name is
    // already in the same file under that id. Resolved here rather than shipped
    // twice.
    taskRequirements: (val('requires') || []).map((r) => ({
      task: { id: r.task, name: nameById.get(r.task) || r.task },
      status: r.status || ['complete'],
    })),
    traderRequirements: (val('traderRequirements') || []).map((r) => ({
      trader: nameOf(r.trader),
      kind: r.kind,
      compareMethod: r.compareMethod || '>=',
      value: typeof r.value === 'number' ? r.value : 0,
    })),
    objectives: (q.objectives || []).map(adaptObjective),

    // Carried through from the published file, and new to the app. The renderer
    // ignores anything it does not know, so these are additive.
    //
    // `removedFromGame` is the one worth acting on: 29 quests the app currently
    // lists were deleted by BSG, and the wiki says so on a dated page.
    removedFromGame: q.removedFromGame || undefined,
    confirmedInGame: q.confirmedInGame || undefined,
    asOf: q.asOf || undefined,
    failedBy: (q.failedBy && q.failedBy.length) ? q.failedBy : undefined,
    // A SECOND CHANCE, NOT A NEXT STEP. Four quests are offered only once
    // another has been FAILED, which the published file states outright rather
    // than leaving in a `status` array nobody reads. The specific rows still
    // come from `taskRequirements` above, per mode, so the flag says what KIND
    // of quest this is and the rows say what the gate actually is.
    onlyAfterFailure: q.onlyAfterFailure || undefined,
    // "Complete EITHER of these." tarkov.dev's requirement list is flat and can
    // only mean AND, so where the game branches it keeps one arm and drops the
    // rest; this comes off the wiki, which writes the choice out.
    requiresAnyOf: (q.requiresAnyOf && q.requiresAnyOf.length) ? q.requiresAnyOf : undefined,
    // The same quest published once per arm — Make Amends is three ids with
    // identical objectives. The player is offered exactly one.
    sameQuestAs: (q.sameQuestAs && q.sameQuestAs.length) ? q.sameQuestAs : undefined,
    objectiveText: q.objectiveText || undefined,
    // The same wording keyed by OBJECTIVE ID, which is what the renderer shows.
    // Matched by content in the published file, never by index — the two lists
    // disagree about order and length often enough that pairing positionally
    // attaches one objective's sentence to another objective's coordinates.
    objectiveTextById: q.objectiveTextById || undefined,
  };
}

const MODE_KEY = { regular: 'pvp', pve: 'pve', season: 'seasonal' };

// The schema this client understands. Older files exist and are NOT usable:
// schema 1 published `objectives` as a list of sentences, and adapting a string
// as though it were an objective yields `{ id: undefined, type: undefined }`,
// which throws nothing, renders nothing, and quietly empties every map pin and
// every objective tick in the app. A payload that cannot be used has to fail
// loudly here, so the caller falls back to the cache instead of overwriting it
// with rubble.
const MIN_SCHEMA = 2;

// -> { regular: [...], pve: [...], season: [...] }, the existing cache shape.
function adaptAll(payload) {
  const quests = (payload && payload.quests) || [];
  if (!quests.length) throw new Error('quest data contained no quests');

  const schema = payload.schemaVersion;
  if (!(schema >= MIN_SCHEMA)) {
    throw new Error(`quest data is schema ${schema == null ? 'unknown' : schema}, this app needs ${MIN_SCHEMA} or newer`);
  }
  const sample = quests.find((q) => (q.objectives || []).length);
  if (sample && typeof sample.objectives[0] !== 'object') {
    throw new Error('quest data has unstructured objectives, so nothing could be ticked or pinned');
  }

  const nameById = new Map(quests.map((q) => [q.id, q.name]));

  const out = {};
  for (const [cacheMode, pubMode] of Object.entries(MODE_KEY)) {
    out[cacheMode] = quests
      .filter((q) => Array.isArray(q.modes) && q.modes.includes(pubMode))
      .map((q) => adaptQuest(q, pubMode, nameById));
  }
  if (!out.regular.length) throw new Error('quest data contained no PvP quests');
  out.generatedAt = payload.generatedAt || null;
  out.dataAsOf = (payload.sources && payload.sources.observed && payload.sources.observed.asOf) || null;
  return out;
}

async function fetchAllModes(opts) {
  return adaptAll(await fetchPayload(opts));
}

module.exports = { fetchAllModes, fetchPayload, adaptAll, adaptQuest, adaptObjective, API_URL, API_URL_FALLBACK };
