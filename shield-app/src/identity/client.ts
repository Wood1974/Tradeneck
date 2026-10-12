import type { SignedNote } from "./note";
import { CONSENT_VERSION } from "./note";
import type { Receipt } from "./receipt";

// Public values: the Supabase anon key is meant to be client-visible and is protected by RLS.
// The Stripe secret key and the service role key live only in tradedeck-api's environment.
export const API_BASE = "https://tradedeck-api.onrender.com";
const SUPABASE_URL = "https://jlaajejpqjldpbinktln.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsYWFqZWpwcWpsZHBiaW5rdGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDg3MTksImV4cCI6MjEwMTc4NDcxOX0.tP-seLGoJnivrYmNhhTDmDJw4Uk92D95-zrwWB1G_S4";

export type IdStatus = "none" | "requires_input" | "processing" | "verified" | "canceled";

export class IdentityError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface IdentityApi {
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
    const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) throw new IdentityError(body.error ?? `http-${res.status}`);
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

const real: IdentityApi = {
  signedIn: () => token !== null,
  async signIn(email, password) {
    const r = await call<{ access_token?: string }>(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    }).catch((err: unknown) => {
      throw new IdentityError(err instanceof IdentityError && err.code === "network" ? "network" : "bad-credentials");
    });
    if (!r.access_token) throw new IdentityError("bad-credentials");
    token = r.access_token;
  },
  start: () => call(`${API_BASE}/identity/start`, authed({ method: "POST", body: JSON.stringify({ consent: true, consentVersion: CONSENT_VERSION }) })),
  status: () => call(`${API_BASE}/identity/status`, authed()),
  submitNote: (note) => call(`${API_BASE}/identity/note`, authed({ method: "POST", body: JSON.stringify(note) })),
};

/** Production uses the real service. Test builds (`--mode e2e`) swap in a stand-in; production bundles never contain it. */
export function identityApi(): IdentityApi {
  if (import.meta.env.MODE === "e2e") {
    const hook = (globalThis as { __shieldE2EIdentity?: IdentityApi }).__shieldE2EIdentity;
    if (hook) return hook;
  }
  return real;
}
