/**
 * Canonical bytes for one on-phone capture record.
 *
 * This is the phone-side copy of Tradedeck-api `shield/capture_record.py` and
 * `shield/time_audit.py` (PRs #15 and #16). The signed fields, the link
 * formula, and the CONSISTENT / UNVERIFIED TIME / DEVICE CLOCK MISMATCH rules
 * match that contract. Frozen fixtures live in `test-vectors/capture-record-v1.json`.
 *
 * `prev_hash` and `record_hash` travel beside the record. They are not inside
 * the canonical JSON. The first record's `prev_hash` is the job-ticket hash
 * when a server ticket exists, or a local anchor the export labels as local.
 */

export const RECORD_VERSION = 1;
export const CLOCK_MISMATCH_LIMIT_MS = 120_000;
export const JS_SAFE_INT = 2 ** 53 - 1;
export const GENESIS_CHALLENGE = "shield-genesis-v1";

export const VERDICT_INTACT = "INTACT";
export const VERDICT_TAMPERED = "TAMPERED";
export const VERDICT_CONSISTENT = "CONSISTENT";
export const VERDICT_UNVERIFIED_TIME = "UNVERIFIED TIME";
export const VERDICT_DEVICE_CLOCK_MISMATCH = "DEVICE CLOCK MISMATCH";

export const FLAG_SCREEN_CAPTURED = 1 << 0;
export const FLAG_DEBUGGER = 1 << 1;
export const FLAG_MOCK_LOCATION = 1 << 2;
export const FLAG_ROOT_TRACES = 1 << 3;

export const RECORD_FIELDS = [
  "version",
  "checkpoint_id",
  "photo_sha256",
  "ticket_id",
  "wall_time_ms",
  "monotonic_ms",
  "boot_id",
  "boot_count",
  "gnss_time_ms",
  "location_simulated",
  "sensor_hash",
  "depth_hash",
  "depth_present",
  "flags",
] as const;

const REQUIRED = new Set([
  "version",
  "checkpoint_id",
  "photo_sha256",
  "ticket_id",
  "wall_time_ms",
  "monotonic_ms",
  "flags",
]);

