import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLOCK_MISMATCH_LIMIT_MS,
  FLAG_DEBUGGER,
  FLAG_MOCK_LOCATION,
  FLAG_ROOT_TRACES,
  FLAG_SCREEN_CAPTURED,
  VERDICT_CONSISTENT,
  VERDICT_DEVICE_CLOCK_MISMATCH,
  VERDICT_INTACT,
  VERDICT_TAMPERED,
  VERDICT_UNVERIFIED_TIME,
  assessTime,
  buildRecord,
  canonical,
  canonicalWhole,
  derToRawP1363,
  flagNames,
  genesisClientData,
  genesisPayload,
  hashWhole,
  link,
  localGenesisHash,
  photoSha256,
  rawP1363ToDer,
  seal,
  sha256HexBytes,
  signingMessage,
  verifyChain,
  verifyExport,
  verifyHardwareSignature,
  type ClockObservation,
} from "./record";

const vectors = JSON.parse(
  readFileSync(new URL("../../test-vectors/capture-record-v1.json", import.meta.url), "utf8"),
) as {
  photoSha256: string;
  prevHash: string;
  canonicalRequired: string;
  recordHashRequired: string;
  canonicalFull: string;
  snapshotBytes: string;
  sensorHash: string;
  depthBytes: string;
  depthHash: string;
  ticketClockBytes: string;
  ticketHashHex: string;
  genesisPayloadSha256: string;
};

const PHOTO = vectors.photoSha256;
const PREV = vectors.prevHash;

function required(overrides: Record<string, unknown> = {}) {
  return buildRecord({
    version: 1,
    checkpoint_id: "cp-1",
    photo_sha256: PHOTO,
    ticket_id: "ticket-1",
    wall_time_ms: 1_700_000_000_000,
    monotonic_ms: 5_000,
    boot_count: 4,
    flags: 0,
    ...overrides,
  });
}

const T0 = 1_700_000_000_000;
const M0 = 10_000;
const LIMIT = CLOCK_MISMATCH_LIMIT_MS;

function ticket(overrides: ClockObservation = {}): ClockObservation {
  return { wall_time_ms: T0, monotonic_ms: M0, boot_count: 7, boot_id: "boot-a", ...overrides };
}

function photo(elapsedMs = 60_000, wallSlipMs = 0, overrides: ClockObservation = {}): ClockObservation {
  return {
    wall_time_ms: T0 + elapsedMs + wallSlipMs,
    monotonic_ms: M0 + elapsedMs,
    boot_count: 7,
    boot_id: "boot-a",
    ...overrides,
  };
}

