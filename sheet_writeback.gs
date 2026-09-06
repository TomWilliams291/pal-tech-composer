// PAL Tech Composer — score write-back endpoint (Google Apps Script).
//
// Bound to the canonical tech roster Sheet.  Lets the Tech Composer PWA save a
// score straight into the Sheet, so the Sheet stays the single shared source of
// truth while the app is the convenient surface for changing scores.
//
// Deploy (once, from the account that owns the Sheet):
//   1. Open the roster Sheet -> Extensions -> Apps Script.
//   2. Replace the default Code.gs with this file.  Save.
//   3. (Optional) Project Settings -> Script Properties -> add PAL_TOKEN = <any
//      secret>.  When set, every request must carry the same token.
//   4. Deploy -> New deployment -> type "Web app":
//        Execute as:      Me
//        Who has access:  Anyone
//      Copy the Web app URL (https://script.google.com/macros/s/.../exec).
//   5. Paste that URL into the Tech Composer -> Settings -> "Score write-back
//      URL" (and the token, if you set one).  Or bake it into index.html as
//      DEFAULT_WRITEBACK_URL so every navigator gets it without setup.
//   After editing this script, Deploy -> Manage deployments -> edit -> new
//   version, otherwise the live URL keeps running the old code.
//
// Protocol (JSON in, JSON out):
//   GET  ?action=get[&token=..]
//   POST {"action":"get"}                         -> {ok:true, scores:{name:{bat,svc}}}
//   POST {"action":"set","name":..,"field":"bat"|"svc","value":1..5|1..3|""}
//                                                 -> {ok:true, scores:{...}}   (scores = whole sheet, after the write)
//        A tech carries exactly ONE score, in the column their current role
//        uses: writing a non-blank Battery score blanks that tech's Other SVC
//        cell, and vice versa.  Techs start as road service (Other SVC score),
//        then move to battery installer / battery tech (Battery score); the
//        old-role score used to linger unseen because the app only shows the
//        column for the current role.
//   GET  ?action=set&name=..&field=..&value=..    -> same (fallback when POST is blocked)
//   Any failure                                   -> {ok:false, error:"..."}
//
// Column matching mirrors index.html/parseCsv: headers are matched on TEXT, not
// position.  Name = header containing "name"; Battery Score = "score" + "batt";
// Other SVC Score = "score" (not "batt") + one of "svc" / "other" / "road".

// gid of the roster tab (from the published-CSV URL's gid=...).  Set to null to
// use whichever tab has a score column in its header row.
var SHEET_GID = 831374063;

var BAT_MAX = 5;
var SVC_MAX = 3;

function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var req = {};
  try {
    if (e && e.postData && e.postData.contents) req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ok: false, error: 'bad JSON body: ' + err});
  }
  // Query-string params are a fallback carrier for the same fields.
  if (e && e.parameter) {
    for (var k in e.parameter) if (req[k] === undefined) req[k] = e.parameter[k];
  }
  return handle_(req);
}

function handle_(req) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('PAL_TOKEN');
    if (expected && String(req.token || '') !== expected) {
      return json_({ok: false, error: 'bad token'});
    }
    var action = String(req.action || 'get').toLowerCase();
    if (action === 'get') return json_({ok: true, scores: readScores_()});
    if (action === 'set') return json_(setScore_(req));
    return json_({ok: false, error: 'unknown action: ' + action});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message ? err.message : err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet access ──────────────────────────────────────────────────────────────

