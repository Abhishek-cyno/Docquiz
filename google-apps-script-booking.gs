/**
 * Cyno Pharma — Booking engine (replaces Cal.com)
 * -------------------------------------------------------------
 * This is the THIRD Apps Script in this project, and it owns everything
 * Cal.com used to do for us:
 *   1. Generates bookable slots from rules in a Sheet (no hard-coded times)
 *   2. Books a slot atomically, so the same slot can never go out twice
 *   3. Creates the Google Calendar event and invites the doctor
 *   4. Emails the confirmation FROM your own Google account
 *   5. Fires a webhook to Pabbly Connect, which sends the WhatsApp message
 *
 * SETUP:
 * 1. Create a new Google Sheet (a fresh one — not the responses sheet and
 *    not the content sheet).
 * 2. Extensions ▸ Apps Script. Delete any code, paste ALL of this file.
 * 3. Project Settings ▸ tick "Show appsscript.json", then set the project
 *    timezone to (GMT+05:30) India Standard Time. Slot maths below pins
 *    +05:30 explicitly anyway, but the Calendar event honours project time.
 * 4. Services ▸ + ▸ Calendar API ▸ Add (keep the identifier `Calendar`).
 *    These meetings are in person, and this lets the script remove the
 *    Google Meet link that Google otherwise attaches automatically.
 *    ALSO untick: Google Calendar ▸ Settings ▸ Event settings ▸
 *    "Automatically add Google Meet video conferences to events I create".
 * 5. Run the `setupSheets` function once (Run ▸ setupSheets). It creates
 *    the Availability / Blackouts / Bookings / Settings tabs with headers
 *    and sensible starter rows, and asks for the permissions this script
 *    needs (Sheets, Calendar, Gmail, external requests). Approve them.
 * 6. Open the Settings tab and fill in `notifyEmail` and `pabblyWebhook`.
 * 7. Deploy ▸ New deployment ▸ type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 8. Copy the Web app URL into src/config.js -> bookingEndpoint.
 *
 * IMPORTANT: after ANY edit to this file you must Deploy ▸ Manage
 * deployments ▸ edit ▸ Version: New version. Saving alone does not
 * update the live URL.
 */

// India has no DST, so a fixed offset is safe and sidesteps every
// "which timezone is this Date in?" bug that slot pickers are famous for.
var TZ = 'Asia/Kolkata';
var TZ_OFFSET = '+05:30';

var TAB = {
  availability: 'Availability',
  blackouts: 'Blackouts',
  bookings: 'Bookings',
  settings: 'Settings',
};

var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

var BOOKING_HEADERS = [
  'Booked At', 'Ref', 'Slot Key', 'Date', 'Time', 'Status',
  'Name', 'Email', 'Phone', 'Specialty', 'Category',
  'Score', 'Total', 'Percent', 'Gift', 'Answers (JSON)', 'Calendar Event ID',
  // Appended at the end so already-deployed Bookings sheets keep every
  // existing column where it is.
  'Has Clinic',
];

// Column indexes into BOOKING_HEADERS, 0-based. Used when reading rows back.
var COL = { slotKey: 2, status: 5 };

// The slots response only changes when someone books (or a script edit
// changes Availability/Blackouts/Settings), so short-lived caching turns
// most GETs into a cache read instead of four sheet reads + rebuilding 14
// days of slots. doPost clears this the instant a booking lands, so nobody
// sees a stale "available" for longer than it takes the lock to release.
var SLOTS_CACHE_KEY = 'slots_v1';
// The client's own background refresh runs every 60s (see SchedulePage.jsx),
// so anything under that still guarantees a genuinely fresh rebuild at least
// once per poll cycle — this just absorbs the bursts of requests in between
// (page loads, focus events, several doctors on the page at once).
var SLOTS_CACHE_TTL_SECONDS = 30;

// ============================================================
//  Web endpoints
// ============================================================

