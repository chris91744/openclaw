import { createHash, randomUUID } from "node:crypto";

export const TEXT_MAILROOM_SEND_OPTIN_ENV = "OPENCLAW_TEXT_MAILROOM_SEND_OPTIN";

export type TextMailroomContactLabel =
  | "known"
  | "vendor"
  | "client"
  | "lead"
  | "personal"
  | "unknown"
  | "blocked";

export type TextMailroomOutboundStatus =
  | "queued"
  | "approved"
  | "rejected"
  | "sending"
  | "sent"
  | "failed";

export type TextMailroomOutboundKind =
  | "campaign_outreach"
  | "conversation_reply"
  | "manual"
  | "follow_up";

export type TextMailroomRisk = "low" | "medium" | "high";

export type TextMailroomContact = {
  contactId: string;
  displayName?: string;
  phone: string;
  phoneHash: string;
  labels: TextMailroomContactLabel[];
  source?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TextMailroomCampaign = {
  campaignId: string;
  purpose: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  allowedRecipientHashes: string[];
  maxSends: number;
  sendsUsed: number;
  followupsAllowed: boolean;
  followupAfterMs?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TextMailroomApproval = {
  approvedBy: string;
  approvedAt: string;
  recipientHash: string;
  bodyHash: string;
  campaignId?: string;
  highRiskConfirmed?: boolean;
};

export type TextMailroomOutboundItem = {
  id: string;
  kind: TextMailroomOutboundKind;
  status: TextMailroomOutboundStatus;
  accountId?: string;
  recipient: string;
  recipientHash: string;
  body: string;
  bodyHash: string;
  campaignId?: string;
  contactId?: string;
  threadId?: string;
  requestId?: string;
  reason: string;
  source: string;
  risk: TextMailroomRisk;
  requestedBy?: string;
  createdAt: string;
  updatedAt: string;
  approval?: TextMailroomApproval;
  rejection?: { rejectedBy: string; rejectedAt: string; reason?: string };
  sent?: { sentAt: string; messageId: string };
  failure?: { failedAt: string; message: string };
};

export type TextMailroomInboundMessage = {
  id: string;
  direction: "inbound" | "outbound";
  sender: string;
  senderHash: string;
  body: string;
  bodyHash: string;
  receivedAt: string;
  source?: string;
};

export type TextMailroomThread = {
  threadId: string;
  accountId?: string;
  contactId?: string;
  sender: string;
  senderHash: string;
  status: "open" | "held" | "closed";
  tags: string[];
  priority: "low" | "normal" | "high";
  needsReply: boolean;
  lastInboundAt?: string;
  summary?: string;
  messages: TextMailroomInboundMessage[];
  updatedAt: string;
};

export type TextMailroomAuditEvent = {
  id: string;
  type: string;
  at: string;
  itemId?: string;
  campaignId?: string;
  contactId?: string;
  threadIdHash?: string;
  recipientHash?: string;
  bodyHash?: string;
  note?: string;
};

export function textMailroomNow(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

export function textMailroomId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function textMailroomSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeTextMailroomPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Text Mailroom recipient is required");
  }
  if (/^[\d\s()+.-]+$/.test(trimmed)) {
    return trimmed.replace(/[^\d+]/g, "");
  }
  return trimmed.replace(/\s+/g, "");
}

export function hashTextMailroomRecipient(raw: string): string {
  return textMailroomSha256(normalizeTextMailroomPhone(raw).toLowerCase());
}

export function hashTextMailroomBody(raw: string): string {
  return textMailroomSha256(raw.replace(/\s+/g, " ").trim());
}

export function assertTextMailroomSendOptIn(): void {
  if (process.env[TEXT_MAILROOM_SEND_OPTIN_ENV] !== "1") {
    throw new Error(
      `Text Mailroom approved sending is disabled: ${TEXT_MAILROOM_SEND_OPTIN_ENV} must be set to 1.`,
    );
  }
}
