import { describe, expect, it } from "vitest";
import { checkReceipt, type Receipt } from "./receipt";
import { makeServiceKey } from "./test-helpers";

// Produced by tradedeck-api (identity_core.make_receipt) with a throwaway key; the same vector is verified in
// tradedeck-api/tests/test_identity.py. If either side changes the format, both tests fail.
const VECTOR_PUB = "BK9KLQI7FrDwxKlg4FEpLz4MkVcEs8n9yqAslQzczPf9Aed0/GocEwPX1VNbDZQTQkMWag/j+n7UNTFt196/6pM=";
const VECTOR: Receipt = {
  payload: {
    kind: "tradedeck.shield.idreceipt", v: 1, attestationId: "66666666-6666-4666-8666-666666666666", noteSha256: "b".repeat(64),
    deviceSealId: "AAAAAAAA·BBBBBBBB", sessionSha256: "9d4c448fe82e0f2a7f32726170adde6932087bf87fa5f693b7b6dd5f99cff474",
    idCheck: { provider: "stripe-identity", status: "verified" }, issuedAt: "2026-10-11T12:00:00Z", kid: "1a473f66e378a662",
  },
  signature: "uzbbuUQjxU6wvVHMGAXsviysDU+m1lGF8wRqGITK8Ltq17pl6z4YIzY+U6WFskTq9z5NWoWguuGas8Kt/zKxJw==",
};
const EXPECT = { attestationId: VECTOR.payload.attestationId, noteSha256: VECTOR.payload.noteSha256, deviceSealId: VECTOR.payload.deviceSealId };
const KEYS = { "1a473f66e378a662": VECTOR_PUB };

describe("receipt", () => {
  it("verifies a receipt signed by the Python backend", async () => {
    expect(await checkReceipt(VECTOR, EXPECT, KEYS)).toEqual({ failed: [], confirmedBy: "1a473f66e378a662" });
  });

  it("is well-formed but unconfirmed when its key is not pinned", async () => {
    expect(await checkReceipt(VECTOR, EXPECT, {})).toEqual({ failed: [], confirmedBy: null });
  });

  it("rejects edits, a different note, and a key id that names the wrong key", async () => {
    const edit = (over: object): Receipt => ({ ...VECTOR, payload: { ...VECTOR.payload, ...over } });
    expect((await checkReceipt(edit({ issuedAt: "2026-10-11T12:00:01Z" }), EXPECT, KEYS)).failed).toContain("receipt-signature-invalid");
    expect((await checkReceipt(VECTOR, { ...EXPECT, noteSha256: "c".repeat(64) }, KEYS)).failed).toContain("receipt-mismatch");
    expect((await checkReceipt(edit({ idCheck: { provider: "stripe-identity", status: "canceled" } }), EXPECT, KEYS)).failed).toContain("receipt-not-verified");
    const other = await makeServiceKey();
    // A different key filed under the real key's name must not pass.
    expect((await checkReceipt(VECTOR, EXPECT, { "1a473f66e378a662": other.publicKey })).failed).toContain("receipt-signature-invalid");
    expect((await checkReceipt({ ...VECTOR, signature: "AAAA" }, EXPECT, KEYS)).failed.length).toBeGreaterThan(0);
  });
});