/**
 * GET ?action=slots  ->  the bookable calendar for the next N days.
 * Anything already booked, blacked out, in the past, or inside the
 * minimum-notice window is returned with available:false so the UI can
 * grey it out rather than hide it.
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'slots';
    if (action !== 'slots') return json({ ok: false, error: 'Unknown action: ' + action });

    var cache = CacheService.getScriptCache();
    var cached = cache.get(SLOTS_CACHE_KEY);
    if (cached) return rawJson(cached);

    var body = JSON.stringify({ ok: true, timezone: TZ, days: buildDays() });
    cache.put(SLOTS_CACHE_KEY, body, SLOTS_CACHE_TTL_SECONDS);
    return rawJson(body);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * POST { action:'book', ... }  ->  claims a slot.
 *
 * The client greys out taken slots, but that display is always a little
 * stale — two doctors on the page at once will both see the same slot as
 * free. So the check that actually matters happens here, inside a script
 * lock: re-read the sheet, and only append if the slot is still genuinely
 * open. The loser gets {ok:false, reason:'taken'} and picks again.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action && data.action !== 'book') {
      return json({ ok: false, error: 'Unknown action: ' + data.action });
    }

    var invalid = validate(data);
    if (invalid) return json({ ok: false, reason: 'invalid', error: invalid });

    var date = String(data.date).trim();          // yyyy-MM-dd
    var time = String(data.time).trim();          // HH:mm
    var slotKey = date + 'T' + time;

    // Never trust the client's idea of what a valid slot is — regenerate
    // the real ones and confirm this is among them. Otherwise anyone can
    // POST 03:00 on a Sunday and land a row in the sheet.
    if (!isRealSlot(date, time)) {
      return json({ ok: false, reason: 'invalid', error: 'That time is not a bookable slot.' });
    }

    // 30s is generous; a booking append takes well under a second. If we
    // genuinely cannot get the lock, failing is far better than racing.
    if (!lock.tryLock(30000)) {
      return json({ ok: false, reason: 'busy', error: 'Server busy, please try again.' });
    }

    if (takenSlotKeys()[slotKey]) {
      return json({ ok: false, reason: 'taken', error: 'That slot was just booked by someone else.' });
    }

    var ref = makeRef();
    var eventId = '';

    // Calendar first so its id lands in the same row. If Calendar fails we
    // still want the booking recorded — losing the slot reservation over a
    // calendar hiccup would be much worse than a missing invite.
    try {
      eventId = createCalendarEvent(data, date, time);
    } catch (calErr) {
      console.error('Calendar event failed for ' + ref + ': ' + calErr);
    }

    bookingsSheet().appendRow([
      new Date(), ref, slotKey, date, time, 'confirmed',
      data.name || '', data.email || '', data.phone || '',
      data.specialty || '', data.category || '',
      data.score, data.total, data.percent,
      data.gift || '', JSON.stringify(data.answers || []), eventId,
      data.clinic || '',
    ]);

    // The slot is safely ours from here, so let go of the lock before the
    // slow stuff. Mail and webhooks take seconds; holding the lock through
    // them would queue up every other doctor trying to book.
    lock.releaseLock();

    // Otherwise the next doctor's slot grid would still show this slot as
    // open for up to SLOTS_CACHE_TTL_SECONDS.
    try { CacheService.getScriptCache().remove(SLOTS_CACHE_KEY); } catch (cacheErr) {}

    var labels = { date: dateLabel(date), time: timeLabel(time) };

    try { sendEmails(data, date, time, labels, ref); }
    catch (mailErr) { console.error('Email failed for ' + ref + ': ' + mailErr); }

    try { notifyPabbly(data, date, time, labels, ref); }
    catch (waErr) { console.error('Pabbly webhook failed for ' + ref + ': ' + waErr); }

    return json({
      ok: true,
      ref: ref,
      date: date,
      time: time,
      dateLabel: labels.date,
      timeLabel: labels.time,
      timezone: TZ,
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    // releaseLock on a lock we never took, or already released, is a no-op.
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function validate(data) {
  if (!data) return 'Empty request.';
  if (!String(data.name || '').trim()) return 'Name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email || '').trim())) return 'A valid email is required.';
  if (digitsOnly(data.phone).length < 10) return 'A valid WhatsApp number is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '').trim())) return 'Pick a date.';
  if (!/^\d{2}:\d{2}$/.test(String(data.time || '').trim())) return 'Pick a time.';
  return null;
}

// ============================================================
//  Slot generation
// ============================================================

/**
 * Expands the Availability rules into concrete days and slots, then marks
 * each slot available or not. Booked slots are returned rather than
 * omitted, so the doctor can see the day is filling up.
 */
