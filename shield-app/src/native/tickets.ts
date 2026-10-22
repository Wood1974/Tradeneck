import { identityApi, IdentityError } from "../identity/client";
import { isNativeOriginAvailable } from "../platform";

// Asks the Shield server for a signed start-of-job ticket before the first photo of a job (or of the phone, for the id "device"),
// has the phone countersign it with its hardware key, and makes the ticket the start of that photo chain. A chain started this
// way began after the server's time on the ticket. Everything here is best effort: no failure stops or delays a photo. A chain
// that could not get a ticket keeps a local start and says so. The server only answers these calls once its owner has set a
// ticket key; until then (and on a server that predates them) the calls end quietly and nothing changes.

export type TicketOutcome =
  | "server" // the ticket is the start of this chain
  | "closed" // the server has no ticket service
  | "offline" // no signal; tried again later
  | "signed-out" // nobody is signed in; tried again after sign-in
  | "late" // photos already exist for this id; a start cannot be replaced
  | "refused" // the server or the phone said no
  | "failed" // something unexpected; the chain stays local
  | "unsupported"; // not the native app

// The server's answers when it has no ticket service: its own code, or an older server with no such route.
const CLOSED = new Set(["tickets_closed", "ticket_key_invalid", "Not Found", "http-404", "http-503"]);
const SIGNED_OUT = new Set(["not-signed-in", "session-expired"]);
const RETRY_LATER = new Set<TicketOutcome>(["offline", "signed-out"]);

let serverClosed = false;
const attempts = new Map<string, Promise<TicketOutcome>>();
const outcomes = new Map<string, TicketOutcome>();

export const ticketOutcome = (ticketId: string): TicketOutcome | undefined => outcomes.get(ticketId);

async function run(ticketId: string): Promise<TicketOutcome> {
  if (!isNativeOriginAvailable() || import.meta.env.MODE === "e2e") return "unsupported";
  if (serverClosed) return "closed";
  const api = identityApi();
  if (!api.signedIn()) return "signed-out";
  try {
    const { SecureCapture } = await import("@tradedeck/secure-capture");
    // The plugin refuses a new start once a photo is in the chain, so do not ask the server for one that cannot be used.
    const { records } = await SecureCapture.listQueue({ ticketId });
    if (records.length > 0) return "late";
    const issued = await api.issueTicket(ticketId);
    const clock = await SecureCapture.readClock();
    const signed = await SecureCapture.signGenesis({ ticketHashHex: issued.ticket_hash, ticketClock: clock });
    await api.countersignTicket({
      ticket: issued.ticket,
      server_signature_der_b64: issued.server_signature_der_b64,
      ticket_clock: { ...clock },
      signature_der_b64: signed.signature_der_b64,
      public_key_uncompressed_b64: signed.public_key_uncompressed_b64,
    });
    await SecureCapture.adoptServerTicket({ ticketId, ticketHash: issued.ticket_hash, ticketClock: clock });
    return "server";
  } catch (err) {
    if (err instanceof IdentityError) {
      if (CLOSED.has(err.code)) {
        serverClosed = true;
        return "closed";
      }
      if (err.code === "network") return "offline";
      if (SIGNED_OUT.has(err.code)) return "signed-out";
      return "refused";
    }
    return "failed";
  }
}

/** Starts (once per id) the ticket handshake for this id. Never rejects. Offline and signed-out attempts are tried again on the next call. */
export function ensureServerTicket(ticketId: string): Promise<TicketOutcome> {
  const existing = attempts.get(ticketId);
  if (existing) return existing;
  const attempt = run(ticketId)
    .catch((): TicketOutcome => "failed")
    .then((outcome) => {
      outcomes.set(ticketId, outcome);
      if (RETRY_LATER.has(outcome)) attempts.delete(ticketId);
      return outcome;
    });
  attempts.set(ticketId, attempt);
  return attempt;
}

/**
 * Lets a handshake that is already under way finish before the shutter, but never longer than `ms`. Starts nothing: taking a
 * photo never makes a network call of its own.
 */
export async function waitForTicket(ticketId: string, ms = 2000): Promise<void> {
  const attempt = attempts.get(ticketId);
  if (!attempt) return;
  await Promise.race([attempt.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}
