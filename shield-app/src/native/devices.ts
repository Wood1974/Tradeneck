import { IdentityError, identityApi, type PhoneKey } from "../identity/client";

/** Plain words for what went wrong, never a raw code. */
export function phonesMessage(err: unknown): string {
  const code = err instanceof IdentityError ? err.code : "";
  if (code === "network") return "No connection. Try again with signal.";
  if (code === "not-signed-in" || code === "session-expired") return "Sign in again, then try again.";
  if (code === "not_found") return "The server no longer has that phone.";
  if (code === "rate_limit_exceeded") return "Too many requests. Wait a minute and try again.";
  if (code === "Not Found" || code === "http-404") return "The Shield server has not been updated for this yet.";
  return code ? `Could not do that (${code}).` : "Could not do that.";
}

export const listPhones = (): Promise<PhoneKey[]> => identityApi().listPhones();
export const withdrawPhone = (id: string): Promise<void> => identityApi().revokePhone(id);

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** The key the app is using now cannot be withdrawn from here: its photos would stop showing as Apple-checked with no way to fix it on this screen. */
export const canWithdraw = (phone: PhoneKey, thisPhoneKeyId: string | null): boolean => phone.revoked_at === null && phone.id !== thisPhoneKeyId;

/** One line for the list of phones. */
export function describePhone(phone: PhoneKey, thisPhoneKeyId: string | null): string {
  const photos = `${phone.photos} photo${phone.photos === 1 ? "" : "s"}`;
  const who = phone.id === thisPhoneKeyId ? "this phone" : "another phone or an earlier install";
  if (phone.revoked_at) return `${who} · withdrawn ${day(phone.revoked_at)} · enrolled ${day(phone.enrolled_at)} · ${photos}`;
  return `${who} · enrolled ${day(phone.enrolled_at)} · ${photos}`;
}