function buildDays() {
  var settings = readSettings();
  var rules = readAvailability();
  var blackouts = readBlackouts();
  var taken = takenSlotKeys();

  var daysAhead = Number(settings.daysAhead) || 14;
  var minNoticeMs = (Number(settings.minNoticeHours) || 0) * 3600 * 1000;
  var earliest = Date.now() + minNoticeMs;

  var days = [];
  var cursor = new Date();

  for (var i = 0; i < daysAhead; i++) {
    var date = ymd(cursor);
    cursor.setDate(cursor.getDate() + 1);

    if (blackouts[date]) continue;

    var times = slotTimesFor(date, rules, settings);
    if (!times.length) continue;

    var slots = times.map(function (time) {
      var key = date + 'T' + time;
      return {
        time: time,
        label: timeLabel(time),
        available: !taken[key] && slotStart(date, time).getTime() >= earliest,
      };
    });

    days.push({
      date: date,
      weekday: weekdayOf(date),
      label: dateLabel(date),
      shortLabel: Utilities.formatDate(slotStart(date, '12:00'), TZ, 'd MMM'),
      slots: slots,
      openCount: slots.filter(function (s) { return s.available; }).length,
    });
  }

  return days;
}

/**
 * All start times for one date, from every Availability row for its weekday.
 *
 * Note that the step here is the GAP between start times, not how long the
 * meeting runs. A 60-minute gap with a 30-minute meeting gives 10:00 and
 * 11:00, each half an hour long — so there is breathing room between calls.
 * Meeting length is `meetingMinutes` in Settings, used only by the Calendar
 * event.
 */
function slotTimesFor(date, rules, settings) {
  var weekday = weekdayOf(date);
  var defaultGap = Number(settings.gapMinutes || settings.slotMinutes) || 60;
  var times = [];
  var seen = {};

  rules.forEach(function (rule) {
    if (rule.weekday !== weekday) return;

    var step = rule.gapMinutes || defaultGap;
    for (var m = rule.startMin; m + step <= rule.endMin; m += step) {
      var time = minutesToTime(m);
      if (!seen[time]) { seen[time] = true; times.push(time); }
    }
  });

  return times.sort();
}

/** Guards doPost against slots the UI could never legitimately have shown. */
function isRealSlot(date, time) {
  var settings = readSettings();
  if (readBlackouts()[date]) return false;

  var minNoticeMs = (Number(settings.minNoticeHours) || 0) * 3600 * 1000;
  if (slotStart(date, time).getTime() < Date.now() + minNoticeMs) return false;

  return slotTimesFor(date, readAvailability(), settings).indexOf(time) !== -1;
}

