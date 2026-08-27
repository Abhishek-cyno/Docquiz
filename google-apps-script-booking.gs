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
 *   7. Records contact details for gift winners who have no clinic (so
 *      there's no rep visit to book) into the same Bookings sheet, with
 *      the slot columns left blank and Status "no-visit" — see
 *      registerGift() and ContactPage.jsx
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
 * short | desc | emoji | active | stock | weight) — this is now the ONLY
 * source for the wheel; there is no bundled fallback in the app anymore.
 * Add, edit, reorder, deactivate or remove rows there — no redeploy
 * needed, the app re-reads this tab on every load (behind a 5-minute
 * cache). `tier` must be exactly one of:
 *   - "superpremium" — the rare, jackpot-tier prizes. Only clinic owners
 *     can win these (same audience as "premium"), rendered on the wheel
 *     in gold with a subtle glow so they visibly stand out. Give these a
 *     low `weight` and a small `stock` — they're meant to be rare.
 *   - "premium"  — clinic owners' regular prize pool.
 *   - "standard" — everyone else's regular prize pool.
 *   - "consolation" — a "no real prize" outcome mixed into the standard
 *     pool (e.g. "Better Luck Next Time"), rendered in muted grey. The app
 *     recognises this tier specifically and skips the "your gift is being
 *     delivered" messaging for it — see ThankYouPage.jsx.
 * If this tab is empty or the endpoint is unreachable, the wheel has
 * nothing to spin, so keep at least one active row per tier you use.
 *
 * `stock` is how many units are left. Leave it blank for unlimited; set a
 * number to cap it — the wheel stops offering that gift once it hits 0
 * (same as flipping `active` to no, but automatic). Every spin claims one
 * unit the moment the wheel lands on it (see the `claimGift` action
 * below), under the same lock used for bookings, so two doctors racing for
 * the last unit can't both win it.
 *
 * `weight` sets how likely a gift is relative to the others in its tier —
 * bigger number, more likely. Leave it blank (or 0) to default to 1, i.e.
 * an even chance against every other blank-weight row. These don't need
 * to add up to 100 or any particular total; only the ratio between rows
 * matters, so you can tune one gift's odds without re-balancing every
 * other row.
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
var COL = { ref: 1, slotKey: 2, date: 3, time: 4, status: 5, email: 7, phone: 8, gift: 14 };

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
 *
 * POST { action:'claimGift', id } -> decrements one unit of stock for the
 * gift the wheel just landed on. See claimGift() below.
 *
 * POST { action:'registerGift', name, email, phone, ... } -> records a
 * doctor who won a gift but has no clinic for a rep to visit, so there's no
 * slot to book. See registerGift() below.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'book';

    if (action === 'claimGift') return claimGift(data);
    if (action === 'registerGift') return registerGift(data);
    if (action !== 'book') {
      return json({ ok: false, error: 'Unknown action: ' + action });
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

    // A doctor who already has a live row (by email or phone) gets THAT
    // booking back rather than a second one — see findExistingBooking().
    // This is what stops a replayed quiz from appending a new row every
    // time, whether or not the wheel handed them a different gift this
    // time round.
    var existing = findExistingBooking(data.email, data.phone);
    if (existing) {
      lock.releaseLock();
      return json({
        ok: true,
        alreadyBooked: true,
        ref: existing.ref,
        date: existing.date,
        time: existing.time,
        dateLabel: existing.date ? dateLabel(existing.date) : '',
        timeLabel: existing.time ? timeLabel(existing.time) : '',
        gift: existing.gift,
        timezone: TZ,
      });
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

/**
 * Spends one unit of a gift's stock. Called the instant the wheel settles
 * (see GiftPage.jsx) — the prize is considered won right there, not later
 * when the doctor finishes booking, so stock has to be debited now or a
 * limited gift could be handed out more times than it has units for.
 *
 * Uses its own lock rather than the one doPost declares, since it returns
 * before that lock is ever taken — safe, because LockService locks are
 * scoped to the script, not to one Lock object.
 */
function claimGift(data) {
  var lock = LockService.getScriptLock();
  var id = String(data.id || '').trim();
  if (!id) return json({ ok: false, error: 'Missing gift id.' });

  if (!lock.tryLock(30000)) {
    return json({ ok: false, reason: 'busy', error: 'Server busy, please try again.' });
  }

  try {
    var sheet = tab(TAB.gifts);
    if (!sheet || sheet.getLastRow() < 2) return json({ ok: false, error: 'Gift not found.' });

    var lastRow = sheet.getLastRow();
    var rows = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();

    for (var i = 0; i < rows.length; i++) {
      var tier = String(rows[i][0] || '').trim().toLowerCase();
      var title = String(rows[i][2] || '').trim();
      var rowId = String(rows[i][1] || '').trim() || slugify(title) || (tier + '-' + (i + 1));
      if (rowId !== id) continue;

      var stock = parseNullableInt(rows[i][7]);
      if (stock === null) return json({ ok: true, remaining: null }); // unlimited — nothing to spend

      if (stock <= 0) return json({ ok: false, reason: 'outofstock', error: 'That gift just ran out.' });

      sheet.getRange(i + 2, 8).setValue(stock - 1);
      try { CacheService.getScriptCache().remove(GIFTS_CACHE_KEY); } catch (cacheErr) {}
      return json({ ok: true, remaining: stock - 1 });
    }

    return json({ ok: false, error: 'Gift not found.' });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function validate(data) {
  var contactError = validateContact(data);
  if (contactError) return contactError;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '').trim())) return 'Pick a date.';
  if (!/^\d{2}:\d{2}$/.test(String(data.time || '').trim())) return 'Pick a time.';
  return null;
}

/** Shared by validate() (a real booking) and registerGift() (no slot to pick). */
function validateContact(data) {
  if (!data) return 'Empty request.';
  if (!String(data.name || '').trim()) return 'Name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email || '').trim())) return 'A valid email is required.';
  if (digitsOnly(data.phone).length < 10) return 'A valid WhatsApp number is required.';
  return null;
}

/**
 * Records a doctor who won a gift but has no clinic to be visited at — the
 * ContactPage.jsx counterpart to a real booking. Written into the same
 * Bookings sheet, with the slot columns left blank and status 'no-visit', so
 * this stays the one place a has-no-clinic doctor's contact details, quiz
 * result and gift ever land — the old fire-and-forget write into the
 * separate responses sheet (see storage.js) never captured phone/email at
 * all and can't report back if it failed.
 */
function registerGift(data) {
  var invalid = validateContact(data);
  if (invalid) return json({ ok: false, reason: 'invalid', error: invalid });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return json({ ok: false, reason: 'busy', error: 'Server busy, please try again.' });
  }

  var existing;
  var ref;

  try {
    // Same replay guard as the 'book' action — see findExistingBooking().
    existing = findExistingBooking(data.email, data.phone);
    if (!existing) {
      ref = makeRef();
      bookingsSheet().appendRow([
        new Date(), ref, '', '', '', 'no-visit',
        data.name || '', data.email || '', data.phone || '',
        data.specialty || '', data.category || '',
        data.score, data.total, data.percent,
        data.gift || '', JSON.stringify(data.answers || []), '',
        data.clinic || 'no',
      ]);
    }
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }

  if (existing) return json({ ok: true, alreadyRegistered: true, ref: existing.ref, gift: existing.gift });

  try { sendNoVisitEmails(data, ref); }
  catch (mailErr) { console.error('Email failed for ' + ref + ': ' + mailErr); }

  return json({ ok: true, ref: ref });
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
 * The one row a doctor already has in Bookings, matched by email OR phone
 * (whichever one matches — a typo in one shouldn't defeat this), ignoring
 * cancelled rows. Used by both the 'book' and 'registerGift' actions so
 * replaying the quiz — with or without a clinic, any number of times —
 * hands back the SAME record instead of appending a new one each time. The
 * sheet is meant to hold one row per doctor; whichever was saved first wins.
 */
function findExistingBooking(email, phone) {
  var sheet = bookingsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var normEmail = String(email || '').trim().toLowerCase();
  var normPhone = digitsOnly(phone);
  if (!normEmail && !normPhone) return null;

  var rows = sheet.getRange(2, 1, lastRow - 1, BOOKING_HEADERS.length).getDisplayValues();

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var status = String(r[COL.status] || '').trim().toLowerCase();
    if (status === 'cancelled') continue;

    var rowEmail = String(r[COL.email] || '').trim().toLowerCase();
    var rowPhone = digitsOnly(r[COL.phone]);

    if ((normEmail && rowEmail === normEmail) || (normPhone && rowPhone === normPhone)) {
      return {
        ref: r[COL.ref],
        date: String(r[COL.date] || ''),
        time: String(r[COL.time] || ''),
        gift: String(r[COL.gift] || ''),
      };
    }
  }

  return null;
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

/** Confirmation + admin notification for a gift winner with no clinic to visit. */
function sendNoVisitEmails(data, ref) {
  var settings = readSettings();
  var brand = settings.brandName || 'Cyno Pharma';

  MailApp.sendEmail({
    to: data.email,
    name: brand,
    subject: 'Your gift is confirmed — ' + brand,
    htmlBody: noVisitEmailHtml(data, ref, settings),
    body: [
      'Hi ' + (data.name || 'Doctor') + ',',
      '',
      'Thanks for taking the ' + brand + ' quiz! Your gift — ' + (data.gift || '—') + ' — is confirmed.',
      'Our team will reach out on WhatsApp or email to arrange delivery.',
      '',
      'Reference: ' + ref,
      '',
      brand,
    ].join('\n'),
  });

  if (settings.notifyEmail) {
    MailApp.sendEmail({
      to: settings.notifyEmail,
      name: brand + ' Gifts',
      subject: 'New gift winner (no clinic): ' + (data.name || 'Doctor'),
      htmlBody: [
        '<h3>New gift winner — no rep visit</h3>',
        '<table cellpadding="6" style="border-collapse:collapse;font:14px system-ui">',
        row('Reference', ref),
        row('Name', data.name),
        row('Email', data.email),
        row('WhatsApp', data.phone),
        row('Specialty', (data.specialty || '') + ' (' + (data.category || '') + ')'),
        row('Quiz score', data.score + '/' + data.total + ' (' + data.percent + '%)'),
        row('Gift to send', data.gift || '—'),
        '</table>',
      ].join(''),
    });
  }
}

function noVisitEmailHtml(data, ref, settings) {
  var brand = settings.brandName || 'Cyno Pharma';
  return [
    '<div style="font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:520px">',
    '<div style="background:#2563eb;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">',
    '<div style="font-size:20px;font-weight:700">Gift confirmed ✓</div>',
    '<div style="opacity:.85;font-size:13px;margin-top:4px">' + escapeHtml(brand) + '</div>',
    '</div>',
    '<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:24px">',
    '<p>Hi ' + escapeHtml(data.name || 'Doctor') + ',</p>',
    '<p>Thanks for taking our quiz! Here\'s what you won:</p>',
    '<table cellpadding="8" style="border-collapse:collapse;background:#f8fafc;border-radius:10px;width:100%;margin:16px 0">',
    row('🎁 Gift', data.gift || '—'),
    row('#️⃣ Reference', ref),
    '</table>',
    '<p style="color:#64748b;font-size:13px">Our team will reach out on WhatsApp or email shortly to arrange delivery.</p>',
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
        capacity: parseNullableInt(r[5]),
      };
    })
    .filter(function (r) {
      return r.active && WEEKDAYS.indexOf(r.weekday) !== -1 && r.endMin > r.startMin;
    });
}

