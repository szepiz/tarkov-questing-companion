'use strict';

// ---------- dev fallback: lets the UI run in a plain browser (no Electron) ----------
const backend = window.api || (() => {
  const emptyBucket = () => ({ completed: {}, failed: {}, resetAt: 0 });
  const store = {
    settings: JSON.parse(localStorage.getItem('tqt-settings') || 'null') || {
      trackingMode: 'manual', logsPath: 'C:\\Battlestate Games\\EFT\\Logs', filter: 'ALL', gameMode: 'regular',
      hideCompleted: false, hideLocked: false, mapLayers: {}, mapLayersOpen: {},
    },
    progress: JSON.parse(localStorage.getItem('tqt-progress') || 'null') || { regular: emptyBucket(), pve: emptyBucket() },
  };
  const persist = () => {
    localStorage.setItem('tqt-settings', JSON.stringify(store.settings));
    localStorage.setItem('tqt-progress', JSON.stringify(store.progress));
  };
  const bucket = (mode) => store.progress[['regular', 'pve'].includes(mode) ? mode : store.settings.gameMode];
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
    resetProgress: async (mode) => { store.progress[['regular', 'pve'].includes(mode) ? mode : store.settings.gameMode] = { completed: {}, failed: {}, resetAt: Date.now() }; persist(); return store.progress; },
    rescanAll: async () => ({ progress: store.progress, imported: 0, failsImported: 0, hadReset: false, logsFound: false }),
    browseLogs: async () => null,
    openWiki: async (url) => window.open(url),
    getMapSvg: async (file) => { try { return await (await fetch(file)).text(); } catch { return null; } },
    checkUpdate: async () => ({ available: false, current: 'dev', canApply: false }),
    downloadUpdate: async () => ({ staged: false, error: 'not supported in browser' }),
    applyUpdate: async () => ({ applying: false }),
    onAutoCompletions: () => {},
    onStoryState: () => {},
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
  fullProgress: { regular: { completed: {}, failed: {}, resetAt: 0 }, pve: { completed: {}, failed: {}, resetAt: 0 } },
  tasks: [],                                    // active mode's task list
  byId: new Map(),                              // active mode's id -> task
  progress: { completed: {}, failed: {} },      // active mode's bucket
  settings: null,
  watcherStatus: { active: false, logsFound: false },
  dataInfo: null,
  filter: 'ALL',
  expandedMaps: new Set(),
  expandedTraders: new Set(), // key: `${map}::${trader}`
  selMap: null,
  selTrader: null,
  selQuestId: null,
  // story campaign (chapters from storydata.js; auto state from the log watcher)
  storyState: { regular: { chapters: {}, subs: {} }, pve: { chapters: {}, subs: {} } },
  expandedChapters: new Set(),
  selChapter: null,
};

const $ = (id) => document.getElementById(id);

// point the active-mode views (tasks/byId/progress) at the current game mode
function applyMode() {
  const m = state.gameMode;
  state.tasks = state.tasksByMode[m] || [];
  state.byId = new Map(state.tasks.map((t) => [t.id, t]));
  state.progress = state.fullProgress[m] || { completed: {}, failed: {}, objectives: {}, resetAt: 0 };
  if (!state.progress.completed) state.progress.completed = {};
  if (!state.progress.failed) state.progress.failed = {};
  if (!state.progress.objectives) state.progress.objectives = {};
}

// ---------- filtering / grouping ----------

function taskPassesFilter(t) {
  if (state.filter === 'KAPPA') return !!t.kappaRequired;
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
  for (const req of t.taskRequirements || []) {
    if (!req.task) continue;
    if (!reqSatisfied(req)) { ok = false; break; }
  }
  _reachStack.delete(taskId);
  _reachMemo.set(taskId, ok);
  return ok;
}

function isUnlocked(t) { return taskReachable(t.id); }

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

function levelLocked(t) {
  const need = t.minPlayerLevel || 0;
  const have = playerLevel();
  return need > 0 && have > 0 && need > have;
}

function isLocked(t) {
  return lockingActive() && !isDone(t.id) && (!isUnlocked(t) || levelLocked(t));
}

// Map -> Trader -> [tasks]
function buildTree() {
  const maps = new Map();
  for (const t of state.tasks) {
    if (!taskPassesFilter(t)) continue;
    const mapName = effectiveMap(t);
    const traderName = (t.trader && t.trader.name) || 'Unknown';
    if (!maps.has(mapName)) maps.set(mapName, new Map());
    const traders = maps.get(mapName);
    if (!traders.has(traderName)) traders.set(traderName, []);
    traders.get(traderName).push(t);
  }
  const locking = lockingActive();
  for (const traders of maps.values()) {
    for (const list of traders.values()) {
      // sink the ones you cannot act on: locked below the rest, failed below that
      const rank = new Map(list.map((t) => [t.id,
        isFailed(t.id) && !isDone(t.id) ? 2 : (locking && isLocked(t)) ? 1 : 0]));
      list.sort((a, b) =>
        rank.get(a.id) - rank.get(b.id) ||
        (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) ||
        a.name.localeCompare(b.name));
    }
  }
  return maps;
}

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
      ${c.wip ? '<span class="story-tag wip" title="Map locations for this chapter are not placed yet — expect no pins or areas">WIP</span>' : ''}
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
  $('questBadges').innerHTML = [
    '<span class="badge story">STORY CHAPTER</span>',
    c.wip ? '<span class="badge wip" title="Map locations for this chapter are not placed yet">MAP LOCATIONS WIP</span>' : '',
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
  if (!state.tasks.length) {
    const msg = document.createElement('div');
    msg.className = 'tree-message error';
    msg.textContent = (state.dataInfo && state.dataInfo.error)
      ? 'Could not load quest data. Check your internet connection, then use Settings → Refresh.'
      : 'Loading quest data…';
    tree.appendChild(msg);
    return;
  }

  const grouped = buildTree();
  const mapNames = orderedKeys([...grouped.keys()], MAP_ORDER);

  // display toggles: hide completed / hide locked quests. Rows are hidden but
  // the x/y counts stay based on the full list so progress context is kept.
  const hideC = !!(state.settings && state.settings.hideCompleted);
  const hideL = !!(state.settings && state.settings.hideLocked);
  const hideF = !!(state.settings && state.settings.hideFailed);
  const hiding = hideC || hideL || hideF;
  const isVisible = (t) => !(hideC && isDone(t.id))
    && !(hideF && !isDone(t.id) && isFailed(t.id))
    && !(hideL && isLocked(t));

  for (const mapName of mapNames) {
    const traders = grouped.get(mapName);
    let mapTotal = 0, mapDone = 0, mapVisible = 0;
    for (const list of traders.values()) {
      mapTotal += list.length;
      mapDone += list.filter((t) => isDone(t.id)).length;
      mapVisible += list.filter(isVisible).length;
    }
    if (hiding && mapVisible === 0) continue; // nothing to show on this map

    const expanded = state.expandedMaps.has(mapName);
    const mapRow = document.createElement('div');
    mapRow.className = 'map-row' + (state.selMap === mapName && !state.selTrader ? ' selected' : '');
    mapRow.innerHTML = `
      <span class="row-name">${escapeHtml(mapName.toUpperCase())}</span>
      <span class="row-toggle">${expanded ? '−' : '+'}</span>
      ${hasMapData(mapName) ? `<button class="map-btn" title="Open the ${escapeHtml(mapName)} map with your objectives pinned">▣</button>` : ''}
      <span class="row-count${mapDone === mapTotal ? ' done' : ''}">${mapDone}/${mapTotal}</span>`;
    const mb = mapRow.querySelector('.map-btn');
    if (mb) mb.addEventListener('click', (e) => { e.stopPropagation(); openQuestMap(mapName); });
    // the +/- toggle expands or collapses on its own, without first having to
    // select the row (clicking the name still selects, as before)
    mapRow.querySelector('.row-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.expandedMaps.has(mapName)) state.expandedMaps.delete(mapName);
      else state.expandedMaps.add(mapName);
      renderAll();
    });
    mapRow.addEventListener('click', () => {
      if (state.selMap === mapName && state.expandedMaps.has(mapName)) {
        state.expandedMaps.delete(mapName);
      } else {
        state.expandedMaps.add(mapName);
      }
      state.selMap = mapName;
      state.selTrader = null;
      renderAll();
    });
    tree.appendChild(mapRow);
    if (!expanded) continue;

    const traderNames = orderedKeys([...traders.keys()], TRADER_ORDER);
    for (const traderName of traderNames) {
      const list = traders.get(traderName);
      if (hiding && !list.some(isVisible)) continue; // all of this trader's quests hidden
      const tKey = `${mapName}::${traderName}`;
      const tExpanded = state.expandedTraders.has(tKey);
      const doneCount = list.filter((t) => isDone(t.id)).length;

      const traderRow = document.createElement('div');
      traderRow.className = 'trader-row' +
        (state.selMap === mapName && state.selTrader === traderName ? ' selected' : '');
      traderRow.innerHTML = `
        <span class="row-name">${escapeHtml(traderName.toUpperCase())}</span>
        <span class="row-toggle">${tExpanded ? '−' : '+'}</span>
        <span class="row-count${doneCount === list.length ? ' done' : ''}">${doneCount}/${list.length}</span>`;
      traderRow.querySelector('.row-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.expandedTraders.has(tKey)) state.expandedTraders.delete(tKey);
        else state.expandedTraders.add(tKey);
        renderAll();
      });
      traderRow.addEventListener('click', () => {
        if (state.selTrader === traderName && state.selMap === mapName && state.expandedTraders.has(tKey)) {
          state.expandedTraders.delete(tKey);
        } else {
          state.expandedTraders.add(tKey);
        }
        state.selMap = mapName;
        state.selTrader = traderName;
        renderAll();
      });
      tree.appendChild(traderRow);
      if (!tExpanded) continue;

      for (const t of list) {
        if (!isVisible(t)) continue;
        const done = isDone(t.id);
        // a completed record wins: you cannot have both, and completion is the
        // one the player acted on
        const failed = !done && isFailed(t.id);
        const locked = !failed && isLocked(t);
        const row = document.createElement('div');
        row.className = 'quest-row' +
          (done ? ' completed' : '') +
          (failed ? ' failed' : '') +
          (locked ? ' locked' : '') +
          (state.selQuestId === t.id ? ' selected' : '');
        const via = done && state.progress.completed[t.id] && state.progress.completed[t.id].via;
        const checkTitle = via === 'implied'
          ? "completed — worked out from a later quest you finished that required it. Tarkov never logged this one's hand-in. Click to untick."
          : done ? 'mark as not completed'
          : failed && t.restartable ? 'failed — but this one can be taken again from the trader. It will clear itself once you re-accept it in game.'
          : failed ? 'failed — Tarkov recorded this quest as failed, usually because you took a competing one instead. It cannot be handed in this wipe. Click to tick it anyway.'
          : locked && levelLocked(t) ? `locked — needs player level ${t.minPlayerLevel} and you are ${playerLevel()}. Set your level in Settings if that is wrong.`
          : locked ? 'locked — prerequisite quests not completed (you can still tick it manually)'
          : 'mark as completed';
        row.innerHTML = `
          <span class="quest-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name.toUpperCase())}</span>
          ${failed ? `<span class="failed-tag${t.restartable ? ' retakeable' : ''}">${t.restartable ? 'RETAKE' : 'FAILED'}</span>` : ''}
          ${locked ? '<span class="locked-tag">LOCKED</span>' : ''}
          <span class="quest-check" title="${checkTitle}"></span>`;
        row.querySelector('.quest-name').addEventListener('click', () => {
          state.selMap = mapName;
          state.selTrader = traderName;
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
      }
    }
  }
}

// ---------- hero (map + trader crossfade) ----------

function renderHero() {
  const heroMap = $('heroMap');
  const heroTrader = $('heroTrader');
  const heroEmpty = $('heroEmpty');
  const heroLabel = $('heroLabel');
  const heroTraderName = $('heroTraderName');

  const mapName = state.selMap ? MAP_IMAGES[state.selMap.toLowerCase()] : null;
  const traderName = state.selTrader ? TRADER_IMAGES[state.selTrader.toLowerCase()] : null;
  const mapFile = mapName ? IMG_DIR + mapName : null;
  const traderFile = traderName ? IMG_DIR + traderName : null;

  heroEmpty.style.display = state.selMap ? 'none' : '';
  heroLabel.textContent = state.selMap ? state.selMap.toUpperCase() : '';

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
  if (t.kappaRequired) badges.push('<span class="badge kappa">KAPPA</span>');
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
  $('questObjectives').innerHTML = objectives ? `<h3>${heading}</h3>${objectives}` : '';
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
  if (t.minPlayerLevel) {
    const short = levelLocked(t);
    reqs.push(`<div class="req-line${short ? ' prereq-missing' : ''}"><span class="req-tag">LEVEL</span>`
      + `<span>player level ${t.minPlayerLevel}${short ? ` — you are ${playerLevel()}` : ''}</span></div>`);
  }
  // highlight each prerequisite with the same status-aware logic that
  // decides LOCKED: green = positively met, yellow = the one blocking it
  const showMissing = isLocked(t);
  for (const req of t.taskRequirements || []) {
    if (!req.task) continue;
    const statuses = reqStatuses(req);
    const met = reqMet(req);
    const missing = showMissing && !reqSatisfied(req);
    const failOnly = statuses.includes('failed') && !statuses.includes('complete');
    const label = escapeHtml(req.task.name) + (failOnly ? ' (must be failed)' : '');
    reqs.push(`<div class="req-line${met ? ' prereq-done' : ''}${missing ? ' prereq-missing' : ''}">
      <span class="req-tag">QUEST</span><span>${label}</span></div>`);
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
  $('questRequirements').innerHTML = reqs.length ? `<h3>REQUIREMENTS</h3>${reqs.join('')}` : '';

  const wikiBtn = $('wikiBtn');
  wikiBtn.classList.toggle('hidden', !t.wikiLink);
  wikiBtn.onclick = () => backend.openWiki(t.wikiLink);
}

// ---------- tabs / status / settings ----------

function renderTabs() {
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.filter === state.filter);
  });
}

