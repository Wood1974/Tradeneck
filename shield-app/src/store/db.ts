import type { Job, VaultItem } from "../types";

const DB = "shield-vault";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("vault")) db.createObjectStore("vault", { keyPath: "record.id" });
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

export async function getVault(id: string): Promise<VaultItem | undefined> {
  const db = await open();
  return reqToPromise(db.transaction("vault").objectStore("vault").get(id));
}

export async function putVault(item: VaultItem): Promise<void> {
  const db = await open();
  await reqToPromise(db.transaction("vault", "readwrite").objectStore("vault").put(item));
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
export async function commitSeal(item: VaultItem, head: string, job: Job | null): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["vault", "meta", "jobs"], "readwrite");
    tx.objectStore("vault").put(item);
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
