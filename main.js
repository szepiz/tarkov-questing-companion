const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR = __dirname;
// Read-only quest data shipped inside the app bundle (first-run + offline seed).
const BUNDLED_CACHE = path.join(APP_DIR, 'quests_cache.json');
const DEFAULT_LOGS_PATH = 'C:\\Battlestate Games\\EFT\\Logs';
const API_URL = 'https://api.tarkov.dev/graphql';
const POLL_MS = 5000;
const MODES = ['regular', 'pve']; // EFT has two separate profiles: PvP (regular) and PvE

// User-writable storage, resolved after the app is ready (see initStorage).
let SETTINGS_FILE, PROGRESS_FILE, CACHE_FILE;

// ---------- json helpers ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

// ---------- settings / progress ----------

const DEFAULT_SETTINGS = {
  trackingMode: 'manual', // 'manual' | 'auto'
  logsPath: DEFAULT_LOGS_PATH,
  filter: 'ALL',          // last selected tab
  gameMode: 'regular',    // 'regular' (PvP) | 'pve' — which profile is being viewed
  modeAutoResolved: false, // has the initial "open on the populated mode" decision been made
  hideCompleted: false,   // hide completed quests from the list
  hideLocked: false,      // hide locked quests from the list (auto mode only)
};

// progress is per game mode:
//   progress[mode] = { completed: {[taskId]:{via,at}}, failed: {[taskId]:{at}}, resetAt }
// resetAt = epoch ms of the last full reset for that mode (auto tracking ignores
// sessions older than this — lets the user start over after a wipe).
let settings;
let progress;

function emptyBucket() { return { completed: {}, failed: {}, resetAt: 0 }; }

function normalizeProgress(p) {
  if (p && (p.regular || p.pve)) {
    for (const m of MODES) {
      if (!p[m]) p[m] = emptyBucket();
      if (!p[m].completed) p[m].completed = {};
      if (!p[m].failed) p[m].failed = {};
      if (!p[m].resetAt) p[m].resetAt = 0;
    }
    return p;
  }
  // legacy flat progress (single mixed list) -> keep it under "regular" and flag
  // for a one-time mode-aware re-derivation from the logs.
  const bucket = {
    completed: (p && p.completed) || {},
    failed: (p && p.failed) || {},
    resetAt: (p && p.resetAt) || 0,
  };
  return { regular: bucket, pve: emptyBucket(), pendingModeSplit: true };
}

function initStorage() {
  const dir = app.getPath('userData');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  SETTINGS_FILE = path.join(dir, 'settings.json');
  PROGRESS_FILE = path.join(dir, 'progress.json');
  CACHE_FILE = path.join(dir, 'quests_cache.json');
  // migrate data from older builds that stored these next to the app
  const legacySettings = readJson(path.join(APP_DIR, 'settings.json'), null);
  const legacyProgress = readJson(path.join(APP_DIR, 'progress.json'), null);
  settings = { ...DEFAULT_SETTINGS, ...(readJson(SETTINGS_FILE, null) || legacySettings || {}) };
  if (!MODES.includes(settings.gameMode)) settings.gameMode = 'regular';
  progress = normalizeProgress(readJson(PROGRESS_FILE, null) || legacyProgress);
}

function saveSettings() { writeJson(SETTINGS_FILE, settings); }
function saveProgress() { writeJson(PROGRESS_FILE, progress); }

// ---------- quest data ----------

// Verified live against api.tarkov.dev. Task `id` is the BSG MongoDB id — the
// same id that appears in the game's notifications log. Fetched per game mode
// because PvE and PvP have slightly different quest lists.
const TASK_FIELDS = `
    id
    name
    kappaRequired
    lightkeeperRequired
    minPlayerLevel
    wikiLink
    trader { name }
    map { name }
    taskRequirements { task { id name } status }
    objectives {
      id
      type
      description
      optional
      maps { name }
      ... on TaskObjectiveItem { items { name } count foundInRaid requiredKeys { name } }
      ... on TaskObjectiveQuestItem { requiredKeys { name } }
      ... on TaskObjectiveShoot { requiredKeys { name } }
      ... on TaskObjectiveExtract { requiredKeys { name } }
      ... on TaskObjectiveMark { requiredKeys { name } }
      ... on TaskObjectiveBasic { requiredKeys { name } }
      ... on TaskObjectiveUseItem { requiredKeys { name } }
      ... on TaskObjectiveBuildItem { item { name } }
    }`;
