const EST_TZ = "America/New_York";

export function todayEST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: EST_TZ });
}
