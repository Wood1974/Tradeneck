# Photo upload as a form

The app stores a sealed photo with `POST /shield/captures/upload`: the photo as raw bytes in a multipart form, the record and signatures as a JSON field. That is a third smaller on the wire than the base64-in-JSON route (`POST /shield/captures`), which matters on a weak connection.

- Same server checks, same replies, same refusal codes as the JSON route. Nothing new leaves the phone: the same record, signature, Apple proof and photo.
- A server that predates the multipart route answers 404 for it; the app then sends that photo the old way. Real refusals (`photo_hash_mismatch`, `quota_exceeded` and so on) are never retried the old way.
- The photo still reaches the web view as base64 from the native plugin and is decoded once to bytes before sending; this change saves bytes on the network, not memory on the phone.
- Server side: `tradedeck-shield` `docs/features/multipart-upload.md`.