function layout_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheet = null;
  if (SHEET_GID != null) {
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === SHEET_GID) { sheet = sheets[i]; break; }
    }
  }
  if (!sheet) {
    for (var j = 0; j < sheets.length; j++) {
      var hdr = headerOf_(sheets[j]);
      if (hdr.some(function (h) { return h.indexOf('score') >= 0; })) { sheet = sheets[j]; break; }
    }
  }
  if (!sheet) throw new Error('roster tab not found (SHEET_GID=' + SHEET_GID + ')');
  var header = headerOf_(sheet);
  var ixName = findIndex_(header, function (h) { return h.indexOf('name') >= 0; });
  var ixBat  = findIndex_(header, function (h) { return h.indexOf('score') >= 0 && h.indexOf('batt') >= 0; });
  var ixSvc  = findIndex_(header, function (h) {
    return h.indexOf('score') >= 0 && h.indexOf('batt') < 0 &&
      (h.indexOf('svc') >= 0 || h.indexOf('other') >= 0 || h.indexOf('road') >= 0);
  });
  if (ixName < 0) throw new Error('no "Canonical Name" column in header row');
  if (ixBat < 0 && ixSvc < 0) throw new Error('no "Battery Score" / "Other SVC Score" column in header row');
  return {sheet: sheet, ixName: ixName, ixBat: ixBat, ixSvc: ixSvc};
}

function headerOf_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (v) { return String(v == null ? '' : v).trim().toLowerCase(); });
}

function findIndex_(arr, pred) {
  for (var i = 0; i < arr.length; i++) if (pred(arr[i])) return i;
  return -1;
}

function cell_(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (s === '') return '';
  var n = parseInt(s, 10);
  return isNaN(n) ? '' : String(n);
}

// {name: {bat: '3', svc: ''}} for every non-blank name on the tab.
function readScores_() {
  var L = layout_();
  var lastRow = L.sheet.getLastRow();
  var out = {};
  if (lastRow < 2) return out;
  var lastCol = L.sheet.getLastColumn();
  var rows = L.sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var r = 0; r < rows.length; r++) {
    var name = String(rows[r][L.ixName] == null ? '' : rows[r][L.ixName]).trim();
    if (!name) continue;
    var rec = {};
    if (L.ixBat >= 0) rec.bat = cell_(rows[r][L.ixBat]);
    if (L.ixSvc >= 0) rec.svc = cell_(rows[r][L.ixSvc]);
    out[name] = rec;
  }
  return out;
}

function setScore_(req) {
  var name  = String(req.name || '').trim();
  var field = String(req.field || '').toLowerCase();
  var raw   = req.value == null ? '' : String(req.value).trim();
  if (!name) return {ok: false, error: 'name required'};
  if (field !== 'bat' && field !== 'svc') return {ok: false, error: 'field must be bat or svc'};
  var max = field === 'bat' ? BAT_MAX : SVC_MAX;
  var value = '';
  if (raw !== '') {
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 1 || n > max) return {ok: false, error: 'value must be 1-' + max + ' or blank'};
    value = n;
  }

  // Serialise concurrent writers (several navigators can be in the app at once).
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var L = layout_();
    var ixCol = field === 'bat' ? L.ixBat : L.ixSvc;
    if (ixCol < 0) return {ok: false, error: 'the Sheet has no ' + (field === 'bat' ? 'Battery Score' : 'Other SVC Score') + ' column'};
    var lastRow = L.sheet.getLastRow();
    if (lastRow < 2) return {ok: false, error: 'sheet is empty'};
    var names = L.sheet.getRange(2, L.ixName + 1, lastRow - 1, 1).getValues();
    var needle = name.toLowerCase();
    var rowIx = -1;
    for (var r = 0; r < names.length; r++) {
      if (String(names[r][0] == null ? '' : names[r][0]).trim().toLowerCase() === needle) { rowIx = r; break; }
    }
    if (rowIx < 0) return {ok: false, error: '"' + name + '" is not on the roster Sheet'};
    L.sheet.getRange(rowIx + 2, ixCol + 1).setValue(value);
    // One score per tech: a real score in one column clears the other column
    // (a stale score from the tech's previous role).  Clearing a score (blank)
    // leaves the other column alone.
    var ixOther = field === 'bat' ? L.ixSvc : L.ixBat;
    if (value !== '' && ixOther >= 0) {
      L.sheet.getRange(rowIx + 2, ixOther + 1).setValue('');
    }
    SpreadsheetApp.flush();
    return {ok: true, scores: readScores_()};
  } finally {
    lock.releaseLock();
  }
}
