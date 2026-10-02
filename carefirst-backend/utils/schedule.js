// Appointment scheduling in Pakistan time (UTC+5 all year, no DST).
// Dates are "YYYY-MM-DD" strings (PKT calendar day); times are "HH:MM" 24-hour strings.

const BOOKING_WINDOW_DAYS = 14;     // today + the next 13 days
const PATIENT_CANCEL_HOURS = 2;     // patient may cancel up to this long before the start
const DEFAULT_CONSULTATION_MINUTES = 20;

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n) => String(n).padStart(2, '0');

// "09:00 AM", "9:00 pm" or "13:30" → minutes after midnight, or null
const parseTime = (text) => {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (minutes > 59) return null;
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
};

// "09:00 AM – 01:00 PM" (any dash or "to") → { start, end } in minutes.
// A single time ("09:00 AM") is one consultation starting then.
const parseRange = (text, durationMinutes) => {
  const parts = String(text || '').split(/\s*(?:–|—|-|\bto\b)\s*/i).filter(Boolean);
  const start = parseTime(parts[0]);
  if (start === null) return null;
  const end = parts.length > 1 ? parseTime(parts[1]) : start + durationMinutes;
  return end !== null && end > start ? { start, end } : null;
};

const toHHMM = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// "13:20" → "01:20 PM"
const formatTime12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
};

// Start times for one weekday's availability ranges, e.g. ["09:00", "09:20", …]
const slotTimes = (ranges, durationMinutes) => {
  const times = new Set();
  for (const r of ranges) {
    const range = parseRange(r, durationMinutes);
    if (!range) continue;
    for (let t = range.start; t + durationMinutes <= range.end; t += durationMinutes) times.add(toHHMM(t));
  }
  return [...times].sort();
};

// PKT calendar date of an instant
const pktDate = (instant = new Date()) => {
  const d = new Date(new Date(instant).getTime() + PKT_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const addDays = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

const weekdayOf = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

// Real (UTC) instant of a PKT date + time
const pktInstant = (date, time) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - PKT_OFFSET_MS);
};

const isValidDate = (date) => DATE_FORMAT.test(date || '') && addDays(date, 0) === date;
const isValidTime = (time) => TIME_FORMAT.test(time || '');

// Dates a patient may pick: today … today + BOOKING_WINDOW_DAYS - 1
const bookingDates = (now = new Date()) => {
  const today = pktDate(now);
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDays(today, i));
};

const isWithinBookingWindow = (date, now = new Date()) => bookingDates(now).includes(date);

// Free, future start times for a doctor on each bookable date.
// `taken` is a Set of "YYYY-MM-DD HH:MM" keys already confirmed.
const freeSlots = (availability, durationMinutes, taken, now = new Date()) =>
  bookingDates(now).map(date => {
    const day = (availability || []).find(a => a.day === weekdayOf(date));
    const times = slotTimes((day?.slots || []).map(s => s.time), durationMinutes)
      .filter(time => pktInstant(date, time) > now && !taken.has(`${date} ${time}`));
    return { date, weekday: weekdayOf(date), times };
  });

module.exports = {
  BOOKING_WINDOW_DAYS, PATIENT_CANCEL_HOURS, DEFAULT_CONSULTATION_MINUTES,
  parseTime, parseRange, slotTimes, formatTime12,
  pktDate, addDays, weekdayOf, pktInstant,
  isValidDate, isValidTime, bookingDates, isWithinBookingWindow, freeSlots,
};