const INT_FIELDS = new Set([
  "version",
  "wall_time_ms",
  "monotonic_ms",
  "boot_count",
  "gnss_time_ms",
  "flags",
]);
const NON_NEGATIVE = new Set(["version", "monotonic_ms", "boot_count", "flags"]);
const BOOL_FIELDS = new Set(["location_simulated", "depth_present"]);
const HEX_FIELDS = new Set(["photo_sha256", "sensor_hash", "depth_hash"]);
const TEXT_FIELDS = new Set(["checkpoint_id", "ticket_id", "boot_id"]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_TEXT = 512;

const FLAG_NAMES: Array<[number, string]> = [
  [FLAG_SCREEN_CAPTURED, "screen_captured"],
  [FLAG_DEBUGGER, "debugger"],
  [FLAG_MOCK_LOCATION, "mock_location"],
  [FLAG_ROOT_TRACES, "root_traces"],
];

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface CaptureFields {
  version: number;
  checkpoint_id: string;
  photo_sha256: string;
  ticket_id: string;
  wall_time_ms: number;
  monotonic_ms: number;
  boot_id?: string | null;
  boot_count?: number | null;
  gnss_time_ms?: number | null;
  location_simulated?: boolean | null;
  sensor_hash?: string | null;
  depth_hash?: string | null;
  depth_present?: boolean | null;
  flags: number;
}

export interface SealedCapture extends CaptureFields {
  prev_hash: string;
  record_hash: string;
}

export interface ChainResult {
  verdict: typeof VERDICT_INTACT | typeof VERDICT_TAMPERED;
  intact: boolean;
  records: number;
  verified: number;
  broken_at_index: number | null;
  reason: string | null;
  head_hash: string;
  record_version: number;
  summary: string;
}

export interface ClockObservation {
  wall_time_ms?: number | null;
  monotonic_ms?: number | null;
  boot_id?: string | null;
  boot_count?: number | null;
  gnss_time_ms?: number | null;
  flags?: number | null;
  location_simulated?: boolean | null;
}

export interface TimeResult {
  verdict: string;
  labels: string[];
  boot_changed: boolean;
  monotonic_delta_ms: number | null;
  gnss: "absent" | "agrees" | "mismatch" | "uncompared";
  gnss_delta_ms: number | null;
  detail: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function isWhole(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= JS_SAFE_INT;
}

function rejectFloat(value: unknown, key: string): void {
  if (typeof value === "number" && !Number.isInteger(value)) {
    fail(`${key} is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail(`${key} is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)`);
  }
}

function whole(value: unknown, key: string, nonNegative = false): number {
  rejectFloat(value, key);
  if (typeof value === "boolean" || typeof value !== "number") fail(`${key} must be a whole number`);
  if (!isWhole(value)) fail(`${key} is outside the range a JSON number can carry exactly`);
  if (nonNegative && value < 0) fail(`${key} cannot be negative`);
  return value;
}

function text(value: unknown, key: string): string {
  rejectFloat(value, key);
  if (typeof value !== "string") fail(`${key} must be a string`);
  if (value === "") fail(`${key} must not be empty`);
  if (value.length > MAX_TEXT) fail(`${key} is longer than ${MAX_TEXT} characters`);
  return value;
}

function sha256Hex(value: unknown, key: string): string {
  const t = text(value, key);
  if (!SHA256_HEX.test(t)) fail(`${key} must be a 64-character lowercase hex SHA-256`);
  return t;
}

/** Python `json.dumps(..., ensure_ascii=True)` string escaping. */
export function escapeJsonString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp > 0x7e) {
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        const hi = 0xd800 + (v >> 10);
        const lo = 0xdc00 + (v & 0x3ff);
        out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${cp.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return `${out}"`;
}

export function canonicalJson(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isWhole(value)) fail("canonical JSON rejected a float");
    return String(value);
  }
  if (typeof value === "string") return escapeJsonString(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${escapeJsonString(key)}:${canonicalJson(value[key] as Json)}`).join(",")}}`;
}

function field(key: string, value: unknown): Json {
  if (BOOL_FIELDS.has(key)) {
    rejectFloat(value, key);
    if (typeof value !== "boolean") fail(`${key} must be a JSON boolean, not ${typeof value}`);
    return value;
  }
  if (HEX_FIELDS.has(key)) return sha256Hex(value, key);
  if (INT_FIELDS.has(key)) return whole(value, key, NON_NEGATIVE.has(key));
  if (TEXT_FIELDS.has(key)) return text(value, key);
  fail(`unknown capture-record field ${JSON.stringify(key)}`);
}

function checkShape(record: Record<string, unknown>): void {
  if (record.version !== RECORD_VERSION) {
    fail(`unsupported capture record version ${String(record.version)}; this contract is version ${RECORD_VERSION}`);
  }
  for (const key of REQUIRED) {
    if (!(key in record) || record[key] == null) fail(`capture record is missing ${key}`);
  }
  const present = record.depth_present;
  const digest = record.depth_hash;
  if (present === true && (digest == null)) fail("depth_present is true but depth_hash is missing");
  if (digest != null && present !== true) fail("depth_hash is set but depth_present is not true");
}

function walkWhole(value: unknown, key: string): Json {
  rejectFloat(value, key);
  if (value == null || typeof value === "string") {
    if (typeof value === "string" && value.length > MAX_TEXT) fail(`${key} is longer than ${MAX_TEXT} characters`);
    return value as Json;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return whole(value, key);
  if (Array.isArray(value)) return value.map((item) => walkWhole(item, key));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(obj)) out[k] = walkWhole(obj[k], k);
    return out;
  }
  fail(`${key} has type ${typeof value}, which the capture record cannot sign`);
}

function dropNulls(value: Json): Json {
  if (Array.isArray(value)) return value.map((item) => dropNulls(item));
  if (value && typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const key of Object.keys(value)) {
      const child = (value as { [k: string]: Json })[key];
      if (child != null) out[key] = dropNulls(child);
    }
    return out;
  }
  return value;
}

