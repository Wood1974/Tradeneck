# Completed jobs have their own folder in the Vault

A job is completed once it has been closed out (its record frozen on the Build tab). In the Vault, each completed job is a folder: tap it to see that job's photos and to download its completion record again.

- Photos of jobs still being worked on, and photos with no job, stay in the open list at the top.
- A photo is listed in exactly one place. A photo whose job this phone does not know stays in the open list, never hidden.
- Inside a folder, opening a photo shows BACK TO JOB. DOWNLOAD COMPLETION RECORD saves the stored completion record (and a readable HTML copy) from this phone; if the record is not on this phone it says so and writes nothing.
- This only changes where a photo is listed. Stored records, uploads, exports and the close-out packet are unchanged.

Code: `src/ui/vault-folders.ts` (grouping, pure and tested), wired into `vaultView` in `src/ui/app.ts`. Covered end to end by the close-out test in `e2e/shield.spec.ts`.

## Not verified
How it looks and feels on the phone, and a Vault with many jobs. A job closed out more than once is one folder (the latest record); re-closing is allowed and issues a new record.
