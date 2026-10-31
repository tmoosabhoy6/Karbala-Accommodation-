/**
 * Karbala Rooms: live feed of the ACCOMMODATION tab.
 *
 * This small web app reads the accommodation sheet (the .xlsx file in Google
 * Drive) and hands the room calendar to the Karbala Rooms site as JSON. It runs
 * under the Google account that deploys it, so the sheet itself stays private
 * and nobody using the site has to sign in.
 *
 * Setup (once): see apps-script/README.md in the repository.
 */

// The Google Drive file the site shows. This is the ID in the sheet's link:
// https://docs.google.com/spreadsheets/d/<THIS PART>/edit
var FILE_ID = '1GUYbFC11AJfiJsqL8KOWw8RWjdho0BPC';

// The tab with the room calendar. If it is renamed, the first tab whose name
// contains "ACCOM" is used instead.
var SHEET_NAME = 'ACCOMMODATION';

// Dates are worked out in Karbala time.
var TIME_ZONE = 'Asia/Baghdad';

// How many days before and after today are sent to the site.
var DAYS_BEFORE = 14;
var DAYS_AFTER = 60;

// The file's "last changed" time is checked at most this often (ms). Between
// checks every phone gets the same cached answer, which keeps things fast.
var CHECK_EVERY_MS = 4000;

// ---------------------------------------------------------------------------
// Web app entry point

function doGet(e) {
  var body;
  try {
    body = getFeed_((e && e.parameter && e.parameter.fresh) === '1');
  } catch (err) {
    body = JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select "test" and click Run) to give the
// script permission to read the sheet and to see what the site will get.
function test() {
  var json = getFeed_(true);
  var feed = JSON.parse(json);
  Logger.log('Tab: %s, rooms: %s, dates: %s to %s, size: %s KB',
    feed.sheet, feed.rows.length, feed.dates[0], feed.dates[feed.dates.length - 1], Math.round(json.length / 1024));
  Logger.log('First rows: %s', JSON.stringify(feed.rows.slice(0, 3)));
}

// ---------------------------------------------------------------------------
// Caching: the sheet is only read again after it has changed.

function getFeed_(fresh) {
  var cache = CacheService.getScriptCache();
  var now = Date.now();
  var meta = parseJson_(cache.get('meta'));

  if (!fresh && meta && now - meta.checked < CHECK_EVERY_MS) {
    var hit = getChunks_(cache, meta.key);
    if (hit) return hit;
  }

  var file = DriveApp.getFileById(FILE_ID);
  var modified = file.getLastUpdated();
  var today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  // The 5-minute part is a safety net in case Drive is slow to report a change.
  var key = 'feed:' + modified.getTime() + ':' + today + ':' + Math.floor(now / 300000);

  var json = fresh ? null : getChunks_(cache, key);
  if (!json) {
    var lock = LockService.getScriptLock();
    lock.waitLock(60000);
    try {
      json = fresh ? null : getChunks_(cache, key);
      if (!json) {
        var feed = readFeed_(file, today);
        feed.modified = modified.toISOString();
        feed.file = file.getName();
        json = JSON.stringify(feed);
        putChunks_(cache, key, json);
      }
    } finally {
      lock.releaseLock();
    }
  }
  cache.put('meta', JSON.stringify({ key: key, checked: now }), 600);
  return json;
}

// CacheService holds at most 100 KB per entry, so larger answers are split.
function putChunks_(cache, key, text) {
  var size = 90000;
  var parts = {};
  var n = Math.ceil(text.length / size) || 1;
  for (var i = 0; i < n; i++) parts[key + ':' + i] = text.slice(i * size, (i + 1) * size);
  parts[key + ':n'] = String(n);
  cache.putAll(parts, 21600);
}

function getChunks_(cache, key) {
  var n = Number(cache.get(key + ':n'));
  if (!n) return null;
  var names = [];
  for (var i = 0; i < n; i++) names.push(key + ':' + i);
  var got = cache.getAll(names);
  var out = '';
  for (var j = 0; j < n; j++) {
    if (got[names[j]] == null) return null;
    out += got[names[j]];
  }
  return out;
}

function parseJson_(text) {
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Reading the sheet

function readFeed_(file, today) {
  var grid;
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    grid = readNativeSheet_(file.getId());
  } else {
    grid = readXlsx_(file.getBlob());
  }
  return buildFeed(grid, today, DAYS_BEFORE, DAYS_AFTER);
}

// A native Google Sheet (if the file is ever converted).
function readNativeSheet_(id) {
  var ss = SpreadsheetApp.openById(id);
  var tz = ss.getSpreadsheetTimeZone();
  var sheets = ss.getSheets();
  var sheet = ss.getSheetByName(SHEET_NAME);
  for (var s = 0; !sheet && s < sheets.length; s++) {
    if (/accom/i.test(sheets[s].getName())) sheet = sheets[s];
  }
  if (!sheet) throw new Error('No tab called ' + SHEET_NAME + ' in the sheet.');
  var range = sheet.getDataRange();
  var values = range.getValues();
  var shown = range.getDisplayValues();
  var rows = {};
  for (var r = 0; r < values.length; r++) {
    var cells = {};
    var any = false;
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      if (v === '' || v == null) continue;
      if (v instanceof Date) {
        var parts = Utilities.formatDate(v, tz, 'yyyy-MM-dd').split('-');
        cells[c + 1] = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]) / 86400000 + 25569;
      } else if (typeof v === 'number') {
        cells[c + 1] = v;
      } else {
        cells[c + 1] = shown[r][c];
      }
      any = true;
    }
    if (any) rows[r + 1] = cells;
  }
  return { sheet: sheet.getName(), rows: rows };
}

