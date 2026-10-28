/**
 * Social OS — server side.
 *
 * Lives in Extensions → Apps Script of your Google Sheet, next to Index.html.
 * Deploy as a web app with "Execute as: Me" and "Who has access: Only myself".
 * It only needs your spreadsheet and Google's place lookup (for the map). No email, no scheduled jobs.
 * See README.md for setup and for how the scores work.
 */

const APP_VERSION = '2026-10-28'; // shown in the app's Settings so you can check a deployment updated
const MAIN_SHEET = 'Main';
const RULES_SHEET = 'Rules';
const GEO_SHEET = '_Geo';
const LOG_SHEET = '_Log';       // every logged interaction: powers reliability, XP and streaks
const WEEKS_SHEET = '_Weekly';  // one friendship-score snapshot per week
const LOG_DAYS = 3650;          // how much history the app loads
const ICON_URL = ''; // optional: a public PNG link for the browser-tab icon

// Columns the app adds to Main the first time it needs them.
const EXTRA_COLUMNS = {
  lastcalled: 'Last Called',
  nextplan: 'Next Plan',
  nextplandate: 'Next Plan Date',
  lastinvited: 'Last Invited',
  phone: 'Phone',
  likes: 'Likes',
  dislikes: 'Dislikes',
  notes: 'Notes'
};

const DEFAULT_PREFS = { bases: [], current: '', autoDistance: true, autoConfirm: true };

// Used only when the spreadsheet is brand new (e.g. a friend setting up their own copy).
const STARTER_HEADERS = [
  'Name', 'Photo', 'Tier', 'Proximity Score', 'Meeting', 'Tags', 'Place Tags', 'Address', 'Phone',
  'Last Contacted', 'Last Seen/ Video Called', 'Last Called', 'Last Invited', 'Next Plan', 'Next Plan Date',
  'Birthday Date', 'Gift Effort', 'Christmas Card', 'Christmas Gift Effort',
  'Allergy/ Dietary Requirements', 'Likes', 'Dislikes', 'Gifts Last Brought', 'Future Gift Ideas', 'Notes'
];
const STARTER_RULES = [
  ['Tier', 'Contact Goal Days', 'Label', 'See Multiplier', 'Proximity', 'Invite Goal', 'Geography'],
  [1, 4, 'Close friends', 0.5, 1, 365, 'Another country!'],
  [2, 12, '', 0.75, 2, 150, 'More than 5 hours away in UK'],
  [3, 30, '', 1, 3, 120, 'Within the UK'],
  [4, 90, '', 1.5, 4, 60, 'Same city'],
  [5, 150, '', 2, 5, 12, '30 minutes public transport'],
  [6, 365, '', 3, 6, 10, '15/20 minutes walk']
];

function doGet(e) {
  // Add ?check=1 to the app link for a plain status page built entirely by Google (no app code needed).
  if (e && e.parameter && e.parameter.check) {
    const lines = checkSetup();
    return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<div style="font:15px/1.5 system-ui,sans-serif;padding:16px;max-width:640px"><h2>Social OS check</h2>' +
      lines.map(l => '<p style="margin:0 0 10px">' + htmlEsc_(l) + '</p>').join('') + '</div>').setTitle('Social OS check');
  }
  const out = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Social OS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  if (ICON_URL) out.setFaviconUrl(ICON_URL);
  return out;
}

/* ───────────────────────── Reading ───────────────────────── */

