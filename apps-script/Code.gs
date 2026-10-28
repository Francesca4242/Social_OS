/**
 * Social OS — server side.
 *
 * Lives in Extensions → Apps Script of your Google Sheet, next to Index.html.
 * Deploy as a web app with "Execute as: Me" and "Who has access: Only myself".
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

// Mirrors the app's scoring (Index.html) for the weekly email. Keep the two in step.
const SCORING = {
  contactGoal: { 1: 4, 2: 12, 3: 30, 4: 90, 5: 150, 6: 365 },
  seeMultiplier: { 1: 0.5, 2: 0.75, 3: 1, 4: 1.5, 5: 2, 6: 3 },
  inviteGoal: { 1: 365, 2: 150, 3: 120, 4: 60, 5: 12, 6: 10 },
  inviteSnoozeDays: 14, // someone you invited recently isn't suggested again for this long
  nearKm: 30            // "near" a home base
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
      remindersOn: remindersOn_(),
      prefs: getPrefs_(),
      log: log,
      weeks: weeks,
      email: Session.getEffectiveUser().getEmail(),
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
  say('Reminder emails: ' + (d.remindersOn ? 'on' : 'off'));
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

/* ───────────────────────── Emails & reminders ───────────────────────── */

function isYes_(v) {
  const s = String(v || '').trim().toLowerCase();
  return !!s && ['no', 'n', 'false', '0', 'none', '-', 'nope'].indexOf(s) < 0;
}

// When there are two address columns, prefer the one that looks postal (has a number in it).
function postalAddress_(f) {
  const options = Object.keys(f).filter(k => /address/.test(k) && !/allergy/.test(k)).map(k => String(f[k] || '').trim()).filter(Boolean);
  return options.find(a => /\d/.test(a)) || options[0] || '';
}

function htmlEsc_(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function christmasRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const friends = readFriends_(mainSheet_(ss), ss.getSpreadsheetTimeZone()).friends;
  return friends
    .filter(f => isYes_(f.christmascard) || isYes_(f.christmasgifteffort))
    .sort((a, b) => (parseInt(a.tier, 10) || 9) - (parseInt(b.tier, 10) || 9) || String(a.name).localeCompare(b.name));
}