const TASKS_QUERY = `{
  regular: tasks(lang: en, gameMode: regular) { ${TASK_FIELDS} }
  pve: tasks(lang: en, gameMode: pve) { ${TASK_FIELDS} }
}`;

async function fetchTasksOnline() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TASKS_QUERY }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL error: ' + JSON.stringify(json.errors).slice(0, 300));
    const data = json.data || {};
    if (!Array.isArray(data.regular) || !data.regular.length) throw new Error('API returned no tasks');
    return { regular: data.regular, pve: Array.isArray(data.pve) ? data.pve : [] };
  } finally {
    clearTimeout(timeout);
  }
}

// accept both the new {regular,pve} cache shape and the old {tasks} one
function cacheToModes(cache) {
  if (!cache) return null;
  if (Array.isArray(cache.regular) && cache.regular.length) {
    return { regular: cache.regular, pve: Array.isArray(cache.pve) ? cache.pve : [] };
  }
  if (Array.isArray(cache.tasks) && cache.tasks.length) {
    return { regular: cache.tasks, pve: cache.tasks }; // old single-mode cache
  }
  return null;
}

async function loadTasks() {
  try {
    const modes = await fetchTasksOnline();
    writeJson(CACHE_FILE, { fetchedAt: Date.now(), regular: modes.regular, pve: modes.pve });
    return { ...modes, source: 'online', fetchedAt: Date.now() };
  } catch (err) {
    for (const f of [CACHE_FILE, BUNDLED_CACHE]) {
      const modes = cacheToModes(readJson(f, null));
      if (modes) {
        const cache = readJson(f, {});
        return { ...modes, source: 'cache', fetchedAt: cache.fetchedAt, error: String(err.message || err) };
      }
    }
    return { regular: null, pve: null, source: 'none', error: String(err.message || err) };
  }
}

// ---------- game install auto-detection (registry, like TarkovMonitor) ----------