export function canonicalBytes(record: object): Uint8Array {
  if (record == null || typeof record !== "object" || Array.isArray(record)) fail("capture record must be a JSON object");
  const fields = record as Record<string, unknown>;
  checkShape(fields);
  const out: { [k: string]: Json } = {};
  for (const key of RECORD_FIELDS) {
    if (!(key in fields) || fields[key] == null) continue;
    out[key] = field(key, fields[key]);
  }
  return new TextEncoder().encode(canonicalJson(out));
}

export function canonical(record: object): string {
  return new TextDecoder().decode(canonicalBytes(record));
}

export function canonicalWhole(payload: object): string {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) fail("snapshot must be a JSON object");
  const walked = dropNulls(walkWhole(payload as Record<string, unknown>, "payload"));
  return canonicalJson(walked);
}

export async function sha256HexBytes(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashWhole(payload: object): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(canonicalWhole(payload)));
}

export async function photoSha256(data: BufferSource): Promise<string> {
  return sha256HexBytes(data);
}

export async function link(record: object, prevHash: string): Promise<string> {
  if (typeof prevHash !== "string") fail("prev_hash must be a string");
  const body = canonicalBytes(record);
  const msg = new Uint8Array(body.length + 1 + prevHash.length);
  msg.set(body, 0);
  msg[body.length] = 0x7c;
  msg.set(new TextEncoder().encode(prevHash), body.length + 1);
  return sha256HexBytes(msg as BufferSource);
}

export function signingMessage(record: object, prevHash: string): Uint8Array {
  const body = canonicalBytes(record);
  const msg = new Uint8Array(body.length + 1 + prevHash.length);
  msg.set(body, 0);
  msg[body.length] = 0x7c;
  msg.set(new TextEncoder().encode(prevHash), body.length + 1);
  return msg;
}

export function buildRecord(input: CaptureFields): CaptureFields {
  const record: Record<string, unknown> = {
    version: input.version ?? RECORD_VERSION,
    checkpoint_id: input.checkpoint_id,
    photo_sha256: input.photo_sha256,
    ticket_id: input.ticket_id,
    wall_time_ms: input.wall_time_ms,
    monotonic_ms: input.monotonic_ms,
    boot_id: input.boot_id ?? null,
    boot_count: input.boot_count ?? null,
    gnss_time_ms: input.gnss_time_ms ?? null,
    location_simulated: input.location_simulated ?? null,
    sensor_hash: input.sensor_hash ?? null,
    depth_hash: input.depth_hash ?? null,
    depth_present: input.depth_present ?? null,
    flags: input.flags ?? 0,
  };
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value != null) kept[key] = value;
  }
  canonical(kept);
  return kept as unknown as CaptureFields;
}

export async function seal(record: object, prevHash: string): Promise<SealedCapture> {
  if (!SHA256_HEX.test(prevHash)) fail("prev_hash must be a 64-character lowercase hex SHA-256");
  const digest = await link(record, prevHash);
  const sealed: Record<string, unknown> = { ...record, prev_hash: prevHash, record_hash: digest };
  for (const key of Object.keys(sealed)) {
    if ((RECORD_FIELDS as readonly string[]).includes(key) && sealed[key] == null) delete sealed[key];
  }
  return sealed as unknown as SealedCapture;
}

export function flagNames(flags: number): string[] {
  const value = whole(flags, "flags", true);
  const names = FLAG_NAMES.filter(([bit]) => value & bit).map(([, name]) => name);
  let known = 0;
  for (const [bit] of FLAG_NAMES) known |= bit;
  let extra = value & ~known;
  let bitIndex = 0;
  while (extra) {
    if (extra & 1) names.push(`bit_${bitIndex}`);
    extra >>= 1;
    bitIndex += 1;
  }
  return names;
}