// An .xlsx file (how the sheet is stored today). An .xlsx is a zip of XML
// files; only the accommodation tab and its shared text are read.
function readXlsx_(blob) {
  var copy = blob.copyBlob();
  copy.setContentType('application/zip');
  var files = {};
  Utilities.unzip(copy).forEach(function (part) {
    var name = part.getName();
    if (/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) {
      files[name] = part;
    }
  });
  var text = function (name) { return files[name] ? files[name].getDataAsString('UTF-8') : ''; };
  return parseXlsxParts(text, SHEET_NAME);
}

// ---------------------------------------------------------------------------
// Pure helpers below: no Google services, so they can be tested anywhere.

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, code) {
    switch (code) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        return String.fromCodePoint(code.charAt(1) === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    }
  });
}

// Joins the text runs of a shared string or inline string, skipping phonetic hints.
function runText(xml) {
  var out = '';
  var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  var clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  var m;
  while ((m = re.exec(clean))) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

function columnNumber(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

// text(name) returns the contents of a file inside the .xlsx.
// Returns { sheet, rows: { rowNumber: { columnNumber: string|number } } }.
function parseXlsxParts(text, wantedName) {
  var workbook = text('xl/workbook.xml');
  var rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook) throw new Error('This file does not look like a spreadsheet.');

  var sheets = [];
  var sre = /<sheet\b([^>]*)\/?>/g;
  var m;
  while ((m = sre.exec(workbook))) {
    var nameM = /\bname="([^"]*)"/.exec(m[1]);
    var idM = /\br:id="([^"]*)"/.exec(m[1]);
    if (nameM && idM) sheets.push({ name: decodeXml(nameM[1]), rid: idM[1] });
  }
  var sheet = null;
  for (var i = 0; i < sheets.length && !sheet; i++) if (sheets[i].name === wantedName) sheet = sheets[i];
  for (var j = 0; j < sheets.length && !sheet; j++) if (/accom/i.test(sheets[j].name)) sheet = sheets[j];
  if (!sheet) throw new Error('No tab called ' + wantedName + ' in the sheet.');

  var relRe = /<Relationship\b([^>]*)\/?>/g;
  var target = null;
  while ((m = relRe.exec(rels))) {
    var rid = /\bId="([^"]*)"/.exec(m[1]);
    var tgt = /\bTarget="([^"]*)"/.exec(m[1]);
    if (rid && tgt && rid[1] === sheet.rid) target = tgt[1];
  }
  if (!target) throw new Error('Could not find the ' + sheet.name + ' tab inside the file.');
  target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  var sheetXml = text('xl/' + target);

  var shared = [];
  var sst = text('xl/sharedStrings.xml');
  var siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  while ((m = siRe.exec(sst))) shared.push(m[1] ? runText(m[1]) : '');

  var rows = {};
  var rowRe = /<row\b[^>]*?\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  while ((m = rowRe.exec(sheetXml))) {
    var cells = {};
    var any = false;
    var c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[2]))) {
      if (!c[2]) continue;
      var ref = /\br="([A-Z]+)\d+"/.exec(c[1]);
      if (!ref) continue;
      var type = /\bt="([^"]*)"/.exec(c[1]);
      type = type ? type[1] : 'n';
      var value;
      if (type === 'inlineStr') {
        value = runText(c[2]);
      } else {
        var v = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
        if (!v) continue;
        if (type === 's') value = shared[Number(v[1])];
        else if (type === 'str' || type === 'e') value = decodeXml(v[1]);
        else if (type === 'b') value = v[1] === '1' ? 'TRUE' : 'FALSE';
        else value = Number(v[1]);
      }
      if (value === '' || value == null || (typeof value === 'number' && isNaN(value))) continue;
      cells[columnNumber(ref[1])] = value;
      any = true;
    }
    if (any) rows[Number(m[1])] = cells;
  }
  return { sheet: sheet.name, rows: rows };
}

