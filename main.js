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
    restartable
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
        questItem { name }
        count
        requiredKeys { name }
        zones { map { name } position { x y z } }
        possibleLocations { map { name } positions { x y z } }
      }
      ... on TaskObjectiveShoot { count requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveExtract { exitName requiredKeys { name } }
      ... on TaskObjectiveMark { markerItem { name } requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveBasic { requiredKeys { name } zones { map { name } position { x y z } } }
      ... on TaskObjectiveUseItem { useAny { name } count requiredKeys { name } }
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

// Quest index per mode: every id we can put a name to, plus the prerequisites
// each quest demands be COMPLETE. Memoised on the cache file's stamp — it is
// ~4.5 MB and the watcher polls every 5 s.
let questIdx = { key: '', idx: null };
function questIndex() {
  let key = '';
  for (const f of [CACHE_FILE, BUNDLED_CACHE]) {
    try { const st = fs.statSync(f); key = f + st.mtimeMs + ':' + st.size; break; } catch {}
  }
  if (questIdx.idx && key && key === questIdx.key) return questIdx.idx;
  const idx = {
    regular: { ids: new Set(), prereqs: new Map() },
    pve: { ids: new Set(), prereqs: new Map() },
  };
  const data = readJson(CACHE_FILE, null) || readJson(BUNDLED_CACHE, null);
  if (data) {
    for (const m of MODES) for (const t of data[m] || []) {
      if (!t || !t.id) continue;
      idx[m].ids.add(t.id);
      const need = [];
      for (const r of t.taskRequirements || []) {
        const st = (r.status || []).map(String);
        // ONLY an unambiguous "must be complete" proves anything. ['complete',
        // 'failed'] or ['active'] mean the prerequisite may be unfinished.
        if (st.length === 1 && st[0] === 'complete' && r.task && r.task.id) need.push(r.task.id);
      }
      if (need.length) idx[m].prereqs.set(t.id, need);
    }
  }
  questIdx = { key, idx };
  return idx;
}

// Storage still records every log event: an id absent from the cache may simply
// be newer than the cache, and dropping it would lose a real completion.
function knownQuestIds() {
  const idx = questIndex();
  return { regular: idx.regular.ids, pve: idx.pve.ids };
}

// Finishing a quest proves you finished everything it required.
//
// Tarkov does not always write a hand-in message: a quest that breaks for your
// profile and is fixed server-side can complete with no notification at all
// (seen live — "Quest with id … wasn't found!" in the logs, then silence). The
// log scanner can only report what was written, so without this the app will
// swear a quest is unfinished while happily showing its sequel as done.
//
// Runs to a fixpoint, because an implied completion proves its own prerequisites.
function applyImpliedCompletions(mode, addedIds) {
  const idx = questIndex()[mode];
  if (!idx || !idx.ids.size) return 0;      // no quest data yet — infer nothing
  const bucket = progress[mode];
  if (!bucket || !bucket.completed) return 0;
  let added = 0;
  for (let round = 0; round < 30; round++) {
    let changed = false;
    for (const [id, need] of idx.prereqs) {
      if (!bucket.completed[id]) continue;
      for (const pid of need) {
        if (bucket.completed[pid] || !idx.ids.has(pid)) continue;
        bucket.completed[pid] = { via: 'implied', at: Date.now(), by: id };
        if (addedIds) addedIds.push(pid);
        added++; changed = true;
      }
    }
    if (!changed) break;
  }
  return added;
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
  // EFT also emits an extended form, "<id> successMessageText <traderId> <rewardId>"
  // (daily/weekly templates today). Requiring the quote right after the suffix would
  // silently drop those, so accept any trailing content.
  // "<id> description" is the quest-ACCEPTED notification; it is what tells us a
  // failed-but-restartable quest has been taken again.
  const tmplRe = /"templateId"\s*:\s*"([a-f0-9]{24}) (successMessageText|failMessageText|description)[^"]*"/;
  let curTs = null;
  for (const line of text.split('\n')) {
    const tm = tsRe.exec(line);
    if (tm) curTs = parseLogTs(tm[1]);
    const em = tmplRe.exec(line);
    if (em) {
      const kind = em[2] === 'successMessageText' ? 'success' : em[2] === 'failMessageText' ? 'fail' : 'accept';
      events.push({ questId: em[1], kind, ts: curTs });
    }
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
  const known = knownQuestIds();
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
      const grew = fileSizes.get(nf) !== stat.size;
      let t;
      try { t = fs.readFileSync(nf, 'utf8'); } catch { continue; }  // locked by the game: retry next scan
      // remember the size only once the read succeeded — recording it first would
      // make a single failed read gate this folder out until the app restarts
      if (grew) { changed = true; fileSizes.set(nf, stat.size); }
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
        // Events arrive in order (folders sorted by start time, lines in file
        // order), so the LAST thing that happened to a quest wins. That matters:
        // several quests are restartable, and a failure followed by a re-accept
        // means the quest is active again, not failed.
        if (ev.kind === 'success') {
          if (bucket.failed[ev.questId]) { delete bucket.failed[ev.questId]; anyFail = true; }
          // dedup is PER MODE on purpose — the same quest can be completed
          // independently in PvP and PvE (separate profiles)
          if (!bucket.completed[ev.questId]) {
            bucket.completed[ev.questId] = { via: 'auto', at: Date.now() };
            // count it as a completion only if it is a quest we can name — the
            // logs also carry daily/weekly template ids. Empty set = no cache
            // yet, so announce everything rather than nothing.
            if (!known[mode].size || known[mode].has(ev.questId)) newByMode[mode].push(ev.questId);
          }
        } else if (ev.kind === 'accept') {
          // taking the quest again undoes an earlier failure
          if (bucket.failed[ev.questId]) { delete bucket.failed[ev.questId]; anyFail = true; }
        } else if (!bucket.failed[ev.questId] && !bucket.completed[ev.questId]) {
          // record WHEN it failed, not when we happened to scan
          bucket.failed[ev.questId] = { at: evTs !== null ? evTs : Date.now() };
          anyFail = true;
        }
      }
    }
  }

  // a completion just imported can prove earlier ones the logs never recorded
  for (const m of MODES) applyImpliedCompletions(m, newByMode[m]);

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

