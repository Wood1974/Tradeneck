import type { SignedNote } from "./note";
import { CONSENT_VERSION } from "./note";
import type { Receipt } from "./receipt";

// Public value: the address of the standalone Shield server. Shield has its own accounts there; it does not use
// TradeDeck's. The Stripe keys and the receipt signing key live only in that server's environment.
export const API_BASE = "https://tradedeck-shield.onrender.com";

export type IdStatus = "none" | "requires_input" | "processing" | "verified" | "canceled";

export class IdentityError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** One sealed photo as the phone stores it, plus the original JPEG, for POST /shield/captures. */
export interface CaptureUpload {
  record: Record<string, unknown>;
  signature_der_b64: string;
  public_key_uncompressed_b64: string;
  photo_b64: string;
  app_attest_key_id?: string | null;
  app_attest_assertion_b64?: string | null;
}

/** The server's consistency check of the phone's own clocks. Absent from servers that predate it. */
export interface TimeResult {
  label: "CONSISTENT" | "UNVERIFIED TIME" | "DEVICE CLOCK MISMATCH" | "NOT CHECKED" | string;
  notes: string[];
}

/** Whether a server-signed ticket anchors the start of this photo's chain. Absent from servers that predate it. */
export interface TicketResult {
  origin: "server" | "local";
  after?: string;
  before?: string;
}

/** The daily outside time-stamp covering this photo. Absent from servers that predate it. */
export interface OutsideTimeResult {
  status: "stamped" | "waiting" | "off";
  gen_time?: string;
  tsa?: string;
  chain_checked?: boolean;
}

export interface StoredCapture {
  record_hash: string;
  /** SHA-256 of the stored photo; the phone matches it to the vault record's `sha256`. */
  photo_sha256?: string;
  attest: { status: string; trusted: boolean };
  time?: TimeResult;
  ticket?: TicketResult;
  outside_time?: OutsideTimeResult;
}

/** A share code the server just made. The code is shown once; the server keeps only a hash of it. */
export interface ShareMade {
  id: string;
  code: string;
  expires_at: string;
}

/** One share code's state, without the code itself. */
export interface ShareInfo {
  id: string;
  created_at: string | null;
  expires_at: string | null;
  revoked: boolean;
  active: boolean;
  /** True when the code also shows timing evidence (made after the server added it). Absent from an older server. */
  timing?: boolean;
}

/** One phone key (Apple App Attest) this account has enrolled. `id` is Apple's key id: a hash of the public key, not a device name. */
export interface PhoneKey {
  id: string;
  environment: string;
  enrolled_at: string | null;
  /** How many of this account's stored photos this key signed for. */
  photos: number;
  revoked_at: string | null;
}

/** A ticket the server signed for this account and ticket id (the job id, or "device"). */
export interface IssuedTicket {
  ticket: Record<string, unknown>;
  ticket_hash: string;
  server_signature_der_b64: string;
}

export interface TicketCountersign {
  ticket: Record<string, unknown>;
  server_signature_der_b64: string;
  ticket_clock: Record<string, unknown>;
  signature_der_b64: string;
  public_key_uncompressed_b64: string;
}

export interface IdentityApi {
  /** Signs in with an existing account. */
  signIn(email: string, password: string): Promise<void>;
  signedIn(): boolean;
  start(): Promise<{ sessionId: string; status: IdStatus; url: string | null }>;
  status(): Promise<{ sessionId: string | null; status: IdStatus; verified: boolean }>;
  submitNote(note: SignedNote): Promise<{ attestationId: string; noteSha256: string; receipt: Receipt }>;
  /** Makes an account with a single-use invite code from whoever runs Shield. Does not sign in. */
  signUp(email: string, password: string, inviteCode: string): Promise<void>;
  /** Emails a one-time code to the account's address. The server answers the same whether or not the email has an account. */
  requestReset(email: string): Promise<void>;
  /** Spends the emailed code and sets a new password. Signs the account out everywhere. */
  confirmReset(email: string, code: string, newPassword: string): Promise<void>;
  /** Stores one sealed photo on the Shield server for this account. The server checks it first and refuses what fails. */
  uploadCapture(body: CaptureUpload): Promise<StoredCapture & { already: boolean }>;
  /** The photos this account already has on the server. */
  listCaptures(): Promise<StoredCapture[]>;
  /** Makes a share code for one uploaded photo (by the server's record hash). Anyone holding the code and the original file can ask the server whether the file matches. */
  createShare(recordHash: string, days: number): Promise<ShareMade>;
  /** The codes made for one photo and whether each still works. The codes themselves are never listed. */
  listShares(recordHash: string): Promise<ShareInfo[]>;
  /** Withdraws a code so it stops working. */
  revokeShare(shareId: string): Promise<void>;
  /** The phones (App Attest keys) this account has enrolled. Only this account's own. */
  listPhones(): Promise<PhoneKey[]>;
  /** Withdraws a phone's key: its later photos stop showing as Apple-checked, and the key cannot be enrolled again. */
  revokePhone(id: string): Promise<void>;
  /** Asks the server to sign a start-of-job ticket. Closed (503, or 404 on an older server) until the server has a ticket key. */
  issueTicket(ticketId: string): Promise<IssuedTicket>;
  /** Hands the server the phone's countersignature over the ticket and the phone's clocks. */
  countersignTicket(body: TicketCountersign): Promise<{ ticket_hash: string; started: boolean; already: boolean }>;
  /** A one-time challenge to bind an Apple App Attest proof to. */
  attestChallenge(): Promise<{ nonce: string }>;
  /** Hands the server Apple's proof for a key. The server checks it against Apple's root and answers `trusted: true`. */
  attestRegister(proof: { keyId: string; nonce: string; attestation: string }): Promise<{ trusted: boolean; environment?: string }>;
}

