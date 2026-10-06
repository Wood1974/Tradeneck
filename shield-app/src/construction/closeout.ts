import { esc } from "../esc";
import { isNativeOriginAvailable } from "../platform";
import { checkRecordAuth } from "../crypto/record";
import { devicePublicKeyRaw, deviceSealId, sealIdForPublicKey, sha256Text, signPayload, stableStringify, verifySignature } from "../crypto/seal";
import type { CloseoutBody, CloseoutPacket, CloseoutPoint, Job, SealRecord } from "../types";

export interface CloseoutInput {
  job: Job;
  role: string;
  notes: string;
  /** Resolve a checkpoint's sealed record from the vault. */
  recordFor: (shotId: string) => SealRecord | undefined;
}

function pointsFor(job: Job, recordFor: CloseoutInput["recordFor"]): CloseoutPoint[] {
  return job.checkpoints.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description ?? "",
    code: c.code ?? null,
    record: c.shotId ? (recordFor(c.shotId) ?? null) : null,
  }));
}

function countsFor(points: CloseoutPoint[]): CloseoutBody["counts"] {
  const sealed = points.filter((p) => p.record).length;
  return { points: points.length, sealed, missing: points.length - sealed };
}

export function missingPoints(job: Job, recordFor: CloseoutInput["recordFor"]): CloseoutPoint[] {
  return pointsFor(job, recordFor).filter((p) => !p.record);
}

export async function buildCloseoutPacket(input: CloseoutInput): Promise<CloseoutPacket> {
  const { job } = input;
  const points = pointsFor(job, input.recordFor);
  const body: CloseoutBody = {
    canonicalVersion: 1,
    schema: PACKET_SCHEMA,
    closedAt: new Date().toISOString(),
    closedBy: { role: input.role },
    job: {
      id: job.id,
      title: job.brief?.title ?? "",
      trade: job.brief?.trade ?? job.pack,
      budgetBand: job.brief?.budgetBand || null,
      feeUsd: job.feeUsd,
      pin: job.pin,
    },
    brief: job.brief
      ? { role: job.brief.role, lockedText: job.brief.lockedText, answers: job.brief.answers }
      : null,
    points,
    counts: countsFor(points),
    notes: input.notes,
    deviceSealId: await deviceSealId(),
    devicePublicKey: await devicePublicKeyRaw(),
  };
  const hash = await sha256Text(stableStringify(body));
  const signature = await signPayload(body);
  return { ...body, integrity: { algo: "SHA-256", canonical: "stableStringify", hash, signature } };
}

export type PacketVerdict = "PACKET-SEALED" | "PACKET-TAMPERED" | "PACKET-UNREADABLE";

export interface PacketVerification {
  verdict: PacketVerdict;
  reasons: string[];
  /** Seal ID derived from the packet's own public key. Compare it with an ID you trust. */
  signer: string | null;
}

const PACKET_SCHEMA: CloseoutBody["schema"] = "tradedeck.shield.completion.v3";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Checks the packet is internally consistent and signed by the key it carries. It cannot prove WHO holds
 * that key: pass `expectedSigner` (a seal ID obtained out of band) to pin it.
 */
export async function verifyCloseoutPacket(packet: CloseoutPacket, expectedSigner?: string): Promise<PacketVerification> {
  const { integrity, ...body } = packet;
  if (!integrity?.hash || !integrity.signature || !body.devicePublicKey || !Array.isArray(body.points)) {
    return { verdict: "PACKET-UNREADABLE", reasons: ["missing-integrity"], signer: null };
  }
  const reasons: string[] = [];
  let signer: string;
  try {
    signer = await sealIdForPublicKey(body.devicePublicKey);
  } catch {
    return { verdict: "PACKET-UNREADABLE", reasons: ["bad-public-key"], signer: null };
  }
  try {
    if ((await sha256Text(stableStringify(body))) !== integrity.hash) reasons.push("hash-mismatch");
    if (!(await verifySignature(body.devicePublicKey, body, integrity.signature))) reasons.push("signature-invalid");
  } catch {
    reasons.push("hash-mismatch", "signature-invalid");
  }
  if (body.deviceSealId !== signer) reasons.push("seal-id-key-mismatch");
  if (expectedSigner && expectedSigner.toUpperCase() !== signer) reasons.push("signer-not-expected");

  const records: SealRecord[] = [];
  for (const p of body.points) {
    const r = p.record;
    if (!r) continue;
    records.push(r);
    for (const f of await checkRecordAuth(r, body.devicePublicKey)) reasons.push(`${p.id}:${f}`);
    if ((r.captureKind as string) !== "native-camera") reasons.push(`${p.id}:unsupported-capture-kind`);
    if (r.jobId !== body.job.id) reasons.push(`${p.id}:record-wrong-job`);
    if (r.checkpointId !== p.id) reasons.push(`${p.id}:record-wrong-checkpoint`);
  }

  if (new Set(records.map((r) => r.id)).size !== records.length) reasons.push("duplicate-record");
  if (new Set(records.map((r) => r.prevChain)).size !== records.length) reasons.push("chain-fork");
  const byHead = new Map(records.map((r) => [r.chainHead, r]));
  for (const r of records) {
    const prev = byHead.get(r.prevChain);
    if (prev && prev.createdAt > r.createdAt) reasons.push(`${r.id}:chain-time-order`);
  }

  const times = [body.closedAt, ...records.map((r) => r.createdAt)].map((t) => Date.parse(t));
  if (times.some(Number.isNaN)) reasons.push("bad-timestamp");
  else {
    if (Date.parse(body.closedAt) < Math.max(...times.slice(1), 0)) reasons.push("closed-before-capture");
    if (Math.max(...times) > Date.now() + CLOCK_SKEW_MS) reasons.push("future-timestamp");
  }

  if (JSON.stringify(body.counts) !== JSON.stringify(countsFor(body.points))) reasons.push("counts-mismatch");

  if (reasons.length) return { verdict: "PACKET-TAMPERED", reasons, signer };
  return {
    verdict: "PACKET-SEALED",
    reasons: [
      "hash-match",
      "signature-valid",
      `${records.length} record signature(s) valid`,
      expectedSigner ? "signer-pinned" : "signer-not-independently-verified",
    ],
    signer,
  };
}

