import type {
  DealStatus,
  DocumentStatus,
  OfferStatus,
  ReconciliationStatus,
  RequirementStatus,
  SettlementStatus,
  ApprovalPolicyStatus,
  ApprovalRequestStatus,
  ApprovalWorkflowStatus,
  DealType,
} from "./types";

export type Tone = "accent" | "amber" | "rose" | "steel" | "neutral" | "paper" | "success" | "faintest";

export interface ToneClass {
  /** subtle background + colored text + hairline dot — chip */
  chip: string;
  /** solid text */
  text: string;
  /** filled bar/label */
  textStrong: string;
  /** soft block background */
  softBg: string;
  /** solid background, dark text */
  solid: string;
  /** raw color reference (used for charts etc.) */
  color: string;
}

export const TONES: Record<Tone, ToneClass> = {
  accent: {
    chip: "border border-accent/25 bg-accent-soft text-accent",
    text: "text-accent",
    textStrong: "text-accent-strong",
    softBg: "bg-accent/10",
    solid: "bg-accent-strong text-accent-ink",
    color: "#34d399",
  },
  amber: {
    chip: "border border-amber/25 bg-amber-soft text-amber",
    text: "text-amber",
    textStrong: "text-amber",
    softBg: "bg-amber/10",
    solid: "bg-amber text-ink-950",
    color: "#f5b14c",
  },
  rose: {
    chip: "border border-rose/25 bg-rose-soft text-rose",
    text: "text-rose",
    textStrong: "text-rose",
    softBg: "bg-rose/10",
    solid: "bg-rose text-ink-950",
    color: "#fb7185",
  },
  steel: {
    chip: "border border-steel/20 bg-steel-soft text-steel",
    text: "text-steel",
    textStrong: "text-steel",
    softBg: "bg-steel/10",
    solid: "bg-steel text-ink-950",
    color: "#7dd3fc",
  },
  neutral: {
    chip: "border border-line-strong bg-ink-800 text-muted",
    text: "text-muted",
    textStrong: "text-muted",
    softBg: "bg-ink-800",
    solid: "bg-ink-700 text-paper",
    color: "#a6aeba",
  },
  paper: {
    chip: "border border-line-strong bg-ink-875 text-paper",
    text: "text-paper",
    textStrong: "text-paper",
    softBg: "bg-ink-875",
    solid: "bg-paper text-ink-950",
    color: "#f0f2f4",
  },
  success: {
    chip: "border border-accent/30 bg-accent-soft text-accent-strong",
    text: "text-accent-strong",
    textStrong: "text-accent-strong",
    softBg: "bg-accent/10",
    solid: "bg-accent-strong text-accent-ink",
    color: "#10b981",
  },
  faintest: {
    chip: "border border-line bg-ink-850 text-faintest",
    text: "text-faintest",
    textStrong: "text-faintest",
    softBg: "bg-ink-850",
    solid: "bg-ink-700 text-paper",
    color: "#4b545f",
  },
};

export const toneOf = (t: Tone): ToneClass => TONES[t];

export function toneFrom(
  tone: Tone,
): { text: string; textStrong: string; softBg: string; solid: string; color: string; chip: string } {
  return TONES[tone];
}

const dealTone: Record<DealStatus, Tone> = {
  DRAFT: "neutral",
  OPEN: "steel",
  NEGOTIATING: "amber",
  AGREED: "accent",
  APPROVAL_PENDING: "amber",
  APPROVED: "accent",
  SETTLEMENT_PENDING: "amber",
  SETTLED: "accent",
  RECONCILING: "steel",
  COMPLETED: "accent",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
  FAILED: "rose",
  DISPUTED: "rose",
};

const offerTone: Record<OfferStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "steel",
  COUNTERED: "amber",
  ACCEPTED: "accent",
  REJECTED: "rose",
  WITHDRAWN: "neutral",
  EXPIRED: "neutral",
  SUPERSEDED: "neutral",
};

const documentTone: Record<DocumentStatus, Tone> = {
  UPLOADING: "neutral",
  UPLOADED: "neutral",
  SUBMITTED: "steel",
  UNDER_REVIEW: "amber",
  ACCEPTED: "accent",
  REJECTED: "rose",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
  SUPERSEDED: "neutral",
};

const requirementTone: Record<RequirementStatus, Tone> = {
  OPEN: "steel",
  SUBMITTED: "amber",
  SATISFIED: "accent",
  REJECTED: "rose",
  WAIVED: "neutral",
  EXPIRED: "neutral",
};

const settlementTone: Record<SettlementStatus, Tone> = {
  CREATED: "neutral",
  SUBMITTING: "amber",
  SUBMITTED: "steel",
  PENDING: "amber",
  SETTLED: "accent",
  FAILED: "rose",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

const reconciliationTone: Record<ReconciliationStatus, Tone> = {
  PENDING: "amber",
  MATCHED: "accent",
  MISMATCHED: "rose",
  FAILED: "rose",
  RESOLVED: "accent",
};

const policyTone: Record<ApprovalPolicyStatus, Tone> = {
  DRAFT: "neutral",
  ACTIVE: "accent",
  INACTIVE: "neutral",
  ARCHIVED: "neutral",
};

const workflowTone: Record<ApprovalWorkflowStatus, Tone> = {
  NOT_STARTED: "neutral",
  PENDING: "amber",
  APPROVED: "accent",
  REJECTED: "rose",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

const requestTone: Record<ApprovalRequestStatus, Tone> = {
  PENDING: "amber",
  APPROVED: "accent",
  REJECTED: "rose",
  SKIPPED: "neutral",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

export const toneFor = {
  deal: (s: DealStatus) => dealTone[s] ?? "neutral",
  offer: (s: OfferStatus) => offerTone[s] ?? "neutral",
  document: (s: DocumentStatus) => documentTone[s] ?? "neutral",
  requirement: (s: RequirementStatus) => requirementTone[s] ?? "neutral",
  settlement: (s: SettlementStatus) => settlementTone[s] ?? "neutral",
  reconciliation: (s: ReconciliationStatus) => reconciliationTone[s] ?? "neutral",
  policy: (s: ApprovalPolicyStatus) => policyTone[s] ?? "neutral",
  workflow: (s: ApprovalWorkflowStatus) => workflowTone[s] ?? "neutral",
  request: (s: ApprovalRequestStatus) => requestTone[s] ?? "neutral",
};

export const dealTypeLabel: Record<DealType, string> = {
  RWA_PURCHASE: "RWA Purchase",
  RWA_SALE: "RWA Sale",
  PRIVATE_TRADE: "Private Trade",
  OTHER: "Other",
};

/** Human label for a snake_case status/tone key. */
export function humanLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return key
    .split("_")
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export const dealTypeOptions = (Object.keys(dealTypeLabel) as DealType[]).map(
  (v) => ({ value: v, label: dealTypeLabel[v] }),
);