function modeLabel(mode) { return mode === 'pve' ? 'PvE' : 'PvP'; }

function renderModeSwitch() {
  document.querySelectorAll('.mode-btn-top').forEach((el) => {
    el.classList.toggle('on', el.dataset.mode === state.gameMode);
  });
}

// switch the viewed game mode: repoint active views, persist, re-render
function setGameMode(mode) {
  if (mode === state.gameMode || !['regular', 'pve'].includes(mode)) return;
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
  for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked'], ['hideFailedBtn', 'hideFailed']]) {
    const on = !!state.settings[key];
    $(btnId).textContent = on ? 'ON' : 'OFF';
    $(btnId).classList.toggle('on', on);
  }
  // locked and failed both come from the logs, so both need automatic tracking
  const auto = state.settings.trackingMode === 'auto';
  $('hideLockedRow').style.opacity = auto ? '1' : '.45';
  $('hideFailedRow').style.opacity = auto ? '1' : '.45';
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

  const ws = state.watcherStatus;
  $('logsStatus').innerHTML = state.settings.trackingMode !== 'auto'
    ? 'Only used when tracking is set to AUTOMATIC.'
    : (ws.logsFound
      ? `<span class="ok">Logs folder found</span> — ${ws.sessionFolders} session folder(s) scanned.`
      : `<span class="bad">Logs folder not found.</span> If your game is not installed in the default location, point this at your EFT\\Logs folder.`);

  const di = state.dataInfo;
  $('dataStatus').innerHTML = !di ? 'Loading…'
    : di.source === 'online'
      ? `<span class="ok">Up to date</span> — fetched from tarkov.dev just now (${state.tasks.length} quests).`
      : di.source === 'cache'
        ? `Using cached data from ${new Date(di.fetchedAt).toLocaleString()} (${state.tasks.length} quests). Refresh when online.`
        : `<span class="bad">No data.</span> Connect to the internet and refresh.`;

  if (typeof renderUpdateSection === 'function') renderUpdateSection();
}

