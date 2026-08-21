/**
 * Cyno Pharma — Booking engine (replaces Cal.com)
 * -------------------------------------------------------------
 * This is the THIRD Apps Script in this project, and it owns everything
 * Cal.com used to do for us:
 *   1. Generates bookable slots from rules in a Sheet (no hard-coded times)
 *   2. Books a slot atomically, so a slot's capacity can never be oversold
 *   3. Creates the Google Calendar event and invites the doctor
 *   4. Emails the confirmation FROM your own Google account
 *   5. Fires a webhook to Pabbly Connect, which sends the WhatsApp message
 *   6. Serves the prize wheel's gift catalog from a Sheet too
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
 * MULTIPLE DOCTORS PER SLOT: the Availability tab has a `capacity` column
 * (F). Leave it blank to inherit Settings ▸ defaultCapacity (starts at 1,
 * i.e. today's one-booking-per-slot behaviour); fill in a number to let
 * that specific row's slots hold that many bookings before greying out —
 * e.g. set the 12:00 row's capacity to 10 while everything else stays at
 * the default. A sheet deployed before this existed just keeps behaving
 * as capacity-1 until you fill the column in.
 *
 * PRIZE WHEEL: `setupSheets` also creates a Gifts tab (tier | id | title |
 * short | desc | emoji | active) — this is now the ONLY source for the
 * wheel; there is no bundled fallback in the app anymore. Add, edit,
 * reorder, deactivate or remove rows there — no redeploy needed, the app
 * re-reads this tab on every load (behind a 5-minute cache). `tier` must
 * be exactly "premium" or "standard". If this tab is empty or the
 * endpoint is unreachable, the wheel has nothing to spin, so keep at
 * least one active row per tier.
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
  gifts: 'Gifts',
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

// The prize catalog only changes when someone edits the Gifts tab, so it can
// sit in cache far longer than slots — 5 minutes just keeps a burst of page
// loads from each re-reading the sheet.
var GIFTS_CACHE_KEY = 'gifts_v1';
var GIFTS_CACHE_TTL_SECONDS = 300;

// ============================================================
//  Web endpoints
// ============================================================

/**
 * GET ?action=slots  ->  the bookable calendar for the next N days.
 * Anything already booked, blacked out, in the past, or inside the
 * minimum-notice window is returned with available:false so the UI can
 * grey it out rather than hide it.
 *
 * GET ?action=gifts  ->  the prize wheel catalog, split into premium/
 * standard tiers, read from the Gifts tab.
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'slots';

    if (action === 'slots') return slotsResponse();
    if (action === 'gifts') return giftsResponse();

    return json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function slotsResponse() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(SLOTS_CACHE_KEY);
  if (cached) return rawJson(cached);

  var body = JSON.stringify({ ok: true, timezone: TZ, days: buildDays() });
  cache.put(SLOTS_CACHE_KEY, body, SLOTS_CACHE_TTL_SECONDS);
  return rawJson(body);
}

function giftsResponse() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(GIFTS_CACHE_KEY);
  if (cached) return rawJson(cached);

  var body = JSON.stringify({ ok: true, gifts: readGifts() });
  cache.put(GIFTS_CACHE_KEY, body, GIFTS_CACHE_TTL_SECONDS);
  return rawJson(body);
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

    // Re-read capacity and the current count fresh, inside the lock, so two
    // doctors racing for the last seat can't both slip through — only the
    // first request to reach here for a slot at its limit gets rejected.
    var capacity = capacityFor(date, time, readAvailability(), readSettings());
    var bookedCount = takenSlotCounts()[slotKey] || 0;
    if (bookedCount >= capacity) {
      return json({ ok: false, reason: 'taken', error: 'That slot is fully booked.' });
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
 * omitted, so the doctor can see the day is filling up. A slot only turns
 * unavailable once its booking count reaches its capacity — see
 * slotTimesFor for where that capacity comes from.
 */