/**
 * Blank means "unset" (null) — for Availability that's "inherit Settings ▸
 * defaultCapacity" (resolved later in slotTimesFor); for Gifts it's
 * "unlimited stock". An explicit 0 blocks the row outright (no slots / out
 * of stock) without having to flip `active` to no. Negative or unparsable
 * values fall back to blank rather than silently opening things up to an
 * unlimited count.
 */
function parseNullableInt(value) {
  var text = String(value == null ? '' : value).trim();
  if (text === '') return null;
  var n = Math.floor(Number(text));
  return isNaN(n) || n < 0 ? null : n;
}

/** Blank or non-positive means "no explicit weight" — defaults to an even 1. */
function parseWeight(value) {
  var n = Number(String(value == null ? '' : value).trim());
  return isFinite(n) && n > 0 ? n : 1;
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

// The four tiers a Gifts row may declare — see the PRIZE WHEEL note at the
// top of this file for what each one means and who can win it.
var GIFT_TIERS = ['superpremium', 'premium', 'standard', 'consolation'];

/**
 * Prize wheel catalog: columns are tier | id | title | short | desc |
 * emoji | active | stock | weight. `tier` must be one of GIFT_TIERS — any
 * other value (blank, a typo, a note row) is silently skipped rather than
 * crashing the whole wheel over one bad row. Row order is preserved, so
 * dragging rows in the sheet reorders the wheel too.
 *
 * A row with stock exactly 0 is dropped just like an inactive one — see
 * claimGift() for where stock actually gets decremented.
 */
function readGifts() {
  var sheet = tab(TAB.gifts);
  var out = { superpremium: [], premium: [], standard: [], consolation: [] };
  if (!sheet || sheet.getLastRow() < 2) return out;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getDisplayValues().forEach(function (r, i) {
    var tier = String(r[0] || '').trim().toLowerCase();
    if (GIFT_TIERS.indexOf(tier) === -1) return;

    var active = !/^(no|false|0|off)$/i.test(String(r[6] || 'yes').trim());
    if (!active) return;

    var stock = parseNullableInt(r[7]);
    if (stock !== null && stock <= 0) return;

    var title = String(r[2] || '').trim();
    if (!title) return;

    // SpinWheel matches the winning slice back to a prize by id (see
    // pickWinnerIndex in src/utils/wheel.js), so every row needs one —
    // fall back to a slug of the title, then the row position, so a blank
    // id column still gets something stable rather than colliding on ''.
    var id = String(r[1] || '').trim() || slugify(title) || (tier + '-' + (i + 1));

    out[tier].push({
      id: id,
      tier: tier,
      title: title,
      short: String(r[3] || '').trim() || title,
      desc: String(r[4] || '').trim(),
      emoji: String(r[5] || '').trim() || '🎁',
      stock: stock, // null = unlimited
      weight: parseWeight(r[8]),
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

  seed(ss, TAB.gifts, ['tier', 'id', 'title', 'short', 'desc', 'emoji', 'active', 'stock', 'weight'], starterGifts());
  // Same reasoning as Availability's `capacity` above — lets a sheet
  // deployed before stock/weight existed pick them up without a manual
  // header edit. New cells read as blank, i.e. unlimited stock / weight 1,
  // exactly like today's behaviour.
  ensureColumns(ss.getSheetByName(TAB.gifts), ['stock', 'weight']);

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
  // Last two columns are stock (blank = unlimited) and weight (blank = 1,
  // i.e. even odds against every other row in the same tier).
  return [
    // Rare jackpot tier — low weight (0.2, vs. 1 for a regular premium row)
    // and a small stock (2) so these two units run out and the tab needs
    // restocking on purpose, not by accident.
    ['superpremium', 'flagship-phone', 'Flagship Smartphone', 'Smartphone', 'Latest flagship smartphone — our top prize.', '📱', 'yes', 2, 0.2],
    ['superpremium', 'gold-voucher', '₹10,000 Gold Voucher', '₹10,000 Gold', 'Redeemable gold voucher — our rarest reward.', '🏆', 'yes', 2, 0.2],
    ['premium', 'smart-watch', 'Smart Fitness Watch', 'Smart Watch', 'Health-tracking smartwatch with heart-rate & SpO₂.', '⌚', 'yes', '', 1],
    ['premium', 'stethoscope', 'Premium Cardiology Stethoscope', 'Stethoscope', 'Professional dual-head cardiology stethoscope.', '🩺', 'yes', '', 1],
    ['premium', 'bp-monitor', 'Digital BP Monitor', 'BP Monitor', 'Clinic-grade automatic blood pressure monitor.', '💗', 'yes', '', 1],
    ['premium', 'amazon-2000', '₹2,000 Amazon Gift Card', '₹2000 Card', 'Shop anything you like on Amazon.', '🎁', 'yes', '', 1],
    ['premium', 'leather-bag', 'Executive Leather Bag', 'Leather Bag', 'Premium doctor\'s leather laptop bag.', '💼', 'yes', '', 1],
    ['premium', 'pulse-oximeter', 'Fingertip Pulse Oximeter', 'Oximeter', 'Accurate SpO₂ and pulse-rate monitor for your clinic.', '🫁', 'yes', '', 1],
    ['standard', 'premium-pen', 'Premium Doctor\'s Pen Set', 'Pen Set', 'Elegant metal pen set, engraved.', '🖊️', 'yes', '', 1],
    ['standard', 'coffee-voucher', 'Coffee Voucher', 'Coffee ₹200', '₹200 voucher for your favourite café.', '☕', 'yes', '', 1],
    ['standard', 'medical-journal', 'Digital Journal Access', 'Journal 3M', '3-month premium clinical journal subscription.', '📚', 'yes', '', 1],
    ['standard', 'amazon-500', '₹500 Amazon Gift Card', '₹500 Card', '₹500 shopping voucher.', '🎁', 'yes', '', 1],
    ['standard', 'desk-organiser', 'Desk Organiser Set', 'Desk Set', 'Compact organiser with notepad for your desk.', '🗂️', 'yes', '', 1],
    ['standard', 'cyno-kit', 'Cyno Care Kit', 'Care Kit', 'Branded mug, notebook and lapel pin.', '🧰', 'yes', '', 1],
    // Consolation outcome, mixed into the standard pool. Weight 2 (vs. 1 for
    // a regular standard row) means it comes up about twice as often as any
    // single real gift — tune this to whatever "no-win" rate you want.
    ['consolation', 'better-luck', 'Better Luck Next Time', 'Try Again', 'No physical prize this time — thanks for playing!', '🍀', 'yes', '', 2],
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
