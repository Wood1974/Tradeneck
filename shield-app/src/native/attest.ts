/**
 * App Attest / Play Integrity bind to photo hash.
 * Web cannot issue these tokens. The live capture plugin
 * (`plugins/secure-capture`) leaves both as null on purpose: App Attest
 * assertions and Play Integrity tokens are enrollment/sync steps, not part
 * of the offline seal. This function stays `none` until those calls exist.
 */
import { detectPlatform } from "../platform";

export interface AttestResult {
  kind: "app-attest" | "play-integrity" | "none";
  boundHash: string | null;
  tokenPresent: boolean;
}

export async function attestPhotoHash(sha256: string): Promise<AttestResult> {
  const platform = detectPlatform();
  const bridge = (window as unknown as { ShieldAttest?: { assert: (hash: string) => Promise<{ token: string }> } }).ShieldAttest;

  if (platform === "ios" && bridge?.assert) {
    const { token } = await bridge.assert(sha256);
    return { kind: "app-attest", boundHash: sha256, tokenPresent: Boolean(token) };
  }
  if (platform === "android" && bridge?.assert) {
    const { token } = await bridge.assert(sha256);
    return { kind: "play-integrity", boundHash: sha256, tokenPresent: Boolean(token) };
  }
  return { kind: "none", boundHash: null, tokenPresent: false };
}