/** Every slot key currently held by a non-cancelled booking. */
function takenSlotKeys() {
  var sheet = bookingsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  // Only Slot Key (C) through Status (F) are needed here, but the full row
  // also carries name/email/phone/the Answers JSON blob/etc — the biggest
  // field in the sheet, once per booking ever made. Reading the full 18
  // columns for every row means this call gets slower with every booking a
  // sheet accumulates, for data none of it uses. This grows only 4 columns
  // wide instead.
  var width = COL.status - COL.slotKey + 1;
  var rows = sheet.getRange(2, COL.slotKey + 1, lastRow - 1, width).getValues();
  var taken = {};

  rows.forEach(function (row) {
    var key = normaliseSlotKey(row[0]);
    var status = String(row[COL.status - COL.slotKey] || '').trim().toLowerCase();
    // Anything not explicitly cancelled still occupies the slot — that way
    // a hand-typed row in the sheet blocks the time too.
    if (key && status !== 'cancelled') taken[key] = true;
  });

  return taken;
}

/**
 * Sheets is eager about dates: write the string "2026-08-04T15:30" into a
 * normal cell and it may well come back as a Date object, which would then
 * never match a freshly built key — and every slot would look free. The
 * Bookings tab is created with these columns forced to plain text, but this
 * also repairs rows typed by hand or pasted into an unformatted column.
 */
function normaliseSlotKey(value) {
  if (value instanceof Date) return Utilities.formatDate(value, TZ, "yyyy-MM-dd'T'HH:mm");
  return String(value == null ? '' : value).trim();
}

// ============================================================
//  Calendar, email, WhatsApp
// ============================================================

function createCalendarEvent(data, date, time) {
  var settings = readSettings();
  var start = slotStart(date, time);
  // How long the meeting actually runs — deliberately not the slot gap, so
  // a 30-minute call can sit inside an hourly slot with time to spare.
  var end = new Date(start.getTime() + (Number(settings.meetingMinutes) || 30) * 60000);

  var title = (settings.meetingTitle || 'Doctor Meeting') + ' — ' + (data.name || 'Doctor');

  // Deliberately created WITHOUT the guest. Google can be configured to bolt
  // a Meet link onto every event an account creates, and the invite email
  // goes out the instant a guest is attached — so the link would already be
  // in the doctor's inbox before we could remove it. Create it quietly,
  // strip any Meet link, and only then invite the doctor.
  //
  // No location set either: our rep travels to the doctor, and we don't
  // collect the address yet. Coordinate over the phone number below.
  var event = CalendarApp.getDefaultCalendar().createEvent(title, start, end, {
    description: [
      'Doctor: ' + (data.name || ''),
      'Specialty: ' + (data.specialty || '') + ' (' + (data.category || '') + ')',
      'Email: ' + (data.email || ''),
      'WhatsApp: ' + (data.phone || ''),
      'Quiz score: ' + data.score + '/' + data.total + ' (' + data.percent + '%)',
      'Gift to carry: ' + (data.gift || '—'),
    ].join('\n'),
  });

  stripMeetLink(event);

  if (data.email) event.addGuest(data.email);

  return event.getId();
}

/**
 * These meetings happen in person, so an auto-attached Google Meet link is
 * just confusing — remove it.
 *
 * CalendarApp has no API for conference data, so this needs the Advanced
 * Calendar Service: in the editor, Services ▸ + ▸ Calendar API ▸ Add (leave
 * the identifier as `Calendar`). Without it this quietly does nothing, and
 * the fix is instead to untick Google Calendar ▸ Settings ▸ Event settings ▸
 * "Automatically add Google Meet video conferences to events I create".
 */
function stripMeetLink(event) {
  if (typeof Calendar === 'undefined') return;   // advanced service not enabled

  try {
    // getId() returns "<id>@google.com"; the API wants just the id part.
    var eventId = String(event.getId()).split('@')[0];
    Calendar.Events.patch(
      { conferenceData: null },
      'primary',
      eventId,
      { conferenceDataVersion: 1, sendUpdates: 'none' }
    );
  } catch (err) {
    console.error('Could not strip Meet link: ' + err);
  }
}

