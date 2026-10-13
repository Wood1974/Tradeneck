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

/** Calls an authenticated route. If the server says the sign-in has ended, drop the token so sign-on starts again. */
async function authedCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await call<T>(`${API_BASE}${path}`, authed(init));
  } catch (err) {
    if (err instanceof IdentityError && SESSION_ENDED.has(err.code)) {
      token = null;
      throw new IdentityError("session-expired");
    }
    throw err;
  }
}

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
};

/** Production uses the real service. Test builds (`--mode e2e`) swap in a stand-in; production bundles never contain it. */
export function identityApi(): IdentityApi {
  if (import.meta.env.MODE === "e2e") {
    const hook = (globalThis as { __shieldE2EIdentity?: IdentityApi }).__shieldE2EIdentity;
    if (hook) return hook;
  }
  return real;
}
