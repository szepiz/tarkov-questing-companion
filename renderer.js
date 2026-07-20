'use strict';

// ---------- dev fallback: lets the UI run in a plain browser (no Electron) ----------
const backend = window.api || (() => {
  const emptyBucket = () => ({ completed: {}, failed: {}, resetAt: 0 });
  const store = {
    settings: JSON.parse(localStorage.getItem('tqt-settings') || 'null') || {
      trackingMode: 'manual', logsPath: 'C:\\Battlestate Games\\EFT\\Logs', filter: 'ALL', gameMode: 'regular',
      hideCompleted: false, hideLocked: false,
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
      if (done) b.objectives[objectiveId] = { at: Date.now() };
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
    onWatcherStatus: () => {},
    onSettingsChanged: () => {},
    onUpdateAvailable: () => {},
    onUpdateProgress: () => {},
  };
})();

// ---------- static config ----------

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
function isObjectiveDone(objectiveId) {
  return !!(objectiveId && state.progress.objectives && state.progress.objectives[objectiveId]);
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

function isLocked(t) {
  return lockingActive() && !isDone(t.id) && !isUnlocked(t);
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

// ---------- tree rendering ----------

function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
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

  const mapFile = state.selMap ? MAP_IMAGES[state.selMap.toLowerCase()] : null;
  const traderFile = state.selTrader ? TRADER_IMAGES[state.selTrader.toLowerCase()] : null;

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
    reqs.push(`<div class="req-line"><span class="req-tag">LEVEL</span><span>player level ${t.minPlayerLevel}</span></div>`);
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
const mapView = { name: null, svgLoaded: false, floor: -1, pins: [], selected: null, view: null, zoom: 1 };

const ZOOM_MIN = 1, ZOOM_MAX = 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Zoom/pan moves the SVG's own viewBox rather than applying a CSS transform.
// A CSS scale() rasterises the map once at its layout size and then magnifies
// that bitmap — zoom in and you get a blurry mess out of artwork that is pure
// vector. Narrowing the viewBox makes the browser re-render the paths, so the
// map stays sharp at any zoom. Everything else falls out for free: viewBox units
// per screen pixel shrink as you zoom, and pin/label/card sizes are derived from
// that, so they stay the same size on screen.

// the whole map, in the coordinates the user sees
function fullView(md) { return rotatedViewBox(md); }
// the part of it currently on screen
function currentView(md) { return mapView.view || fullView(md); }

function applyView(redraw) {
  const md = MAP_DATA[mapView.name];
  if (!md) return;
  const full = fullView(md);
  const v = mapView.view || { ...full };
  // keep the aspect of the full map so the element's layout box never changes
  v.w = clamp(v.w, full.w / ZOOM_MAX, full.w);
  v.h = v.w * (full.h / full.w);
  v.x = clamp(v.x, full.x, full.x + full.w - v.w);
  v.y = clamp(v.y, full.y, full.y + full.h - v.h);
  mapView.view = v;
  mapView.zoom = full.w / v.w;
  const svg = $('mapRot').querySelector('svg');
  if (svg) svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  $('mapRot').classList.toggle('zoomed', mapView.zoom > 1.001);
  if (redraw) requestAnimationFrame(() => { if (mapView.name) drawMap(); });
}

function resetMapView() {
  const md = MAP_DATA[mapView.name];
  mapView.view = md ? { ...fullView(md) } : null;
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
  const full = fullView(md);
  const w = clamp(v.w / factor, full.w / ZOOM_MAX, full.w);
  if (w === v.w) return;
  const h = w * (full.h / full.w);
  // hold whatever is under the cursor still
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

// The tasks whose objectives should appear for this map: same filter the pins use
// (current tab, not done, not failed, locked only if not hidden).
function* mapTasks() {
  for (const t of state.tasks) {
    if (!taskPassesFilter(t) || isDone(t.id) || isFailed(t.id)) continue;
    const locked = isLocked(t);
    if (locked && state.settings && state.settings.hideLocked) continue;
    yield [t, locked];
  }
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
  const keys = new Map();     // name -> Set of quest names
  const bring = new Map();    // label -> { qty, quests:Set }
  const addBring = (label, qty, quest) => {
    if (!label) return;
    const e = bring.get(label) || { qty: 0, quests: new Set() };
    e.qty += qty; e.quests.add(quest);
    bring.set(label, e);
  };

  for (const [t] of mapTasks()) {
    for (const o of t.objectives || []) {
      if (isObjectiveDone(o.id)) continue;   // already ticked off by hand
      if (!objectiveMapPoints(o, mapName).length) continue;
      // a key opens the door however many objectives are behind it
      for (const k of [].concat(...(o.requiredKeys || []))) {
        if (!k || !k.name) continue;
        if (!keys.has(k.name)) keys.set(k.name, new Set());
        keys.get(k.name).add(t.name);
      }
      if (o.markerItem && o.markerItem.name) addBring(o.markerItem.name, o.count || 1, t.name);
      if (BRING_TYPES.has(o.type)) {
        const alts = [...new Set((o.items || []).concat(o.useAny || []).map((i) => i && i.name).filter(Boolean))];
        if (alts.length) {
          addBring(alts.length > 2 ? `${alts[0]} (or ${alts.length - 1} alternatives)` : alts.join(' or '),
            o.count || 1, t.name);
        }
      }
    }
  }

  const bySize = (a, b) => b.qty - a.qty || a.name.localeCompare(b.name);
  return {
    keys: [...keys].map(([name, quests]) => ({ name, qty: 1, quests: [...quests] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bring: [...bring].map(([name, e]) => ({ name, qty: e.qty, quests: [...e.quests] })).sort(bySize),
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
  const row = (i) => `<li title="${escapeHtml(i.quests.slice(0, 6).join(' · '))}">`
    + `<span class="ld-name">${escapeHtml(i.name)}</span>`
    + (i.qty > 1 ? `<span class="ld-qty">×${i.qty}</span>` : '') + '</li>';
  const section = (title, items) => (items.length
    ? `<div class="ld-group"><div class="ld-head">${title}</div><ul>${items.map(row).join('')}</ul></div>` : '');

  const html = section('KEYS', load.keys) + section('TAKE WITH YOU', load.bring);
  const ticked = handTickedOnMap(mapName);
  const tickedHtml = ticked.length ? `<div class="ld-group ld-ticked">
      <div class="ld-head">DONE BY HAND (${ticked.length})<button id="ldRestoreAll" title="Put all of these back on the map">restore all</button></div>
      <ul>${ticked.map((o) => `<li data-obj="${escapeHtml(o.id)}" title="${escapeHtml(o.quest)} — click to put it back on the map">
        <span class="ld-name">${escapeHtml(o.desc || o.quest)}</span></li>`).join('')}</ul>
    </div>` : '';

  $('mapLoadoutList').innerHTML = (html || (ticked.length ? ''
    : '<div class="ld-empty">Nothing needs bringing for these objectives.</div>')) + tickedHtml;

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
  return out;
}

function renderFloorTabs() {
  const md = MAP_DATA[mapView.name];
  // ordered bottom-to-top, so ground sits above the basement rather than first
  const tabs = floorOrder(md).map((t) => ({ name: t.name.toUpperCase(), idx: t.idx }));
  $('floorTabs').innerHTML = tabs.map((t) => {
    const n = mapView.pins.filter((p) => p.floor === t.idx).length;
    return `<button class="floor-tab${t.idx === mapView.floor ? ' active' : ''}" data-floor="${t.idx}">${escapeHtml(t.name)}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  $('floorTabs').querySelectorAll('.floor-tab').forEach((b) => {
    b.addEventListener('click', () => { mapView.floor = Number(b.dataset.floor); mapView.selected = null; drawMap(); });
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
  const baseEl = svg.querySelector(`#${CSS.escape(md.baseLayer)}`);
  const selLayer = mapView.floor >= 0 && md.floors[mapView.floor] ? md.floors[mapView.floor].svgLayer : null;
  if (baseEl && baseEl.parentNode) {
    for (const el of baseEl.parentNode.children) {
      if (!el.id || el.id === selLayer || el.style.display === 'none') continue;
      el.style.opacity = selLayer ? '.28' : '';
    }
  }

  const old = svg.querySelector('#qpins');
  if (old) old.remove();
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('id', 'qpins');

  // The map's rotation is baked into the SVG at load time (see openQuestMap),
  // so everything below is placed in the coordinates the user actually sees —
  // no per-element counter-rotation, and it works for Factory's 90° too.
  const k = svgUnitsPerPx(svg, md);

  // faint landmark names for orientation
  for (const [lx, lz, text] of md.labels || []) {
    const p = mapPoint(md, lx, lz);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', p.x); t.setAttribute('y', p.y);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('style', `font:600 ${10 * k}px Bender,sans-serif;fill:#cfccc3;opacity:.45;stroke:#000;stroke-width:${2.5 * k};paint-order:stroke;pointer-events:none`);
    t.textContent = text;
    g.appendChild(t);
  }

  const shown = mapView.pins.filter((p) => p.floor === mapView.floor);
  shown.forEach((p, i) => {
    const s = mapPoint(md, p.x, p.z);
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', 6.5 * k);
    c.setAttribute('class', 'qpin-dot' + (mapView.selected === i ? ' sel' : ''));
    c.setAttribute('stroke-width', 2 * k);
    if (p.locked) c.setAttribute('opacity', '.5');
    // clicking the selected pin again clears it
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      mapView.selected = (mapView.selected === i) ? null : i;
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

  svg.appendChild(g);
  // after g is in the document, so the card can measure itself
  const sel = mapView.selected != null ? shown[mapView.selected] : null;
  if (sel) pinCard(md, sel, g, k);

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
  const vb = currentView(md);                     // clamp the card to what is on screen
  const pin = mapPoint(md, p.x, p.z);

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
  const md = MAP_DATA[mapName];
  mapView.name = mapName;
  mapView.floor = -1;
  mapView.selected = null;
  mapView.pins = collectMapPins(mapName);
  renderMapLoadout(mapName);
  resetMapView();
  $('mapTitle').textContent = mapName.toUpperCase();
  $('mapCredit').innerHTML = 'Map by Shebuka · tarkov-dev-svg-maps · CC BY-NC-SA 4.0';
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
    const vb = rotatedViewBox(md);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    svg.style.transform = '';
  }
  drawMap();
}

// clicking the map away from a pin also clears the selection (pins stop propagation)
$('mapStage').addEventListener('click', () => {
  if (mapView.selected != null) { mapView.selected = null; drawMap(); }
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
let mapResizeTimer = null;
window.addEventListener('resize', () => {
  if ($('mapOverlay').classList.contains('hidden') || !mapView.name) return;
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    if (!$('mapOverlay').classList.contains('hidden')) drawMap();
  }, 120);
});
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
  state.filter = ['ALL', 'KAPPA', 'LIGHTKEEPER'].includes(init.settings.filter) ? init.settings.filter : 'ALL';
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
    applyMode();
  }
  renderAll();
  document.fonts.ready.then(fitSidebarWidth);
})();
