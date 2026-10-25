import { API_BASE, identityApi, IdentityError, type ShareInfo, type ShareMade } from "../identity/client";
import { recordHashFor } from "./uploader";

/** How long a share code may work, in days. The server accepts 1 to 90; the phone offers these three. */
export const SHARE_DAYS = [7, 30, 90] as const;
export const DEFAULT_SHARE_DAYS = 30;

/** Where whoever receives a code goes to check a photo. No account is needed there. */
export const shareCheckUrl = (): string => `${API_BASE}/check`;

/** True once the server has the photo; a code can only be made for a photo the server holds. */
export const canShare = (photoSha256: string): boolean => recordHashFor(photoSha256) !== undefined;

export class ShareError extends Error {}

/** Plain words for what went wrong, never a raw code. */
export function shareMessage(err: unknown): string {
  const code = err instanceof IdentityError ? err.code : "";
  if (code === "network") return "No connection. Try again with signal.";
  if (code === "not-signed-in" || code === "session-expired") return "Sign in again, then try again.";
  if (code === "not_found") return "The server does not have this photo yet. Wait for it to upload.";
  if (code === "rate_limit_exceeded") return "Too many requests. Wait a minute and try again.";
  if (code === "share_request_invalid") return "That length is not allowed.";
  if (err instanceof ShareError) return err.message;
  return code ? `Could not do that (${code}).` : "Could not do that.";
}

function hashOrThrow(photoSha256: string): string {
  const hash = recordHashFor(photoSha256);
  if (!hash) throw new ShareError("The server does not have this photo yet. Wait for it to upload.");
  return hash;
}

/** The codes already made for this photo, newest first. The codes themselves are never listed, only whether each still works. */
export async function sharesFor(photoSha256: string): Promise<ShareInfo[]> {
  return identityApi().listShares(hashOrThrow(photoSha256));
}

/** Makes a code. The plain code exists only in this answer; the server keeps a hash of it. */
export async function makeShare(photoSha256: string, days: number): Promise<ShareMade> {
  if (!(SHARE_DAYS as readonly number[]).includes(days)) throw new ShareError("That length is not allowed.");
  return identityApi().createShare(hashOrThrow(photoSha256), days);
}

export const withdrawShare = (shareId: string): Promise<void> => identityApi().revokeShare(shareId);

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** One line for the list of codes: works until, expired on, or withdrawn. */
export function describeShare(info: ShareInfo): string {
  if (info.revoked) return `withdrawn · made ${day(info.created_at)}`;
  if (!info.active) return `expired ${day(info.expires_at)} · made ${day(info.created_at)}`;
  return `works until ${day(info.expires_at)} · made ${day(info.created_at)}`;
}

/** What goes on the clipboard: the code, the page, and the expiry. Nothing about the account or the job. */
export function shareText(made: ShareMade): string {
  return `Shield photo check\nPage: ${shareCheckUrl()}\nCode: ${made.code}\nWorks until: ${day(made.expires_at)}\nOpen the page, enter the code, and choose the original photo file.`;
}