function getData() {
  const start = Date.now(), timings = {};
  const lap = name => { timings[name] = Date.now() - start; };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    setupIfNeeded_(ss);
    const sheet = mainSheet_(ss);
    const tz = ss.getSpreadsheetTimeZone();
    const read = readFriends_(sheet, tz);
    lap('friends');
    const rules = readRules_(ss);
    lap('rules');
    const geo = readGeo_(ss), log = readLog_(ss), weeks = readWeeks_(ss);
    lap('history');
    const out = {
      friends: read.friends,
      columns: read.cols,
      rules: rules,
      geo: geo,
      sheetUrl: ss.getUrl() + '#gid=' + sheet.getSheetId(),
      prefs: getPrefs_(),
      log: log,
      weeks: weeks,
      extraColumns: EXTRA_COLUMNS,
      version: APP_VERSION
    };
    lap('total');
    out.timings = timings;
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ error: e.message || String(e), version: APP_VERSION });
  }
}

/**
 * Run this from the Apps Script editor to check the app can read your sheet:
 * pick "checkSetup" in the function menu at the top, press ▶ Run, then read the Execution log.
 */
function checkSetup() {
  const lines = [];
  const say = l => { lines.push(l); console.log(l); };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  say('Social OS version ' + APP_VERSION + ' · spreadsheet "' + ss.getName() + '"');
  say('Sheets: ' + ss.getSheets().map(s => s.getName()).join(', '));
  const main = ss.getSheetByName(MAIN_SHEET);
  say(main ? '✓ Found the "Main" sheet' : '✗ No sheet called "Main", so the first sheet is used: ' + ss.getSheets()[0].getName());
  const rules = rulesSheet_(ss);
  say(rules ? '✓ Goals read from the "' + rules.getName() + '" sheet' : '✗ No sheet with a "Contact Goal Days" header, so default goals are used');
  const json = getData();
  const d = JSON.parse(json);
  if (d.error) { say('✗ Loading failed: ' + d.error); return lines; }
  say('✓ Read ' + d.friends.length + ' friends and ' + d.columns.length + ' columns');
  say('Formula columns (read-only in the app): ' + (d.columns.filter(c => c.computed).map(c => c.label).join(', ') || 'none'));
  say('Time taken (ms, cumulative): ' + JSON.stringify(d.timings) + ' · data size ' + Math.round(json.length / 1024) + ' KB');
  say('Tiers set up: ' + Object.keys(d.rules.tiers).join(', ') + ' · distance bands: ' + Object.keys(d.rules.proximity).join(', '));
  say('If the web app still shows something different, deploy a new version: Deploy → Manage deployments → ✏️ → Version: New version.');
  return lines;
}

function getPrefs_() {
  try {
    return Object.assign({}, DEFAULT_PREFS, JSON.parse(PropertiesService.getScriptProperties().getProperty('prefs') || '{}'));
  } catch (e) {
    return Object.assign({}, DEFAULT_PREFS);
  }
}

// Home bases and the current one: {bases: [{name, lat, lng, country}], current: 'London', autoDistance: true}
function setPrefs(json) {
  const prefs = Object.assign(getPrefs_(), JSON.parse(json));
  PropertiesService.getScriptProperties().setProperty('prefs', JSON.stringify(prefs));
  return JSON.stringify(prefs);
}

function normalizeKey_(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mainSheet_(ss) {
  const sheet = ss.getSheetByName(MAIN_SHEET) || ss.getSheets()[0];
  if (!sheet) throw new Error('No "' + MAIN_SHEET + '" sheet found.');
  return sheet;
}

// One entry per non-empty header. A repeated header gets a numbered key (address, address2).
function headerInfo_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const labels = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const counts = {};
  const cols = [];
  labels.forEach((label, i) => {
    let key = normalizeKey_(label);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > 1) key += counts[key];
    cols.push({ key: key, label: String(label).trim(), col: i + 1 });
  });
  if (!cols.some(c => c.key === 'name')) throw new Error('The ' + sheet.getName() + ' sheet needs a "Name" column.');
  return cols;
}

function colFor_(cols, key) {
  return cols.find(c => c.key === key);
}

// Last row with a name in it. getLastRow() is unreliable when ARRAYFORMULA columns fill the sheet.
function lastNameRow_(sheet, cols) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const names = sheet.getRange(2, colFor_(cols, 'name').col, last - 1, 1).getDisplayValues();
  for (let i = names.length - 1; i >= 0; i--) {
    if (String(names[i][0]).trim()) return i + 2;
  }
  return 1;
}

