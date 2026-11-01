# Enrol this phone again

Account tab, iPhone, signed in. Runs the same enrolment as the first time (`enrollDevice`): ask the server for a challenge, ask Apple for a new key and proof, send the proof to the server, and only after the server accepts it make the new key the one the phone uses. A failure at any step leaves the phone using the key it had.

## Why it exists
The Shield server keeps Apple's attestation object for each key it enrols (tradedeck-shield #33). Keys enrolled before that have none, so photos signed by them cannot be re-checked offline. Enrolling again makes a key the server keeps the proof for.

## What it does and does not change
- Photos taken after it carry the new key; photos already taken keep theirs.
- The old key stays listed under YOUR PHONES until withdrawn there.
- Nothing is deleted from the phone.

## Not verified
Needs a real iPhone and signal; the browser tests run as Android, where the card is not offered. Whether the server stored Apple's attestation for the new key can be read with `GET /shield/captures/{hash}/evidence` after a photo is taken and uploaded.
