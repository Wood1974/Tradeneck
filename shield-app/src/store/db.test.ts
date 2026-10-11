import { describe, expect, it } from "vitest";
import { b64FromBytes } from "../crypto/seal";
import { getVaultBytes, listVault } from "./db";

function seedV1(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("shield-vault", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("vault", { keyPath: "record.id" });
      db.createObjectStore("jobs", { keyPath: "id" });
      db.createObjectStore("meta");
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("vault", "readwrite");
      tx.objectStore("vault").put({
        record: { id: "old-1", createdAt: "2026-01-01T00:00:00.000Z" },
        originalB64: b64FromBytes(new Uint8Array([1, 2, 3]).buffer),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("vault v1 to v2 migration", () => {
  it("moves base64 photos into the blobs store and keeps the record", async () => {
    await seedV1();
    const items = await listVault();
    expect(items).toHaveLength(1);
    expect(items[0]!.record.id).toBe("old-1");
    expect("originalB64" in items[0]!).toBe(false);
    expect([...new Uint8Array((await getVaultBytes("old-1"))!)]).toEqual([1, 2, 3]);
  });
});
