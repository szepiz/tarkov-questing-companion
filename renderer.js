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
    resetProgress: async (mode) => { store.progress[['regular', 'pve'].includes(mode) ? mode : store.settings.gameMode] = { completed: {}, failed: {}, resetAt: Date.now() }; persist(); return store.progress; },
    rescanAll: async () => ({ progress: store.progress, imported: 0, failsImported: 0, hadReset: false, logsFound: false }),
    browseLogs: async () => null,
    openWiki: async (url) => window.open(url),
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
  state.progress = state.fullProgress[m] || { completed: {}, failed: {}, resetAt: 0 };
  if (!state.progress.completed) state.progress.completed = {};
  if (!state.progress.failed) state.progress.failed = {};
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
    // "active": the prereq must be accepted/in progress. A failed prereq is
    // terminal (can never be active again), so it does NOT satisfy an active
    // requirement — otherwise a mutually-exclusive branch you failed would
    // wrongly unlock its sibling branch.
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
      const locked = locking ? new Map(list.map((t) => [t.id, isLocked(t) ? 1 : 0])) : null;
      list.sort((a, b) =>
        (locked ? locked.get(a.id) - locked.get(b.id) : 0) ||
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
  const hiding = hideC || hideL;
  const isVisible = (t) => !(hideC && isDone(t.id)) && !(hideL && isLocked(t));

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
      <span class="row-count${mapDone === mapTotal ? ' done' : ''}">${mapDone}/${mapTotal}</span>`;
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
        const locked = isLocked(t);
        const row = document.createElement('div');
        row.className = 'quest-row' +
          (done ? ' completed' : '') +
          (locked ? ' locked' : '') +
          (state.selQuestId === t.id ? ' selected' : '');
        const checkTitle = done ? 'mark as not completed'
          : locked ? 'locked — prerequisite quests not completed (you can still tick it manually)'
          : 'mark as completed';
        row.innerHTML = `
          <span class="quest-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name.toUpperCase())}</span>
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
    heroMap.classList.add('narrow');
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
    heroMap.classList.remove('narrow');
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
  if (isLocked(t)) badges.push('<span class="badge locked">LOCKED</span>');
  if (t.kappaRequired) badges.push('<span class="badge kappa">KAPPA</span>');
  if (t.lightkeeperRequired) badges.push('<span class="badge lightkeeper">LIGHTKEEPER</span>');
  $('questBadges').innerHTML = badges.join('');

  const metaBits = [];
  if (t.trader && t.trader.name) metaBits.push(`given by ${t.trader.name}`);
  metaBits.push(taskMapLabel(t));
  if (t.minPlayerLevel) metaBits.push(`level ${t.minPlayerLevel}+`);
  $('questMeta').textContent = metaBits.join('  ·  ').toUpperCase();

  // objectives = the quest description
  const objectives = (t.objectives || []).map((o) => `
    <div class="objective${o.optional ? ' optional' : ''}">
      <span class="bullet">▪</span>
      <span>${escapeHtml(o.description || '')}${o.optional ? ' (optional)' : ''}</span>
    </div>`).join('');
  $('questObjectives').innerHTML = objectives ? `<h3>OBJECTIVES</h3>${objectives}` : '';

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
  for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked']]) {
    const on = !!state.settings[key];
    $(btnId).textContent = on ? 'ON' : 'OFF';
    $(btnId).classList.toggle('on', on);
  }
  const auto = state.settings.trackingMode === 'auto';
  $('hideLockedRow').style.opacity = auto ? '1' : '.45';
  $('displayHint').textContent = auto
    ? 'With both on, the list only shows quests you can take on right now.'
    : 'Hiding locked quests needs AUTOMATIC tracking — that is how the app knows what is locked.';

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
  if (!upd.checked && !upd.checking) doCheckUpdate(false);
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

for (const [btnId, key] of [['hideCompletedBtn', 'hideCompleted'], ['hideLockedBtn', 'hideLocked']]) {
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
  if (data.initial && mineIds.length > 3) {
    toast(`Imported ${mineIds.length} completed ${modeLabel(state.gameMode)} quests from your logs`);
  } else if (mineIds.length) {
    for (const n of names.slice(0, 5)) toast(`Quest completed: ${n}`);
    if (names.length > 5) toast(`…and ${names.length - 5} more`);
  }
  if (data.initial && otherCount > 0 && mineIds.length === 0) {
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

// ---------- updates ----------

const upd = {
  current: '', checked: false, checking: false, error: null,
  available: false, latest: '', notes: '', canApply: false,
  downloading: false, downloadFailed: false, staged: false, progress: 0, phase: '',
};

function renderUpdateSection() {
  if (!$('updateStatus')) return;
  const status = $('updateStatus');
  $('updateVersion').textContent = upd.current ? `Current version: ${upd.current}` : '';

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
    status.innerHTML = `<span class="bad">Couldn't check for updates.</span>`;
  } else if (!upd.available) {
    status.innerHTML = `<span class="ok">You're on the latest version.</span>`;
  } else if (!upd.canApply) {
    status.innerHTML = `<span class="ok">Update available: v${escapeHtml(upd.latest)}.</span> Download it from the GitHub Releases page (one-click install works in the packaged app).`;
  } else {
    status.innerHTML = `<span class="ok">Update available: v${escapeHtml(upd.latest)}.</span> Your progress won't be affected.`;
  }

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
  if (userInitiated && r.error) toast("Couldn't reach GitHub to check for updates.");
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
  toast(`Update available: v${r.latest} — open Settings to install.`);
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
