'use strict';

// The mode list is OWNED BY main.js and arrives through get-init (state.modes),
// so the two sides can never disagree about which modes exist. These are only
// the browser-dev fallback and the value used before get-init resolves.
const DEV_MODES = ['regular', 'pve', 'season'];
const DEV_MODE_LABELS = { regular: 'PvP', pve: 'PvE', season: 'SEASON' };
const modes = () => (state && state.modes && state.modes.length ? state.modes : DEV_MODES);
const modeLabels = () => (state && state.modeLabels) || DEV_MODE_LABELS;
const defaultMode = () => (state && state.defaultMode) || 'regular';

// ---------- dev fallback: lets the UI run in a plain browser (no Electron) ----------
const backend = window.api || (() => {
  const emptyBucket = () => ({ completed: {}, failed: {}, resetAt: 0 });
  const store = {
    settings: JSON.parse(localStorage.getItem('tqt-settings') || 'null') || {
      trackingMode: 'manual', logsPath: 'C:\\Battlestate Games\\EFT\\Logs', filter: 'ALL', gameMode: 'regular',
      hideCompleted: false, hideLocked: false, showRetryQuests: false, mapLayers: {}, mapLayersOpen: {},
    },
    progress: JSON.parse(localStorage.getItem('tqt-progress') || 'null') || { regular: emptyBucket(), pve: emptyBucket() },
  };
  const persist = () => {
    localStorage.setItem('tqt-settings', JSON.stringify(store.settings));
    localStorage.setItem('tqt-progress', JSON.stringify(store.progress));
  };
  const bucket = (mode) => store.progress[DEV_MODES.includes(mode) ? mode : store.settings.gameMode];
  return {
    getInit: async () => ({ settings: store.settings, progress: store.progress, watcherStatus: { active: false, logsFound: false } }),
    loadTasks: async () => {
      try {
        const cache = await (await fetch('quests_cache.json')).json();
        const reg = cache.regular || cache.tasks;
        return { regular: reg, pve: cache.pve || reg, source: 'cache', fetchedAt: cache.fetchedAt };
      } catch (e) {
        return { regular: null, pve: null, source: 'none', error: String(e) };
      }
    },
    saveSettings: async (patch) => { Object.assign(store.settings, patch); persist(); return store.settings; },
    setGameMode: async (mode) => { store.settings.gameMode = mode; persist(); return store.settings; },
    toggleTask: async (taskId, done, mode) => {
      const b = bucket(mode);
      if (done) b.completed[taskId] = { via: 'manual', at: Date.now() };
      else delete b.completed[taskId];
      persist(); return store.progress;
    },
    toggleObjective: async (objectiveId, done, mode) => {
      const b = bucket(mode);
      if (!b.objectives) b.objectives = {};
      if (done === 'failed') b.objectives[objectiveId] = { at: Date.now(), failed: true };
      else if (done === 'missed') b.objectives[objectiveId] = { at: Date.now(), missed: true };
      else if (done) b.objectives[objectiveId] = { at: Date.now() };
      else delete b.objectives[objectiveId];
      persist(); return store.progress;
    },
    clearObjectives: async (ids, mode) => {
      const b = bucket(mode);
      for (const id of ids || []) delete (b.objectives || {})[id];
      persist(); return store.progress;
    },
    resetProgress: async (mode) => { store.progress[DEV_MODES.includes(mode) ? mode : store.settings.gameMode] = { completed: {}, failed: {}, resetAt: Date.now() }; persist(); return store.progress; },
    rescanAll: async () => ({ progress: store.progress, imported: 0, failsImported: 0, hadReset: false, logsFound: false }),
    browseLogs: async () => null,
    openWiki: async (url) => window.open(url),
    getMapSvg: async (file) => { try { return await (await fetch(file)).text(); } catch { return null; } },
    checkUpdate: async () => ({ available: false, current: 'dev', canApply: false }),
    downloadUpdate: async () => ({ staged: false, error: 'not supported in browser' }),
    applyUpdate: async () => ({ applying: false }),
    onAutoCompletions: () => {},
    onStoryState: () => {},
    onSeasonSplit: () => {},
    onWatcherStatus: () => {},
    onSettingsChanged: () => {},
    onUpdateAvailable: () => {},
    onUpdateProgress: () => {},
  };
})();

// ---------- static config ----------

// Location and trader photos live in images/ rather than loose in the app root.
// The tables below hold bare filenames; this is the only place the folder is
// named, so moving them again is a one-line change.
const IMG_DIR = 'images/';

const MAP_IMAGES = {
  'ground zero': 'ground_zero.jpg',
  'factory': 'factory.jpg',
  'night factory': 'factory.jpg',
  'customs': 'customs.jpg',
  'woods': 'woods.jpg',
  'shoreline': 'shoreline.jpg',
  'interchange': 'interchange.jpg',
  'reserve': 'reserve.jpg',
  'streets of tarkov': 'streets.jpg',
  'lighthouse': 'lighthouse.jpg',
  'the lab': 'labs.jpg',
};
const TRADER_IMAGES = {
  'prapor': 'prapor.jpg',
  'therapist': 'therapist.jpg',
  'fence': 'fence.jpg',
  'skier': 'skier.jpg',
  'peacekeeper': 'peacekeeper.jpg',
  'mechanic': 'mechanic.jpg',
  'ragman': 'ragman.jpg',
  'jaeger': 'jaeger.jpg',
};
const MAP_ORDER = [
  'Ground Zero', 'Factory', 'Customs', 'Woods', 'Shoreline', 'Interchange',
  'Reserve', 'Streets of Tarkov', 'Lighthouse', 'The Lab', 'The Labyrinth',
  'Icebreaker',
];
const TRADER_ORDER = [
  'Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic',
  'Ragman', 'Jaeger', 'Lightkeeper', 'Ref', 'BTR Driver',
];
// ---------- map naming ----------
// (_dev/test_groups.js slices from here to "---------- state ----------")
const ANYWHERE = 'Anywhere';

// normalize a map name coming from the API ("Ground Zero 21+" -> "Ground Zero")
function normMapName(name) {
  if (!name) return null;
  const n = name.replace(/\s*21\+\s*$/, '');
  return n === 'Night Factory' ? 'Factory' : n;
}

// Some quests have no task-level map (task.map == null) but their objectives
// are tagged with maps. Most of the time that objective map IS the real
// location (a fixed item/place, e.g. "obtain the flash drive on Lighthouse").
// The exception is roaming-scav ELIMINATION objectives: "kill N sniper scavs"
// is tagged with one map but is genuinely doable anywhere those scavs spawn.
// So we ignore maps on "shoot" objectives — unless the quest is a known
// boss-follower kill locked to one map (verified against the wiki 2026-07-17).
const BOSS_LOCKED_SHOOT = new Set([
  '5d25e43786f7740a212217fa', // The Huntsman Path - Justice — Reshala's guards, Customs
]);

function distinctObjectiveMaps(t) {
  const set = new Set();
  for (const o of t.objectives || []) {
    for (const m of o.maps || []) {
      const n = normMapName(m.name);
      if (n) set.add(n);
    }
  }
  return set;
}

// true when the only objectives carrying a map are roaming-kill (shoot) ones,
// so the map tag is just a hint and the quest is really any-location
function isRoamingShootOnly(t) {
  if (t.map && t.map.name) return false;
  if (BOSS_LOCKED_SHOOT.has(t.id)) return false;
  // A hand-placed QUEST_MAPS override is a statement that this quest is locked
  // to those maps, so it is never "anywhere" — without this a multi-map
  // override on a `shoot` quest (Easy-Breezy) clears task.map and then falls
  // straight through to ANYWHERE, losing the correction it just applied.
  if (typeof QUEST_MAPS !== 'undefined' && QUEST_MAPS && QUEST_MAPS[t.id]) return false;
  const mapped = (t.objectives || []).filter((o) => (o.maps || []).some((m) => normMapName(m.name)));
  return mapped.length > 0 && mapped.every((o) => String(o.type).toLowerCase() === 'shoot');
}

// which map to file a task under: its own map, else the single fixed map its
// objectives anchor to, else "Anywhere"
function effectiveMap(t) {
  const direct = normMapName(t.map && t.map.name);
  if (direct) return direct;
  if (isRoamingShootOnly(t)) return ANYWHERE;
  const set = distinctObjectiveMaps(t);
  if (set.size === 1) return set.values().next().value;
  return ANYWHERE;
}

// Where a task takes place, for a TREE ROW rather than the details panel. Two
// differences that matter: the owner asked for the word "anywhere", and this one
// has to survive a 300px sidebar. 61 quests span two or more maps and one spans
// eleven — "Ambulance" joined in full is 137 characters — so the list is capped
// and the full version goes in the row's tooltip.
function rowMapLabel(t) {
  const direct = normMapName(t.map && t.map.name);
  if (direct) return { text: direct, full: direct };
  if (isRoamingShootOnly(t)) return { text: 'anywhere', full: 'any location' };
  const list = [...distinctObjectiveMaps(t)];
  if (!list.length) return { text: 'anywhere', full: 'any location' };
  const full = list.join(', ');
  return { text: list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : full, full };
}

// human description of where a task takes place, for the details panel
function taskMapLabel(t) {
  const direct = normMapName(t.map && t.map.name);
  if (direct) return direct;
  if (isRoamingShootOnly(t)) return 'Any location';
  const set = distinctObjectiveMaps(t);
  if (!set.size) return 'Any location';
  const list = [...set];
  return list.length > 3 ? `${list.slice(0, 3).join(', ')}, …` : list.join(', ');
}

// ---------- state ----------

const state = {
  gameMode: 'regular',                          // 'regular' (PvP) | 'pve'
  tasksByMode: { regular: [], pve: [] },        // quest list per mode
  modes: DEV_MODES.slice(),        // replaced by main.js's list at boot
  modeLabels: { ...DEV_MODE_LABELS },
  defaultMode: 'regular',
  seasonAliased: false,            // seasonal is showing the PvP quest list
  fullProgress: Object.fromEntries(DEV_MODES.map((m) => [m, { completed: {}, failed: {}, resetAt: 0 }])),
  tasks: [],                                    // active mode's task list
  byId: new Map(),                              // active mode's id -> task
  progress: { completed: {}, failed: {} },      // active mode's bucket
  settings: null,
  watcherStatus: { active: false, logsFound: false },
  dataInfo: null,
  filter: 'ALL',
  // Live quest search. Not persisted on purpose — a stale filter surviving a
  // restart looks exactly like lost quests.
  searchQuery: '',
  // How the quest list is grouped. One of the GROUPINGS keys; persisted in
  // settings.groupBy so it survives a restart like the selected tab does.
  groupBy: 'map-trader',
  // Which group rows are open, keyed by the node's PATH ("map:Customs",
  // "map:Customs|trader:Prapor", "trader:Prapor"). One set instead of the old
  // expandedMaps/expandedTraders pair, because the levels are no longer fixed:
  // a trader can be the top level and a map can be nested under it.
  expandedNodes: new Set(),
  selMap: null,
  selTrader: null,
  selQuestId: null,
  // story campaign (chapters from storydata.js; auto state from the log watcher)
  storyState: Object.fromEntries(DEV_MODES.map((m) => [m, { chapters: {}, subs: {} }])),
  expandedChapters: new Set(),
  selChapter: null,
};

const $ = (id) => document.getElementById(id);

// A quest published once per PMC faction can never be taken by both, so with a
// faction set the other side's copy is not "a quest you have not done" — it is a
// quest that is not yours. Filtered at the source so every count, every list and
// every map pin agrees, rather than at each of the twenty places that read
// state.tasks. Unset shows both, which is what the app did before.
// ⚠️ state.tasksByMode is left ALONE: it is the pristine fetch, and the settings
// panel has to be able to switch faction back without a re-fetch.
function forFaction(list) {
  const f = state.settings && state.settings.pmcFaction;
  if (!f || f === 'any') return list;
  return list.filter((t) => !t.factionName || t.factionName.toUpperCase() === f);
}

// point the active-mode views (tasks/byId/progress) at the current game mode
function applyMode() {
  const m = state.gameMode;
  _reworkedObjIds = null;   // task data may have been rebuilt underneath it
  state.tasks = forFaction(state.tasksByMode[m] || []);
  state.byId = new Map(state.tasks.map((t) => [t.id, t]));
  state.progress = state.fullProgress[m] || { completed: {}, failed: {}, objectives: {}, resetAt: 0 };
  if (!state.progress.completed) state.progress.completed = {};
  if (!state.progress.failed) state.progress.failed = {};
  if (!state.progress.objectives) state.progress.objectives = {};
}

// ---------- the Kappa gate ----------
//
// EFT 1.1.0 replaced "complete 257 side tasks" with a short, checkable list:
// loyalty level 4 with seven traders, Fence karma, four named quests and a
// player level. tarkov.dev still publishes the old 257-quest form, so the gate
// comes from the wiki (see _dev/build_wikireqs.js).
//
// Three states per row, never two: MET, NOT MET, and UNKNOWN. A trader whose
// loyalty the player has not entered is UNKNOWN — the same rule the rest of the
// app follows, because showing a red cross for something we simply do not know
// is a claim, and it is the claim most likely to be wrong.
// Which quests Kappa actually NAMES. Patch 1.1.0 replaced "complete 257 side
// tasks" with a short list, so `kappaRequired` on a task — which tarkov.dev
// still sets on all 257 — no longer means "needed for Kappa". Everything that
// used to read that flag reads this instead, so the KAPPA badge, the map's
// KAPPA pin set and the tab all agree with each other.
//
// Falls back to the old flag when no gate is loaded, so an older wikireqs.js (or
// none at all) degrades to the previous behaviour rather than emptying the set.
let _kappaIds = null;
function kappaQuestIds() {
  if (_kappaIds) return _kappaIds;
  if (typeof KAPPA_GATE === 'undefined' || !KAPPA_GATE || !KAPPA_GATE.quests) return null;
  _kappaIds = new Set(KAPPA_GATE.quests.flatMap((q) => q.ids || []));
  return _kappaIds.size ? _kappaIds : null;
}

function isKappaQuest(t) {
  const ids = kappaQuestIds();
  return ids ? ids.has(t.id) : !!t.kappaRequired;
}

function kappaRows() {
  const rows = [];
  const state3 = (ok) => (ok === null ? 'unknown' : ok ? 'met' : 'unmet');
  for (const l of KAPPA_GATE.loyalty || []) {
    const have = standingFor(l.trader).loyalty;
    rows.push({
      kind: 'loyalty',
      label: `${l.trader} — loyalty level ${l.value}`,
      detail: Number.isFinite(have) ? `you are LL${have}` : 'not set — open TRADERS',
      state: state3(Number.isFinite(have) ? have >= l.value : null),
    });
  }
  if (KAPPA_GATE.karma !== null && KAPPA_GATE.karma !== undefined) {
    const have = standingFor('Fence').rep;
    rows.push({
      kind: 'karma',
      label: `Fence — Scav karma +${KAPPA_GATE.karma}`,
      detail: Number.isFinite(have) ? `you are at ${have > 0 ? '+' : ''}${have}` : 'not set — open TRADERS',
      state: state3(Number.isFinite(have) ? have >= KAPPA_GATE.karma : null),
    });
  }
  for (const q of KAPPA_GATE.quests || []) {
    // "A or B or C" is ONE requirement any of them satisfies
    const done = (q.ids || []).some((id) => isDone(id));
    rows.push({
      kind: 'quest',
      label: q.names.join('  or  '),
      detail: done ? 'completed' : 'not completed',
      state: state3(q.ids && q.ids.length ? done : null),
    });
  }
  const lvl = KAPPA_GATE.minPlayerLevel || 0;
  if (lvl > 0) {
    const have = playerLevel();
    rows.push({
      kind: 'level',
      label: `Player level ${lvl}`,
      detail: have > 0 ? `you are level ${have}` : 'not set — see Settings',
      state: state3(have > 0 ? have >= lvl : null),
    });
  }
  return rows;
}

function renderKappaGate(tree) {
  const rows = kappaRows();
  const met = rows.filter((r) => r.state === 'met').length;
  const unknown = rows.filter((r) => r.state === 'unknown').length;

  const note = document.createElement('div');
  note.className = 'kappa-note';
  note.innerHTML = `<strong>Patch 1.1.0 rewrote the Kappa requirements.</strong> `
    + `The old "complete 257 side tasks" rule is gone — this is the new gate. `
    + `Quest data still ships the old version, so this comes from the wiki and may `
    + `change as it is confirmed. Set your loyalty levels under <strong>TRADERS</strong> to fill it in.`;
  tree.appendChild(note);

  const head = document.createElement('div');
  head.className = 'kappa-head';
  head.innerHTML = `<span class="kappa-count">${met} / ${rows.length}</span> requirements met`
    + (unknown ? ` · <span class="kappa-unknown">${unknown} not set yet</span>` : '');
  tree.appendChild(head);

  for (const r of rows) {
    const el = document.createElement('div');
    el.className = `kappa-row ${r.state}`;
    el.innerHTML = `<span class="kappa-mark"></span>`
      + `<span class="kappa-label">${escapeHtml(r.label)}</span>`
      + `<span class="kappa-detail">${escapeHtml(r.detail)}</span>`;
    tree.appendChild(el);
  }
}

// ---------- filtering / grouping ----------

function taskPassesFilter(t) {
  if (state.filter === 'KAPPA') return isKappaQuest(t);
  if (state.filter === 'LIGHTKEEPER') return !!t.lightkeeperRequired;
  return true;
}

function isDone(taskId) {
  return !!state.progress.completed[taskId];
}

// An objective the player ticked off by hand. Tarkov reports no partial quest
// progress, so a quest spread over three maps otherwise keeps showing all three
// pins after you have done one.
// Failed and missed marks live on the SAME record ({at, failed: true} /
// {at, missed: true}) — story branches (The Ticket's endings) make objectives
// failable, one-shot chances can slip by without failing, and neither reaches
// any log — so done must exclude both: a marked objective is resolved, not
// achieved.
function isObjectiveDone(objectiveId) {
  const r = objectiveId && state.progress.objectives && state.progress.objectives[objectiveId];
  return !!(r && !r.failed && !r.missed);
}

function isObjectiveFailed(objectiveId) {
  const r = objectiveId && state.progress.objectives && state.progress.objectives[objectiveId];
  return !!(r && r.failed);
}

function isObjectiveMissed(objectiveId) {
  const r = objectiveId && state.progress.objectives && state.progress.objectives[objectiveId];
  return !!(r && r.missed);
}

function isFailed(taskId) {
  return !!(state.progress.failed && state.progress.failed[taskId]);
}

// Lock detection only runs in automatic mode, where the app reliably knows
// which quests are completed. In manual mode everything renders normally.
function lockingActive() {
  // Seasonal has its own published quest list, but its unlock requirements are
  // byte-identical to PvP's (482 of 483) and are measurably NOT what seasonal
  // does: this profile's own seasonal character, at level 4, completed Sales
  // Night (PvP: level 30) and The Blood of War - Part 1 (PvP: level 15) with
  // none of the listed prerequisites done. Locking on that data would have
  // hidden both quests while they were being played, so seasonal locks nothing
  // unless the player asks for it. Hiding something reachable on a guess is the
  // one failure this app refuses; showing an extra quest is the cheap direction.
  if (state.gameMode === 'season' && !(state.settings && state.settings.seasonPvpRules)) return false;
  return !!(state.settings && state.settings.trackingMode === 'auto');
}

function reqStatuses(req) {
  return (req.status && req.status.length) ? req.status : ['complete'];
}

// true when our completed/failed records positively satisfy the requirement
function reqMet(req) {
  const statuses = reqStatuses(req);
  if (statuses.includes('complete') && isDone(req.task.id)) return true;
  if (statuses.includes('failed') && isFailed(req.task.id)) return true;
  return false;
}

// A requirement can also depend on a prerequisite being "active" (accepted but
// not finished). We can't see "active" in the logs, so we approximate it: an
// "active" prerequisite counts as satisfied when it is already done OR is
// itself reachable (its own requirements are all satisfied) — i.e. the player
// could have it active right now. This keeps early quests unlocked without
// unlocking a whole deep chain the player hasn't progressed into yet.
function reqSatisfied(req) {
  if (!state.byId.has(req.task.id)) return true; // untracked prereq → don't lock on it
  // A REQUIREMENT POINTING AT A QUEST BSG DELETED CANNOT GATE ANYTHING. 33 are
  // still published, and everything behind one would lock forever on a
  // prerequisite nobody can complete.
  const pre = state.byId.get(req.task.id);
  if (pre && pre.removedFromGame) return true;
  const statuses = reqStatuses(req);
  if (statuses.includes('complete') && isDone(req.task.id)) return true;
  if (statuses.includes('failed') && isFailed(req.task.id)) return true;
  if (statuses.some((s) => s !== 'complete' && s !== 'failed')) {
    // "active": the prereq must be accepted/in progress. A quest we still hold a
    // failure for does NOT satisfy that — otherwise a mutually-exclusive branch
    // you failed would wrongly unlock its sibling. (Failure is not always
    // permanent: 16 tasks are restartable. But re-accepting one clears the
    // failure during the log scan, so if the record is still here, it is not
    // active.)
    if (isDone(req.task.id)) return true;
    if (isFailed(req.task.id)) return false;
    return taskReachable(req.task.id);
  }
  return false;
}

// true when a task's own prerequisites are all satisfied (it could be accepted
// right now). Memoized per render; guarded against dependency cycles.
let _reachMemo = new Map();
const _reachStack = new Set();
function taskReachable(taskId) {
  if (_reachMemo.has(taskId)) return _reachMemo.get(taskId);
  const t = state.byId.get(taskId);
  if (!t) return true;                       // untracked prereq → don't lock on it
  if (_reachStack.has(taskId)) return true;  // cycle failsafe
  _reachStack.add(taskId);
  let ok = true;
  // A row naming one arm of a choice is superseded by the choice itself.
  // Battery Change publishes "Stick in the Wheel" as its prerequisite and opens
  // just as well after Stabilize Business; ANDing the published row would lock
  // it for everyone who took the other arm.
  const choice = new Set(anyOfIds(t));
  for (const req of t.taskRequirements || []) {
    if (!req.task) continue;
    if (choice.has(req.task.id)) continue;
    if (!reqSatisfied(req)) { ok = false; break; }
  }
  if (ok && choice.size) ok = anyOfMet(t);
  _reachStack.delete(taskId);
  _reachMemo.set(taskId, ok);
  return ok;
}


// Your level, for quests gated on one. Tarkov never writes your own level to the
// logs (the profiles that appear there are other players in your group), so it is
// either what you set in Settings or a floor derived from what you have already
// finished: completing a quest that needs level 35 proves you are at least 35.
let _levelFloor = null;
function inferredLevel() {
  if (_levelFloor !== null) return _levelFloor;
  let max = 0;
  for (const t of state.tasks) {
    if (isDone(t.id) && (t.minPlayerLevel || 0) > max) max = t.minPlayerLevel;
  }
  _levelFloor = max;
  return max;
}

// ONLY what the user typed. The inferred floor is a lower bound and nothing
// more: someone at level 45 who has not yet done a high-level quest would infer
// far too low, and locking on that would hide quests they can actually take —
// worse than the missing lock it was meant to fix. The estimate is offered in
// Settings as a suggestion, never applied on its own.
function playerLevel() {
  const set = state.settings && state.settings.playerLevel;
  const own = set && Number(set[state.gameMode]);
  return own > 0 ? own : 0;
}

// Fence reputation (Scav karma). It gates whole Fence quest lines and appears
// in NO log — the profile carries it, the logs do not — so the user states it
// in Settings, exactly like their level. Unset means 0, a fresh profile's
// value, which is also the honest default: it keeps the karma-penalty quests
// ("Compensation for Damage", reputation < -1) and the high-karma line
// ("Establish Contact", >= 4) out of the list until they say otherwise.
function scavKarma() {
  const set = state.settings && state.settings.scavKarma;
  const own = set && Number(set[state.gameMode]);
  return Number.isFinite(own) ? own : 0;
}

// ---------- trader standing (reputation + loyalty level) ----------
//
// EFT 1.1.0 re-hung much of the quest tree off TRADER LOYALTY LEVEL rather than
// prerequisite quests, which turned this from a Fence footnote into something
// the player needs at hand. Neither number appears in any log — the profile
// carries them, the logs do not — so both are typed in, per mode, per trader.
//
// Storage: settings.traderStanding[mode][traderName] = { rep, loyalty }.
// Fence's reputation keeps living in settings.scavKarma so an existing install
// keeps working and a downgrade keeps reading it; readers below merge the two.
function standingFor(trader, mode) {
  const all = (state.settings && state.settings.traderStanding) || {};
  const own = (all[mode || state.gameMode] || {})[trader] || {};
  const out = { rep: Number(own.rep), loyalty: Number(own.loyalty) };
  if (trader === 'Fence' && !Number.isFinite(out.rep)) {
    const k = state.settings && state.settings.scavKarma;
    const v = k && Number(k[mode || state.gameMode]);
    if (Number.isFinite(v)) out.rep = v;
  }
  return out;
}

// Every trader the loaded quest list actually gates something by, with how many
// quests each one gates. Data-driven on purpose: today that is Fence and
// Lightkeeper for reputation plus a handful for loyalty, but 1.1.0's rework is
// still landing upstream and this must not need editing when it does.
// Reputation is only worth asking about where the player can act on it. Fence's
// Scav karma opens and closes real quest lines; Lightkeeper's standing has
// gates in the data ("Make Amends", <= 0) but they are satisfied at the value
// everyone starts on, so asking for it would be a box that changes nothing.
const REP_TRADERS = new Set(['Fence']);
// Traders with no standing to speak of. The BTR Driver hands out quests but is
// a service, not a trader you level with.
const NO_STANDING = new Set(['BTR Driver']);

// Values offered ON TOP of the gate thresholds below. Nothing in the current
// data cares about +5, so by the rule below it would never appear — but a player
// sitting at +5 could then only record "+4", and the panel is also where you
// keep your own standing. Owner-asked. Kept as an explicit list rather than a
// range so it stays obvious that these are the ones no gate justifies, and so a
// real +5 gate landing upstream simply merges with it.
const EXTRA_REP = { Fence: [5] };

// The karma values that actually change something: 0, plus each distinct
// threshold the quest data gates on. Read from the data, so a new gate adds a
// button by itself. Fence today: 0, +1 (Is This a Reference?, Network Provider
// Part 1) and +4 (Establish Contact).
function repChoices(trader) {
  const vals = new Set([0]);
  for (const t of state.tasks || []) {
    for (const r of t.traderRequirements || []) {
      if (!r.trader || r.trader.name !== trader) continue;
      if (r.kind === 'loyalty') continue;
      if (!String(r.compareMethod).startsWith('>')) continue;   // negative gates: see below
      const v = Number(r.value);
      if (Number.isFinite(v) && v > 0) vals.add(v);
    }
  }
  // The Kappa gate's karma threshold lives in KAPPA_GATE, not in any task's
  // requirements, so deriving only from the quest list would offer 0/+1/+4 and
  // leave no way to say you are at the +3 Kappa needs.
  if (trader === 'Fence' && typeof KAPPA_GATE !== 'undefined' && KAPPA_GATE
    && Number.isFinite(Number(KAPPA_GATE.karma)) && Number(KAPPA_GATE.karma) > 0) {
    vals.add(Number(KAPPA_GATE.karma));
  }
  for (const v of EXTRA_REP[trader] || []) vals.add(v);
  return [...vals].sort((a, b) => a - b);
}

function tradersWithGates() {
  const out = new Map();
  const get = (n) => {
    if (!out.has(n)) out.set(n, { trader: n, reputation: 0, loyalty: 0, quests: new Set(), owns: 0 });
    return out.get(n);
  };
  for (const t of state.tasks || []) {
    // EVERY trader that hands out quests gets a row, not only the ones the data
    // currently gates something with. 1.1.0's loyalty requirements are landing
    // upstream a few at a time, and a player knows their own loyalty level long
    // before tarkov.dev publishes the gate — recording it now means those quests
    // lock correctly the moment it does.
    if (t.trader && t.trader.name) get(t.trader.name).owns++;
    for (const r of t.traderRequirements || []) {
      const n = r.trader && r.trader.name;
      if (!n) continue;
      const e = get(n);
      e[r.kind === 'loyalty' ? 'loyalty' : 'reputation']++;
      e.quests.add(t.id);
    }
  }
  for (const n of NO_STANDING) out.delete(n);
  // gating traders first (that is where a value changes something today), then
  // by how much of the quest list they own
  return [...out.values()].sort((a, b) =>
    (b.quests.size > 0) - (a.quests.size > 0) || b.quests.size - a.quests.size
    || b.owns - a.owns || a.trader.localeCompare(b.trader));
}

// does the player's karma satisfy this requirement?
function repMet(r, have) {
  const v = Number(r.value) || 0;
  switch (r.compareMethod) {
    case '<': return have < v;
    case '<=': return have <= v;
    case '>': return have > v;
    case '=': case '==': return have === v;
    default: return have >= v;
  }
}

// Reputation gates are only evaluated for traders we can actually know a value
// for. Fence is Scav karma; anything else (Lightkeeper's own standing) has no
// source, so it is shown but never used to lock.
function karmaIsSet() {
  const set = state.settings && state.settings.scavKarma;
  return !!set && Number.isFinite(Number(set[state.gameMode]));
}

// Now covers EVERY trader and BOTH kinds of gate, but the governing rule is
// unchanged for REPUTATION and is the important part: a value the player has not
// given us is not a value we may lock on. Loyalty level is now the exception —
// see below.
// Quests the player has confirmed are simply NOT in their game. 1.1.0 cut and
// reworked quests while both data sources still list them: "New Paths" appears
// in no trader's list at all, yet tarkov.dev publishes it and the wiki gives it
// a Peacekeeper LL1 gate the owner already meets. Nothing can be inferred from
// that — a quest being absent leaves no trace anywhere — so the player says so
// and the app believes them. Global, because it describes the game.
function questAbsent(taskId) {
  const all = (state.settings && state.settings.questAbsent) || {};
  return !!all[taskId];
}

// Quests the player has confirmed the game is OFFERING them, whatever this app
// worked out. It is the mirror of questAbsent and it exists for the same
// reason: 1.1.0 unlocks by trader loyalty, while both data sources still
// publish the pre-patch prerequisite chain. Measured on the owner's profile:
// 234 of 297 unfinished quests are prerequisite-locked, and they hand-checked
// 50 of them in game — 49 were available. The chain is not describing this
// game any more, and the wiki's copy of it is the same one (23 of 31 identical),
// so there is nothing to switch to. Dropping prerequisite locking outright is
// no answer either: that shows 252 quests at once. So the player overrides the
// individual quests they can see, and the app stops arguing.
// Quests that can never tick themselves off your logs, so the only way they
// ever get ticked is by hand. Two kinds: the ones added here by hand (they
// carry OUR id, and the log carries the game's), and any confirmed to write
// no completion message at all. Saying so on the row beats letting someone
// wait for a tick that is never coming.
function manualOnly(t) {
  if (!t) return false;
  if (t._handAdded) return true;
  return typeof MANUAL_ONLY !== 'undefined' && Array.isArray(MANUAL_ONLY)
    && MANUAL_ONLY.includes(t.id);
}

function questOpen(taskId) {
  const all = (state.settings && state.settings.questOpen) || {};
  return !!all[taskId];
}

// A loyalty level the PLAYER recorded for one quest, because the game gates it
// and no data source says so. Global rather than per mode: it is a fact about
// the quest, not about a character. Returns 0 when unset.
function questLoyalty(taskId) {
  const all = (state.settings && state.settings.questLoyalty) || {};
  const v = Number(all[taskId]);
  return Number.isFinite(v) && v >= 1 && v <= 4 ? v : 0;
}

// the same shape as a published gate, so every reader treats it identically
function userGate(t) {
  const need = questLoyalty(t.id);
  const trader = (t.trader || {}).name;
  if (!need || !trader) return null;
  return { trader: { name: trader }, kind: 'loyalty', compareMethod: '>=', value: need, fromUser: true };
}

function repLocked(t) {
  const mine = userGate(t);
  if (mine) {
    const have = standingFor(mine.trader.name).loyalty;
    // Unset standing still locks, exactly as an unset loyalty level does
    // everywhere else — the player has told us this quest needs a level, so
    // "I don't know mine" cannot mean "show it anyway".
    if (!Number.isFinite(have) || !repMet(mine, have)) return true;
  }
  for (const r of t.traderRequirements || []) {
    const trader = r.trader && r.trader.name;
    if (!trader) continue;
    const st = standingFor(trader);
    const have = r.kind === 'loyalty' ? st.loyalty : st.rep;
    if (Number.isFinite(have)) {
      // stated by the player — trust it in both directions
      if (!repMet(r, have)) return true;
      continue;
    }
    // UNSET LOYALTY LEVEL — hidden, by the owner's decision (v1.27.0). This is a
    // deliberate exception to "never hide on a guess", and it is defensible for
    // this one field: a loyalty gate is a statement about a number the player
    // can read off their own trader screen in two seconds, and the alternative
    // (show it) is what made a list of quests you cannot take look like a list
    // of quests you can. It is also self-correcting rather than sticky — one
    // click in TRADERS turns the whole trader back on, and the LOCKED tooltip
    // says exactly that. REPUTATION keeps the old rule: Fence's karma is a
    // decimal nobody knows offhand, so an unset one still hides nothing.
    if (r.kind === 'loyalty') return true;
    // The one blind reputation exception, kept from v1.18.0: a gate requiring
    // NEGATIVE reputation describes a state nobody reaches by accident, so
    // Fence's "Compensation for Damage" line stays hidden until told otherwise.
    if (String(r.compareMethod).startsWith('<') && Number(r.value) < 0
      && !repMet(r, 0)) return true;
  }
  return false;
}

// A blank loyalty level means that TRADER IS NOT UNLOCKED YET, so none of their
// quests are shown. That is the owner's rule and it is a stronger statement than
// "we don't know your level": Jaeger, Lightkeeper and Ref really are locked
// traders you earn, and for the rest a blank box after being asked for it reads
// the same way. One click on any level turns the whole trader back on.
//
// Two traders are exempt, because the panel gives them no level to click and the
// rule would hide them forever: Fence (Scav karma instead — REP_TRADERS) and
// BTR Driver (a service, not a trader — NO_STANDING).
let _unsetTraders = null;
function tradersWithoutLevel() {
  if (_unsetTraders) return _unsetTraders;
  _unsetTraders = new Set();
  for (const t of state.tasks || []) {
    const n = t.trader && t.trader.name;
    if (!n || _unsetTraders.has(n) || NO_STANDING.has(n) || REP_TRADERS.has(n)) continue;
    if (!Number.isFinite(standingFor(n).loyalty)) _unsetTraders.add(n);
  }
  return _unsetTraders;
}

function traderNotUnlocked(t) {
  const n = t.trader && t.trader.name;
  return !!n && tradersWithoutLevel().has(n);
}

// Which standing requirement actually locked it, worded for the tooltip. The
// tooltip used to say "needs Fence reputation your Scav karma does not meet"
// for every standing lock, which stopped being true the moment 1.1.0's loyalty
// gates arrived — a Ragman LL3 lock read as a complaint about Scav karma.
function repLockReason(t) {
  const mine = userGate(t);
  if (mine) {
    const have = standingFor(mine.trader.name).loyalty;
    if (!Number.isFinite(have)) {
      return `you recorded this as needing loyalty level ${mine.value} with ${mine.trader.name}, `
        + `and your ${mine.trader.name} level is not set`;
    }
    if (!repMet(mine, have)) {
      return `you recorded this as needing loyalty level ${mine.value} with ${mine.trader.name}, `
        + `and you are LL${have}`;
    }
  }
  for (const r of t.traderRequirements || []) {
    const trader = r.trader && r.trader.name;
    if (!trader) continue;
    const st = standingFor(trader);
    const have = r.kind === 'loyalty' ? st.loyalty : st.rep;
    if (Number.isFinite(have)) {
      if (repMet(r, have)) continue;
      return r.kind === 'loyalty'
        ? `needs loyalty level ${r.value} with ${trader} and you are LL${have}`
        : `needs ${trader} reputation ${r.compareMethod} ${r.value} and yours is ${have}`;
    }
    if (r.kind === 'loyalty') {
      return `needs loyalty level ${r.value} with ${trader}, and you have not set your `
        + `${trader} loyalty level — open TRADERS and click it to bring these back`;
    }
    if (String(r.compareMethod).startsWith('<')
      && Number(r.value) < 0 && !repMet(r, 0)) {
      return `needs ${trader} reputation ${r.compareMethod} ${r.value}, which nobody is at by accident`;
    }
  }
  return 'needs trader standing you do not have';
}

function levelLocked(t) {
  const need = t.minPlayerLevel || 0;
  const have = playerLevel();
  return need > 0 && have > 0 && need > have;
}

function isLocked(t) {
  // "not in my game" outranks the tracking mode: it is the player's own
  // statement, not an inference, so it holds even in manual mode where nothing
  // else locks.
  if (questAbsent(t.id) && !isDone(t.id)) return true;
  // ...and the player saying the game DOES offer it beats every derived reason,
  // for the same cause: their screen outranks a stale requirement graph.
  if (questOpen(t.id)) return false;
  return lockingActive() && !isDone(t.id)
    && (levelLocked(t) || repLocked(t) || traderNotUnlocked(t) || lightkeeperChainLocked(t));
}

// THE LIGHTKEEPER LINE, AND ONLY IT, LOCKS BEHIND ITS OWN CHAIN.
//
// The general case does not work: locking every quest on its published
// prerequisites hid 52 quests this profile's game was actively offering,
// because the game unlocks the next quest when you ACCEPT the previous one
// while tarkov.dev publishes ["complete"]. 43 contradictions with the in-game
// records under a completed-only rule; 0 once an accepted prerequisite counts.
// Until accepts are recorded as accepts, the chain cannot gate in general.
//
// This line is the exception, and it is not a hunch:
//
//   * 1.1.0 REBUILT it and the published chain matches what the game does —
//     Network Provider - Part 1 has no quest prerequisite at all, then NP2,
//     Assessment 1-3, Key to the Tower, Knock-Knock, strictly in order.
//   * the collection records ZERO Lightkeeper quests on this profile, and these
//     are MECHANIC quests on a trader captured IN FULL, so their absence is the
//     game's answer and not a gap in the capture.
//   * 7 quests, all flagged `lightkeeperRequired` by the publisher, so the set
//     is drawn by the data rather than by a name list here.
//
// Part 1 is the entry point and NO quest holds it: the wiki gates it on
// "progressing through the story chapter Batya", which this profile is doing,
// 13 objectives of 59, while the game still withholds the quest. So
// "progressing" is some specific point the wiki does not name, and a guess at
// one would be a guess about the only quest that starts the line. The chain
// rule therefore leaves Part 1 alone; what holds it is the unset-trader rule
// below, which the player clears the moment they set a Lightkeeper level.
function lightkeeperChainLocked(t) {
  if (!t || !t.lightkeeperRequired) return false;
  // THE TRADER HAS TO EXIST FOR YOU FIRST, which covers the entry point the
  // chain cannot. These are handed out by Mechanic, so `traderNotUnlocked`
  // asks about Mechanic and answers yes — but the line belongs to the
  // LIGHTKEEPER, and an unset level there is the player saying they have not
  // unlocked him. Same rule as every other trader, asked about the right one,
  // and it undoes itself the moment a level is clicked in TRADERS.
  if (tradersWithoutLevel().has('Lightkeeper')) return true;
  return !taskReachable(t.id);
}

// what it is waiting for, so the LOCKED row can say so
function chainBlockers(t) {
  const choice = new Set(anyOfIds(t));
  const out = [];
  for (const req of t.taskRequirements || []) {
    if (!req.task || choice.has(req.task.id)) continue;
    if (!reqSatisfied(req)) out.push(req.task.name);
  }
  return out;
}

// THE PRE-PATCH PREREQUISITE CHAIN GATES NOTHING, WITH ONE FENCED EXCEPTION.
//
// Removed entirely in v1.45.0, for the reasons below. The Lightkeeper line came
// back as a lock in v1.55.0 — see lightkeeperChainLocked() — because that line
// is the one 1.1.0 rebuilt and whose published order still matches the game,
// and because the owner's collection records ZERO Lightkeeper quests on a
// profile whose Mechanic list was captured in full. 7 quests, drawn by the
// publisher's own flag. Everything below still applies to every other quest:
// re-measured 2026-08-11, a general chain lock hides 52 quests the game is
// actively offering, because the game unlocks on ACCEPT and the data says
// [complete].
//
// History, because the reasoning matters more than the code that went: it was a
// LOCK until v1.38.0, when the owner read their own Woods list off the in-game
// task screen — the game showed 8, the app showed 4, and three of the four
// missing were held back by nothing but the chain. One, The Huntsman Path -
// Woods Keeper, requires Supply Plans, which they had FAILED, so the app hid it
// forever while the game handed it over. It was demoted to a note: a dim row
// tagged FOLLOWS, sorted below the clear ones.
//
// The note is now gone too, at the owner's call. It never earned its space:
// tarkov.dev has not corrected one requirement since 1.1.0 (checked repeatedly,
// most recently 2026-08-07: 510 tasks, zero changes), so the tag fired on quests
// the trader was already offering and said nothing a player could act on. Worse,
// it read as authority — a row saying it comes after something is a claim, and
// the claim was wrong for an unknowable share of the quests it marked.
//
// `taskRequirements` is still in the data, and taskReachable() still walks it for
// the prerequisite list in the details panel — it simply no longer decides
// anything. If a source ever publishes the 1.1.0
// unlock rules (loyalty, per wikireqs.js), that is what should drive a note
// here — not this.

// ---------- branch gates: a FAILURE to open, or a CHOICE of prerequisite ----
//
// A prerequisite row carries a `status`, and until now the only thing reading
// it was the requirement panel's "(must be failed)" note. Two shapes hide in
// there, and they are not variations on "do this first":
//
//   ["failed"]              The quest exists ONLY if you failed the other one.
//                           Hot Wheels - Let's Try Again is BTR Driver handing
//                           you the job again after you marked the wrong wheels.
//                           The other three are the make-amends quests a trader
//                           offers once you have taken a rival's side.
//   ["complete","failed"]   EITHER outcome will do. Already handled correctly by
//                           reqMet/reqSatisfied, and not a gate at all.
//
// And a third that is not in tarkov.dev's schema at all: "complete either of
// these", which arrives as `requiresAnyOf` off the wiki. Where a quest has one,
// the requirement rows naming those same quests are SUPERSEDED by it — the
// published file lists whichever arm tarkov.dev happened to keep, and ANDing
// that with the choice would demand a specific arm the game does not.
//
// This is the second thing in the app allowed to hide a quest on its own
// reasoning, and it earns it the same way the numbered lines do: it is not a
// claim about the 1.1.0 quest tree, it is what the quest's own data says about
// itself, and it is never silent — the list says how many and offers them back.

function failGates(t) {
  return (t.taskRequirements || []).filter((r) => r.task
    && (r.status || []).includes('failed') && !(r.status || []).includes('complete'));
}

// the alternatives we actually track, so a quest is never gated on an id the
// app has never heard of
function anyOfIds(t) {
  return (t.requiresAnyOf || []).filter((id) => state.byId.has(id));
}
function anyOfMet(t) {
  const ids = anyOfIds(t);
  return ids.length > 0 && ids.some((id) => isDone(id));
}

// Has anything told us the player has been offered this? The failure itself is
// the direct answer. Completing one of the alternatives is the SAME STATEMENT
// from the other side: the three-way choice between Big Customer, Out of
// Curiosity and Chemical - Part 4 fails the two you did not take, so finishing
// any of them is proof the other trader's version failed — and the app is far
// more likely to have seen a completion than a failure.
function failGateOpen(t) {
  const gates = failGates(t);
  if (!gates.length) return true;
  if (gates.some((r) => isFailed(r.task.id))) return true;
  return anyOfMet(t);
}

// Hidden from the list until something says otherwise. Every one of these is a
// statement by the PLAYER and outranks the gate: a tick, a failure, a marked
// objective, "the game does offer it", or the Settings switch.
function retryHidden(t) {
  if (!t || !t.onlyAfterFailure) return false;
  if (state.settings && state.settings.showRetryQuests) return false;
  if (isDone(t.id) || isFailed(t.id) || questOpen(t.id)) return false;
  if ((t.objectives || []).some((o) => isObjectiveDone(o.id))) return false;
  return !failGateOpen(t);
}

// ---- quests that are no longer POSSIBLE, not merely unavailable ------------
//
// A retry quest is hidden while nothing is known. Once the quest it waits on has
// been COMPLETED and cannot be re-taken, it is not hidden but impossible — and
// so is everything that needs it. Another Shipping Delay needs Inevitable
// Response, which needs Hot Wheels - Let's Try Again, which needs Hot Wheels
// FAILED; Hot Wheels is completed, so none of the three can ever happen.
//
// ⚠️ "NOT YET" AND "NEVER" ARE DIFFERENT, and only the second may propagate. A
// fresh profile has not failed Hot Wheels either, and stripping it of the whole
// branch it has not chosen yet would be far worse than listing one quest too
// many.
//
// ⚠️ ONLY AN UNAMBIGUOUS ["complete"] CARRIES THE POISON. A row that takes
// either outcome is satisfied BY the failure: The Huntsman Path - Woods Keeper
// needs Supply Plans "complete or failed", and reading that as a hard
// requirement is exactly what hid it while the game was handing it over
// (v1.38.0, see the note above isLocked). Read loosely, this rule also hides
// Hunting Trip, Stray Dogs and COLLECTOR off one failed Supply Plans.
let _impossible = null;
function impossibleSet() {
  if (_impossible) return _impossible;
  const out = new Set();
  const restartable = (id) => !!(state.byId.get(id) || {}).restartable;
  for (const t of state.tasks || []) {
    // a failure that cannot be re-taken can never become a completion
    if (isFailed(t.id) && !isDone(t.id) && !t.restartable) out.add(t.id);
    // a second chance for a mistake that was never made
    if (t.onlyAfterFailure) {
      const gates = failGates(t);
      const shut = gates.length && gates.every((r) => isDone(r.task.id) && !restartable(r.task.id));
      if (shut && !anyOfMet(t)) out.add(t.id);
    }
  }
  // Then forward, to a fixed point. Bounded rather than recursive: the
  // published requirement graph is not a proof that there are no cycles.
  for (let pass = 0; pass < 20; pass++) {
    let grew = false;
    for (const t of state.tasks || []) {
      if (out.has(t.id) || isDone(t.id)) continue;
      const choice = new Set(anyOfIds(t));
      // a choice survives while any one of its arms does
      if (choice.size && [...choice].some((id) => !out.has(id))) continue;
      const blocked = (t.taskRequirements || []).some((r) => {
        if (!r.task || choice.has(r.task.id)) return false;
        const st = r.status || ['complete'];
        return st.length === 1 && st[0] === 'complete' && out.has(r.task.id);
      });
      if (blocked) { out.add(t.id); grew = true; }
    }
    if (!grew) break;
  }
  _impossible = out;
  return out;
}

// Same escapes as everywhere else: the player outranks the graph.
function unreachable(t) {
  if (!t || !impossibleSet().has(t.id)) return false;
  if (state.settings && state.settings.showRetryQuests) return false;
  if (isDone(t.id) || isFailed(t.id) || questOpen(t.id)) return false;
  return !(t.objectives || []).some((o) => isObjectiveDone(o.id));
}

// what the list and the map both ask
function notInYourGame(t) { return retryHidden(t) || unreachable(t); }

// how many the rule alone is holding back, for the note that offers them back
function retryHiddenCount() {
  return (state.tasks || []).filter((t) => notInYourGame(t)).length;
}

// ---- one quest, several ids -------------------------------------------------
//
// "Either A or B" is not a shape the game's data has. What it holds instead is
// SEPARATE QUESTS with the same name and identical objectives, one per arm, each
// requiring its own arm — Make Amends is three ids, Battery Change two. Listed
// by id, that is one quest shown three times, and two of them are quests this
// player can never be offered.
//
// Which one to show: the one the player's own progress points at. A tick or a
// failure on one settles it outright; otherwise the arm whose prerequisite is
// done. With nothing to go on, the first, so the row is stable rather than
// jumping about as unrelated quests are ticked.
//
// Same footing as the numbered lines: it hides nothing the player could act on
// (the arms are identical), search ignores it, and the details panel says the
// quest has several versions.
let _armHidden = null;
function armState() {
  if (_armHidden) return _armHidden;
  const hidden = new Set();
  const seen = new Set();
  for (const t of state.tasks || []) {
    if (!(t.sameQuestAs || []).length || seen.has(t.id)) continue;
    const group = [t, ...t.sameQuestAs.map((id) => state.byId.get(id)).filter(Boolean)];
    for (const g of group) seen.add(g.id);
    if (group.length < 2) continue;
    const pick = group.find((g) => isDone(g.id) || isFailed(g.id))
      || group.find((g) => (g.taskRequirements || []).length
        && (g.taskRequirements || []).every((r) => r.task && isDone(r.task.id)))
      || group[0];
    for (const g of group) if (g.id !== pick.id) hidden.add(g.id);
  }
  _armHidden = hidden;
  return hidden;
}
// a copy of a quest belonging to a branch the player did not take
function otherArm(t) { return armState().has(t.id); }
// ---------- branch gates end ----------

// ---------- END OF LOCK LOGIC ----------
// _dev/test_locks.js slices this file from `function isDone` to this marker and
// runs the real functions. Renaming or deleting the line breaks that test — it
// used to end on an incidental "// Map -> Trader -> [tasks]" comment, which the
// grouping rewrite removed, and the slice silently ran to the end of the file.
// Keep new lock logic ABOVE this line.

// ---------- numbered quest lines ----------
// (_dev/test_series.js slices from here to "---------- grouping ----------")
//
// "Spa Tour - Part 2" cannot be done before Part 1, whatever any data source
// says, so a line of numbered parts shows ONE row: the lowest-numbered part you
// have not finished. Tick it and the next number takes its place.
//
// This is the one place the app hides something on its own reasoning, so it is
// worth being clear about why it is allowed here when the prerequisite chain is
// not. The chain is a claim about the GAME that patch 1.1.0 falsified. This is a
// claim about ARITHMETIC — Part 3 comes after Part 2 — and no patch changes
// that. It is also never silent: the visible row carries the count of the parts
// behind it, and search ignores the rule entirely, so typing the line's name
// still shows every part.
//
// Names are read AFTER the rename overlays, which is why the zone marker has to
// be handled: 1.1.0 renames moved the "[PVP ZONE]" suffix past the number.
//
// ⚠️ BUT THE LINE IS DETECTED FROM THE ORIGINAL NAME, NOT THE DISPLAYED ONE.
// 1.1.0 renamed 62 quests out of 24 numbered lines — "Test Drive - Part 5/6"
// became "Easy-Breezy"/"Unique Experience", all 13 Gunsmith parts became weapon
// names — and once the shown name no longer parses, the line dissolves and
// every later part stops being folded behind the one you can actually do. That
// looked exactly like the app ignoring its own gate: Unique Experience listed
// as available with Easy-Breezy untouched. Our own rename layer caused it, so
// the fix is to read the line off the pre-rename name, which `_oldName`
// preserves. Display is unaffected — only the arithmetic uses it.
const PART_RE = /^(.*?)[\s–-]+part\s+(\d+)\s*(\[(?:PVP|PVE) ZONE\])?\s*$/i;
// the name a numbered line is read from: what the source published, before the
// wiki rename overlay replaced it
const lineName = (t) => (t && (t._oldName || t.name)) || '';

function parsePart(name) {
  const m = PART_RE.exec(String(name || ''));
  if (!m) return null;
  return { base: m[1].trim().toLowerCase(), n: Number(m[2]), zone: (m[3] || '').toLowerCase() };
}

// id -> the parts of its line that are hidden behind it. Memoized per render,
// cleared in renderAll alongside the other progress-dependent memos.
let _seriesHidden = null;
function seriesState() {
  if (_seriesHidden) return _seriesHidden;
  const lines = new Map();
  for (const t of state.tasks || []) {
    const p = parsePart(lineName(t));
    if (!p) continue;
    const key = `${p.base}|${p.zone}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ id: t.id, n: p.n });
  }
  const hidden = new Set();
  const behind = new Map();
  for (const parts of lines.values()) {
    if (parts.length < 2) continue;
    // ⚠️ Two lines ship the same number twice — Drip-Out and Textile are
    // faction/edition variants sharing one name (see DEV-NOTES). There is no way
    // to tell which Part 1 pairs with which Part 2, so collapsing would hide a
    // variant at random. Leave those alone: showing four rows beats hiding the
    // wrong two.
    // Setting a PMC faction in Settings removes the other side's copies before
    // this ever runs, so those lines fold normally once it is set. This guard is
    // what happens when it is not.
    if (new Set(parts.map((p) => p.n)).size !== parts.length) continue;
    const open = parts.filter((p) => !isDone(p.id)).map((p) => p.n);
    if (!open.length) continue;              // whole line finished, nothing to fold
    const current = Math.min(...open);
    const later = parts.filter((p) => p.n > current);
    for (const p of later) hidden.add(p.id);
    const cur = parts.find((p) => p.n === current);
    if (cur && later.length) behind.set(cur.id, later.length);
  }
  _seriesHidden = { hidden, behind };
  return _seriesHidden;
}

// a later part of a line whose current part is still open
function laterPart(t) { return seriesState().hidden.has(t.id); }

// how many parts sit behind this one, for the row's tag (0 = none)
function partsBehind(t) { return seriesState().behind.get(t.id) || 0; }
// ---------- numbered lines end ----------

// ---------- grouping ----------
// The five ways the list can be grouped. The value is the order of the levels;
// an empty list is the flat "every quest in one list" view. `map-trader` is the
// original layout and stays the default.
const GROUPINGS = {
  'map-trader': ['map', 'trader'],
  'trader-map': ['trader', 'map'],
  map: ['map'],
  trader: ['trader'],
  flat: [],
};
const GROUP_KEY = {
  map: (t) => effectiveMap(t),
  trader: (t) => (t.trader && t.trader.name) || 'Unknown',
};
const GROUP_ORDER = { map: () => MAP_ORDER, trader: () => TRADER_ORDER };

function groupLevels() {
  return GROUPINGS[state.groupBy] || GROUPINGS['map-trader'];
}

// THE ORDER THE GAME PUTS THEM IN: LL1, LL2, LL3, LL4, Essential, then the
// ones we have never seen on a trader screen.
//
// `traderTab` is where the game files a quest, which is NOT its loyalty gate —
// LL1 and Essential both gate on nothing, so the requirement list cannot tell
// them apart and neither can it separate either from an unseen quest. That is
// why this reads the tab and not `traderRequirements`.
//
// Essential sits after LL4 because that is where the trader screen puts it, and
// unseen last because "we do not know" is not a position — 233 quests have no
// observation, and scattering them through the loyalty levels on a guess would
// make the order look measured when it is not.
const TAB_UNSEEN = 5;
function tabRank(t) {
  const tab = t && t.traderTab;
  if (tab === 'essential') return 4;
  if (typeof tab === 'number' && tab >= 1 && tab <= 4) return tab - 1;
  return TAB_UNSEEN;
}

// sink the ones you cannot act on, without hiding any of them
function sortQuests(list) {
  const locking = lockingActive();
  // three tiers, best first: go and do it / a gate the game really applies /
  // failed. There was a fourth between the first two for the pre-patch chain;
  // it went with the rest of that feature in v1.45.0.
  const rankOf = (t) => (isFailed(t.id) && !isDone(t.id)) ? 2
    : (locking && isLocked(t)) ? 1
    : 0;
  const rank = new Map(list.map((t) => [t.id, rankOf(t)]));
  // Trader tab first WITHIN a tier, not above it. The tiers are about whether
  // you can go and do the quest at all; a failed LL1 quest belongs under an
  // available LL4 one, and putting the tab outermost would float dead rows to
  // the top of every trader.
  list.sort((a, b) =>
    rank.get(a.id) - rank.get(b.id) ||
    tabRank(a) - tabRank(b) ||
    (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) ||
    a.name.localeCompare(b.name));
  return list;
}

// Nested grouping for any level order. Returns
//   { tasks: [...] }                                  when there are no levels
//   { kind, children: Map<name, node> }               otherwise
// where each child node is itself one of those two shapes. One shape for all
// five modes means the renderer has no per-mode branches.
function buildGroups(levels) {
  const all = state.tasks.filter(taskPassesFilter);
  const build = (list, depth) => {
    if (depth >= levels.length) return { tasks: sortQuests(list.slice()) };
    const kind = levels[depth];
    const keyOf = GROUP_KEY[kind];
    const buckets = new Map();
    for (const t of list) {
      const k = keyOf(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
    const children = new Map();
    for (const k of orderedKeys([...buckets.keys()], GROUP_ORDER[kind]())) {
      children.set(k, build(buckets.get(k), depth + 1));
    }
    return { kind, children };
  };
  return build(all, 0);
}

// every task under a node, at any depth
function nodeTasks(node) {
  if (node.tasks) return node.tasks;
  const out = [];
  for (const child of node.children.values()) out.push(...nodeTasks(child));
  return out;
}
// ---------- grouping end ----------

function orderedKeys(keys, orderList) {
  const known = orderList.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !orderList.includes(k) && k !== ANYWHERE).sort();
  const result = [...known, ...rest];
  if (keys.includes(ANYWHERE)) result.push(ANYWHERE);
  return result;
}

// ---------- story campaign ----------
//
// The in-game Tasks screen separates the STORY campaign (chapters of
// objectives on a hidden narrator "trader") from trader side tasks. tarkov.dev
// has no story data; STORY_DATA is baked from the community tarkov-data-overlay
// (see _dev/build_storydata.js). Chapter state is read from the game's own
// output logs by main.js (locked / active / done); per-OBJECTIVE progress never
// reaches any log, so objectives are ticked by hand, stored in the same
// progress.objectives bucket the quest-map right-click uses (BSG condition ids
// are globally unique, so the buckets cannot collide).

function storyChapters() {
  return (typeof STORY_DATA !== 'undefined' && STORY_DATA.chapters) || [];
}

function storyAuto() {
  const s = state.storyState && state.storyState[state.gameMode];
  return (s && s.chapters) ? s : { chapters: {}, subs: {} };
}

function chapterMainObjectives(c) { return c.objectives.filter((o) => o.type !== 'optional' && o.type !== 'section'); }

// chapter slug -> 'done' | 'active' | 'locked'
// done: the logs say so, or every main objective is RESOLVED (ticked or marked
// failed) with at least one actually ticked. Failed counts as resolved because
// branching chapters (The Ticket) list every ending's objectives as mains —
// only one branch is achievable, so demanding all of them ticked would make
// the chapter uncompletable; demanding "resolved" means you mark the endings
// you didn't take as failed and the one you did as done.
// locked: the logs say so, or (no log signal) a required prior chapter is not done.
// active: everything else — chapters are discovery-triggered, and we cannot see
// triggers, so absent any signal a chapter counts as reachable, not locked.
function chapterStatuses() {
  const auto = storyAuto();
  const done = new Set();
  for (const c of storyChapters()) {
    const mains = chapterMainObjectives(c);
    if (auto.chapters[c.questId] === 'done'
      || (mains.length
        && mains.every((o) => isObjectiveDone(o.id) || isObjectiveFailed(o.id) || isObjectiveMissed(o.id))
        && mains.some((o) => isObjectiveDone(o.id)))) done.add(c.id);
  }
  const st = {};
  for (const c of storyChapters()) {
    const a = auto.chapters[c.questId];
    st[c.id] = done.has(c.id) ? 'done'
      : a === 'active' ? 'active'
      : a === 'locked' ? 'locked'
      : c.autoStart ? 'active'
      : (c.requires || []).every((slug) => done.has(slug)) ? 'active'
      : 'locked';
  }
  return st;
}

// objective -> 'done' | 'failed' | 'missed' | 'locked' | 'open'
// hand-set marks outrank locked: they are the player's own statement, and
// hiding them behind LOCKED would make the mark look lost.
function storyObjectiveStatus(o, chapterState) {
  if (isObjectiveDone(o.id)) return 'done';
  if (isObjectiveFailed(o.id)) return 'failed';
  if (isObjectiveMissed(o.id)) return 'missed';
  if (chapterState === 'locked') return 'locked';
  if (storyAuto().subs[o.sourceQuestId]) return 'locked';
  return 'open';
}

// One-time explainer the first time any story-objective mark is used — the
// three mouse buttons are not discoverable from a tick box alone. Remembered in
// settings so it never repeats.
async function storyMarkHint() {
  const seen = (state.settings && state.settings.hintsSeen) || {};
  if (seen.storyMarks) return;
  toast('Story objectives: left-click ticks one off · right-click marks it FAILED · middle-click marks it MISSED. The same button again undoes the mark.');
  state.settings = await backend.saveSettings({ hintsSeen: { ...seen, storyMarks: true } });
}

function renderStoryTree(tree) {
  if (!storyChapters().length) {
    const msg = document.createElement('div');
    msg.className = 'tree-message';
    msg.textContent = 'No story data bundled with this build.';
    tree.appendChild(msg);
    return;
  }
  const hideC = !!(state.settings && state.settings.hideCompleted);
  const hideL = !!(state.settings && state.settings.hideLocked);
  const statuses = chapterStatuses();

  for (const c of storyChapters()) {
    const cState = statuses[c.id];
    if (hideC && cState === 'done') continue;
    if (hideL && cState === 'locked') continue;
    const mains = chapterMainObjectives(c);
    const doneCount = mains.filter((o) => isObjectiveDone(o.id)).length;
    const expanded = state.expandedChapters.has(c.id);

    const row = document.createElement('div');
    row.className = 'map-row chapter-row' + (state.selChapter === c.id ? ' selected' : '')
      + (cState === 'locked' ? ' chapter-locked' : '');
    row.innerHTML = `
      <span class="row-name">${escapeHtml(c.name.toUpperCase())}</span>
      <span class="row-toggle">${expanded ? '−' : '+'}</span>
      ${cState === 'done' ? '<span class="story-tag done">DONE</span>'
        : cState === 'locked' ? '<span class="story-tag locked">LOCKED</span>' : ''}
      <span class="row-count${cState === 'done' ? ' done' : ''}">${doneCount}/${mains.length}</span>`;
    row.querySelector('.row-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.expandedChapters.has(c.id)) state.expandedChapters.delete(c.id);
      else state.expandedChapters.add(c.id);
      renderAll();
    });
    row.addEventListener('click', () => {
      if (state.selChapter === c.id && state.expandedChapters.has(c.id)) {
        state.expandedChapters.delete(c.id);
      } else {
        state.expandedChapters.add(c.id);
      }
      state.selChapter = c.id;
      state.selQuestId = null;
      renderAll();
    });
    tree.appendChild(row);
    if (!expanded) continue;

    for (const o of c.objectives) {
      // section headers: the wiki's conditional / ending blocks, not tickable
      if (o.type === 'section') {
        const sec = document.createElement('div');
        sec.className = 'story-sec';
        sec.textContent = o.description.toUpperCase();
        tree.appendChild(sec);
        continue;
      }
      const oState = storyObjectiveStatus(o, cState);
      if (hideC && oState === 'done') continue;
      if (hideL && (oState === 'locked' || oState === 'failed' || oState === 'missed')) continue;
      const orow = document.createElement('div');
      orow.className = 'quest-row story-obj'
        + (o.indent ? ' sub' : '')
        + (oState === 'done' ? ' completed' : '')
        + (oState === 'failed' ? ' failed' : '')
        + (oState === 'missed' ? ' missed' : '')
        + (oState === 'locked' ? ' locked' : '')
        + (o.type === 'optional' ? ' optional' : '');
      // an OPEN objective says which map it is on (when its own text names one)
      const mapTag = oState === 'open' && o.maps.length
        ? `<span class="story-map">${escapeHtml(o.maps.join(' / ').toUpperCase())}</span>` : '';
      orow.innerHTML = `
        <span class="quest-name" title="${escapeHtml(o.description)}">${escapeHtml(o.description.toUpperCase())}</span>
        ${o.type === 'optional' ? '<span class="story-tag optional">OPTIONAL</span>' : ''}
        ${mapTag}
        ${oState === 'failed' ? '<span class="failed-tag" title="marked failed by hand — right-click the box to undo">FAILED</span>' : ''}
        ${oState === 'missed' ? '<span class="missed-tag" title="marked missed by hand — middle-click the box to undo">MISSED</span>' : ''}
        ${oState === 'locked' ? '<span class="locked-tag">LOCKED</span>' : ''}
        <span class="quest-check" title="${oState === 'done' ? 'ticked off — click to undo'
          : oState === 'failed' ? 'marked failed — right-click to undo, click to tick it done instead'
          : oState === 'missed' ? 'marked missed — middle-click to undo, click to tick it done instead'
          : 'The game never logs story objective progress — tick it off here yourself. Right-click marks it FAILED, middle-click marks it MISSED (passed by without failing).'}"></span>`;
      orow.querySelector('.quest-name').addEventListener('click', () => {
        state.selChapter = c.id;
        state.selQuestId = null;
        renderAll();
      });
      const check = orow.querySelector('.quest-check');
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        storyMarkHint();
        state.fullProgress = await backend.toggleObjective(o.id, oState !== 'done', state.gameMode);
        applyMode();
        renderAll();
      });
      // right-click marks the objective FAILED (or clears the mark) — story
      // branches mean some objectives genuinely cannot be completed, and the
      // logs say nothing about that either
      check.addEventListener('contextmenu', async (e) => {
        e.preventDefault(); e.stopPropagation();
        storyMarkHint();
        state.fullProgress = await backend.toggleObjective(o.id, oState === 'failed' ? false : 'failed', state.gameMode);
        applyMode();
        renderAll();
      });
      // middle-click marks it MISSED — the chance went by without a failure
      // (a one-raid opportunity you skipped). mousedown eats the autoscroll.
      check.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
      check.addEventListener('auxclick', async (e) => {
        if (e.button !== 1) return;
        e.preventDefault(); e.stopPropagation();
        storyMarkHint();
        state.fullProgress = await backend.toggleObjective(o.id, oState === 'missed' ? false : 'missed', state.gameMode);
        applyMode();
        renderAll();
      });
      tree.appendChild(orow);
    }
  }
}

// chapter details in the right-hand pane (reuses the quest-details containers)
function renderStoryChapter() {
  const c = storyChapters().find((x) => x.id === state.selChapter);
  $('questPlaceholder').style.display = c ? 'none' : '';
  $('questDetails').classList.toggle('hidden', !c);
  if (!c) return;
  const cState = chapterStatuses()[c.id];
  $('questName').textContent = c.name.toUpperCase();
  // The chapter's `wip` flag is still baked and still shown in the DEV editor —
  // it is how the owner tracks which chapters they have finished placing map
  // locations for. It is deliberately NOT surfaced here: to a player it read as
  // "this part of the app is unfinished" rather than "no pins on this one yet".
  $('questBadges').innerHTML = [
    '<span class="badge story">STORY CHAPTER</span>',
    cState === 'done' ? '<span class="badge done">COMPLETED</span>' : '',
    cState === 'locked' ? '<span class="badge locked">NOT DISCOVERED</span>' : '',
  ].join('');
  const mains = chapterMainObjectives(c);
  $('questMeta').textContent =
    `CHAPTER ${c.order} OF ${storyChapters().length}  ·  ${mains.length} OBJECTIVES`
    + (c.objectives.length > mains.length ? ` (+${c.objectives.length - mains.length} OPTIONAL)` : '');

  const objectives = c.objectives.map((o) => {
    if (o.type === 'section') return `<div class="story-sec pane">${escapeHtml(o.description)}</div>`;
    const oState = storyObjectiveStatus(o, cState);
    const maps = oState !== 'done' && o.maps.length ? ` — ${o.maps.join(' / ')}` : '';
    return `
    <div class="objective${o.indent ? ' sub' : ''}${o.type === 'optional' ? ' optional' : ''}${oState === 'done' ? ' ticked' : ''}${oState === 'failed' ? ' failedmark' : ''}${oState === 'missed' ? ' missedmark' : ''}"
         data-obj="${escapeHtml(o.id)}"
         title="${oState === 'done' ? 'ticked off by hand — click to undo'
           : oState === 'failed' ? 'marked failed by hand — right-click to undo, click to tick it done instead'
           : oState === 'missed' ? 'marked missed by hand — middle-click to undo, click to tick it done instead'
           : 'click to tick this objective off by hand · right-click marks it FAILED · middle-click marks it MISSED'}">
      <span class="bullet">${oState === 'done' ? '✔' : oState === 'failed' ? '✖' : oState === 'missed' ? '−' : oState === 'locked' ? '🔒' : '▪'}</span>
      <span>${escapeHtml(o.description)}${o.type === 'optional' ? ' (optional)' : ''}${escapeHtml(maps)}</span>
    </div>`;
  }).join('');
  const doneCount = c.objectives.filter((o) => isObjectiveDone(o.id)).length;
  const failCount = c.objectives.filter((o) => isObjectiveFailed(o.id)).length;
  const missCount = c.objectives.filter((o) => isObjectiveMissed(o.id)).length;
  $('questObjectives').innerHTML =
    `<h3>OBJECTIVES ${doneCount || failCount || missCount ? `<span class="obj-count">${doneCount}/${c.objectives.length} done${failCount ? ` · ${failCount} failed` : ''}${missCount ? ` · ${missCount} missed` : ''}</span>` : ''}</h3>`
    + `<div class="setting-hint">Chapter state (active / completed) is read from your game logs automatically; the game never logs per-objective progress, so tick objectives off here as you do them. Right-click an objective to mark it FAILED (endings and branches you did not take); middle-click marks it MISSED (a chance that passed you by).</div>`
    + objectives;
  for (const el of $('questObjectives').querySelectorAll('.objective[data-obj]')) {
    el.addEventListener('click', async () => {
      const id = el.dataset.obj;
      storyMarkHint();
      state.fullProgress = await backend.toggleObjective(id, !isObjectiveDone(id), state.gameMode);
      applyMode();
      renderAll();
    });
    el.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const id = el.dataset.obj;
      storyMarkHint();
      state.fullProgress = await backend.toggleObjective(id, isObjectiveFailed(id) ? false : 'failed', state.gameMode);
      applyMode();
      renderAll();
    });
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const id = el.dataset.obj;
      storyMarkHint();
      state.fullProgress = await backend.toggleObjective(id, isObjectiveMissed(id) ? false : 'missed', state.gameMode);
      applyMode();
      renderAll();
    });
  }
  $('questRequirements').innerHTML = (c.requires || []).length
    ? `<h3>REQUIREMENTS</h3>${c.requires.map((slug) => {
        const rc = storyChapters().find((x) => x.id === slug);
        const met = rc && chapterStatuses()[rc.id] === 'done';
        return `<div class="req-line${met ? ' prereq-done' : ''}"><span class="req-tag">CHAPTER</span><span>${escapeHtml(rc ? rc.name : slug)}</span></div>`;
      }).join('')}` : '';
  const wikiBtn = $('wikiBtn');
  wikiBtn.classList.toggle('hidden', !c.wikiLink);
  wikiBtn.onclick = () => backend.openWiki(c.wikiLink);
}

// ---------- tree rendering ----------

function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  if (state.filter === 'STORY') { renderStoryTree(tree); return; }
  if (state.filter === 'KAPPA' && typeof KAPPA_GATE !== 'undefined' && KAPPA_GATE) {
    renderKappaGate(tree); return;
  }
  if (!state.tasks.length) {
    const msg = document.createElement('div');
    msg.className = 'tree-message error';
    msg.textContent = (state.dataInfo && state.dataInfo.error)
      ? 'Could not load quest data. Check your internet connection, then use Settings → Refresh.'
      : 'Loading quest data…';
    tree.appendChild(msg);
    return;
  }

  // What the game asks for before it will hand a quest over, spelled out on the
  // row itself: LL<n> for a trader loyalty level, LVL<n> for a player level.
  // Worth the space because these are the two gates 1.1.0 actually uses, and
  // until now you had to open a quest to find out why it was out of reach.
  //
  // Three sources, all normalised to kind:'loyalty' before they get here —
  // tarkov.dev's own (6 quests), the wiki harvest (58, `fromWiki`), and the
  // player's own note on a quest (`fromUser`), which for most quests is the only
  // place the number exists at all. Deduped on trader+value so a published gate
  // and a hand-typed one that agree do not print twice.
  const reqTags = (t) => {
    const gates = [...(t.traderRequirements || []), userGate(t)]
      .filter((r) => r && r.kind === 'loyalty' && r.trader && r.trader.name);
    const seen = new Set();
    let out = '';
    for (const r of gates) {
      const key = r.trader.name + '|' + r.value;
      if (seen.has(key)) continue;
      seen.add(key);
      const have = standingFor(r.trader.name).loyalty;
      const src = r.fromUser ? 'you recorded this from the trader screen'
        : r.fromWiki ? 'from the wiki — tarkov.dev does not publish this one'
        : 'published requirement';
      out += `<span class="req-ll" title="Needs ${escapeHtml(r.trader.name)} loyalty level ${r.value}`
        + `${Number.isFinite(have) ? ` — yours is LL${have}` : ' — yours is not set'} · ${src}">`
        + `LL${r.value}</span>`;
    }
    // minPlayerLevel is already the CORRECTED number: applyWikiReqs zeroes the 79
    // the wiki says 1.1.0 dropped, so a level shown here is one the game still asks.
    const lvl = t.minPlayerLevel || 0;
    if (lvl > 0) {
      const mine = playerLevel();
      out += `<span class="req-lvl" title="Needs player level ${lvl}`
        + `${mine > 0 ? ` — you are ${mine}` : ' — your level is not set'}">LVL ${lvl}</span>`;
    }
    return out;
  };

  // Searching flattens the list: a match buried in a collapsed group is not a
  // result anyone can see, and expanding every group to reveal three hits is
  // worse than just showing the three hits. It also ignores the hide-completed/
  // locked/failed toggles — someone typing a name wants to know where that
  // quest IS, and "hidden by a filter" is indistinguishable from "missing".
  // Matches the current name, the pre-1.1.0 name (91 quests were renamed, and
  // the old names are what people remember), the trader and the map.
  const q = (state.searchQuery || '').trim().toLowerCase();
  const matchesSearch = (t) => t.name.toLowerCase().includes(q)
    || (t._oldName && t._oldName.toLowerCase().includes(q))
    || ((t.trader && t.trader.name) || '').toLowerCase().includes(q)
    || rowMapLabel(t).full.toLowerCase().includes(q);

  const levels = q ? [] : groupLevels();
  const root = buildGroups(levels);

  // display toggles: hide completed / hide locked quests. Rows are hidden but
  // the x/y counts stay based on the full list so progress context is kept.
  const hideC = !!(state.settings && state.settings.hideCompleted);
  const hideL = !!(state.settings && state.settings.hideLocked);
  const hideF = !!(state.settings && state.settings.hideFailed);
  // Search deliberately ignores every one of these, laterPart included: typing
  // "spa tour" is how you see a whole line at once.
  const isVisible = (t) => (q ? matchesSearch(t)
    : !laterPart(t)
    && !notInYourGame(t)
    && !otherArm(t)
    && !(hideC && isDone(t.id))
    && !(hideF && !isDone(t.id) && isFailed(t.id))
    && !(hideL && isLocked(t)));

  // What a quest row has to say for itself depends on what the grouping has
  // already said above it: grouped by map only, the row names its trader;
  // grouped by trader only, it names the map(s) it happens on; ungrouped, both.
  const grouped = new Set(levels);
  const wantTrader = !grouped.has('trader');
  const wantMap = !grouped.has('map');

  // The hero panel is driven by a map and a trader, and in three of the five
  // groupings the tree no longer supplies both. So selection reads whatever the
  // path DOES supply and takes the rest from the quest itself — that way
  // clicking a quest in the flat list still lights up the right art, exactly as
  // clicking it through map -> trader would.
  const selFrom = (path, t) => {
    let map = null;
    let trader = null;
    for (const p of path) {
      if (p.kind === 'map') map = p.name;
      else if (p.kind === 'trader') trader = p.name;
    }
    if (t) {
      if (map === null) map = effectiveMap(t);
      if (trader === null) trader = (t.trader && t.trader.name) || null;
    }
    return { map, trader };
  };
  const pathKey = (path) => path.map((p) => `${p.kind}:${p.name}`).join('|');

  const addQuestRow = (t, path) => {
    const done = isDone(t.id);
    // a completed record wins: you cannot have both, and completion is the
    // one the player acted on
    const failed = !done && isFailed(t.id);
    const locked = !failed && isLocked(t);
    const behind = partsBehind(t);
    const row = document.createElement('div');
    row.className = 'quest-row' +
      (done ? ' completed' : '') +
      (failed ? ' failed' : '') +
      (locked ? ' locked' : '') +
      (state.selQuestId === t.id ? ' selected' : '');
    row.style.marginLeft = (levels.length * 26) + 'px';
    const via = done && state.progress.completed[t.id] && state.progress.completed[t.id].via;
    const checkTitle = via === 'implied'
      ? "completed — worked out from a later quest you finished that required it. Tarkov never logged this one's hand-in. Click to untick."
      : done ? 'mark as not completed'
      : failed && t.restartable ? 'failed — but this one can be taken again from the trader. It will clear itself once you re-accept it in game.'
      : failed ? 'failed — Tarkov recorded this quest as failed, usually because you took a competing one instead. It cannot be handed in this wipe. Click to tick it anyway.'
      : locked && questAbsent(t.id) ? 'not in your game — you marked it as missing. Open it and use PUT IT BACK if that was wrong.'
      : locked && traderNotUnlocked(t) ? `locked — you have not set a loyalty level for ${(t.trader || {}).name}, so none of their quests are shown. Open TRADERS and click your level to bring them back.`
      : locked && repLocked(t) ? `locked — ${repLockReason(t)}. Open TRADERS if that is wrong.`
      : locked && levelLocked(t) ? `locked — needs player level ${t.minPlayerLevel} and you are ${playerLevel()}. Set your level in Settings if that is wrong.`
      : locked && lightkeeperChainLocked(t) && tradersWithoutLevel().has('Lightkeeper')
        ? 'locked — you have not set a loyalty level for the Lightkeeper, so none of his line is shown. '
          + 'Click a level under TRADERS to bring it back.'
      : locked && lightkeeperChainLocked(t) ? `locked — the Lightkeeper line runs in order and `
        + `${chainBlockers(t).join(', ') || 'an earlier quest'} is not done yet.`
      : locked ? 'locked — a requirement is not met (you can still tick it manually)'
      : 'mark as completed';
    const where = [];
    let whereTitle = '';
    if (wantTrader && t.trader && t.trader.name) {
      where.push(escapeHtml(t.trader.name.toUpperCase()));
      whereTitle = t.trader.name;
    }
    if (wantMap) {
      const m = rowMapLabel(t);
      where.push(escapeHtml(m.text.toUpperCase()));
      whereTitle = whereTitle ? `${whereTitle} · ${m.full}` : m.full;
    }
    row.innerHTML = `
      <span class="quest-lead">
        <span class="quest-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name.toUpperCase())}</span>
        ${done ? '' : reqTags(t)}
      </span>
      ${where.length ? `<span class="quest-where" title="${escapeHtml(whereTitle)}">${where.join('<span class="sep">·</span>')}</span>` : ''}
      ${failed ? `<span class="failed-tag${t.restartable ? ' retakeable' : ''}">${t.restartable ? 'RETAKE' : 'FAILED'}</span>` : ''}
      ${locked ? '<span class="locked-tag">LOCKED</span>' : ''}
      ${behind ? `<span class="part-tag" title="${behind} more part${behind === 1 ? '' : 's'} in this line, held back until you tick this one off. Search the line's name to see them all.">+${behind}</span>` : ''}
      ${!done && manualOnly(t) ? '<span class="manual-tag" title="This one never writes anything to the logs, so it can only be ticked by hand">MANUAL ONLY</span>' : ''}
      <span class="quest-check" title="${checkTitle}"></span>`;
    row.querySelector('.quest-name').addEventListener('click', () => {
      const sel = selFrom(path, t);
      state.selMap = sel.map;
      state.selTrader = sel.trader;
      state.selQuestId = t.id;
      renderAll();
    });
    row.querySelector('.quest-check').addEventListener('click', async (e) => {
      e.stopPropagation();
      state.fullProgress = await backend.toggleTask(t.id, !done, state.gameMode);
      applyMode();
      renderAll();
    });
    tree.appendChild(row);
  };

  const renderNode = (node, path, depth) => {
    if (node.tasks) {
      for (const t of node.tasks) if (isVisible(t)) addQuestRow(t, path);
      return;
    }
    for (const [name, child] of node.children) {
      const all = nodeTasks(child);
      const total = all.length;
      const doneCount = all.filter((t) => isDone(t.id)).length;
      // What the row reports is how many you can actually go and do now.
      // "12/21" answered a question nobody was asking: the completed ones are
      // already visible as struck-through rows and the total is trivia. This
      // is the number you plan a raid around.
      // A FAILED quest is not one you can go and do, so it cannot count here —
      // and with "hide failed" on it is not even on screen, which is how this
      // was found: Woods read 5 above four rows, the fifth being a failed
      // Supply Plans. Excluded whatever the hide toggles say, so the number
      // means the same thing in every view.
      // laterPart is excluded for the same reason failed is: a count that
      // includes rows the list does not draw is the bug this number exists to
      // avoid. There used to be a second number beside it for chain-pending
      // quests; it went with that feature in v1.45.0, and the quests it counted
      // now fall into `doable` — which is what the game says they are.
      const doable = all.filter((t) => !isDone(t.id) && !isLocked(t) && !isFailed(t.id) && !notInYourGame(t)
        && !laterPart(t)).length;
      // Not gated on the hide toggles any more: a line-folded node can be empty
      // with every toggle off, and search prunes non-matching groups through the
      // same test.
      if (!all.some(isVisible)) continue;   // nothing left to show here

      const here = path.concat([{ kind: node.kind, name }]);
      const key = pathKey(here);
      const expanded = state.expandedNodes.has(key);
      const sel = selFrom(here, null);
      const isSel = sel.map === state.selMap && sel.trader === state.selTrader;
      const isMap = node.kind === 'map';

      const row = document.createElement('div');
      // the kind classes stay whatever the row IS, because the harnesses in
      // main.js select on them; the depth class decides how it looks
      row.className = (isMap ? 'map-row' : 'trader-row') + ' d' + depth + (isSel ? ' selected' : '');
      row.innerHTML = `
        <span class="row-name">${escapeHtml(name.toUpperCase())}</span>
        <span class="row-toggle">${expanded ? '−' : '+'}</span>
        ${isMap && hasMapData(name) ? `<button class="map-btn" title="Open the ${escapeHtml(name)} map with your objectives pinned">▣</button>` : ''}
        <span class="row-count${doneCount === total ? ' done' : ''}" title="${doable} you can start now · ${doneCount} of ${total} finished">${doneCount === total ? 'all done' : doable}</span>`;
      const mb = row.querySelector('.map-btn');
      if (mb) mb.addEventListener('click', (e) => { e.stopPropagation(); openQuestMap(name); });
      // the +/- toggle expands or collapses on its own, without first having to
      // select the row (clicking the name still selects, as before)
      row.querySelector('.row-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.expandedNodes.has(key)) state.expandedNodes.delete(key);
        else state.expandedNodes.add(key);
        renderAll();
      });
      row.addEventListener('click', () => {
        if (isSel && state.expandedNodes.has(key)) state.expandedNodes.delete(key);
        else state.expandedNodes.add(key);
        state.selMap = sel.map;
        state.selTrader = sel.trader;
        renderAll();
      });
      tree.appendChild(row);
      if (expanded) renderNode(child, here, depth + 1);
    }
  };

  renderNode(root, [], 0);

  // Search gets its own empty-state and skips the hidden-trader note below —
  // that note explains the hide-filters, and search deliberately ignores them.
  if (q) {
    if (!tree.querySelector('.quest-row')) {
      const msg = document.createElement('div');
      msg.className = 'tree-message';
      msg.textContent = `Nothing matches "${state.searchQuery.trim()}" — trader and map names work too, `
        + 'and so do the pre-patch quest names.';
      tree.appendChild(msg);
    }
    return;
  }

  // A blank loyalty level hides that whole trader, which is a big enough effect
  // that the list has to admit it is happening — at the TOP, and not only when
  // the list comes out empty. A fresh install with nothing filled in otherwise
  // shows three quests from the two exempt traders and no reason for the rest
  // being gone, which reads as "the app is broken" rather than "answer the
  // question in TRADERS". Counts only what this rule ALONE is hiding, so the
  // number is the one that would come back.
  // Quests that exist only after a failure. Unlike the trader note below this
  // one is NOT tied to automatic tracking: the rule reads the quest's own data,
  // not the logs, so it applies in manual mode too.
  const retries = retryHiddenCount();
  if (retries) {
    const msg = document.createElement('div');
    msg.className = 'tree-message trader-note';
    msg.innerHTML = `<strong>${retries}</strong> quest${retries === 1 ? '' : 's'} hidden — `
      + `your game will not offer ${retries === 1 ? 'it' : 'them'}. Some only appear after you FAIL `
      + `another quest, like Hot Wheels - Let's Try Again after Hot Wheels; the rest need one of those. `
      + `Turn on <strong>Show quests you can no longer get</strong> in Settings to list `
      + `${retries === 1 ? 'it' : 'them'} anyway.`;
    tree.insertBefore(msg, tree.firstChild);
  }

  if (lockingActive()) {
    const unset = [...tradersWithoutLevel()];
    // no longer excludes chain-pending quests: since v1.38.0 the chain does not
    // hide anything, so setting the level really does bring those back too
    const hidden = unset.length ? (state.tasks || []).filter((t) => !isDone(t.id)
      && traderNotUnlocked(t) && !levelLocked(t) && !repLocked(t)).length : 0;
    if (hidden) {
      const msg = document.createElement('div');
      msg.className = 'tree-message trader-note';
      msg.innerHTML = `<strong>${hidden}</strong> quest${hidden === 1 ? '' : 's'} hidden — no loyalty level set for `
        + `<strong>${escapeHtml(unset.join(', '))}</strong>. A trader with no level counts as one you have `
        + `not unlocked. Click a level under <strong>TRADERS</strong> to bring them back.`;
      tree.insertBefore(msg, tree.firstChild);
    } else if (!tree.children.length) {
      const msg = document.createElement('div');
      msg.className = 'tree-message';
      msg.textContent = 'Nothing to show with the current filters — try turning off "hide locked" or "hide completed".';
      tree.appendChild(msg);
    }
  }
}

// ---------- hero (map + trader crossfade) ----------

// A missing image must never show as a broken frame: chapters without an icon
// (most, so far) just don't get one, and a banner that fails to load falls
// back to the empty-pane look. Wired once — renderHero only swaps src/class.
for (const [id, cls] of [['heroMap', 'visible'], ['heroChapterIcon', 'visible']]) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('error', () => el.classList.remove(cls));
}

function renderHero() {
  const heroMap = $('heroMap');
  const heroTrader = $('heroTrader');
  const heroEmpty = $('heroEmpty');
  const heroLabel = $('heroLabel');
  const heroTraderName = $('heroTraderName');
  const heroIcon = $('heroChapterIcon');

  // STORY: a chapter has no map or trader — show ITS banner and logo instead.
  // Paths derive from the chapter slug (images/story_<slug>_banner.png /
  // _icon.png), so art added later under that scheme appears with no code
  // change; a missing file just never gets the .visible class (onerror below).
  const chapter = state.filter === 'STORY' && state.selChapter
    ? storyChapters().find((c) => c.id === state.selChapter) : null;
  if (chapter) {
    const banner = `${IMG_DIR}story_${chapter.id}_banner.png`;
    const icon = `${IMG_DIR}story_${chapter.id}_icon.png`;
    heroEmpty.style.display = 'none';
    heroLabel.textContent = chapter.name.toUpperCase();
    if (heroMap.getAttribute('src') !== banner) heroMap.src = banner;
    heroMap.classList.add('visible', 'banner');
    if (heroIcon.getAttribute('src') !== icon) heroIcon.src = icon;
    heroIcon.classList.add('visible');
    heroTrader.classList.remove('visible');
    heroTrader.removeAttribute('src');
    heroTraderName.classList.add('hidden');
    return;
  }
  heroMap.classList.remove('banner');
  heroIcon.classList.remove('visible');
  heroIcon.removeAttribute('src');

  const mapName = state.selMap ? MAP_IMAGES[state.selMap.toLowerCase()] : null;
  const traderName = state.selTrader ? TRADER_IMAGES[state.selTrader.toLowerCase()] : null;
  const mapFile = mapName ? IMG_DIR + mapName : null;
  const traderFile = traderName ? IMG_DIR + traderName : null;

  // Grouped by trader alone there IS no map to select, so the panel keys off
  // either one. Without this, picking a trader dropped the hero back to the
  // "select a map on the left" placeholder with the portrait drawn over it.
  heroEmpty.style.display = (state.selMap || state.selTrader) ? 'none' : '';
  heroLabel.textContent = state.selMap ? state.selMap.toUpperCase()
    : (state.selTrader ? state.selTrader.toUpperCase() : '');

  if (mapFile) {
    if (heroMap.getAttribute('src') !== mapFile) heroMap.src = mapFile;
    heroMap.classList.add('visible');
  } else {
    heroMap.classList.remove('visible');
    heroMap.removeAttribute('src');
  }

  if (state.selTrader) {
    if (traderFile) {
      if (heroTrader.getAttribute('src') !== traderFile) heroTrader.src = traderFile;
      heroTrader.classList.add('visible');
      heroTraderName.classList.add('hidden');
    } else {
      // trader without a portrait (Lightkeeper, Ref, …): show the name instead
      heroTrader.classList.remove('visible');
      heroTrader.removeAttribute('src');
      heroTraderName.textContent = state.selTrader.toUpperCase();
      heroTraderName.classList.remove('hidden');
    }
  } else {
    heroTrader.classList.remove('visible');
    heroTrader.removeAttribute('src');
    heroTraderName.classList.add('hidden');
  }
}

// ---------- quest details ----------

function renderQuest() {
  if (state.filter === 'STORY') { renderStoryChapter(); return; }
  const t = state.selQuestId ? state.byId.get(state.selQuestId) : null;
  $('questPlaceholder').style.display = t ? 'none' : '';
  $('questDetails').classList.toggle('hidden', !t);
  if (!t) return;

  $('questName').textContent = t.name.toUpperCase();

  const badges = [];
  if (isDone(t.id)) badges.push('<span class="badge done">COMPLETED</span>');
  else if (isFailed(t.id)) {
    badges.push(t.restartable
      ? '<span class="badge failed" title="Tarkov recorded this as failed, but it can be taken again from the trader.">FAILED · CAN RETAKE</span>'
      : '<span class="badge failed" title="Tarkov recorded this as failed — usually because you took a competing quest instead. It cannot be handed in this wipe.">FAILED</span>');
  }
  if (!isFailed(t.id) && isLocked(t)) badges.push('<span class="badge locked">LOCKED</span>');
  if (!isDone(t.id) && manualOnly(t)) badges.push('<span class="badge manual" title="Nothing about this quest reaches the game logs, so the app can never tick it for you">MANUAL ONLY</span>');
  if (isKappaQuest(t)) badges.push('<span class="badge kappa">KAPPA</span>');
  if (t.lightkeeperRequired) badges.push('<span class="badge lightkeeper">LIGHTKEEPER</span>');
  $('questBadges').innerHTML = badges.join('');

  const metaBits = [];
  if (t.trader && t.trader.name) metaBits.push(`given by ${t.trader.name}`);
  metaBits.push(taskMapLabel(t));
  if (t.minPlayerLevel) metaBits.push(`level ${t.minPlayerLevel}+`);
  $('questMeta').textContent = metaBits.join('  ·  ').toUpperCase();

  // objectives = the quest description. Each can be ticked off by hand, the same
  // state the map's right-click sets, so the two views never disagree.
  const done = isDone(t.id);
  const objectives = (t.objectives || []).map((o) => {
    const off = !done && isObjectiveDone(o.id);
    return `
    <div class="objective${o.optional ? ' optional' : ''}${off ? ' ticked' : ''}"
         data-obj="${escapeHtml(o.id || '')}"
         title="${done ? '' : off ? 'ticked off by hand — click to undo' : 'click to tick this objective off by hand'}">
      <span class="bullet">${off ? '✔' : '▪'}</span>
      <span>${escapeHtml(o.description || '')}${o.optional ? ' (optional)' : ''}</span>
    </div>`;
  }).join('');
  const objDone = (t.objectives || []).filter((o) => !done && isObjectiveDone(o.id)).length;
  const heading = objDone ? `OBJECTIVES <span class="obj-count">${objDone}/${(t.objectives || []).length} done</span>` : 'OBJECTIVES';
  // 1.1.0 reworked 47 quests' objectives outright, and tarkov.dev still ships
  // the old list. Where the COUNT differs there is no honest one-to-one swap, so
  // the current list is shown as text above the tickable rows rather than
  // reshaping them: the objective ids carry the tick state and the map pins, and
  // inventing or dropping rows to match would move someone's ticks onto a
  // different objective. Same-length rewordings are already swapped in place by
  // applyWikiObjectives (they mostly ADD the count the data leaves out).
  const fresh = (typeof WIKI_OBJ_LIST !== 'undefined' && WIKI_OBJ_LIST && WIKI_OBJ_LIST[t.id]) || null;
  const freshBlock = fresh ? `<div class="obj-current"><div class="obj-current-head">`
    + `THE GAME NOW LISTS ${fresh.length}</div>`
    + fresh.map((line) => `<div class="obj-current-row">▪ ${escapeHtml(line)}</div>`).join('')
    + `<div class="obj-current-note">Patch 1.1.0 changed this quest's objectives. The tickable list below is `
    + `the older one the quest data still publishes — it is kept because your ticks and the map pins hang off it.`
    + `</div></div>` : '';
  $('questObjectives').innerHTML = objectives ? `<h3>${heading}</h3>${freshBlock}${objectives}` : '';
  if (!done) {
    for (const el of $('questObjectives').querySelectorAll('.objective[data-obj]')) {
      const id = el.dataset.obj;
      if (!id) continue;
      el.addEventListener('click', async () => {
        state.fullProgress = await backend.toggleObjective(id, !isObjectiveDone(id), state.gameMode);
        applyMode();
        if (mapView.name && !$('mapOverlay').classList.contains('hidden')) {
          mapView.pins = collectMapPins(mapView.name);
          renderMapLoadout(mapView.name);
          drawMap();
        }
        renderAll();
      });
    }
  }

  // requirements: level, prerequisite quests, keys, items
  const reqs = [];
  if (t._handAdded) {
    reqs.push('<div class="req-line"><span class="req-tag">ADDED</span><span>'
      + 'Patch 1.1.0 added this quest and the quest data has never published it, so it was entered by hand. '
      + 'It cannot tick itself from your logs — tick it here when you finish it.</span></div>');
  }
  if (t.minPlayerLevel) {
    const short = levelLocked(t);
    reqs.push(`<div class="req-line${short ? ' prereq-missing' : ''}"><span class="req-tag">LEVEL</span>`
      + `<span>player level ${t.minPlayerLevel}${short ? ` — you are ${playerLevel()}` : ''}</span></div>`);
  }
  // The trader themselves. Without this line a quest can show LOCKED with a
  // Requirements list that explains nothing — the blank loyalty level is not one
  // of the quest's own requirements, it is a statement about the trader.
  if (traderNotUnlocked(t)) {
    reqs.push('<div class="req-line prereq-missing"><span class="req-tag">TRADER</span>'
      + `<span>${escapeHtml((t.trader || {}).name || '')} counts as not unlocked, because you have not `
      + 'set a loyalty level for them. Click one under TRADERS and their quests come back.</span></div>');
  }
  // Trader standing, both kinds. This used to render every row as KARMA and
  // compare it against Fence's Scav karma, so a "Ragman loyalty level 3" gate
  // came out as "Ragman reputation at least 3 — yours is 3.64" — the wrong
  // number, against the wrong requirement, reported as fact.
  for (const r of t.traderRequirements || []) {
    if (!r.trader) continue;
    const loyalty = r.kind === 'loyalty';
    const have = loyalty ? standingFor(r.trader.name).loyalty : standingFor(r.trader.name).rep;
    // only claim a comparison when the player has actually stated the value —
    // otherwise the line would report a guess ("yours is 0") as fact. An UNSET
    // loyalty level is highlighted all the same, because since v1.27.0 it is
    // what is holding the quest back, and this line is where you look to find
    // out why.
    const known = Number.isFinite(have);
    const short = loyalty ? (!known || !repMet(r, have)) : (known && !repMet(r, have));
    const sign = { '<': 'below', '<=': 'at most', '>': 'above', '=': 'exactly', '==': 'exactly' }[r.compareMethod] || 'at least';
    const what = loyalty
      ? `loyalty level ${sign === 'at least' ? '' : sign + ' '}${r.value}`
      : `reputation ${sign} ${r.value}`;
    reqs.push(`<div class="req-line${short ? ' prereq-missing' : ''}">`
      + `<span class="req-tag">${loyalty ? 'TRADER' : 'KARMA'}</span>`
      + `<span>${escapeHtml(r.trader.name)} ${what}`
      + `${known ? ` — yours is ${loyalty ? 'LL' + have : have}` : ' — not set'}`
      // where it came from matters here: tarkov.dev publishes almost none of
      // 1.1.0's loyalty gates yet, so most of these are read off the wiki
      + `${r.fromWiki ? ' <span class="req-src">wiki</span>' : ''}</span></div>`);
  }
  // highlight each prerequisite with the same status-aware logic that
  // decides LOCKED: green = positively met, yellow = the one blocking it.
  // Only for a quest the app actually locks — the prerequisite list is still
  // shown for everything else, just without an unmet one painted as a blocker,
  // because outside the Lightkeeper line the app makes no claim that the chain
  // gates (v1.45.0, and re-measured in v1.55.0).
  const showMissing = isLocked(t);
  const choice = new Set(anyOfIds(t));
  if (choice.size) {
    const met = anyOfMet(t);
    const names = [...choice].map((id) => escapeHtml((state.byId.get(id) || {}).name || id));
    reqs.push(`<div class="req-line${met ? ' prereq-done' : ''}">`
      + `<span class="req-tag">EITHER</span><span>${names.join(' &nbsp;or&nbsp; ')}</span></div>`);
  }
  // The tag column is 52px and every other tag in here is six characters or
  // fewer, so the count goes in the text rather than the label.
  if ((t.sameQuestAs || []).length) {
    const n = t.sameQuestAs.length + 1;
    reqs.push('<div class="req-line"><span class="req-tag">ONE OF</span>'
      + `<span>The game publishes this quest ${n} times, one per branch — you are offered the `
      + 'version matching the quest you took.</span></div>');
  }
  for (const req of t.taskRequirements || []) {
    if (!req.task) continue;
    // An arm of a choice is not a requirement on its own. It is already listed,
    // above, as the EITHER line it belongs to; repeating it here would read as
    // "and also this one specifically", which is the misreading the choice
    // exists to correct.
    if (choice.has(req.task.id)) continue;
    const statuses = reqStatuses(req);
    const met = reqMet(req);
    const missing = showMissing && !reqSatisfied(req);
    const failOnly = statuses.includes('failed') && !statuses.includes('complete');
    const either = statuses.includes('failed') && statuses.includes('complete');
    const label = escapeHtml(req.task.name)
      + (either ? ' — completed or failed, either way' : '');
    reqs.push(`<div class="req-line${met ? ' prereq-done' : ''}${missing ? ' prereq-missing' : ''}">
      <span class="req-tag">${failOnly ? 'FAILED' : 'QUEST'}</span><span>${label}</span></div>`);
  }
  // keys: objective.requiredKeys is [[key]] — outer list = alternatives,
  // inner list = keys needed together
  const keyLines = new Set();
  for (const o of t.objectives || []) {
    if (!Array.isArray(o.requiredKeys)) continue;
    const label = o.requiredKeys
      .map((set) => (set || []).map((k) => escapeHtml(k.name)).join(' + '))
      .filter(Boolean)
      .join('  or  ');
    if (label) keyLines.add(label);
  }
  for (const label of keyLines) {
    reqs.push(`<div class="req-line"><span class="req-tag">KEY</span><span>${label}</span></div>`);
  }

  // items to hand in / plant / build
  for (const o of t.objectives || []) {
    if (o.optional) continue;
    const kind = String(o.type || '').toLowerCase();
    if (kind === 'buildweapon' && o.item) {
      reqs.push(`<div class="req-line"><span class="req-tag">BUILD</span><span>${escapeHtml(o.item.name)}</span></div>`);
      continue;
    }
    const items = o.items || [];
    if (!items.length || !o.count) continue;
    if (kind !== 'giveitem' && kind !== 'plantitem' && kind !== 'sellitem') continue;
    const fir = o.foundInRaid ? ' <span class="fir">FOUND IN RAID</span>' : '';
    const names = items.slice(0, 3).map((i) => escapeHtml(i.name)).join(' / ') + (items.length > 3 ? ' / …' : '');
    reqs.push(`<div class="req-line"><span class="req-tag">ITEM</span><span>${names} ×${o.count}${fir}</span></div>`);
  }
  // THE GAP, and why this control exists: 1.1.0 hung the quest tree off trader
  // loyalty, and 468 of 510 quests have no loyalty requirement published by
  // anyone — not tarkov.dev, not the wiki, whose page for "New Day, New Paths"
  // is a 23-byte stub. The game knows and the player can read it off the trader
  // screen in two seconds, so let them say it, the same way they already state
  // their level and their standing. Offered only where nothing is published for
  // the quest's OWN trader; a gate that is already known needs no override.
  const ownTrader = (t.trader || {}).name;
  const published = (t.traderRequirements || []).some((r) => r.kind === 'loyalty'
    && (r.trader || {}).name === ownTrader);
  const canSetLoyalty = ownTrader && !published
    && !REP_TRADERS.has(ownTrader) && !NO_STANDING.has(ownTrader);
  const absent = questAbsent(t.id);
  const cur = questLoyalty(t.id);
  {
    // One row for everything only the player can tell us about this quest. The
    // loyalty half is offered where no gate is published (468 of 510 quests);
    // the "not in my game" half is offered always, because a quest that 1.1.0
    // cut leaves no trace in any data source and the level it once needed is
    // beside the point.
    let body;
    if (absent) {
      body = 'Marked as <strong>not in your game</strong> — hidden with the locked quests.';
    } else if (canSetLoyalty) {
      body = cur
        ? `You set this to need <strong>${escapeHtml(ownTrader)} loyalty level ${cur}</strong>`
        : 'Shown here but not in game? Set the loyalty level '
          + `${escapeHtml(ownTrader)} is asking for`;
    } else {
      body = 'Shown here but not in game?';
    }
    const llButtons = (!absent && canSetLoyalty)
      ? `<span class="ll-buttons inline">${[1, 2, 3, 4].map((n) =>
        `<button class="ll-btn${cur === n ? ' on' : ''}" data-quest-ll="${n}" `
        + `title="${cur === n ? 'Click again to clear' : `Needs loyalty level ${n} with ${escapeHtml(ownTrader)}`}">${n}</button>`).join('')}</span>`
      : '';
    const open = questOpen(t.id);
    if (open) body = 'You marked this as <strong>available in your game</strong>, so it is shown as open.';
    reqs.push(`<div class="req-line user-gate${absent ? ' prereq-missing' : ''}">`
      + `<span class="req-tag">IN GAME</span><span>${body}${llButtons}`
      + (absent ? '' : `<button class="absent-btn${open ? ' on' : ''}" data-quest-open="1" `
        + `title="${open ? 'Go back to what the app works out' : 'The trader is offering you this now, whatever the app thinks — show it as open'}">`
        + `${open ? 'UNDO' : 'I HAVE THIS'}</button>`)
      + `<button class="absent-btn${absent ? ' on' : ''}" data-quest-absent="1" `
      + `title="${absent ? 'Put it back in the list' : 'This quest does not exist in your game at all — hide it'}">`
      + `${absent ? 'PUT IT BACK' : 'NOT IN MY GAME'}</button></span></div>`);
  }

  $('questRequirements').innerHTML = reqs.length ? `<h3>REQUIREMENTS</h3>${reqs.join('')}` : '';
  for (const b of $('questRequirements').querySelectorAll('.ll-btn[data-quest-ll]')) {
    b.addEventListener('click', () => {
      setQuestLoyalty(t.id, b.classList.contains('on') ? null : Number(b.dataset.questLl));
    });
  }
  const ab = $('questRequirements').querySelector('.absent-btn[data-quest-absent]');
  if (ab) ab.addEventListener('click', () => setQuestAbsent(t.id, !absent));
  const ob = $('questRequirements').querySelector('.absent-btn[data-quest-open]');
  if (ob) ob.addEventListener('click', () => setQuestOpen(t.id, !questOpen(t.id)));

  const wikiBtn = $('wikiBtn');
  wikiBtn.classList.toggle('hidden', !t.wikiLink);
  wikiBtn.onclick = () => backend.openWiki(t.wikiLink);
}

// ---------- tabs / status / settings ----------

function renderTabs() {
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.filter === state.filter);
  });
  // STORY and KAPPA render checklists, not quest lists — a search box over a
  // checklist would be a promise the tree cannot keep
  $('searchBar').classList.toggle('hidden', state.filter === 'STORY' || state.filter === 'KAPPA');
}

// One builder for every mode's task list, used by boot and by the refresh button.
// PvE falls back to the PvP list when upstream returns nothing for it (the
// long-standing rule); SEASONAL always borrows it, because no seasonal quest
// data exists anywhere yet. Borrowed lists are FLAGGED, never silently swapped:
// state.seasonAliased drives the banner that says so.
function buildTasksByMode() {
  const d = state.dataInfo || {};
  if (!d.regular) return;
  const pve = (d.pve && d.pve.length) ? d.pve : d.regular;
  // Seasonal has its own published list now; the PvP borrow is only the fallback
  // for a cache written before it existed, or a failed seasonal fetch.
  const season = (d.season && d.season.length) ? d.season : d.regular;
  state.tasksByMode = { regular: d.regular, pve, season };
  state.seasonAliased = d.seasonAliased !== false;
  applyWikiReqs();   // additive: gates the wiki knows and tarkov.dev has not published
  applyWikiNames();  // 1.1.0 renamed ~90 quests; the data source still has the old names
  addExtraQuests();      // quests 1.1.0 added that tarkov.dev has never published
  applyWikiObjectives(); // 1.1.0 reworked objectives; the data still has the old text
  applyQuestFixes(); // last: what the owner has read off the game itself
}

// Used in the RESET confirmation ("this only affects X"), so a wrong label here
// mislabels a destructive action.
function modeLabel(mode) { return modeLabels()[mode] || mode; }

function renderModeSwitch() {
  // [data-mode] on purpose: the faction switch next door uses the same class.
  document.querySelectorAll('.mode-btn-top[data-mode]').forEach((el) => {
    el.classList.toggle('on', el.dataset.mode === state.gameMode);
  });
  renderSeasonNote();
}

// PMC faction, in the titlebar since it belongs beside the profile switch.
//
// The tooltip counts the quests it actually affects rather than describing the
// feature — a control that changes nothing visible reads as broken, and this one
// changes very few rows. That count is why it was worth keeping when the setting
// moved out of Settings, where it had a line of its own to say it in.
function renderFactionSwitch() {
  const fac = (state.settings && state.settings.pmcFaction) || 'any';
  document.querySelectorAll('#factionSwitch .mode-btn-top').forEach((el) => {
    el.classList.toggle('on', el.dataset.faction === fac);
  });
  const split = ((state.tasksByMode || {})[state.gameMode] || []).filter((t) => t.factionName);
  $('factionSwitch').title = split.length
    ? (fac === 'any'
      ? `${split.length} quests are offered to one faction only, and all of them are listed. `
        + 'Pick yours to see just those.'
      : `Showing the ${fac} version of the ${split.length} quests that come in two.`)
    : 'Some quests are offered to BEAR or USEC only. None are in this list.';
}

// Record (or clear) the loyalty level a quest needs, as read off the trader
// screen in game. Applied locally and not adopted back from the reply — the
// same lost-update the TRADERS panel and setGroupBy both had.
// Mark a quest as absent from this player's game, or put it back.
function setQuestAbsent(taskId, absent) {
  const all = { ...((state.settings && state.settings.questAbsent) || {}) };
  if (absent) all[taskId] = true; else delete all[taskId];
  state.settings = { ...state.settings, questAbsent: all };
  backend.saveSettings({ questAbsent: all });
  renderAll();
}

// Mark a quest as one the game is offering, or hand it back to the app's own
// reasoning.
function setQuestOpen(taskId, open) {
  const all = { ...((state.settings && state.settings.questOpen) || {}) };
  if (open) all[taskId] = true; else delete all[taskId];
  state.settings = { ...state.settings, questOpen: all };
  backend.saveSettings({ questOpen: all });
  renderAll();
}

function setQuestLoyalty(taskId, value) {
  const all = { ...((state.settings && state.settings.questLoyalty) || {}) };
  if (value === null) delete all[taskId]; else all[taskId] = value;
  state.settings = { ...state.settings, questLoyalty: all };
  backend.saveSettings({ questLoyalty: all });
  renderAll();
}

function renderGroupSwitch() {
  document.querySelectorAll('.group-btn').forEach((el) => {
    el.classList.toggle('on', el.dataset.group === state.groupBy);
  });
}

// Switching the grouping throws the open/closed state away rather than trying
// to translate it: "Customs > Prapor" has no counterpart in a trader-only list,
// and a half-mapped set of open rows is more confusing than a closed one. The
// SELECTION is kept — the hero and the open quest should not move because you
// changed how the list is sorted.
function setGroupBy(mode) {
  if (!GROUPINGS[mode] || mode === state.groupBy) return;
  state.groupBy = mode;
  state.expandedNodes.clear();
  // Apply locally and do NOT adopt the reply. saveSettings returns the WHOLE
  // settings object as it was when the write landed, so adopting it throws away
  // anything changed while the request was in flight — switch grouping, then
  // immediately toggle "hide completed", and the reply puts the toggle back.
  // This is the same lost-update the TRADERS panel had; only the field differs.
  state.settings = { ...state.settings, groupBy: mode };
  backend.saveSettings({ groupBy: mode });
  renderGroupSwitch();
  renderAll();
}

// The seasonal quest list is borrowed from PvP, and the user is told so plainly
// rather than being left to discover it. Two claims only, both of which we can
// actually stand behind: no seasonal data has been published, and because of
// that nothing here is marked as locked. It does NOT claim the list is wrong —
// it is unverified, which is a weaker and more honest statement.
function renderSeasonNote() {
  const el = $('seasonNote');
  if (!el) return;
  // Shown in seasonal WHATEVER the source. Having the real list did not make the
  // unlock requirements real — they are still PvP's, copied — so the caveat has
  // to survive the data arriving, only reworded. It disappears when the gates
  // stop being a copy, not when the list does.
  const show = state.gameMode === 'season';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const on = !!(state.settings && state.settings.seasonPvpRules);
  const source = state.seasonAliased
    ? '<strong>Seasonal PvP — this quest list is a best guess.</strong> '
      + 'The seasonal quest data could not be fetched, so this shows the PvP list. '
    : '<strong>Seasonal PvP — real quest list, unverified unlock requirements.</strong> '
      + 'This is the published seasonal list, but its level, prerequisite and loyalty '
      + 'requirements are copied from PvP. ';
  // The choice is offered here rather than buried in Settings, because this
  // banner is the only place the situation is explained. Both sides of it are
  // stated plainly: nothing hidden, or a filtered list that can hide too much.
  const state2 = on
    ? 'Quests are being locked with <strong>PvP\'s rules</strong>, which seasonal does not '
      + 'always follow — something you can actually take may be hidden.'
    : 'They do not match what seasonal actually does, so <strong>nothing here is marked '
      + 'LOCKED</strong>. Your seasonal ticks never touch PvP or PvE.';
  el.innerHTML = `${source}${state2} <button id="seasonRulesBtn" class="season-rules-btn">`
    + `${on ? 'SHOW EVERYTHING' : 'USE PvP UNLOCK RULES'}</button>`;
  $('seasonRulesBtn').addEventListener('click', async () => {
    state.settings = await backend.saveSettings({ seasonPvpRules: !on });
    renderAll();
    renderSeasonNote();
  });
}

// switch the viewed game mode: repoint active views, persist, re-render
function setGameMode(mode) {
  if (mode === state.gameMode || !modes().includes(mode)) return;
  state.gameMode = mode;
  applyMode();
  if (state.settings) state.settings.modeAutoResolved = true;
  backend.setGameMode(mode); // persists gameMode + modeAutoResolved
  // collapse selection that may not exist in the other mode
  state.selQuestId = state.selQuestId && state.byId.has(state.selQuestId) ? state.selQuestId : null;
  renderModeSwitch();
  renderAll();
}

function renderStatus() {
  const line = $('statusLine');
  if (!state.settings) { line.innerHTML = ''; return; }
  if (state.settings.trackingMode === 'auto') {
    const ws = state.watcherStatus;
    const ok = ws.active && ws.logsFound;
    const cls = ws.active ? (ws.logsFound ? 'on' : 'err') : '';
    const txt = ws.active
      ? (ws.logsFound ? `AUTO TRACKING · watching logs` : 'AUTO TRACKING · logs folder not found')
      : 'AUTO TRACKING · starting…';
    line.innerHTML = `<span class="status-dot ${cls}"></span><span>${txt}</span>`;
    line.title = ok ? `${ws.sessionFolders} session folder(s)` : (state.settings.logsPath || '');
  } else {
    line.innerHTML = `<span class="status-dot"></span><span>MANUAL TRACKING</span>`;
  }
}

function renderSettingsPanel() {
  if (!state.settings) return;
  $('modeManual').classList.toggle('active', state.settings.trackingMode === 'manual');
  $('modeAuto').classList.toggle('active', state.settings.trackingMode === 'auto');
  $('modeHint').textContent = state.settings.trackingMode === 'auto'
    ? 'The app reads the EFT log files and automatically marks quests as completed — including quests you finished while the app was closed (as far back as your log files go). You can still tick quests by hand.'
    : 'Tick the circle next to a quest to mark it completed.';
  $('logsGroup').style.opacity = state.settings.trackingMode === 'auto' ? '1' : '.45';
  if (document.activeElement !== $('logsPathInput')) {
    $('logsPathInput').value = state.settings.logsPath || '';
  }

  // display toggles
  for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked'],
    ['hideFailedBtn', 'hideFailed'], ['showRetryBtn', 'showRetryQuests']]) {
    const on = !!state.settings[key];
    $(btnId).textContent = on ? 'ON' : 'OFF';
    $(btnId).classList.toggle('on', on);
  }
  // locked and failed both come from the logs, so both need automatic tracking
  const auto = state.settings.trackingMode === 'auto';
  $('hideLockedRow').style.opacity = auto ? '1' : '.45';
  $('hideFailedRow').style.opacity = auto ? '1' : '.45';
  {
    const story = new Set(storyObjectiveIds());
    const ticks = Object.keys((state.progress && state.progress.objectives) || {});
    const s = ticks.filter((id) => story.has(id)).length;
    const q = Object.keys((state.progress && state.progress.completed) || {}).length;
    const hint = $('resetHint');
    if (hint) {
      hint.textContent = `${modeLabel(state.gameMode)}: ${s} story objective${s === 1 ? '' : 's'} ticked, `
        + `${q} quest${q === 1 ? '' : 's'} completed. The two are tracked separately, so either can be `
        + 'cleared on its own.';
    }
  }
  $('displayHint').textContent = auto
    ? 'With all three on, the list only shows quests you can take on right now.'
    : 'Hiding locked and failed quests needs AUTOMATIC tracking — that is how the app knows about them.';

  // player level — typed in, or inferred from the hardest quest already finished
  const set = (state.settings.playerLevel || {})[state.gameMode];
  if (document.activeElement !== $('playerLevelInput')) {
    $('playerLevelInput').value = set > 0 ? set : '';
  }
  const floor = inferredLevel();
  $('playerLevelAuto').textContent = floor > 0 ? `USE ${floor}` : 'USE ESTIMATE';
  $('playerLevelAuto').disabled = floor <= 0;
  $('levelHint').innerHTML = set > 0
    ? `Quests that need a higher level than <strong>${set}</strong> now show as LOCKED. Clear the box to switch it off.`
    : floor > 0
      ? `Not set, so quests are never locked on level. You are <strong>at least ${floor}</strong> — you finished a quest that needs it — but Tarkov never writes your real level to the logs, so type it in to get exact locking.`
      : 'Not set. Tarkov never writes your level to the logs, so type it in and quests needing a higher level will show as LOCKED.';

  // Scav karma — same deal as the level: the logs never carry it, and it gates
  // whole Fence quest lines in both directions.
  // Trader standing moved to its own header panel in 1.1.0 — Settings just
  // points at it now, and says how much is currently riding on it.
  {
    const gated = tradersWithGates();
    const nQuests = new Set(gated.flatMap((g) => [...g.quests])).size;
    const stated = gated.filter((g) => {
      const st = standingFor(g.trader);
      return Number.isFinite(st.rep) || Number.isFinite(st.loyalty);
    }).length;
    $('karmaHint').innerHTML = gated.length
      ? `Your loyalty level and reputation with each trader gate <strong>${nQuests}</strong> quest(s) here.`
        + ` Tarkov never writes either number to the logs, so you type them in —`
        + ` <strong>TRADERS</strong>, at the top. ${stated} of ${gated.length} filled in.`
        + ` Anything left blank is never used to hide a quest.`
      : 'No quest in the current list is gated by trader standing.';
  }

  const ws = state.watcherStatus;
  $('logsStatus').innerHTML = state.settings.trackingMode !== 'auto'
    ? 'Only used when tracking is set to AUTOMATIC.'
    : (ws.logsFound
      ? `<span class="ok">Logs folder found</span> — ${ws.sessionFolders} session folder(s) scanned.`
      : `<span class="bad">Logs folder not found.</span> If your game is not installed in the default location, point this at your EFT\\Logs folder.`)
    + (ws && ws.oldProfiles > 0
      // A wipe hands out a NEW profile and the old one's logs stay on disk.
      // Those completions are skipped rather than imported (they belong to
      // last wipe) — saying so beats letting people wonder where they went.
      ? `<br><span class="ok">Skipping ${ws.oldProfileEvents} quest event(s) from ${ws.oldProfiles} earlier profile(s)</span>`
        + ` — progress from before a wipe. If the list still shows quests you have not done this wipe,`
        + ` use RESET ALL PROGRESS once to clear them.`
      : '');

  const di = state.dataInfo;
  $('dataStatus').innerHTML = !di ? 'Loading…'
    : di.source === 'online'
      ? `<span class="ok">Up to date</span> — fetched just now from tarkov-quest-data (${state.tasks.length} quests).`
      : di.source === 'cache'
        ? `Using cached data from ${new Date(di.fetchedAt).toLocaleString()} (${state.tasks.length} quests). Refresh when online.`
        : `<span class="bad">No data.</span> Connect to the internet and refresh.`;

  // Patch 1.1.0 reworked the Collector requirements, and tarkov.dev still ships
  // the pre-patch graph. Saying so beats letting the KAPPA tab be quietly wrong —
  // and beats hard-coding a requirement list the community is still arguing about.
  // Drop this line once the upstream data reflects the new gate.
  $('dataStatus').innerHTML += '<br><span class="warn-note">Kappa changed in patch 1.1.0.</span>'
    + ' The quest data still carries the old 257-task Collector requirement, so the KAPPA tab uses'
    + ' the new gate from the wiki instead. It may change as that is confirmed.';

  renderMapArtSettings();
  if (typeof renderUpdateSection === 'function') renderUpdateSection();
}

function renderAll() {
  _reachMemo = new Map(); // progress may have changed since last render
  _reachStack.clear();    // defensive: never carry a partial DFS across renders
  _levelFloor = null;     // a new completion can raise the inferred level
  _unsetTraders = null;   // a level clicked in TRADERS turns a whole trader back on
  _seriesHidden = null;   // ticking Part 2 promotes Part 3 into its place
  _armHidden = null;      // ticking one arm of a branch settles which copy is shown
  _impossible = null;     // a completion can close a branch, or a tick reopen one
  applyMapArt();          // the chosen artwork, before anything reads MAP_DATA
  renderFactionSwitch();
  renderTabs();
  renderTree();
  renderHero();
  renderQuest();
  renderStatus();
  renderSettingsPanel();
}

// ---------- sidebar width ----------

// widen the sidebar so the longest quest name fits without truncating,
// even on a locked row with the tree's scrollbar visible
function fitSidebarWidth() {
  // measure across BOTH modes so the width is stable when switching PvP/PvE
  const all = [...(state.tasksByMode.regular || []), ...(state.tasksByMode.pve || [])];
  if (!all.length) return;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '700 13px Bender, sans-serif';
  let max = 0;
  for (const t of all) {
    const name = t.name.toUpperCase();
    const w = ctx.measureText(name).width + name.length * 0.6; // + letter-spacing
    if (w > max) max = w;
  }
  ctx.font = '900 10px Bender, sans-serif';
  const tagW = ctx.measureText('LOCKED').width + 6 * 1.2 + 6; // letter-spacing + margin
  // row: 52 indent + 8 pad-l + name + tag + 8 gap + 15 checkbox + 6 pad-r
  // chrome: 18 tree padding + 8 scrollbar + 1 sidebar border, + 6 safety
  const width = Math.min(620, Math.max(300, Math.ceil(max + tagW) + 52 + 8 + 8 + 15 + 6 + 27 + 6));
  const sb = $('sidebar');
  sb.style.width = width + 'px';
  sb.style.minWidth = width + 'px';
}

// ---------- toasts ----------

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------- util ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- wiring ----------

document.querySelectorAll('.tab').forEach((el) => {
  el.addEventListener('click', () => {
    state.filter = el.dataset.filter;
    backend.saveSettings({ filter: state.filter });
    renderAll();
  });
});

document.querySelectorAll('.mode-btn-top').forEach((el) => {
  el.addEventListener('click', () => setGameMode(el.dataset.mode));
});

document.querySelectorAll('.group-btn').forEach((el) => {
  el.addEventListener('click', () => setGroupBy(el.dataset.group));
});

// quest search: live, cheap enough at 510 rows to re-render per keystroke
$('questSearch').addEventListener('input', () => {
  state.searchQuery = $('questSearch').value;
  $('searchClear').classList.toggle('hidden', !state.searchQuery.trim());
  renderTree();   // only the tree — the hero/details should not jump while typing
});
$('questSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { clearSearch(); $('questSearch').blur(); }
});
$('searchClear').addEventListener('click', clearSearch);
function clearSearch() {
  if (!state.searchQuery) return;
  state.searchQuery = '';
  $('questSearch').value = '';
  $('searchClear').classList.add('hidden');
  renderTree();
}

// ---------- first-run guide ----------
//
// Shown once per app VERSION: a new install sees it, and so does an existing
// user after an update, because every release so far has changed something a
// player would otherwise have to discover by accident (story ticks, the mode
// buttons, seasonal, trader standing). Stored as settings.guideSeenVersion.
//
// Content rule: every card explains something the UI does NOT make obvious on
// its own. No card describes a button that already says what it does.
const GUIDE_CARDS = [
  {
    title: 'IT READS YOUR LOGS — MOST TICKS ARE AUTOMATIC',
    body: 'Tarkov writes a line to its log files when a trader hands you a quest reward, and this app watches for it. '
      + 'Finish a quest in game and it ticks itself here, usually within a few seconds. '
      + 'You never have to import anything, and nothing is sent anywhere — it only reads files already on your PC.',
  },
  {
    title: 'STORY QUESTS HAVE TO BE TICKED BY HAND',
    body: 'The STORY tab is the exception, and it is the thing people miss. '
      + 'Story chapters come from a hidden trader that sends no messages, so <strong>nothing about them ever reaches the logs</strong> — '
      + 'the app cannot see them at all. Tick their objectives yourself as you go. '
      + 'Left click marks one done; right click marks it failed; middle click marks it missed.',
  },
  {
    title: 'SOME NORMAL QUESTS ALSO NEED A HAND',
    body: 'A few quests never write a completion message either — Ref\'s Arena line is the worst offender, '
      + 'and quests that break and get fixed server-side can complete in silence. '
      + 'Click any quest to tick it yourself. Nothing is ever filled in on a guess — if the log did not say it, '
      + 'the app will not tick it for you.',
  },
  {
    title: 'PvP, PvE AND SEASON ARE THREE SEPARATE CHARACTERS',
    body: 'The buttons at the top right switch between them, and each keeps its own progress, its own level and its own trader standing. '
      + 'Patch 1.1.0 added SEASON — a seasonal character that wipes each season, while PvP and PvE now carry over. '
      + 'Resetting progress only ever affects the mode you are looking at. '
      + 'Seasonal publishes no unlock requirements of its own yet, so nothing there is marked LOCKED — '
      + 'the banner at the top of that mode can switch it to PvP\'s rules if you would rather have a shorter list.',
  },
  {
    title: 'TELL IT YOUR LEVEL AND TRADER STANDING',
    body: 'Tarkov never writes your player level, trader loyalty levels or reputation to the logs, so the app cannot know them. '
      + 'Put your level in Settings and your trader standing under <strong>TRADERS</strong> at the top. '
      + 'Patch 1.1.0 unlocks a lot of quests by trader loyalty level, which is why that moved out of Settings. '
      + 'Be aware that the quest data has barely caught up: the loyalty requirement is published for only a few dozen quests so far, '
      + 'so setting your levels correctly will still leave plenty of quests showing that the game gates behind a higher trader level. '
      + 'The TRADERS panel says how many it currently knows about. '
      + '<strong>Fill in a level for every trader you have unlocked</strong> — one you leave blank is treated as a trader you have not '
      + 'unlocked yet, and none of their quests are shown until you click a level. That is the first thing to check if the list looks short. '
      + '<strong>If a quest shows here but the game will not give it to you</strong>, open it and use the IN GAME row at the bottom of its requirements '
      + 'to record the loyalty level the trader is asking for. Most quests have no published requirement yet, so this is often the only place that number exists — '
      + 'and once you reach that level the quest comes back on its own.',
  },
  {
    title: 'QUEST LINES SHOW ONE PART AT A TIME',
    body: 'Part 3 of anything cannot be done before Part 2, so a numbered line shows only the part you are actually on. '
      + 'Tick it off and the next number takes its place. The small <strong>+3</strong> next to the quest is how many parts are waiting behind it. '
      + 'This is the one thing the app hides by its own reasoning rather than because a trader is gating it — '
      + 'search the line\'s name any time you want to see all of it at once.',
  },
  {
    title: 'THE LIST CAN BE GROUPED FIVE WAYS',
    body: 'The row of buttons under MAPS and TRADERS decides how the quest list is arranged. '
      + '<strong>MAP&#8594;TRADER</strong> is the original: maps, then the traders on them. '
      + '<strong>TRADER&#8594;MAP</strong> turns that around when you are working through one trader. '
      + '<strong>MAP</strong> and <strong>TRADER</strong> drop a level and show the other one next to each quest, '
      + 'and <strong>LIST</strong> drops both and gives you every quest in one run, each labelled with its trader and its map. '
      + 'A quest that can be done anywhere says so; one that spans several maps names them.',
  },
  {
    title: 'THE MAPS ARE CLICKABLE, AND THE PINS ARE APPROXIMATE',
    body: 'MAPS at the top opens any map, whether you have quests on it or not. Quest objectives, extracts, keys, loose loot and hazards '
      + 'each have their own tick box in the layers panel. Scroll to zoom, drag to move, double click to reset. '
      + 'Pin positions are converted from game coordinates and are close, not exact — treat them as "look around here".',
  },
];

function guideVersion() {
  return String(upd.current || '');
}

function shouldShowGuide() {
  if (!state.settings) return false;
  const seen = state.settings.guideSeenVersion;
  const now = guideVersion();
  if (!now) return false;              // version unknown — do not nag
  return seen !== now;
}

let guideAt = 0;

function renderGuide() {
  const card = GUIDE_CARDS[guideAt];
  $('guideStep').textContent = `${guideAt + 1} / ${GUIDE_CARDS.length}`;
  $('guideBody').innerHTML = `<h3>${card.title}</h3><p>${card.body}</p>`;
  $('guideDots').innerHTML = GUIDE_CARDS
    .map((_, i) => `<span class="guide-dot${i === guideAt ? ' on' : ''}"></span>`).join('');
  $('guideBack').disabled = guideAt === 0;
  $('guideNext').textContent = guideAt === GUIDE_CARDS.length - 1 ? 'DONE' : 'NEXT';
}

function closeGuide() {
  $('guideOverlay').classList.add('hidden');
  const v = guideVersion();
  if (!v) return;
  state.settings = { ...state.settings, guideSeenVersion: v };
  backend.saveSettings({ guideSeenVersion: v }).then((s) => { if (s) state.settings = s; });
}

function openGuide(force) {
  if (!force && !shouldShowGuide()) return;
  guideAt = 0;
  renderGuide();
  $('guideOverlay').classList.remove('hidden');
}

$('guideNext').addEventListener('click', () => {
  if (guideAt >= GUIDE_CARDS.length - 1) { closeGuide(); return; }
  guideAt++;
  renderGuide();
});
$('guideBack').addEventListener('click', () => { if (guideAt > 0) { guideAt--; renderGuide(); } });
$('guideSkip').addEventListener('click', closeGuide);
$('showGuideBtn').addEventListener('click', () => {
  $('settingsOverlay').classList.add('hidden');
  openGuide(true);
});
document.addEventListener('keydown', (e) => {
  if ($('guideOverlay').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeGuide();
  else if (e.key === 'ArrowRight') $('guideNext').click();
  else if (e.key === 'ArrowLeft') $('guideBack').click();
});

// ---------- TRADERS: your standing, which now unlocks much of the tree ----------
//
// Built from the loaded quest list rather than a fixed trader table, so as
// tarkov.dev publishes more of 1.1.0's loyalty-level gates the panel fills in by
// itself. Both numbers are per MODE, because the three profiles are three
// separate characters with separate standings.
function renderTraders() {
  const gated = tradersWithGates();
  $('traderMode').textContent = modeLabel(state.gameMode);
  const nQuests = new Set(gated.flatMap((g) => [...g.quests])).size;
  // The denominator is the honest part and it is the question players actually
  // ask ("I set everything to LL1, why did nothing disappear?"). 1.1.0 hung a
  // lot of the tree off loyalty, but tarkov.dev publishes the gate for 5 quests
  // and the wiki for another 32 — so setting a level correctly changes very
  // little yet, and saying so beats letting it look broken.
  const total = (state.tasks || []).length;
  $('traderIntro').innerHTML = gated.length
    ? `Tarkov keeps your standing with each trader out of the logs, so it has to be set here.`
      + ` <strong>${nQuests}</strong> of the ${total} quests in this list have a published standing`
      + ` requirement — patch 1.1.0 gates far more than that in game, but the quest data does not`
      + ` say which yet, so the rest cannot be filtered by loyalty however you set these.`
      + ` <strong>A trader with no loyalty level set counts as one you have not unlocked, so none of`
      + ` their quests are shown</strong> — click any level to bring them back. Scav karma is the`
      + ` exception: blank there still hides nothing.`
      + ` These are your <strong>${escapeHtml(modeLabel(state.gameMode))}</strong> values; each mode is its own character.`
    : `Nothing in the current quest list is gated by trader standing.`
      + ` Patch 1.1.0 moved a lot of unlocks onto trader loyalty level, so expect this to fill in`
      + ` as the quest data catches up.`;

  // Each control matches the shape of the thing it sets:
  //   loyalty level is 1-4 and nothing in between  -> four buttons
  //   reputation is a running decimal              -> pick the whole number,
  //                                                   then dial in the fraction
  // Which one a trader gets is read from the data, not from a list of names, so
  // it stays right as 1.1.0's rework lands upstream. A trader the data does not
  // gate anything by yet still gets the loyalty buttons — that is the number
  // 1.1.0 unlocks by, and recording it now costs nothing.
  $('traderList').innerHTML = gated.map((g) => {
    const st = standingFor(g.trader);
    const rows = [];
    const showRep = REP_TRADERS.has(g.trader) && g.reputation > 0;
    const showLoyalty = !showRep;

    if (showLoyalty) {
      const cur = Number.isFinite(st.loyalty) ? st.loyalty : null;
      rows.push(`<div class="trader-control">
        <div class="trader-control-label">LOYALTY LEVEL</div>
        <div class="ll-buttons">${[1, 2, 3, 4].map((n) =>
          `<button class="ll-btn${cur === n ? ' on' : ''}" data-trader="${escapeHtml(g.trader)}" data-loyalty="${n}"
            title="${cur === n ? 'Click again to clear' : 'Set loyalty level ' + n}">${n}</button>`).join('')}
        </div>
      </div>`);
    }

    if (showRep) {
      const cur = Number.isFinite(st.rep) ? st.rep : null;
      // Only the values that CHANGE something. Karma is a decimal, but nothing
      // in the quest data cares where between the thresholds you sit — Fence's
      // gates are ">= 1" and ">= 4" and nothing else — so the exact figure was
      // a number to look up for no gain. The choices are the thresholds
      // themselves, read from the data, plus 0 for "below the first one".
      // If BSG adds a gate at 6, a sixth button appears here on its own.
      // EXTRA_REP adds any value we offer WITHOUT a gate behind it, so the
      // tooltip can say plainly that picking it unlocks nothing — it records
      // where you actually are.
      const steps = repChoices(g.trader);
      const ungated = new Set(EXTRA_REP[g.trader] || []);
      rows.push(`<div class="trader-control">
        <div class="trader-control-label">SCAV KARMA</div>
        <div class="rep-buttons">${steps.map((n) => {
    const on = cur !== null && cur === n;
    const what = n === 0 ? 'Below +1 — the usual starting point'
      : ungated.has(n) ? `At least +${n} — above every gate in the current data, so this only records your standing`
      : `At least +${n}`;
    return `<button class="rep-btn${on ? ' on' : ''}" data-trader="${escapeHtml(g.trader)}" data-rep="${n}"
            title="${on ? 'Click again to clear' : escapeHtml(what)}">${n > 0 ? '+' : ''}${n}</button>`;
  }).join('')}
        </div>
      </div>`);
    }

    // Only count gates this card can actually DO something about: Lightkeeper's
    // reputation rows are real in the data but unaskable here, so claiming the
    // card gates them would be a promise it cannot keep.
    const live = showRep ? g.reputation : g.loyalty;
    const kind = showRep ? 'Scav karma' : 'loyalty level';
    const sub = live
      ? `gates ${live} quest(s) by ${kind}`
      : `${g.owns} quest(s) — none gated by standing in the current data`;
    return `<div class="trader-card${live ? '' : ' ungated'}">
      <div class="trader-card-head">
        <span class="trader-card-name">${escapeHtml(g.trader.toUpperCase())}</span>
        <span class="trader-card-gates">${sub}</span>
      </div>
      ${rows.join('')}
    </div>`;
  }).join('');

  // Writing a value is the same operation whichever control produced it.
  const write = (trader, key, val) => {
    const all = { ...(state.settings.traderStanding || {}) };
    const forMode = { ...(all[state.gameMode] || {}) };
    const entry = { ...(forMode[trader] || {}) };
    if (val === null) delete entry[key]; else entry[key] = val;
    if (!Object.keys(entry).length) delete forMode[trader];
    else forMode[trader] = entry;
    all[state.gameMode] = forMode;
    state.settings = { ...state.settings, traderStanding: all };
    // ⚠️ Adopt everything the save returns EXCEPT the standing we just wrote.
    // Each click builds its object from `state.settings`, and the reply to an
    // EARLIER click carries an older `traderStanding`; taking it wholesale threw
    // away every click made while that reply was in flight, and the NEXT click
    // then saved the shrunken object over the good one. Clicking down the list
    // at a normal pace lost most of it — one profile kept 3 of 10 traders — and
    // nothing looked wrong, because the buttons never re-rendered from the reply.
    backend.saveSettings({ traderStanding: all }).then((s) => {
      if (s) state.settings = { ...s, traderStanding: state.settings.traderStanding };
    });
    renderAll();
    renderTraders();
  };

  for (const b of $('traderList').querySelectorAll('.ll-btn')) {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.loyalty);
      // clicking the level you are already on clears it — back to "unknown",
      // which is the state that never hides anything
      write(b.dataset.trader, 'loyalty', b.classList.contains('on') ? null : n);
    });
  }
  for (const b of $('traderList').querySelectorAll('.rep-btn')) {
    b.addEventListener('click', () => {
      write(b.dataset.trader, 'rep', b.classList.contains('on') ? null : Number(b.dataset.rep));
    });
  }
}

$('tradersBtn').addEventListener('click', () => {
  renderTraders();
  $('traderOverlay').classList.remove('hidden');
});
$('closeTradersBtn').addEventListener('click', () => $('traderOverlay').classList.add('hidden'));
$('traderOverlay').addEventListener('click', (e) => {
  if (e.target === $('traderOverlay')) $('traderOverlay').classList.add('hidden');
});

// MAPS browser: every map with artwork, quests on it or not
$('mapsBtn').addEventListener('click', () => {
  const names = orderedKeys(Object.keys(MAP_DATA).filter(hasMapData), MAP_ORDER);
  $('mapsGrid').innerHTML = names.map((n) =>
    `<button class="maps-grid-btn" data-map="${escapeHtml(n)}">${escapeHtml(n.toUpperCase())}</button>`).join('');
  for (const b of $('mapsGrid').querySelectorAll('button[data-map]')) {
    b.addEventListener('click', () => {
      $('mapsOverlay').classList.add('hidden');
      openQuestMap(b.dataset.map);
    });
  }
  $('mapsOverlay').classList.remove('hidden');
});
$('closeMapsBtn').addEventListener('click', () => $('mapsOverlay').classList.add('hidden'));
$('mapsOverlay').addEventListener('click', (e) => {
  if (e.target === $('mapsOverlay')) $('mapsOverlay').classList.add('hidden');
});

$('settingsBtn').addEventListener('click', () => {
  $('settingsOverlay').classList.remove('hidden');
  renderSettingsPanel();
});
// credit links: the CSP blocks in-app navigation, so hand them to the OS browser
$('settingsPanel').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  backend.openWiki(a.dataset.url);
});
$('closeSettingsBtn').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
$('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === $('settingsOverlay')) $('settingsOverlay').classList.add('hidden');
});

$('modeManual').addEventListener('click', async () => {
  state.settings = await backend.saveSettings({ trackingMode: 'manual' });
  renderAll();
});
$('modeAuto').addEventListener('click', async () => {
  state.settings = await backend.saveSettings({ trackingMode: 'auto' });
  renderAll();
});

for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked'],
  ['hideFailedBtn', 'hideFailed'], ['showRetryBtn', 'showRetryQuests']]) {
  $(btnId).addEventListener('click', async () => {
    state.settings = await backend.saveSettings({ [key]: !state.settings[key] });
    renderAll();
  });
}

// PMC faction. applyMode() re-derives state.tasks from the pristine per-mode
// lists, so switching back and forth costs nothing and needs no re-fetch.
for (const el of document.querySelectorAll('#factionSwitch .mode-btn-top')) {
  el.addEventListener('click', async () => {
    const val = el.dataset.faction;
    if (val === ((state.settings && state.settings.pmcFaction) || 'any')) return;
    state.settings = await backend.saveSettings({ pmcFaction: val });
    // applyMode() first: the faction decides which tasks exist at all, and
    // everything below renders from that list.
    applyMode();
    renderAll();
    renderSettingsPanel();
  });
}

// player level is per profile: your PvE and PvP characters level separately
async function savePlayerLevel(v) {
  const levels = { ...(state.settings.playerLevel || {}) };
  if (v > 0) levels[state.gameMode] = v; else delete levels[state.gameMode];
  state.settings = await backend.saveSettings({ playerLevel: levels });
  renderAll();
  renderSettingsPanel();
}
async function saveScavKarma(v) {
  const karma = { ...(state.settings.scavKarma || {}) };
  if (Number.isFinite(v)) karma[state.gameMode] = v; else delete karma[state.gameMode];
  state.settings = await backend.saveSettings({ scavKarma: karma });
  renderAll();
  renderSettingsPanel();
}
// (the Scav-karma box moved into the TRADERS panel as Fence's reputation field;
// saveScavKarma stays for the stored value, which standingFor still reads)
$('playerLevelInput').addEventListener('change', () => {
  const v = Math.floor(Number($('playerLevelInput').value));
  savePlayerLevel(Number.isFinite(v) && v > 0 ? Math.min(v, 99) : 0);
});
$('playerLevelAuto').addEventListener('click', () => {
  const floor = inferredLevel();          // suggestion only — applied because you asked
  if (floor > 0) { $('playerLevelInput').value = floor; savePlayerLevel(floor); }
});

$('logsPathInput').addEventListener('change', async () => {
  state.settings = await backend.saveSettings({ logsPath: $('logsPathInput').value.trim() });
  renderAll();
});
$('browseBtn').addEventListener('click', async () => {
  const dir = await backend.browseLogs();
  if (dir) {
    state.settings = await backend.saveSettings({ logsPath: dir });
    renderAll();
  }
});

$('refreshDataBtn').addEventListener('click', async () => {
  $('dataStatus').textContent = 'Fetching…';
  state.dataInfo = await backend.loadTasks();
  if (state.dataInfo.regular) {
    buildTasksByMode();
    applyFetchedMapData(state.dataInfo.mapData);  // published map work over the bundled bake
    applyObjectiveFixes();   // hand-corrected pin positions (MAP_FIXES)
    applyMode();
  }
  renderAll();
  document.fonts.ready.then(fitSidebarWidth);
});

// Every objective id the story campaign owns, which is what "story progress"
// IS — chapters have no state of their own, they are derived from these ticks.
function storyObjectiveIds() {
  const out = [];
  for (const c of storyChapters()) for (const ob of (c.objectives || [])) if (ob.id) out.push(ob.id);
  return out;
}

$('resetStoryBtn').addEventListener('click', async () => {
  const label = modeLabel(state.gameMode);
  const ids = storyObjectiveIds();
  const ticked = ids.filter((id) => state.progress.objectives && state.progress.objectives[id]).length;
  if (!ticked) { toast('No story progress to reset.'); return; }
  if (!confirm(`Reset your ${label} STORY progress? This cannot be undone.\n\n`
    + `${ticked} story objective${ticked === 1 ? '' : 's'} will be cleared. Your side task `
    + 'completions are not touched.')) return;
  state.fullProgress = await backend.resetProgressPart(state.gameMode, 'story', ids);
  applyMode();
  renderAll();
  toast(`Story progress reset — ${ticked} objective${ticked === 1 ? '' : 's'} cleared.`);
});

$('resetSideBtn').addEventListener('click', async () => {
  const label = modeLabel(state.gameMode);
  // objective ticks that are NOT the story's: hand-ticked steps of ordinary
  // quests, which belong with the completions they sit under
  const story = new Set(storyObjectiveIds());
  const ids = Object.keys((state.progress && state.progress.objectives) || {}).filter((id) => !story.has(id));
  const done = Object.keys((state.progress && state.progress.completed) || {}).length;
  if (!confirm(`Reset your ${label} SIDE TASK progress? This cannot be undone.\n\n`
    + `${done} completed quest${done === 1 ? '' : 's'} will be cleared. Your story progress is not `
    + `touched. Automatic tracking will then only re-import ${label} quests completed AFTER this `
    + 'reset — useful after a wipe.')) return;
  state.fullProgress = await backend.resetProgressPart(state.gameMode, 'side', ids);
  applyMode();
  renderAll();
  toast(`Side task progress reset — ${done} quest${done === 1 ? '' : 's'} cleared.`);
});

$('resetBtn').addEventListener('click', async () => {
  const label = modeLabel(state.gameMode);
  if (!confirm(`Reset your ${label} quest progress? This cannot be undone.\n\nThis only affects ${label}. Automatic tracking will then only re-import ${label} quests completed AFTER this reset — useful after a wipe.`)) return;
  state.fullProgress = await backend.resetProgress(state.gameMode);
  applyMode();
  renderAll();
});

$('rescanBtn').addEventListener('click', async () => {
  if (!confirm('Re-scan your entire Tarkov log history and re-import every completed quest still in your logs?\n\nThis also clears any previous "Reset" cut-off, so quests you completed before a reset can reappear. Your manual ticks are kept.')) return;
  const btn = $('rescanBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'SCANNING…';
  const res = await backend.rescanAll();
  state.fullProgress = res.progress;
  applyMode();
  if (res.imported) {
    // completed quests are announced by the auto-completions event
  } else if (res.failsImported) {
    toast(`Imported ${res.failsImported} failed-quest record(s) from your logs.`);
  } else {
    toast(res.logsFound === false
      ? 'No logs found to scan — check your EFT Logs folder in settings.'
      : 'No new completed quests found in your logs.');
  }
  btn.textContent = label;
  btn.disabled = false;
  renderAll();
});

// story chapter state, re-derived by the watcher from the output logs
backend.onStoryState((data) => {
  if (data && modes().some((m) => data[m])) {
    state.storyState = data;
    if (state.filter === 'STORY') renderAll();
  }
});

backend.onAutoCompletions((data) => {
  state.fullProgress = data.progress;
  applyMode();

  // Once ever: if the viewed mode is empty but the other has completions, open
  // on where the data is. Gated on a persisted flag so it never overrides a
  // mode the user later chose (data.initial re-fires on every rescan/relaunch).
  if (data.initial && state.settings && !state.settings.modeAutoResolved) {
    const cnt = (m) => Object.keys((state.fullProgress[m] || { completed: {} }).completed).length;
    // "The other mode" stopped being a single value when a third one arrived.
    // Land on the fullest OTHER mode, and on a tie stay where we are rather than
    // picking by array order.
    const others = modes().filter((m) => m !== state.gameMode).sort((a, b) => cnt(b) - cnt(a));
    const best = others[0];
    const tied = others.length > 1 && best && cnt(others[1]) === cnt(best);
    if (best && !tied && cnt(state.gameMode) === 0 && cnt(best) > 0) {
      state.gameMode = best;
      applyMode();
      renderModeSwitch();
    }
    state.settings.modeAutoResolved = true;
    backend.setGameMode(state.gameMode); // persists gameMode + modeAutoResolved
  }

  // announce only completions in the mode currently being viewed
  const mineIds = (data.newByMode && data.newByMode[state.gameMode]) || [];
  const names = mineIds.map((id) => (state.byId.get(id) || {}).name).filter(Boolean);
  // aggregate across every other mode — with three of them, naming one is wrong
  const otherModes = modes().filter((m) => m !== state.gameMode);
  const otherCount = otherModes
    .reduce((n, m) => n + (((data.newByMode && data.newByMode[m]) || []).length), 0);
  const otherLabel = otherModes.length === 1
    ? modeLabel(otherModes[0])
    : otherModes.filter((m) => ((data.newByMode && data.newByMode[m]) || []).length).map(modeLabel).join(' / ');
  // count only ids that resolve to a real quest — the logs also carry daily/weekly
  // template ids, which belong to no quest in the list
  if (data.initial && names.length > 3) {
    toast(`Imported ${names.length} completed ${modeLabel(state.gameMode)} quests from your logs`);
  } else if (names.length) {
    for (const n of names.slice(0, 5)) toast(`Quest completed: ${n}`);
    if (names.length > 5) toast(`…and ${names.length - 5} more`);
  }
  if (data.initial && otherCount > 0 && names.length === 0) {
    toast(`Found ${otherCount} completed quests in ${otherLabel || 'another mode'} — switch mode to see them.`);
  }
  renderAll();
});
// One-shot: the upgrade removed quest completions that a pre-1.1.0 build had
// invented in the PvP bucket from seasonal activity. Say so plainly — silently
// changing somebody's completion count is how trust in a tracker dies.
if (backend.onSeasonSplit) {
  backend.onSeasonSplit((d) => {
    if (!d || !d.removed) return;
    toast('Tarkov 1.1.0 added seasonal PvP, and it now has its own SEASON tab. '
      + 'Quests it had wrongly marked complete in PvP have been cleared, and every '
      + 'mode was re-derived from your logs — so some counts may change slightly. '
      + 'Nothing you ticked by hand was touched.');
  });
}

backend.onWatcherStatus((ws) => {
  state.watcherStatus = ws;
  renderStatus();
  renderSettingsPanel();
});
backend.onSettingsChanged((s) => {
  state.settings = s;
  renderStatus();
  renderSettingsPanel();
});

// ---------- quest map ----------

// `view` is the sub-rectangle of the map currently on screen, in viewBox units;
// `zoom` is derived from it and kept only for display/assertions
// `markers` holds the decoded mapmarkers.js rows for this map; `selectedMarker`
// holds the marker OBJECT, not an index, because the drawn list is decimated and
// an index into it would point at a different marker after any zoom.
const mapView = { name: null, svgLoaded: false, floor: -1, pins: [], selected: null,
  markers: [], selectedMarker: null, view: null, zoom: 1,
  highlight: null };   // { item, objs:Set } — set by clicking a loadout item

const ZOOM_MAX = 10;   // zoom 1 is the whole map; the floor is implicit in baseView
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Zoom/pan moves the SVG's own viewBox rather than applying a CSS transform.
// A CSS scale() rasterises the map once at its layout size and then magnifies
// that bitmap — zoom in and you get a blurry mess out of artwork that is pure
// vector. Narrowing the viewBox makes the browser re-render the paths, so the
// map stays sharp at any zoom. Everything else falls out for free: viewBox units
// per screen pixel shrink as you zoom, and pin/label/card sizes are derived from
// that, so they stay the same size on screen.

// the map's own box, in the coordinates the user sees. Markers clamp to this —
// it is the artwork, not the window onto it.
function fullView(md) { return rotatedViewBox(md); }

// Labels and quest pins clamp into the map box the same way markers do
// (markerPoint): a hand-dragged fix can put one just past the artwork, and
// without this the SVG viewport clips it invisible — at the edge it stays
// findable and can be dragged back in the editor.
function clampToMap(md, x, z, insetUnits) {
  const box = fullView(md);
  const p = mapPoint(md, x, z);
  return {
    x: clamp(p.x, box.x + insetUnits, box.x + box.w - insetUnits),
    y: clamp(p.y, box.y + insetUnits, box.y + box.h - insetUnits),
  };
}

// The stage's shape, as width/height.
function stageAspect() {
  const r = $('mapStage').getBoundingClientRect();
  return (r.width > 0 && r.height > 0) ? r.width / r.height : 16 / 9;
}

// The zoom-1 window: the map box grown to the STAGE's aspect, centred.
//
// The view rectangle has to match the stage, not the map. It used to keep the
// map's own aspect, which meant a map shaped differently from the pane kept its
// letterbox bars at every zoom level — zooming magnified a small window instead
// of filling the screen, and Lighthouse (tall) or Factory (turned 90°) wasted
// most of the stage no matter how far you went in. At zoom 1 this is visually
// identical to before: the extra width or height is exactly the bars that were
// already there, so the artwork renders at the same scale.
function baseView(md) {
  const full = fullView(md);
  const a = stageAspect();
  let { w, h } = full;
  if (w / h < a) w = h * a; else h = w / a;
  return { x: full.x - (w - full.w) / 2, y: full.y - (h - full.h) / 2, w, h };
}

// the part of it currently on screen
function currentView(md) { return mapView.view || baseView(md); }

function applyView(redraw) {
  const md = MAP_DATA[mapView.name];
  if (!md) return;
  const base = baseView(md);
  const full = fullView(md);

  // Carry the ZOOM RATIO across, never the absolute width. `base.w` depends on
  // the pane's shape, so keeping `v.w` through a resize silently changed how far
  // in you were — and the clamp only ever shrank it, so narrowing the window and
  // widening it again left the map zoomed in and cropped without the user
  // touching the wheel. A plain maximise did it too.
  const zoom = clamp(mapView.zoom || 1, 1, ZOOM_MAX);
  const w = base.w / zoom;
  const h = w / stageAspect();

  // Keep looking at the same place across a resize or a zoom step.
  const prev = mapView.view;
  const cx = prev ? prev.x + prev.w / 2 : base.x + base.w / 2;
  const cy = prev ? prev.y + prev.h / 2 : base.y + base.h / 2;

  // What is clamped is the view's CENTRE, and it is clamped to the artwork. That
  // lets you drag any corner of the map into the middle of the screen — the whole
  // point of panning — while still making it impossible to lose the map
  // altogether, because the centre of the pane is always over it. Clamping the
  // whole rectangle inside the map (the obvious version) stops the edges ever
  // reaching the middle; clamping to the padded base instead let the map be
  // dragged completely off screen.
  //
  // The centre is clamped to the map bounds at EVERY zoom, including zoom 1 where
  // the whole map fits — that is what lets you drag a fully-zoomed-out map around
  // (previously this branch force-centred it, so panning did nothing until you
  // zoomed in). baseView pads the map symmetrically, so with no pan the centre is
  // already the map's centre and the initial view is pixel-identical to before.
  const axis = (c, size, fp, fs) => clamp(c, fp, fp + fs) - size / 2;

  const v = { x: axis(cx, w, full.x, full.w), y: axis(cy, h, full.y, full.h), w, h };
  mapView.view = v;
  mapView.zoom = zoom;
  const svg = $('mapRot').querySelector('svg');
  if (svg) svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  $('mapRot').classList.toggle('zoomed', mapView.zoom > 1.001);
  if (redraw) requestAnimationFrame(() => { if (mapView.name) drawMap(); });
}

function resetMapView() {
  const md = MAP_DATA[mapView.name];
  mapView.view = null;          // applyView re-derives it from zoom + the map box
  mapView.zoom = 1;
  $('mapRot').style.transform = '';
  $('mapRot').classList.remove('zoomed');
  if (md) applyView(false);
}

// where a screen point falls in viewBox coordinates
function clientToSvg(clientX, clientY) {
  const svg = $('mapRot').querySelector('svg');
  const md = MAP_DATA[mapView.name];
  if (!svg || !md) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const v = currentView(md);
  return {
    x: v.x + ((clientX - r.left) / r.width) * v.w,
    y: v.y + ((clientY - r.top) / r.height) * v.h,
    fx: (clientX - r.left) / r.width,
    fy: (clientY - r.top) / r.height,
  };
}

function zoomMapAt(clientX, clientY, factor) {
  const md = MAP_DATA[mapView.name];
  if (!md) return;
  const p = clientToSvg(clientX, clientY);
  if (!p) return;
  const v = currentView(md);
  const base = baseView(md);
  const w = clamp(v.w / factor, base.w / ZOOM_MAX, base.w);
  if (w === v.w) return;
  const h = w / stageAspect();
  // hold whatever is under the cursor still. applyView takes the width from
  // `zoom` and the position from this rectangle's centre, so both must be set.
  mapView.zoom = base.w / w;
  mapView.view = { x: p.x - p.fx * w, y: p.y - p.fy * h, w, h };
  applyView(true);
}

function hasMapData(mapName) {
  return typeof MAP_DATA !== 'undefined' && !!MAP_DATA[mapName];
}

// every pinnable objective point for unfinished quests on this map,
// honouring the current tab filter and the hide-locked setting
// What an objective actually requires you to bring or use, as short "label: value"
// pairs for the pin card. Only fields the API populates for that objective type
// show up, so most pins get one line or none.
function objectiveNeeds(o) {
  const out = [];
  const names = (arr) => [...new Set((arr || []).map((i) => i && i.name).filter(Boolean))];
  const list = (arr, max = 3) => {
    const n = names(arr);
    return n.length > max ? `${n.slice(0, max).join(', ')} +${n.length - max} more` : n.join(' or ');
  };

  // requiredKeys is a list of ALTERNATIVE key sets, so it nests one level deeper
  const keys = names([].concat(...(o.requiredKeys || [])));
  if (keys.length) out.push(['Key', keys.length > 3 ? `${keys.slice(0, 3).join(', ')} +${keys.length - 3} more` : keys.join(' or ')]);

  if (o.markerItem && o.markerItem.name) out.push(['Place', o.markerItem.name]);
  if (o.questItem && o.questItem.name) out.push(['Find', o.questItem.name + (o.count > 1 ? ` ×${o.count}` : '')]);
  if (o.items && o.items.length) {
    out.push([o.foundInRaid ? 'Hand in (found in raid)' : 'Hand in',
      (o.count > 1 ? `${o.count}× ` : '') + list(o.items)]);
  }
  if (o.useAny && o.useAny.length) out.push(['Use', list(o.useAny)]);
  if (o.item && o.item.name) out.push(['Build', o.item.name]);
  if (o.exitName) out.push(['Extract at', o.exitName]);
  return out;
}

// Objectives belonging to a quest 1.1.0 REWROTE, whose published coordinates
// therefore describe a step the game no longer asks for.
//
// WIKI_OBJ_LIST is the same set the CHANGED IN 1.1.0 panel is built from: quests
// whose objective LIST changed shape, not merely its wording. WIKI_OBJ_TEXT is
// deliberately NOT used — those are rewordings of an objective that still
// exists, so their pins are still right, and suppressing 292 correct pins to
// catch 54 wrong ones would be the worse trade.
let _reworkedObjIds = null;
function reworkedObjectiveIds() {
  if (_reworkedObjIds) return _reworkedObjIds;
  const ids = new Set();
  if (typeof WIKI_OBJ_LIST !== 'undefined' && WIKI_OBJ_LIST) {
    for (const list of Object.values(state.tasksByMode || {})) {
      for (const t of list || []) {
        if (!WIKI_OBJ_LIST[t.id]) continue;
        for (const o of t.objectives || []) ids.add(o.id);
      }
    }
  }
  _reworkedObjIds = ids;
  return ids;
}

// Every point this objective puts on the given map. Shared by the pins and the
// loadout list so the two can never disagree about what is "on this map".
//
// A rewritten quest's points are withheld here rather than at the pin layer, so
// that the loadout and the done-list drop them too. A key listed for an
// objective the game no longer asks for is as wrong as a pin for it, and the
// three views agreeing is the whole reason this function exists.
//
// THE EXCEPTION IS A HAND-CORRECTED POSITION. applyObjectiveFixes stashes the
// pristine coordinates in `p._o` when it moves a pin, so `_o` present means
// someone checked that spot against the game and vouched for it. That outranks
// the blanket suspicion, and it is what makes this recoverable one pin at a
// time instead of all-or-nothing.
// ONE PUBLISHED POINT CAN ARRIVE SEVERAL TIMES, and each copy drew its own pin.
//
// tarkov.dev files some maps as more than one map sharing a display name —
// Factory is day and night, Ground Zero is the ordinary one and the level-21+
// one — and publishes an objective's zones under each. It then repeats them, so
// "Fix the first control board" comes through as FOUR entries: two map ids, two
// copies each, all carrying the same zone id (`place_SADOVOD_01_1`) and the same
// coordinates. The app draws one map called Factory, so all four land on the
// same control board.
//
// Deduplicated on the PRISTINE coordinates, which is the same identity the hand
// moves key on (see applyMapFixes) — so a moved pin dedupes with its own copies
// rather than with whatever it was moved next to. Exact equality, deliberately:
// two published points that merely round to the same spot are still two points,
// and this is only meant to collapse the ones that are literally the same.
function objectiveMapPoints(o, mapName) {
  const suspect = reworkedObjectiveIds().has(o.id);
  const usable = (p) => !suspect || (p && p._o);
  const seen = new Set();
  const pts = [];
  const add = (p) => {
    const k = `${p._o ? p._o[0] : p.x}|${p.y}|${p._o ? p._o[1] : p.z}`;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push(p);
  };
  for (const z of o.zones || []) {
    if (z && z.position && normMapName(z.map && z.map.name) === mapName && usable(z.position)) add(z.position);
  }
  for (const l of o.possibleLocations || []) {
    if (normMapName(l.map && l.map.name) !== mapName) continue;
    for (const p of l.positions || []) if (usable(p)) add(p);
  }
  return pts;
}

// Which quest sets the open map shows. Defaults follow the tab that opened it
// (the old behaviour), then the tickboxes in the map header override freely.
// "side" = neither kappa- nor lightkeeper-required.
function defaultMapSets() {
  if (state.filter === 'KAPPA') return { story: false, side: false, kappa: true, lightkeeper: false };
  if (state.filter === 'LIGHTKEEPER') return { story: false, side: false, kappa: false, lightkeeper: true };
  if (state.filter === 'STORY') return { story: true, side: false, kappa: false, lightkeeper: false };
  return { story: false, side: true, kappa: true, lightkeeper: true }; // SIDE TASKS tab = everything trader
}

function mapSetPass(t) {
  const s = mapView.sets;
  if (!s) return taskPassesFilter(t);
  if (s.kappa && isKappaQuest(t)) return true;
  if (s.lightkeeper && t.lightkeeperRequired) return true;
  // a quest that is no longer specifically needed for Kappa is just a side
  // task again, so the SIDE set stops excluding those 250-odd
  if (s.side && !isKappaQuest(t) && !t.lightkeeperRequired) return true;
  return false;
}

// The tasks whose objectives should appear for this map: the map's tickbox
// sets (seeded from the tab that opened it), not done, not failed, locked only
// if not hidden.
function* mapTasks() {
  for (const t of state.tasks) {
    // laterPart too, or the map contradicts the list it was opened from: pins
    // for Part 4 while the sidebar is telling you to go and do Part 2
    if (!mapSetPass(t) || isDone(t.id) || isFailed(t.id) || laterPart(t)) continue;
    // a quest the game is not offering has no business putting pins on a map,
    // and neither do the copies of one it offers under a single id
    if (notInYourGame(t) || otherArm(t)) continue;
    const locked = isLocked(t);
    if (locked && state.settings && state.settings.hideLocked) continue;
    yield [t, locked];
  }
}

// Story objectives that name this map in their text. Story data has no
// coordinates (see build_storydata.js), so these list in the side panel
// rather than pin on the map.
function collectMapStory(mapName) {
  if (!mapView.sets || !mapView.sets.story) return [];
  const out = [];
  const statuses = chapterStatuses();
  for (const c of storyChapters()) {
    if (statuses[c.id] !== 'active') continue;
    for (const o of c.objectives) {
      if (o.type === 'section') continue;
      if (storyObjectiveStatus(o, 'active') !== 'open') continue;
      if (!o.maps.includes(mapName)) continue;
      out.push({ id: o.id, chapter: c.name, desc: o.description });
    }
  }
  return out;
}

// Map names longest first, for matching a name inside a sentence: "The Lab" is
// a prefix of "The Labyrinth", so a shortest-first scan files Labyrinth
// objectives on The Lab.
//
// ⚠️ Built on FIRST CALL, not at load. test_maps.js and test_groups.js slice a
// region of this file and eval it with no MAP_DATA in scope, so a top-level
// `Object.keys(MAP_DATA)` here turns both of them into a ReferenceError that
// has nothing to do with what they test.
let _mapNamesLongest = null;
const mapNamesLongest = () => (_mapNamesLongest
  || (_mapNamesLongest = Object.keys(MAP_DATA).sort((a, b) => b.length - a.length)));

// Does this line of objective text name THIS map? Longest name first, and each
// one consumed as it matches, so "The Lab" cannot match inside "The Labyrinth"
// — the same trap `mapHints` in build_storydata.js works around.
function objectiveTextNamesMap(text, mapName) {
  let rest = String(text || '');
  for (const m of mapNamesLongest()) {
    if (!rest.includes(m)) continue;
    if (m === mapName) return true;
    rest = rest.split(m).join('');
  }
  return false;
}

// Quests patch 1.1.0 REWORKED, whose current objectives name this map. Like the
// story list above these have no coordinates and so cannot pin: the wiki
// supplies the text, tarkov.dev still publishes the old objectives, and the two
// lists are different lengths, which is exactly why `applyWikiObjectives` will
// not swap them (an objective id carries a hand tick and a map pin).
//
// Without this they are invisible on the map they now belong to. Several moved
// outright — "Chemical Experiments" is 8 old objectives against one current
// "Stash a Corrugated hose in the med lab on Customs", and the quest data files
// it under no map at all, so nothing on the Customs screen would mention it.
function collectMapRework(mapName) {
  if (typeof WIKI_OBJ_LIST === 'undefined' || !WIKI_OBJ_LIST) return [];
  const out = [];
  for (const [t, locked] of mapTasks()) {
    const fresh = WIKI_OBJ_LIST[t.id];
    if (!fresh) continue;
    const here = fresh.filter((line) => objectiveTextNamesMap(line, mapName));
    if (here.length) {
      out.push({ quest: t.name, trader: (t.trader && t.trader.name) || '',
        locked, lines: here, tab: tabRank(t) });
    }
  }
  // same trader-tab order as the quest list, so the two read alike
  out.sort((a, b) => a.tab - b.tab || a.quest.localeCompare(b.quest));
  return out;
}

// Everything you would have to carry in to clear this map in one raid, from the
// same task set the pins use — so switching to KAPPA narrows both together.
//
// Two rules the raw data does not state:
//  * Keys are not consumed. Seven objectives behind the Dorm overseer door still
//    need exactly ONE key, so keys are deduplicated and never counted.
//  * An objective's `items` list is ALTERNATIVES — bring one of them — not a
//    shopping list. Listing each separately would invent a dozen requirements
//    out of one "stash any of these rifles" objective.
const BRING_TYPES = new Set(['plantItem', 'plantQuestItem', 'useItem']);

function collectMapLoadout(mapName) {
  if (!MAP_DATA[mapName]) return { keys: [], bring: [] };
  const keys = new Map();     // name -> { quests:Set, objs:Set }
  const bring = new Map();    // label -> { qty, quests:Set, objs:Set }
  const addBring = (label, qty, quest, objId) => {
    if (!label) return;
    const e = bring.get(label) || { qty: 0, quests: new Set(), objs: new Set() };
    e.qty += qty; e.quests.add(quest); e.objs.add(objId);
    bring.set(label, e);
  };

  for (const [t] of mapTasks()) {
    for (const o of t.objectives || []) {
      if (isObjectiveDone(o.id)) continue;   // already ticked off by hand
      if (!objectiveMapPoints(o, mapName).length) continue;
      // a key opens the door however many objectives are behind it
      for (const k of [].concat(...(o.requiredKeys || []))) {
        if (!k || !k.name) continue;
        if (!keys.has(k.name)) keys.set(k.name, { quests: new Set(), objs: new Set() });
        keys.get(k.name).quests.add(t.name);
        keys.get(k.name).objs.add(o.id);
      }
      if (o.markerItem && o.markerItem.name) addBring(o.markerItem.name, o.count || 1, t.name, o.id);
      if (BRING_TYPES.has(o.type)) {
        const alts = [...new Set((o.items || []).concat(o.useAny || []).map((i) => i && i.name).filter(Boolean))];
        if (alts.length) {
          addBring(alts.length > 2 ? `${alts[0]} (or ${alts.length - 1} alternatives)` : alts.join(' or '),
            o.count || 1, t.name, o.id);
        }
      }
    }
  }

  const bySize = (a, b) => b.qty - a.qty || a.name.localeCompare(b.name);
  return {
    keys: [...keys].map(([name, e]) => ({ name, qty: 1, quests: [...e.quests], objs: [...e.objs] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bring: [...bring].map(([name, e]) => ({ name, qty: e.qty, quests: [...e.quests], objs: [...e.objs] }))
      .sort(bySize),
  };
}

// Objectives on this map the player has ticked off by hand — the only way back,
// since the pin they right-clicked is gone from the map.
function handTickedOnMap(mapName) {
  const out = [];
  for (const [t] of mapTasks()) {
    for (const o of t.objectives || []) {
      if (!isObjectiveDone(o.id)) continue;
      if (!objectiveMapPoints(o, mapName).length) continue;
      out.push({ id: o.id, quest: t.name, desc: o.description || '' });
    }
  }
  return out;
}

// ---------- BattlePass documents ----------
//
// Season 1 "KORD BREACH" turns loose documentation into BattlePass progress:
// seven types, three maps each, plus "Classified documents" which substitutes
// for any of them and is bought rather than found.
//
// ⚠️ These have NO COORDINATES anywhere — json.tarkov.dev carries no item
// record for them at all (a name in its locale file and nothing else, no
// lootLoose entry on any map), and the wiki documents the spots as prose and
// screenshots. So this behaves like the story objectives directly above: a
// LIST in the side panel, not pins. A spot only becomes a pin once it has been
// hand-placed through the dev map editor, which is why the marker path below
// exists while the data behind it is still empty.
function bpDocs() {
  return (typeof BP_DOCS !== 'undefined' && Array.isArray(BP_DOCS)) ? BP_DOCS : [];
}
const bpLayerId = (d) => 'bp:' + (d.id || d.name);

// Document type -> its glyph and colour class. Keyed by NAME because that is what
// the wiki gives us and what bpdocs.js bakes. The shapes themselves live with the
// other glyphs (BP_DOC_GLYPHS); only the mapping is here, next to the layer rows
// that read it — declared BELOW them it is still in its temporal dead zone when
// the rows getter first runs.
// A type we have no icon for (today "Classified documents", which has no maps and
// no pins) keeps the generic folder, so a type the wiki adds later still needs no
// code change.
// ---------- bp doc icons ----------
const BP_DOC_ICONS = {
  'Blueprints and technical documentation': 'bpBlueprints',
  'Financial documents': 'bpFinancial',
  'Medical documents': 'bpMedical',
  'PMC personnel files': 'bpPmc',
  'Project documentation': 'bpProject',
  'Technical documentation': 'bpTechnical',
  'Test documentation': 'bpTest',
  'User documentation': 'bpUser',
};
const bpGlyph = (name) => BP_DOC_ICONS[name] || 'folder';
const bpCls = (name) => (BP_DOC_ICONS[name] ? 'mk-' + BP_DOC_ICONS[name].toLowerCase() : 'mk-bp');
// ---------- bp doc icons end ----------

// the types that can turn up on a map, whether or not their spots are written
// up yet — three of the seven are at "we know the maps" and no further
function bpDocsOnMap(mapName) {
  return bpDocs().filter((d) => d.spots && Object.prototype.hasOwnProperty.call(d.spots, mapName));
}

// Hand-placed pins, baked into bpdocs.js from the dev map editor. Empty until
// somebody places one, which is the state this spends most of its life in.
// Each pin knows which described spot it is (`spot`, an index into that map's
// list, or null for a spawn the wiki never wrote up).
function bpPins(mapName) {
  const out = [];
  for (const d of bpDocs()) {
    for (const p of ((d.pins && d.pins[mapName]) || [])) {
      out.push({ ...p, type: d.id || d.name, name: d.name });
    }
  }
  return out;
}

// What the side panel shows: every described spot of every TICKED type on this
// map. Ticking is the same per-layer setting the map pins use, so one box
// governs both halves and they can never disagree.

function renderMapLoadout(mapName) {
  const load = collectMapLoadout(mapName);
  // The item's row remembers which objectives want it; clicking lights those
  // pins up on the map. The active row is marked so the link is visible from
  // both ends.
  const hl = mapView.highlight;
  const row = (i) => `<li data-objs="${escapeHtml(i.objs.join(','))}" data-item="${escapeHtml(i.name)}"`
    + ` class="ld-link${hl && hl.item === i.name ? ' ld-on' : ''}"`
    + ` title="${escapeHtml(i.quests.slice(0, 6).join(' · '))} — click to show these objectives on the map">`
    + `<span class="ld-name">${escapeHtml(i.name)}</span>`
    + (i.qty > 1 ? `<span class="ld-qty">×${i.qty}</span>` : '') + '</li>';
  const section = (title, items) => (items.length
    ? `<div class="ld-group"><div class="ld-head">${title}</div><ul>${items.map(row).join('')}</ul></div>` : '');

  // story objectives on this map (no coordinates exist, so a list, not pins) —
  // rendered into their own collapsible section; ticking one here uses the
  // same store as the story tab
  const story = collectMapStory(mapName);
  $('mapStorySec').hidden = !story.length;
  $('mapStoryCount').textContent = story.length ? String(story.length) : '';
  // Which of these have anything drawn for them. A row that lights nothing has
  // to say so before it is clicked, not after: the story spots are hand-placed
  // and most objectives still have none.
  const storyPinned = new Set((mapView.pins || []).filter((p) => p.story && p.objId).map((p) => p.objId));
  $('mapStoryList').innerHTML = story.length ? `<div class="ld-group ld-story">
      <ul>${story.map((o) => {
    const pinned = storyPinned.has(o.id);
    const lit = hl && hl.story === o.id;
    return `<li data-story-obj="${escapeHtml(o.id)}"`
      + ` class="${pinned ? 'ld-link' : 'ld-nopin'}${lit ? ' ld-on' : ''}"`
      + ` title="${escapeHtml(o.chapter)} — `
      + `${pinned ? 'click to show it on the map' : 'no spot has been placed for this one yet'}`
      + ` · right-click to tick it off">`
      + `<span class="ld-name">${escapeHtml(o.desc)}</span></li>`;
  }).join('')}</ul>
    </div>` : '';

  // Quests 1.1.0 reworked whose current objectives land on this map. Text only,
  // for the same reason the story list above is text only — no coordinates
  // exist for them. Not tickable: the ticks hang off the objective ids these
  // lines deliberately do not have.
  const rework = collectMapRework(mapName);
  $('mapReworkSec').hidden = !rework.length;
  $('mapReworkCount').textContent = rework.length ? String(rework.length) : '';
  $('mapReworkList').innerHTML = rework.length ? `<div class="ld-group ld-rework">
      ${rework.map((r) => `<div class="rw-quest${r.locked ? ' rw-locked' : ''}">${escapeHtml(r.quest)}`
    + (r.trader ? `<span class="rw-trader">${escapeHtml(r.trader)}</span>` : '') + '</div>'
    + `<ul>${r.lines.map((l) => `<li><span class="ld-name">${escapeHtml(l)}</span></li>`).join('')}</ul>`).join('')}
      <div class="rw-note">Patch 1.1.0 changed these. The quest data still publishes the old
        objectives, so their pins are hidden rather than left pointing at somewhere the quest
        no longer sends you — the text is what the game asks for now. Pins come back one at a
        time as each is placed by hand, and all at once if the data upstream catches up.</div>
    </div>` : '';

  // The BattlePass document SPOT LIST is gone (2026-08-06). It existed because
  // no source published positions, so the wiki's written descriptions were the
  // best available. Once the spots were pinned by hand the prose added nothing
  // — the pins say where, and say it better than "on a shelf on 2nd floor of
  // the Tarbank building" ever did. The layer tickboxes now govern pins only.
  const html = section('KEYS', load.keys) + section('TAKE WITH YOU', load.bring);
  const ticked = handTickedOnMap(mapName);
  const tickedHtml = ticked.length ? `<div class="ld-group ld-ticked">
      <div class="ld-head">DONE BY HAND (${ticked.length})<button id="ldRestoreAll" title="Put all of these back on the map">restore all</button></div>
      <ul>${ticked.map((o) => `<li data-obj="${escapeHtml(o.id)}" title="${escapeHtml(o.quest)} — click to put it back on the map">
        <span class="ld-name">${escapeHtml(o.desc || o.quest)}</span></li>`).join('')}</ul>
    </div>` : '';

  $('mapLoadoutList').innerHTML = (html
    || (ticked.length ? '' : '<div class="ld-empty">Nothing needs bringing for these objectives.</div>')) + tickedHtml;

  for (const li of $('mapStoryList').querySelectorAll('li[data-story-obj]')) {
    const objId = li.dataset.storyObj;
    li.addEventListener('click', () => {
      if (!storyPinned.has(objId)) {
        toast('No spot has been placed for that objective yet.');
        return;
      }
      mapView.highlight = (mapView.highlight && mapView.highlight.story === objId)
        ? null
        : { story: objId, objs: new Set([objId]) };
      renderMapLoadout(mapName);   // repaint the active row
      drawMap();
    });
    // Ticking it off is still one gesture away, and it is the same gesture that
    // ticks a pin off and a quest row off.
    li.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (mapView.highlight && mapView.highlight.story === objId) mapView.highlight = null;
      state.fullProgress = await backend.toggleObjective(objId, true, state.gameMode);
      applyMode();
      mapView.pins = collectMapPins(mapName);
      renderMapLoadout(mapName);
      drawMap();
      renderAll();
      toast('Story objective marked done.');
    });
  }

  const n = load.keys.length + load.bring.reduce((a, i) => a + i.qty, 0);
  $('mapLoadoutCount').textContent = n ? `${n} item${n === 1 ? '' : 's'}` : '';

  const restore = async (ids) => {
    state.fullProgress = await backend.clearObjectives(ids, state.gameMode);
    applyMode();
    mapView.pins = collectMapPins(mapName);
    renderMapLoadout(mapName);
    drawMap();
    renderAll();
  };
  // If the highlighted item no longer exists (its last objective was ticked
  // off), the highlight must not linger invisibly.
  // Each kind of highlight is checked against its OWN list. Left as one test on
  // `item`, a story highlight has no item, matches nothing, and clears itself
  // on the very repaint that was meant to show it.
  if (mapView.highlight && mapView.highlight.item
    && ![...load.keys, ...load.bring].some((i) => i.name === mapView.highlight.item)) {
    mapView.highlight = null;
  }
  if (mapView.highlight && mapView.highlight.story
    && !story.some((o) => o.id === mapView.highlight.story)) {
    mapView.highlight = null;
  }
  for (const li of $('mapLoadoutList').querySelectorAll('li.ld-link')) {
    li.addEventListener('click', () => {
      const item = li.dataset.item;
      mapView.highlight = (mapView.highlight && mapView.highlight.item === item)
        ? null
        : { item, objs: new Set(li.dataset.objs.split(',').filter(Boolean)) };
      renderMapLoadout(mapName);   // repaint the active row
      drawMap();
    });
  }

  const all = $('ldRestoreAll');
  if (all) all.addEventListener('click', (e) => { e.stopPropagation(); restore(ticked.map((o) => o.id)); });
  for (const li of $('mapLoadoutList').querySelectorAll('.ld-ticked li[data-obj]')) {
    li.addEventListener('click', () => restore([li.dataset.obj]));
  }
}

function collectMapPins(mapName) {
  const md = MAP_DATA[mapName];
  if (!md) return [];
  const out = [];
  for (const [t, locked] of mapTasks()) {
    const objTotal = (t.objectives || []).length;
    for (const o of t.objectives || []) {
      if (isObjectiveDone(o.id)) continue;   // right-clicked away
      const pts = objectiveMapPoints(o, mapName);
      const needs = objectiveNeeds(o);
      const objDone = (t.objectives || []).filter((x) => isObjectiveDone(x.id)).length;
      for (const p of pts) {
        if (typeof p.x !== 'number' || typeof p.z !== 'number') continue;
        out.push({
          x: p.x, y: typeof p.y === 'number' ? p.y : 0, z: p.z,
          quest: t.name, trader: (t.trader && t.trader.name) || '',
          desc: o.description || '', optional: !!o.optional, locked, needs,
          objId: o.id, objDone, objTotal,
          // a hand floor reassignment (p._floor) wins outright; else a
          // hand-moved position (p._o = pristine coords) keeps its original
          // floor — the move corrects the artwork spot, not the storey
          floor: typeof p._floor === 'number' ? p._floor
            : floorOf(md, p._o ? p._o[0] : p.x, typeof p.y === 'number' ? p.y : 0, p._o ? p._o[1] : p.z),
        });
      }
    }
  }

  // Hand-placed STORY objective locations (baked from the dev map editor into
  // storydata.js — no public source carries these). Blue pins; areas keep their
  // outline and pin at the centroid so clicking and right-click ticking work
  // exactly like any other pin. The floor is the one chosen at placement, not
  // derived from a height (annotations carry no y on purpose).
  if (mapView.sets && mapView.sets.story) {
    const statuses = chapterStatuses();
    for (const c of storyChapters()) {
      if (statuses[c.id] !== 'active') continue;
      const mains = chapterMainObjectives(c);
      const objDone = mains.filter((o) => isObjectiveDone(o.id)).length;
      for (const o of c.objectives) {
        if (!o.points || storyObjectiveStatus(o, 'active') !== 'open') continue;
        for (const pt of o.points) {
          if (pt.map !== mapName || !(pt.pts || []).length) continue;
          const cx = pt.pts.reduce((a, q) => a + q.x, 0) / pt.pts.length;
          const cz = pt.pts.reduce((a, q) => a + q.z, 0) / pt.pts.length;
          out.push({
            x: cx, y: 0, z: cz,
            quest: `STORY — ${c.name}`, trader: '',
            desc: o.description + (o.needs ? ` (needs: ${o.needs})` : ''),
            optional: o.type === 'optional', locked: false, needs: o.needs ? [o.needs] : [],
            objId: o.id, objDone, objTotal: mains.length,
            floor: typeof pt.floor === 'number' ? pt.floor : -1,
            story: true, area: pt.kind === 'area' ? pt.pts : null,
          });
        }
      }
    }
  }
  return out;
}

// ---------- map layers ----------
// Extracts, hazards, keyed doors and fixed loot spawns, drawn over the map and
// toggled from the panel in the stage's top-right corner. Data comes from
// mapmarkers.js — read its banner before touching any of this, especially the
// part about why there is no "guaranteed spawn" layer.

// "has markers" means has any, not merely has an entry: Terminal is in the file
// with every list empty, and an all-disabled panel over an empty map is noise.
// Hand-corrected positions from the dev map editor, baked through storydata.js

// ---- fetched map data (api/maps.json) over the bundled bake
//
// The hand-placed work, published as data instead of baked into the app:
// corrected pin positions, hidden markers, added labels, map texts, BattlePass
// document pins, hazards, interactables and the story chapters.
//
// Applied by MUTATING the existing objects rather than reassigning them. They
// are `const` bindings from storydata.js / bpdocs.js, so reassignment throws,
// and mutating in place means every reader keeps working untouched and the
// bundled bake stays available as the fallback.
//
// Nothing is applied unless the payload actually carries it. A partial payload
// must never blank a category the app already has data for: an empty map is
// indistinguishable from "no corrections", and the result would look exactly
// like the hand-placed work being lost.
const MAP_API_CORRECTIONS = ['labels', 'extracts', 'objectives', 'transits', 'switches',
  'objectiveFloors', 'extractFloors', 'labelFloors', 'transitFloors', 'switchFloors',
  'extractFactions', 'extractNotes', 'extractSwitches', 'hidden'];
const MAP_API_ADDITIONS = { newLabels: 'labels', mapTexts: 'mapTexts', newExtracts: 'extracts' };

function applyFetchedMapData(payload) {
  if (!payload || typeof MAP_FIXES === 'undefined') return false;
  const refillObj = (target, src) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, src);
  };
  const refillArr = (target, src) => {
    if (!Array.isArray(src) || !src.length) return;
    target.length = 0;
    target.push(...src);
  };

  for (const k of MAP_API_CORRECTIONS) {
    const src = (payload.corrections || {})[k];
    if (!src) continue;
    if (!MAP_FIXES[k]) MAP_FIXES[k] = {};
    refillObj(MAP_FIXES[k], src);
  }
  for (const [appKey, apiKey] of Object.entries(MAP_API_ADDITIONS)) {
    if (!Array.isArray(MAP_FIXES[appKey])) MAP_FIXES[appKey] = [];
    refillArr(MAP_FIXES[appKey], (payload.additions || {})[apiKey]);
  }
  if (typeof BP_DOCS !== 'undefined') refillArr(BP_DOCS, (payload.battlePassDocuments || {}).documents);
  if (typeof STORY_HAZARDS !== 'undefined') refillArr(STORY_HAZARDS, (payload.additions || {}).hazards);
  if (typeof HAND_INTERACTABLES !== 'undefined') refillArr(HAND_INTERACTABLES, (payload.additions || {}).interactables);
  if (typeof STORY_DATA !== 'undefined' && STORY_DATA && Array.isArray(STORY_DATA.chapters)) {
    refillArr(STORY_DATA.chapters, (payload.story || {}).chapters);
  }
  return true;
}

// (MAP_FIXES). Some upstream label/extract coordinates sit visibly off on some
// maps; the owner drags them right in the editor and the moves land here. Keys
// are built from the PRISTINE baked coords, so this must run before anything
// reads or copies the data — it mutates the shared row arrays in place, once,
// at load. Guarded: storydata.js may predate the constant.
(function applyMapFixes() {
  if (typeof MAP_FIXES === 'undefined' || !MAP_FIXES) return;
  const F = (k) => MAP_FIXES[k] || {};
  // Moved rows keep their PRISTINE coords in `_o`: floor membership must stay
  // decided by the original position. A move is an artwork correction — the
  // upstream coords sit visibly off the drawing — so re-deriving the floor
  // from the corrected spot files the thing on the wrong floor tab and it
  // "disappears" (this happened with fixes dragged left across a floor
  // boundary rectangle). A hand FLOOR override (`_floor`) beats even that.
  for (const [name, md] of Object.entries(MAP_DATA)) {
    for (const l of md.labels || []) {
      const key = `${name}|${l[2]}|${Math.round(l[0])}|${Math.round(l[1])}`;
      const m = F('labels')[key];
      if (m) { l._o = [l[0], l[1]]; l[0] = m.x; l[1] = m.z; }
      const f = F('labelFloors')[key];
      if (typeof f === 'number') l._floor = f;
    }
    if (typeof MAP_MARKERS === 'undefined' || !MAP_MARKERS[name]) continue;
    for (const r of MAP_MARKERS[name].ex || []) {
      // NOTE the key is built from the PRISTINE faction: correcting who can use
      // an extract must not change the key that identifies it, or every other
      // override on the same extract would come unstuck.
      const key = `${name}|${r[5]}|${r[3]}`;
      const m = F('extracts')[key];
      if (m) { r._o = [r[0], r[2]]; r[0] = m.x; r[2] = m.z; }
      const f = F('extractFloors')[key];
      if (typeof f === 'number') r._floor = f;
      const note = F('extractNotes')[key];
      if (note) r._note = note;
      const links = F('extractSwitches')[key];
      if (links && links.length) r._links = links;
      const fac = F('extractFactions')[key];
      if (typeof fac === 'number') { r._key = key; r[3] = fac; }   // after the key is taken
      else r._key = key;
    }
    for (const r of MAP_MARKERS[name].tr || []) {
      const key = `${name}|${r[4]}|${Math.round(r[0])}|${Math.round(r[2])}`;
      const m = F('transits')[key];
      if (m) { r._o = [r[0], r[2]]; r[0] = m.x; r[2] = m.z; }
      const f = F('transitFloors')[key];
      if (typeof f === 'number') r._floor = f;
    }
    for (const r of MAP_MARKERS[name].sw || []) {
      const key = `${name}|${Math.round(r[0])}|${Math.round(r[2])}`;
      const m = F('switches')[key];
      if (m) { r._o = [r[0], r[2]]; r[0] = m.x; r[2] = m.z; }
      const f = F('switchFloors')[key];
      if (typeof f === 'number') r._floor = f;
    }
  }
  // Things the GAME has removed that upstream still ships (dead extracts,
  // replaced transits, stale switches/names): dropped outright here, at load,
  // rather than skipped at every draw site — one filter cannot be forgotten,
  // and every count/panel/floor tab then agrees for free. Keys are
  // '<kind>|<same key the fixes use>'.
  {
    const gone = MAP_FIXES.hidden || {};
    if (Object.keys(gone).length) {
      for (const [name, md] of Object.entries(MAP_DATA)) {
        if (md.labels) {
          md.labels = md.labels.filter((l) => !gone[`label|${name}|${l[2]}|${Math.round(l._o ? l._o[0] : l[0])}|${Math.round(l._o ? l._o[1] : l[1])}`]);
        }
        const M = typeof MAP_MARKERS !== 'undefined' && MAP_MARKERS[name];
        if (!M) continue;
        const px = (r, i) => Math.round(r._o ? r._o[i] : r[i === 0 ? 0 : 2]);
        if (M.ex) M.ex = M.ex.filter((r) => !gone[`ex|${name}|${r[5]}|${r[3]}`]);
        if (M.tr) M.tr = M.tr.filter((r) => !gone[`tr|${name}|${r[4]}|${px(r, 0)}|${px(r, 1)}`]);
        if (M.sw) M.sw = M.sw.filter((r) => !gone[`sw|${name}|${px(r, 0)}|${px(r, 1)}`]);
      }
    }
  }

  // Hand-ADDED location names (the data is missing some): appended as normal
  // label rows carrying the floor they were placed on (`_floor`), which
  // labelOnFloor checks first — added names have no height band or extent
  // membership to derive one from.
  for (const nl of MAP_FIXES.newLabels || []) {
    const md = MAP_DATA[nl.map];
    if (!md) continue;
    const row = [nl.x, nl.z, nl.text];
    row._floor = typeof nl.floor === 'number' ? nl.floor : -1;
    (md.labels = md.labels || []).push(row);
  }
  // Hand-ADDED extracts: appended as normal ex rows. y is unknown (nothing to
  // derive it from), so the placed floor rides on `_floor` and the collect
  // loop prefers it; `_hand` adds the honesty line on the card.
  if (typeof MAP_MARKERS !== 'undefined') {
    for (const ne of MAP_FIXES.newExtracts || []) {
      if (!MAP_MARKERS[ne.map]) continue;
      const key = `my|${ne.id}`;
      const fac = (MAP_FIXES.extractFactions || {})[key];
      const row = [ne.x, 0, ne.z, typeof fac === 'number' ? fac : (ne.faction || 0), 0,
        ne.name || 'Extract', '', 0];
      row._floor = typeof ne.floor === 'number' ? ne.floor : -1;
      row._hand = true;
      row._key = key;
      const note = (MAP_FIXES.extractNotes || {})[key];
      if (note) row._note = note;
      const links = (MAP_FIXES.extractSwitches || {})[key];
      if (links && links.length) row._links = links;
      (MAP_MARKERS[ne.map].ex = MAP_MARKERS[ne.map].ex || []).push(row);
    }
  }
})();

// Objective-position fixes (MAP_FIXES.objectives) work on the TASK data, which
// arrives async and is rebuilt on every refresh — so unlike labels/extracts
// this must run after every tasksByMode assignment, not once at parse. It sets
// absolute coordinates, so applying it twice is harmless. Keys are built from
// the cache's pristine coords: map|objectiveId|round(x)|round(z).
// Merge in the loyalty gates the wiki documents and tarkov.dev has not
// published. STRICTLY ADDITIVE: a row is only added for a (quest, trader) pair
// the fetched data says nothing about, so this can never override or delete a
// real requirement. Runs wherever tasksByMode is (re)built, and is idempotent —
// re-running finds the rows already present and adds nothing.
// Patch 1.1.0 renamed a large part of the quest tree and tarkov.dev still
// publishes the pre-patch names — a live diff of all three modes found zero
// renames there. So the names come from the wiki's own page moves (a renamed
// quest leaves a #REDIRECT at its old title), applied over the top.
//
// Keyed by task id, which never changes, so this cannot touch progress: the
// same quest keeps the same record whatever it is called. The old name is kept
// on `_oldName` so a search for what someone remembers still finds it.
function applyWikiNames() {
  if (typeof WIKI_NAMES === 'undefined' || !WIKI_NAMES) return 0;
  let n = 0;
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) {
      const fresh = WIKI_NAMES[t.id];
      if (!fresh || fresh === t.name) continue;
      t._oldName = t.name;
      t.name = fresh;
      n++;
    }
    // A quest is also named inside OTHER quests, as their prerequisite, and
    // those are separate objects carrying their own copy of the name. Renaming
    // only the quest itself left "I Need More Power" listing "Spa Tour - Part 3"
    // as what it requires — the same quest under two names, one screen apart.
    for (const t of list || []) {
      for (const r of t.taskRequirements || []) {
        const fresh = r.task && WIKI_NAMES[r.task.id];
        if (fresh && r.task.name !== fresh) r.task.name = fresh;
      }
    }
  }
  return n;
}

// The owner's own corrections, read off the game screen. Applied LAST, after
// both data sources, because that is the whole point: it is for the cases where
// tarkov.dev and the wiki agree with each other and are both wrong. "From Hand
// to Hand" is Skier's now; both sources still say Peacekeeper.
// Objective text the wiki has and tarkov.dev has not. Only the same-length
// case is swapped here, so every objective keeps its id and nothing that hangs
// off an id — a hand tick, a map pin — moves. Most of these ADD the count the
// data's description leaves out ("Eliminate 5 Scavs…" against "Eliminate Scavs…").
// TWO layers rewrite objective text, and the ORDER IS THE WHOLE POINT.
//
//   t.objectiveTextById   the GAME's own wording, off the quest screen, dated,
//                         arriving in the quest data. 180 quests carry it.
//   WIKI_OBJ_TEXT         a bundled bake of the wiki. Undated, and it predates
//                         the app reading its own API.
//
// The wiki bake used to be the only one and ran over everything. It now runs
// SECOND, filling in the quests the game has not settled. Left first, it put
// Hot Delivery back to asking for 2 ComTac II headsets where the game asks for
// one, sent Job for a Patriot to three maps the quest no longer uses, and gave
// No Swiping no map at all — the published data had already corrected all three
// and the overlay quietly undid it.
function applyWikiObjectives() {
  const wiki = (typeof WIKI_OBJ_TEXT !== 'undefined' && WIKI_OBJ_TEXT) || null;
  let n = 0;
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) {
      const own = t.objectiveTextById || null;
      const fromWiki = wiki ? wiki[t.id] : null;
      if (!own && !fromWiki) continue;
      for (const o of t.objectives || []) {
        const text = (own && own[o.id]) || (fromWiki && fromWiki[o.id]) || null;
        if (text && text !== o.description) { o.description = text; n++; }
      }
    }
  }
  return n;
}

// Quests 1.1.0 added that tarkov.dev has never published. Built into the same
// shape a real task has, so every screen treats them normally — they group,
// search, tick and lock like anything else. They carry `_handAdded` so the
// details panel can say where they came from, and they hold OUR id, so they can
// never tick themselves from a log: the log carries BSG's id.
function addExtraQuests() {
  if (typeof EXTRA_QUESTS === 'undefined' || !EXTRA_QUESTS) return 0;
  let n = 0;
  // PvP and PvE only. Seasonal ships its own shorter list and there is no
  // evidence either way about these, which is not a reason to invent some.
  for (const mode of ['regular', 'pve']) {
    const list = state.tasksByMode[mode];
    if (!Array.isArray(list)) continue;
    for (const q of EXTRA_QUESTS) {
      if (list.some((t) => t.id === q.id)) continue;
      list.push({
        id: q.id,
        name: q.name,
        trader: { name: q.trader },
        map: q.map ? { name: q.map } : null,
        minPlayerLevel: q.minPlayerLevel || 0,
        objectives: (q.objectives || []).map((d, i) => ({ id: `${q.id}:${i}`, description: d, optional: false })),
        taskRequirements: [],
        traderRequirements: q.loyalty
          ? [{ trader: { name: q.trader }, kind: 'loyalty', compareMethod: '>=', value: q.loyalty, fromWiki: true }]
          : [],
        kappaRequired: false,
        lightkeeperRequired: false,
        _handAdded: true,
      });
      n++;
    }
  }
  return n;
}

function applyQuestFixes() {
  if (typeof QUEST_TRADERS === 'undefined' || !QUEST_TRADERS) return 0;
  const names = (typeof QUEST_NAMES !== 'undefined' && QUEST_NAMES) || {};
  const maps = (typeof QUEST_MAPS !== 'undefined' && QUEST_MAPS) || {};
  const noLevel = (typeof NO_LEVEL !== 'undefined' && NO_LEVEL) || {};
  let n = 0;
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) {
      const trader = QUEST_TRADERS[t.id];
      if (trader && t.trader && t.trader.name !== trader) {
        t._oldTrader = t.trader.name;
        // a fresh object: the trader is per task, but never assume that of data
        // that arrived from somewhere else
        t.trader = { ...t.trader, name: trader };
        n++;
      }
      const fresh = names[t.id];
      if (fresh && fresh !== t.name) {
        if (!t._oldName) t._oldName = t.name;   // keep the ORIGINAL for search
        t.name = fresh;
        n++;
      }
      // A quest 1.1.0 MOVED to another map. Retag the objectives that still
      // carry the old one as well as the task itself: effectiveMap() reads
      // task.map, but the details panel and the map screen read the objective
      // tags, and a quest filed under The Lab whose objective still says
      // Interchange would draw a pin on the wrong map.
      const moved = maps[t.id];
      if (moved) {
        const want = Array.isArray(moved) ? moved : [moved];
        const was = (t.map && t.map.name) || null;
        if (!(want.length === 1 && was === want[0])) {
          if (was) t._oldMap = was;
          // one map -> the task carries it; several -> the task carries none and
          // the objectives list them, the shape every multi-map quest already has
          t.map = want.length === 1 ? { ...(t.map || {}), name: want[0] } : null;
          for (const o of t.objectives || []) {
            const stale = (n2) => !!n2 && (!was || normMapName(n2) === normMapName(was));
            if ((o.maps || []).some((m) => stale(m.name))) {
              o.maps = want.map((name) => ({ name }));
            }
            // ⚠️ DROP coordinates that belonged to the old map, never relabel
            // them: a zone position is a point on the OLD map and would land
            // somewhere arbitrary but plausible-looking on the new one.
            if (o.zones) o.zones = o.zones.filter((z) => !(z && z.map && stale(z.map.name)));
            if (o.possibleLocations) {
              o.possibleLocations = o.possibleLocations.filter((l) => !(l && l.map && stale(l.map.name)));
            }
          }
          n++;
        }
      }
      // a level requirement the game has demonstrably stopped applying. Same
      // removal applyWikiReqs does, from the owner's screen instead of the wiki,
      // and it keeps the dropped value the same way so it stays auditable.
      if (noLevel[t.id] && t.minPlayerLevel) {
        t._devLevel = t.minPlayerLevel;
        t.minPlayerLevel = 0;
        n++;
      }
    }
    // renamed here too, so a prerequisite reference never shows the old title
    for (const t of list || []) {
      for (const r of t.taskRequirements || []) {
        const fresh = r.task && names[r.task.id];
        if (fresh && r.task.name !== fresh) r.task.name = fresh;
      }
    }
  }
  return n;
}

function applyWikiReqs() {
  if (typeof WIKI_TRADER_REQS === 'undefined' || !WIKI_TRADER_REQS) return 0;
  const gone = (typeof WIKI_NO_LEVEL !== 'undefined' && WIKI_NO_LEVEL) || {};
  let added = 0;
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) {
      // The one thing the wiki is allowed to REMOVE: a player level its own
      // Requirements section does not list. 1.1.0 swapped most of those for a
      // loyalty gate and tarkov.dev still publishes the old number, so the
      // quest showed a level that has not applied since the patch. Only for
      // pages that actually have a filled-in section — see build_wikireqs.js.
      // `_devLevel` keeps the dropped value so this is auditable from a console
      // rather than being an invisible edit to the data.
      if (gone[t.id] && t.minPlayerLevel) { t._devLevel = t.minPlayerLevel; t.minPlayerLevel = 0; }
      const extra = WIKI_TRADER_REQS[t.id];
      if (!extra || !extra.length) continue;
      const have = t.traderRequirements || (t.traderRequirements = []);
      for (const r of extra) {
        if (have.some((h) => (h.trader || {}).name === r.trader && h.kind === r.kind)) continue;
        have.push({ trader: { name: r.trader }, kind: r.kind, compareMethod: '>=', value: r.value, fromWiki: true });
        added++;
      }
    }
  }
  return added;
}

function applyObjectiveFixes() {
  if (typeof MAP_FIXES === 'undefined' || !MAP_FIXES) return;
  const fx = MAP_FIXES.objectives || {};
  const ff = MAP_FIXES.objectiveFloors || {};
  const hid = MAP_FIXES.hidden || {};
  // the guard must count HIDDEN too — hiding a pin with no position moves
  // recorded would otherwise be a silent no-op
  if (!Object.keys(fx).length && !Object.keys(ff).length && !Object.keys(hid).length) return;
  const apply = (mapName, oid, p) => {
    if (!mapName || !p) return;
    // the key always derives from the PRISTINE coords — after a move applied,
    // `_o` holds them, which also keeps re-applying idempotent
    const key = `${mapName}|${oid}|${Math.round(p._o ? p._o[0] : p.x)}|${Math.round(p._o ? p._o[1] : p.z)}`;
    const m = fx[key];
    if (m && !p._o) { p._o = [p.x, p.z]; p.x = m.x; p.z = m.z; }
    // hand floor reassignment — the data's y files some pins on the wrong storey
    if (typeof ff[key] === 'number') p._floor = ff[key];
  };
  const gone = hid;
  const isGone = (mapName, oid, p) => !!(mapName && p
    && gone[`api|${mapName}|${oid}|${Math.round(p._o ? p._o[0] : p.x)}|${Math.round(p._o ? p._o[1] : p.z)}`]);
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) for (const o of t.objectives || []) {
      for (const z of o.zones || []) if (z && z.position && z.map) apply(normMapName(z.map.name), o.id, z.position);
      for (const l of o.possibleLocations || []) {
        for (const p of l.positions || []) apply(normMapName(l.map && l.map.name), o.id, p);
      }
      // drop the positions the owner marked as no longer in the game
      if (o.zones) o.zones = o.zones.filter((z) => !(z && z.position && z.map && isGone(normMapName(z.map.name), o.id, z.position)));
      for (const l of o.possibleLocations || []) {
        if (l.positions) l.positions = l.positions.filter((p) => !isGone(normMapName(l.map && l.map.name), o.id, p));
      }
    }
  }
}

const hasMapMarkers = (name) => typeof MAP_MARKERS !== 'undefined' && !!MAP_MARKERS[name]
  && Object.values(MAP_MARKERS[name]).some((rows) => rows.length);

// Upstream data is not the only source of markers: hand-marked hazards and
// hand-placed interactables can exist on a map that ships NONE (Terminal —
// artwork, no published features). Anything that decides "is there a marker
// layer here at all" must ask THIS, or hand-placed work is silently invisible.
// hasMapMarkers stays as-is where the question really is about upstream data
// (the "markers tarkov.dev" credit).
const handMarkersFor = (name) => {
  const hz = (typeof STORY_HAZARDS !== 'undefined' ? STORY_HAZARDS : [])
    .filter((h) => h.map === name && (h.pts || []).length).length;
  const sw = (typeof HAND_INTERACTABLES !== 'undefined' ? HAND_INTERACTABLES : [])
    .filter((h) => h.map === name && (h.pts || []).length).length;
  return hz + sw;
};
// ...or any BattlePass document type, which has no markers by nature. Without
// that last clause the whole LAYERS panel stays hidden on Icebreaker — a map
// with nothing in the marker bake at all, and two document types on it.
const hasAnyMarkers = (name) => hasMapMarkers(name) || handMarkersFor(name) > 0
  || bpDocsOnMap(name).length > 0;

// ---------- map artwork variants ----------
// Some maps ship more than one picture. The Lab is the first: tarkov.dev's
// render draws the southern containment block, Shebuka's schematic does not,
// and the schematic is still the cleaner read where the two agree — so both
// ship and the player picks.
//
// Switching is a DATA SWAP, not a branch: the chosen variant's fields are copied
// onto MAP_DATA before anything reads it, so mapPoint, floorOf, drawMap, the
// floor machinery and the dev editor all keep working without knowing variants
// exist. Each variant carries its own bounds, because different artwork covers
// a different rectangle of the world — that is the whole point here.
function mapArtVariants(name) {
  const md = (typeof MAP_DATA !== 'undefined' && MAP_DATA[name]) || null;
  return (md && Array.isArray(md.art)) ? md.art : [];
}
function chosenArtId(name) {
  const list = mapArtVariants(name);
  if (!list.length) return null;
  const want = ((state.settings && state.settings.mapArt) || {})[name];
  return (list.find((a) => a.id === want) || list[0]).id;
}
// One row per map that ships more than one picture. Built from the data, so a
// second variant added to any other map needs no code here.
function renderMapArtSettings() {
  const group = $('mapArtGroup');
  const host = $('mapArtRows');
  if (!group || !host) return;
  const maps = Object.keys((typeof MAP_DATA !== 'undefined' && MAP_DATA) || {})
    .filter((n) => mapArtVariants(n).length > 1);
  group.hidden = !maps.length;
  if (!maps.length) { host.innerHTML = ''; return; }
  host.innerHTML = maps.map((n) => `<div class="toggle-row">
      <span>${escapeHtml(n)}</span>
      <select class="art-select" data-map="${escapeHtml(n)}">${mapArtVariants(n).map((a) =>
        `<option value="${escapeHtml(a.id)}"${a.id === chosenArtId(n) ? ' selected' : ''}>${escapeHtml(a.label || a.id)}</option>`).join('')}</select>
    </div>`).join('');
  for (const sel of host.querySelectorAll('select[data-map]')) {
    sel.addEventListener('change', async () => {
      const next = { ...((state.settings && state.settings.mapArt) || {}), [sel.dataset.map]: sel.value };
      state.settings = { ...state.settings, mapArt: next };
      applyMapArt();
      // a map already open has to be rebuilt against the new bounds, or it
      // keeps drawing the old artwork's geometry under the new picture
      if (mapView && mapView.name === sel.dataset.map) await openQuestMap(sel.dataset.map);
      state.settings = await backend.saveSettings({ mapArt: next });
    });
  }
}

// idempotent: safe to call on every render, and it must be, because the setting
// can change while a map is open
function applyMapArt() {
  if (typeof MAP_DATA === 'undefined') return;
  for (const name of Object.keys(MAP_DATA)) {
    const list = mapArtVariants(name);
    if (!list.length) continue;
    const pick = list.find((a) => a.id === chosenArtId(name)) || list[0];
    for (const k of ['svg', 'viewBox', 'bounds', 'rotate', 'baseLayer', 'approx']) {
      if (pick[k] !== undefined) MAP_DATA[name][k] = pick[k];
    }
    // `credit` matters as much as the geometry — the footer names whoever drew
    // what is on screen — and it is assigned UNCONDITIONALLY, including to
    // undefined. Skipping it when a variant has none would leave the previous
    // variant's credit on screen, which is worse than crediting nobody: it
    // credits the wrong artist for someone else's work.
    MAP_DATA[name].credit = pick.credit;
  }
}

// One row per checkbox. This is the single source of truth: it drives the panel,
// the glyph, the legend swatch, the settings key and the filter, so none of
// those can drift apart. `cat` indexes mapmarkers.js's category codes.
// Loose-loot categories, in panel order. The codes are indexes into CAT_NAMES in
// mapmarkers.js, so this list must stay in that order.
// Loose-loot categories, in the order of CAT_NAMES in mapmarkers.js — the code in
// each row is an index into that, so this list must not be reordered
// independently. One glyph per type: you should be able to tell what a marker is
// without reading the panel.
const LOOT_CATS = [
  { id: 'lootKeys', label: 'Keys', glyph: 'key', cls: 'mk-keys' },
  { id: 'lootKeycards', label: 'Keycards', glyph: 'card', cls: 'mk-keycard' },
  { id: 'lootValuables', label: 'Valuables', glyph: 'gem', cls: 'mk-val' },
  { id: 'lootMedical', label: 'Medical', glyph: 'cross', cls: 'mk-med' },
  { id: 'lootStims', label: 'Stims & injectors', glyph: 'stim', cls: 'mk-stim' },
  { id: 'lootElectronics', label: 'Electronics', glyph: 'chip', cls: 'mk-elec' },
  { id: 'lootIntel', label: 'Intel & documents', glyph: 'folder', cls: 'mk-intel' },
  { id: 'lootTools', label: 'Tools & materials', glyph: 'nut', cls: 'mk-tool' },
];

// Every static container type, grouped the way a player thinks about them. Keyed
// by normalizedName so it lines up with CONTAINER_TYPES by name, never position.
const CONTAINER_UI = {
  'weapon-box': ['Weapon box', 'pistol', 'mk-weapon'],
  'wooden-ammo-box': ['Wooden ammo box', 'rounds', 'mk-weapon'],
  'grenade-box': ['Grenade box', 'grenade', 'mk-weapon'],
  'medcase': ['Medcase', 'cross', 'mk-med'],
  'medbag-smu06': ['Medbag SMU06', 'cross', 'mk-med'],
  'medical-supply-crate': ['Medical supply crate', 'cross', 'mk-med'],
  'toolbox': ['Toolbox', 'toolbox', 'mk-tool'],
  'technical-supply-crate': ['Technical supply crate', 'gear', 'mk-tool'],
  'ration-supply-crate': ['Ration supply crate', 'cutlery', 'mk-food'],
  'safe': ['Safe', 'safe', 'mk-safe'],
  'bank-safe': ['Bank safe', 'safe', 'mk-safe'],
  'cash-register': ['Cash register', 'rouble', 'mk-till'],
  'bank-cash-register': ['Bank cash register', 'rouble', 'mk-till'],
  'pc-block': ['PC block', 'pcblock', 'mk-pc'],
  'jacket': ['Jacket', 'shirt', 'mk-jacket'],
  'plastic-suitcase': ['Plastic suitcase', 'bag', 'mk-jacket'],
  'duffle-bag': ['Duffle bag', 'bag', 'mk-common'],
  'drawer': ['Drawer', 'drawers', 'mk-common'],
  'wooden-crate': ['Wooden crate', 'crate', 'mk-common'],
  'buried-barrel-cache': ['Buried barrel cache', 'cache', 'mk-cache'],
  'ground-cache': ['Ground cache', 'cache', 'mk-cache'],
  'shturmans-stash': ["Shturman's stash", 'cache', 'mk-cache'],
  'dead-scav': ['Dead Scav', 'body', 'mk-body'],
  'scav-body': ['Scav body', 'body', 'mk-body'],
  'pmc-body': ['PMC body', 'body', 'mk-body'],
  'civilian-body': ['Civilian body', 'body', 'mk-body'],
  'lab-technician-body': ['Lab technician body', 'body', 'mk-body'],
};
// Sub-headings inside the container group, and which types sit under each.
const CONTAINER_SUBS = [
  ['Weapons & ammo', ['weapon-box', 'wooden-ammo-box', 'grenade-box']],
  ['Medical', ['medcase', 'medbag-smu06', 'medical-supply-crate']],
  ['Tools & materials', ['toolbox', 'technical-supply-crate']],
  ['Provisions', ['ration-supply-crate']],
  ['Valuables', ['safe', 'bank-safe']],
  ['Money', ['cash-register', 'bank-cash-register']],
  ['Electronics', ['pc-block']],
  ['Clothing & bags', ['jacket', 'plastic-suitcase', 'duffle-bag']],
  ['Crates & drawers', ['drawer', 'wooden-crate']],
  ['Caches & stashes', ['buried-barrel-cache', 'ground-cache', 'shturmans-stash']],
  ['Bodies', ['dead-scav', 'scav-body', 'pmc-body', 'civilian-body', 'lab-technician-body']],
];
const containerTypes = () => (typeof CONTAINER_TYPES !== 'undefined' ? CONTAINER_TYPES : []);
const containerLayerId = (normalizedName) => 'cont:' + normalizedName;
function containerRow(n) {
  const ui = CONTAINER_UI[n] || [n, 'crate', 'mk-common'];
  return { id: containerLayerId(n), label: ui[0], glyph: ui[1], cls: ui[2], container: true };
}

const MARKER_GROUPS = [
  {
    id: 'extracts', title: 'EXTRACTS',
    note: 'Extracts usable by both show whenever either box is ticked. Ones on another floor are greyed out.',
    rows: [
      { id: 'extractPmc', label: 'PMC', glyph: 'exit', cls: 'mk-pmc' },
      { id: 'extractScav', label: 'Scav', glyph: 'exit', cls: 'mk-scav' },
    ],
  },
  {
    id: 'transits', title: 'TRANSITS',
    note: 'Walk in to travel to another map instead of extracting.',
    rows: [{ id: 'transitAll', label: 'To another map', glyph: 'arrow', cls: 'mk-transit' }],
  },
  {
    id: 'interact', title: 'INTERACTABLES',
    note: 'Levers and switches you can operate — they open doors, power extracts or start something.',
    rows: [{ id: 'switchAll', label: 'Levers & switches', glyph: 'lever', cls: 'mk-switch' }],
  },
  {
    id: 'bpdocs', title: 'BP DOCUMENTS',
    note: 'Season 1 documentation. Nobody publishes positions for these, so ticking one lists its known spots in the panel on the left rather than pinning them.',
    // built from the data, so a type the wiki adds later needs no code change
    get rows() {
      return bpDocs().map((d) => ({
        id: bpLayerId(d),
        label: d.name,
        // one icon per type, painted from its own artwork — see BP_DOC_GLYPHS
        glyph: bpGlyph(d.name),
        cls: bpCls(d.name),
        // counts DESCRIBED SPOTS on the open map, not markers — there are no
        // markers yet, and a row reading "0" for a type that spawns here would
        // be a lie about the game rather than about our data
        // pins placed on this map — the only number there is now that the
        // written spot descriptions are gone
        count: () => ((d.pins && d.pins[mapView.name]) || []).length,
        // ...and it stays tickable even at zero, because "this type spawns here,
        // spots not written up yet" is worth being able to switch on
        live: () => (d.spots && Object.prototype.hasOwnProperty.call(d.spots, mapView.name)),
      }));
    },
  },
  {
    id: 'keys', title: 'KEYS & KEYCARDS',
    note: 'Spots a key can turn up at. None of them is a guaranteed spawn.',
    rows: LOOT_CATS.slice(0, 2),
  },
  {
    id: 'loot', title: 'LOOSE LOOT SPAWNS',
    // Every marker means the same thing, so every marker reads the same. Whether
    // one or four other items compete for the exact spot changes nothing a player
    // can act on, and dressing it up as two tiers implied one of them was reliable.
    note: 'Spots where that kind of item can turn up. Nothing here is guaranteed.',
    // High value is data-driven, never a hand list: whatever cleared the
    // rouble bar (LOOT_HV_MIN) when the marker data was baked. Those
    // spots draw the gold star INSTEAD of their category glyph and show under
    // either tick box — see collectMapMarkers.
    //
    // The SECOND high-value row is the one exception to "every marker reads the
    // same", and it is drawn from data rather than judgement: a point offering
    // more items than the bake's pool bar is a shared loot table. Those points
    // are the only way LEDX, GPU, Defib and bitcoin appear at all in most of
    // their spots, so hiding them was worse — but a hollow star and a separate
    // box keep them from being mistaken for a run worth making.
    rows: [
      { id: 'lootHighValue', label: 'High value', glyph: 'star', cls: 'mk-hv' },
      { id: 'lootHighValuePool', label: 'High value · long shot', glyph: 'starOpen', cls: 'mk-hv' },
    ].concat(LOOT_CATS.slice(2)).concat([
      // Posters. One row, no names: 56 poster items exist, none has an item
      // record, no parent category and no rarity — nothing separates them but
      // a name. And not one of these points is dedicated: nearly every one
      // offers 21+ different items, so this marks "a poster can turn up here",
      // which is the only honest claim the data supports.
      { id: 'lootPosters', label: 'Posters', glyph: 'folder', cls: 'mk-poster' },
    ]),
  },
  {
    id: 'containers', title: 'CONTAINERS',
    note: 'The container is part of the map and is there every raid. What is inside it is not.',
    subs: CONTAINER_SUBS
      .map(function (e) {
        return { title: e[0], rows: e[1].filter(function (n) { return containerTypes().indexOf(n) >= 0; }).map(containerRow) };
      })
      .filter(function (sub) { return sub.rows.length; }),
  },
  {
    id: 'marked', title: 'MARKED ROOMS',
    note: 'High-value pool, but dozens to hundreds of possible items — click one to see how many.',
    rows: [{ id: 'markedRooms', label: 'Marked rooms', glyph: 'marked', cls: 'mk-marked', container: true }],
  },
  {
    id: 'locks', title: 'LOCKED DOORS & CONTAINERS',
    rows: [{ id: 'lockAll', label: 'Needs a key', glyph: 'key', cls: 'mk-lock', container: true }],
  },
  {
    id: 'hazards', title: 'HAZARDS',
    // hazardOther is upstream's third type — The Labyrinth's traps (toxic
    // pools, steam, fire, shotgun traps). Amber, so it reads apart from the
    // red minefield triangle; greyed out on maps that have none, like any row.
    rows: [
      { id: 'hazardMinefield', label: 'Minefields', glyph: 'mine', cls: 'mk-mine' },
      { id: 'hazardSniper', label: 'Sniper zones', glyph: 'sniper', cls: 'mk-sniper' },
      { id: 'hazardOther', label: 'Traps & hazards', glyph: 'mine', cls: 'mk-hazard' },
    ],
  },
  {
    id: 'mapText', title: 'MAP',
    rows: [{ id: 'mapLabels', label: 'Location names', glyph: 'text', cls: 'mk-label', always: true }],
  },
];
// A group holds rows directly, or sub-headed blocks of them.
const groupRows = (g) => (g.rows || []).concat((g.subs || []).reduce(function (a, sub) { return a.concat(sub.rows); }, []));
const MARKER_ROWS = MARKER_GROUPS.reduce(function (a, g) { return a.concat(groupRows(g)); }, []);

// Read defensively: settings.mapLayers can be missing on an install that predates
// the feature, and drawMap() runs on every frame of a zoom.
const layerOn = (id) => !!((state.settings && state.settings.mapLayers) || {})[id];

// Location names are the one layer that defaults ON: they were always drawn
// before this toggle existed, and an upgrade that silently stripped them would
// read as a bug. Absent therefore means shown, not hidden.
function labelsOn() {
  const v = ((state.settings && state.settings.mapLayers) || {}).mapLabels;
  return v === undefined ? true : !!v;
}

// Both of these update local state SYNCHRONOUSLY before persisting. Ticking two
// boxes in quick succession fires two of these before either save resolves; if
// each one read state.settings only at call time, both would build on the same
// stale object and the second write would drop the first box's change. Applying
// it locally first means the later call already contains the earlier one.
// ---------- item search over the loot markers ----------
//
// WHAT THIS CAN AND CANNOT FIND, because the difference is not visible on
// screen and a search that quietly misses things is worse than none.
//
// A spawn point emits ONE marker PER CATEGORY, labelled with the DEAREST item
// of that category there (see build_mapmarkers.js — first-wins used to hide 86
// high-value spawns behind a cheaper neighbour). So an item is findable at a
// point only where it is the priciest thing of its kind there. That makes the
// search near-complete for the expensive items people actually hunt, and
// increasingly lossy the cheaper the item: search a Salewa and every shelf that
// can also roll a LEDX is invisible, because that shelf is filed under LEDX.
//
// `alts` is a COUNT, not a list, so the alternates' names are not in the data
// at all — this cannot be fixed here, only by re-baking. Until then the honest
// move is to say what a spot IS: the chip carries how many of its points are
// dedicated, which is the one strong claim the data supports.
// EVERY ITEM AT EVERY POSITION, which is what the map layers throw away.
//
// `LT_POS` holds each loose position once; `LT_ITEMS` maps an item to the
// positions it can roll at, delta-encoded in base 36. Both directions are needed
// — the search reads item -> positions, the layers need position -> items — so
// the inverse is built once here rather than at every draw.
let _byPos = null;
function lootByPosition() {
  if (_byPos) return _byPos;
  const items = (typeof LT_ITEMS !== 'undefined' && LT_ITEMS) || {};
  const out = new Map();
  for (const name of Object.keys(items)) {
    for (const i of decodePositions(items[name])) {
      let a = out.get(i);
      if (!a) { a = []; out.set(i, a); }
      a.push(name);
    }
  }
  _byPos = out;
  return out;
}
function decodePositions(enc) {
  if (!enc) return [];
  let prev = 0;
  return String(enc).split('.').map((t) => { prev += parseInt(t, 36); return prev; });
}

// The loose-loot LAYER rows, rebuilt from the index. This is the rule the bake
// used to apply and now applies here, unchanged and for the same reasons: one
// row per CATEGORY at a point, labelled with the dearest item of that category
// (first-wins hid 86 high-value spawns behind cheaper neighbours), and a point
// offering more than LOOT_POOL_MAX things is a shared table rather than a spawn
// worth marking — except for its high-value items, which are the only way LEDX
// and bitcoin appear at all in most of their spots.
let _lootRows = null;
function lootRowsFor(mapName) {
  if (!_lootRows) _lootRows = new Map();
  if (_lootRows.has(mapName)) return _lootRows.get(mapName);
  const pos = (typeof LT_POS !== 'undefined' && LT_POS) || [];
  const maps = (typeof LT_MAPS !== 'undefined' && LT_MAPS) || [];
  const cats = (typeof LT_CATS !== 'undefined' && LT_CATS) || {};
  const poolMax = typeof LOOT_POOL_MAX !== 'undefined' ? LOOT_POOL_MAX : 5;
  const hvMin = typeof LOOT_HV_MIN !== 'undefined' ? LOOT_HV_MIN : Infinity;
  const byPos = lootByPosition();
  const rows = [];
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (maps[p[3]] !== mapName) continue;
    const here = byPos.get(i) || [];
    const best = new Map();
    for (const name of here) {
      const c = cats[name];
      if (c === undefined) continue;
      const val = ((typeof LOOT_VALUE !== 'undefined' && LOOT_VALUE[name]) || [0])[0];
      const cur = best.get(c);
      if (!cur || val > cur.val) best.set(c, { name, val });
    }
    const big = p[4] > poolMax;
    for (const [c, bst] of best) {
      if (big && bst.val < hvMin) continue;
      rows.push([p[0], p[1], p[2], c, p[4] - 1, bst.name]);
    }
  }
  _lootRows.set(mapName, rows);
  return rows;
}

let _itemIndex = null;
function itemSpawnIndex() {
  if (_itemIndex) return _itemIndex;
  const M = (typeof MAP_MARKERS !== 'undefined' && MAP_MARKERS) || {};
  const idx = new Map();
  const put = (name, map, dedicated) => {
    if (!name) return;
    let e = idx.get(name);
    if (!e) {
      const lv = (typeof LOOT_VALUE !== 'undefined' && LOOT_VALUE[name]) || null;
      e = { name, value: lv ? lv[0] : 0, maps: new Map(), total: 0 };
      idx.set(name, e);
    }
    let m = e.maps.get(map);
    if (!m) { m = { n: 0, dedicated: 0 }; e.maps.set(map, m); }
    m.n++; e.total++;
    if (dedicated) m.dedicated++;
  };
  // FROM THE INDEX, not from the layer rows. The rows keep only the dearest item
  // of each category at a point, which is why searching BakeEzy used to answer
  // "3 spots, Streets only" when it has 148 across seven maps.
  const pos = (typeof LT_POS !== 'undefined' && LT_POS) || [];
  const maps = (typeof LT_MAPS !== 'undefined' && LT_MAPS) || [];
  const items = (typeof LT_ITEMS !== 'undefined' && LT_ITEMS) || {};
  for (const name of Object.keys(items)) {
    for (const i of decodePositions(items[name])) {
      const p = pos[i];
      if (!p) continue;
      // DEDICATED means nothing else can roll at that exact spot: a pool of one
      put(name, maps[p[3]], p[4] === 1);
    }
  }
  for (const map of Object.keys(M)) {
    // a locked door is where the key opens, not where it spawns — but "which
    // door does this key open" is the same question asked backwards, and the
    // marker names the key, so it answers to the same box
    for (const r of M[map].lk || []) put(r[5] || r[4], map, true);
  }
  _itemIndex = idx;
  return idx;
}

// HOW MANY CONTAINERS ON A MAP COULD HOLD IT. A far weaker claim than a loose
// spot — the item is on that container type's table somewhere, at odds nobody
// publishes — so it is counted separately, never added into the spot count.
let _contCount = null;
function containerCountFor(name, mapName) {
  if (!_contCount) _contCount = new Map();
  const key = name + '|' + mapName;
  if (_contCount.has(key)) return _contCount.get(key);
  const cont = (typeof LT_CONT !== 'undefined' && LT_CONT[name]) || null;
  const M = (typeof MAP_MARKERS !== 'undefined' && MAP_MARKERS[mapName]) || {};
  let n = 0;
  if (cont) for (const r of M.co || []) if (cont.includes(r[3])) n++;
  _contCount.set(key, n);
  return n;
}

const itemsState = () => (state.settings && state.settings.mapItems) || {};
const pinnedItems = () => itemsState().pinned || [];
const itemFilterSet = () => new Set((itemsState().on || []).filter((n) => pinnedItems().includes(n)));
// OFF by default, and it has to be: bitcoin's seven container types cover 402
// of Streets' 998 containers, which turns an answer into a smear unless it was
// asked for. The count sits on the chip either way, so it is discoverable
// without being imposed.
const showContainers = () => !!itemsState().containers;

async function saveItems(next) {
  state.settings = { ...state.settings, mapItems: next };
  // The searched-for markers are BUILT from the tick state, so the marker set
  // has to be rebuilt, not just redrawn.
  if (mapView.name) mapView.markers = collectMapMarkers(mapView.name);
  drawMap();
  renderMapLayers();
  state.settings = await backend.saveSettings({ mapItems: next });
}
function pinItem(name, on) {
  const pinned = pinnedItems().filter((n) => n !== name);
  const ticked = (itemsState().on || []).filter((n) => n !== name);
  if (on) { pinned.push(name); ticked.push(name); }   // pinning ticks it: nobody pins to then switch it on
  return saveItems({ pinned, on: ticked });
}
function tickItem(name, on) {
  const ticked = (itemsState().on || []).filter((n) => n !== name);
  if (on) ticked.push(name);
  return saveItems({ pinned: pinnedItems(), on: ticked });
}

async function setLayer(id, on) {
  const next = { ...((state.settings && state.settings.mapLayers) || {}), [id]: on };
  state.settings = { ...state.settings, mapLayers: next };
  drawMap();
  // A BattlePass document layer has nothing to draw — its whole output is the
  // list in the side panel, so redrawing the map alone leaves the tick looking
  // broken. Only that group needs this: every other layer IS map geometry.
  if (String(id).startsWith('bp:') && mapView.name) renderMapLoadout(mapView.name);
  state.settings = await backend.saveSettings({ mapLayers: next });
}

async function setGroupOpen(id, open) {
  const next = { ...((state.settings && state.settings.mapLayersOpen) || {}), [id]: open };
  state.settings = { ...state.settings, mapLayersOpen: next };
  state.settings = await backend.saveSettings({ mapLayersOpen: next });
}

// What an extract charges to let you out. Say the item's real name rather than
// paraphrasing it: the short forms are "Code" and "Mines", and guessing at those
// produced two wrong labels — "Mines" is the Minefield map item, not a detector,
// and every smuggler extract wants its own named note.
function tollLabel(item, count) {
  if (/^roubles?$/i.test(item)) return `${Number(count).toLocaleString('en-US')} roubles`;
  return count > 1 ? `${count} x ${item}` : item;
}
// The vehicle fee in the data is a BASE value. What you actually pay scales with
// Scav karma, and a well-regarded player pays a good deal less — so the card must
// not present 20,000 as the price.
const isFee = (item) => /^roubles?$/i.test(item);

// Gear requirements are NOT in tarkov.dev's extract data — it only carries the
// `transferItem` toll — so these few are listed by hand from the wiki. Keyed by
// map and the extract's exact upstream name; a rename just means the line stops
// showing, never a wrong one. Keep this short and only for things that are
// stable and well documented.
const EXTRACT_GEAR = {
  'Reserve|Cliff Descent': ['a Paracord and a Red Rebel ice pick'],
  'Lighthouse|Mountain Pass': ['a Paracord and a Red Rebel ice pick'],
  'Shoreline|Climber\'s Trail': ['a Paracord and a Red Rebel ice pick'],
};
const extractGear = (map, name) => EXTRACT_GEAR[`${map}|${name}`] || [];

// Decode the packed rows into marker objects once per map open. Each marker
// carries the list of layer ids that would show it — a shared extract belongs to
// both PMC and Scav, so it appears once whichever of the two is ticked instead
// of twice when both are.
function collectMapMarkers(mapName) {
  const md = MAP_DATA[mapName];
  if (!md || !hasAnyMarkers(mapName)) return [];
  // may be a map with no upstream features at all — the hand-placed loops at
  // the bottom are the whole point of still being here
  const M = (typeof MAP_MARKERS !== 'undefined' && MAP_MARKERS[mapName]) || {};
  const out = [];
  const add = (x, y, z, layers, glyph, cls, title, lines, extra) => {
    if (typeof x !== 'number' || typeof z !== 'number') return;
    out.push(Object.assign({ x, y: y || 0, z, layers, glyph, cls, title, lines,
      floor: floorOf(md, x, y || 0, z) }, extra || {}));
  };

  // Where the switch that opens an extract is. Two sources, both wanted: the
  // DATA's own (a switch row naming this extract in its `opens` column — free,
  // and covers Reserve/Lab/Customs) and hand links from the editor for the ones
  // it misses. Points, not keys, so drawMap just draws.
  const switchPointsFor = (row) => {
    const pts = [];
    const at = (sr) => ({ x: sr[0], z: sr[2], floor: floorOf(md, sr[0], sr[1], sr[2]) });
    for (const sr of M.sw || []) {
      if ((sr[4] || '').split(' | ').includes(row[5])) pts.push(at(sr));
    }
    for (const lk of row._links || []) {
      const i = lk.indexOf('|');
      const kind = lk.slice(0, i), rk = lk.slice(i + 1);
      if (kind === 'sw') {
        const sr = (M.sw || []).find((q) => `${mapName}|${Math.round(q._o ? q._o[0] : q[0])}|${Math.round(q._o ? q._o[1] : q[2])}` === rk);
        if (sr) pts.push(at(sr));
      } else if (kind === 'ann') {
        const h = (typeof HAND_INTERACTABLES !== 'undefined' ? HAND_INTERACTABLES : [])
          .find((q) => q.id === rk && q.map === mapName);
        if (h && (h.pts || []).length) {
          pts.push({ x: h.pts.reduce((t, q) => t + q.x, 0) / h.pts.length,
                     z: h.pts.reduce((t, q) => t + q.z, 0) / h.pts.length,
                     floor: typeof h.floor === 'number' ? h.floor : -1 });
        }
      }
    }
    // one switch can open two extracts and vice versa; de-duplicate by position
    const seen = new Set();
    return pts.filter((q) => { const k = q.x + ',' + q.z; if (seen.has(k)) return false; seen.add(k); return true; });
  };

  for (const r of M.ex || []) {
    const [x, y, z, fac, sw, name, toll, tollN] = r;
    const layers = fac === 0 ? ['extractPmc'] : fac === 1 ? ['extractScav'] : ['extractPmc', 'extractScav'];
    const who = fac === 0 ? 'PMC extract' : fac === 1 ? 'Scav extract' : 'PMC and Scav extract';
    const lines = [['', who]];
    if (toll) {
      lines.push([isFee(toll) ? 'Fee' : 'Needs', tollLabel(toll, tollN)]);
      if (isFee(toll)) lines.push(['', 'Base fee — you pay less with better Scav karma']);
    }
    if (sw) lines.push(['Needs', 'a switch or lever thrown first']);
    for (const g of extractGear(mapName, name)) lines.push(['Needs', g]);
    if (r._note) lines.push(['Needs', r._note]);   // the owner's own correction
    // Where the switch IS matters more than that one exists: they range from
    // right beside the door (D-2, the elevators) to 295 m away and a floor
    // apart (Reserve's Bunker Hermetic Door). A line alone cannot say "it is
    // downstairs", so the card does.
    const swPts = switchPointsFor(r);
    if (swPts.length) {
      if (!sw) lines.push(['Needs', swPts.length > 1 ? 'a switch thrown first' : 'its switch thrown first']);
      const exFloor = typeof r._floor === 'number' ? r._floor
        : floorOf(md, r._o ? r._o[0] : x, y, r._o ? r._o[1] : z);
      const fname = (f) => (f < 0 ? 'ground' : (((md.floors || [])[f] || {}).name || `floor ${f}`).toLowerCase());
      const elsewhere = [...new Set(swPts.filter((q) => q.floor !== exFloor).map((q) => fname(q.floor)))];
      const near = swPts.every((q) => Math.hypot(q.x - x, q.z - z) < 12);
      if (elsewhere.length) lines.push(['', `The switch is on ${elsewhere.join(' / ')}`]);
      else if (near) lines.push(['', 'The switch is right beside it']);
      else lines.push(['', 'Click it to see where the switch is']);
    }
    if (r._hand) lines.push(['', 'Added by hand — not in the API data']);
    const m = out.length;
    // anyFloor: an extract you cannot see is worse than one drawn in the wrong
    // place. They stay on screen whatever floor you are on, greyed when they
    // belong to another one. A hand-ADDED row carries its placed floor
    // (`_floor` — its y is unknown); a hand-moved row (r._o = pristine coords,
    // see applyMapFixes) keeps the floor its ORIGINAL position implies — the
    // move corrects the artwork spot, not the storey.
    add(x, y, z, layers, 'exit', fac === 1 ? 'mk-scav' : 'mk-pmc', name || 'Extract', lines,
      Object.assign({ anyFloor: true }, swPts.length ? { switchPts: swPts } : {},
        typeof r._floor === 'number' ? { floor: r._floor }
          : r._o ? { floor: floorOf(md, r._o[0], y, r._o[1]) } : {}));
    if (out.length > m) out[out.length - 1].label = name || '';   // drawn above the icon
  }
  // Transits behave like extracts for the player (a way OUT of the raid), so
  // they get the same treatment: name above the icon, visible on every floor,
  // greyed when theirs is another one — and the same hand corrections
  // (`_floor` override wins, a moved row keeps its original floor via `_o`).
  for (const r of M.tr || []) {
    const [x, y, z, desc, dest] = r;
    const m2 = out.length;
    add(x, y, z, ['transitAll'], 'arrow', 'mk-transit', `Transit to ${dest}`,
      [['', `Moves you to ${dest} instead of extracting`]].concat(desc && desc !== `Transit to ${dest}` ? [['', desc]] : []),
      Object.assign({ anyFloor: true },
        typeof r._floor === 'number' ? { floor: r._floor }
          : r._o ? { floor: floorOf(md, r._o[0], y, r._o[1]) } : {}));
    if (out.length > m2) out[out.length - 1].label = `To ${dest}`;
  }
  // Switches / levers. `what` was resolved into a sentence at bake time
  // ("Opens the D-2 extract · Needs another switch thrown first"). Same hand
  // corrections as extracts: `_floor` override, original floor for moved rows.
  for (const r of M.sw || []) {
    const [x, y, z, what] = r;
    add(x, y, z, ['switchAll'], 'lever', 'mk-switch', 'Switch / lever',
      [['', what || 'Operates something on this map']],
      typeof r._floor === 'number' ? { floor: r._floor }
        : r._o ? { floor: floorOf(md, r._o[0], y, r._o[1]) } : undefined);
  }
  for (const [x, y, z, type] of M.hz || []) {
    if (type !== 0 && type !== 1 && type !== 2) continue;   // see the note on MARKER_GROUPS.hazards
    const id = ['hazardMinefield', 'hazardSniper', 'hazardOther'][type];
    add(x, y, z, [id], type === 1 ? 'sniper' : 'mine',
      ['mk-mine', 'mk-sniper', 'mk-hazard'][type],
      null, null);                            // no card: a hazard point has nothing to say
  }
  for (const [x, y, z, type, short, full] of M.lk || []) {
    const what = ['Locked door', 'Locked trunk', 'Locked container', 'Locked switch'][type] || 'Locked';
    // `item` is what the item search matches on. Set here and on the loose-loot
    // markers below, and NOWHERE else: a marker carrying it is one the search
    // governs, and the filter reads exactly that.
    add(x, y, z, ['lockAll'], 'key', 'mk-lock', full || short || what, [['', what], ['Opens with', full || short]],
      { item: full || short || '' });
  }
  for (const [x, y, z, cat, alts, item] of lootRowsFor(mapName)) {
    const c = LOOT_CATS[cat];
    if (!c) continue;
    // How many items in total can roll at this exact spot (alts is the count of
    // the OTHERS). Anything over the bake's pool bar is a shared loot table, not
    // a spawn for this item in particular — the Lab's keycard-room shelves offer
    // 22 to 71 things each. Those points reach the map ONLY for their high-value
    // item, and they must not look like the concentrated spots: same gold, drawn
    // hollow, own tick box, and the card leads with the pool size instead of the
    // flat "has a chance to spawn here".
    const poolMax = typeof LOOT_POOL_MAX !== 'undefined' ? LOOT_POOL_MAX : 5;
    const pool = (alts || 0) + 1;
    const diluted = pool > poolMax;
    // Every loose-loot marker means exactly one thing, so every one of them looks
    // and reads the same. How many other items share the exact spot is not
    // something a player can act on, and showing it as two tiers made one of them
    // look reliable.
    //
    // The one sanctioned exception: an item whose baked rouble value clears
    // LOOT_HV_MIN draws as the gold star and belongs to BOTH its category layer
    // and the high-value one (either box shows it, it appears once). That is a
    // statement about the item's price, not about the spawn — the card keeps the
    // same chance sentence and adds what it is worth. Guarded: the layer tests
    // run this without the generated constants.
    // the bar is the item's own worth (lv[0]); lv[1] (per slot) is card detail
    const lv = (typeof LOOT_VALUE !== 'undefined' && LOOT_VALUE[item]) || null;
    const hv = !!lv && typeof LOOT_HV_MIN !== 'undefined' && lv[0] >= LOOT_HV_MIN;
    // No odds anywhere upstream — tarkov.dev's loose-loot type carries items and
    // a position, nothing else — so the card says the one thing that IS known.
    // "One of 44" is not a percentage and must never be dressed up as one: the
    // game weights rare items DOWN inside a pool, so dividing by the pool size
    // would overstate exactly the items this layer exists for.
    const lines = [['', diluted
      ? `One of ${pool} items that can roll at this spot`
      : 'This item has a chance to spawn here']];
    if (hv) {
      const fv = (n) => Math.round(n).toLocaleString('en-US');
      lines.push(['Worth', `≈ ${fv(lv[0])} roubles`
        + (lv[0] !== lv[1] ? ` (${fv(lv[1])} per slot)` : '')]);
    }
    // Worded without reference to how big the pool is: these run from 6 items to
    // 90, and "a pool this big" is silly on the small ones. The count above is
    // the number; this line is only there so nobody has to do the arithmetic to
    // know it is worse odds than a spot with two or three things in it.
    if (diluted) lines.push(['', 'A shared pool — much longer odds than a dedicated spot']);
    const layers = hv ? (diluted ? ['lootHighValuePool'] : [c.id, 'lootHighValue']) : [c.id];
    // `item` is deliberately NOT set here any more. These rows exist for the
    // layer boxes; a ticked item is drawn from the index above, at every spot
    // rather than only the ones it headlines. Leaving the name on would draw a
    // second marker on top of the index's at whichever spots overlap.
    add(x, y, z, layers, hv ? (diluted ? 'starOpen' : 'star') : c.glyph,
      hv ? 'mk-hv' : c.cls, item || c.label, lines, { loose: true, hv, pool });
  }
  // EVERY SPOT A TICKED ITEM CAN ROLL AT, from the index rather than the layer
  // rows above. The rows keep one item per category per point, so a cheap item
  // is missing from nearly all of its own spots — BakeEzy headlines 0 of its
  // 148. These markers exist only while the item is ticked, carry `item` so the
  // filter in drawMapMarkers governs them, and belong to no layer box at all:
  // ticking an item is the box.
  //
  // Drawn hollow when the spot is shared, solid when it is dedicated, which is
  // the same vocabulary the high-value layer already uses for the same fact.
  {
    const picked = itemFilterSet();
    if (picked.size) {
      const pos = (typeof LT_POS !== 'undefined' && LT_POS) || [];
      const maps = (typeof LT_MAPS !== 'undefined' && LT_MAPS) || [];
      const items = (typeof LT_ITEMS !== 'undefined' && LT_ITEMS) || {};
      const cats = (typeof LT_CATS !== 'undefined' && LT_CATS) || {};
      for (const name of picked) {
        const c = LOOT_CATS[cats[name]];
        const lv = (typeof LOOT_VALUE !== 'undefined' && LOOT_VALUE[name]) || null;
        for (const i of decodePositions(items[name])) {
          const p = pos[i];
          if (!p || maps[p[3]] !== mapName) continue;
          const pool = p[4];
          const lines = [['', pool > 1
            ? `One of ${pool} items that can roll at this spot`
            : 'This item has a chance to spawn here, and nothing else can']];
          if (lv) {
            const fv = (n) => Math.round(n).toLocaleString('en-US');
            lines.push(['Worth', `≈ ${fv(lv[0])} roubles`
              + (lv[0] !== lv[1] ? ` (${fv(lv[1])} per slot)` : '')]);
          }
          if (pool > 1) lines.push(['', 'A shared spot — longer odds than a dedicated one']);
          // A DEDICATED SPOT FILLS IN. `hollow` is chosen from the glyph and every
          // loot-category glyph is already hollow, so the difference has to ride
          // on the class. This is the one thing the data states strongly — that
          // nothing else can roll here — and across 148 pins it is what tells a
          // detour from a lottery ticket.
          add(p[0], p[1], p[2], ['itemSearch'], (c && c.glyph) || 'star',
            ((c && c.cls) || 'mk-hv') + (pool === 1 ? ' mk-only' : ''), name, lines,
            { loose: true, pool, item: name, searchHit: true });
        }
      }
    }
  }

  // CONTAINERS THAT COULD HOLD A TICKED ITEM. Same shape and glyph as the
  // container layer, because that is what they are, plus a class that dims them
  // against the loose spots: a loose marker says this exact place can roll the
  // item, one of these says only that the item is on this container type's list.
  // The card says which of the two it is rather than leaving the pin to imply.
  if (showContainers()) {
    const picked = itemFilterSet();
    for (const name of picked) {
      const cont = (typeof LT_CONT !== 'undefined' && LT_CONT[name]) || null;
      if (!cont) continue;
      for (const [x, y, z, type] of M.co || []) {
        if (!cont.includes(type)) continue;
        const cname = containerTypes()[type];
        const ui = CONTAINER_UI[cname] || [cname, 'crate', 'mk-common'];
        add(x, y, z, ['itemSearch'], ui[1], ui[2] + ' mk-canhold', ui[0], [
          ['', `A ${ui[0].toLowerCase()} — ${escapeHtml(name)} is on its loot table`],
          ['', 'The container is here every raid. Whether it holds this is a roll, '
            + 'and nobody publishes the odds'],
        ], { item: name, container: true, canHold: true });
      }
    }
  }

  // The only layer that is genuinely always there: the container is level
  // geometry, so it is in that spot every raid. Its CONTENTS are still a roll,
  // and the card says so rather than letting "always here" be read as a promise
  // of loot.
  for (const [x, y, z, type] of M.co || []) {
    const name = containerTypes()[type];
    if (!name) continue;
    const ui = CONTAINER_UI[name] || [name, 'crate', 'mk-common'];
    add(x, y, z, [containerLayerId(name)], ui[1], ui[2], ui[0],
      [['', 'The container is here every raid'], ['', 'What is inside it is not']],
      { container: true });
  }
  for (const [x, y, z, pool, keys] of M.mk || []) {
    add(x, y, z, ['markedRooms'], 'marked', 'mk-marked', 'Marked room',
      [['', `${pool} different items can spawn here`]].concat(keys ? [['Keys in the pool', keys]] : []));
  }
  // Hand-marked hazards (dev editor -> storydata.js): a glyph at the centroid,
  // filed under the layer its label implies; the drawn AREA outline is added by
  // drawMap. Guarded: the layer tests eval this block without storydata.js.
  const handHz = typeof STORY_HAZARDS !== 'undefined' ? STORY_HAZARDS : [];
  for (const h of handHz) {
    if (h.map !== mapName || !(h.pts || []).length) continue;
    const cx = h.pts.reduce((a, q) => a + q.x, 0) / h.pts.length;
    const cz = h.pts.reduce((a, q) => a + q.z, 0) / h.pts.length;
    const sniper = h.layer === 'hazardSniper';
    add(cx, 0, cz, [h.layer], sniper ? 'sniper' : 'mine', sniper ? 'mk-sniper' : 'mk-mine',
      h.label, [['', 'Marked by hand — not in the API data']],
      { floor: typeof h.floor === 'number' ? h.floor : -1 });
  }
  // Hand-placed interactables (dev editor -> storydata.js): the API misses
  // some levers/buttons, so the owner marks them; they share the switch layer.
  const handSw = typeof HAND_INTERACTABLES !== 'undefined' ? HAND_INTERACTABLES : [];
  for (const h of handSw) {
    if (h.map !== mapName || !(h.pts || []).length) continue;
    const cx = h.pts.reduce((a, q) => a + q.x, 0) / h.pts.length;
    const cz = h.pts.reduce((a, q) => a + q.z, 0) / h.pts.length;
    add(cx, 0, cz, ['switchAll'], 'lever', 'mk-switch',
      h.label || 'Interactable', [['', 'Marked by hand — not in the API data']],
      { floor: typeof h.floor === 'number' ? h.floor : -1 });
  }
  // Hand-placed BattlePass documents (dev editor -> bpdocs.js). The ONLY
  // positions these will ever have — no source publishes them — so the pin
  // carries the wiki's description of the spot it was placed for.
  // Posters (posters.js, baked from the JSON API — the marker bake still runs
  // on the dead GraphQL path and has none of these). Every one is a shared
  // pool, so the line says so rather than promising a poster.
  const posters = (typeof POSTER_POINTS !== 'undefined' && POSTER_POINTS[mapName]) || [];
  for (const [px, pz] of posters) {
    add(px, 0, pz, ['lootPosters'], 'folder', 'mk-poster', 'Posters',
      [['', 'A shared loot spot that can give a poster among many other items']]);
  }
  for (const p of bpPins(mapName)) {
    add(p.x, 0, p.z, ['bp:' + p.type], bpGlyph(p.name), bpCls(p.name), p.name,
      [['', 'Placed by hand — no source publishes positions for these']],
      { floor: typeof p.floor === 'number' ? p.floor : -1 });
  }
  return out;
}

// Per-layer totals for the panel labels, counted for the whole map rather than
// the current floor so a number never changes under the user when they switch tabs.
function mapLayerCounts() {
  const n = {};
  for (const m of mapView.markers || []) for (const id of m.layers) n[id] = (n[id] || 0) + 1;
  return n;
}

// A group's total is the number of MARKERS it would show, which is not the sum of
// its rows: a shared extract is filed under both PMC and Scav, so summing the two
// rows claims 29 on Customs where only 27 glyphs ever appear.
// How many landmark names the current floor would draw — the count beside the
// location-names toggle.
function labelCount() {
  const md = MAP_DATA[mapView.name];
  if (!md) return 0;
  return (md.labels || []).filter((l) => labelOnFloor(md, l)).length;
}

function mapGroupCount(grp) {
  const rows = groupRows(grp);
  // A group whose rows count something other than markers (BP documents count
  // described spots) has to total the rows instead, or its header reads "–"
  // over a body full of numbers.
  if (rows.length && rows.every((r) => r.count)) {
    return rows.reduce((a, r) => a + r.count(), 0);
  }
  const ids = new Set(rows.map((r) => r.id));
  let n = 0;
  for (const m of mapView.markers || []) if (m.layers.some((id) => ids.has(id))) n++;
  return n;
}

// Glyph geometry, drawn in a box centred on the origin and sized in screen
// pixels by the caller's scale(k). Shared by the map and the panel swatches so
// the legend can never show a different shape from the map.
// Glyphs are authored in a ~13 px box and then scaled up here, so the shapes and
// the CSS stroke widths stay in one readable unit while the drawn size can be
// tuned in one place.
const GLYPH_SCALE = 1.55;

const MARKER_GLYPHS = {
  // map features
  exit: 'M0 -7.5 L6.5 0 L3 0 L3 7 L-3 7 L-3 0 L-6.5 0 Z',
  // transit: a solid right-pointing arrow — one subpath, so the winding rule
  // that once hollowed the grenade cannot bite here
  arrow: 'M-7 -2.6 L1.2 -2.6 L1.2 -6.5 L7.5 0 L1.2 6.5 L1.2 2.6 L-7 2.6 Z',
  mine: 'M0 -5.2 L4.8 3.2 L-4.8 3.2 Z',
  // a lever: base plate, angled stick, round knob — open strokes, so HOLLOW
  lever: 'M-6 6 L6 6 M-1 6 L3.6 -3.4 M3.6 -3.4 A2.1 2.1 0 1 1 3.61 -3.41',
  sniper: 'M0 -6.5 L0 6.5 M-6.5 0 L6.5 0 M0 -3.6 A3.6 3.6 0 1 1 0 3.6 A3.6 3.6 0 1 1 0 -3.6',
  key: 'M0 -6.2 A3 3 0 1 1 0 -0.2 A3 3 0 1 1 0 -6.2 M-1.4 -0.6 L-1.4 6.4 L1.4 6.4 L1.4 -0.6 M1.4 3 L3.4 3',
  marked: 'M-6.5 -6.5 L6.5 -6.5 L6.5 6.5 L-6.5 6.5 Z M-6.5 -2 L-6.5 -6.5 L-2 -6.5 M2 6.5 L6.5 6.5 L6.5 2',
  text: 'M-6 -3.6 L6 -3.6 M-6 0 L3 0 M-6 3.6 L4.6 3.6',

  // one shape per loot type, so a marker is recognisable without the panel
  gem: 'M0 -6.4 L6.4 0 L0 6.4 L-6.4 0 Z',
  // high value: a solid five-point star — nothing else on the map is one. All
  // one subpath, so the winding rule that hollowed the grenade cannot bite.
  star: 'M0 -7.2 L1.76 -2.43 L6.85 -2.22 L2.85 0.93 L4.23 5.83 L0 3 L-4.23 5.83 L-2.85 0.93 L-6.85 -2.22 L-1.76 -2.43 Z',
  // the same star, drawn as an outline: a high-value item that is one of dozens
  // in a shared pool. Same shape and same gold, so it reads as the same KIND of
  // thing; unfilled, so a solid star still means the concentrated spot.
  starOpen: 'M0 -7.2 L1.76 -2.43 L6.85 -2.22 L2.85 0.93 L4.23 5.83 L0 3 L-4.23 5.83 L-2.85 0.93 L-6.85 -2.22 L-1.76 -2.43 Z',
  cross: 'M-2.3 -6.4 L2.3 -6.4 L2.3 -2.3 L6.4 -2.3 L6.4 2.3 L2.3 2.3 L2.3 6.4 L-2.3 6.4 L-2.3 2.3 L-6.4 2.3 L-6.4 -2.3 L-2.3 -2.3 Z',

  // pins down two sides only, not all four: with pins all round it read as a
  // cog at map size, which is the technical-supply-crate glyph
  chip: 'M-4.2 -5 L4.2 -5 L4.2 5 L-4.2 5 Z M-6.9 -2.6 L-4.2 -2.6 M-6.9 0 L-4.2 0 M-6.9 2.6 L-4.2 2.6 M6.9 -2.6 L4.2 -2.6 M6.9 0 L4.2 0 M6.9 2.6 L4.2 2.6',
  folder: 'M-6.4 -4.4 L-1 -4.4 L0.4 -2.6 L6.4 -2.6 L6.4 4.8 L-6.4 4.8 Z',
  // hex nut — hardware, and crisp at any size where a spanner is a smudge
  nut: 'M0 -6.8 L5.9 -3.4 L5.9 3.4 L0 6.8 L-5.9 3.4 L-5.9 -3.4 Z M0 -3 A3 3 0 1 1 -0.01 -3',
  // a plain barrel with two bands: a stim, not a syringe
  stim: 'M-2.1 -6.6 L2.1 -6.6 L2.1 6.6 L-2.1 6.6 Z M-2.1 -3 L2.1 -3 M-2.1 2.6 L2.1 2.6',
  card: 'M-6.4 -4.2 L6.4 -4.2 L6.4 4.2 L-6.4 4.2 Z M-6.4 -1.4 L6.4 -1.4 M-4 1.4 L-0.6 1.4',
  fuelCan: 'M-4.6 -4 L3 -4 L3 5.4 L-4.6 5.4 Z M3 -1.6 L5.6 -1.6 L5.6 5.4 L3 5.4 M-2.6 -4 L-2.6 -6 L1 -6 L1 -4',

  // containers
  crate: 'M-6 -4.5 L6 -4.5 L6 4.5 L-6 4.5 Z M-6 0 L6 0',
  // one cartridge, three cartridges, a grenade — unmistakable even tiny
  pistol: 'M-7 -4.2 L5.8 -4.2 L5.8 -0.6 L-7 -0.6 Z M-6.4 -0.6 L-2.2 -0.6 L-3.6 6.8 L-7 6.8 Z',
  rounds: 'M-4.4 -6.6 L-3.2 -4.2 L-3.2 6.4 L-5.6 6.4 L-5.6 -4.2 Z M0 -6.6 L1.2 -4.2 L1.2 6.4 L-1.2 6.4 L-1.2 -4.2 Z M4.4 -6.6 L5.6 -4.2 L5.6 6.4 L3.2 6.4 L3.2 -4.2 Z',
  // both arcs sweep the same way (1 1). With opposite sweeps the winding
  // cancels and the body fills as a ring, which is exactly what it did.
  grenade: 'M-4.9 1.7 A4.9 4.9 0 1 1 4.9 1.7 A4.9 4.9 0 1 1 -4.9 1.7 Z M-2.1 -6.2 L2.1 -6.2 L2.1 -2.6 L-2.1 -2.6 Z M2.1 -6 L5.6 -6 L5.6 -4.5 L3.5 -4.5 L3.5 -1.4 L2.1 -1.4 Z',
  // cog for technical supplies — "machinery", where a wrench read as a blob
  gear: 'M0 -7 L0 -4.6 M4.95 -4.95 L3.25 -3.25 M7 0 L4.6 0 M4.95 4.95 L3.25 3.25 M0 7 L0 4.6 M-4.95 4.95 L-3.25 3.25 M-7 0 L-4.6 0 M-4.95 -4.95 L-3.25 -3.25 M0 -4.6 A4.6 4.6 0 1 1 -0.01 -4.6 M0 -1.9 A1.9 1.9 0 1 1 -0.01 -1.9',
  toolbox: 'M-6 -2.5 L6 -2.5 L6 5 L-6 5 Z M-2.6 -2.5 L-2.6 -5.6 L2.6 -5.6 L2.6 -2.5',
  // knife and fork — the one food symbol nobody has to decode
  cutlery: 'M-4.8 -6.8 L-4.8 -2.6 M-3.4 -6.8 L-3.4 -2.6 M-2 -6.8 L-2 -2.6 M-5.4 -2.6 L-1.4 -2.6 M-3.4 -2.6 L-3.4 6.8 M2.2 -6.8 L4.8 -4.6 L4.8 -0.6 L2.2 -0.2 M3.5 -0.2 L3.5 6.8',
  rouble: 'M-2.4 6 L-2.4 -5.6 L1.6 -5.6 A3 3 0 1 1 1.6 0.4 L-4.6 0.4 M-4.6 3 L1.4 3',
  pcblock: 'M-4.6 -6 L4.6 -6 L4.6 6 L-4.6 6 Z M-2.2 -3.6 L2.2 -3.6 M-2.2 -1.2 L2.2 -1.2',
  drawers: 'M-6 -5 L6 -5 L6 5 L-6 5 Z M-6 0 L6 0 M-1.6 -2.6 L1.6 -2.6 M-1.6 2.4 L1.6 2.4',
  safe: 'M-6 -6 L6 -6 L6 6 L-6 6 Z M0 -2.5 A2.5 2.5 0 1 1 0 2.5 A2.5 2.5 0 1 1 0 -2.5',
  bag: 'M-6.6 -1.4 L6.6 -1.4 L6.6 4.6 L-6.6 4.6 Z M-2.8 -1.4 A2.8 2.8 0 0 1 2.8 -1.4 M-3.6 -1.4 L-3.6 4.6 M3.6 -1.4 L3.6 4.6',
  shirt: 'M-2.5 -5.8 L-6 -3.6 L-4.6 -0.6 L-3.2 -1.5 L-3.2 6.2 L3.2 6.2 L3.2 -1.5 L4.6 -0.6 L6 -3.6 L2.5 -5.8 A2.5 2.5 0 0 1 -2.5 -5.8 Z',
  cache: 'M0 6.4 L-4.6 -0.8 A4.6 4.6 0 1 1 4.6 -0.8 Z',
  body: 'M0 -5.4 A5.4 5.4 0 1 0 0 5.4 A5.4 5.4 0 1 0 0 -5.4 M-3 -3 L3 3 M3 -3 L-3 3',
};
// Which glyphs are outlines rather than solids. Kept here, not in CSS, because
// the panel swatches build the same markup and must agree.
// Which glyphs are drawn as outlines (fill: none) rather than solids. A shape
// built from open strokes MUST be listed here or it fills into a blob.
const HOLLOW = new Set([
  'sniper', 'marked', 'text', 'lever', 'starOpen',
  'stim', 'chip', 'card', 'fuelCan', 'nut', 'gear', 'cutlery',
  'crate', 'toolbox', 'pcblock', 'drawers', 'safe', 'shirt', 'bag', 'cache', 'body', 'rouble',
]);

// ---------- BattlePass document glyphs ----------
// One icon per document type. Every other glyph on the map is a single shape in
// a single category colour; these are RICH glyphs — an object rather than a path
// string — because a document type is told apart by its COLOURS, not its outline:
// eight portrait documents differing only in silhouette would be eight identical
// smudges at map size.
//
// Shape: { d, detail: [{ d, fill, stroke, w }] }. `d` is the silhouette and is
// the only part the halo and the CSS class paint, so selection and the off-floor
// fade keep working exactly as they do for a plain glyph. Interior marks carry
// inline colours because they are sampled from the item's own artwork rather
// than drawn from the app's palette — see the hex values below, every one of
// which was measured off the wiki render, not guessed.
//
// They deliberately share ONE silhouette. These are all the same kind of thing
// and read as a family; the colour is what says which one.
const BP_DOC = 'M-4.6 -6.2 L4.6 -6.2 L4.6 6.2 L-4.6 6.2 Z';

const BP_DOC_GLYPHS = {
  // A dark case holding blueprints: the case is the OUTLINE (measured #242424 to
  // #303030 across the render), the blueprint sheet inside is the fill, and the
  // white lines are the drawing on it.
  bpBlueprints: {
    d: BP_DOC,
    detail: [{
      d: 'M-3.2 -4.2 L1.4 -4.2 M-3.2 -1.8 L3.0 -1.8 M-1.0 -5.2 L-1.0 3.0'
        + ' M0.4 0.8 L3.2 0.8 M-3.2 3.0 L0.6 3.0 M1.8 3.0 L3.2 3.0 M-3.2 -5.2 L-2.0 -5.2',
      stroke: '#dfe8f2', w: 0.62,
    }],
  },
  // Two-tone folder: the steel blue band and the set-square triangle are the two
  // shapes that carry the real document, on white.
  bpFinancial: {
    d: BP_DOC,
    detail: [
      { d: 'M-4.6 -6.2 L-1.4 -6.2 L-1.4 1.0 L-4.6 1.0 Z', fill: '#5f8398' },
      { d: 'M-1.4 1.0 L-4.6 1.0 L-4.6 3.4 L-2.6 3.4 Z', fill: '#5f8398' },
      { d: 'M0.4 1.4 L4.0 1.4 L4.0 5.0 Z', stroke: '#5f8398', w: 0.75 },
      { d: 'M-0.2 -4.6 L3.4 -4.6 M-0.2 -3.0 L2.6 -3.0', stroke: '#93aab7', w: 0.5 },
    ],
  },
  // White throughout, with the brain CT scan the real item carries in its top
  // left corner and text-like ruling everywhere else.
  bpMedical: {
    d: BP_DOC,
    detail: [
      { d: 'M-3.8 -5.2 L-0.6 -5.2 L-0.6 -2.0 L-3.8 -2.0 Z', fill: '#1c1f22' },
      { d: 'M-2.2 -4.6 A1.05 1.3 0 1 1 -2.21 -4.6 Z', fill: '#9aa3a6' },
      {
        d: 'M0.4 -4.8 L3.8 -4.8 M0.4 -3.5 L3.2 -3.5 M0.4 -2.2 L3.8 -2.2'
          + ' M-3.8 -0.4 L3.8 -0.4 M-3.8 1.2 L2.4 1.2 M-3.8 2.8 L3.8 2.8 M-3.8 4.4 L1.2 4.4',
        stroke: '#8d9598', w: 0.5,
      },
    ],
  },
  // The folder's own diamond lattice, drawn as crossing diagonals. Each segment
  // is cut to the silhouette by construction — there is no clip path in the
  // marker layer and adding one for a texture would not be worth it.
  bpPmc: {
    d: BP_DOC,
    detail: [{
      d: 'M-4.6 -4.6 L4.6 4.6 M-4.6 -0.6 L2.2 6.2 M-2.2 -6.2 L4.6 0.6'
        + ' M-4.6 3.4 L-1.8 6.2 M1.8 -6.2 L4.6 -3.4'
        + ' M-4.6 4.6 L4.6 -4.6 M-2.2 6.2 L4.6 -0.6 M-4.6 0.6 L2.2 -6.2'
        + ' M1.8 6.2 L4.6 3.4 M-4.6 -3.4 L-1.8 -6.2',
      stroke: '#6f6f69', w: 0.45,
    }],
  },
  // Rolled canary paper with its tube beside it. The tube is part of the
  // silhouette too, so the halo goes round both and it reads as one object.
  bpProject: {
    d: 'M-5.0 -6.2 L1.2 -6.2 L1.2 6.2 L-5.0 6.2 Z M2.4 -6.2 L4.9 -6.2 L4.9 6.2 L2.4 6.2 Z',
    body: 'M-5.0 -6.2 L1.2 -6.2 L1.2 6.2 L-5.0 6.2 Z',
    detail: [
      { d: 'M2.4 -6.2 L4.9 -6.2 L4.9 6.2 L2.4 6.2 Z', fill: '#545454', stroke: '#3a3a3a', w: 0.5 },
      { d: 'M2.4 -4.0 L4.9 -4.0', stroke: '#767676', w: 0.5 },
      { d: 'M-3.6 -3.6 L-0.2 -3.6 M-3.6 -1.6 L-0.6 -1.6 M-3.6 0.4 L-0.2 0.4', stroke: '#b9ae78', w: 0.5 },
    ],
  },
  // The folder's triangle tessellation, thinned to what survives at map size.
  bpTechnical: {
    d: BP_DOC,
    detail: [{
      d: 'M-4.0 -5.4 L-1.4 -5.4 L-2.7 -2.9 Z M-0.6 -2.9 L2.0 -2.9 L0.7 -5.4 Z'
        + ' M2.6 -5.4 L4.2 -5.4 L4.2 -2.9 Z M-4.0 -1.9 L-1.8 -1.9 L-4.0 0.6 Z'
        + ' M-1.0 0.6 L1.6 0.6 L0.3 -1.9 Z M2.4 -1.9 L4.2 -1.9 L3.3 0.6 Z'
        + ' M-4.0 1.6 L-1.6 1.6 L-2.8 4.1 Z M-0.6 4.1 L1.8 4.1 L0.6 1.6 Z'
        + ' M2.6 1.6 L4.2 1.6 L4.2 4.1 Z',
      // lighter than the folder really is: at 22px the true near-black-on-black
      // tessellation vanished and the icon read as a plain grey box
      fill: '#63636b',
    }],
  },
  // Pale cyan sheet with the TerraGroup Labs mark — a quartered diamond, lower
  // half solid — on the left, where the real document carries it.
  bpTest: {
    d: BP_DOC,
    detail: [
      { d: 'M-2.4 0.4 L-0.3 2.5 L-2.4 4.6 L-4.5 2.5 Z', fill: '#3f8fd0' },
      { d: 'M-2.4 -1.7 L-0.3 0.4 L-2.4 2.5 L-4.5 0.4 Z', stroke: '#3f8fd0', w: 0.6 },
      { d: 'M-2.4 -1.7 L-2.4 2.5 M-4.5 0.4 L-0.3 0.4', stroke: '#3f8fd0', w: 0.55 },
      { d: 'M0.8 -4.6 L4.0 -4.6 M0.8 -3.0 L3.2 -3.0 M-4.0 -4.6 L-0.8 -4.6', stroke: '#6f9fb5', w: 0.5 },
    ],
  },
  // Midnight blue, black edge. No interior mark by request — the colour is the
  // whole icon, and it is the darkest of the eight so it never doubles for one.
  bpUser: { d: BP_DOC, detail: [] },
};
// ---------- BattlePass document glyphs end ----------
// The dev map editor slices everything between these two landmarks and evaluates
// it, so it draws placed document pins with these exact shapes instead of its own
// copy. Keep the block self-contained — nothing above this line may reference
// anything the editor does not also have. test_mapeditor.js holds the two to the
// same set of types.
Object.assign(MARKER_GLYPHS, BP_DOC_GLYPHS);


// Every glyph is drawn twice: a dark, wide, unpainted-fill "halo" underneath and
// the real thing on top. Without it an outline glyph has no dark edge at all —
// only solids got one from `.mk`'s stroke — and pale artwork swallows them.
// The outer shape of a glyph, rich or plain — what the halo strokes.
const glyphPath = (glyph) => {
  const g = MARKER_GLYPHS[glyph];
  return (g && typeof g === 'object') ? g.d : g;
};

// The inside of a rich glyph: the body first, UNPAINTED so it inherits fill and
// stroke from the .mk-* class on the element above it (which is what keeps the
// selection ring and the off-floor fade working), then the interior marks with
// their own inline colours.
function richBody(g) {
  let s = `<path d="${g.body || g.d}"/>`;
  for (const p of g.detail || []) {
    const st = `fill:${p.fill || 'none'};stroke:${p.stroke || 'none'};stroke-width:${p.w || 0.5}`;
    s += `<path d="${p.d}" style="${st}"/>`;
  }
  return s;
}

function glyphMarkup(glyph, cls, extra, light) {
  const g = MARKER_GLYPHS[glyph];
  const d = glyphPath(glyph);
  const halo = `<path class="mk halo${light ? ' light' : ''}" d="${d}"/>`;
  if (g && typeof g === 'object') {
    return halo + `<g class="mk ${cls}${extra || ''}">${richBody(g)}</g>`;
  }
  const hollow = HOLLOW.has(glyph) ? ' hollow' : '';
  return halo + `<path class="mk ${cls}${hollow}${extra || ''}" d="${d}"/>`;
}

function markerSvg(glyph, cls, px, dark) {
  return `<svg class="ml-swatch" viewBox="-9 -9 18 18" width="${px}" height="${px}">`
    + glyphMarkup(glyph, cls, '', !dark) + '</svg>';
}

// The part of the current view a detail card may occupy. The layer panel floats
// over the map's top-right corner and is opaque, so clamping a card to the SVG
// alone lets it slide underneath — the card flips sides only when it would leave
// the MAP, and the panel is well inside that. Reserve the panel's whole column
// rather than just the rows it covers: cards pick x before y, so a height-aware
// bound would have to be solved, and the strip is only ~218 px.
function cardArea(md) {
  const vb = currentView(md);
  const panel = $('mapLayers');
  const svg = $('mapRot').querySelector('svg');
  if (!panel || panel.hidden || !svg) return vb;
  const pr = panel.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  if (!sr.width || !pr.width) return vb;
  const panelLeft = vb.x + ((pr.left - sr.left) / sr.width) * vb.w;
  const right = Math.min(vb.x + vb.w, panelLeft - (6 / sr.width) * vb.w);
  // never squeeze the card area to nothing on a very narrow window
  return { x: vb.x, y: vb.y, w: Math.max(vb.w * 0.3, right - vb.x), h: vb.h };
}

// Where a marker actually draws. A few real features sit just past the edge of
// the drawn artwork — Customs' "Railroad Passage (Flare)" is 3.4% below it — and
// the SVG viewport would clip them away entirely. Nudge those onto the border
// rather than losing them; build_mapmarkers.js has already thrown out anything
// far enough out to belong to a different map.
function markerPoint(md, m, k) {
  const box = fullView(md);
  const i = 9 * k * GLYPH_SCALE;      // half a glyph, so a clamped one sits fully on the map
  const p = mapPoint(md, m.x, m.z);
  return {
    x: clamp(p.x, box.x + i, box.x + box.w - i),
    y: clamp(p.y, box.y + i, box.y + box.h - i),
  };
}

// Thin out markers that would land on top of each other. The grid cell is in
// SCREEN pixels (hence the k), so zooming in progressively reveals the rest:
// Lighthouse's 344 mines read as a traced border when zoomed out and as
// individual points when you go looking at one.
function decimateMarkers(list, md, gapPx, k) {
  const cell = gapPx * k;
  if (!(cell > 0)) return list;
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const p = mapPoint(md, m.x, m.z);
    const key = Math.round(p.x / cell) + ',' + Math.round(p.y / cell);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function drawMapMarkers(md, svg, k) {
  const ns = 'http://www.w3.org/2000/svg';
  // With items ticked, THEY govern every marker that names an item — the loot
  // and key layer boxes stop applying to those, which is what "show me where
  // this spawns" has to mean. Everything else (extracts, hazards, containers,
  // marked rooms) keeps its box, because that is the context you read the
  // answer against rather than part of the answer.
  const picked = itemFilterSet();
  // With items ticked: a marker NAMING an item shows if that item was asked for,
  // any other loot marker is paused, and everything else keeps its box. The
  // middle clause is the one worth spelling out — the loose-loot rows carry no
  // name now, so without it the layer they came from quietly kept drawing
  // underneath the answer while the panel claimed it was paused.
  const shownWith = (m) => {
    if (!picked.size) return m.layers.some(layerOn);
    if (m.item) return picked.has(m.item);
    if (m.loose) return false;
    return m.layers.some(layerOn);
  };
  const all = (mapView.markers || [])
    .filter((m) => (m.anyFloor || m.floor === mapView.floor) && shownWith(m));
  if (!all.length) { mapView.selectedMarker = null; return; }

  // AN ITEM YOU ASKED FOR IS NEVER THINNED. Decimation stops six thousand
  // markers turning the map into a smear, and none of that applies to a set the
  // player named: the count on the chip and the pins on the map have to be the
  // same number, or the feature is lying in the one place it cannot afford to.
  // The bound is small — a median of 4 markers per item per map, 284 at the
  // very worst (Lighthouse Moonshine), against the ~975 Customs draws with
  // every loot box ticked.
  // Containers ARE thinned: there can be four hundred of them for one item and
  // they are the weaker claim, so the map staying readable matters more than
  // every last jacket. The loose spots are still exempt.
  const asked = picked.size ? all.filter((m) => m.item && picked.has(m.item) && !m.canHold) : [];
  // EVERYTHING ELSE, defined as the complement of `asked` rather than by its own
  // rule. Two independent predicates left a gap the moment a third kind of
  // marker appeared: the container hits were excluded from asked on purpose and
  // matched pool's exclusion by accident, so nothing drew them.
  const exempt = new Set(asked);
  const pool = exempt.size ? all.filter((m) => !exempt.has(m)) : all;
  // Mines are the dense case and the least individually interesting, so they
  // thin harder than everything else.
  const dense = pool.filter((m) => m.glyph === 'mine');
  const rest = pool.filter((m) => m.glyph !== 'mine');
  const shown = asked.concat(decimateMarkers(dense, md, 9, k), decimateMarkers(rest, md, 13, k));
  // Never thin away the marker whose card is open: zooming out would leave the
  // card gone but the selection still set, so the next click on it would read as
  // a second click and do nothing.
  const sel = mapView.selectedMarker;
  if (sel && all.includes(sel) && !shown.includes(sel)) shown.push(sel);

  // Build the whole group as one string and parse it once — hundreds of
  // createElementNS calls per zoom frame is the one thing that would make this
  // feel slow. DOMParser, not innerHTML: an SVG fragment set through the HTML
  // parser lands in the wrong namespace and renders as nothing.
  let s = '<defs>';
  for (const [name, g] of Object.entries(MARKER_GLYPHS)) {
    // Two defs per glyph. The halo only ever wants the outer shape: pointing it
    // at a rich glyph's group would redraw that glyph's own colours underneath
    // itself instead of a dark edge. For a plain glyph both are the same path.
    s += `<path id="mkhalo-${name}" d="${glyphPath(name)}"/>`;
    s += (g && typeof g === 'object')
      ? `<g id="mkdef-${name}">${richBody(g)}</g>`
      : `<path id="mkdef-${name}" d="${g}"/>`;
  }
  s += '</defs>';
  // A selected extract that needs a switch draws a dashed line to it, so "needs
  // a switch thrown first" stops being a riddle. Drawn FIRST, so every glyph
  // sits on top of it, and clamped like the markers are.
  const selEx = mapView.selectedMarker;
  if (selEx && selEx.switchPts) {
    const a = markerPoint(md, selEx, k);
    for (const q of selEx.switchPts) {
      const b = markerPoint(md, { x: q.x, z: q.z }, k);
      s += `<line class="mk-swlink" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`
        + ` stroke-width="${2 * k}" stroke-dasharray="${7 * k} ${5 * k}"/>`;
    }
  }
  const gs = k * GLYPH_SCALE;
  shown.forEach((m, i) => {
    const p = markerPoint(md, m, k);
    const hollow = HOLLOW.has(m.glyph) ? ' hollow' : '';
    const hit = m.lines ? '' : ' noclick';
    const sel = mapView.selectedMarker === m ? ' sel' : '';
    // Loose loot gets a pale halo, everything static a dark one — that alone tells
    // "an item might be lying here" apart from "there is a container here".
    const halo = m.loose ? 'mk halo light' : 'mk halo';
    // An extract belonging to another floor stays visible but steps back.
    const off = (m.anyFloor && m.floor !== mapView.floor) ? ' offfloor' : '';
    // Unlike .qpin-dot, the glyph lives inside scale(k), so its own coordinates
    // ARE screen pixels and the size/stroke can stay in CSS — see style.css.
    // Drawn twice: dark halo underneath, then the glyph. The halo is what makes
    // an outline glyph readable over pale artwork, and it takes no clicks.
    const t = `transform="translate(${p.x} ${p.y}) scale(${gs})"`;
    s += `<use href="#mkhalo-${m.glyph}" class="${halo}${off}" ${t}/>`
      + `<use href="#mkdef-${m.glyph}" class="mk ${m.cls}${hollow}${hit}${sel}${off}" ${t} data-mk="${i}"/>`;
    // Extracts carry their name above the icon at all times — which one it is
    // matters more than that one exists. Escaped because these strings come
    // from the API, and drawn with a stroke behind the fill so they read over
    // any artwork. Never clickable: the icon under it must stay hittable.
    if (m.label) {
      s += `<text class="mk-name" x="${p.x}" y="${p.y - 11 * k}"`
        + ` style="font-size:${10.5 * k}px;stroke-width:${2.8 * k}px">${escapeHtml(m.label)}</text>`;
    }
  });

  const doc = new DOMParser().parseFromString(`<svg xmlns="${ns}">${s}</svg>`, 'image/svg+xml');
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'mkpins');
  for (const child of Array.from(doc.documentElement.childNodes)) g.appendChild(document.importNode(child, true));

  // One delegated listener rather than one per marker.
  g.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-mk]');
    if (!el) return;
    e.stopPropagation();
    const m = shown[Number(el.dataset.mk)];
    if (!m || !m.lines) return;
    mapView.selectedMarker = (mapView.selectedMarker === m) ? null : m;
    mapView.selected = null;             // only one card open at a time
    drawMap();
  });
  // No mousedown handler on purpose: markers have no right-click action, so a
  // right-drag starting on one should pan the map like anywhere else. (Quest pins
  // do swallow it, because right-click ticks their objective off.)

  svg.appendChild(g);
  // Its layer was switched off, or its floor left the screen — drop the
  // selection so no card is drawn for something that is no longer shown.
  if (mapView.selectedMarker && !shown.includes(mapView.selectedMarker)) {
    mapView.selectedMarker = null;
  }
  // The card itself is NOT drawn here. #mkpins sits under #qpins on purpose, so
  // a card drawn into it would have quest pins painted across its text. drawMap()
  // renders it into the pin group instead, once that group is in the document.
}

// The detail card for a selected marker. Same geometry as pinCard — see the
// comment there about measuring rather than predicting the height.
function markerCard(md, m, parent, k) {
  const ns = 'http://www.w3.org/2000/svg';
  const vb = cardArea(md);                // keeps the card out from under the panel
  const pin = markerPoint(md, m, k);      // same clamped spot the glyph drew at
  const cardW = 240;
  const gap = 14 * k, pad = 4 * k;
  const wUnits = cardW * k;

  let x = pin.x + gap;
  if (x + wUnits > vb.x + vb.w - pad) x = pin.x - gap - wUnits;
  x = Math.max(vb.x + pad, Math.min(x, vb.x + vb.w - wUnits - pad));

  const ln = document.createElementNS(ns, 'line');
  ln.setAttribute('x1', pin.x); ln.setAttribute('y1', pin.y);
  ln.setAttribute('x2', x > pin.x ? x : x + wUnits);
  ln.setAttribute('class', 'qpin-leader mk-leader');
  ln.setAttribute('stroke-width', 1.5 * k);
  parent.appendChild(ln);

  const box = document.createElementNS(ns, 'g');
  box.setAttribute('pointer-events', 'none');
  const fo = document.createElementNS(ns, 'foreignObject');
  fo.setAttribute('x', 0); fo.setAttribute('y', 0);
  fo.setAttribute('width', cardW);
  fo.setAttribute('height', vb.h / k);
  const div = document.createElement('div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.className = 'qpin-card mk-card';
  div.innerHTML =
    `<div class="qpin-card-quest">${escapeHtml(m.title || '')}</div>` +
    (m.lines || []).map(([label, value]) => (label
      ? `<div class="qpin-card-need"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`
      : `<div class="qpin-card-desc">${escapeHtml(value)}</div>`)).join('');
  fo.appendChild(div);
  box.appendChild(fo);
  box.setAttribute('transform', `translate(${x} ${vb.y}) scale(${k})`);
  parent.appendChild(box);

  const rect = fo.getBoundingClientRect();
  const pxPerUnit = rect.width > 0 ? rect.width / cardW : 1;
  const cardH = Math.min(Math.ceil(div.getBoundingClientRect().height / pxPerUnit) + 1, vb.h / k - 8);
  const hUnits = cardH * k;
  const y = Math.max(vb.y + pad, Math.min(pin.y - hUnits / 2, vb.y + vb.h - hUnits - pad));
  fo.setAttribute('height', cardH);
  box.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  ln.setAttribute('y2', Math.max(y + 8 * k, Math.min(pin.y, y + hUnits - 8 * k)));
}

// Every event the panel sits on top of is one the map stage also listens for.
// Without this, ticking a box clears the selected pin, scrolling over the panel
// zooms the map underneath it, double-clicking a label resets the view and
// right-clicking starts a pan.
// Attaches once per element: renderMapLayers() runs on every map open and only
// replaces the panel's INNER markup, so the panel element itself survives and
// would otherwise collect another five listeners each time.
function stopMapEvents(el) {
  if (el.dataset.guarded) return;
  el.dataset.guarded = '1';
  for (const ev of ['click', 'wheel', 'dblclick', 'mousedown', 'contextmenu']) {
    el.addEventListener(ev, (e) => e.stopPropagation(), ev === 'wheel' ? { passive: true } : false);
  }
}

function renderMapLayers() {
  const host = $('mapLayers');
  if (!host) return;
  // Empty it as well as hiding it: a stale panel left in the DOM still answers
  // querySelectorAll, so the previous map's checkboxes would linger invisibly.
  if (!hasAnyMarkers(mapView.name)) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;

  const counts = mapLayerCounts();
  const open = (state.settings && state.settings.mapLayersOpen) || {};
  const rowHtml = (rows) => rows.map((r) => {
      // `always` rows aren't markers, so they have no marker count and must never
      // be disabled — that is the location-names toggle, which counts labels and
      // is on unless explicitly turned off.
      const n = r.count ? r.count() : (r.always ? labelCount() : (counts[r.id] || 0));
      const on = r.always ? labelsOn() : layerOn(r.id);
      // a row can declare itself live with a zero count — the BP document types
      // whose spots the wiki has not written up yet are still real spawns here
      const dead = r.live ? !r.live() : (!n && !r.always);
      return `<label class="ml-row${dead ? ' off' : ''}">`
        + `<input type="checkbox" data-layer="${r.id}"${on ? ' checked' : ''}${dead ? ' disabled' : ''}>`
        + markerSvg(r.glyph, r.cls, 16, r.container)
        + `<span class="ml-label">${escapeHtml(r.label)}</span>`
        + `<span class="ml-n">${n || '–'}</span></label>`;
  }).join('');

  const groups = MARKER_GROUPS.map((grp) => {
    const total = mapGroupCount(grp);
    // A sub-headed block is hidden entirely when this map has none of its types,
    // rather than showing a heading over nothing.
    const body = rowHtml(grp.rows || [])
      + (grp.subs || []).map((sub) => {
        const n = sub.rows.reduce((a, r) => a + (counts[r.id] || 0), 0);
        return n ? `<div class="ml-sub">${escapeHtml(sub.title)}</div>` + rowHtml(sub.rows) : '';
      }).join('');
    const head = groupRows(grp).some((r) => r.always) ? '' : `<span class="ml-n">${total || '–'}</span>`;
    return `<details class="ml-group"${open[grp.id] ? ' open' : ''} data-group="${grp.id}">`
      + `<summary class="ml-head">${escapeHtml(grp.title)}${head}</summary>`
      + (grp.note ? `<div class="ml-note">${escapeHtml(grp.note)}</div>` : '')
      + body + '</details>';
  }).join('');

  const baked = (typeof MARKER_BAKED_AT !== 'undefined' && MARKER_BAKED_AT)
    ? new Date(MARKER_BAKED_AT).toISOString().slice(0, 10) : '';
  host.innerHTML = '<button class="ml-toggle" type="button">LAYERS</button>'
    + `<div class="ml-body">${itemSearchHtml()}${groups}`
    + `<div class="ml-foot">Tarkov publishes no spawn chances — every loot marker is a place an item <em>can</em> appear, never a promise.`
    + (baked ? `<br>Marker data ${baked} · tarkov.dev` : '') + '</div></div>';

  host.classList.toggle('collapsed', !!(state.settings && state.settings.mapLayersCollapsed));
  host.querySelector('.ml-toggle').addEventListener('click', async () => {
    const now = !host.classList.contains('collapsed');
    host.classList.toggle('collapsed', now);
    state.settings = await backend.saveSettings({ mapLayersCollapsed: now });
  });
  host.querySelectorAll('input[data-layer]').forEach((cb) => {
    cb.addEventListener('change', () => setLayer(cb.dataset.layer, cb.checked));
  });
  host.querySelectorAll('details[data-group]').forEach((d) => {
    d.addEventListener('toggle', () => setGroupOpen(d.dataset.group, d.open));
  });
  wireItemSearch(host);
  stopMapEvents(host);
}
// The search sits ABOVE the loot boxes because it overrides them: with
// something ticked, the loot and key layers stop deciding what is drawn.
// Putting it under them would read as one more filter among equals.
function itemSearchHtml() {
  const picked = itemFilterSet();
  const idx = itemSpawnIndex();
  const here = (n) => (idx.get(n) || { maps: new Map() }).maps.get(mapView.name) || null;
  // How many of them are on the storey you are looking at. Customs shows three
  // of BakeEzy's twelve on the ground floor and the other nine two storeys up,
  // and a chip reading 12 over a map showing 3 is the feature contradicting
  // itself. Computed only for what is pinned, so it costs nothing on a map.
  const onThisFloor = (n) => {
    const md = MAP_DATA[mapView.name];
    const pos = (typeof LT_POS !== 'undefined' && LT_POS) || [];
    const maps = (typeof LT_MAPS !== 'undefined' && LT_MAPS) || [];
    const items = (typeof LT_ITEMS !== 'undefined' && LT_ITEMS) || {};
    if (!md || !items[n]) return null;
    let k = 0;
    for (const i of decodePositions(items[n])) {
      const p = pos[i];
      if (p && maps[p[3]] === mapView.name && floorOf(md, p[0], p[1], p[2]) === mapView.floor) k++;
    }
    return k;
  };

  const chips = pinnedItems().map((n) => {
    const h = here(n);
    const on = picked.has(n);
    // A pinned item that does not spawn on the open map keeps its chip — you
    // pinned it to hunt it, and moving map should not silently drop the list —
    // but it says so rather than showing a count of nothing.
    const floorN = h ? onThisFloor(n) : null;
    // "3/12" rather than "12" when the rest are on other storeys, because the
    // number next to the name has to be the number of pins you can see
    const label = h ? (floorN !== null && floorN !== h.n ? `${floorN}/${h.n}` : `${h.n}`) : '–';
    const cN = containerCountFor(n, mapView.name);
    const title = (h
      ? `${h.n} spot${h.n === 1 ? '' : 's'} on ${mapView.name}`
        + (h.dedicated ? `, ${h.dedicated} of them dedicated` : ', none of them dedicated')
        + (floorN !== null && floorN !== h.n ? ` — ${floorN} on the floor you are looking at` : '')
      : `No loose spots on ${mapView.name}`)
      + (cN ? ` · and ${cN} container${cN === 1 ? '' : 's'} whose loot table it is on` : '');
    return `<span class="mi-chip${on ? ' on' : ''}${h || cN ? '' : ' none'}" title="${escapeHtml(title)}">`
      + `<input type="checkbox" data-item-tick="${escapeHtml(n)}"${on ? ' checked' : ''}${h || cN ? '' : ' disabled'}>`
      + `<span class="mi-name">${escapeHtml(n)}</span><span class="mi-n">${label}</span>`
      + (cN ? `<span class="mi-c" title="containers whose loot table it is on">+${cN}</span>` : '')
      + `<button class="mi-x" type="button" data-item-unpin="${escapeHtml(n)}" title="Unpin">×</button></span>`;
  }).join('');

  return '<div class="ml-items">'
    + '<input class="mi-search" type="search" autocomplete="off" spellcheck="false"'
    + ' placeholder="Find an item or a key…">'
    + '<div class="mi-results" hidden></div>'
    + (chips ? `<div class="mi-chips">${chips}</div>` : '')
    + (picked.size
      ? `<label class="mi-cont"><input type="checkbox" class="mi-cont-box"${showContainers() ? ' checked' : ''}>`
        + `<span>Also show containers that can hold them</span></label>`
        + `<div class="mi-active">Showing only these — the loot and key boxes below are paused. `
        + `<button class="mi-clear" type="button">Clear</button></div>`
      : '')
    + '</div>';
}

// Ranked for the map you are looking at: what is HERE first, dearest first
// inside that, then everything else. With 146 names the list is browsable, and
// that matters — the data carries short forms ("WFilter", "SJ6", "0.2BTC") and
// no full item names at all, so anyone typing "water filter" would find
// nothing. Opening the box on a map and reading down it is the discovery path.
function itemSearchMatches(q) {
  const idx = itemSpawnIndex();
  const needle = String(q || '').trim().toLowerCase();
  const rows = [];
  for (const e of idx.values()) {
    if (needle && !e.name.toLowerCase().includes(needle)) continue;
    const h = e.maps.get(mapView.name) || null;
    rows.push({ name: e.name, value: e.value, here: h ? h.n : 0, dedicated: h ? h.dedicated : 0, maps: e.maps.size });
  }
  rows.sort((a, b) => (b.here > 0) - (a.here > 0) || b.value - a.value || a.name.localeCompare(b.name));
  return rows.slice(0, 12);
}

function renderItemResults(host, q) {
  const box = host.querySelector('.mi-results');
  if (!box) return;
  const pinned = new Set(pinnedItems());
  const rows = itemSearchMatches(q);
  if (!rows.length) {
    box.innerHTML = '<div class="mi-empty">Nothing matches. Only the items the marker data names '
      + 'can be found — 146 of them, and containers name nothing at all.</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = rows.map((r) => `<button class="mi-hit${r.here ? '' : ' elsewhere'}`
    + `${pinned.has(r.name) ? ' pinned' : ''}" type="button" data-item-pin="${escapeHtml(r.name)}">`
    + `<span class="mi-name">${escapeHtml(r.name)}</span>`
    + `<span class="mi-where">${r.here
      ? `${r.here} here${r.dedicated ? ` · ${r.dedicated} dedicated` : ''}`
      : `not on this map · ${r.maps} other${r.maps === 1 ? '' : 's'}`}</span></button>`).join('');
  box.hidden = false;
}

function wireItemSearch(host) {
  const input = host.querySelector('.mi-search');
  if (!input) return;
  const box = host.querySelector('.mi-results');
  input.addEventListener('focus', () => renderItemResults(host, input.value));
  input.addEventListener('input', () => renderItemResults(host, input.value));
  // Escape closes the list without clearing what was typed, so a mis-click does
  // not cost you the search
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box) box.hidden = true; });
  host.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-item-pin]');
    if (pin) { input.value = ''; if (box) box.hidden = true; pinItem(pin.dataset.itemPin, true); return; }
    const un = e.target.closest('[data-item-unpin]');
    if (un) { pinItem(un.dataset.itemUnpin, false); return; }
    const clear = e.target.closest('.mi-clear');
    if (clear) { saveItems({ pinned: pinnedItems(), on: [] }); return; }
    const cont = e.target.closest('.mi-cont-box');
    if (cont) { saveItems({ ...itemsState(), containers: cont.checked }); return; }
    if (box && !e.target.closest('.ml-items')) box.hidden = true;
  });
  host.querySelectorAll('[data-item-tick]').forEach((cb) => {
    cb.addEventListener('change', () => tickItem(cb.dataset.itemTick, cb.checked));
  });
}

// ---------- map layers end ----------

// A map with more storeys than this gets a picker instead of a row of tabs.
// Three tabs are a row you read at a glance; Icebreaker's SIXTEEN decks are
// 2,400 px of buttons in a header that also holds the title, the quest-set
// boxes and the close button. The threshold is deliberately above every other
// map (Streets has the most at six including ground), so nothing that works
// today changes shape.
const FLOOR_TABS_MAX = 8;

function renderFloorTabs() {
  const md = MAP_DATA[mapView.name];
  // ordered bottom-to-top, so ground sits above the basement rather than first
  const tabs = floorOrder(md).map((t) => ({ name: t.name.toUpperCase(), idx: t.idx }));
  const host = $('floorTabs');
  const count = (idx) => mapView.pins.filter((p) => p.floor === idx).length;

  // The dropdown this used to fall back to for Icebreaker's 16 decks is gone:
  // the list lives in the left panel now, where a column of 16 fits and every
  // deck is readable at once. The section collapses if it is in the way.
  const sec = $('mapFloorSec');
  if (sec) sec.classList.toggle('hidden', tabs.length < 2);
  const cnt = $('mapFloorCount');
  if (cnt) cnt.textContent = tabs.length > 1 ? String(tabs.length) : '';

  host.innerHTML = tabs.map((t) => {
    const n = count(t.idx);
    return `<button class="floor-tab${t.idx === mapView.floor ? ' active' : ''}" data-floor="${t.idx}">${escapeHtml(t.name)}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  host.querySelectorAll('.floor-tab').forEach((b) => {
    b.addEventListener('click', () => {
      mapView.floor = Number(b.dataset.floor);
      mapView.selected = null; mapView.selectedMarker = null;
      drawMap();
    });
  });
}

// One screen pixel expressed in this map's SVG units. Pins, labels and cards are
// drawn in SVG units, but viewBoxes differ by more than 10x (Factory is 131 units
// across, Woods 1473) AND each map fits the stage differently — a tall map like
// Lighthouse fits by height. Sizing off the rendered box makes everything the
// same physical size on screen whichever map is open.
function svgUnitsPerPx(svg, md) {
  const vb = currentView(md);          // the zoomed window, not the whole map
  const r = svg.getBoundingClientRect();
  if (r.width > 0) return vb.w / r.width;
  return Math.hypot(md.viewBox.w, md.viewBox.h) / Math.hypot(1062.4827, 535.17401); // not laid out yet
}

// Which landmark names belong on the floor currently selected.
//
// Labels carry only (x, z) — upstream gives them no height and no layer, so they
// cannot go through floorOf(). What the floor data does give is each floor's
// FOOTPRINT, so on an upper storey we show only the names standing inside it:
// once you are looking at the third floor of Dorms, "Old Gas Station" across the
// map is noise. Ground shows everything, because ground is the whole map. A floor
// whose extent has no bounds genuinely covers the map, so it keeps every label.
function labelOnFloor(md, l) {
  // A hand-ADDED label carries the floor it was placed on outright.
  if (typeof l._floor === 'number') return l._floor === mapView.floor;
  // A hand-moved label (l._o = pristine coords, see applyMapFixes) keeps the
  // floor its ORIGINAL position implies — the move corrects where the name
  // sits on the artwork, not which storey it belongs to. Deriving the floor
  // from the corrected spot made moved labels vanish off their floor.
  const lx = l._o ? l._o[0] : l[0], lz = l._o ? l._o[1] : l[1];
  const lb = l[3], lt = l[4];
  // A label with a height band (upstream's bottom/top — The Lab has them on
  // every label) is assigned to a floor EXACTLY like a marker is: floorOf at
  // the band's midpoint. x/z rectangles cannot tell stacked floors apart.
  if (typeof lb === 'number' && typeof lt === 'number') {
    return floorOf(md, lx, (lb + lt) / 2, lz) === mapView.floor;
  }
  if (mapView.floor < 0) return true;
  const f = md.floors[mapView.floor];
  if (!f || !f.extents || !f.extents.length) return true;
  return f.extents.some((ex) => !ex.bounds || ex.bounds.some((r) => inRect(lx, lz, r)));
}

// show the base layer plus the selected floor; draw pins for that floor
function drawMap() {
  const md = MAP_DATA[mapView.name];
  const svg = $('mapRot').querySelector('svg');
  if (!svg) return;

  for (let i = 0; i < md.floors.length; i++) {
    const g = svg.querySelector(`#${CSS.escape(md.floors[i].svgLayer)}`);
    if (g) g.style.display = (i === mapView.floor) ? '' : 'none';
  }

  // An upper floor is drawn ON TOP of the ground plan, and at full strength the
  // two read as one drawing. Dim everything that isn't the selected floor so it
  // stays as context instead of competing with it. Walking the base layer's
  // siblings covers layers the data doesn't list (Customs and Shoreline both
  // carry a First_Floor group nothing references).
  // Clear the previous draw's overlays FIRST. The dim loop below stamps opacity
  // on every id'd sibling of the base layer, and #qpins/#mkpins are id'd
  // siblings — leaving them in place until after the loop means they get dimmed
  // on any map whose base layer sits directly under the <svg>. Harmless only
  // because they are destroyed a moment later; not something to rely on.
  const oldPins = svg.querySelector('#qpins');
  if (oldPins) oldPins.remove();
  const oldMk = svg.querySelector('#mkpins');
  if (oldMk) oldMk.remove();

  const baseEl = svg.querySelector(`#${CSS.escape(md.baseLayer)}`);
  const selLayer = mapView.floor >= 0 && md.floors[mapView.floor] ? md.floors[mapView.floor].svgLayer : null;
  if (baseEl && baseEl.parentNode) {
    for (const el of baseEl.parentNode.children) {
      if (!el.id || el.id === selLayer || el.style.display === 'none') continue;
      el.style.opacity = selLayer ? '.28' : '';
    }
  }
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'qpins');

  // The map's rotation is baked into the SVG at load time (see openQuestMap),
  // so everything below is placed in the coordinates the user actually sees —
  // no per-element counter-rotation, and it works for Factory's 90° too.
  const k = svgUnitsPerPx(svg, md);

  // Landmark names, for the floor you are on, if you want them. They used to be
  // drawn at .45 opacity in a thin outline, which vanished over the pale parts of
  // several maps — now full strength with a proper dark halo behind, the same
  // trick the markers use.
  if (labelsOn()) {
    for (const [lx, lz, text] of (md.labels || []).filter((l) => labelOnFloor(md, l))) {
      const p = clampToMap(md, lx, lz, 8 * k);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', p.x); t.setAttribute('y', p.y);
      t.setAttribute('class', 'map-label');
      t.setAttribute('style', `font-size:${11.5 * k}px;stroke-width:${3.4 * k}px`);
      t.textContent = text;
      g.appendChild(t);
    }
  }

  // Hand-added MAP TEXT. The one thing on this map NOT drawn at a constant
  // screen size: its font-size is in map units, so it scales with the artwork
  // like a number painted on the floor would — legible when you zoom into the
  // dorms, a speck when the whole map is on screen. That is the entire reason
  // it exists separately from a location name, so it must NOT be multiplied by
  // `k`. Independent of the location-names toggle for the same reason: it
  // cannot crowd the view, so it never needs switching off.
  for (const mt of (MAP_FIXES.mapTexts || [])) {
    if (mt.map !== mapView.name || mt.floor !== mapView.floor) continue;
    const p = clampToMap(md, mt.x, mt.z, 0);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', p.x); t.setAttribute('y', p.y);
    t.setAttribute('class', 'map-text');
    t.setAttribute('style', `font-size:${mt.size}px;stroke-width:${mt.size * 0.28}px`);
    t.textContent = mt.text;
    g.appendChild(t);
  }

  // The soft green halo that makes an objective unmistakable among the layer
  // markers. A radial gradient, not a blur filter: filter units are the map's
  // viewBox units, which differ 10x between maps, while a gradient scales with
  // its circle for free. Pulsing is done with opacity alone, which is cheap.
  const defs = document.createElementNS(ns, 'defs');
  for (const [id, inner, outer] of [['qglowGrad', '#7dff96', '#5fe07c'], ['qglowGradStory', '#7dc4ec', '#5aa0c8']]) {
    const grad = document.createElementNS(ns, 'radialGradient');
    grad.setAttribute('id', id);
    for (const [off, col, op] of [['0%', inner, '0.72'], ['45%', outer, '0.42'], ['100%', outer, '0']]) {
      const st = document.createElementNS(ns, 'stop');
      st.setAttribute('offset', off); st.setAttribute('stop-color', col); st.setAttribute('stop-opacity', op);
      grad.appendChild(st);
    }
    defs.appendChild(grad);
  }
  g.appendChild(defs);

  const hlObjs = mapView.highlight ? mapView.highlight.objs : null;
  const shown = mapView.pins.filter((p) => p.floor === mapView.floor);
  // hand-placed story AREAS first, so their outlines sit under every pin
  for (const p of shown) {
    if (!p.story || !p.area) continue;
    // An AREA is the whole answer for some objectives — "search this warehouse"
    // has no single point — so it has to light up with the pins rather than sit
    // there unchanged while everything around it fades.
    const isHl = hlObjs && hlObjs.has(p.objId);
    const faded = hlObjs && !isHl;
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', p.area.map((q) => { const sp = mapPoint(md, q.x, q.z); return sp.x + ',' + sp.y; }).join(' '));
    poly.setAttribute('class', 'story-area' + (isHl ? ' hl' : '') + (faded ? ' off' : ''));
    poly.setAttribute('stroke-width', (isHl ? 3.4 : 2.2) * k);
    poly.setAttribute('stroke-dasharray', `${6 * k} ${5 * k}`);
    g.appendChild(poly);
  }
  // hand-marked hazard AREAS, dashed red like the game draws minefields,
  // showing with the hazard layer their centroid glyph is filed under
  for (const h of (typeof STORY_HAZARDS !== 'undefined' ? STORY_HAZARDS : [])) {
    if (h.map !== mapView.name || h.kind !== 'area' || !layerOn(h.layer)) continue;
    if ((typeof h.floor === 'number' ? h.floor : -1) !== mapView.floor) continue;
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', h.pts.map((q) => { const sp = mapPoint(md, q.x, q.z); return sp.x + ',' + sp.y; }).join(' '));
    poly.setAttribute('class', 'hz-area');
    poly.setAttribute('stroke-width', 2.2 * k);
    poly.setAttribute('stroke-dasharray', `${6 * k} ${5 * k}`);
    g.appendChild(poly);
  }
  shown.forEach((p, i) => {
    const s = clampToMap(md, p.x, p.z, 9 * k);
    const isHl = hlObjs && hlObjs.has(p.objId);
    const faded = hlObjs && !isHl;

    const glow = document.createElementNS(ns, 'circle');
    glow.setAttribute('cx', s.x); glow.setAttribute('cy', s.y);
    glow.setAttribute('r', (isHl ? 23 : 17) * k);
    glow.setAttribute('fill', p.story ? 'url(#qglowGradStory)' : 'url(#qglowGrad)');
    glow.setAttribute('class', 'qpin-glow' + (isHl ? ' hl' : '') + (faded ? ' off' : ''));
    g.appendChild(glow);

    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', 6.5 * k);
    c.setAttribute('class', 'qpin-dot' + (p.story ? ' story' : '') + (mapView.selected === i ? ' sel' : '') + (faded ? ' faded' : ''));
    c.setAttribute('stroke-width', 2 * k);
    if (p.locked) c.setAttribute('opacity', '.5');
    // clicking the selected pin again clears it
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      mapView.selected = (mapView.selected === i) ? null : i;
      mapView.selectedMarker = null;     // only one card open at a time
      drawMap();
    });
    // right-click ticks this one objective off by hand. Panning also uses the
    // right button, so swallow mousedown here or a right-click on a pin would
    // start a drag as well.
    c.addEventListener('mousedown', (e) => { if (e.button === 2) e.stopPropagation(); });
    c.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!p.objId) return;
      mapView.selected = null;
      mapView.selectedMarker = null;
      state.fullProgress = await backend.toggleObjective(p.objId, true, state.gameMode);
      applyMode();
      mapView.pins = collectMapPins(mapView.name);
      renderMapLoadout(mapView.name);
      drawMap();
      renderAll();
      toast(`Objective marked done: ${p.quest}`);
    });
    g.appendChild(c);
  });

  // Layer markers go in first, so quest objectives — the point of the app —
  // always draw on top of them (Lighthouse alone has 344 mine markers).
  drawMapMarkers(md, svg, k);
  svg.appendChild(g);
  // after g is in the document, so the card can measure itself. Whichever card is
  // open goes into the PIN group, the topmost one — only one can be open at a
  // time, and neither should have pins or markers painted over its text.
  const sel = mapView.selected != null ? shown[mapView.selected] : null;
  if (sel) pinCard(md, sel, g, k);
  else if (mapView.selectedMarker) markerCard(md, mapView.selectedMarker, g, k);

  $('mapPinCount').textContent = `${mapView.pins.length} objective${mapView.pins.length === 1 ? '' : 's'} · ${shown.length} on this floor`;
  $('mapHint').innerHTML = (md.approx
    ? '<span class="bad">Pin positions on this map are approximate.</span> '
    : '')
    + 'Click a pin for details, click it again to hide them · scroll to zoom, right-drag to move, double-click to reset';
  renderFloorTabs();
}

// The details card for the selected pin, anchored beside that pin.
// The map itself is displayed rotated 180°, so this layer is counter-rotated
// about the map centre: inside it, coordinates run the way they look on screen,
// which is what makes the edge-clamping below mean what it says.
function pinCard(md, p, parent, k) {
  const ns = 'http://www.w3.org/2000/svg';
  const vb = cardArea(md);                        // what is on screen, minus the layer panel
  const pin = clampToMap(md, p.x, p.z, 9 * k);    // same clamped spot the pin drew at

  const desc = p.desc || '';
  const tags = [
    p.optional ? 'optional' : '',
    p.locked ? 'locked' : '',
    p.objTotal > 1 ? `${p.objDone}/${p.objTotal} objectives done` : '',
    'right-click to tick off',
  ].filter(Boolean).join(' · ');

  // The card is built at its natural size and the whole group is scaled, so the
  // px values in .qpin-card keep meaning the same thing on every map.
  const cardW = 280;
  const gap = 14 * k, pad = 4 * k;
  const wUnits = cardW * k;

  let x = pin.x + gap;
  if (x + wUnits > vb.x + vb.w - pad) x = pin.x - gap - wUnits;   // flip sides near the edge
  x = Math.max(vb.x + pad, Math.min(x, vb.x + vb.w - wUnits - pad));

  const ln = document.createElementNS(ns, 'line');   // leader line back to the pin
  ln.setAttribute('x1', pin.x); ln.setAttribute('y1', pin.y);
  ln.setAttribute('x2', x > pin.x ? x : x + wUnits);
  ln.setAttribute('class', 'qpin-leader');
  ln.setAttribute('stroke-width', 1.5 * k);
  parent.appendChild(ln);

  const box = document.createElementNS(ns, 'g');
  box.setAttribute('pointer-events', 'none');
  const fo = document.createElementNS(ns, 'foreignObject');
  fo.setAttribute('x', 0); fo.setAttribute('y', 0);
  fo.setAttribute('width', cardW);
  fo.setAttribute('height', vb.h / k);    // provisional: nothing can clip while we measure
  const div = document.createElement('div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.className = 'qpin-card';
  div.innerHTML =
    `<div class="qpin-card-quest">${escapeHtml(p.quest)}</div>` +
    (p.trader ? `<div class="qpin-card-trader">${escapeHtml(p.trader)}</div>` : '') +
    (desc ? `<div class="qpin-card-desc">${escapeHtml(desc)}</div>` : '') +
    ((p.needs || []).map(([label, value]) =>
      `<div class="qpin-card-need"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`).join('')) +
    (tags ? `<div class="qpin-card-tags">${escapeHtml(tags)}</div>` : '');
  fo.appendChild(div);
  box.appendChild(fo);
  box.setAttribute('transform', `translate(${x} ${vb.y}) scale(${k})`);
  parent.appendChild(box);

  // foreignObject clips whatever overflows it, so ASK the browser how tall the
  // card came out rather than predicting it from string length — font metrics,
  // where the text wraps, padding, and a quest name long enough to wrap are all
  // things only layout knows.
  const rect = fo.getBoundingClientRect();
  const pxPerUnit = rect.width > 0 ? rect.width / cardW : 1;
  const cardH = Math.min(Math.ceil(div.getBoundingClientRect().height / pxPerUnit) + 1, vb.h / k - 8);
  const hUnits = cardH * k;

  const y = Math.max(vb.y + pad, Math.min(pin.y - hUnits / 2, vb.y + vb.h - hUnits - pad));
  fo.setAttribute('height', cardH);
  box.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  ln.setAttribute('y2', Math.max(y + 8 * k, Math.min(pin.y, y + hUnits - 8 * k)));
}

async function openQuestMap(mapName) {
  if (!hasMapData(mapName)) return;
  applyMapRotation(mapName);   // saved quarter-turns, applied to the pristine entry
  const md = MAP_DATA[mapName];
  mapView.name = mapName;
  // Ground unless the map names a better place to start. Icebreaker's ground IS
  // its Control Room — a 281x134 cupboard on a 4088-tall ship — so opening there
  // shows an almost empty canvas. `defaultFloor` carries the deck upstream marks
  // as its own default view (the Infirmary), and no other map sets it.
  mapView.floor = typeof md.defaultFloor === 'number' ? md.defaultFloor : -1;
  mapView.selected = null;
  mapView.selectedMarker = null;
  mapView.highlight = null;
  mapView.sets = defaultMapSets();   // seeded from the tab, then free to change
  renderMapSets();
  mapView.pins = collectMapPins(mapName);
  mapView.markers = collectMapMarkers(mapName);
  renderMapLoadout(mapName);
  renderMapLayers();
  resetMapView();
  $('mapTitle').textContent = mapName.toUpperCase();
  // per-map artwork credit. The credit string carries its own licence tag —
  // CC BY-NC-SA belongs to Shebuka's SVGs, NOT to The Labyrinth's tarkov.dev
  // tile render, so it must never be appended blindly.
  $('mapCredit').innerHTML = (md.credit || 'Map by Shebuka · tarkov-dev-svg-maps · CC BY-NC-SA 4.0')
    + (hasMapMarkers(mapName) ? ' · markers tarkov.dev' : '');
  $('mapOverlay').classList.remove('hidden');

  const svgText = await backend.getMapSvg(md.svg);
  if (!svgText) {
    $('mapRot').innerHTML = '<div id="mapEmpty">Could not load the map image.</div>';
    return;
  }
  $('mapRot').innerHTML = svgText;
  const svg = $('mapRot').querySelector('svg');
  if (svg) {
    svg.removeAttribute('width'); svg.removeAttribute('height');
    // Bake the map's rotation into the SVG instead of applying it as a CSS
    // transform on the element. A CSS rotate leaves the layout box unrotated,
    // so a 90° map (Factory) would be fitted to the wrong aspect and overflow;
    // rewriting the viewBox makes the browser fit what is actually drawn. It
    // also means pins, labels and cards can be positioned in the coordinates
    // the user sees, with no counter-rotation anywhere.
    const rot = ((md.rotate || 0) % 360 + 360) % 360;
    if (rot) {
      const ns = 'http://www.w3.org/2000/svg';
      const spin = document.createElementNS(ns, 'g');
      spin.setAttribute('transform', `rotate(${rot} ${md.viewBox.w / 2} ${md.viewBox.h / 2})`);
      while (svg.firstChild) spin.appendChild(svg.firstChild);
      svg.appendChild(spin);
    }
    // Now the svg exists and the stage is laid out, so the zoom-1 window can be
    // computed against the real pane size. Doing it before the load would use a
    // guessed aspect and the first wheel event would visibly jump.
    svg.style.transform = '';
    resetMapView();
  }
  drawMap();
  // drawMap writes the footer hint, which rewraps to two lines on some maps and
  // moves the stage's bottom edge — so the view resetMapView just computed was
  // measured against a stage that no longer exists. Settle it here against the
  // final layout rather than leaving the ResizeObserver to correct it a moment
  // later, which showed up as the map twitching on open.
  applyView(false);
}

// the map header's quest-set tickboxes: which sets of tasks pin on this map
function renderMapSets() {
  const s = mapView.sets || defaultMapSets();
  $('mapSets').innerHTML = [
    ['story', 'STORY'], ['side', 'SIDE TASKS'], ['kappa', 'KAPPA'], ['lightkeeper', 'LIGHTKEEPER'],
  ].map(([key, label]) => `
    <label class="map-set${s[key] ? ' on' : ''}" title="${key === 'story'
      ? 'Story objectives have no exact positions — ticking this lists the ones on this map in the side panel'
      : `Show ${label.toLowerCase()} quest pins`}">
      <input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}>${label}
    </label>`).join('');
  for (const box of $('mapSets').querySelectorAll('input[data-set]')) {
    box.addEventListener('change', () => {
      mapView.sets[box.dataset.set] = box.checked;
      mapView.selected = null;
      mapView.highlight = null;
      mapView.pins = collectMapPins(mapView.name);
      renderMapSets();
      renderMapLoadout(mapView.name);
      drawMap();
    });
  }
}

// clicking the map away from a pin also clears the selection (pins stop propagation)
$('mapStage').addEventListener('click', () => {
  if (mapView.selected != null || mapView.selectedMarker) {
    mapView.selected = null;
    mapView.selectedMarker = null;
    drawMap();
  }
});

// ---- zoom (wheel) and pan (right-drag) ----
$('mapStage').addEventListener('wheel', (e) => {
  if (!mapView.name) return;
  e.preventDefault();
  zoomMapAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// double-click anywhere on the map returns to the default view
$('mapStage').addEventListener('dblclick', (e) => {
  e.preventDefault();
  resetMapView();
  drawMap();
});

let panning = null;
$('mapStage').addEventListener('contextmenu', (e) => e.preventDefault());  // no menu while panning
$('mapStage').addEventListener('mousedown', (e) => {
  if (e.button !== 2 || !mapView.name) return;   // right button only
  e.preventDefault();
  const svg = $('mapRot').querySelector('svg');
  const r = svg && svg.getBoundingClientRect();
  if (!r || !r.width) return;
  const v = currentView(MAP_DATA[mapView.name]);
  panning = { x: e.clientX, y: e.clientY, view: { ...v }, unitsPerPx: v.w / r.width };
  $('mapStage').classList.add('panning');
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  // dragging right moves the map right, i.e. the window onto it moves left
  mapView.view = {
    x: panning.view.x - (e.clientX - panning.x) * panning.unitsPerPx,
    y: panning.view.y - (e.clientY - panning.y) * panning.unitsPerPx,
    w: panning.view.w, h: panning.view.h,
  };
  applyView(false);      // no redraw mid-drag: the scale has not changed
});
window.addEventListener('mouseup', (e) => {
  if (!panning || e.button !== 2) return;
  panning = null;
  $('mapStage').classList.remove('panning');
});
// Pin and card sizes are measured against the rendered SVG, so a resized window
// has to redraw or they drift away from their intended 13 px.
// The view rectangle is shaped to the stage, so anything that changes the stage's
// shape has to re-derive it. That is more than window resizes: the footer hint
// rewraps to two lines on some maps, which moves the stage's bottom edge AFTER
// openQuestMap measured it. Watch the element itself rather than the window, and
// debounce so a drag-resize doesn't redraw every frame.
let mapResizeTimer = null;
function onStageResized() {
  if ($('mapOverlay').classList.contains('hidden') || !mapView.name) return;
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    if (!$('mapOverlay').classList.contains('hidden') && mapView.name) applyView(true);
  }, 100);
}
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(onStageResized).observe($('mapStage'));
}
window.addEventListener('resize', onStageResized);
// Rotate the open map 90°. Rotation is per-map DATA (md.rotate baked into the
// SVG + md.orient calibrating game->svg axes), so a quarter turn must change
// both in step: rotate +90, and orient becomes comp(o[1]) + o[0] — the +90
// rotation in normalized coords is (x,y) -> (1-y, x), and complementing the
// char flips u<->U / v<->V. Everything downstream (pins, markers, labels,
// clicks, the editor's inverse) reads these two fields, so nothing else moves.
//
// PERSISTED as a quarter-turn count per map (settings.mapRotation). MAP_BASE
// keeps each map's pristine shipped entry, and the stored offset is applied to
// that on every open — never cumulatively to an already-mutated entry.
const MAP_BASE = {};
function quarterTurn(md) {
  const o = md.orient || 'UV';
  const comp = (c) => ({ u: 'U', U: 'u', v: 'V', V: 'v' }[c]);
  return { ...md, rotate: ((md.rotate || 0) + 90) % 360, orient: comp(o[1]) + o[0] };
}
function mapRotOffset(name) {
  const r = ((state.settings && state.settings.mapRotation) || {})[name];
  return typeof r === 'number' ? ((r % 4) + 4) % 4 : 0;
}
function applyMapRotation(name) {
  if (!MAP_BASE[name]) MAP_BASE[name] = MAP_DATA[name];
  let md = MAP_BASE[name];
  for (let i = 0; i < mapRotOffset(name); i++) md = quarterTurn(md);
  MAP_DATA[name] = md;
}
async function rotateMap() {
  if (!mapView.name) return;
  const name = mapView.name;
  // local-first then persist, same reason as setLayer: two quick clicks must
  // not build on the same stale settings object
  const next = { ...((state.settings && state.settings.mapRotation) || {}), [name]: (mapRotOffset(name) + 1) % 4 };
  state.settings = { ...state.settings, mapRotation: next };
  const keep = { sets: mapView.sets, floor: mapView.floor };
  await openQuestMap(name);   // re-applies rotation from settings
  mapView.sets = keep.sets;
  renderMapSets();
  mapView.pins = collectMapPins(name);
  renderMapLoadout(name);
  if (keep.floor !== -1) mapView.floor = keep.floor;
  drawMap();
  state.settings = await backend.saveSettings({ mapRotation: next });
}
$('rotateMapBtn').addEventListener('click', rotateMap);

$('closeMapBtn').addEventListener('click', () => $('mapOverlay').classList.add('hidden'));
$('mapOverlay').addEventListener('click', (e) => {
  if (e.target === $('mapOverlay')) $('mapOverlay').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('mapOverlay').classList.contains('hidden')) {
    $('mapOverlay').classList.add('hidden');
  }
});

// ---------- updates ----------

const upd = {
  current: '', checked: false, checking: false, error: null,
  available: false, latest: '', notes: '', canApply: false,
  downloading: false, downloadFailed: false, staged: false, progress: 0, phase: '',
};

function renderUpdateSection() {
  if (!$('updateStatus')) return;
  const status = $('updateStatus');
  $('versionTag').textContent = upd.current ? `v${upd.current}` : '';

  if (upd.checking) {
    status.innerHTML = 'Checking for updates…';
  } else if (!upd.checked) {
    status.innerHTML = '';
  } else if (upd.staged) {
    status.innerHTML = `<span class="ok">v${escapeHtml(upd.latest)} downloaded.</span> Restart to finish — your progress is kept.`;
  } else if (upd.downloading) {
    status.innerHTML = upd.phase === 'extract' ? 'Extracting…'
      : upd.phase === 'ready' ? 'Finishing…'
      : `Downloading v${escapeHtml(upd.latest)}…`;
  } else if (upd.downloadFailed) {
    status.innerHTML = `<span class="bad">Download failed.</span> Check your connection and try again.`;
  } else if (upd.error) {
    status.innerHTML = `<span class="bad">${escapeHtml(upd.error)}</span>`;
  } else if (!upd.available) {
    status.innerHTML = `<span class="ok">You're on the latest version.</span>`;
  } else if (!upd.canApply) {
    status.innerHTML = `<span class="ok">Update available: v${escapeHtml(upd.latest)}.</span> Download it from the GitHub Releases page (one-click install works in the packaged app).`;
  } else {
    status.innerHTML = `<span class="ok">Update available: v${escapeHtml(upd.latest)}.</span> Your progress won't be affected.`;
  }

  // the footer is always on screen, so an empty status line must not reserve space
  status.classList.toggle('hidden', !status.textContent.trim());

  $('checkUpdateBtn').classList.toggle('hidden', upd.downloading || upd.staged);
  $('checkUpdateBtn').disabled = upd.checking || upd.downloading;
  $('installUpdateBtn').classList.toggle('hidden',
    !(upd.checked && upd.available && upd.canApply && !upd.staged && !upd.downloading));
  $('restartUpdateBtn').classList.toggle('hidden', !upd.staged);
  $('updateProgressWrap').classList.toggle('hidden', !upd.downloading);
  $('updateProgressBar').style.width = (upd.downloading ? upd.progress : 0) + '%';
}

async function doCheckUpdate(userInitiated) {
  upd.checking = true; upd.error = null; upd.downloadFailed = false; renderUpdateSection();
  const r = await backend.checkUpdate();
  upd.checking = false;
  upd.checked = true;
  upd.current = r.current || upd.current;
  upd.available = !!r.available;
  upd.latest = r.latest || '';
  upd.notes = r.notes || '';
  upd.canApply = !!r.canApply;
  upd.error = r.error || null;
  renderUpdateSection();
  if (userInitiated && !r.available && !r.error) toast("You're on the latest version.");
  if (userInitiated && r.error) toast(r.error);
}

$('checkUpdateBtn').addEventListener('click', () => doCheckUpdate(true));
$('installUpdateBtn').addEventListener('click', async () => {
  upd.downloading = true; upd.downloadFailed = false; upd.progress = 0; upd.phase = 'download'; renderUpdateSection();
  const r = await backend.downloadUpdate();
  upd.downloading = false;
  if (r && r.staged) { upd.staged = true; toast(`v${upd.latest} downloaded — restart to finish.`); }
  else { upd.downloadFailed = true; toast('Update failed: ' + ((r && r.error) || 'unknown')); }
  renderUpdateSection();
});
$('restartUpdateBtn').addEventListener('click', async () => {
  const btn = $('restartUpdateBtn');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'RESTARTING…';
  const r = await backend.applyUpdate();
  if (!r || !r.applying) {
    toast('Could not apply the update: ' + ((r && r.error) || 'unknown'));
    btn.disabled = false; btn.textContent = 'RESTART TO FINISH';
  }
});

backend.onUpdateProgress((p) => {
  if (p && p.phase) upd.phase = p.phase;
  if (p && typeof p.pct === 'number') upd.progress = p.pct;
  renderUpdateSection();
});
backend.onUpdateAvailable((r) => {
  upd.checked = true; upd.available = true;
  upd.latest = r.latest || ''; upd.notes = r.notes || '';
  upd.canApply = !!r.canApply; upd.current = r.current || upd.current;
  toast(`Update available: v${r.latest} — DOWNLOAD & INSTALL is at the bottom left.`);
  renderUpdateSection();
});

// ---------- boot ----------

(async function boot() {
  const init = await backend.getInit();
  state.settings = init.settings;
  // main.js owns the mode list; adopt it before anything reads state.gameMode
  if (Array.isArray(init.modes) && init.modes.length) state.modes = init.modes;
  if (init.modeLabels) state.modeLabels = init.modeLabels;
  if (init.defaultMode) state.defaultMode = init.defaultMode;
  upd.current = init.version || '';
  state.gameMode = modes().includes(init.settings.gameMode) ? init.settings.gameMode : defaultMode();
  if (init.progress && modes().some((m) => init.progress[m])) state.fullProgress = init.progress;
  state.watcherStatus = init.watcherStatus || state.watcherStatus;
  if (init.storyState && init.storyState.regular) state.storyState = init.storyState;
  state.filter = ['STORY', 'ALL', 'KAPPA', 'LIGHTKEEPER'].includes(init.settings.filter) ? init.settings.filter : 'ALL';
  // an install from before the grouping existed has no key — fall back to the
  // original layout rather than to whatever Object.keys happens to yield first
  if (GROUPINGS[init.settings.groupBy]) state.groupBy = init.settings.groupBy;
  // A quest count dropping on its own is alarming, so say what happened and
  // why, in one breath. The number reported is what was thrown away before the
  // rescan — most of it comes straight back.
  if (init.impliedRepaired > 0) {
    setTimeout(() => toast(`${init.impliedRepaired} quest(s) were only ever a guess — worked out from the quest `
      + 'data\'s "finish this before that" chain, which patch 1.1.0 replaced with trader loyalty. The app no '
      + 'longer guesses at all: it records what your logs state and what you tick. Tick any of these you really '
      + 'did finish.'), 1200);
  }
  applyMode();
  renderModeSwitch();
  renderGroupSwitch();
  renderAll();
  renderUpdateSection();   // shows the version in the footer before any check runs

  // legacy progress from before PvP/PvE were separated, and the user is on
  // manual tracking (so the automatic re-split never runs) — nudge them once
  if (init.progress && init.progress.pendingModeSplit && init.settings.trackingMode !== 'auto') {
    toast('Your progress predates PvP/PvE separation — open Settings and click "Re-scan all logs" to sort it by mode.');
  }

  state.dataInfo = await backend.loadTasks();
  if (state.dataInfo.regular) {
    buildTasksByMode();
    applyFetchedMapData(state.dataInfo.mapData);  // published map work over the bundled bake
    applyObjectiveFixes();   // hand-corrected pin positions (MAP_FIXES)
    applyMode();
  }
  renderAll();
  document.fonts.ready.then(fitSidebarWidth);
  // Last thing in boot, so the guide never covers a half-loaded screen. Shown
  // once per app VERSION — a new install sees it, and so does an existing user
  // after an update.
  openGuide(false);
})();