function emailChristmasList() {
  const rows = christmasRows_();
  const to = Session.getEffectiveUser().getEmail();
  const cards = rows.filter(f => isYes_(f.christmascard));
  const gifts = rows.filter(f => isYes_(f.christmasgifteffort));
  const td = 'style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top;font-size:14px"';
  const body = rows.map(f => '<tr>' +
    '<td ' + td + '><b>' + htmlEsc_(f.name) + '</b><br><span style="color:#888">Tier ' + htmlEsc_(f.tier) + '</span></td>' +
    '<td ' + td + '>' + (isYes_(f.christmascard) ? '💌' : '') + '</td>' +
    '<td ' + td + '>' + htmlEsc_(postalAddress_(f)).replace(/\n/g, '<br>') + '</td>' +
    '<td ' + td + '>' + htmlEsc_(isYes_(f.christmasgifteffort) ? f.christmasgifteffort : '') + '</td>' +
    '<td ' + td + '>' + htmlEsc_(f.futuregiftideas) + '</td>' +
    '<td ' + td + '>' + htmlEsc_(f.giftslastbrought) + '</td>' +
    '</tr>').join('');
  const th = 'style="text-align:left;padding:8px 10px;background:#fff1ec;font-size:12px"';
  const html = '<div style="font-family:Arial,sans-serif;color:#2b2118">' +
    '<h2 style="margin:0 0 4px">🎄 Your Christmas list</h2>' +
    '<p style="margin:0 0 16px;color:#666">' + cards.length + ' cards · ' + gifts.length + ' gifts. ' +
    'The address CSV is attached for printing labels.</p>' +
    '<table style="border-collapse:collapse;width:100%"><tr>' +
    ['Friend', 'Card', 'Address', 'Gift effort', 'Gift ideas', 'Gifts last bought']
      .map(h => '<th ' + th + '>' + h + '</th>').join('') +
    '</tr>' + body + '</table></div>';
  const csvCell = v => '"' + String(v || '').replace(/"/g, '""') + '"';
  const csv = [['Name', 'Address', 'Card', 'Gift effort', 'Gift ideas']].concat(
    rows.map(f => [f.name, postalAddress_(f), isYes_(f.christmascard) ? 'Yes' : '', f.christmasgifteffort, f.futuregiftideas])
  ).map(r => r.map(csvCell).join(',')).join('\n');
  MailApp.sendEmail({
    to: to,
    subject: '🎄 Christmas cards & presents: ' + cards.length + ' cards, ' + gifts.length + ' gifts',
    htmlBody: html,
    attachments: [Utilities.newBlob(csv, 'text/csv', 'christmas-addresses.csv')]
  });
  return 'Sent to ' + to;
}

// Accepts yyyy-mm-dd, dd/mm/yyyy, dd/mm, "14 March", "March 14".
function parseDateParts_(raw) {
  const s = String(raw || '').trim();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const yr = v => v === null || v >= 100 ? v : v + (v > new Date().getFullYear() % 100 ? 1900 : 2000);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s);
  if (m) return { y: yr(m[3] ? +m[3] : null), m: +m[2] - 1, d: +m[1] };
  m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]+([a-z]{3})[a-z]*\.?(?:,?[\s\-\/.]+(\d{4}|\d{2}))?/i.exec(s);
  if (m && months.indexOf(m[2].toLowerCase()) >= 0) return { y: yr(m[3] ? +m[3] : null), m: months.indexOf(m[2].toLowerCase()), d: +m[1] };
  m = /([a-z]{3})[a-z]*\.?[\s\-\/.]+(\d{1,2})(?:st|nd|rd|th)?(?:,?[\s\-\/.]+(\d{4}|\d{2}))?/i.exec(s);
  if (m && months.indexOf(m[1].toLowerCase()) >= 0) return { y: yr(m[3] ? +m[3] : null), m: months.indexOf(m[1].toLowerCase()), d: +m[2] };
  return null;
}

