// Times on screen are shown in the phone's own time zone, with the zone named, because that is the clock a person is reading.
// The signed record keeps ISO UTC; this only changes how a time is displayed. A value that is not a time is returned as it came,
// never guessed at. `zone` is for tests; on the phone it is the web view's zone, which follows the phone's setting.

const valid = (iso: string): boolean => typeof iso === "string" && iso !== "" && !Number.isNaN(Date.parse(iso));

/** "Oct 25, 2026, 2:30 PM MDT". */
export function shownTime(iso: string, zone?: string): string {
  if (!valid(iso)) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** The exact UTC minute, as the server and the signed record state it: "2026-10-25 20:30 UTC". */
export function utcMinute(iso: string): string {
  return valid(iso) ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : iso;
}

/** Local time with the UTC minute beside it: "Oct 25, 2026, 2:30 PM MDT (2026-10-25 20:30 UTC)". */
export function shownTimeWithUtc(iso: string, zone?: string): string {
  return valid(iso) ? `${shownTime(iso, zone)} (${utcMinute(iso)})` : iso;
}

/** The time of day right now, with the zone: "2:30:02 PM MDT". */
export function clockNow(now: Date = new Date(), zone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(now);
}
