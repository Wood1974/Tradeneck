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

export interface IdentityApi {
  /** Signs in with an account the Shield administrator created. There is no self sign-up. */
  signIn(email: string, password: string): Promise<void>;
  signedIn(): boolean;
  start(): Promise<{ sessionId: string; status: IdStatus; url: string | null }>;
  status(): Promise<{ sessionId: string | null; status: IdStatus; verified: boolean }>;
  submitNote(note: SignedNote): Promise<{ attestationId: string; noteSha256: string; receipt: Receipt }>;
  /** Emails a one-time code to the account's address. The server answers the same whether or not the email has an account. */
  requestReset(email: string): Promise<void>;
  /** Spends the emailed code and sets a new password. Signs the account out everywhere. */
  confirmReset(email: string, code: string, newPassword: string): Promise<void>;
  /** A one-time challenge to bind an Apple App Attest proof to. */
  attestChallenge(): Promise<{ nonce: string }>;
  /** Hands the server Apple's proof for a key. The server checks it against Apple's root and answers `trusted: true`. */
  attestRegister(proof: { keyId: string; nonce: string; attestation: string }): Promise<{ trusted: boolean; environment?: string }>;
}

// The access token is kept in memory only. Closing the app signs out; nothing secret is written to disk.
let token: string | null = null;

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
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

const authedCall = <T>(path: string, init: RequestInit = {}): Promise<T> => withSession(() => call<T>(`${API_BASE}${path}`, authed(init)));
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