function serialToIso(serial) {
  var d = new Date(Math.round((serial - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}

function isoToSerial(iso) {
  var p = iso.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v).replace(/\s+/g, ' ').trim();
}

// Turns the grid into what the site needs:
// {
//   ok, sheet, today,
//   dates: ['2026-10-17', ...],          one per day column in the window
//   labels: ['25 Jumadil Ula', ...],     the label above each date (Hijri date)
//   rows: [{ n, info, room, beds, add, add2, runs: [[start, length, text], ...] }]
// }
// runs are consecutive days with the same text, as indexes into dates.
function buildFeed(grid, today, before, after) {
  var rowNums = Object.keys(grid.rows).map(Number).sort(function (a, b) { return a - b; });

  // The date row is the row near the top with the most dates in it.
  var dateRow = 0;
  var best = 0;
  for (var i = 0; i < rowNums.length && rowNums[i] <= 10; i++) {
    var cells = grid.rows[rowNums[i]];
    var count = 0;
    for (var col in cells) {
      var v = cells[col];
      if (Number(col) >= 3 && typeof v === 'number' && v > 36526 && v < 73051) count++;
    }
    if (count > best) { best = count; dateRow = rowNums[i]; }
  }
  if (best < 7) throw new Error('Could not find the row of dates at the top of the ' + grid.sheet + ' tab.');

  var from = isoToSerial(today) - before;
  var to = isoToSerial(today) + after;
  var header = grid.rows[dateRow];
  var labelRow = grid.rows[1] && dateRow > 1 ? grid.rows[1] : {};
  var columns = [];
  var seen = {};
  Object.keys(header).map(Number).sort(function (a, b) { return a - b; }).forEach(function (col) {
    var v = header[col];
    if (col < 3 || typeof v !== 'number') return;
    var day = Math.floor(v);
    if (day < from || day > to || seen[day]) return;
    seen[day] = true;
    columns.push({ col: col, day: day });
  });
  columns.sort(function (a, b) { return a.day - b.day; });

  var rows = [];
  rowNums.forEach(function (n) {
    if (n <= dateRow) return;
    var cells = grid.rows[n];
    var room = cellText(cells[2]);
    if (!room) return;
    var runs = [];
    var prev = null;
    columns.forEach(function (c, idx) {
      var t = cellText(cells[c.col]);
      if (prev && t && prev[2] === t && prev[0] + prev[1] === idx) prev[1]++;
      else if (t) { prev = [idx, 1, t]; runs.push(prev); } else prev = null;
    });
    rows.push({
      n: n,
      info: cellText(cells[1]),
      room: room,
      beds: cellText(cells[3]),
      add: cellText(cells[4]),
      add2: cellText(cells[5]),
      runs: runs,
    });
  });

  return {
    ok: true,
    version: 1,
    sheet: grid.sheet,
    today: today,
    generated: new Date().toISOString(),
    dates: columns.map(function (c) { return serialToIso(c.day); }),
    labels: columns.map(function (c) { return cellText(labelRow[c.col]); }),
    rows: rows,
  };
}
