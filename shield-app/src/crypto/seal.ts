const IDB_NAME = "shield-keys";
const STORE = "kv";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    q.onsuccess = () => resolve(q.result as T | undefined);
    q.onerror = () => reject(q.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const q = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
    q.onsuccess = () => resolve();
    q.onerror = () => reject(q.error);
  });
}

export async function sha256Bytes(data: BufferSource): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", data));
}

export function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

export function shortSeal(hexHash: string): string {
  return `${hexHash.slice(0, 8)}·${hexHash.slice(8, 16)}`.toUpperCase();
}

async function getOrCreateKey(): Promise<CryptoKeyPair> {
  const existing = await idbGet<CryptoKeyPair>("device-ecdsa");
  if (existing?.privateKey && existing.publicKey) return existing;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  await idbSet("device-ecdsa", pair);
  return pair;
}

export async function deviceSealId(): Promise<string> {
  const cached = await idbGet<string>("device-seal-id");
  if (cached) return cached;
  const pair = await getOrCreateKey();
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const id = shortSeal(await sha256Bytes(raw));
  await idbSet("device-seal-id", id);
  return id;
}

export async function signPayload(payload: unknown): Promise<string> {
  const pair = await getOrCreateKey();
  const bytes = new TextEncoder().encode(stableStringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes);
  return b64(sig);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function chainStep(prev: string, recordHash: string): Promise<string> {
  return sha256Text(`${prev}|${recordHash}`);
}

export function genesis(): string {
  return "0".repeat(64);
}

export function b64FromBytes(data: ArrayBuffer): string {
  return b64(data);
}

export function bytesFromB64(b64s: string): ArrayBuffer {
  const bin = atob(b64s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Raw (uncompressed point) P-256 public key, base64. Safe to embed in exports. */
export async function devicePublicKeyRaw(): Promise<string> {
  const pair = await getOrCreateKey();
  return b64(await crypto.subtle.exportKey("raw", pair.publicKey));
}

export async function verifySignature(publicKeyRawB64: string, payload: unknown, signatureB64: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    bytesFromB64(publicKeyRawB64),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const bytes = new TextEncoder().encode(stableStringify(payload));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytesFromB64(signatureB64), bytes);
}