function isComputedFormula_(f) {
  return !!f && !/^=\s*IMAGE\s*\(/i.test(f);
}

function readFriends_(sheet, tz) {
  const cols = headerInfo_(sheet);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const lastRow = lastNameRow_(sheet, cols);
  let values = [], display = [], sample = [], photoFormulas = [];
  const photoCol = colFor_(cols, 'photo');
  if (lastRow >= 2) {
    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    values = range.getValues();
    display = range.getDisplayValues();
    // Formulas are slow to read, so only sample the first rows (to spot formula columns) and the photo column.
    sample = sheet.getRange(2, 1, Math.min(10, lastRow - 1), lastCol).getFormulas();
    if (photoCol) photoFormulas = sheet.getRange(2, photoCol.col, lastRow - 1, 1).getFormulas();
  }
  const headerFormulas = sheet.getRange(1, 1, 1, lastCol).getFormulas()[0];

  // A column is "computed" (read-only in the app) if it's driven by formulas.
  cols.forEach(c => {
    const i = c.col - 1;
    let filled = 0, computed = 0, dates = 0;
    sample.forEach((row, r) => {
      if (values[r][i] === '' && !row[i]) return;
      filled++;
      if (isComputedFormula_(row[i])) computed++;
    });
    values.forEach(row => { if (row[i] instanceof Date) dates++; });
    const arrayFormula = /ARRAYFORMULA/i.test(headerFormulas[i] + (sample.length ? sample[0][i] : ''));
    c.computed = arrayFormula || (filled > 0 && computed / filled > 0.5);
    c.date = dates > 0;
  });

  const nameIdx = colFor_(cols, 'name').col - 1;
  const friends = [];
  values.forEach((row, r) => {
    if (!String(display[r][nameIdx]).trim()) return;
    const f = { _row: r + 2 };
    cols.forEach(c => {
      const i = c.col - 1;
      const v = row[i];
      if (c.key === 'photo') f.photo = photoUrl_(v, (photoFormulas[r] || [])[0], display[r][i]);
      else if (v instanceof Date) f[c.key] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      else f[c.key] = display[r][i];
    });
    friends.push(f);
  });
  return { friends: friends, cols: cols };
}

function photoUrl_(value, formula, display) {
  const m = /IMAGE\s*\(\s*"([^"]+)"/i.exec(formula || '');
  let url = m ? m[1] : '';
  if (!url && value && typeof value === 'object' && typeof value.getContentUrl === 'function') {
    try { url = value.getContentUrl() || ''; } catch (e) { /* in-cell image without a URL */ }
  }
  if (!url && /^https?:\/\//i.test(display)) url = display;
  const drive = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/.exec(url);
  if (drive) url = 'https://drive.google.com/thumbnail?id=' + drive[1] + '&sz=w256';
  return url;
}

// The rules sheet is whichever sheet has a "Contact Goal Days" header.
function rulesSheet_(ss) {
  const hasGoals = s => s && s.getLastColumn() >= 1 &&
    s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0].some(h => normalizeKey_(h) === 'contactgoaldays');
  const named = [ss.getSheetByName('Settings'), ss.getSheetByName(RULES_SHEET)].find(hasGoals);
  if (named) return named;
  return ss.getSheets().find(s => {
    if (/^_/.test(s.getName())) return false;
    if (s.getName() === MAIN_SHEET || s.getLastColumn() < 1) return false;
    return s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0]
      .some(h => normalizeKey_(h) === 'contactgoaldays');
  });
}

