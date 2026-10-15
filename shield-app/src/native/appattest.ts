/**
 * Apple App Attest enrollment for the iPhone app.
 *
 * Enrolling needs signal and a signed-in account: the server hands out a one-time challenge, Apple vouches for a new
 * key bound to it, and the server checks Apple's proof. Only when the server accepts does the phone start recording an
 * assertion with each photo. Recording is offline and needs no account.
 *
 * Enrolled does not mean a photo is attested. Nothing checks those assertions yet, so records keep `attest: none`
 * and the app says what is true: the phone is enrolled, and its photos carry a proof nobody has checked.
 */
import { identityApi, IdentityError } from "../identity/client";
import { detectPlatform, isNativeOriginAvailable } from "../platform";

export type AppAttestState =
  | { state: "not-ios" }
  | { state: "unsupported" }
  | { state: "not-enrolled" }
  | { state: "enrolled"; keyId: string };

async function plugin() {
  const { SecureCapture } = await import("@tradedeck/secure-capture");
  return SecureCapture;
}

const onIphone = (): boolean => import.meta.env.MODE !== "e2e" && isNativeOriginAvailable() && detectPlatform() === "ios";

export async function appAttestState(): Promise<AppAttestState> {
  if (!onIphone()) return { state: "not-ios" };
  try {
    const s = await (await plugin()).appAttestStatus();
    if (!s.supported) return { state: "unsupported" };
    return s.enrolled && s.key_id ? { state: "enrolled", keyId: s.key_id } : { state: "not-enrolled" };
  } catch {
    // A build without these plugin methods: treat as not enrolled, and let enrolling report the real problem.
    return { state: "not-enrolled" };
  }
}

export type EnrollResult = { ok: true; keyId: string } | { ok: false; reason: string };

export function reasonOf(err: unknown): string {
  if (err instanceof IdentityError) return err.code;
  return String((err as { message?: string })?.message ?? err).slice(0, 200);
}

/** Needs a signed-in account (the token is kept in memory, so after a restart this asks for a sign-in first). */
export async function enrollDevice(): Promise<EnrollResult> {
  if (!onIphone()) return { ok: false, reason: "not-ios" };
  const api = identityApi();
  if (!api.signedIn()) return { ok: false, reason: "not-signed-in" };
  try {
    const { nonce } = await api.attestChallenge();
    const sc = await plugin();
    const proof = await sc.appAttestEnroll({ nonce });
    const accepted = await api.attestRegister({ keyId: proof.key_id, nonce, attestation: proof.attestation_b64 });
    if (!accepted.trusted) return { ok: false, reason: "server-rejected" };
    // Only now does the phone use this key. A rejected proof leaves nothing behind to retry against.
    await sc.appAttestConfirm({ keyId: proof.key_id });
    return { ok: true, keyId: proof.key_id };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

const FIXED: Record<string, string> = {
  "not-signed-in": "Sign in first.",
  "session-expired": "Your sign-in ended. Sign in again.",
  "bad-credentials": "That email or password was not accepted.",
  "rate-limited": "Too many tries. Wait a minute and try again.",
  network: "Could not reach the Shield server. Check your connection and try again.",
  "server-rejected": "The Shield server did not accept Apple's proof.",
  app_id_hash_mismatch: "The server's app ID does not match this app, so it refused Apple's proof (app_id_hash_mismatch).",
};

/** Plain words for the screen; the raw code stays visible so a failure can be reported exactly. */
export function enrollErrorText(reason: string): string {
  if (FIXED[reason]) return FIXED[reason];
  if (reason.startsWith("attest-failed:")) return `Apple's device check failed. Reason: ${reason.slice("attest-failed:".length).trim()}`;
  return `The device check could not be set up. Reason: ${reason}`;
}
