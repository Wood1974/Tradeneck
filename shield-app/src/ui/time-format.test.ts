import { describe, expect, it } from "vitest";
import { clockNow, shownTime, shownTimeWithUtc, utcMinute } from "./time-format";

describe("times are shown in the phone's zone, with the zone named", () => {
  it("shows Utah daylight time before the clocks change", () => {
    expect(shownTime("2026-10-25T20:30:02.930Z", "America/Denver")).toBe("Oct 25, 2026, 2:30 PM MDT");
  });
  it("shows Utah standard time after the clocks change on 2026-11-01", () => {
    expect(shownTime("2026-11-01T14:00:00Z", "America/Denver")).toBe("Nov 1, 2026, 7:00 AM MST");
    expect(shownTime("2026-11-01T07:59:00Z", "America/Denver")).toBe("Nov 1, 2026, 1:59 AM MDT");
  });
  it("follows whatever zone it is given", () => {
    expect(shownTime("2026-10-25T20:30:00Z", "UTC")).toBe("Oct 25, 2026, 8:30 PM UTC");
    expect(shownTime("2026-10-25T20:30:00Z", "America/New_York")).toBe("Oct 25, 2026, 4:30 PM EDT");
  });
  it("keeps the exact UTC minute beside the local time", () => {
    expect(utcMinute("2026-10-25T20:30:02.930Z")).toBe("2026-10-25 20:30 UTC");
    expect(shownTimeWithUtc("2026-10-25T20:30:02.930Z", "America/Denver")).toBe("Oct 25, 2026, 2:30 PM MDT (2026-10-25 20:30 UTC)");
  });
  it("returns something that is not a time exactly as it came", () => {
    for (const bad of ["", "not a time", "—"]) {
      expect(shownTime(bad, "America/Denver")).toBe(bad);
      expect(shownTimeWithUtc(bad, "America/Denver")).toBe(bad);
      expect(utcMinute(bad)).toBe(bad);
    }
  });
  it("names the zone on the running clock", () => {
    expect(clockNow(new Date("2026-11-01T14:00:05Z"), "America/Denver")).toBe("7:00:05 AM MST");
  });
});
