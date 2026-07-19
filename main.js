const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const APP_DIR = __dirname;
const REPO = 'szepiz/tarkov-questing-companion';
const OLD_PRODUCT_NAME = 'Tarkov Quest Tracker'; // pre-rebrand userData folder
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
  // a fresh install has no progress at all — start clean, NOT flagged as legacy
  if (!p || typeof p !== 'object' || !p.completed || !Object.keys(p.completed).length) {
    return { regular: emptyBucket(), pve: emptyBucket() };
  }
  // genuine legacy flat progress (single mixed list) -> keep it under "regular"
  // and flag for a one-time mode-aware re-derivation from the logs.
  return {
    regular: { completed: p.completed, failed: p.failed || {}, resetAt: p.resetAt || 0 },
    pve: emptyBucket(),
    pendingModeSplit: true,
  };
}

function initStorage() {
  const dir = app.getPath('userData');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  SETTINGS_FILE = path.join(dir, 'settings.json');
  PROGRESS_FILE = path.join(dir, 'progress.json');
  CACHE_FILE = path.join(dir, 'quests_cache.json');
  const ownSettings = readJson(SETTINGS_FILE, null);
  const ownProgress = readJson(PROGRESS_FILE, null);
  // migrate legacy data ONLY when this location is brand new (neither file yet),
  // so we never resurrect old data over what the user has here
  const freshLocation = !ownSettings && !ownProgress;
  let legacySettings = null, legacyProgress = null;
  if (freshLocation) {
    const oldUserDir = path.join(app.getPath('appData'), OLD_PRODUCT_NAME);
    legacySettings = readJson(path.join(oldUserDir, 'settings.json'), null)
      || readJson(path.join(APP_DIR, 'settings.json'), null);
    legacyProgress = readJson(path.join(oldUserDir, 'progress.json'), null)
      || readJson(path.join(APP_DIR, 'progress.json'), null);
  }
  settings = { ...DEFAULT_SETTINGS, ...(ownSettings || legacySettings || {}) };
  if (!MODES.includes(settings.gameMode)) settings.gameMode = 'regular';
  progress = normalizeProgress(ownProgress || legacyProgress);
  // persist the migrated data into the new location so it is owned here going forward
  if (freshLocation && (legacySettings || legacyProgress)) {
    try { saveSettings(); saveProgress(); } catch {}
  }
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
      ... on TaskObjectiveItem { items { name } count foundInRaid requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveQuestItem {
        requiredKeys { name }
        zones { map { name } position { x y z } }
        possibleLocations { map { name } positions { x y z } }
      }
      ... on TaskObjectiveShoot { requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveExtract { requiredKeys { name } }
      ... on TaskObjectiveMark { requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveBasic { requiredKeys { name } zones { map { name } position { x y z } } }
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

// ---------- auto-update from GitHub Releases ----------

// TQC_FAKE_VERSION lets tests pretend to be an older build to exercise the flow
function currentVersion() { return process.env.TQC_FAKE_VERSION || app.getVersion(); }

// compare dotted versions; returns -1 if a<b, 0 if equal, 1 if a>b
function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

let updateInfo = null;       // { version, notes, url, size, assetName }
let stagedUpdateDir = null;  // extracted new build, ready to swap in on quit

async function checkForUpdate() {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TarkovQuestingCompanion' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    const rel = await res.json();
    const tag = String(rel.tag_name || '');
    const asset = (rel.assets || []).find((a) => /\.zip$/i.test(a.name || ''));
    const latest = tag.replace(/^v/i, '');
    const available = !!asset && cmpVersion(currentVersion(), tag) < 0;
    updateInfo = available
      ? { version: latest, notes: rel.body || '', url: asset.browser_download_url, size: asset.size, assetName: asset.name }
      : null;
    return { available, current: currentVersion(), latest, notes: rel.body || '', canApply: app.isPackaged };
  } finally {
    clearTimeout(to);
  }
}

function installDir() { return path.dirname(app.getPath('exe')); }

// probe whether we can write into the install folder (fails under Program Files)
function installWritable() {
  try {
    const probe = path.join(installDir(), '.tqc-write-test');
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe, { force: true });
    return true;
  } catch { return false; }
}

// remove a leftover backup folder from a previous (finished) update
function cleanupStaleUpdate() {
  if (!app.isPackaged) return;
  try {
    const bak = installDir().replace(/[\\/]+$/, '') + '.bak-update';
    if (fs.existsSync(bak)) fs.rmSync(bak, { recursive: true, force: true });
  } catch {}
}

async function downloadUpdate() {
  if (!updateInfo) throw new Error('no update to download');
  if (!app.isPackaged) throw new Error('updates only apply to the packaged app');
  if (!installWritable()) {
    throw new Error('this folder is read-only (e.g. Program Files) — move the app to a normal folder like Downloads, then update');
  }
  const tmp = path.join(os.tmpdir(), 'tqc-update');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmp, { recursive: true });
  const zipPath = path.join(tmp, 'update.zip');

  const res = await fetch(updateInfo.url, { headers: { 'User-Agent': 'TarkovQuestingCompanion' } });
  if (!res.ok) throw new Error('download failed (HTTP ' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || updateInfo.size || 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    out.on('error', reject);
    const reader = res.body.getReader();
    let got = 0;
    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (total) sendToRenderer('update-progress', { phase: 'download', pct: Math.round((got / total) * 100) });
      }
      if (total && got < total) throw new Error('incomplete download');
      out.end(resolve);
    })().catch((e) => { out.destroy(); reject(e); });
  });
  if (fs.statSync(zipPath).size < 1024) throw new Error('downloaded file is not a valid update');

  sendToRenderer('update-progress', { phase: 'extract', pct: 100 });
  const extractDir = path.join(tmp, 'new');
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  execSync(
    `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory([Environment]::GetEnvironmentVariable('TQC_ZIP'),[Environment]::GetEnvironmentVariable('TQC_DEST'))"`,
    { windowsHide: true, env: { ...process.env, TQC_ZIP: zipPath, TQC_DEST: extractDir } }
  );
  // the zip has one top-level app folder; descend into it if so
  const dirs = fs.readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const root = dirs.length === 1 && !fs.existsSync(path.join(extractDir, path.basename(app.getPath('exe'))))
    ? path.join(extractDir, dirs[0].name)
    : extractDir;
  if (!fs.readdirSync(root).some((f) => f.toLowerCase().endsWith('.exe'))) {
    throw new Error('update package has no .exe');
  }
  stagedUpdateDir = root;
  sendToRenderer('update-progress', { phase: 'ready', pct: 100 });
  return { staged: true, version: updateInfo.version };
}