export async function verifyChain(
  records: object[],
  firstPrev: string,
  expectHead?: string | null,
): Promise<ChainResult> {
  if (!Array.isArray(records)) fail("records must be a list");
  let expectedPrev = firstPrev;
  let brokenAt: number | null = null;
  let reason: string | null = null;

  for (let index = 0; index < records.length; index += 1) {
    const raw = records[index];
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      brokenAt = index;
      reason = "record is not an object, so its bytes cannot be reproduced";
      break;
    }
    const record = raw as Record<string, unknown>;
    const storedPrev = record.prev_hash;
    const storedHash = record.record_hash;
    if (typeof storedHash !== "string" || !storedHash) {
      brokenAt = index;
      reason = "record carries no hash (never linked, or the hash was stripped)";
      break;
    }
    if (storedPrev !== expectedPrev) {
      brokenAt = index;
      reason = "link broken: this record does not name the hash of the record before it";
      break;
    }
    try {
      const recomputed = await link(record, storedPrev as string);
      if (recomputed !== storedHash) {
        brokenAt = index;
        reason = "bytes do not reproduce the hash: a signed field was edited after the record was hashed";
        break;
      }
    } catch (err) {
      brokenAt = index;
      reason = `bytes do not reproduce the hash (${err instanceof Error ? err.message : err})`;
      break;
    }
    expectedPrev = storedHash;
  }

  let head = expectedPrev;
  let intact = brokenAt == null;
  if (intact && expectHead != null && head !== expectHead) {
    intact = false;
    reason = "head does not match the head the holder was given; the chain was extended, shortened, or rewritten";
  }
  if (!intact && brokenAt != null) head = expectedPrev;
  const count = records.length;
  const verdict = intact ? VERDICT_INTACT : VERDICT_TAMPERED;
  return {
    verdict,
    intact,
    records: count,
    verified: brokenAt == null ? count : brokenAt,
    broken_at_index: brokenAt,
    reason,
    head_hash: head,
    record_version: RECORD_VERSION,
    summary: intact
      ? `All ${count} capture records reproduce their hashes and links.`
      : brokenAt != null
        ? `Capture chain is TAMPERED at record ${brokenAt + 1} of ${count}: ${reason}`
        : `Capture chain is TAMPERED: ${reason}`,
  };
}

function optionalInt(obs: ClockObservation, key: "wall_time_ms" | "monotonic_ms" | "boot_count" | "gnss_time_ms" | "flags", nonNegative = false): number | null {
  if (!(key in obs) || obs[key] == null) return null;
  return whole(obs[key], key, nonNegative);
}

function optionalText(obs: ClockObservation, key: "boot_id"): string | null {
  if (!(key in obs) || obs[key] == null) return null;
  const value = obs[key];
  rejectFloat(value, key);
  if (typeof value !== "string" || value === "") fail(`${key} must be a non-empty string when it is present`);
  return value;
}

export function bootChanged(ticket: ClockObservation, capture: ClockObservation): boolean {
  const ticketId = optionalText(ticket, "boot_id");
  const captureId = optionalText(capture, "boot_id");
  const ticketCount = optionalInt(ticket, "boot_count", true);
  const captureCount = optionalInt(capture, "boot_count", true);
  let saw = false;
  if (ticketId != null || captureId != null) {
    saw = true;
    if (ticketId == null || captureId == null || ticketId !== captureId) return true;
  }
  if (ticketCount != null || captureCount != null) {
    saw = true;
    if (ticketCount == null || captureCount == null || ticketCount !== captureCount) return true;
  }
  return !saw;
}

function gnss(capture: ClockObservation, wall: number | null): { status: TimeResult["gnss"]; delta: number | null } {
  const time = optionalInt(capture, "gnss_time_ms");
  if (time == null) return { status: "absent", delta: null };
  if (wall == null) return { status: "uncompared", delta: null };
  const delta = Math.abs(time - wall);
  return { status: delta > CLOCK_MISMATCH_LIMIT_MS ? "mismatch" : "agrees", delta };
}

