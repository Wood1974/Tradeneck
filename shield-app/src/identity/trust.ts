/**
 * Public keys that verify ID-check receipts, keyed by key id (first 16 hex chars of SHA-256 over the raw key).
 *
 * Fill this from `python scripts/gen_receipt_key.py` in tradedeck-api, once, before a production build. It is empty on
 * purpose: a key copied from a live endpoint at runtime would let whoever controls the network choose who to trust.
 * While it is empty a receipt is accepted as well-formed but reported as `id-receipt-signer-unknown`, never as confirmed.
 */
export const TRUSTED_RECEIPT_KEYS: Record<string, string> = {};
