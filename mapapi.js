// Map-side data client.
//
// Fetches the map half of this project's published data:
//
//   https://szepiz.github.io/tarkov-quest-data/api/maps.json
//
// which carries the hand-placed work that used to live only in the baked
// storydata.js and bpdocs.js: 132 corrected marker positions, 39 hidden markers,
// 219 added labels, 87 map texts, 92 BattlePass document pins, hazards,
// interactables and the story chapter list.
//
// storydata.js and bpdocs.js STAY in the app as the bundled fallback. If the
// fetch fails, or the file is a schema this build does not understand, the app
// runs on the bake it shipped with, exactly as before. That is the whole reason
// the fetched data is applied by MUTATING the existing globals rather than
// replacing them: there is always something there to fall back to.

'use strict';

// GitHub Pages, with raw kept as a fallback. See the note in questapi.js:
// raw served a stale blob for a long window after a push and a cache-busting
// query did not shift it, so it is not what an app should depend on.
const MAPS_URL = 'https://szepiz.github.io/tarkov-quest-data/api/maps.json';
const MAPS_URL_FALLBACK = 'https://raw.githubusercontent.com/szepiz/tarkov-quest-data/main/api/maps.json';

const UA = (() => {
  let v = '';
  try { v = '/' + require('./package.json').version; } catch { /* packaged oddly */ }
  return `TarkovQuestingCompanion${v} (+https://github.com/szepiz/tarkov-questing-companion)`;
})();

async function fetchMaps({ retries = 2, timeoutMs = 30000, url = MAPS_URL, fallbackUrl = MAPS_URL_FALLBACK } = {}) {
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
        if (!res.ok) throw new Error(`map data responded ${res.status}`);
        return validate(await res.json());
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

const MIN_SCHEMA = 1;

// The categories the renderer reads out of MAP_FIXES, by the name it reads them
// under. Everything else in the payload is additive and can be missing.
const CORRECTIONS = ['labels', 'extracts', 'objectives', 'transits', 'switches',
  'objectiveFloors', 'extractFloors', 'labelFloors', 'transitFloors', 'switchFloors',
  'extractFactions', 'extractNotes', 'extractSwitches', 'hidden'];
const ADDITIONS = { newLabels: 'labels', mapTexts: 'mapTexts', newExtracts: 'extracts' };

// A file that parses but says nothing is the dangerous case: applied blindly it
// would blank every hand-placed pin in the app and look like the work was lost.
// So an empty payload is a failure, not a result.
function validate(p) {
  if (!p || typeof p !== 'object') throw new Error('map data was not an object');
  if (!(p.schemaVersion >= MIN_SCHEMA)) {
    throw new Error(`map data is schema ${p.schemaVersion == null ? 'unknown' : p.schemaVersion}, this app needs ${MIN_SCHEMA} or newer`);
  }
  if (!p.corrections || !p.additions) throw new Error('map data has no corrections or additions');
  const placed = (p.additions.labels || []).length + (p.additions.mapTexts || []).length;
  if (!placed) throw new Error('map data carries no hand-placed labels, so it would blank the bundled ones');
  if (!(p.battlePassDocuments && (p.battlePassDocuments.documents || []).length)) {
    throw new Error('map data carries no BattlePass documents');
  }
  return p;
}

// Rebuild the exact object the renderer expects, from the published shape.
// Key ORDER differs from the bake and that is not a difference: every reader
// looks these up by name.
function toMapFixes(p) {
  const out = {};
  for (const k of CORRECTIONS) out[k] = (p.corrections && p.corrections[k]) || {};
  for (const [appKey, apiKey] of Object.entries(ADDITIONS)) out[appKey] = (p.additions && p.additions[apiKey]) || [];
  return out;
}

module.exports = { fetchMaps, validate, toMapFixes, MAPS_URL, MAPS_URL_FALLBACK, CORRECTIONS, ADDITIONS };