function distanceKm_(a, b) {
  const rad = x => x * Math.PI / 180;
  const h = Math.pow(Math.sin(rad(b.lat - a.lat) / 2), 2) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(rad(b.lng - a.lng) / 2), 2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Distance → the Rules sheet's proximity bands (1 = another country … 6 = walking distance).
// A place tag like "London" is only city-precise, so it never counts as closer than "same city".
function distanceBand_(km, base, loc) {
  const abroad = (base.country && loc.country && base.country !== loc.country) || km > 700;
  const band = abroad ? 1 : km > 400 ? 2 : km > 30 ? 3 : km > 8 ? 4 : km > 1.5 ? 5 : 6;
  return loc.fromTag ? Math.min(band, 4) : band;
}

function friendLocation_(f, geo) {
  const addresses = Object.keys(f).filter(k => /address/.test(k) && !/allergy/.test(k)).map(k => String(f[k] || '').trim()).filter(Boolean);
  const tags = String(f.placetags || '').split(/[,;]/).map(t => t.trim()).filter(Boolean);
  const options = addresses.map(q => ({ q: q, fromTag: false })).concat(tags.map(q => ({ q: q, fromTag: true })));
  for (let i = 0; i < options.length; i++) {
    const g = geo[options[i].q.toLowerCase()];
    if (g) return { lat: g.lat, lng: g.lng, country: g.country, fromTag: options[i].fromTag };
  }
  return null;
}

// The friends near your current home base who are most overdue a meet-up and haven't been invited lately.
function inviteSuggestions_(friends, rules, geo, prefs, limit) {
  const base = (prefs.bases || []).find(b => b.name === prefs.current);
  if (!base) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = raw => {
    const p = parseDateParts_(raw);
    return p && p.y ? Math.max(0, Math.round((today - new Date(p.y, p.m, p.d)) / 86400000)) : null;
  };
  return friends.map(f => {
    const tier = Math.min(parseInt(f.tier, 10) || 0, 6);
    const loc = tier >= 1 && friendLocation_(f, geo);
    if (!loc) return null;
    const km = distanceKm_(base, loc);
    if (km > SCORING.nearKm) return null;
    const band = distanceBand_(km, base, loc);
    const plan = parseDateParts_(f.nextplandate);
    if (plan && plan.y && new Date(plan.y, plan.m, plan.d) >= today) return null;
    if (String(f.nextplan || '').trim() && !plan) return null;
    const invited = daysSince(f.lastinvited);
    if (invited !== null && invited < SCORING.inviteSnoozeDays) return null;
    const tr = rules.tiers[tier] || {}, pr = rules.proximity[band] || {};
    const seeGoal = Math.min(1095, (pr.inviteGoal || SCORING.inviteGoal[band]) * (tr.seeMultiplier || SCORING.seeMultiplier[tier]));
    const seen = daysSince(f.lastseenvideocalled), called = daysSince(f.lastcalled);
    const effective = [seen, called === null ? null : called * 2].filter(x => x !== null);
    const ratio = effective.length ? Math.min.apply(null, effective) / seeGoal : 9;
    if (ratio < 0.8) return null;
    return { f: f, seen: seen, score: (7 - tier) * Math.min(ratio, 9) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Friends past their contact goal, most important first (same idea as the app's "Message" list).
function sayHiSuggestions_(friends, rules, limit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = raw => {
    const p = parseDateParts_(raw);
    return p && p.y ? Math.max(0, Math.round((today - new Date(p.y, p.m, p.d)) / 86400000)) : null;
  };
  return friends.map(f => {
    const tier = Math.min(parseInt(f.tier, 10) || 0, 6);
    if (tier < 1) return null;
    const goal = (rules.tiers[tier] || {}).contactGoal || SCORING.contactGoal[tier];
    const known = [f.lastcontacted, f.lastseenvideocalled, f.lastcalled].map(daysSince).filter(d => d !== null);
    const last = known.length ? Math.min.apply(null, known) : null;
    const ratio = last === null ? 9 : last / goal;
    return ratio >= 1 ? { f: f, last: last, score: (7 - tier) * Math.min(ratio, 9) } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Birthdays in the next two weeks, plus who to invite near your current home base.
function emailWeeklyNudge(skipIfEmpty) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const friends = readFriends_(mainSheet_(ss), tz).friends;
  const prefs = getPrefs_();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = [];
  friends.forEach(f => {
    const b = parseDateParts_(f.birthdaydate);
    if (!b) return;
    let next = new Date(today.getFullYear(), b.m, b.d);
    if (next < today) next = new Date(today.getFullYear() + 1, b.m, b.d);
    const days = Math.round((next - today) / 86400000);
    if (days <= 14) soon.push({ f: f, days: days, next: next, age: b.y && b.y > 1910 ? next.getFullYear() - b.y : null });
  });
  soon.sort((a, b) => a.days - b.days);
  const rules = readRules_(ss);
  const invites = inviteSuggestions_(friends, rules, readGeo_(ss), prefs, 5);
  const inviteNames = invites.map(s => s.f.name);
  const sayHi = sayHiSuggestions_(friends, rules, 8).filter(s => inviteNames.indexOf(s.f.name) < 0).slice(0, 5);
  if (!soon.length && !invites.length && !sayHi.length && skipIfEmpty === true) return 'Nothing to send this week';
  const hiItems = sayHi.map(s => '<li style="margin-bottom:10px"><b>' + htmlEsc_(s.f.name) + '</b>: ' +
    (s.last === null ? 'no catch-ups logged yet' : s.last + ' days since you were in touch') + '</li>').join('');

  const muted = s => '<br><span style="color:#777">' + s + '</span>';
  const bdayItems = soon.map(s => '<li style="margin-bottom:10px"><b>' + htmlEsc_(s.f.name) + '</b>: ' +
    Utilities.formatDate(s.next, tz, 'EEE d MMM') +
    (s.days === 0 ? ' (today!)' : ' (in ' + s.days + ' day' + (s.days === 1 ? '' : 's') + ')') +
    (s.age ? ', turns ' + s.age : '') +
    (s.f.gifteffort ? muted('Gift effort: ' + htmlEsc_(s.f.gifteffort)) : '') +
    (s.f.futuregiftideas ? muted('Ideas: ' + htmlEsc_(s.f.futuregiftideas)) : '') + '</li>').join('');
  const inviteItems = invites.map(s => '<li style="margin-bottom:10px"><b>' + htmlEsc_(s.f.name) + '</b> (tier ' + htmlEsc_(s.f.tier) + '): ' +
    (s.seen === null ? 'no meet-up logged yet' : 'last seen ' + s.seen + ' days ago') +
    (s.f.likes ? muted('Likes: ' + htmlEsc_(s.f.likes)) : '') +
    (s.f.allergydietaryrequirements ? muted('Diet: ' + htmlEsc_(s.f.allergydietaryrequirements)) : '') + '</li>').join('');

  const weeks = readWeeks_(ss).sort((a, b) => a.week < b.week ? -1 : 1);
  const latest = weeks[weeks.length - 1], before = weeks[weeks.length - 2];
  const scoreLine = latest
    ? '<p style="font-size:18px;margin:0 0 16px">💗 Friendship score: <b>' + latest.score + '</b>' +
      (before ? ' (' + (latest.score >= before.score ? '▲ ' : '▼ ') + Math.abs(latest.score - before.score) + ' on the week before)' : '') + '</p>'
    : '';
  const parts = [];
  if (sayHi.length) parts.push(sayHi.length + ' to get in touch with');
  if (soon.length) parts.push(soon.length + ' birthday' + (soon.length === 1 ? '' : 's'));
  if (invites.length) parts.push(invites.length + ' to invite near ' + prefs.current);
  const to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: '🫶 This week: ' + (parts.join(' · ') || 'all quiet'),
    htmlBody: '<div style="font-family:Arial,sans-serif;color:#2b2118">' + scoreLine +
      (hiItems ? '<h2>💬 Get in touch with</h2><ul style="padding-left:18px">' + hiItems + '</ul>' : '') +
      '<h2>🎂 Birthdays coming up</h2><ul style="padding-left:18px">' + (bdayItems || '<li>None in the next two weeks.</li>') + '</ul>' +
      (prefs.current
        ? '<h2>💌 Who to invite near ' + htmlEsc_(prefs.current) + '</h2><ul style="padding-left:18px">' + (inviteItems || '<li>Everyone nearby is up to date.</li>') + '</ul>'
        : '<p style="color:#777">Set a home base in the app to get invite suggestions here.</p>') +
      '</div>'
  });
  return 'Sent to ' + to;
}

// Runs every morning once reminders are switched on in the app.
function dailyJobs() {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const now = new Date();
  if (Utilities.formatDate(now, tz, 'MM-dd') === '11-25') emailChristmasList();
  if (Utilities.formatDate(now, tz, 'u') === '1') emailWeeklyNudge(true); // Mondays
}

// Remembered in script properties, because listing triggers on every load is slow.
function remindersOn_() {
  const stored = PropertiesService.getScriptProperties().getProperty('remindersOn');
  if (stored !== null) return stored === 'true';
  const on = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyJobs');
  PropertiesService.getScriptProperties().setProperty('remindersOn', String(on));
  return on;
}

function setReminders(on) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyJobs')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (on) ScriptApp.newTrigger('dailyJobs').timeBased().everyDays(1).atHour(8).create();
  PropertiesService.getScriptProperties().setProperty('remindersOn', String(!!on));
  return !!on;
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