export function assessTime(ticket: ClockObservation, capture: ClockObservation): TimeResult {
  const changed = bootChanged(ticket, capture);
  const ticketWall = optionalInt(ticket, "wall_time_ms");
  const captureWall = optionalInt(capture, "wall_time_ms");
  const ticketMono = optionalInt(ticket, "monotonic_ms", true);
  const captureMono = optionalInt(capture, "monotonic_ms", true);
  const gnssResult = gnss(capture, captureWall);

  let monotonicDelta: number | null = null;
  let unverifiedReason: string | null = null;
  let mismatchReason: string | null = null;

  if (changed) {
    unverifiedReason = "The boot identity changed between the ticket and the photo, so the monotonic interval cannot be checked.";
  } else if (ticketWall == null || captureWall == null || ticketMono == null || captureMono == null) {
    unverifiedReason = "A wall-clock or monotonic reading is missing, so the monotonic interval cannot be checked.";
  } else {
    const elapsed = captureMono - ticketMono;
    if (elapsed < 0) {
      unverifiedReason = "The monotonic clock moved backward between the ticket and the photo, so the monotonic interval cannot be checked.";
    } else {
      monotonicDelta = Math.abs(captureWall - (ticketWall + elapsed));
      if (monotonicDelta > CLOCK_MISMATCH_LIMIT_MS) {
        mismatchReason = `The wall clock differs from the ticket time plus monotonic elapsed by ${monotonicDelta} ms, which is more than ${CLOCK_MISMATCH_LIMIT_MS} ms.`;
      }
    }
  }

  let gnssNote: string | null = null;
  if (gnssResult.status === "mismatch") {
    const gnssReason = `GNSS time differs from the wall clock by ${gnssResult.delta} ms, which is more than ${CLOCK_MISMATCH_LIMIT_MS} ms.`;
    mismatchReason = mismatchReason ? `${mismatchReason} ${gnssReason}` : gnssReason;
  } else if (gnssResult.status === "absent") {
    gnssNote = unverifiedReason == null
      ? "No GNSS time was present; the time verdict stands on the monotonic clock."
      : "No GNSS time was present.";
  } else if (gnssResult.status === "uncompared") {
    gnssNote = "GNSS time was present, but the wall clock was not, so it was not compared.";
  } else {
    gnssNote = `GNSS time is within ${CLOCK_MISMATCH_LIMIT_MS} ms of the wall clock.`;
  }

  const labels: string[] = [];
  if (unverifiedReason != null) labels.push(VERDICT_UNVERIFIED_TIME);
  if (mismatchReason != null) labels.push(VERDICT_DEVICE_CLOCK_MISMATCH);
  const verdict = labels.includes(VERDICT_DEVICE_CLOCK_MISMATCH)
    ? VERDICT_DEVICE_CLOCK_MISMATCH
    : labels.includes(VERDICT_UNVERIFIED_TIME)
      ? VERDICT_UNVERIFIED_TIME
      : VERDICT_CONSISTENT;

  const parts = [unverifiedReason, mismatchReason].filter((part): part is string => part != null);
  if (verdict === VERDICT_CONSISTENT) {
    parts.push(`The boot did not change, and the wall clock is within ${CLOCK_MISMATCH_LIMIT_MS} ms of the ticket time plus monotonic elapsed.`);
  }
  if (gnssNote) parts.push(gnssNote);

  return {
    verdict,
    labels,
    boot_changed: changed,
    monotonic_delta_ms: monotonicDelta,
    gnss: gnssResult.status,
    gnss_delta_ms: gnssResult.delta,
    detail: parts.join(" "),
  };
}

/** Phone clocks that `normalize_clock` in ticket.py will accept. Extra keys are dropped. */
export function ticketClockBytes(observation: ClockObservation): string {
  const clock: Record<string, Json> = {};
  if (observation.boot_count != null) clock.boot_count = whole(observation.boot_count, "boot_count", true);
  if (observation.boot_id != null && typeof observation.boot_id !== "string") {
    fail("boot_id must be a non-empty string when it is present");
  }
  if (typeof observation.boot_id === "string" && observation.boot_id !== "") clock.boot_id = observation.boot_id;
  if (observation.monotonic_ms == null || observation.wall_time_ms == null) {
    fail("ticket_clock needs wall_time_ms and monotonic_ms");
  }
  clock.monotonic_ms = whole(observation.monotonic_ms, "monotonic_ms", true);
  clock.wall_time_ms = whole(observation.wall_time_ms, "wall_time_ms");
  if (clock.boot_id == null && clock.boot_count == null) fail("ticket_clock needs a boot_id or a boot_count");
  assessTime(clock as ClockObservation, clock as ClockObservation);
  return canonicalJson(clock);
}