function sendEmails(data, date, time, labels, ref) {
  var settings = readSettings();
  var brand = settings.brandName || 'Cyno Pharma';

  // MailApp sends as the Google account that owns this script, so the
  // doctor sees your address in the From line — no SMTP, no third party.
  MailApp.sendEmail({
    to: data.email,
    name: brand,
    subject: 'Your meeting is confirmed — ' + labels.date + ', ' + labels.time,
    htmlBody: doctorEmailHtml(data, labels, ref, settings),
    body: [
      'Hi ' + (data.name || 'Doctor') + ',',
      '',
      'Your meeting with ' + brand + ' is confirmed. Our representative will',
      'visit you — you do not need to travel anywhere.',
      '',
      'Date: ' + labels.date,
      'Time: ' + labels.time + ' (IST)',
      'Gift: ' + (data.gift || '—') + ' (our representative will bring it along)',
      'Booking reference: ' + ref,
      '',
      'A calendar invite is on its way separately.',
      '',
      brand,
    ].join('\n'),
  });

  if (settings.notifyEmail) {
    MailApp.sendEmail({
      to: settings.notifyEmail,
      name: brand + ' Bookings',
      subject: 'New booking: ' + (data.name || 'Doctor') + ' — ' + labels.date + ' ' + labels.time,
      htmlBody: [
        '<h3>New meeting booked</h3>',
        '<table cellpadding="6" style="border-collapse:collapse;font:14px system-ui">',
        row('Reference', ref),
        row('When', labels.date + ' at ' + labels.time + ' IST'),
        row('Name', data.name),
        row('Email', data.email),
        row('WhatsApp', data.phone),
        row('Specialty', (data.specialty || '') + ' (' + (data.category || '') + ')'),
        row('Quiz score', data.score + '/' + data.total + ' (' + data.percent + '%)'),
        row('Gift to carry', data.gift || '—'),
        '</table>',
      ].join(''),
    });
  }
}

function row(label, value) {
  return '<tr><td style="color:#64748b">' + label + '</td><td><b>' +
    escapeHtml(String(value == null ? '' : value)) + '</b></td></tr>';
}

function doctorEmailHtml(data, labels, ref, settings) {
  var brand = settings.brandName || 'Cyno Pharma';
  return [
    '<div style="font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:520px">',
    '<div style="background:#2563eb;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">',
    '<div style="font-size:20px;font-weight:700">Meeting confirmed ✓</div>',
    '<div style="opacity:.85;font-size:13px;margin-top:4px">' + escapeHtml(brand) + '</div>',
    '</div>',
    '<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:24px">',
    '<p>Hi ' + escapeHtml(data.name || 'Doctor') + ',</p>',
    '<p>Thanks for completing the quiz. Our representative will <b>visit you</b> at the time below — you don\'t need to travel anywhere.</p>',
    '<table cellpadding="8" style="border-collapse:collapse;background:#f8fafc;border-radius:10px;width:100%;margin:16px 0">',
    row('📅 Date', labels.date),
    row('⏰ Time', labels.time + ' IST'),
    row('🎁 Gift', data.gift || '—'),
    row('#️⃣ Reference', ref),
    '</table>',
    '<p style="color:#64748b;font-size:13px">Our representative will bring your gift along. A Google Calendar invite has been sent separately; accept it and the meeting will appear in your calendar. Reply to this email if you need to reschedule.</p>',
    '<p style="margin-bottom:0">— ' + escapeHtml(brand) + '</p>',
    '</div></div>',
  ].join('');
}

/**
 * Hands the booking to Pabbly Connect, which forwards it to Pabbly
 * Chatflow to actually send the WhatsApp template. Keeping the webhook
 * URL in the Settings tab (not in config.js) means it never ships inside
 * the public JS bundle.
 *
 * Field names below are what you map to your Chatflow template variables,
 * so keep them stable once the workflow is wired up.
 */
