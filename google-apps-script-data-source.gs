/**
 * Setu Pharma — Live content source (Specialties + Questions)
 * -------------------------------------------------------------
 * This is a SEPARATE Google Sheet + Apps Script from the one that saves
 * quiz responses (google-apps-script.gs). This one is READ-ONLY from the
 * app's point of view: edit the Sheet, and the next time someone loads
 * the app they get your changes — no code changes, no redeploy.
 *
 * SETUP (5 minutes):
 * 1. Create a new Google Sheet (a fresh one — not the responses sheet).
 * 2. Rename the first tab to exactly "Specialties" with this header row:
 *      name | category
 *    One row per specialty, e.g.:
 *      Cardiologist | Cardiac Care
 *      Diabetologist | Diabetes & Endocrine
 *    The category dropdown in the app is built automatically from the
 *    unique values in the "category" column — no separate list to keep
 *    in sync.
 * 3. Add a second tab named exactly "Questions" with this header row:
 *      specialty | id | question | option1 | option2 | option3 | option4 | answer
 *    - "specialty" must match a name from the Specialties tab exactly,
 *      OR be the literal word "default" for the generic fallback set
 *      used by any specialty that has no questions of its own yet.
 *    - "id" should be unique per row (e.g. card1, card2, ...).
 *    - "answer" is the 0-based index of the correct option: 0, 1, 2 or 3.
 * 4. Extensions ▸ Apps Script. Delete any code, paste ALL of this file.
 * 5. Click Deploy ▸ New deployment ▸ type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6. Copy the Web app URL it gives you.
 * 7. Paste that URL into src/config.js  ->  dataEndpoint: 'PASTE_HERE'
 *
 * If this endpoint is ever unreachable (not deployed yet, sheet deleted,
 * network hiccup), the app quietly falls back to the bundled defaults in
 * src/data/specialties.json and src/data/questions.json, so it never breaks.
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var specialties = readSpecialties(ss);
    var categories = uniqueInOrder(specialties.map(function (s) { return s.category; }));
    var questions = readQuestions(ss);

    var payload = { specialties: specialties, categories: categories, questions: questions };

    return ContentService
      .createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Tolerant tab lookup: case-insensitive, ignores stray spaces, and
// accepts the British "Specialities" spelling too — a mismatched tab
// name here fails SILENTLY (returns empty data) rather than erroring,
// so it's worth being forgiving about it.
function findSheet(ss, candidateNames) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().trim().toLowerCase();
    for (var j = 0; j < candidateNames.length; j++) {
      if (name === candidateNames[j]) return sheets[i];
    }
  }
  return null;
}

function readSpecialties(ss) {
  var sheet = findSheet(ss, ['specialties', 'specialities']);
  if (!sheet) return [];
  // getDisplayValues (not getValues) so a cell showing "6.5%" comes back
  // as the text "6.5%" instead of the underlying number 0.065 — Sheets
  // auto-formats plain-looking numbers/percentages on paste.
  var values = sheet.getDataRange().getDisplayValues();
  values.shift(); // header row
  return values
    .filter(function (row) { return String(row[0] || '').trim(); })
    .map(function (row) {
      return { name: String(row[0]).trim(), category: String(row[1] || '').trim() };
    });
}

function readQuestions(ss) {
  var sheet = findSheet(ss, ['questions']);
  if (!sheet) return {};
  // getDisplayValues so option text like "6.5%" or "5,000" comes back
  // exactly as shown in the Sheet, not as a reformatted raw number.
  var values = sheet.getDataRange().getDisplayValues();
  values.shift(); // header row

  var bank = {};
  values.forEach(function (row, i) {
    var specialty = String(row[0] || '').trim();
    var question = String(row[2] || '').trim();
    if (!specialty || !question) return;

    var options = [row[3], row[4], row[5], row[6]].map(function (v) { return String(v || ''); });
    var answer = Number(row[7]);

    if (!bank[specialty]) bank[specialty] = [];
    bank[specialty].push({
      id: String(row[1] || (specialty + '-' + (i + 1))).trim(),
      q: question,
      options: options,
      answer: answer,
    });
  });
  return bank;
}

function uniqueInOrder(values) {
  var seen = {};
  var out = [];
  values.forEach(function (v) {
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
}
