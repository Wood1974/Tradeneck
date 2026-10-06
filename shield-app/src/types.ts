export type PackKind = "remodel" | "draw" | "unit" | "loss" | "shop" | "custom" | "construction";

/** Shield seals only photos taken live with the native OS camera. */
export type CaptureKind = "native-camera";

export type PlatformKind = "ios" | "android" | "web";

export type Verdict = "SEALED" | "UNATTESTED-NATIVE" | "TAMPERED" | "NO-ORIGIN";

export type FeeTier = "standard" | "extended" | "major";

export type TradeId =
  | "roofing"
  | "kitchen"
  | "bathroom"
  | "electrical"
  | "plumbing"
  | "hvac"
  | "concrete"
  | "framing"
  | "siding"
  | "windows"
  | "flooring"
  | "paint"
  | "adu"
  | "general";

export type BriefRole = "homeowner" | "sub" | "gc";

export type BudgetBand = "" | "under15" | "15to50" | "over50";

/** IRC/IBC citation attached to a checkpoint. */
export interface CodeRef {
  irc: string | null;
  ibc: string | null;
  name: string;
  /** What the cited section covers. Absent on points locked before this field existed. */
  topic?: string;
}

export interface Checkpoint {
  id: string;
  label: string;
  required: boolean;
  shotId: string | null;
  description?: string;
  code?: CodeRef | null;
}

export interface ConstructionBriefDraft {
  role: BriefRole;
  title: string;
  trade: TradeId | "";
  budgetBand: BudgetBand;
  description: string;
  include: string;
  exclude: string;
  answers: Record<string, string | string[]>;
}

export interface ConstructionBrief extends ConstructionBriefDraft {
  trade: TradeId;
  lockedText: string;
  lockedAt: string;
}

export interface Job {
  id: string;
  pack: PackKind;
  customCount: number;
  budgetUsd: number;
  feeUsd: number;
  feeTier: FeeTier;
  lockedAt: string;
  pin: {
    lat: number;
    lng: number;
    radiusM: number;
  } | null;
  checkpoints: Checkpoint[];
  brief?: ConstructionBrief | null;
  closedAt?: string | null;
}

export interface SealRecord {
  id: string;
  createdAt: string;
  captureKind: CaptureKind;
  platform: PlatformKind;
  jobId: string | null;
  checkpointId: string | null;
  sha256: string;
  prevChain: string;
  chainHead: string;
  bytes: number;
  mime: string;
  gps: {
    lat: number;
    lng: number;
    acc: number;
    source: "os";
  } | null;
  pinScore: {
    meters: number | null;
    inside: boolean | null;
    mockFlag: "unknown" | "native-pending";
  } | null;
  deviceSealId: string;
  attest: {
    kind: "app-attest" | "play-integrity" | "none";
    boundHash: string | null;
    tokenPresent: boolean;
  };
  signature: string;
}

/** Photo bytes live in the separate `blobs` store (see store/db.ts), so listing the vault stays light. */
export interface VaultItem {
  record: SealRecord;
}

export interface ShieldBundle {
  version: 1;
  record: SealRecord;
  originalB64: string;
  /** Raw P-256 public key (base64) of the signing device. Without it the record cannot be authenticated. */
  devicePublicKey?: string;
}

export interface CloseoutPoint {
  id: string;
  label: string;
  description: string;
  code: CodeRef | null;
  record: SealRecord | null;
}

export interface CloseoutBody {
  schema: "tradedeck.shield.completion.v3";
  closedAt: string;
  closedBy: { role: string };
  job: {
    id: string;
    title: string;
    trade: string;
    budgetBand: string | null;
    feeUsd: number;
    pin: Job["pin"];
  };
  brief: {
    role: string;
    lockedText: string;
    answers: Record<string, string | string[]>;
  } | null;
  points: CloseoutPoint[];
  counts: { points: number; sealed: number; missing: number };
  notes: string;
  deviceSealId: string;
  devicePublicKey: string;
  canonicalVersion: 1;
}

export interface CloseoutPacket extends CloseoutBody {
  integrity: {
    algo: "SHA-256";
    canonical: "stableStringify";
    hash: string;
    signature: string;
  };
}