// Turn a failed GitHub API response into something worth showing the user.
// The anonymous rate limit is 60/hour PER IP and is shared with anything else on
// the machine that talks to api.github.com, so hitting it is not an app fault --
// say so plainly instead of implying the network is down.
function githubErrorMessage(status, headers) {
  const remaining = headers.get('x-ratelimit-remaining');
  const retryAfter = headers.get('retry-after');
  if ((status === 403 || status === 429) && remaining === '0') {
    const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
    // guard against a missing/garbage header becoming a literal "Invalid Date"
    const at = Number.isFinite(reset) && reset > 0
      ? new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    return "GitHub's hourly limit for anonymous requests is used up"
      + (at ? ` — try again after ${at}.` : ' — try again later.');
  }
  // secondary ("abuse") limit: 403/429 with Retry-After, quota not necessarily spent
  if ((status === 403 || status === 429) && retryAfter) {
    const secs = Number(retryAfter);
    return 'GitHub is asking the app to slow down'
      + (Number.isFinite(secs) && secs > 0 ? ` — try again in ${secs} second${secs === 1 ? '' : 's'}.` : ' — try again shortly.');
  }
  if (status === 404) return "Couldn't find a published release on GitHub (404).";
  // NOT "couldn't be reached" -- receiving a status code proves we reached it.
  return `GitHub answered with an error (HTTP ${status}). Nothing is wrong on your end — try again later.`;
}

// fetch()/body-read failures, phrased for a human
function networkErrorMessage(e, whileReading) {
  if (e && e.name === 'AbortError') return 'GitHub took too long to answer. Check your connection and try again.';
  if (whileReading && e instanceof SyntaxError) return "GitHub sent something the app couldn't read. Try again in a moment.";
  return whileReading
    ? "GitHub's answer was cut off. Check your connection and try again."
    : "Couldn't reach GitHub. Check your connection and try again.";
}

let updateInfo = null;       // { version, notes, url, size, assetName }
let stagedUpdateDir = null;  // extracted new build, ready to swap in on quit

