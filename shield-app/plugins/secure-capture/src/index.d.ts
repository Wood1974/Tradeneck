export interface TicketClock {
  wall_time_ms: number;
  monotonic_ms: number;
  boot_id?: string;
  boot_count?: number;
}

export interface NativeCaptureRecord {
  version: 1;
  checkpoint_id: string;
  photo_sha256: string;
  ticket_id: string;
  wall_time_ms: number;
  monotonic_ms: number;
  boot_id?: string;
  boot_count?: number;
  gnss_time_ms?: number;
  location_simulated?: boolean;
  sensor_hash?: string;
  depth_hash?: string;
  depth_present?: boolean;
  flags: number;
  prev_hash: string;
  record_hash: string;
}

export interface NativeSealResult {
  photoBase64: string;
  mime: "image/jpeg";
  record: NativeCaptureRecord;
  sensor_snapshot: Record<string, string | number | boolean>;
  signature_der_b64: string;
  signature_kind: "keystore-sha256-ecdsa" | "secure-enclave-p256";
  public_key_uncompressed_b64: string;
  key_id_sha256: string;
  key_security_level: "StrongBox" | "TEE" | "SecureEnclave" | "software" | "unknown";
  attestation_chain_b64: string | null;
  attestation_challenge_source: "local" | "server";
  app_attest_assertion_b64: null;
  play_integrity_token: null;
  ticket_origin: "local" | "server";
  anchor_hash: string;
  ticket_clock: TicketClock;
}

export interface ExportPackage {
  schema: "tradedeck.shield.capture-export.v1";
  ticket_id: string;
  ticket_origin: "local" | "server";
  anchor_hash: string;
  ticket_clock: TicketClock | null;
  records: Array<Omit<NativeSealResult, "photoBase64">>;
}

export const SecureCapture: SecureCapturePlugin;

export interface SecureCapturePlugin {
  warmCamera(options?: { facing?: "back" | "front"; ticketId?: string }): Promise<void>;
  captureAndSeal(options: {
    checkpointId: string;
    ticketId: string;
    facing?: "back" | "front";
    appVersion?: string;
  }): Promise<NativeSealResult>;
  readClock(): Promise<TicketClock>;
  signGenesis(options: { ticketHashHex: string; ticketClock: TicketClock }): Promise<{
    signature_der_b64: string;
    signature_kind: NativeSealResult["signature_kind"];
    public_key_uncompressed_b64: string;
    key_id_sha256: string;
    client_data_sha256: string;
    app_attest_assertion_b64: null;
  }>;
  enrollKey(options?: { challengeBase64?: string }): Promise<{
    public_key_uncompressed_b64: string;
    key_id_sha256: string;
    key_security_level: NativeSealResult["key_security_level"];
    attestation_chain_b64: string | null;
    attestation_challenge_source: "local" | "server";
    play_integrity_token: null;
    app_attest_assertion_b64: null;
  }>;
  resetKey(): Promise<void>;
  adoptServerTicket(options: { ticketId: string; ticketHash: string; ticketClock: TicketClock }): Promise<void>;
  listQueue(options?: { ticketId?: string }): Promise<{ records: Array<{ record_hash: string; ticket_id: string; photo_sha256: string }> }>;
  exportQueue(options?: { ticketId?: string }): Promise<{ packages: ExportPackage[] }>;
  readOriginal(options: { recordHash: string }): Promise<{ photoBase64: string; mime: "image/jpeg" }>;
  verifyLocal(options?: { ticketId?: string }): Promise<{
    packages: Array<{
      ticket_id: string;
      chain_verdict: "INTACT" | "TAMPERED";
      chain_summary: string;
      time_verdicts: string[];
      signatures: Array<"valid" | "invalid" | "absent">;
      photos: Array<"match" | "mismatch" | "absent">;
      device_key_match: boolean;
    }>;
  }>;
}