function regInstallLocation(key) {
  try {
    const out = execSync(`reg query "${key}" /v InstallLocation`, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function detectLogsPath() {
  const bsg = regInstallLocation('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov');
  if (bsg) {
    const p = path.join(bsg, 'Logs');
    if (fs.existsSync(p)) return p;
  }
  const steam = regInstallLocation('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890');
  if (steam) {
    const p = path.join(steam, 'build', 'Logs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------- log watcher (automatic tracking) ----------

let win = null;
let watchTimer = null;
const fileSizes = new Map();   // notif file -> last seen size
const segCache = new Map();    // application log path -> { size, segments }
let watcherStatus = {
  active: false,
  logsFound: false,
  sessionFolders: 0,
  lastScan: 0,
  eventsFound: 0,
};

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// "YYYY-MM-DD HH:MM:SS.fff" -> epoch ms, interpreted in local time (same
// machine/timezone as Date.now(), so it is comparable with a mode's resetAt).
function parseLogTs(s) {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime();
}

// session folder names look like log_2026.07.16_21-10-05_0.16.5.0.37972
function sessionFolderTime(name) {
  const m = name.match(/^log_(\d{4})\.(\d{2})\.(\d{2})_(\d+)-(\d+)-(\d+)/i);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// A single log folder can hold BOTH modes: EFT lets you switch PvE<->PvP from
// the menu without relaunching, writing a new "Session mode: <Pve|Regular>"
// line to application.log each time. We read those lines (with timestamps) to
// know which mode was active at any moment, then attribute each completion to
// the mode active at its timestamp.
function folderModeSegments(dir) {
  let appFile = null;
  let inner;
  try { inner = fs.readdirSync(dir); } catch { return []; }
  for (const f of inner) {
    const lf = f.toLowerCase();
    if (lf.includes('application') && lf.endsWith('.log')) { appFile = path.join(dir, f); break; }
  }
  if (!appFile) return [];
  let stat;
  try { stat = fs.statSync(appFile); } catch { return []; }
  const cached = segCache.get(appFile);
  if (cached && cached.size === stat.size) return cached.segments;
  let text;
  try { text = fs.readFileSync(appFile, 'utf8'); } catch { return []; }
  const segs = [];
  const re = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})[^\n]*Session mode:\s*(\w+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ts = parseLogTs(m[1]);
    if (ts !== null) segs.push({ ts, mode: /pve/i.test(m[2]) ? 'pve' : 'regular' });
  }
  segs.sort((a, b) => a.ts - b.ts);
  segCache.set(appFile, { size: stat.size, segments: segs });
  return segs;
}

function modeAtTime(segs, ts) {
  if (!segs.length) return 'regular';
  if (ts === null) return segs[0].mode;
  let mode = segs[0].mode; // before the first marker, assume the first session's mode
  for (const s of segs) {
    if (s.ts <= ts) mode = s.mode; else break;
  }
  return mode;
}

// Quest events in notifications.log: a "ChatMessageReceived" JSON block with
// message.type 12 (TaskFinished) / 11 (TaskFailed) whose templateId is
// "<questId> successMessageText" / "failMessageText". We track the preceding
// log-line timestamp so each event can be attributed to a mode.
function parseQuestEventsWithTime(text) {
  const events = [];
  const tsRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
  const tmplRe = /"templateId"\s*:\s*"([a-f0-9]{24}) (successMessageText|failMessageText)"/;
  let curTs = null;
  for (const line of text.split('\n')) {
    const tm = tsRe.exec(line);
    if (tm) curTs = parseLogTs(tm[1]);
    const em = tmplRe.exec(line);
    if (em) events.push({ questId: em[1], kind: em[2] === 'successMessageText' ? 'success' : 'fail', ts: curTs });
  }
  return events;
}

function listSessionFolders(logsPath) {
  let entries;
  try { entries = fs.readdirSync(logsPath, { withFileTypes: true }); } catch { return null; }
  const folders = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.toLowerCase().startsWith('log_')) continue;
    folders.push({ dir: path.join(logsPath, e.name), startTs: sessionFolderTime(e.name) });
  }
  return folders;
}

let triedDetection = false;
let isInitialScan = true;

function scanLogs() {
  let folders = listSessionFolders(settings.logsPath);
  watcherStatus.lastScan = Date.now();
  if (folders === null && !triedDetection) {
    triedDetection = true;
    const detected = detectLogsPath();
    if (detected && detected !== settings.logsPath) {
      settings.logsPath = detected;
      saveSettings();
      sendToRenderer('settings-changed', settings);
      folders = listSessionFolders(settings.logsPath);
    }
  }
  if (folders === null) {
    watcherStatus.logsFound = false;
    watcherStatus.sessionFolders = 0;
    sendToRenderer('watcher-status', watcherStatus);
    return { regular: 0, pve: 0 };
  }
  watcherStatus.logsFound = true;
  watcherStatus.sessionFolders = folders.length;

  // The newest folder is the (possibly still-running) session whose
  // application.log may not have flushed its "Session mode:" line yet — for it
  // we defer attribution until the marker appears rather than guessing.
  let newestTs = -Infinity;
  for (const f of folders) if (f.startTs !== null && f.startTs > newestTs) newestTs = f.startTs;
  folders.sort((a, b) => (a.startTs || 0) - (b.startTs || 0)); // chronological

  const newByMode = { regular: [], pve: [] };
  let anyFail = false;
  let lastKnownMode = 'regular'; // a markerless session inherits the mode around it
  for (const folder of folders) {
    let inner;
    try { inner = fs.readdirSync(folder.dir); } catch { continue; }
    const notifFiles = inner
      .filter((f) => f.toLowerCase().includes('notifications') && f.toLowerCase().endsWith('.log'))
      .map((f) => path.join(folder.dir, f));
    if (!notifFiles.length) continue;

    let changed = false;
    const texts = [];
    for (const nf of notifFiles) {
      let stat;
      try { stat = fs.statSync(nf); } catch { continue; }
      if (fileSizes.get(nf) !== stat.size) { changed = true; fileSizes.set(nf, stat.size); }
      let t;
      try { t = fs.readFileSync(nf, 'utf8'); } catch { continue; }
      texts.push(t);
    }
    if (!changed) continue; // nothing new in this folder

    const segs = folderModeSegments(folder.dir);
    if (segs.length) lastKnownMode = segs[segs.length - 1].mode;
    const isNewest = folder.startTs !== null && folder.startTs === newestTs;
    for (const text of texts) {
      for (const ev of parseQuestEventsWithTime(text)) {
        watcherStatus.eventsFound++;
        let mode;
        if (segs.length) mode = modeAtTime(segs, ev.ts);
        else if (isNewest) continue;  // marker not flushed yet — retry on a later scan
        else mode = lastKnownMode;    // old session with no marker — inherit nearby mode
        const bucket = progress[mode];
        // per-mode reset cut-off, per event (so resetting mid-session only drops
        // completions from BEFORE the reset, not the rest of the session)
        const evTs = ev.ts !== null ? ev.ts : folder.startTs;
        if (bucket.resetAt && evTs !== null && evTs < bucket.resetAt) continue;
        if (ev.kind === 'success') {
          // dedup is PER MODE on purpose — the same quest can be completed
          // independently in PvP and PvE (separate profiles)
          if (!bucket.completed[ev.questId]) {
            bucket.completed[ev.questId] = { via: 'auto', at: Date.now() };
            newByMode[mode].push(ev.questId);
          }
        } else if (!bucket.failed[ev.questId]) {
          bucket.failed[ev.questId] = { at: Date.now() };
          anyFail = true;
        }
      }
    }
  }

  const total = newByMode.regular.length + newByMode.pve.length;
  if (total || anyFail) {
    saveProgress();
    sendToRenderer('auto-completions', { newByMode, progress, initial: isInitialScan });
  }
  isInitialScan = false;
  sendToRenderer('watcher-status', watcherStatus);
  return { regular: newByMode.regular.length, pve: newByMode.pve.length };
}

// Drop auto-detected entries (keeping manual ticks) so a fresh mode-aware scan
// can re-derive them into the correct per-mode buckets.
function clearAutoEntries() {
  for (const m of MODES) {
    for (const id of Object.keys(progress[m].completed)) {
      if (progress[m].completed[id].via === 'auto') delete progress[m].completed[id];
    }
    progress[m].failed = {};
  }
}

function startWatcher() {
  stopWatcher();
  watcherStatus.active = true;
  watcherStatus.eventsFound = 0;
  triedDetection = false;
  isInitialScan = true;
  fileSizes.clear();
  segCache.clear();
  // first launch after upgrading a legacy (single-list) profile: re-derive
  // auto completions into the correct PvE/PvP buckets from the logs
  if (progress.pendingModeSplit) {
    clearAutoEntries();
    for (const m of MODES) progress[m].resetAt = 0;
    delete progress.pendingModeSplit;
    saveProgress();
  }
  scanLogs(); // full catch-up scan of every session folder
  watchTimer = setInterval(scanLogs, POLL_MS);
  sendToRenderer('watcher-status', watcherStatus);
}

function stopWatcher() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  watcherStatus.active = false;
  sendToRenderer('watcher-status', watcherStatus);
}

function syncWatcherToSettings() {
  if (settings.trackingMode === 'auto') startWatcher();
  else stopWatcher();
}

// ---------- ipc ----------

ipcMain.handle('get-init', () => ({ settings, progress, watcherStatus }));

ipcMain.handle('load-tasks', async () => loadTasks());

ipcMain.handle('set-game-mode', (_e, mode) => {
  if (MODES.includes(mode)) settings.gameMode = mode;
  settings.modeAutoResolved = true; // a mode has been chosen — stop auto-switching
  saveSettings();
  return settings;
});

ipcMain.handle('save-settings', (_e, patch) => {
  const prevMode = settings.trackingMode;
  const prevPath = settings.logsPath;
  settings = { ...settings, ...patch };
  saveSettings();
  if (settings.trackingMode !== prevMode || settings.logsPath !== prevPath) {
    syncWatcherToSettings();
  }
  return settings;
});

ipcMain.handle('toggle-task', (_e, { taskId, done, mode }) => {
  const bucket = progress[MODES.includes(mode) ? mode : settings.gameMode];
  if (done) bucket.completed[taskId] = { via: 'manual', at: Date.now() };
  else delete bucket.completed[taskId];
  saveProgress();
  return progress;
});

ipcMain.handle('reset-progress', (_e, mode) => {
  const m = MODES.includes(mode) ? mode : settings.gameMode;
  progress[m] = { completed: {}, failed: {}, resetAt: Date.now() };
  saveProgress();
  syncWatcherToSettings(); // restart so the watcher forgets offsets, honors resetAt
  return progress;
});

// "Re-scan all logs": undo any reset and rebuild auto completions for BOTH modes
// from the full log history. Keeps manual ticks; re-attributes by mode.
ipcMain.handle('rescan-all', () => {
  const hadReset = MODES.some((m) => progress[m].resetAt);
  const count = (which) => MODES.reduce((n, m) => n + Object.keys(progress[m][which]).length, 0);
  clearAutoEntries();
  for (const m of MODES) progress[m].resetAt = 0;
  delete progress.pendingModeSplit;
  saveProgress();
  const before = count('completed');
  const beforeFails = count('failed');
  fileSizes.clear();
  segCache.clear();
  isInitialScan = true;
  if (settings.trackingMode === 'auto') startWatcher();
  else scanLogs();
  return {
    progress,
    imported: count('completed') - before,
    failsImported: count('failed') - beforeFails,
    hadReset,
    logsFound: watcherStatus.logsFound,
  };
});

ipcMain.handle('browse-logs', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select the EFT Logs folder',
    defaultPath: settings.logsPath,
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('open-wiki', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\/(escapefromtarkov\.fandom\.com|www\.escapefromtarkov\.wiki)\//.test(url)) {
    shell.openExternal(url);
  }
});

// ---------- window ----------

function createWindow() {
  const shooting = !!process.env.TQT_SHOOT;
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    title: 'Tarkov Quest Tracker',
    show: !shooting,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: shooting,
    },
  });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  win.webContents.on('did-finish-load', () => syncWatcherToSettings());

  // dev aid: TQT_SHOOT=<file.png> drives the UI to a demo state, captures, exits
  if (process.env.TQT_SHOOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const shoot = async (file) => {
            const img = await win.webContents.capturePage();
            fs.writeFileSync(file, img.toPNG());
            console.log('TQT_SHOOT wrote', file, JSON.stringify(img.getSize()));
          };
          await win.webContents.executeJavaScript(`(() => {
            document.querySelector('.tab[data-filter="KAPPA"]').click();
            const customs = [...document.querySelectorAll('.map-row')].find(r => r.textContent.includes('CUSTOMS'));
            if (customs) customs.click();
            const prapor = [...document.querySelectorAll('.trader-row')].find(r => r.textContent.includes('PRAPOR'));
            if (prapor) prapor.click();
          })()`);
          await new Promise((r) => setTimeout(r, 400));
          await win.webContents.executeJavaScript(`(() => {
            const lockedRow = document.querySelector('.quest-row.locked .quest-name');
            const names = [...document.querySelectorAll('.quest-row .quest-name')];
            const target = lockedRow || names[1] || names[0];
            if (target) target.click();
          })()`);
          await new Promise((r) => setTimeout(r, 900));
          await shoot(process.env.TQT_SHOOT);
          await win.webContents.executeJavaScript(`document.getElementById('settingsBtn').click(); document.getElementById('modeAuto').click();`);
          await new Promise((r) => setTimeout(r, 900));
          await shoot(process.env.TQT_SHOOT.replace('.png', '_settings.png'));
          const asserts = await win.webContents.executeJavaScript(`(() => {
            document.getElementById('closeSettingsBtn').click();
            document.querySelector('.tab[data-filter="ALL"]').click();
            for (let pass = 0; pass < 2; pass++) {
              [...document.querySelectorAll('.map-row .row-toggle')].forEach(t => { if (t.textContent === '+') t.parentElement.click(); });
              [...document.querySelectorAll('.trader-row .row-toggle')].forEach(t => { if (t.textContent === '+') t.parentElement.click(); });
            }
            const names = [...document.querySelectorAll('.quest-row .quest-name')];
            const truncated = names.filter(n => n.scrollWidth > n.clientWidth).map(n => n.textContent);
            return {
              mode: document.querySelector('.mode-switch .on') ? document.querySelector('.mode-switch .on').textContent : '?',
              sidebarWidth: document.getElementById('sidebar').style.width,
              questRows: names.length,
              lockedRows: document.querySelectorAll('.quest-row.locked').length,
              truncatedCount: truncated.length,
              truncatedSample: truncated.slice(0, 5),
            };
          })()`);
          console.log('TQT_ASSERT', JSON.stringify(asserts));
          // exercise the PvP/PvE toggle and confirm the list swaps
          const toggle = await win.webContents.executeJavaScript(`(() => {
            const before = document.querySelectorAll('.map-row').length && [...document.querySelectorAll('.map-row')].reduce((n,r)=>n,0);
            const pvp = document.querySelector('.mode-btn-top[data-mode="regular"]');
            if (pvp) pvp.click();
            const regRows = document.querySelectorAll('.quest-row .quest-name, .map-row').length;
            const regMode = document.querySelector('.mode-btn-top.on').textContent;
            // count total quests in the regular list from state via the tree totals
            return { afterClickMode: regMode };
          })()`);
          console.log('TQT_TOGGLE', JSON.stringify(toggle));
          // verify the hide-completed / hide-locked display toggles
          await win.webContents.executeJavaScript(`(() => {
            const pve = document.querySelector('.mode-btn-top[data-mode="pve"]');
            if (pve) pve.click();
            document.getElementById('settingsBtn').click();
            document.getElementById('hideCompletedBtn').click();
            document.getElementById('hideLockedBtn').click();
          })()`);
          await new Promise((r) => setTimeout(r, 600));
          const hideChk = await win.webContents.executeJavaScript(`(() => {
            document.getElementById('closeSettingsBtn').click();
            for (let pass = 0; pass < 2; pass++) {
              [...document.querySelectorAll('.map-row .row-toggle')].forEach(t => { if (t.textContent === '+') t.parentElement.click(); });
              [...document.querySelectorAll('.trader-row .row-toggle')].forEach(t => { if (t.textContent === '+') t.parentElement.click(); });
            }
            return {
              hideCompletedOn: document.getElementById('hideCompletedBtn').classList.contains('on'),
              hideLockedOn: document.getElementById('hideLockedBtn').classList.contains('on'),
              visibleRows: document.querySelectorAll('.quest-row').length,
              completedVisible: document.querySelectorAll('.quest-row.completed').length,
              lockedVisible: document.querySelectorAll('.quest-row.locked').length,
            };
          })()`);
          console.log('TQT_HIDE', JSON.stringify(hideChk));
        } catch (err) {
          console.error('TQT_SHOOT failed:', err);
        }
        app.quit();
      }, 6000);
    });
  }
}

app.whenReady().then(() => {
  initStorage();
  createWindow();
});
app.on('window-all-closed', () => {
  stopWatcher();
  app.quit();
});