async function checkForUpdate() {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15000);
  try {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TarkovQuestingCompanion' },
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(networkErrorMessage(e, false));
    }
    if (!res.ok) throw new Error(githubErrorMessage(res.status, res.headers));
    // the timeout is still armed here -- an abort mid-body must not leak
    // "The operation was aborted." to the user
    let rel;
    try {
      rel = await res.json();
    } catch (e) {
      throw new Error(networkErrorMessage(e, true));
    }
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
  // best effort — if this fails we still succeed, because the extract folder
  // below is uniquely named
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
  // Extract into a FRESH, uniquely named folder. ExtractToDirectory refuses to
  // write over existing files, and a stale folder can survive when clearing the
  // temp dir fails (e.g. a previous update attempt died mid-way).
  const extractDir = path.join(tmp, 'new-' + Date.now());
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
// The helper is PowerShell, not a batch file: it waits with Wait-Process and
// sleeps with Start-Sleep, neither of which need console input. (A .bat using
// `timeout` / `tasklist | find` hangs when spawned detached with no stdin.)
const UPDATE_PS = String.raw`
param([int]$AppPid, [string]$Staged, [string]$Install, [string]$Backup, [string]$ExeName, [string]$TempDir, [string]$Log)
$ErrorActionPreference = 'SilentlyContinue'
function Note($m) { "$(Get-Date -Format o)  $m" | Out-File -FilePath $Log -Append -Encoding utf8 }
Note "update starting (waiting for pid $AppPid)"
# wait for the app to exit (returns at once if it is already gone)
Wait-Process -Id $AppPid -Timeout 90
Start-Sleep -Seconds 2   # let helper processes / AV release file locks
$rc = @('/MIR','/R:5','/W:2','/NFL','/NDL','/NJH','/NJS','/NC','/NS')
robocopy $Install $Backup @rc | Out-Null          # back up the working install
Note "backup rc=$LASTEXITCODE"
robocopy $Staged  $Install @rc | Out-Null         # install the new build
$code = $LASTEXITCODE
Note "install rc=$code"
if ($code -ge 8) {                                # robocopy >=8 = real failure
  robocopy $Backup $Install @rc | Out-Null        # restore the working version
  Note "FAILED - rolled back to the previous version (rc=$LASTEXITCODE)"
}
Start-Process -FilePath (Join-Path $Install $ExeName)
Remove-Item $Backup -Recurse -Force
if ($code -lt 8) { Remove-Item $TempDir -Recurse -Force; Note "update complete" }
Remove-Item $MyInvocation.MyCommand.Path -Force
`;