/**
 * `SHA256(ticket_hash_raw || canonical(ticket_clock))`, the 32-byte payload
 * inside genesis clientData. Not the ticket hash by itself.
 */
export async function genesisPayload(ticketHashHex: string, observation: ClockObservation): Promise<Uint8Array> {
  if (!SHA256_HEX.test(ticketHashHex)) fail("ticket hash must be a 64-character lowercase hex SHA-256");
  const clock = new TextEncoder().encode(ticketClockBytes(observation));
  const raw = new Uint8Array(32 + clock.length);
  for (let i = 0; i < 32; i += 1) raw[i] = Number.parseInt(ticketHashHex.slice(i * 2, i * 2 + 2), 16);
  raw.set(clock, 32);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
}

export async function genesisClientData(ticketHashHex: string, observation: ClockObservation): Promise<Uint8Array> {
  const payload = await genesisPayload(ticketHashHex, observation);
  const prefix = new TextEncoder().encode(GENESIS_CHALLENGE);
  const out = new Uint8Array(prefix.length + payload.length);
  out.set(prefix, 0);
  out.set(payload, prefix.length);
  return out;
}

/** Local chain anchor used only when no server ticket has been adopted. Not a server ticket hash. */
export async function localGenesisHash(ticketId: string, observation: ClockObservation): Promise<string> {
  const clock = ticketClockBytes(observation);
  const text = `tradedeck.shield.local-genesis.v1\n${clock}\n${ticketId}`;
  return sha256HexBytes(new TextEncoder().encode(text));
}

function readLen(bytes: Uint8Array, offset: number): { value: number; next: number } {
  if (offset >= bytes.length) fail("truncated DER");
  const first = bytes[offset]!;
  if ((first & 0x80) === 0) return { value: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 3) fail("bad DER length");
  let value = 0;
  for (let i = 0; i < count; i += 1) value = (value << 8) | bytes[offset + 1 + i]!;
  return { value, next: offset + 1 + count };
}

function readInteger(bytes: Uint8Array, offset: number): { raw: Uint8Array; next: number } {
  if (bytes[offset] !== 0x02) fail("DER integer expected");
  const len = readLen(bytes, offset + 1);
  const start = len.next;
  const raw = bytes.slice(start, start + len.value);
  return { raw, next: start + len.value };
}

/** DER ECDSA signature to the raw r||s form WebCrypto verifies. */
export function derToRawP1363(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) fail("DER sequence expected");
  const seq = readLen(der, 1);
  let cursor = seq.next;
  const r = readInteger(der, cursor);
  const s = readInteger(der, r.next);
  const trim = (raw: Uint8Array) => {
    let i = 0;
    while (i < raw.length - 1 && raw[i] === 0) i += 1;
    return raw.slice(i);
  };
  const rr = trim(r.raw);
  const ss = trim(s.raw);
  if (rr.length > 32 || ss.length > 32) fail("P-256 signature component is too wide");
  const out = new Uint8Array(64);
  out.set(rr, 32 - rr.length);
  out.set(ss, 64 - ss.length);
  if (s.next !== seq.next + seq.value && s.next !== der.length) {
    // trailing bytes are not part of this signature
  }
  return out;
}

