// Calendar helpers. A "study day" starts at `dayStartHour` local time (4 am by default),
// so a session at 1 am still counts for the previous day.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Integer number of the local study day that contains `time`. */
export function dayNumber(time, dayStartHour = 4) {
  const d = new Date(time - dayStartHour * HOUR);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Day number of a calendar date written 'YYYY-MM-DD'. */
export function dayNumberOfDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

/** Timestamp when the current study day ends. */
export function endOfStudyDay(time, dayStartHour = 4) {
  const d = new Date(time - dayStartHour * HOUR);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, dayStartHour).getTime();
}
