/**
 * Public keys that verify ID-check receipts, keyed by key id (first 16 hex chars of SHA-256 over the raw key).
 *
 * Filled from `python scripts/gen_receipt_key.py` (kept in tradedeck-api's scripts), one key per server that signs receipts. It is pinned here, not fetched at runtime: a key
 * copied from a live endpoint would let whoever controls the network choose who to trust. A receipt signed by a key not
 * listed here is accepted as well-formed but reported as `id-receipt-signer-unknown`, never as confirmed.
 * To rotate, add the new key alongside the old one so records already sealed still verify.
 */
export const TRUSTED_RECEIPT_KEYS: Record<string, string> = {
  // The standalone Shield server (tradedeck-shield.onrender.com): the one the app now signs on with.
  "321c9150a35b8a0e": "BOd/0hrsOomtv+jjVd9a25qKnCX39BJT6IT/NsA4ffqvoh7g/9t7kkuQtcD33gPg0iIoxY3Yoa+bX76kg8fXPGg=",
  // The earlier key, from when the app signed on through the TradeDeck server. Kept so records already sealed still verify.
  "466ac7e85fc78a0f": "BPAfLxO3jzGmQdtXR/NfAwDVds4TFJuAgg8EW9kr+mXSgt9fimGGCxBb0bYfwR1pjLxTEiMIygewf6vGuvT6tF0=",
};
