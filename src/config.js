// ============================================================
//  CYNO PHARMA — App configuration
//  Edit these values. No need to touch component code.
// ============================================================

export const CONFIG = {
  // Brand
  brandName: 'Cyno Pharma',
  tagline: 'Connecting Care with Knowledge',

  // Number of questions each doctor gets (randomly picked from the set)
  questionsPerQuiz: 3,

  // ---- Live content source (specialties, categories, questions) ----
  // Leave EMPTY ('') to use the bundled defaults in src/data/*.json.
  // Paste a Google Apps Script Web App URL here (see
  // google-apps-script-data-source.gs) to drive specialties/categories/
  // questions from a Google Sheet instead — edit the Sheet, no redeploy
  // needed. If this URL is unreachable, the app falls back to the
  // bundled defaults automatically.
  dataEndpoint: 'https://script.google.com/macros/s/AKfycbyTmIBApKgWTFJhkyXc4X4AJpUmFByQyGLQtwFR1purc-3BNiLTe-dYwfPW_hofYhDw/exec',

  // ---- Google Sheet saving ----
  // Leave EMPTY ('') to save responses in the browser (localStorage) only.
  // Paste your Google Apps Script Web App URL here to save into a live Google Sheet.
  // Setup steps are in README.md.
  sheetEndpoint: 'https://script.google.com/macros/s/AKfycbyBchtd9n5qQiE3m3fw450V7V8RnAKsfx5DhSUstOIZO_7UTE8l9KvjUiug8frsD9sd/exec',

  // ---- Cal.com scheduling ----
  // Your Cal.com event link — just the part AFTER cal.com/
  // 'abhhiiiii/30min'  -> books that one event type directly (fewer clicks)
  // 'abhhiiiii'        -> shows your full booking page, doctor picks the event
  // No API key needed: the embed uses your public booking page.
  calLink: 'abhishek-jain/30min',
}