describe("capture record canonical bytes", () => {
  it("matches the server fixture for a required record", () => {
    expect(canonical(required())).toBe(vectors.canonicalRequired);
  });

  it("matches the server fixture for the full record, including the escaped checkpoint", async () => {
    const sensor = await hashWhole({ heading_hundredths: 18450, duration_ms: 200, accel_milli_g: [0, 0, 1000] });
    const depth = await hashWhole({ width: 4, height: 4, millimetres: [1000, 1001, 1002, 1003] });
    expect(sensor).toBe(vectors.sensorHash);
    expect(depth).toBe(vectors.depthHash);
    expect(canonicalWhole({ heading_hundredths: 18450, duration_ms: 200, accel_milli_g: [0, 0, 1000] })).toBe(vectors.snapshotBytes);
    expect(canonicalWhole({ width: 4, height: 4, millimetres: [1000, 1001, 1002, 1003] })).toBe(vectors.depthBytes);
    const full = buildRecord({
      version: 1,
      checkpoint_id: "café",
      photo_sha256: PHOTO,
      ticket_id: "ticket-1",
      wall_time_ms: 1_700_000_000_000,
      monotonic_ms: 5_000,
      boot_id: "BOOT-SESSION",
      boot_count: 4,
      gnss_time_ms: 1_700_000_000_500,
      location_simulated: false,
      sensor_hash: sensor,
      depth_hash: depth,
      depth_present: true,
      flags: FLAG_SCREEN_CAPTURED | FLAG_DEBUGGER | FLAG_MOCK_LOCATION | FLAG_ROOT_TRACES,
    });
    expect(canonical(full)).toBe(vectors.canonicalFull);
    expect(canonical(full)).toContain("\\u00e9");
  });

  it("links with the server record hash and ignores key order and unsigned fields", async () => {
    const body = required();
    expect(await link(body, PREV)).toBe(vectors.recordHashRequired);
    const sealed = await seal(body, PREV);
    expect(sealed.record_hash).toBe(vectors.recordHashRequired);
    expect(sealed.prev_hash).toBe(PREV);
    expect(canonical(sealed)).toBe(vectors.canonicalRequired);
    const message = new TextDecoder().decode(signingMessage(body, PREV));
    expect(message).toBe(`${vectors.canonicalRequired}|${PREV}`);
    const reversed = {
      flags: 0,
      wall_time_ms: 1_700_000_000_000,
      version: 1,
      ticket_id: "ticket-1",
      monotonic_ms: 5_000,
      photo_sha256: PHOTO,
      checkpoint_id: "cp-1",
      boot_count: 4,
      note: "not signed",
    };
    expect(canonical(reversed)).toBe(vectors.canonicalRequired);
  });

  it("treats absent and null as the same bytes, and keeps zero and false", () => {
    const withNull = required({ gnss_time_ms: null, location_simulated: null });
    const without = required();
    expect(canonical(withNull)).toBe(canonical(without));
    const explicitFalse = required({ location_simulated: false });
    expect(canonical(explicitFalse)).not.toBe(canonical(without));
    expect(canonical(explicitFalse)).toContain('"location_simulated":false');
    expect(canonical(required())).toContain('"flags":0');
  });

  it("rejects floats, booleans in number fields, and a depth hash without the flag", () => {
    expect(() => canonical(required({ wall_time_ms: 1.5 }))).toThrow(/float/);
    expect(() => canonical(required({ flags: true as unknown as number }))).toThrow(/whole number/);
    expect(() => canonical(required({ location_simulated: 0 as unknown as boolean }))).toThrow(/boolean/);
    expect(() => canonical(required({ depth_hash: PHOTO }))).toThrow(/depth_present/);
    expect(() => canonical(required({ depth_present: true }))).toThrow(/depth_hash/);
    expect(() => canonical(required({ photo_sha256: PHOTO.toUpperCase() }))).toThrow(/lowercase/);
    expect(() => canonicalWhole({ heading_hundredths: 18.45 })).toThrow(/float/);
  });

  it("hashes a photo the same way in one buffer or in chunks", async () => {
    const bytes = new TextEncoder().encode("shield-capture-record-fixture-photo");
    expect(await photoSha256(bytes)).toBe(PHOTO);
    expect(await sha256HexBytes(new Uint8Array())).toBe(await photoSha256(new Uint8Array()));
  });
});

describe("capture record hash chain", () => {
  async function chain(n = 4) {
    const records = [];
    let prev = PREV;
    for (let i = 0; i < n; i += 1) {
      const raw = buildRecord({
        version: 1,
        checkpoint_id: `cp-${i}`,
        photo_sha256: await photoSha256(new TextEncoder().encode(`photo-${i}`)),
        ticket_id: "ticket-1",
        wall_time_ms: 1_700_000_000_000 + i * 1000,
        monotonic_ms: 5_000 + i * 1000,
        boot_count: 4,
        flags: 0,
      });
      const sealed = await seal(raw, prev);
      records.push(sealed);
      prev = sealed.record_hash;
    }
    return records;
  }

  it("reports an untampered chain as INTACT and an empty chain at its anchor", async () => {
    const records = await chain();
    const result = await verifyChain(records, PREV);
    expect(result.verdict).toBe(VERDICT_INTACT);
    expect(result.intact).toBe(true);
    expect(result.broken_at_index).toBeNull();
    expect(result.verified).toBe(4);
    expect(result.head_hash).toBe(records[3]!.record_hash);
    expect(records[1]!.prev_hash).toBe(records[0]!.record_hash);
    const empty = await verifyChain([], PREV);
    expect(empty.verdict).toBe(VERDICT_INTACT);
    expect(empty.head_hash).toBe(PREV);
  });

  it("reports an edited field, a stripped hash, a broken link, and a dropped record as TAMPERED", async () => {
    const records = await chain();
    const edited = records.map((record) => ({ ...record }));
    edited[2] = { ...edited[2]!, wall_time_ms: edited[2]!.wall_time_ms + 1 };
    const edit = await verifyChain(edited, PREV);
    expect(edit.verdict).toBe(VERDICT_TAMPERED);
    expect(edit.broken_at_index).toBe(2);
    expect(edit.reason).toContain("bytes do not reproduce");

    const stripped = records.map((record) => ({ ...record }));
    delete (stripped[1] as { record_hash?: string }).record_hash;
    const strip = await verifyChain(stripped, PREV);
    expect(strip.broken_at_index).toBe(1);
    expect(strip.reason).toContain("no hash");

    const broken = records.map((record) => ({ ...record }));
    broken[1] = { ...broken[1]!, prev_hash: PREV };
    const linkBreak = await verifyChain(broken, PREV);
    expect(linkBreak.verdict).toBe(VERDICT_TAMPERED);
    expect(linkBreak.broken_at_index).toBe(1);
    expect(linkBreak.reason).toContain("link broken");

    const dropped = [records[0]!, records[1]!, records[3]!];
    expect((await verifyChain(dropped, PREV)).broken_at_index).toBe(2);

    const reordered = [records[1]!, records[0]!, records[2]!, records[3]!];
    expect((await verifyChain(reordered, PREV)).verdict).toBe(VERDICT_TAMPERED);

    const floated = records.map((record) => ({ ...record }));
    (floated[0] as { wall_time_ms: number }).wall_time_ms = 1.5;
    const floatResult = await verifyChain(floated, PREV);
    expect(floatResult.verdict).toBe(VERDICT_TAMPERED);
    expect(floatResult.reason).toContain("float");

    const shortHead = await verifyChain(records.slice(0, 3), PREV, records[3]!.record_hash);
    expect(shortHead.verdict).toBe(VERDICT_TAMPERED);
    expect(shortHead.reason).toContain("head does not match");
  });
});

