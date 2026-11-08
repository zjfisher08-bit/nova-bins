/**
 * Scheduling rules for Nova Bin Cleaning.
 *
 * Everything here works on plain NZ calendar dates written as "YYYY-MM-DD" strings.
 * We never use clock times for scheduling, so daylight saving can't shift anything.
 * Internally a date is turned into a UTC midnight Date purely to do day arithmetic.
 *
 * Weekdays use ISO numbering: 1 = Monday ... 7 = Sunday. Collection days are 1–5.
 *
 * This file is pure (no database, no network) so it can be unit-tested.
 */

/** A calendar date as "YYYY-MM-DD". */
export type DateString = string;

/** ISO weekday: 1 = Monday ... 5 = Friday (collection days are always Mon–Fri). */
export type CollectionDay = 1 | 2 | 3 | 4 | 5;

export const NZ_TIME_ZONE = "Pacific/Auckland";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Basic date helpers
// ---------------------------------------------------------------------------

/** Turn "YYYY-MM-DD" into a day number (days since 1970-01-01). Throws on bad input. */
function toDayNumber(date: DateString): number {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Reject impossible dates like 2026-02-30 (Date.UTC would roll them over).
  if (new Date(ms).getUTCDate() !== d) throw new Error(`Invalid date "${date}"`);
  return Math.round(ms / DAY_MS);
}

function fromDayNumber(day: number): DateString {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Add (or subtract) whole days. */
export function addDays(date: DateString, days: number): DateString {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Number of days from `a` to `b` (positive if b is later). */
export function daysBetween(a: DateString, b: DateString): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** ISO weekday of a date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: DateString): number {
  // 1970-01-01 was a Thursday (ISO 4).
  const n = toDayNumber(date);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** Today's date in New Zealand (or the NZ date of any instant). */
export function nzToday(now: Date = new Date()): DateString {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Monday of the (Mon–Sun) week containing `date`. Used for payout weeks. */
export function weekStart(date: DateString): DateString {
  return addDays(date, 1 - isoWeekday(date));
}

/** First date on or after `from` that falls on `weekday`. */
export function nextWeekdayOnOrAfter(from: DateString, weekday: CollectionDay): DateString {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

// ---------------------------------------------------------------------------
// Recycling weeks
// ---------------------------------------------------------------------------

/**
 * The upcoming collection date the booking form asks about:
 * "Does recycling go out on <this date>?". If today is collection day, it's today.
 */
export function upcomingCollectionDate(today: DateString, collectionDay: CollectionDay): DateString {
  return nextWeekdayOnOrAfter(today, collectionDay);
}

/**
 * Work out the one recycling date we store for a customer.
 * @param recyclingOnUpcoming the customer's answer to "Does recycling go out on <upcoming date>?"
 */
export function recyclingAnchorFromAnswer(
  today: DateString,
  collectionDay: CollectionDay,
  recyclingOnUpcoming: boolean,
): DateString {
  const upcoming = upcomingCollectionDate(today, collectionDay);
  return recyclingOnUpcoming ? upcoming : addDays(upcoming, 7);
}

/**
 * Is `date` a recycling collection day? True when it's an exact multiple of 14 days
 * from the stored recycling date (works for dates before or after the anchor).
 */
export function isRecyclingDay(date: DateString, recyclingAnchor: DateString): boolean {
  return ((daysBetween(recyclingAnchor, date) % 14) + 14) % 14 === 0;
}

// ---------------------------------------------------------------------------
// Clean dates
// ---------------------------------------------------------------------------

/** What the scheduler needs to know about a customer's collection. */
export interface CollectionInfo {
  collectionDay: CollectionDay;
  /** Any known date when recycling was/will be collected. */
  recyclingAnchor: DateString;
  /** True if the booking includes a recycling bin (then cleans must be on recycling weeks). */
  needsRecyclingWeek: boolean;
}

/** Is `date` a day we could clean for this customer? */
export function isEligibleCleanDate(date: DateString, info: CollectionInfo): boolean {
  if (isoWeekday(date) !== info.collectionDay) return false;
  if (info.needsRecyclingWeek && !isRecyclingDay(date, info.recyclingAnchor)) return false;
  return true;
}

/** First eligible clean date on or after `from`. */
export function firstEligibleOnOrAfter(from: DateString, info: CollectionInfo): DateString {
  let date = nextWeekdayOnOrAfter(from, info.collectionDay);
  // At most two loops: if this collection day isn't a recycling week, the next one is.
  while (!isEligibleCleanDate(date, info)) date = addDays(date, 7);
  return date;
}

/**
 * First clean: the first eligible collection day at least `leadDays` after the booking date.
 * Example: booked Monday with lead 2 → earliest possible is Wednesday.
 */
export function firstCleanDate(bookingDate: DateString, info: CollectionInfo, leadDays: number): DateString {
  if (!Number.isInteger(leadDays) || leadDays < 0) throw new Error("leadDays must be a whole number ≥ 0");
  return firstEligibleOnOrAfter(addDays(bookingDate, leadDays), info);
}

/**
 * All clean dates for a subscription: the first clean, then every `intervalWeeks` weeks.
 * Defaults: 3 cleans, 4 weeks apart. Because 4 weeks is an even number of weeks, every
 * clean keeps the same recycling/non-recycling parity as the first.
 */
export function subscriptionDates(firstClean: DateString, cleans = 3, intervalWeeks = 4): DateString[] {
  return Array.from({ length: cleans }, (_, i) => addDays(firstClean, i * intervalWeeks * 7));
}

/**
 * All clean dates for a new booking (one-off = 1 date, subscription = 3 dates).
 */
export function bookingCleanDates(
  bookingDate: DateString,
  info: CollectionInfo,
  opts: { type: "one_off" | "subscription"; leadDays: number; subscriptionCleans?: number; intervalWeeks?: number },
): DateString[] {
  const first = firstCleanDate(bookingDate, info, opts.leadDays);
  if (opts.type === "one_off") return [first];
  return subscriptionDates(first, opts.subscriptionCleans ?? 3, opts.intervalWeeks ?? 4);
}

/**
 * Reschedule: the next eligible collection day strictly after both the job's current date
 * and today. (So a problem reported on the day moves the job forward, and a decision made
 * days later never picks a date in the past or today.)
 *
 * Later subscription cleans are NOT moved — callers only reschedule the one job.
 */
export function nextEligibleDate(currentJobDate: DateString, today: DateString, info: CollectionInfo): DateString {
  const after = daysBetween(today, currentJobDate) > 0 ? currentJobDate : today;
  return firstEligibleOnOrAfter(addDays(after, 1), info);
}