function notifyPabbly(data, date, time, labels, ref) {
  var settings = readSettings();
  if (!settings.pabblyWebhook) return;

  var payload = {
    event: 'booking_confirmed',
    ref: ref,
    name: data.name || '',
    phone: waNumber(data.phone),          // 919127072000 — what Chatflow wants
    phoneRaw: String(data.phone || ''),
    email: data.email || '',
    specialty: data.specialty || '',
    category: data.category || '',
    date: date,
    time: time,
    dateLabel: labels.date,
    timeLabel: labels.time,
    whenLabel: labels.date + ' at ' + labels.time + ' IST',
    gift: data.gift || '',
    score: data.score,
    total: data.total,
    percent: data.percent,
    brandName: settings.brandName || 'Cyno Pharma',
    timezone: TZ,
  };

  UrlFetchApp.fetch(settings.pabblyWebhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

/** Chatflow expects digits with country code and no +, e.g. 919127072000. */
function waNumber(phone) {
  var digits = digitsOnly(phone);
  if (digits.length === 10) return '91' + digits;          // bare Indian mobile
  if (digits.length === 11 && digits.charAt(0) === '0') return '91' + digits.slice(1);
  return digits;
}

// ============================================================
//  Sheet readers
// ============================================================

function readSettings() {
  var sheet = tab(TAB.settings);
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
    var key = String(r[0] || '').trim();
    if (key) out[key] = String(r[1] || '').trim();
  });
  return out;
}

function readAvailability() {
  var sheet = tab(TAB.availability);
  if (!sheet || sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues()
    .map(function (r) {
      return {
        weekday: titleCase(String(r[0] || '').trim()),
        startMin: timeToMinutes(r[1]),
        endMin: timeToMinutes(r[2]),
        gapMinutes: Number(r[3]) || 0,
        active: !/^(no|false|0|off)$/i.test(String(r[4] || 'yes').trim()),
      };
    })
    .filter(function (r) {
      return r.active && WEEKDAYS.indexOf(r.weekday) !== -1 && r.endMin > r.startMin;
    });
}

function readBlackouts() {
  var sheet = tab(TAB.blackouts);
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var key = normaliseDate(r[0]);
    if (key) out[key] = true;
  });
  return out;
}

function bookingsSheet() {
  var ss = spreadsheet();
  var sheet = ss.getSheetByName(TAB.bookings);
  if (!sheet) {
    sheet = ss.insertSheet(TAB.bookings);
    sheet.appendRow(BOOKING_HEADERS);
    sheet.setFrozenRows(1);
    forceTextColumns(sheet);
  }
  if (sheet.getLastRow() === 0) sheet.appendRow(BOOKING_HEADERS);
  return sheet;
}

/** Keep Slot Key / Date / Time as literal text — see normaliseSlotKey. */
function forceTextColumns(sheet) {
  sheet.getRange('C:E').setNumberFormat('@');
}

// A single doGet for /slots calls tab() via readSettings, readAvailability,
// readBlackouts and takenSlotKeys — memoizing the spreadsheet handle turns
// four SpreadsheetApp.getActiveSpreadsheet() round-trips into one. (Apps
// Script gives each request a fresh global scope, so this only helps within
// one invocation, not across requests — that's what SLOTS_CACHE_KEY is for.)
function spreadsheet() {
  if (!spreadsheet._ss) spreadsheet._ss = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet._ss;
}

function tab(name) {
  var sheets = spreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === name.toLowerCase()) return sheets[i];
  }
  return null;
}

// ============================================================
//  Time helpers — all fixed to IST, never the script's own locale
// ============================================================

/** A real Date for a slot, pinned to +05:30 so it cannot drift. */
function slotStart(date, time) {
  return new Date(date + 'T' + time + ':00' + TZ_OFFSET);
}