describe("time labels", () => {
  it("keeps the 120.000 / 120.001 second boundary in both directions", () => {
    expect(assessTime(ticket(), photo(60_000, LIMIT)).verdict).toBe(VERDICT_CONSISTENT);
    expect(assessTime(ticket(), photo(60_000, LIMIT)).monotonic_delta_ms).toBe(LIMIT);
    expect(assessTime(ticket(), photo(60_000, LIMIT + 1)).verdict).toBe(VERDICT_DEVICE_CLOCK_MISMATCH);
    expect(assessTime(ticket(), photo(60_000, LIMIT + 1)).monotonic_delta_ms).toBe(LIMIT + 1);
    expect(assessTime(ticket(), photo(60_000, -LIMIT)).verdict).toBe(VERDICT_CONSISTENT);
    expect(assessTime(ticket(), photo(60_000, -(LIMIT + 1))).verdict).toBe(VERDICT_DEVICE_CLOCK_MISMATCH);
    expect(assessTime(ticket(), photo(60_000, 180_000)).monotonic_delta_ms).toBe(180_000);
  });

  it("labels a reboot UNVERIFIED TIME and does not turn the wall jump into a mismatch", () => {
    const rebooted = photo(60_000, 0, { boot_count: 8 });
    const result = assessTime(ticket(), rebooted);
    expect(result.verdict).toBe(VERDICT_UNVERIFIED_TIME);
    expect(result.boot_changed).toBe(true);
    expect(result.monotonic_delta_ms).toBeNull();
    expect(result.labels).toEqual([VERDICT_UNVERIFIED_TIME]);
    expect(result.detail).toContain("No GNSS");
    const jumped = photo(60_000, 180_000, { boot_count: 8 });
    expect(assessTime(ticket(), jumped).verdict).toBe(VERDICT_UNVERIFIED_TIME);
    expect(assessTime(ticket(), photo(60_000, 0, { boot_id: "boot-b" })).verdict).toBe(VERDICT_UNVERIFIED_TIME);
  });

  it("accepts either boot id or boot count, and refuses a one-sided or missing identity", () => {
    const androidTicket = ticket();
    delete androidTicket.boot_id;
    const androidPhoto = photo();
    delete androidPhoto.boot_id;
    expect(assessTime(androidTicket, androidPhoto).verdict).toBe(VERDICT_CONSISTENT);
    const iosTicket = ticket();
    delete iosTicket.boot_count;
    const iosPhoto = photo();
    delete iosPhoto.boot_count;
    expect(assessTime(iosTicket, iosPhoto).verdict).toBe(VERDICT_CONSISTENT);

    const onlyIos = ticket();
    delete onlyIos.boot_count;
    const onlyAndroid = photo();
    delete onlyAndroid.boot_id;
    expect(assessTime(onlyIos, onlyAndroid).boot_changed).toBe(true);

    const bareTicket = ticket();
    const barePhoto = photo();
    delete bareTicket.boot_id;
    delete bareTicket.boot_count;
    delete barePhoto.boot_id;
    delete barePhoto.boot_count;
    expect(assessTime(bareTicket, barePhoto).verdict).toBe(VERDICT_UNVERIFIED_TIME);
  });

  it("compares GNSS to the wall clock and does not let it clear a monotonic mismatch", () => {
    const agree = photo(60_000, 0, { gnss_time_ms: T0 + 60_000 });
    expect(assessTime(ticket(), agree).gnss).toBe("agrees");
    expect(assessTime(ticket(), agree).verdict).toBe(VERDICT_CONSISTENT);
    const past = photo(60_000, 0, { gnss_time_ms: T0 + 60_000 + LIMIT + 1 });
    expect(assessTime(ticket(), past).verdict).toBe(VERDICT_DEVICE_CLOCK_MISMATCH);
    expect(assessTime(ticket(), past).gnss).toBe("mismatch");

    const both = photo(60_000, 180_000, { gnss_time_ms: T0 + 60_000 + 180_000 });
    const mismatch = assessTime(ticket(), both);
    expect(mismatch.verdict).toBe(VERDICT_DEVICE_CLOCK_MISMATCH);
    expect(mismatch.gnss).toBe("agrees");

    const rebootAndGnss = photo(60_000, 0, { boot_count: 8, gnss_time_ms: T0 + 60_000 + LIMIT + 5 });
    const bothLabels = assessTime(ticket(), rebootAndGnss);
    expect(bothLabels.verdict).toBe(VERDICT_DEVICE_CLOCK_MISMATCH);
    expect(bothLabels.labels).toEqual([VERDICT_UNVERIFIED_TIME, VERDICT_DEVICE_CLOCK_MISMATCH]);
  });

  it("does not let flags or a simulated-location bit change the time verdict", () => {
    const clean = assessTime(ticket(), photo());
    const flagged = assessTime(
      { ...ticket(), flags: 15, location_simulated: true },
      { ...photo(), flags: FLAG_SCREEN_CAPTURED | FLAG_DEBUGGER | FLAG_MOCK_LOCATION | FLAG_ROOT_TRACES | (1 << 10), location_simulated: true },
    );
    expect(flagged.verdict).toBe(clean.verdict);
    expect(flagged.monotonic_delta_ms).toBe(clean.monotonic_delta_ms);
    expect(flagNames(15)).toEqual(["screen_captured", "debugger", "mock_location", "root_traces"]);
  });

  it("labels a backward monotonic clock UNVERIFIED TIME rather than a mismatch", () => {
    const backward = photo();
    backward.monotonic_ms = M0 - 1;
    backward.wall_time_ms = T0 - 1;
    const result = assessTime(ticket(), backward);
    expect(result.verdict).toBe(VERDICT_UNVERIFIED_TIME);
    expect(result.monotonic_delta_ms).toBeNull();
    expect(result.labels).not.toContain(VERDICT_DEVICE_CLOCK_MISMATCH);
  });
});

