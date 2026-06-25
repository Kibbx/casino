import { toZonedTime, fromZonedTime, format as tzFormat } from "date-fns-tz";

export const EST_TZ = "America/New_York";

function estDateStr(d: Date): string {
  return toZonedTime(d, EST_TZ).toLocaleDateString("en-CA", { timeZone: EST_TZ });
}

export function todayEST(): string {
  return estDateStr(new Date());
}

export function daysAgoEST(n: number): string {
  return estDateStr(new Date(Date.now() - n * 86400000));
}

export function startOfWeekEST(): string {
  const todayStr = todayEST();
  const [y, m, d] = todayStr.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return estDateStr(new Date(Date.now() - daysBack * 86400000));
}

export function startOfMonthEST(): string {
  const todayStr = todayEST();
  return todayStr.substring(0, 8) + "01";
}

/**
 * Normalize any date-like value to a Date in Eastern Time.
 * Handles Postgres-style timestamps: "2026-04-06 12:58:09.338036+00"
 * where the timezone offset is short-form (+00 instead of +00:00).
 */
function toET(d: Date | string | number | null | undefined): Date {
  if (d == null) return new Date(NaN);
  if (typeof d === "string") {
    // Replace space separator with T
    let s = d.replace(" ", "T");
    // Expand short UTC offset like +00 or -05 to +00:00 / -05:00
    s = s.replace(/([+-])(\d{2})$/, "$1$2:00");
    // If still no timezone info, treat as UTC
    if (!s.endsWith("Z") && !s.match(/[+-]\d{2}:\d{2}$/)) s += "Z";
    d = s;
  }
  return toZonedTime(new Date(d as string | number | Date), EST_TZ);
}

function safe(fn: () => string): string {
  try { return fn(); } catch { return "—"; }
}

/** "Nov 5, 3:45 PM ET" */
export function fmtETDateTime(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "MMM d, h:mm aa", { timeZone: EST_TZ }) + " ET");
}

/** "Nov 5, 2024, 3:45 PM ET" */
export function fmtETDateTimeFull(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "MMM d, yyyy, h:mm aa", { timeZone: EST_TZ }) + " ET");
}

/** "11/05/24 3:45:00 PM ET" */
export function fmtETDateTimeShort(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "MM/dd/yy h:mm:ss aa", { timeZone: EST_TZ }) + " ET");
}

/** "11/05/24" */
export function fmtETDateShort(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "MM/dd/yy", { timeZone: EST_TZ }));
}

/** "Nov 5" */
export function fmtETDateMonthDay(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "MMM d", { timeZone: EST_TZ }));
}

/** "3:45 PM ET" */
export function fmtETTime(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "h:mm aa", { timeZone: EST_TZ }) + " ET");
}

/** "3:45:00 PM ET" */
export function fmtETTimeSec(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "h:mm:ss aa", { timeZone: EST_TZ }) + " ET");
}

/** "11/5/2024, 3:45 PM ET" */
export function fmtETFull(d: Date | string | number): string {
  return safe(() => tzFormat(toET(d), "M/d/yyyy, h:mm aa", { timeZone: EST_TZ }) + " ET");
}

/** Convert a UTC ISO string to a datetime-local input value displayed in ET.
 *  e.g. "2026-06-22T21:00" (the user sees 9 PM ET) */
export function isoToETDatetimeLocal(iso: string): string {
  return safe(() => tzFormat(toET(iso), "yyyy-MM-dd'T'HH:mm", { timeZone: EST_TZ }));
}

/** Convert a datetime-local input value (treated as ET) to a UTC ISO string. */
export function etDatetimeLocalToISO(val: string): string {
  if (!val) return "";
  return fromZonedTime(new Date(val), EST_TZ).toISOString();
}
