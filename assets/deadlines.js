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

/** True only when the deadline's Eastern date is before today. Missing deadlines are not past due. */
export function isPastDue(value, now = Date.now()) {
  const day = deadlineDay(value);
  if (!day) return false;
  return day < easternDay(now);
}