function readRules_(ss) {
  const rules = { tiers: {}, proximity: {} };
  const sheet = rulesSheet_(ss);
  if (!sheet) return rules;
  const data = sheet.getDataRange().getDisplayValues();
  const idx = {};
  data[0].forEach((h, i) => { idx[normalizeKey_(h)] = i; });
  const get = (row, k) => idx[k] === undefined ? '' : String(row[idx[k]]).trim();
  data.slice(1).forEach((row, n) => {
    const tier = parseInt(get(row, 'tier'), 10);
    if (tier) {
      rules.tiers[tier] = {
        contactGoal: parseFloat(get(row, 'contactgoaldays')) || null,
        label: get(row, 'label'),
        seeMultiplier: parseFloat(get(row, 'seemultiplier')) || null
      };
    }
    const geography = get(row, 'geography');
    const prox = parseInt(get(row, 'proximity'), 10) || (geography ? n + 1 : 0);
    if (prox) rules.proximity[prox] = { inviteGoal: parseFloat(get(row, 'invitegoal')) || null, geography: geography };
  });
  return rules;
}

/* ───────────────────────── Writing ───────────────────────── */

// Finds the friend's row, double-checking the name in case the sheet was re-sorted.
function resolveRow_(sheet, cols, row, name) {
  const nameCol = colFor_(cols, 'name').col;
  const want = String(name).trim();
  if (row >= 2 && row <= sheet.getLastRow() && String(sheet.getRange(row, nameCol).getDisplayValue()).trim() === want) return row;
  const last = lastNameRow_(sheet, cols);
  if (last >= 2) {
    const names = sheet.getRange(2, nameCol, last - 1, 1).getDisplayValues();
    const i = names.findIndex(r => String(r[0]).trim() === want);
    if (i >= 0) return i + 2;
  }
  throw new Error('Couldn\'t find "' + want + '" in the sheet. Try refreshing.');
}

function ensureColumn_(sheet, cols, key) {
  const existing = colFor_(cols, key);
  if (existing) return existing;
  if (!EXTRA_COLUMNS[key]) return null;
  const col = sheet.getLastColumn() + 1;
  if (col > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
  sheet.getRange(1, col).setValue(EXTRA_COLUMNS[key]);
  const info = { key: key, label: EXTRA_COLUMNS[key], col: col, computed: false, date: /date|last/.test(key) };
  cols.push(info);
  return info;
}

// Turns what the app sends (always strings) into what the sheet should hold.
function toCellValue_(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], 12); // noon avoids timezone edge cases
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.charAt(0) === '=') return "'" + s; // never let typed text become a formula
  return s;
}

function writeCell_(range, key, value) {
  const existing = range.getFormula();
  if (key === 'photo' && /^=\s*IMAGE/i.test(existing) && /^https?:\/\//.test(value)) {
    range.setFormula('=IMAGE("' + String(value).replace(/"/g, '') + '")');
  } else {
    range.setValue(toCellValue_(value));
  }
}

/**
 * changesJson: {"lastcontacted": "2026-10-28", "tags": "climbing, uni"}
 * Dates travel as yyyy-mm-dd. Formula-driven cells are never overwritten.
 */
function updateFields(row, name, changesJson) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = mainSheet_(ss);
    const cols = headerInfo_(sheet);
    const done = applyChanges_(sheet, cols, row, name, JSON.parse(changesJson));
    return JSON.stringify({ ok: true, row: done.row, skipped: done.skipped });
  } catch (e) {
    return JSON.stringify({ error: e.message || String(e) });
  } finally {
    lock.releaseLock();
  }
}

function applyChanges_(sheet, cols, row, name, changes) {
  const r = resolveRow_(sheet, cols, row, name);
  const skipped = [];
  Object.keys(changes).forEach(key => {
    const c = ensureColumn_(sheet, cols, key);
    if (!c) { skipped.push(key); return; }
    const cell = sheet.getRange(r, c.col);
    if (isComputedFormula_(cell.getFormula())) { skipped.push(c.label); return; }
    writeCell_(cell, key, changes[key]);
  });
  return { row: r, skipped: skipped };
}

