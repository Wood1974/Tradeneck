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

/**
 * Capacitor's plugin object answers every property, `then` included, so it looks like a promise that never settles.
 * Handing it out of an async function (or awaiting it) therefore waits forever. Wrap it in a plain object instead,
 * and take the plugin out of that object where it is used.
 */
async function plugin() {
  const { SecureCapture } = await import("@tradedeck/secure-capture");
  return { sc: SecureCapture };
}

const onIphone = (): boolean => import.meta.env.MODE !== "e2e" && isNativeOriginAvailable() && detectPlatform() === "ios";

/** Gives up on a native call that never answers, so an optional feature can never hold the app up. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

export async function appAttestState(): Promise<AppAttestState> {
  if (!onIphone()) return { state: "not-ios" };
  try {
    const s = await withTimeout(plugin().then(({ sc }) => sc.appAttestStatus()), 4000);
    if (!s.supported) return { state: "unsupported" };
    return s.enrolled && s.key_id ? { state: "enrolled", keyId: s.key_id } : { state: "not-enrolled" };
  } catch {
    // A build without these plugin methods: treat as not enrolled, and let enrolling report the real problem.
    return { state: "not-enrolled" };
  }
}

export type EnrollResult = { ok: true; keyId: string } | { ok: false; reason: string };

/** The parts of enrolling, in order, so the screen can say which one it is waiting on. */
export type EnrollStep = "challenge" | "apple" | "proof" | "saving";

const STEP_TEXT: Record<EnrollStep, string> = {
  challenge: "Asking the Shield server for a challenge",
  apple: "Asking Apple to vouch for this phone (can take up to 30 seconds)",
  proof: "Sending Apple's proof to the Shield server",
  saving: "Saving the key on this phone",
};
export const enrollStepText = (step: EnrollStep): string => STEP_TEXT[step];

/** However the steps behave, enrolling ends with an outcome on screen within this long. */
export const ENROLL_LIMIT_MS = 90000;

export function reasonOf(err: unknown): string {
  if (err instanceof IdentityError) return err.code;
  return String((err as { message?: string })?.message ?? err).slice(0, 200);
}

/** Needs a signed-in account (the token is kept in memory, so after a restart this asks for a sign-in first). */
export async function enrollDevice(onStep: (step: EnrollStep) => void = () => {}): Promise<EnrollResult> {
  if (!onIphone()) return { ok: false, reason: "not-ios" };
  const api = identityApi();
  if (!api.signedIn()) return { ok: false, reason: "not-signed-in" };
  let step: EnrollStep = "challenge";
  // Set once the overall limit has passed: from then on nothing more is registered or saved, so a failure on
  // screen always means nothing was kept.
  let abandoned = false;
  const at = (next: EnrollStep) => {
    step = next;
    onStep(next);
  };
  const run = async (): Promise<EnrollResult> => {
    try {
      at("challenge");
      const { nonce } = await api.attestChallenge();
      const { sc } = await plugin();
      at("apple");
      // The phone gives Apple 30 seconds; this only guards a call that never comes back at all.
      const proof = await withTimeout(sc.appAttestEnroll({ nonce }), 45000);
      if (abandoned) return { ok: false, reason: `timed-out:${step}` };
      at("proof");
      const accepted = await api.attestRegister({ keyId: proof.key_id, nonce, attestation: proof.attestation_b64 });
      if (!accepted.trusted) return { ok: false, reason: "server-rejected" };
      if (abandoned) return { ok: false, reason: `timed-out:${step}` };
      // Only now does the phone use this key. A rejected proof leaves nothing behind to retry against.
      at("saving");
      await withTimeout(sc.appAttestConfirm({ keyId: proof.key_id }), 10000);
      return { ok: true, keyId: proof.key_id };
    } catch (err) {
      // A step's own time limit reads the same on screen as the overall one: which step, and that nothing was kept.
      if (err instanceof Error && err.message === "timed out") return { ok: false, reason: `timed-out:${step}` };
      return { ok: false, reason: reasonOf(err) };
    }
  };
  try {
    return await withTimeout(run(), ENROLL_LIMIT_MS);
  } catch {
    abandoned = true;
    return { ok: false, reason: `timed-out:${step}` };
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

const TIMED_OUT: Record<string, string> = {
  challenge: "The Shield server did not answer in time. Nothing was saved on this phone.",
  apple: "Apple's device check did not answer in time. Nothing was saved on this phone.",
  proof: "The Shield server did not answer in time when sent Apple's proof. Nothing was saved on this phone.",
  saving: "The phone did not finish saving the key in time. Check whether it shows as enrolled.",
};

/** Plain words for the screen; the raw code stays visible so a failure can be reported exactly. */
export function enrollErrorText(reason: string): string {
  if (FIXED[reason]) return FIXED[reason];
  if (reason.startsWith("timed-out:")) {
    const step = reason.slice("timed-out:".length);
    return `${TIMED_OUT[step] ?? "Enrolling did not finish in time."} Reason: ${reason}`;
  }
  if (reason.startsWith("attest-failed:")) return `Apple's device check failed. Reason: ${reason.slice("attest-failed:".length).trim()}`;
  return `The device check could not be set up. Reason: ${reason}`;
}