function renderAll() {
  _reachMemo = new Map(); // progress may have changed since last render
  _reachStack.clear();    // defensive: never carry a partial DFS across renders
  _levelFloor = null;     // a new completion can raise the inferred level
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

for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked'], ['hideFailedBtn', 'hideFailed']]) {
  $(btnId).addEventListener('click', async () => {
    state.settings = await backend.saveSettings({ [key]: !state.settings[key] });
    renderAll();
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
    const pve = (state.dataInfo.pve && state.dataInfo.pve.length) ? state.dataInfo.pve : state.dataInfo.regular;
    state.tasksByMode = { regular: state.dataInfo.regular, pve };
    applyObjectiveFixes();   // hand-corrected pin positions (MAP_FIXES)
    applyMode();
  }
  renderAll();
  document.fonts.ready.then(fitSidebarWidth);
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
  if (data && data.regular) {
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
    const other = state.gameMode === 'regular' ? 'pve' : 'regular';
    if (cnt(state.gameMode) === 0 && cnt(other) > 0) {
      state.gameMode = other;
      applyMode();
      renderModeSwitch();
    }
    state.settings.modeAutoResolved = true;
    backend.setGameMode(state.gameMode); // persists gameMode + modeAutoResolved
  }

  // announce only completions in the mode currently being viewed
  const mineIds = (data.newByMode && data.newByMode[state.gameMode]) || [];
  const names = mineIds.map((id) => (state.byId.get(id) || {}).name).filter(Boolean);
  const otherMode = state.gameMode === 'regular' ? 'pve' : 'regular';
  const otherCount = ((data.newByMode && data.newByMode[otherMode]) || []).length;
  // count only ids that resolve to a real quest — the logs also carry daily/weekly
  // template ids, which belong to no quest in the list
  if (data.initial && names.length > 3) {
    toast(`Imported ${names.length} completed ${modeLabel(state.gameMode)} quests from your logs`);
  } else if (names.length) {
    for (const n of names.slice(0, 5)) toast(`Quest completed: ${n}`);
    if (names.length > 5) toast(`…and ${names.length - 5} more`);
  }
  if (data.initial && otherCount > 0 && names.length === 0) {
    toast(`Found ${otherCount} completed ${modeLabel(otherMode)} quests — switch to ${modeLabel(otherMode)} to see them.`);
  }
  renderAll();
});
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
  // point of panning at high zoom — while still making it impossible to lose the
  // map altogether, because the centre of the pane is always over it. Clamping the
  // whole rectangle inside the map (the obvious version) stops the edges ever
  // reaching the middle; clamping to the padded base instead let the map be
  // dragged completely off screen. Where the view is bigger than the map in an
  // axis there is nothing to pan, so centre it — that is what draws the letterbox.
  const axis = (c, size, fp, fs) => (size >= fs
    ? fp + fs / 2 - size / 2
    : clamp(c, fp, fp + fs) - size / 2);

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