// Several friends at once, e.g. marking a whole invite list. updatesJson: [{row, name, changes}]
function updateMany(updatesJson) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = mainSheet_(SpreadsheetApp.getActiveSpreadsheet());
    const cols = headerInfo_(sheet);
    const results = JSON.parse(updatesJson).map(u => {
      try { return applyChanges_(sheet, cols, u.row, u.name, u.changes); } catch (e) { return { error: e.message }; }
    });
    return JSON.stringify({ ok: true, results: results });
  } catch (e) {
    return JSON.stringify({ error: e.message || String(e) });
  } finally {
    lock.releaseLock();
  }
}

function addFriend(fieldsJson) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = mainSheet_(ss);
    const cols = headerInfo_(sheet);
    const fields = JSON.parse(fieldsJson);
    if (!String(fields.name || '').trim()) throw new Error('A name is needed.');
    Object.keys(fields).forEach(k => ensureColumn_(sheet, cols, k));

    const prev = lastNameRow_(sheet, cols);
    const r = prev + 1;
    if (r > sheet.getMaxRows()) sheet.insertRowAfter(sheet.getMaxRows());
    const lastCol = sheet.getLastColumn();

    // Carry calculated columns down from the row above so scores keep working.
    if (prev >= 2) {
      const above = sheet.getRange(prev, 1, 1, lastCol).getFormulasR1C1()[0];
      const here = sheet.getRange(r, 1, 1, lastCol).getFormulas()[0];
      above.forEach((f, i) => {
        if (isComputedFormula_(f) && !/ARRAYFORMULA/i.test(f) && !here[i]) sheet.getRange(r, i + 1).setFormulaR1C1(f);
      });
    }
    Object.keys(fields).forEach(key => {
      const c = colFor_(cols, key);
      if (!c || fields[key] === '' || fields[key] === null) return;
      writeCell_(sheet.getRange(r, c.col), key, fields[key]);
    });
    return JSON.stringify({ ok: true, row: r });
  } catch (e) {
    return JSON.stringify({ error: e.message || String(e) });
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── Map ───────────────────────── */

function geoSheet_(ss, create) {
  let sheet = ss.getSheetByName(GEO_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(GEO_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['Query', 'Lat', 'Lng', 'Country']]);
    sheet.hideSheet();
  }
  return sheet;
}

// { "london": {lat, lng, country}, "nowhere": null }
function readGeo_(ss) {
  const sheet = geoSheet_(ss, false);
  const geo = {};
  if (!sheet || sheet.getLastRow() < 2) return geo;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(r => {
    const key = String(r[0]).toLowerCase().trim();
    if (key) geo[key] = r[1] === '' ? null : { lat: Number(r[1]), lng: Number(r[2]), country: String(r[3] || '') };
  });
  return geo;
}

// Looks up places (addresses or place tags) and remembers them in the hidden _Geo sheet.
function geocode(queriesJson) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const known = readGeo_(ss);
  const geocoder = Maps.newGeocoder().setRegion('uk');
  const out = {};
  const fresh = [];
  JSON.parse(queriesJson).slice(0, 25).forEach(q => {
    const key = String(q).toLowerCase().trim();
    if (!key) return;
    if (key in known) { out[key] = known[key]; return; }
    let hit = null;
    try {
      const res = geocoder.geocode(String(q));
      if (res.status === 'OK' && res.results.length) {
        const top = res.results[0];
        const country = (top.address_components || []).find(c => c.types.indexOf('country') >= 0);
        hit = { lat: top.geometry.location.lat, lng: top.geometry.location.lng, country: country ? country.short_name : '' };
      }
    } catch (e) { /* quota or network: treat as not found for now */ }
    out[key] = hit;
    fresh.push([key, hit ? hit.lat : '', hit ? hit.lng : '', hit ? hit.country : '']);
  });
  if (fresh.length) {
    const sheet = geoSheet_(ss, true);
    if (!sheet.getRange(1, 4).getValue()) sheet.getRange(1, 4).setValue('Country');
    sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, 4).setValues(fresh);
  }
  return JSON.stringify(out);
}

