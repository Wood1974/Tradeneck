# Your phones

Account tab → YOUR PHONES (signed in) lists the phones this account has set up with Apple's device check (App Attest), and lets you withdraw one that is lost or retired. Server side: `tradedeck-shield` `docs/features/enrolled-phones.md`.

- Only the signed-in account's own phones are listed. Each line says whether it is this phone, when it was set up, and how many stored photos it signed for. The id the server keeps is Apple's key hash, not a device name or serial number.
- WITHDRAW: that phone's later photos stop showing as Apple-checked, and its key cannot be set up again. Photos already stored keep the result they had.
- The key this phone uses now has no WITHDRAW button. Withdrawing it would leave this phone's photos unchecked with no way to fix that on this screen. (A phone that is replaced or reinstalled sets up a new key, and the old one then shows as another phone or an earlier install.)
- Nothing is sent until you press a button. The list is fetched when you open it.

## Two different facts
- The chip "DEVICE ENROLLED WITH APPLE" on the Capture screen is this phone's own record of an Apple key. It is not the server's answer.
- YOUR PHONES is the server's list for the signed-in account. It says "No phones enrolled for this account" only after the server answered with an empty list. If the list could not be loaded (signed out, no signal) it says why and offers TRY AGAIN, and claims nothing about the account's phones.
- When the server answered and does not list this phone's key, the panel says so: the key may have been set up under another account. The app has no re-enrol button while the phone believes it is enrolled; that is a separate decision.
