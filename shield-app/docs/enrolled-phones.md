# Your phones

Vault → YOUR PHONES lists the phones this account has set up with Apple's device check (App Attest), and lets you withdraw one that is lost or retired. Server side: `tradedeck-shield` `docs/features/enrolled-phones.md`.

- Only the signed-in account's own phones are listed. Each line says whether it is this phone, when it was set up, and how many stored photos it signed for. The id the server keeps is Apple's key hash, not a device name or serial number.
- WITHDRAW: that phone's later photos stop showing as Apple-checked, and its key cannot be set up again. Photos already stored keep the result they had.
- The key this phone uses now has no WITHDRAW button. Withdrawing it would leave this phone's photos unchecked with no way to fix that on this screen. (A phone that is replaced or reinstalled sets up a new key, and the old one then shows as another phone or an earlier install.)
- Nothing is sent until you press a button. The list is fetched when you open it.