function buildDays() {
  var settings = readSettings();
  var rules = readAvailability();
  var blackouts = readBlackouts();
  var counts = takenSlotCounts();

  var daysAhead = Number(settings.daysAhead) || 14;
  var minNoticeMs = (Number(settings.minNoticeHours) || 0) * 3600 * 1000;
  var earliest = Date.now() + minNoticeMs;

  var days = [];
  var cursor = new Date();

  for (var i = 0; i < daysAhead; i++) {
    var date = ymd(cursor);
    cursor.setDate(cursor.getDate() + 1);

    if (blackouts[date]) continue;

    var slotTimes = slotTimesFor(date, rules, settings);
    if (!slotTimes.length) continue;

    var slots = slotTimes.map(function (t) {
      var key = date + 'T' + t.time;
      var booked = counts[key] || 0;
      var remaining = Math.max(0, t.capacity - booked);
      return {
        time: t.time,
        label: timeLabel(t.time),
        capacity: t.capacity,
        remaining: remaining,
        available: remaining > 0 && slotStart(date, t.time).getTime() >= earliest,
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
 * All start times for one date, from every Availability row for its weekday
 * — each paired with the capacity that row grants it.
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
  var defaultCapacity = Math.floor(Number(settings.defaultCapacity)) || 1;
  var times = [];
  var seen = {};

  rules.forEach(function (rule) {
    if (rule.weekday !== weekday) return;

    var step = rule.gapMinutes || defaultGap;
    var capacity = rule.capacity == null ? defaultCapacity : rule.capacity;
    for (var m = rule.startMin; m + step <= rule.endMin; m += step) {
      var time = minutesToTime(m);
      // Two rows producing the same start time keep whichever comes first —
      // mirrors how overlapping rows already resolve for `active`, rather
      // than guessing whether a second capacity should replace or stack.
      if (!seen[time]) { seen[time] = true; times.push({ time: time, capacity: capacity }); }
    }
  });

  return times.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
}

/** Guards doPost against slots the UI could never legitimately have shown. */
function isRealSlot(date, time) {
  var settings = readSettings();
  if (readBlackouts()[date]) return false;

  var minNoticeMs = (Number(settings.minNoticeHours) || 0) * 3600 * 1000;
  if (slotStart(date, time).getTime() < Date.now() + minNoticeMs) return false;

  return slotTimesFor(date, readAvailability(), settings).some(function (t) { return t.time === time; });
}

/** How many bookings one exact slot can hold; 0 if it isn't a real slot. */
function capacityFor(date, time, rules, settings) {
  var match = slotTimesFor(date, rules, settings).filter(function (t) { return t.time === time; })[0];
  return match ? match.capacity : 0;
}

/** How many non-cancelled bookings currently hold each slot key. */
function takenSlotCounts() {
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
  var counts = {};

  rows.forEach(function (row) {
    var key = normaliseSlotKey(row[0]);
    var status = String(row[COL.status - COL.slotKey] || '').trim().toLowerCase();
    // Anything not explicitly cancelled still occupies a seat — that way a
    // hand-typed row in the sheet counts against the slot too.
    if (key && status !== 'cancelled') counts[key] = (counts[key] || 0) + 1;
  });

  return counts;
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

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getDisplayValues()
    .map(function (r) {
      return {
        weekday: titleCase(String(r[0] || '').trim()),
        startMin: timeToMinutes(r[1]),
        endMin: timeToMinutes(r[2]),
        gapMinutes: Number(r[3]) || 0,
        active: !/^(no|false|0|off)$/i.test(String(r[4] || 'yes').trim()),
        capacity: parseCapacity(r[5]),
      };
    })
    .filter(function (r) {
      return r.active && WEEKDAYS.indexOf(r.weekday) !== -1 && r.endMin > r.startMin;
    });
}

/**
 * Blank means "inherit Settings ▸ defaultCapacity" (null, resolved later in
 * slotTimesFor); an explicit 0 blocks that row's slots outright without
 * having to flip `active` to no. Negative or unparsable values fall back to
 * blank rather than silently opening a slot to unlimited bookings.
 */
function parseCapacity(value) {
  var text = String(value == null ? '' : value).trim();
  if (text === '') return null;
  var n = Math.floor(Number(text));
  return isNaN(n) || n < 0 ? null : n;
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

/**
 * Prize wheel catalog: columns are tier | id | title | short | desc |
 * emoji | active. `tier` must be exactly "premium" or "standard" — any
 * other value (blank, a typo, a note row) is silently skipped rather than
 * crashing the whole wheel over one bad row. Row order is preserved, so
 * dragging rows in the sheet reorders the wheel too.
 */
function readGifts() {
  var sheet = tab(TAB.gifts);
  var out = { premium: [], standard: [] };
  if (!sheet || sheet.getLastRow() < 2) return out;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getDisplayValues().forEach(function (r, i) {
    var tier = String(r[0] || '').trim().toLowerCase();
    if (tier !== 'premium' && tier !== 'standard') return;

    var active = !/^(no|false|0|off)$/i.test(String(r[6] || 'yes').trim());
    if (!active) return;

    var title = String(r[2] || '').trim();
    if (!title) return;

    // SpinWheel matches the winning slice back to a prize by id (see
    // pickWinnerIndex in src/utils/wheel.js), so every row needs one —
    // fall back to a slug of the title, then the row position, so a blank
    // id column still gets something stable rather than colliding on ''.
    var id = String(r[1] || '').trim() || slugify(title) || (tier + '-' + (i + 1));

    out[tier].push({
      id: id,
      title: title,
      short: String(r[3] || '').trim() || title,
      desc: String(r[4] || '').trim(),
      emoji: String(r[5] || '').trim() || '🎁',
    });
  });

  return out;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
// readBlackouts and takenSlotCounts — memoizing the spreadsheet handle turns
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

  seed(ss, TAB.availability, ['weekday', 'start', 'end', 'gapMinutes', 'active', 'capacity'], hourlyBlocks());
  // seed() only creates a tab that doesn't exist yet, so a sheet deployed
  // before `capacity` was added keeps its original 5 columns forever unless
  // something appends the 6th — this is that something. Existing rows and
  // every other column are untouched; new rows just read as blank capacity,
  // i.e. "inherit defaultCapacity", exactly like before this ran.
  ensureColumns(ss.getSheetByName(TAB.availability), ['capacity']);

  seed(ss, TAB.blackouts, ['date (yyyy-MM-dd)', 'reason'], [['2026-08-15', 'Independence Day']]);

  seed(ss, TAB.settings, ['key', 'value'], [
    ['brandName', 'Cyno Pharma'],
    ['daysAhead', 14],
    ['gapMinutes', 60],        // spacing between slot start times
    ['meetingMinutes', 30],    // how long the meeting itself runs
    ['minNoticeHours', 4],
    // How many bookings one slot holds when its own Availability row leaves
    // `capacity` blank. Bump a single row instead (e.g. 12:00 to 10) for a
    // slot that should hold more than the rest.
    ['defaultCapacity', 1],
    // No location setting: our rep travels to the doctor, so there is no
    // fixed venue to put on the invite.
    ['meetingTitle', 'Cyno Pharma — Doctor Meeting'],
    ['notifyEmail', ''],
    ['pabblyWebhook', ''],
  ]);
  // Same problem as Availability above, but Settings is key/value rows
  // rather than columns — add the row only if it's genuinely missing.
  ensureSettingRow(ss.getSheetByName(TAB.settings), 'defaultCapacity', 1);

  seed(ss, TAB.bookings, BOOKING_HEADERS, []);
  forceTextColumns(ss.getSheetByName(TAB.bookings));

  seed(ss, TAB.gifts, ['tier', 'id', 'title', 'short', 'desc', 'emoji', 'active'], starterGifts());

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
  // Capacity left blank so every starter row inherits Settings ▸
  // defaultCapacity — edit a specific row's capacity cell to raise just
  // that time slot's limit.
  return [day, pad(hour) + ':00', pad(hour + 1) + ':00', 60, 'yes', ''];
}

/**
 * Seeds the Gifts tab with a starting catalog so a fresh sheet begins with
 * a working wheel instead of an empty one. This tab is the app's only
 * source for gifts now (the old bundled src/data/gifts.json is gone) — add,
 * remove, rename or reorder rows here; the app re-reads this tab on every
 * load.
 */
function starterGifts() {
  return [
    ['premium', 'smart-watch', 'Smart Fitness Watch', 'Smart Watch', 'Health-tracking smartwatch with heart-rate & SpO₂.', '⌚', 'yes'],
    ['premium', 'stethoscope', 'Premium Cardiology Stethoscope', 'Stethoscope', 'Professional dual-head cardiology stethoscope.', '🩺', 'yes'],
    ['premium', 'bp-monitor', 'Digital BP Monitor', 'BP Monitor', 'Clinic-grade automatic blood pressure monitor.', '💗', 'yes'],
    ['premium', 'amazon-2000', '₹2,000 Amazon Gift Card', '₹2000 Card', 'Shop anything you like on Amazon.', '🎁', 'yes'],
    ['premium', 'leather-bag', 'Executive Leather Bag', 'Leather Bag', 'Premium doctor\'s leather laptop bag.', '💼', 'yes'],
    ['premium', 'pulse-oximeter', 'Fingertip Pulse Oximeter', 'Oximeter', 'Accurate SpO₂ and pulse-rate monitor for your clinic.', '🫁', 'yes'],
    ['standard', 'premium-pen', 'Premium Doctor\'s Pen Set', 'Pen Set', 'Elegant metal pen set, engraved.', '🖊️', 'yes'],
    ['standard', 'coffee-voucher', 'Coffee Voucher', 'Coffee ₹200', '₹200 voucher for your favourite café.', '☕', 'yes'],
    ['standard', 'medical-journal', 'Digital Journal Access', 'Journal 3M', '3-month premium clinical journal subscription.', '📚', 'yes'],
    ['standard', 'amazon-500', '₹500 Amazon Gift Card', '₹500 Card', '₹500 shopping voucher.', '🎁', 'yes'],
    ['standard', 'desk-organiser', 'Desk Organiser Set', 'Desk Set', 'Compact organiser with notepad for your desk.', '🗂️', 'yes'],
    ['standard', 'cyno-kit', 'Cyno Care Kit', 'Care Kit', 'Branded mug, notebook and lapel pin.', '🧰', 'yes'],
  ];
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

/**
 * Appends any header from `headers` that row 1 doesn't already have,
 * matched case/whitespace-insensitively so a manually-tweaked header still
 * counts. This is what lets a NEW column show up on a tab that seed()
 * would otherwise never touch again because it already exists. Existing
 * columns, and every existing row's data in them, are left exactly as
 * they were — new cells in the appended column just come back blank.
 */
function ensureColumns(sheet, headers) {
  if (!sheet) return;

  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var have = existing.map(function (h) { return String(h).trim().toLowerCase(); });

  headers.forEach(function (header) {
    if (have.indexOf(header.toLowerCase()) !== -1) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    have.push(header.toLowerCase());
  });
}

/** Same idea as ensureColumns, but for a key/value Settings-style tab. */
function ensureSettingRow(sheet, key, value) {
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
      .map(function (r) { return String(r[0]).trim().toLowerCase(); });
    if (keys.indexOf(key.toLowerCase()) !== -1) return;
  }

  sheet.appendRow([key, value]);
}