export const MAX_PACKET_BYTES = 10 * 1024 * 1024;

export function parseCloseoutPacket(text: string): CloseoutPacket {
  if (text.length > MAX_PACKET_BYTES) throw new Error("file-too-large");
  const raw = JSON.parse(text) as CloseoutPacket;
  if (
    raw?.schema !== PACKET_SCHEMA ||
    !raw.integrity ||
    !Array.isArray(raw.points) ||
    typeof raw.closedAt !== "string" ||
    typeof raw.closedBy?.role !== "string" ||
    typeof raw.job?.id !== "string" ||
    typeof raw.deviceSealId !== "string" ||
    typeof raw.devicePublicKey !== "string" ||
    typeof raw.notes !== "string" ||
    !raw.counts
  ) {
    throw new Error("bad-packet");
  }
  return raw;
}

export function packetToHtml(packet: CloseoutPacket): string {
  const pts = packet.points
    .map((p) => {
      const r = p.record;
      const code = p.code ? `${p.code.irc ? "IRC " + esc(p.code.irc) : ""}${p.code.ibc ? " IBC " + esc(p.code.ibc) : ""} — ${esc(p.code.name)}` : "no code reference";
      const rec = r
        ? `<pre>sha256 ${esc(r.sha256)}
chain  ${esc(r.chainHead)}
device ${esc(r.deviceSealId)} · ${esc(r.captureKind)} · ${esc(r.platform)}
attest ${esc(r.attest.kind)}${r.attest.kind === "none" ? "" : " · token not validated"}
at     ${esc(r.createdAt)}</pre>`
        : `<p class="miss">No sealed photo on file</p>`;
      return `<section class="pt"><h3>${esc(p.id)} — ${esc(p.label)}</h3><p class="code">${code}</p><p>${esc(p.description)}</p>${rec}</section>`;
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Shield record ${esc(packet.job.id)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:800px;margin:24px auto;color:#1a1a1a;padding:0 16px;}
  h1{font-size:1.2rem;} .meta,.code{color:#555;font-size:.85rem;}
  pre{white-space:pre-wrap;word-break:break-all;background:#f6f3eb;padding:12px;border-radius:8px;font-size:.75rem;}
  .pt{border:1px solid #e6e2d6;border-radius:10px;padding:12px;margin:12px 0;}
  .hash{font-family:ui-monospace,monospace;font-size:.75rem;word-break:break-all;}
  .miss{color:#c0392b;font-style:italic;}
</style></head><body>
<h1>TradeDeck Shield — completion record</h1>
<p class="meta">Schema ${esc(packet.schema)}<br/>Closed ${esc(packet.closedAt)} by ${esc(packet.closedBy.role)}<br/>
Job ${esc(packet.job.id)} · ${esc(packet.job.title)} · ${esc(packet.job.trade)}<br/>
Device seal ${esc(packet.deviceSealId)}</p>
<p class="hash">SHA-256 ${esc(packet.integrity.hash)}<br/>Signature ${esc(packet.integrity.signature)}</p>
<h2>Locked brief</h2><pre>${esc(packet.brief?.lockedText ?? "")}</pre>
<h2>Checkpoints</h2>${pts}
<h2>Counts</h2><pre>${esc(JSON.stringify(packet.counts, null, 2))}</pre>
${packet.notes ? `<h2>Close notes</h2><pre>${esc(packet.notes)}</pre>` : ""}
<p class="meta">Human-readable snapshot only. It cannot be verified: it omits per-photo signatures, location and attestation fields. Verify the matching .shield-record.json in Shield. A valid signature shows the record is unchanged since signing; it does not show who holds the key (compare device seal ${esc(packet.deviceSealId)} with one you trust).</p>
</body></html>`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// WebViews in the iOS/Android shells do not save `<a download>` files, so native hands the file to the share sheet.
async function shareNative(filename: string, blob: Blob): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const { uri } = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
  await Share.share({ title: filename, url: uri });
}

export async function download(filename: string, blob: Blob): Promise<void> {
  if (isNativeOriginAvailable()) {
    try {
      await shareNative(filename, blob);
      return;
    } catch {
      // Plugin missing from this build or share cancelled: fall through to the browser path.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadPacketFiles(packet: CloseoutPacket, html: boolean): Promise<string> {
  const base = `shield-record_${packet.job.id.slice(0, 8)}_${packet.closedAt.replace(/[:.]/g, "-")}`;
  await download(`${base}.shield-record.json`, new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
  if (html) await download(`${base}.html`, new Blob([packetToHtml(packet)], { type: "text/html" }));
  return base;
}