describe("genesis binding and hardware signature check", () => {
  it("seals the ticket clock into the genesis payload the server verifies", async () => {
    const clock = { wall_time_ms: 1_700_000_000_000, monotonic_ms: 5_000, boot_count: 4 };
    const payload = await genesisPayload(vectors.ticketHashHex, clock);
    const hex = [...payload].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(vectors.genesisPayloadSha256);
    const client = await genesisClientData(vectors.ticketHashHex, clock);
    expect(new TextDecoder().decode(client.slice(0, "shield-genesis-v1".length))).toBe("shield-genesis-v1");
    const again = await localGenesisHash("job-1", clock);
    expect(again).toBe(await localGenesisHash("job-1", clock));
    expect(again).not.toBe(await localGenesisHash("job-2", clock));
  });

  it("verifies a P-256 signature over the capture message and rejects a tampered one", async () => {
    const record = required();
    const message = signingMessage(record, PREV);
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const rawSig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message as BufferSource));
    const der = rawP1363ToDer(rawSig);
    expect([...derToRawP1363(der)]).toEqual([...rawSig]);
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const keyB64 = btoa(String.fromCharCode(...rawKey));
    const sigB64 = btoa(String.fromCharCode(...der));
    expect(await verifyHardwareSignature(keyB64, message, sigB64)).toBe(true);
    const tampered = new Uint8Array(message);
    tampered[0] ^= 0xff;
    expect(await verifyHardwareSignature(keyB64, tampered, sigB64)).toBe(false);

    const sealed = await seal(record, PREV);
    const exported = await verifyExport({
      schema: "tradedeck.shield.capture-export.v1",
      anchor_hash: PREV,
      ticket_clock: { wall_time_ms: 1_700_000_000_000, monotonic_ms: 5_000, boot_count: 4 },
      records: [{
        record: sealed,
        sensor_snapshot: null,
        signature_der_b64: sigB64,
        public_key_uncompressed_b64: keyB64,
      }],
    });
    expect(exported.chain.verdict).toBe(VERDICT_INTACT);
    expect(exported.signatures).toEqual(["valid"]);
    expect(exported.time[0]!.verdict).toBe(VERDICT_CONSISTENT);
  });
});
