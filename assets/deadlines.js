/** Calendar-day deadline check. A notice stays through the Eastern date of its deadline. */

const ET = "America/New_York";

export function easternDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** YYYY-MM-DD in Eastern time, or "" when the notice has no parseable deadline. */
export function deadlineDay(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return "";
  return easternDay(ms);
}

function dayNumber(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/** Eastern calendar days from today until the deadline. Negative when it has passed. */
export function daysUntil(value, now = Date.now()) {
  const day = deadlineDay(value);
  if (!day) return NaN;
  return dayNumber(day) - dayNumber(easternDay(now));
}

/** True only when the deadline's Eastern date is before today. Missing deadlines are not past due. */
export function isPastDue(value, now = Date.now()) {
  const left = daysUntil(value, now);
  return Number.isFinite(left) && left < 0;
}

/** Closed on an Eastern date within the last `windowDays` days, not including today. */
export function isClosedWithin(value, now = Date.now(), windowDays = 30) {
  const left = daysUntil(value, now);
  return Number.isFinite(left) && left < 0 && left >= -windowDays;
}

/**
 * Open-list deadline filter.
 * "" is any notice that is still open, including those with no deadline.
 * "today" | "7" | "30" count Eastern calendar days, and include today.
 * "later" is more than 30 days out. "none" is no parseable deadline.
 * A past-due notice never matches.
 */
export function matchesDeadline(value, filter, now = Date.now()) {
  if (isPastDue(value, now)) return false;
  const choice = String(filter || "");
  if (!choice) return true;
  const day = deadlineDay(value);
  if (choice === "none") return !day;
  if (!day) return false;
  const left = daysUntil(value, now);
  if (choice === "today") return left === 0;
  if (choice === "7") return left >= 0 && left <= 7;
  if (choice === "30") return left >= 0 && left <= 30;
  if (choice === "later") return left > 30;
  return false;
}