// Write a helper batch that waits for us to exit, backs up the current install,
// mirrors the new build in, and rolls back on failure — then quit. Rollback +
// exit-code checking mean a failed copy restores the working app instead of
// leaving a half-updated (broken) one.
function applyUpdateAndRestart() {
  if (!stagedUpdateDir) throw new Error('nothing staged');
  if (!app.isPackaged) throw new Error('updates only apply to the packaged app');
  const install = installDir();
  const exeName = path.basename(app.getPath('exe'));
  const backup = install.replace(/[\\/]+$/, '') + '.bak-update';
  const tempDir = path.join(os.tmpdir(), 'tqc-update');
  const batPath = path.join(os.tmpdir(), 'tqc-apply-update.bat');
  const q = (s) => `"${s}"`;
  const RC = '/R:5 /W:2 /NFL /NDL /NJH /NJS /NC /NS';
  const bat = [
    '@echo off',
    'setlocal EnableExtensions',
    'set /a N=0',
    ':waitloop',
    `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
    'if errorlevel 1 goto gone',
    'set /a N+=1',
    'if %N% GEQ 90 goto done', // app never exited (~90s) — bail without touching files
    'timeout /t 1 /nobreak >nul',
    'goto waitloop',
    ':gone',
    'timeout /t 2 /nobreak >nul',            // let helper processes / AV release file locks
    `robocopy ${q(install)} ${q(backup)} /MIR ${RC} >nul`,   // backup current install
    `robocopy ${q(stagedUpdateDir)} ${q(install)} /MIR ${RC} >nul`, // install new build
    'if errorlevel 8 goto rollback',         // robocopy >=8 = real failure
    `start "" ${q(path.join(install, exeName))}`,
    `rmdir /s /q ${q(backup)} >nul 2>&1`,
    `rmdir /s /q ${q(tempDir)} >nul 2>&1`,
    'goto done',
    ':rollback',
    `robocopy ${q(backup)} ${q(install)} /MIR ${RC} >nul`,   // restore the working version
    `start "" ${q(path.join(install, exeName))}`,
    `rmdir /s /q ${q(backup)} >nul 2>&1`,     // keep the staged copy for a retry
    ':done',
    'del "%~f0" >nul 2>&1',
    '',
  ].join('\r\n');
  fs.writeFileSync(batPath, bat, 'utf8');
  spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.quit(), 400);
  return { applying: true };
}

// ---------- ipc ----------

ipcMain.handle('get-init', () => ({ settings, progress, watcherStatus, version: currentVersion() }));

ipcMain.handle('check-update', async () => {
  try { return await checkForUpdate(); }
  catch (e) { return { available: false, current: currentVersion(), error: String(e.message || e) }; }
});
ipcMain.handle('download-update', async () => {
  try { return await downloadUpdate(); }
  catch (e) { return { staged: false, error: String(e.message || e) }; }
});
ipcMain.handle('apply-update', () => {
  try { return applyUpdateAndRestart(); }
  catch (e) { return { applying: false, error: String(e.message || e) }; }
});

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

// serve a bundled map SVG to the renderer (file:// fetch is blocked by CSP)
ipcMain.handle('get-map-svg', (_e, file) => {
  if (typeof file !== 'string' || !/^maps[\\/][A-Za-z0-9_-]+\.svg$/.test(file)) return null;
  try { return fs.readFileSync(path.join(APP_DIR, file), 'utf8'); } catch { return null; }
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
    title: 'Tarkov Questing Companion',
    show: !shooting,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: shooting,
    },
  });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  let autoChecked = false;
  win.webContents.on('did-finish-load', () => {
    syncWatcherToSettings();
    if (!autoChecked && !process.env.TQT_SHOOT) {
      autoChecked = true;
      checkForUpdate()
        .then((r) => { if (r.available) sendToRenderer('update-available', r); })
        .catch(() => {});
    }
  });

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
          // exercise the updates section (real GitHub check)
          await win.webContents.executeJavaScript(`document.getElementById('settingsBtn').click();`);
          await new Promise((r) => setTimeout(r, 4000));
          const updChk = await win.webContents.executeJavaScript(`(() => ({
            current: document.getElementById('updateVersion').textContent,
            status: document.getElementById('updateStatus').textContent,
            checkBtnVisible: !document.getElementById('checkUpdateBtn').classList.contains('hidden'),
            installBtnVisible: !document.getElementById('installUpdateBtn').classList.contains('hidden'),
          }))()`);
          console.log('TQT_UPD', JSON.stringify(updChk));
          // open the Customs quest map and report pin placement
          const mapChk = await win.webContents.executeJavaScript(`(async () => {
            document.getElementById('closeSettingsBtn').click();
            document.querySelector('.tab[data-filter="ALL"]').click();
            const customs = [...document.querySelectorAll('.map-row')].find(r => r.textContent.includes('CUSTOMS'));
            const btn = customs && customs.querySelector('.map-btn');
            if (!btn) return { error: 'no map button' };
            btn.click();
            await new Promise(r => setTimeout(r, 1500));
            const svg = document.querySelector('#mapRot svg');
            const pins = document.querySelectorAll('.qpin-dot');
            return {
              overlayOpen: !document.getElementById('mapOverlay').classList.contains('hidden'),
              svgLoaded: !!svg,
              viewBox: svg ? svg.getAttribute('viewBox') : null,
              pinsOnGround: pins.length,
              floorTabs: [...document.querySelectorAll('.floor-tab')].map(t => t.textContent),
              count: document.getElementById('mapPinCount').textContent,
            };
          })()`);
          console.log('TQT_MAP', JSON.stringify(mapChk));
          await new Promise((r) => setTimeout(r, 500));
          await shoot(process.env.TQT_SHOOT.replace('.png', '_map.png'));
          // switch to 2nd floor and click a pin
          const floorChk = await win.webContents.executeJavaScript(`(async () => {
            const t2 = [...document.querySelectorAll('.floor-tab')].find(t => t.textContent.startsWith('2ND'));
            if (t2) t2.click();
            await new Promise(r => setTimeout(r, 400));
            const before = document.querySelectorAll('.qpin-dot').length;
            const pin = document.querySelector('.qpin-dot');
            if (pin) pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            const ug = document.querySelector('#Second_Floor');
            const gl = document.querySelector('#Underground_Level');
            return {
              pinsOn2nd: before,
              secondFloorVisible: ug ? ug.style.display !== 'none' : null,
              undergroundHidden: gl ? gl.style.display === 'none' : null,
              detail: document.getElementById('mapHint').textContent.slice(0, 120),
            };
          })()`);
          console.log('TQT_FLOOR', JSON.stringify(floorChk));
          await shoot(process.env.TQT_SHOOT.replace('.png', '_floor.png'));
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
  cleanupStaleUpdate();
});
app.on('window-all-closed', () => {
  stopWatcher();
  app.quit();
});