export function rawP1363ToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) fail("P-256 raw signature must be 64 bytes");
  const intBytes = (part: Uint8Array) => {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i += 1;
    const body = part.slice(i);
    const needsPad = (body[0]! & 0x80) !== 0;
    const out = new Uint8Array((needsPad ? 1 : 0) + body.length);
    if (needsPad) out.set(body, 1);
    else out.set(body, 0);
    return out;
  };
  const r = intBytes(raw.slice(0, 32));
  const s = intBytes(raw.slice(32));
  const body = new Uint8Array(2 + r.length + 2 + s.length);
  body[0] = 0x02;
  body[1] = r.length;
  body.set(r, 2);
  body[2 + r.length] = 0x02;
  body[3 + r.length] = s.length;
  body.set(s, 4 + r.length);
  if (body.length < 128) {
    const out = new Uint8Array(2 + body.length);
    out[0] = 0x30;
    out[1] = body.length;
    out.set(body, 2);
    return out;
  }
  const out = new Uint8Array(3 + body.length);
  out[0] = 0x30;
  out[1] = 0x81;
  out[2] = body.length;
  out.set(body, 3);
  return out;
}

export async function verifyHardwareSignature(
  publicKeyUncompressedB64: string,
  message: Uint8Array,
  signatureDerB64: string,
): Promise<boolean> {
  const point = bytesFromB64(publicKeyUncompressedB64);
  const signature = derToRawP1363(bytesFromB64(signatureDerB64));
  const key = await crypto.subtle.importKey(
    "raw",
    point as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, message as BufferSource);
}

function bytesFromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ExportRecord {
  record: SealedCapture;
  sensor_snapshot?: Record<string, unknown> | null;
  signature_der_b64?: string;
  public_key_uncompressed_b64?: string;
  photo_sha256_bytes?: string | null;
}

export interface ExportPackage {
  schema: "tradedeck.shield.capture-export.v1";
  ticket_id?: string;
  ticket_origin?: "local" | "server";
  anchor_hash: string;
  ticket_clock?: ClockObservation | null;
  records: ExportRecord[];
  expect_head?: string | null;
}

export interface ExportVerification {
  chain: ChainResult;
  time: TimeResult[];
  signatures: Array<"valid" | "invalid" | "absent">;
  sensor: Array<"match" | "mismatch" | "absent">;
  photos: Array<"match" | "mismatch" | "absent">;
}

/** Verify an export with the same byte rules the server uses. Photo bytes are optional. */
export async function verifyExport(pkg: ExportPackage): Promise<ExportVerification> {
  if (pkg?.schema !== "tradedeck.shield.capture-export.v1") fail("unsupported export schema");
  const chain = await verifyChain(
    pkg.records.map((item) => item.record as unknown as Record<string, unknown>),
    pkg.anchor_hash,
    pkg.expect_head,
  );
  const time: TimeResult[] = [];
  const signatures: ExportVerification["signatures"] = [];
  const sensor: ExportVerification["sensor"] = [];
  const photos: ExportVerification["photos"] = [];
  for (const item of pkg.records) {
    time.push(pkg.ticket_clock ? assessTime(pkg.ticket_clock, item.record) : {
      verdict: VERDICT_UNVERIFIED_TIME,
      labels: [VERDICT_UNVERIFIED_TIME],
      boot_changed: true,
      monotonic_delta_ms: null,
      gnss: "absent",
      gnss_delta_ms: null,
      detail: "No ticket clock was stored, so the monotonic interval cannot be checked.",
    });
    if (item.sensor_snapshot && item.record.sensor_hash) {
      const digest = await hashWhole(item.sensor_snapshot);
      sensor.push(digest === item.record.sensor_hash ? "match" : "mismatch");
    } else sensor.push("absent");
    if (item.photo_sha256_bytes) photos.push(item.photo_sha256_bytes === item.record.photo_sha256 ? "match" : "mismatch");
    else photos.push("absent");
    if (item.signature_der_b64 && item.public_key_uncompressed_b64) {
      const message = signingMessage(item.record as unknown as Record<string, unknown>, item.record.prev_hash);
      const ok = await verifyHardwareSignature(item.public_key_uncompressed_b64, message, item.signature_der_b64);
      signatures.push(ok ? "valid" : "invalid");
    } else signatures.push("absent");
  }
  return { chain, time, signatures, sensor, photos };
}