// The access token is kept in memory only. Closing the app signs out; nothing secret is written to disk.
let token: string | null = null;

async function call<T>(url: string, init: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: unknown } & T;
    // The identity routes answer { error }; the framework's own errors (sign-in, auth, rate limit) answer { detail }.
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    if (!res.ok) throw new IdentityError(body.error ?? detail ?? `http-${res.status}`);
    return body;
  } catch (err) {
    if (err instanceof IdentityError) throw err;
    throw new IdentityError("network");
  } finally {
    clearTimeout(timer);
  }
}

const authed = (extra: RequestInit = {}): RequestInit => {
  if (!token) throw new IdentityError("not-signed-in");
  return { ...extra, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
};

// Codes the server uses when the token is missing, wrong, expired or revoked.
const SESSION_ENDED = new Set(["authorization_required", "invalid_access_token"]);

// The App Attest routes take form fields, not JSON.
const authedForm = (fields: Record<string, string>): RequestInit => {
  if (!token) throw new IdentityError("not-signed-in");
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: new URLSearchParams(fields).toString(),
  };
};

/** Runs an authenticated call. If the server says the sign-in has ended, drop the token so sign-on starts again. */
async function withSession<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof IdentityError && SESSION_ENDED.has(err.code)) {
      token = null;
      throw new IdentityError("session-expired");
    }
    throw err;
  }
}

const authedCall = <T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> => withSession(() => call<T>(`${API_BASE}${path}`, authed(init), timeoutMs));
const authedFormCall = <T>(path: string, fields: Record<string, string>): Promise<T> => withSession(() => call<T>(`${API_BASE}${path}`, authedForm(fields)));

const real: IdentityApi = {
  signedIn: () => token !== null,
  async signIn(email, password) {
    const r = await call<{ access_token?: string }>(`${API_BASE}/shield/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch((err: unknown) => {
      const code = err instanceof IdentityError ? err.code : "network";
      if (code === "network" || code === "rate_limit_exceeded") throw new IdentityError(code === "network" ? "network" : "rate-limited");
      throw new IdentityError("bad-credentials");
    });
    if (!r.access_token) throw new IdentityError("bad-credentials");
    token = r.access_token;
  },
  start: () => authedCall("/identity/start", { method: "POST", body: JSON.stringify({ consent: true, consentVersion: CONSENT_VERSION }) }),
  status: () => authedCall("/identity/status"),
  submitNote: (note) => authedCall("/identity/note", { method: "POST", body: JSON.stringify(note) }),
  async signUp(email, password, inviteCode) {
    await call(`${API_BASE}/shield/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, invite_code: inviteCode }),
    });
  },
  async requestReset(email) {
    await call(`${API_BASE}/shield/auth/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  },
  async confirmReset(email, code, newPassword) {
    await call(`${API_BASE}/shield/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, new_password: newPassword }),
    });
  },
  uploadCapture: (body) => authedCall("/shield/captures", { method: "POST", body: JSON.stringify(body) }, 90000),
  async listCaptures() {
    return (await authedCall<{ captures: StoredCapture[] }>("/shield/captures")).captures;
  },
  createShare: (recordHash, days) => authedCall(`/shield/captures/${encodeURIComponent(recordHash)}/share`, { method: "POST", body: JSON.stringify({ days }) }),
  async listShares(recordHash) {
    return (await authedCall<{ shares: ShareInfo[] }>(`/shield/captures/${encodeURIComponent(recordHash)}/shares`)).shares;
  },
  async revokeShare(shareId) {
    // POST, not DELETE: the phone's web view may only send GET and POST across origins.
    await authedCall(`/shield/shares/${encodeURIComponent(shareId)}/revoke`, { method: "POST", body: "{}" });
  },
  async listPhones() {
    return (await authedCall<{ devices: PhoneKey[] }>("/shield/devices")).devices;
  },
  async revokePhone(id) {
    await authedCall("/shield/devices/revoke", { method: "POST", body: JSON.stringify({ id }) });
  },
  issueTicket: (ticketId) => authedCall("/shield/tickets", { method: "POST", body: JSON.stringify({ ticket_id: ticketId }) }),
  countersignTicket: (body) => authedCall("/shield/tickets/countersign", { method: "POST", body: JSON.stringify(body) }),
  attestChallenge: () => authedFormCall("/shield/attest/challenge", {}),
  attestRegister: (p) => authedFormCall("/shield/attest", { key_id: p.keyId, nonce: p.nonce, attestation: p.attestation }),
};

/** Production uses the real service. Test builds (`--mode e2e`) swap in a stand-in; production bundles never contain it. */
export function identityApi(): IdentityApi {
  if (import.meta.env.MODE === "e2e") {
    const hook = (globalThis as { __shieldE2EIdentity?: IdentityApi }).__shieldE2EIdentity;
    if (hook) return hook;
  }
  return real;
}