/* ───────────────────────── History ───────────────────────── */

function hiddenSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.hideSheet();
  }
  return sheet;
}

function readLog_(ss) {
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const cutoff = Utilities.formatDate(new Date(Date.now() - LOG_DAYS * 86400000), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues()
    .filter(r => r[0] && r[1] >= cutoff)
    .map(r => [r[0], r[1], r[2], r[3], Number(r[4]) || 0, r[5]]); // compact: the app turns these back into objects
}

// eventsJson: [{id, date: 'yyyy-mm-dd', name, type, xp, note}]
function logEvents(eventsJson) {
  const events = JSON.parse(eventsJson);
  if (!events.length) return JSON.stringify({ ok: true });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hiddenSheet_(SpreadsheetApp.getActiveSpreadsheet(), LOG_SHEET, ['ID', 'Date', 'Name', 'Type', 'XP', 'Note']);
    // Store the date as text so it never gets reformatted by the sheet's locale.
    const rows = events.map(e => [String(e.id), "'" + e.date, String(e.name), String(e.type), Number(e.xp) || 0, String(e.note || '')]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    return JSON.stringify({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Used by Undo.
function removeEvents(idsJson) {
  const ids = JSON.parse(idsJson);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ ok: true });
    const col = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = col.length - 1; i >= 0; i--) {
      if (ids.indexOf(col[i][0]) >= 0) sheet.deleteRow(i + 2);
    }
    return JSON.stringify({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function readWeeks_(ss) {
  const sheet = ss.getSheetByName(WEEKS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues()
    .filter(r => r[0])
    .map(r => ({ week: r[0], score: Number(r[1]), thriving: Number(r[2]), tracked: Number(r[3]), xp: Number(r[4]) }));
}

// The app saves the current week's score whenever it changes. weekJson: {week: 'yyyy-mm-dd' (Monday), score, thriving, tracked, xp}
function saveWeek(weekJson) {
  const w = JSON.parse(weekJson);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hiddenSheet_(SpreadsheetApp.getActiveSpreadsheet(), WEEKS_SHEET, ['Week', 'Score', 'Thriving', 'Tracked', 'XP']);
    const row = [["'" + w.week, w.score, w.thriving, w.tracked, w.xp]];
    const last = sheet.getLastRow();
    const weeks = last >= 2 ? sheet.getRange(2, 1, last - 1, 1).getDisplayValues() : [];
    const i = weeks.findIndex(r => r[0] === w.week);
    sheet.getRange(i >= 0 ? i + 2 : last + 1, 1, 1, 5).setValues(row);
    return JSON.stringify({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── Helpers ───────────────────────── */

function htmlEsc_(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ───────────────────────── First run ───────────────────────── */

// Gives a brand-new, empty spreadsheet the Main and Rules sheets. Leaves any spreadsheet with data alone.
function setupIfNeeded_(ss) {
  if (ss.getSheetByName(MAIN_SHEET)) return;
  const first = ss.getSheets()[0];
  if (ss.getSheets().length > 1 || first.getLastRow() > 0) return; // has data: use it as it is
  const main = first.setName(MAIN_SHEET);
  main.getRange(1, 1, 1, STARTER_HEADERS.length).setValues([STARTER_HEADERS]).setFontWeight('bold');
  main.setFrozenRows(1);
  const rules = ss.insertSheet(RULES_SHEET);
  rules.getRange(1, 1, STARTER_RULES.length, STARTER_RULES[0].length).setValues(STARTER_RULES);
  rules.getRange(1, 1, 1, STARTER_RULES[0].length).setFontWeight('bold');
  rules.setFrozenRows(1);
}
