/**
 * Public keys that verify ID-check receipts, keyed by key id (first 16 hex chars of SHA-256 over the raw key).
 *
 * Filled from `python scripts/gen_receipt_key.py` in tradedeck-api. It is pinned here, not fetched at runtime: a key
 * copied from a live endpoint would let whoever controls the network choose who to trust. A receipt signed by a key not
 * listed here is accepted as well-formed but reported as `id-receipt-signer-unknown`, never as confirmed.
 * To rotate, add the new key alongside the old one so records already sealed still verify.
 */
export const TRUSTED_RECEIPT_KEYS: Record<string, string> = {
  "127616f5494b11b0": "BIUGKigfYfYYJUuYTJCRYzlLzmu7Xi4Z7ppTTpcTfcrWQRu9WpIwUEHgz63y27aY6ebvYfyhzzP1VbYQbSUu2R4=",
};