// Every point this objective puts on the given map. Shared by the pins and the
// loadout list so the two can never disagree about what is "on this map".
function objectiveMapPoints(o, mapName) {
  const pts = [];
  for (const z of o.zones || []) {
    if (z && z.position && normMapName(z.map && z.map.name) === mapName) pts.push(z.position);
  }
  for (const l of o.possibleLocations || []) {
    if (normMapName(l.map && l.map.name) !== mapName) continue;
    for (const p of l.positions || []) pts.push(p);
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
  if (s.kappa && t.kappaRequired) return true;
  if (s.lightkeeper && t.lightkeeperRequired) return true;
  if (s.side && !t.kappaRequired && !t.lightkeeperRequired) return true;
  return false;
}

// The tasks whose objectives should appear for this map: the map's tickbox
// sets (seeded from the tab that opened it), not done, not failed, locked only
// if not hidden.
function* mapTasks() {
  for (const t of state.tasks) {
    if (!mapSetPass(t) || isDone(t.id) || isFailed(t.id)) continue;
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
  $('mapStoryList').innerHTML = story.length ? `<div class="ld-group ld-story">
      <ul>${story.map((o) => `<li data-story-obj="${escapeHtml(o.id)}" title="${escapeHtml(o.chapter)} — click to tick this story objective off">
        <span class="ld-name">${escapeHtml(o.desc)}</span></li>`).join('')}</ul>
    </div>` : '';

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
    li.addEventListener('click', async () => {
      state.fullProgress = await backend.toggleObjective(li.dataset.storyObj, true, state.gameMode);
      applyMode();
      renderMapLoadout(mapName);
      renderAll();
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
  if (mapView.highlight
    && ![...load.keys, ...load.bring].some((i) => i.name === mapView.highlight.item)) {
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
          floor: floorOf(md, p.x, typeof p.y === 'number' ? p.y : 0, p.z),
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
// (MAP_FIXES). Some upstream label/extract coordinates sit visibly off on some
// maps; the owner drags them right in the editor and the moves land here. Keys
// are built from the PRISTINE baked coords, so this must run before anything
// reads or copies the data — it mutates the shared row arrays in place, once,
// at load. Guarded: storydata.js may predate the constant.
(function applyMapFixes() {
  if (typeof MAP_FIXES === 'undefined' || !MAP_FIXES) return;
  const lbl = MAP_FIXES.labels || {}, exm = MAP_FIXES.extracts || {};
  for (const [name, md] of Object.entries(MAP_DATA)) {
    for (const l of md.labels || []) {
      const m = lbl[`${name}|${l[2]}|${Math.round(l[0])}|${Math.round(l[1])}`];
      if (m) { l[0] = m.x; l[1] = m.z; }
    }
    if (typeof MAP_MARKERS === 'undefined' || !MAP_MARKERS[name]) continue;
    for (const r of MAP_MARKERS[name].ex || []) {
      const m = exm[`${name}|${r[5]}|${r[3]}`];
      if (m) { r[0] = m.x; r[2] = m.z; }
    }
  }
})();

// Objective-position fixes (MAP_FIXES.objectives) work on the TASK data, which
// arrives async and is rebuilt on every refresh — so unlike labels/extracts
// this must run after every tasksByMode assignment, not once at parse. It sets
// absolute coordinates, so applying it twice is harmless. Keys are built from
// the cache's pristine coords: map|objectiveId|round(x)|round(z).
function applyObjectiveFixes() {
  if (typeof MAP_FIXES === 'undefined' || !MAP_FIXES || !MAP_FIXES.objectives) return;
  const fx = MAP_FIXES.objectives;
  if (!Object.keys(fx).length) return;
  const apply = (mapName, oid, p) => {
    if (!mapName || !p) return;
    const m = fx[`${mapName}|${oid}|${Math.round(p.x)}|${Math.round(p.z)}`];
    if (m) { p.x = m.x; p.z = m.z; }
  };
  for (const list of Object.values(state.tasksByMode || {})) {
    for (const t of list || []) for (const o of t.objectives || []) {
      for (const z of o.zones || []) if (z && z.position && z.map) apply(normMapName(z.map.name), o.id, z.position);
      for (const l of o.possibleLocations || []) {
        for (const p of l.positions || []) apply(normMapName(l.map && l.map.name), o.id, p);
      }
    }
  }
}

const hasMapMarkers = (name) => typeof MAP_MARKERS !== 'undefined' && !!MAP_MARKERS[name]
  && Object.values(MAP_MARKERS[name]).some((rows) => rows.length);

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
    // value-per-slot bar (LOOT_HV_MIN) when the marker data was baked. Those
    // spots draw the gold star INSTEAD of their category glyph and show under
    // either tick box — see collectMapMarkers.
    rows: [{ id: 'lootHighValue', label: 'High value', glyph: 'star', cls: 'mk-hv' }].concat(LOOT_CATS.slice(2)),
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
    // No "other hazards" row: upstream's third hazard type occurs only on The
    // Labyrinth, which ships no artwork, so the box would be greyed out on every
    // single map. build_mapmarkers.js drops those rows to match.
    rows: [
      { id: 'hazardMinefield', label: 'Minefields', glyph: 'mine', cls: 'mk-mine' },
      { id: 'hazardSniper', label: 'Sniper zones', glyph: 'sniper', cls: 'mk-sniper' },
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
async function setLayer(id, on) {
  const next = { ...((state.settings && state.settings.mapLayers) || {}), [id]: on };
  state.settings = { ...state.settings, mapLayers: next };
  drawMap();
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
  if (!md || !hasMapMarkers(mapName)) return [];
  const M = MAP_MARKERS[mapName];
  const out = [];
  const add = (x, y, z, layers, glyph, cls, title, lines, extra) => {
    if (typeof x !== 'number' || typeof z !== 'number') return;
    out.push(Object.assign({ x, y: y || 0, z, layers, glyph, cls, title, lines,
      floor: floorOf(md, x, y || 0, z) }, extra || {}));
  };

  for (const [x, y, z, fac, sw, name, toll, tollN] of M.ex || []) {
    const layers = fac === 0 ? ['extractPmc'] : fac === 1 ? ['extractScav'] : ['extractPmc', 'extractScav'];
    const who = fac === 0 ? 'PMC extract' : fac === 1 ? 'Scav extract' : 'PMC and Scav extract';
    const lines = [['', who]];
    if (toll) {
      lines.push([isFee(toll) ? 'Fee' : 'Needs', tollLabel(toll, tollN)]);
      if (isFee(toll)) lines.push(['', 'Base fee — you pay less with better Scav karma']);
    }
    if (sw) lines.push(['Needs', 'a switch or lever thrown first']);
    for (const g of extractGear(mapName, name)) lines.push(['Needs', g]);
    const m = out.length;
    // anyFloor: an extract you cannot see is worse than one drawn in the wrong
    // place. They stay on screen whatever floor you are on, greyed when they
    // belong to another one.
    add(x, y, z, layers, 'exit', fac === 1 ? 'mk-scav' : 'mk-pmc', name || 'Extract', lines,
      { anyFloor: true });
    if (out.length > m) out[out.length - 1].label = name || '';   // drawn above the icon
  }
  // Transits behave like extracts for the player (a way OUT of the raid), so
  // they get the same treatment: name above the icon, visible on every floor,
  // greyed when theirs is another one.
  for (const [x, y, z, desc, dest] of M.tr || []) {
    const m2 = out.length;
    add(x, y, z, ['transitAll'], 'arrow', 'mk-transit', `Transit to ${dest}`,
      [['', `Moves you to ${dest} instead of extracting`]].concat(desc && desc !== `Transit to ${dest}` ? [['', desc]] : []),
      { anyFloor: true });
    if (out.length > m2) out[out.length - 1].label = `To ${dest}`;
  }
  for (const [x, y, z, type] of M.hz || []) {
    if (type !== 0 && type !== 1) continue;   // see the note on MARKER_GROUPS.hazards
    const id = type === 0 ? 'hazardMinefield' : 'hazardSniper';
    add(x, y, z, [id], type === 0 ? 'mine' : 'sniper', type === 0 ? 'mk-mine' : 'mk-sniper',
      null, null);                            // no card: a mine point has nothing to say
  }
  for (const [x, y, z, type, short, full] of M.lk || []) {
    const what = ['Locked door', 'Locked trunk', 'Locked container', 'Locked switch'][type] || 'Locked';
    add(x, y, z, ['lockAll'], 'key', 'mk-lock', full || short || what, [['', what], ['Opens with', full || short]]);
  }
  for (const [x, y, z, cat, alts, item] of M.lt || []) {
    const c = LOOT_CATS[cat];
    if (!c) continue;
    // Every loose-loot marker means exactly one thing, so every one of them looks
    // and reads the same. How many other items share the exact spot is not
    // something a player can act on, and showing it as two tiers made one of them
    // look reliable.
    //
    // The one sanctioned exception: an item whose baked value-per-slot clears
    // LOOT_HV_MIN draws as the gold star and belongs to BOTH its category layer
    // and the high-value one (either box shows it, it appears once). That is a
    // statement about the item's price, not about the spawn — the card keeps the
    // same chance sentence and adds what it is worth. Guarded: the layer tests
    // run this without the generated constants.
    const lv = (typeof LOOT_VALUE !== 'undefined' && LOOT_VALUE[item]) || null;
    const hv = !!lv && typeof LOOT_HV_MIN !== 'undefined' && lv[1] >= LOOT_HV_MIN;
    const lines = [['', 'This item has a chance to spawn here']];
    if (hv) {
      const fv = (n) => Math.round(n).toLocaleString('en-US');
      lines.push(['Worth', `≈ ${fv(lv[0])} roubles`
        + (lv[0] !== lv[1] ? ` (${fv(lv[1])} per slot)` : '')]);
    }
    add(x, y, z, hv ? [c.id, 'lootHighValue'] : [c.id], hv ? 'star' : c.glyph,
      hv ? 'mk-hv' : c.cls, item || c.label, lines, { loose: true, hv });
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
  const ids = new Set(groupRows(grp).map((r) => r.id));
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
  sniper: 'M0 -6.5 L0 6.5 M-6.5 0 L6.5 0 M0 -3.6 A3.6 3.6 0 1 1 0 3.6 A3.6 3.6 0 1 1 0 -3.6',
  key: 'M0 -6.2 A3 3 0 1 1 0 -0.2 A3 3 0 1 1 0 -6.2 M-1.4 -0.6 L-1.4 6.4 L1.4 6.4 L1.4 -0.6 M1.4 3 L3.4 3',
  marked: 'M-6.5 -6.5 L6.5 -6.5 L6.5 6.5 L-6.5 6.5 Z M-6.5 -2 L-6.5 -6.5 L-2 -6.5 M2 6.5 L6.5 6.5 L6.5 2',
  text: 'M-6 -3.6 L6 -3.6 M-6 0 L3 0 M-6 3.6 L4.6 3.6',

  // one shape per loot type, so a marker is recognisable without the panel
  gem: 'M0 -6.4 L6.4 0 L0 6.4 L-6.4 0 Z',
  // high value: a solid five-point star — nothing else on the map is one. All
  // one subpath, so the winding rule that hollowed the grenade cannot bite.
  star: 'M0 -7.2 L1.76 -2.43 L6.85 -2.22 L2.85 0.93 L4.23 5.83 L0 3 L-4.23 5.83 L-2.85 0.93 L-6.85 -2.22 L-1.76 -2.43 Z',
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
  'sniper', 'marked', 'text',
  'stim', 'chip', 'card', 'fuelCan', 'nut', 'gear', 'cutlery',
  'crate', 'toolbox', 'pcblock', 'drawers', 'safe', 'shirt', 'bag', 'cache', 'body', 'rouble',
]);

// Every glyph is drawn twice: a dark, wide, unpainted-fill "halo" underneath and
// the real thing on top. Without it an outline glyph has no dark edge at all —
// only solids got one from `.mk`'s stroke — and pale artwork swallows them.
function glyphMarkup(glyph, cls, extra, light) {
  const d = MARKER_GLYPHS[glyph];
  const hollow = HOLLOW.has(glyph) ? ' hollow' : '';
  return `<path class="mk halo${light ? ' light' : ''}" d="${d}"/>`
    + `<path class="mk ${cls}${hollow}${extra || ''}" d="${d}"/>`;
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
  const all = (mapView.markers || [])
    .filter((m) => (m.anyFloor || m.floor === mapView.floor) && m.layers.some(layerOn));
  if (!all.length) { mapView.selectedMarker = null; return; }

  // Mines are the dense case and the least individually interesting, so they
  // thin harder than everything else.
  const dense = all.filter((m) => m.glyph === 'mine');
  const rest = all.filter((m) => m.glyph !== 'mine');
  const shown = decimateMarkers(dense, md, 9, k).concat(decimateMarkers(rest, md, 13, k));
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
  for (const [name, d] of Object.entries(MARKER_GLYPHS)) {
    s += `<path id="mkdef-${name}" d="${d}"/>`;
  }
  s += '</defs>';
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
    s += `<use href="#mkdef-${m.glyph}" class="${halo}${off}" ${t}/>`
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
  if (!hasMapMarkers(mapView.name)) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;

  const counts = mapLayerCounts();
  const open = (state.settings && state.settings.mapLayersOpen) || {};
  const rowHtml = (rows) => rows.map((r) => {
      // `always` rows aren't markers, so they have no marker count and must never
      // be disabled — that is the location-names toggle, which counts labels and
      // is on unless explicitly turned off.
      const n = r.always ? labelCount() : (counts[r.id] || 0);
      const on = r.always ? labelsOn() : layerOn(r.id);
      const dead = !n && !r.always;
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
    + `<div class="ml-body">${groups}`
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
  stopMapEvents(host);
}
// ---------- map layers end ----------

function renderFloorTabs() {
  const md = MAP_DATA[mapView.name];
  // ordered bottom-to-top, so ground sits above the basement rather than first
  const tabs = floorOrder(md).map((t) => ({ name: t.name.toUpperCase(), idx: t.idx }));
  $('floorTabs').innerHTML = tabs.map((t) => {
    const n = mapView.pins.filter((p) => p.floor === t.idx).length;
    return `<button class="floor-tab${t.idx === mapView.floor ? ' active' : ''}" data-floor="${t.idx}">${escapeHtml(t.name)}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  $('floorTabs').querySelectorAll('.floor-tab').forEach((b) => {
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
  const [lx, lz, , lb, lt] = l;
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
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', p.area.map((q) => { const sp = mapPoint(md, q.x, q.z); return sp.x + ',' + sp.y; }).join(' '));
    poly.setAttribute('class', 'story-area');
    poly.setAttribute('stroke-width', 2.2 * k);
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
  mapView.floor = -1;
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
  $('mapCredit').innerHTML = 'Map by Shebuka · tarkov-dev-svg-maps · CC BY-NC-SA 4.0'
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
  upd.current = init.version || '';
  state.gameMode = ['regular', 'pve'].includes(init.settings.gameMode) ? init.settings.gameMode : 'regular';
  if (init.progress && (init.progress.regular || init.progress.pve)) state.fullProgress = init.progress;
  state.watcherStatus = init.watcherStatus || state.watcherStatus;
  if (init.storyState && init.storyState.regular) state.storyState = init.storyState;
  state.filter = ['STORY', 'ALL', 'KAPPA', 'LIGHTKEEPER'].includes(init.settings.filter) ? init.settings.filter : 'ALL';
  applyMode();
  renderModeSwitch();
  renderAll();
  renderUpdateSection();   // shows the version in the footer before any check runs

  // legacy progress from before PvP/PvE were separated, and the user is on
  // manual tracking (so the automatic re-split never runs) — nudge them once
  if (init.progress && init.progress.pendingModeSplit && init.settings.trackingMode !== 'auto') {
    toast('Your progress predates PvP/PvE separation — open Settings and click "Re-scan all logs" to sort it by mode.');
  }

  state.dataInfo = await backend.loadTasks();
  if (state.dataInfo.regular) {
    const pve = (state.dataInfo.pve && state.dataInfo.pve.length) ? state.dataInfo.pve : state.dataInfo.regular;
    state.tasksByMode = { regular: state.dataInfo.regular, pve };
    applyObjectiveFixes();   // hand-corrected pin positions (MAP_FIXES)
    applyMode();
  }
  renderAll();
  document.fonts.ready.then(fitSidebarWidth);
})();