function applyUpdateAndRestart() {
  if (!stagedUpdateDir) throw new Error('nothing staged');
  if (!app.isPackaged) throw new Error('updates only apply to the packaged app');
  const install = installDir();
  const exeName = path.basename(app.getPath('exe'));
  const backup = install.replace(/[\\/]+$/, '') + '.bak-update';
  const tempDir = path.join(os.tmpdir(), 'tqc-update');
  const psPath = path.join(os.tmpdir(), 'tqc-apply-update.ps1');
  const logPath = path.join(app.getPath('userData'), 'update.log');
  fs.writeFileSync(psPath, UPDATE_PS, 'utf8');
  const psArgs = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', psPath,
    '-AppPid', String(process.pid),
    '-Staged', stagedUpdateDir,
    '-Install', install,
    '-Backup', backup,
    '-ExeName', exeName,
    '-TempDir', tempDir,
    '-Log', logPath,
  ];
  // Launch through `cmd /c start` on purpose: Electron puts directly-spawned
  // children in a job object that kills them the moment the app exits, so the
  // helper never ran. `start` breaks it out of that job so it survives us.
  spawn('cmd.exe', ['/c', 'start', '""', '/b', 'powershell.exe', ...psArgs],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
  const m = MODES.includes(mode) ? mode : settings.gameMode;
  const bucket = progress[m];
  if (done) {
    bucket.completed[taskId] = { via: 'manual', at: Date.now() };
    applyImpliedCompletions(m);   // ticking a quest also settles what it required
  } else {
    delete bucket.completed[taskId];
  }
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

// The only hosts the app will hand to the OS browser: quest wiki pages, and the
// projects credited in Settings. Matched on the PARSED hostname, exactly — the
// previous prefix regex would have needed a trailing slash to stay safe against
// "escapefromtarkov.fandom.com.evil.com/", and adding hosts to that pattern is
// how such a check quietly becomes wrong.
const EXTERNAL_HOSTS = new Set([
  'escapefromtarkov.fandom.com', 'www.escapefromtarkov.wiki',   // quest pages
  'tarkov.dev', 'github.com',                                   // data + map artwork
  'www.behance.net', 'www.electronjs.org',                      // font, framework
  'www.escapefromtarkov.com',                                   // Battlestate Games
  'creativecommons.org', 'scripts.sil.org',                     // licence texts
]);

function isExternalAllowed(url) {
  if (typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname);
}

ipcMain.handle('open-wiki', (_e, url) => {
  if (!isExternalAllowed(url)) return false;
  shell.openExternal(url);
  return true;
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
  // test hook: drive a real check -> download -> apply cycle (env-gated)
  if (process.env.TQC_TEST_APPLY) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const c = await checkForUpdate();
        console.log('TQC_T_CHECK', JSON.stringify({ available: c.available, current: c.current, latest: c.latest }));
        if (!c.available) { app.quit(); return; }
        const d = await downloadUpdate();
        console.log('TQC_T_DOWNLOAD', JSON.stringify({ staged: d.staged, dir: stagedUpdateDir }));
        console.log('TQC_T_APPLY', JSON.stringify(applyUpdateAndRestart()));
      } catch (e) {
        console.log('TQC_T_ERR', String(e.message || e));
        app.quit();
      }
    });
  }

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

  // dev aid: TQT_HERO=<dir> selects each trader in turn and screenshots the hero,
  // to check the map/trader blend has no visible seam and the trader stays visible
  if (process.env.TQT_HERO) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const dir = process.env.TQT_HERO;
        try {
          fs.mkdirSync(dir, { recursive: true });
          // expand every map so we can reach one row for each distinct trader
          const traders = await win.webContents.executeJavaScript(`(async () => {
            document.querySelector('.tab[data-filter="ALL"]').click();
            await new Promise(r => setTimeout(r, 300));
            for (const row of [...document.querySelectorAll('.map-row')]) {
              row.querySelector('.row-toggle').click();
              await new Promise(r => setTimeout(r, 60));
            }
            const seen = new Set();
            for (const r of document.querySelectorAll('.trader-row')) seen.add(r.querySelector('.row-name').textContent);
            return [...seen];
          })()`);
          for (const name of traders) {
            const info = await win.webContents.executeJavaScript(`(async () => {
              const row = [...document.querySelectorAll('.trader-row')].find(r => r.querySelector('.row-name').textContent === ${JSON.stringify(name)});
              row.click();
              await new Promise(r => setTimeout(r, 600));
              const m = document.getElementById('heroMap'), t = document.getElementById('heroTrader');
              const hero = document.getElementById('hero').getBoundingClientRect();
              const mr = m.getBoundingClientRect(), tr = t.getBoundingClientRect();
              return {
                trader: ${JSON.stringify(name)},
                traderShown: t.classList.contains('visible'),
                mapFillsPane: Math.abs(mr.width - hero.width) < 1,
                mapRightEdgeInsideFade: mr.right < hero.right - 1,
                traderWidthPct: Math.round(tr.width / hero.width * 100),
              };
            })()`);
            console.log('TQT_HERO', JSON.stringify(info));
            const img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(dir, 'hero_' + name.replace(/\W+/g, '_') + '.png'), img.toPNG());
          }
        } catch (err) {
          console.error('TQT_HERO failed:', err);
        }
        app.quit();
      }, 7000);
    });
  }

  // dev aid: TQT_MAPS=<dir> opens every map in turn, screenshots it, and reports
  // how the pins and the landmark labels fit — the calibration check for new maps
  if (process.env.TQT_MAPS) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const dir = process.env.TQT_MAPS;
        try {
          fs.mkdirSync(dir, { recursive: true });
          const names = await win.webContents.executeJavaScript('Object.keys(MAP_DATA)');
          for (const name of names) {
            const info = await win.webContents.executeJavaScript(`(async () => {
              await openQuestMap(${JSON.stringify(name)});
              await new Promise(r => setTimeout(r, 700));
              const svg = document.querySelector('#mapRot svg');
              const box = svg.getBoundingClientRect(), stage = document.getElementById('mapStage').getBoundingClientRect();
              const dots = [...document.querySelectorAll('.qpin-dot')];
              const labels = [...document.querySelectorAll('#qpins text')];
              const outside = (el) => { const r = el.getBoundingClientRect();
                return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1; };
              // Landmark labels name buildings, so on a correctly calibrated map
              // most of them should sit ON drawn geometry rather than empty
              // background. Labels are pointer-events:none, so hit-testing at
              // their centre reports whatever artwork is underneath.
              const onArt = (el) => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                return !!hit && hit !== svg && svg.contains(hit) && hit.tagName.toLowerCase() !== 'text';
              };
              const hits = labels.filter(onArt).length;
              return {
                map: ${JSON.stringify(name)},
                viewBox: svg.getAttribute('viewBox'),
                overflowsStage: box.width > stage.width + 1 || box.height > stage.height + 1,
                fill: Math.round(Math.max(box.width / stage.width, box.height / stage.height) * 100) + '%',
                pins: dots.length, pinsOutside: dots.filter(outside).length,
                labels: labels.length, labelsOutside: labels.filter(outside).length,
                labelsOnArtwork: hits,
                labelHitRate: labels.length ? Math.round(hits / labels.length * 100) + '%' : 'n/a',
                dotPx: dots.length ? Math.round(dots[0].getBoundingClientRect().width * 10) / 10 : null,
                // does the drawn artwork actually fill its viewBox? a map whose
                // content is inset would need the CONTENT box as the mapping
                // rectangle, not the viewBox
                contentBBox: (() => {
                  try {
                    const g = svg.querySelector('g');
                    const b = g.getBBox();
                    const r = (n) => Math.round(n * 10) / 10;
                    return { x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) };
                  } catch { return null; }
                })(),
                floors: [...document.querySelectorAll('.floor-tab')].map(t => t.textContent),
                // selecting an upper floor must dim the ground plan underneath it.
                // Checked per map because their SVG structures differ.
                // tabs are ordered by height now, so ground is not tabs[0] on a
                // map with a basement — find them by their data-floor index
                defaultIsGround: (() => {
                  const active = document.querySelector('.floor-tab.active');
                  return !!active && Number(active.dataset.floor) === -1;
                })(),
                tabOrder: [...document.querySelectorAll('.floor-tab')].map(t => Number(t.dataset.floor)),
                dim: await (async () => {
                  const tabs = [...document.querySelectorAll('.floor-tab')];
                  const ground = tabs.find(t => Number(t.dataset.floor) === -1);
                  const upper = tabs.find(t => Number(t.dataset.floor) >= 0);
                  if (!upper || !ground) return 'no floors';
                  const base = svg.querySelector('#' + CSS.escape(MAP_DATA[${JSON.stringify(name)}].baseLayer));
                  if (!base) return 'no base layer';
                  const atGround = Number(getComputedStyle(base).opacity);
                  upper.click();
                  await new Promise(r => setTimeout(r, 250));
                  const onFloor = Number(getComputedStyle(base).opacity);
                  ground.click();
                  await new Promise(r => setTimeout(r, 250));
                  const backToGround = Number(getComputedStyle(base).opacity);
                  return (atGround > 0.9 && onFloor < 0.5 && backToGround > 0.9)
                    ? 'ok' : \`BAD ground=\${atGround} floor=\${onFloor} back=\${backToGround}\`;
                })(),
              };
            })()`);
            console.log('TQT_MAPS', JSON.stringify(info));
            const img = await win.webContents.capturePage();
            fs.writeFileSync(path.join(dir, name.replace(/\W+/g, '_') + '.png'), img.toPNG());
          }
          // pin/card sizes are measured off the rendered SVG, so a resize must redraw
          const dot = () => win.webContents.executeJavaScript(`(() => {
            const d = document.querySelector('.qpin-dot');
            const svg = document.querySelector('#mapRot svg');
            const s = svg.getBoundingClientRect(), st = document.getElementById('mapStage').getBoundingClientRect();
            const r1 = (n) => Math.round(n * 10) / 10;
            return {
              dotPx: d ? r1(d.getBoundingClientRect().width) : null,
              rAttr: d ? r1(Number(d.getAttribute('r'))) : null,
              svgBox: r1(s.width) + 'x' + r1(s.height),
              stage: r1(st.width) + 'x' + r1(st.height),
              viewBox: svg.getAttribute('viewBox'),
            };
          })()`);
          await win.webContents.executeJavaScript(`openQuestMap('Customs')`);
          await new Promise((r) => setTimeout(r, 900));
          const sizes = { start: await dot() };
          win.setContentSize(820, 560);
          await new Promise((r) => setTimeout(r, 900));
          sizes.small = await dot();
          win.setContentSize(1600, 900);
          await new Promise((r) => setTimeout(r, 900));
          sizes.large = await dot();
          console.log('TQT_RESIZE', JSON.stringify(sizes));
          // zoom must magnify the map while pins stay the same size on screen,
          // the point under the cursor must stay put, and pan must be bounded
          const zoomChk = await win.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const stage = document.getElementById('mapStage');
            const st = stage.getBoundingClientRect();
            // Zoom must NARROW THE VIEWBOX, not scale a bitmap: a CSS transform
            // magnifies an already-rasterised map and it turns to mush. Measure
            // the viewBox width, and assert the element is not being scaled.
            const at = () => {
              const el = document.querySelector('#mapRot svg');
              const s = el.getBoundingClientRect();
              const raw = el.getAttribute('viewBox');
              // NB: this script is a JS template literal, so regex backslashes
              // must be doubled — /[\\s,]+/ here is /[\\s,]+/ in the page
              const vb = String(raw).trim().split(/[\\s,]+/).map(Number);
              return { w: Math.round(s.width), vbRaw: raw, vbW: Math.round(vb[2] * 10) / 10, cx: Math.round(s.left + s.width / 2) };
            };
            const dot = () => { const d = document.querySelector('.qpin-dot'); return d ? Math.round(d.getBoundingClientRect().width * 10) / 10 : null; };
            const dotXY = () => { const d = document.querySelector('.qpin-dot'); const r = d.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; };
            const before = { zoom: mapView.zoom, ...at(), map: at().w, dot: dot(), pin: dotXY() };
            // zoom in on the pin itself: it should barely move
            const p = dotXY();
            for (let i = 0; i < 6; i++) { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true })); await wait(60); }
            await wait(300);
            const zoomed = { zoom: Math.round(mapView.zoom * 100) / 100, ...at(), map: at().w, vbX: mapView.view.x, dot: dot(), pin: dotXY() };
            // right-drag should move it, and stay bounded
            stage.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: st.left + 400, clientY: st.top + 300, bubbles: true }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: st.left + 400 + 5000, clientY: st.top + 300, bubbles: true }));
            window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
            await wait(200);
            const panned = { vbX: mapView.view.x };
            stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            await wait(300);
            const reset = { zoom: mapView.zoom, vbW: at().vbW, dot: dot() };
            const rot = getComputedStyle(document.getElementById('mapRot')).transform;
            return {
              zoomedIn: zoomed.zoom > before.zoom && zoomed.vbW < before.vbW / 1.5,
              staysVector: rot === 'none' || rot === 'matrix(1, 0, 0, 1, 0, 0)',
              elementNotScaled: zoomed.map === before.map,
              pinStaysSameSize: before.dot !== null && Math.abs(zoomed.dot - before.dot) <= 1,
              cursorAnchored: Math.abs(zoomed.pin.x - p.x) <= 25 && Math.abs(zoomed.pin.y - p.y) <= 25,
              panMoved: panned.vbX !== zoomed.vbX,
              dblClickResets: Math.abs(reset.zoom - 1) < 0.01,
              detail: { before, zoomed, panned, reset, transform: rot },
            };
          })()`);
          console.log('TQT_ZOOM', JSON.stringify(zoomChk));
          // capture a deep zoom so the artwork's sharpness can be eyeballed
          await win.webContents.executeJavaScript(`(async () => {
            await openQuestMap('Woods');
            await new Promise(r => setTimeout(r, 800));
            const st = document.getElementById('mapStage').getBoundingClientRect();
            for (let i = 0; i < 22; i++) {
              document.getElementById('mapStage').dispatchEvent(new WheelEvent('wheel',
                { deltaY: -120, clientX: st.left + st.width / 2, clientY: st.top + st.height / 2, bubbles: true, cancelable: true }));
              await new Promise(r => setTimeout(r, 40));
            }
            await new Promise(r => setTimeout(r, 500));
            return mapView.zoom;
          })()`);
          const img2 = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, '_zoomed_woods.png'), img2.toPNG());
        } catch (err) {
          console.error('TQT_MAPS failed:', err);
        }
        app.quit();
      }, 7000);
    });
  }

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
          // credits sit at the bottom of the settings panel
          const credits = await win.webContents.executeJavaScript(`(async () => {
            if (document.getElementById('settingsOverlay').classList.contains('hidden')) {
              document.getElementById('settingsBtn').click();
              await new Promise(r => setTimeout(r, 300));
            }
            const g = document.getElementById('creditsGroup');
            g.scrollIntoView({ block: 'end' });
            await new Promise(r => setTimeout(r, 400));
            const links = [...g.querySelectorAll('a[data-url]')];
            const r = g.getBoundingClientRect();
            return {
              entries: g.querySelectorAll('.credit').length,
              links: links.length,
              urls: links.map(a => a.dataset.url),
              names: links.map(a => a.textContent.trim()),
              visible: r.top < window.innerHeight && r.bottom > 0,
            };
          })()`);
          // Run every credit URL through the REAL allowlist. Checking that the
          // attribute looks like a URL proves nothing — an earlier version of
          // this probe did exactly that and passed while all six links were
          // silently rejected by the handler. Validated here rather than by
          // invoking the IPC, so the test does not open six browser tabs.
          credits.rejected = credits.urls.filter((u) => !isExternalAllowed(u));
          delete credits.urls;
          console.log('TQT_CREDITS', JSON.stringify(credits));
          await shoot(process.env.TQT_SHOOT.replace('.png', '_credits.png'));
          await win.webContents.executeJavaScript(`document.getElementById('settingsPanel').scrollTop = 0;`);

          // exercise the update controls, which now live in the sidebar footer
          await win.webContents.executeJavaScript(`document.getElementById('checkUpdateBtn').click();`);
          await new Promise((r) => setTimeout(r, 4000));
          const updChk = await win.webContents.executeJavaScript(`(() => ({
            current: document.getElementById('versionTag').textContent,
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
              loadout: {
                total: document.getElementById('mapLoadoutCount').textContent,
                groups: [...document.querySelectorAll('#mapLoadoutList .ld-head')].map(h => h.textContent),
                items: [...document.querySelectorAll('#mapLoadoutList li')].map(li => li.textContent.trim()),
              },
            };
          })()`);
          console.log('TQT_MAP', JSON.stringify(mapChk));
          // the loadout must follow the tab filter, not just the pins
          const tabChk = await win.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const read = () => ({
              items: [...document.querySelectorAll('#mapLoadoutList li .ld-name')].map(n => n.textContent),
              pins: mapView.pins.length,
            });
            const all = read();
            document.getElementById('closeMapBtn').click();
            document.querySelector('.tab[data-filter="KAPPA"]').click();
            await wait(400);
            const row = [...document.querySelectorAll('.map-row')].find(r => r.textContent.includes('CUSTOMS'));
            row.querySelector('.map-btn').click();
            await wait(900);
            const kappa = read();
            const subset = kappa.items.every(i => all.items.includes(i));
            return {
              allItems: all.items.length, allPins: all.pins,
              kappaItems: kappa.items.length, kappaPins: kappa.pins,
              narrowed: kappa.items.length < all.items.length && kappa.pins < all.pins,
              kappaIsSubsetOfAll: subset,
              dropped: all.items.filter(i => !kappa.items.includes(i)).slice(0, 4),
            };
          })()`);
          console.log('TQT_LOADOUT', JSON.stringify(tabChk));
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
            const card = document.querySelector('.qpin-card');
            const detail = card ? card.textContent.slice(0, 120) : null;
            // clicking the same pin again must clear the card
            if (pin) pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const cleared = !document.querySelector('.qpin-card');
            // the ground plan must be dimmed while an upper floor is shown
            const svgEl = document.querySelector('#mapRot svg');
            const baseOp = getComputedStyle(svgEl.querySelector('#Ground_Level')).opacity;
            const selOp = getComputedStyle(svgEl.querySelector('#Second_Floor')).opacity;
            if (pin) pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));  // re-select for the screenshot
            await new Promise(r => setTimeout(r, 300));
            const ug = document.querySelector('#Second_Floor');
            const gl = document.querySelector('#Underground_Level');
            return {
              pinsOn2nd: before,
              secondFloorVisible: ug ? ug.style.display !== 'none' : null,
              undergroundHidden: gl ? gl.style.display === 'none' : null,
              detail,
              cardClearedOnSecondClick: cleared,
              groundDimmed: Number(baseOp) < 0.9,
              groundOpacity: Number(baseOp),
              selectedFloorFull: Number(selOp) > 0.9,
            };
          })()`);
          console.log('TQT_FLOOR', JSON.stringify(floorChk));
          await shoot(process.env.TQT_SHOOT.replace('.png', '_floor.png'));
          // every pin on every floor: the card's foreignObject must be at least as
          // tall as the card, or the objective text is silently cut off
          const cardChk = await win.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const pins = () => [...document.querySelectorAll('.qpin-dot')];
            const out = { checked: 0, clipped: [], worstOverflow: 0, offMap: 0, withTrader: 0, withNeed: 0, needSamples: [] };
            const floors = document.querySelectorAll('.floor-tab').length;
            for (let f = 0; f < floors; f++) {
              [...document.querySelectorAll('.floor-tab')][f].click();
              await wait(120);
              const n = pins().length;
              for (let i = 0; i < n; i++) {
                pins()[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(0);
                const fo = document.querySelector('#qpins foreignObject');
                const card = document.querySelector('.qpin-card');
                if (fo && card) {
                  out.checked++;
                  const over = card.getBoundingClientRect().height - fo.getBoundingClientRect().height;
                  if (over > out.worstOverflow) out.worstOverflow = Math.round(over * 100) / 100;
                  if (over > 0.5) out.clipped.push(card.textContent.slice(0, 45));
                  if (card.querySelector('.qpin-card-trader')) out.withTrader++;
                  const need = card.querySelector('.qpin-card-need');
                  if (need) { out.withNeed++; if (out.needSamples.length < 4) out.needSamples.push(need.textContent.trim().slice(0, 60)); }
                  const svg = document.querySelector('#mapRot svg').getBoundingClientRect();
                  const b = fo.getBoundingClientRect();
                  if (b.left < svg.left - 1 || b.right > svg.right + 1 || b.top < svg.top - 1 || b.bottom > svg.bottom + 1) out.offMap++;
                }
                pins()[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(0);
              }
            }
            return out;
          })()`);
          console.log('TQT_CARD', JSON.stringify(cardChk));
          // capture a card that actually carries a requirement line
          const shot = await win.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const floors = [...document.querySelectorAll('.floor-tab')];
            for (const f of floors) {
              f.click(); await wait(200);
              const pins = () => [...document.querySelectorAll('.qpin-dot')];
              for (let i = 0; i < pins().length; i++) {
                pins()[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(0);
                const need = document.querySelector('.qpin-card-need');
                if (need) return document.querySelector('.qpin-card').textContent.slice(0, 90);
                pins()[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(0);
              }
            }
            return null;
          })()`);
          console.log('TQT_NEEDSHOT', JSON.stringify(shot));
          if (shot) await shoot(process.env.TQT_SHOOT.replace('.png', '_need.png'));
        } catch (err) {
          console.error('TQT_SHOOT failed:', err);
        }
        app.quit();
      }, 6000);
    });
  }
}

// The screenshot/apply harnesses drive the real UI: they tick settings, toggle
// display options and import completions. Run against the normal profile they
// overwrite the user's own data -- which happened once, from a single typo in a
// --user-data-dir path that Electron then quietly ignored. Refuse to start
// instead: a dev harness must never be one keystroke away from real data.
function refuseIfRealProfile() {
  // every harness that drives the real UI, not just the first two
  if (!process.env.TQT_SHOOT && !process.env.TQC_TEST_APPLY
      && !process.env.TQT_MAPS && !process.env.TQT_HERO) return;
  const real = path.join(app.getPath('appData'), app.getName());
  if (path.resolve(app.getPath('userData')) !== path.resolve(real)) return;
  console.error(
    'REFUSING TO RUN: TQT_SHOOT/TQC_TEST_APPLY would use the real profile at\n  ' + real +
    '\nPass --user-data-dir=<throwaway dir> (and check it was accepted).');
  app.exit(2);
}

app.whenReady().then(() => {
  refuseIfRealProfile();
  initStorage();
  // catch up on inferences from before this existed, and for manual-mode users
  // who never run a log scan at all
  let implied = 0;
  for (const m of MODES) implied += applyImpliedCompletions(m);
  if (implied) saveProgress();
  createWindow();
  cleanupStaleUpdate();
});
app.on('window-all-closed', () => {
  stopWatcher();
  app.quit();
});
