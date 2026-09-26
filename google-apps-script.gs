/**
 * Cyno Pharma — Google Sheet receiver
 * ------------------------------------
 * This tiny script runs on Google's free servers (NOT your own backend).
 * It receives quiz responses from the React app and appends a row to a Sheet.
 *
 * SETUP (5 minutes):
 * 1. Create a Google Sheet. Note the tab name (default "Sheet1").
 * 2. Extensions ▸ Apps Script. Delete any code, paste ALL of this file.
 * 3. Click Deploy ▸ New deployment ▸ type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copy the Web app URL it gives you.
 * 5. Paste that URL into src/config.js  ->  sheetEndpoint: 'PASTE_HERE'
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
    var data = JSON.parse(e.postData.contents);

    // Add a header row once, if the sheet is empty.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Submitted At', 'Name', 'Specialty', 'Category',
        'Score', 'Total', 'Percent', 'Gift',
        'Meeting Date', 'Meeting Time', 'Answers (JSON)',
        // Appended at the end on purpose: sheets deployed before these
        // columns existed already have the columns above, and inserting a
        // column mid-row would misalign every historical row.
        'Has Clinic', 'Email', 'Phone'
      ]);
    }

    // Phone values arrive as "+91 98765 43210". Plain text prevents
    // Google Sheets from treating the leading + as a formula.
    sheet.getRange('N:N').setNumberFormat('@');

    sheet.appendRow([
      data.submittedAt || new Date().toISOString(),
      data.name || '',
      data.specialty || '',
      data.category || '',
      data.score,
      data.total,
      data.percent,
      data.gift || '',
      data.meetingDate || '',
      data.meetingTime || '',
      JSON.stringify(data.answers || []),
      data.clinic || '',
      data.email || '',
      String(data.phone == null ? '' : data.phone).replace(/\D/g, '').slice(-10)
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
