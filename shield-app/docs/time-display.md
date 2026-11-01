# Times on screen

Times are shown in the phone's own time zone with the zone named ("Oct 25, 2026, 2:30 PM MDT"), because that is the clock a person is reading. They used to be shown as raw UTC ("2026-10-25T20:30:02.930Z"), which in Utah reads 6 hours (7 after daylight saving ends) ahead of the wall clock.

## What changed and what did not
- Changed: how a time is displayed: the Vault list and detail, the clock on the Capture screen, the close-out lines on screen, and the server-result lines (job start, outside time-stamp). Code: `src/ui/time-format.ts`.
- Not changed: anything signed or exported. The record's `createdAt` stays ISO UTC. The Vault detail shows the local time and, beneath it, the exact UTC string the record carries. The HTML report and packet files keep UTC.
- Not changed: the server's Clock check. It still only says whether the phone's own clocks agree with each other; it is not a time.

## Zone
The web view's zone, which follows the phone's setting. Something that is not a time is shown exactly as it came.

## Not verified
How it looks on the phone, and the zone the web view reports there. Tests run the formatter with fixed zones (Denver before and after the 2026-11-01 change, New York, UTC) and the suite also passes with `TZ=America/Denver`.
