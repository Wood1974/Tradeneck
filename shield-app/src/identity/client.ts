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
  /** Creates a TradeDeck account. `signedIn` is false when the account must first be confirmed from an email link. */
  signUp(email: string, password: string): Promise<{ signedIn: boolean }>;
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
    const body = (await res.json().catch(() => ({}))) as { error?: string; error_code?: string } & T;
    // tradedeck-api answers { error }; Supabase auth answers { error_code }.
    if (!res.ok) throw new IdentityError(body.error ?? body.error_code ?? `http-${res.status}`);
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

// Supabase auth error codes, mapped to the codes the sign-on screen has text for.
const SIGNUP_ERRORS: Record<string, string> = {
  weak_password: "weak-password",
  user_already_exists: "account-exists",
  email_exists: "account-exists",
  email_address_invalid: "bad-email",
  validation_failed: "bad-email",
  over_email_send_rate_limit: "rate-limited",
  over_request_rate_limit: "rate-limited",
  signup_disabled: "signup-disabled",
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
  async signUp(email, password) {
    const r = await call<{ access_token?: string }>(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    }).catch((err: unknown) => {
      throw new IdentityError(SIGNUP_ERRORS[(err as IdentityError).code] ?? (err as IdentityError).code);
    });
    // With email confirmation on, no session comes back, and an address that already has an account looks
    // the same as a new one. The screen must not say which it was.
    if (!r.access_token) return { signedIn: false };
    token = r.access_token;
    return { signedIn: true };
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
