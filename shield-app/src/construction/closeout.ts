import { devicePublicKeyRaw, deviceSealId, sha256Text, signPayload, stableStringify, verifySignature } from "../crypto/seal";
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

export function missingPoints(job: Job, recordFor: CloseoutInput["recordFor"]): CloseoutPoint[] {
  return pointsFor(job, recordFor).filter((p) => !p.record);
}

export async function buildCloseoutPacket(input: CloseoutInput): Promise<CloseoutPacket> {
  const { job } = input;
  const points = pointsFor(job, input.recordFor);
  const sealed = points.filter((p) => p.record).length;
  const body: CloseoutBody = {
    schema: "tradedeck.shield.completion.v2",
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
    counts: { points: points.length, sealed, missing: points.length - sealed },
    notes: input.notes,
    deviceSealId: await deviceSealId(),
    devicePublicKey: await devicePublicKeyRaw(),
  };
  const hash = await sha256Text(stableStringify(body));
  const signature = await signPayload(body);
  return { ...body, integrity: { algo: "SHA-256", canonical: "stableStringify", hash, signature } };
}

export type PacketVerdict = "PACKET-SEALED" | "PACKET-TAMPERED" | "PACKET-UNREADABLE";

export async function verifyCloseoutPacket(packet: CloseoutPacket): Promise<{ verdict: PacketVerdict; reasons: string[] }> {
  const { integrity, ...body } = packet;
  if (!integrity?.hash || !integrity.signature || !body.devicePublicKey) {
    return { verdict: "PACKET-UNREADABLE", reasons: ["missing-integrity"] };
  }
  const reasons: string[] = [];
  const hash = await sha256Text(stableStringify(body));
  if (hash !== integrity.hash) reasons.push("hash-mismatch");
  let sigOk = false;
  try {
    sigOk = await verifySignature(body.devicePublicKey, body, integrity.signature);
  } catch {
    sigOk = false;
  }
  if (!sigOk) reasons.push("signature-invalid");
  if (reasons.length) return { verdict: "PACKET-TAMPERED", reasons };
  return { verdict: "PACKET-SEALED", reasons: ["hash-match", "signature-valid", `${body.counts.sealed}/${body.counts.points} sealed`] };
}

export function parseCloseoutPacket(text: string): CloseoutPacket {
  const raw = JSON.parse(text) as CloseoutPacket;
  if (raw.schema !== "tradedeck.shield.completion.v2" || !raw.integrity || !Array.isArray(raw.points)) {
    throw new Error("bad-packet");
  }
  return raw;
}

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
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
attest ${esc(r.attest.kind)}${r.attest.tokenPresent ? " · token" : ""}
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
<p class="meta">This file is a snapshot. The hash covers every field above except the integrity block; the signature is over the same bytes with the device key whose public half is embedded in the JSON.</p>
</body></html>`;
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadPacketFiles(packet: CloseoutPacket, html: boolean): string {
  const base = `shield-record_${packet.job.id.slice(0, 8)}_${packet.closedAt.replace(/[:.]/g, "-")}`;
  download(`${base}.shield-record.json`, new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
  if (html) download(`${base}.html`, new Blob([packetToHtml(packet)], { type: "text/html" }));
  return base;
}

interface SupabaseLike {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> };
}

/** Optional. Only runs when a signed-in Supabase client is present; the packet never depends on it. */
export async function submitCloseout(packet: CloseoutPacket, apiBase: string): Promise<{ ok: boolean; error: string | null }> {
  const sb = (globalThis as unknown as { sb?: SupabaseLike }).sb;
  if (!sb?.auth) return { ok: false, error: "not-signed-in" };
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) return { ok: false, error: "not-signed-in" };
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/shield/complete-job`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ packet, notify_admin: true }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}` };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network" };
  }
}