function ymd(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function dateLabel(date) {
  return Utilities.formatDate(slotStart(date, '12:00'), TZ, 'EEE, d MMM yyyy');
}

/** Formatted in IST rather than read off getDay(), which uses the script's
 *  own timezone — a mismatch there would shift availability by a day. */
function weekdayOf(date) {
  return Utilities.formatDate(slotStart(date, '12:00'), TZ, 'EEEE');
}

function timeLabel(time) {
  return Utilities.formatDate(slotStart('2000-01-01', time), TZ, 'h:mm a');
}

function timeToMinutes(value) {
  var text = String(value == null ? '' : value).trim();

  // A cell formatted as a time comes back as a Date, not "10:00".
  if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();

  var m = text.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
  if (!m) return -1;

  var hours = Number(m[1]);
  var meridiem = (m[3] || '').toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return hours * 60 + Number(m[2]);
}

function minutesToTime(total) {
  return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
}

/** Blackout cells may be real dates or typed text — accept both. */
function normaliseDate(value) {
  if (value instanceof Date) return ymd(value);
  var text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function titleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

/** Short, unambiguous reference — no 0/O or 1/I to misread over the phone. */
function makeRef() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < 5; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'CYN-' + out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(obj) {
  return rawJson(JSON.stringify(obj));
}

/** Same response as json(), but for a body that's already a JSON string —
 *  e.g. a cache hit — so it isn't parsed and re-stringified for nothing. */
function rawJson(body) {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  One-time setup — Run ▸ setupSheets
// ============================================================

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  seed(ss, TAB.availability, ['weekday', 'start', 'end', 'gapMinutes', 'active'], hourlyBlocks());

  seed(ss, TAB.blackouts, ['date (yyyy-MM-dd)', 'reason'], [['2026-08-15', 'Independence Day']]);

  seed(ss, TAB.settings, ['key', 'value'], [
    ['brandName', 'Cyno Pharma'],
    ['daysAhead', 14],
    ['gapMinutes', 60],        // spacing between slot start times
    ['meetingMinutes', 30],    // how long the meeting itself runs
    ['minNoticeHours', 4],
    // No location setting: our rep travels to the doctor, so there is no
    // fixed venue to put on the invite.
    ['meetingTitle', 'Cyno Pharma — Doctor Meeting'],
    ['notifyEmail', ''],
    ['pabblyWebhook', ''],
  ]);

  seed(ss, TAB.bookings, BOOKING_HEADERS, []);
  forceTextColumns(ss.getSheetByName(TAB.bookings));

  SpreadsheetApp.getActiveSpreadsheet().toast('Tabs ready. Fill in Settings ▸ notifyEmail and pabblyWebhook.');
}

/**
 * Starter availability, seeded as ONE-HOUR blocks rather than long
 * stretches. A 10:00–13:00 row would produce exactly the same slots, but
 * then dropping just the noon hour means splitting the row in two. With an
 * hour per row you flip `active` to `no` on that single row instead.
 *
 * Each block yields ONE bookable start time, because the gap is 60 minutes.
 * The meeting itself runs 30 minutes (Settings ▸ meetingMinutes), leaving a
 * half-hour buffer before the next doctor.
 */
function hourlyBlocks() {
  var weekdayHours = [10, 11, 12, 15, 16, 17];   // 10am–1pm, then 3pm–6pm
  var saturdayHours = [10, 11];                  // 10am–12pm
  var rows = [];

  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(function (day) {
    weekdayHours.forEach(function (h) { rows.push(block(day, h)); });
  });
  saturdayHours.forEach(function (h) { rows.push(block('Saturday', h)); });

  return rows;
}

function block(day, hour) {
  return [day, pad(hour) + ':00', pad(hour + 1) + ':00', 60, 'yes'];
}

/** Creates a tab with headers if missing; never touches existing data. */
function seed(ss, name, headers, rows) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return;

  sheet = ss.insertSheet(name);
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  rows.forEach(function (r) { sheet.appendRow(r); });
  sheet.autoResizeColumns(1, headers.length);
}
