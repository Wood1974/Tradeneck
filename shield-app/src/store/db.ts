import { bytesFromB64 } from "../crypto/seal";
import type { Job, VaultItem } from "../types";

const DB = "shield-vault";
const VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

// One shared connection: opening per call is slow and leaks handles.
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("vault")) db.createObjectStore("vault", { keyPath: "record.id" });
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      // v1 stored photos as base64 inside the vault record; move the bytes to the blobs store.
      if (ev.oldVersion === 1) {
        const tx = req.transaction!;
        const vault = tx.objectStore("vault");
        const blobs = tx.objectStore("blobs");
        vault.openCursor().onsuccess = (e) => {
          const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cur) return;
          const old = cur.value as { record: VaultItem["record"]; originalB64?: string };
          if (old.originalB64) {
            blobs.put(bytesFromB64(old.originalB64), old.record.id);
            cur.update({ record: old.record });
          }
          cur.continue();
        };
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function reqToPromise<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listVault(): Promise<VaultItem[]> {
  const db = await open();
  const items = await reqToPromise(db.transaction("vault").objectStore("vault").getAll() as IDBRequest<VaultItem[]>);
  return items.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
}

export async function getVaultBytes(id: string): Promise<ArrayBuffer | undefined> {
  const db = await open();
  return reqToPromise(db.transaction("blobs").objectStore("blobs").get(id) as IDBRequest<ArrayBuffer | undefined>);
}

export async function listJobs(): Promise<Job[]> {
  const db = await open();
  const items = await reqToPromise(db.transaction("jobs").objectStore("jobs").getAll() as IDBRequest<Job[]>);
  return items.sort((a, b) => b.lockedAt.localeCompare(a.lockedAt));
}

export async function getJob(id: string): Promise<Job | undefined> {
  const db = await open();
  return reqToPromise(db.transaction("jobs").objectStore("jobs").get(id));
}

export async function putJob(job: Job): Promise<void> {
  const db = await open();
  await reqToPromise(db.transaction("jobs", "readwrite").objectStore("jobs").put(job));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return reqToPromise(db.transaction("meta").objectStore("meta").get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  await reqToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(value, key));
}

/** Vault item, chain head and checkpoint binding commit together or not at all. */
export async function commitSeal(item: VaultItem, bytes: ArrayBuffer, head: string, job: Job | null): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["vault", "blobs", "meta", "jobs"], "readwrite");
    tx.objectStore("vault").put(item);
    tx.objectStore("blobs").put(bytes, item.record.id);
    tx.objectStore("meta").put(head, "chainHead");
    if (job) tx.objectStore("jobs").put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function chainHead(): Promise<string> {
  return (await getMeta<string>("chainHead")) ?? "0".repeat(64);
}

export async function setChainHead(head: string): Promise<void> {
  await setMeta("chainHead", head);
}

export async function activeJobId(): Promise<string | null> {
  return (await getMeta<string>("activeJobId")) ?? null;
}

export async function setActiveJobId(id: string | null): Promise<void> {
  await setMeta("activeJobId", id);
}

export function getCloseout(jobId: string): Promise<unknown | undefined> {
  return getMeta(`closeout:${jobId}`);
}

export async function putCloseout(jobId: string, packet: unknown): Promise<void> {
  await setMeta(`closeout:${jobId}`, packet);
}
