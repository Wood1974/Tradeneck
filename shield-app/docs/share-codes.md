# Share a photo with a code

Open a photo in the Vault. Once the photo has reached the Shield server, a **SHARE** button appears under it (before that, the screen says to wait).

1. **SHARE** opens the panel. It says what a code allows, lets you pick 7, 30 or 90 days, and lists the codes already made for this photo (working, expired or withdrawn), never the codes themselves.
2. **MAKE A CODE** asks the server for one. The code is shown once. **COPY** puts the check page, the code and the expiry date on the clipboard, and nothing else. Nothing is sent from the phone: you choose who gets it.
3. **WITHDRAW** next to a working code stops it from working at once.

Whoever holds the code opens the Shield check page (`/check` on the Shield server, no account), enters the code and chooses the original photo file. The server answers whether the file matches the stored copy, when it was uploaded, and whether the photographer passed the ID check. A code made with this version also shows two timing facts: the clock-check label (the phone's own clocks agreed with each other, could not be compared, or disagreed; this is not a timestamp) and whether an independent outside time-stamp covers the photo (it shows the record existed by that time, not when the photo was taken). Codes made before the server added this keep the smaller answer, and the list says which is which. The clock-check details and the job-start time are never shown. It does not show the photographer's name, email, location or other photos, and the code works only for that one photo until its date. A copy that was recompressed (many messaging apps do this) will not match; send the original file.

Where it lives: `src/native/share.ts` (what the server is asked, the words), `src/ui/share-panel.ts` (the section and its buttons), `src/identity/client.ts` (`createShare`, `listShares`, `revokeShare`). Withdrawing uses `POST /shield/shares/<id>/revoke` because the phone's web view may only send GET and POST across origins. Server side: `tradedeck-shield` `docs/features/share-codes.md`.

**Not verified:** on a phone. The unit tests mock the server and the e2e check only covers the not-yet-uploaded state (uploads are skipped in the e2e build). It needs a TestFlight build to try for real.
