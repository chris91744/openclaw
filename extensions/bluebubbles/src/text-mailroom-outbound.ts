import type { OpenClawConfig } from "openclaw/plugin-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { sendMessageBlueBubbles } from "./send.js";
import {
  appendTextMailroomAudit,
  ensurePrivateDir,
  ensureTextMailroomStore,
  listPrivateJson,
  readPrivateJson,
  safeFileStem,
  textMailroomPaths,
  type TextMailroomStoreOptions,
  writePrivateJson,
} from "./text-mailroom-store.js";
import {
  assertTextMailroomSendOptIn,
  hashTextMailroomBody,
  hashTextMailroomRecipient,
  normalizeTextMailroomPhone,
  textMailroomId,
  textMailroomNow,
  type TextMailroomCampaign,
  type TextMailroomContact,
  type TextMailroomContactLabel,
  type TextMailroomOutboundItem,
  type TextMailroomOutboundKind,
  type TextMailroomRisk,
} from "./text-mailroom-types.js";

export type TextMailroomSender = (params: {
  to: string;
  body: string;
  accountId?: string;
  cfg?: OpenClawConfig;
}) => Promise<{ messageId: string }>;

export type TextMailroomOutboundOptions = TextMailroomStoreOptions & {
  cfg?: OpenClawConfig;
  sender?: TextMailroomSender;
  maxApprovalAgeMs?: number;
};

type ContactInput = {
  phone: string;
  displayName?: string;
  labels?: TextMailroomContactLabel[];
  source?: string;
  notes?: string;
};

type CampaignInput = {
  purpose: string;
  approvedBy: string;
  confirmAuthorization?: boolean;
  allowedRecipients: string[];
  maxSends: number;
  followupsAllowed?: boolean;
  followupAfterMs?: number;
  expiresAt?: string;
};

type ProposalInput = {
  kind: TextMailroomOutboundKind;
  recipient: string;
  body: string;
  reason: string;
  source: string;
  risk?: TextMailroomRisk;
  accountId?: string;
  campaignId?: string;
  contactId?: string;
  threadId?: string;
  requestId?: string;
  requestedBy?: string;
};

const DEFAULT_MAX_APPROVAL_AGE_MS = 6 * 60 * 60 * 1000;
const VALID_CONTACT_LABELS = new Set<TextMailroomContactLabel>([
  "blocked",
  "client",
  "known",
  "lead",
  "personal",
  "unknown",
  "vendor",
]);

export async function upsertTextMailroomContact(
  options: TextMailroomStoreOptions,
  input: ContactInput,
): Promise<TextMailroomContact> {
  await ensureTextMailroomStore(options.rootDir);
  const phone = normalizeTextMailroomPhone(input.phone);
  const phoneHash = hashTextMailroomRecipient(phone);
  const existing = await findContactByPhoneHash(options, phoneHash);
  const now = textMailroomNow(options.now);
  const contact: TextMailroomContact = {
    contactId: existing?.contactId ?? textMailroomId("contact"),
    displayName: input.displayName?.trim() || existing?.displayName,
    phone,
    phoneHash,
    labels: normalizeLabels(input.labels ?? existing?.labels ?? ["unknown"]),
    source: input.source?.trim() || existing?.source,
    notes: input.notes?.trim() || existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writePrivateJson(contactPath(options.rootDir, contact.contactId), contact);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.contact.upserted",
    contactId: contact.contactId,
    recipientHash: contact.phoneHash,
  });
  return contact;
}

export async function authorizeTextMailroomCampaign(
  options: TextMailroomStoreOptions,
  input: CampaignInput,
): Promise<TextMailroomCampaign> {
  if (input.confirmAuthorization !== true) {
    throw new Error("Text Mailroom campaign authorization requires confirmAuthorization");
  }
  if (!input.approvedBy.trim()) {
    throw new Error("Text Mailroom campaign approval requires approvedBy");
  }
  if (!input.purpose.trim()) {
    throw new Error("Text Mailroom campaign purpose is required");
  }
  if (!Number.isInteger(input.maxSends) || input.maxSends < 1) {
    throw new Error("Text Mailroom campaign maxSends must be a positive integer");
  }
  const allowedRecipientHashes = Array.from(
    new Set(input.allowedRecipients.map((recipient) => hashTextMailroomRecipient(recipient))),
  ).sort();
  if (allowedRecipientHashes.length === 0) {
    throw new Error("Text Mailroom campaign requires at least one allowed recipient");
  }
  await ensureTextMailroomStore(options.rootDir);
  const now = textMailroomNow(options.now);
  const campaign: TextMailroomCampaign = {
    campaignId: textMailroomId("campaign"),
    purpose: input.purpose.trim(),
    approved: true,
    approvedBy: input.approvedBy.trim(),
    approvedAt: now,
    allowedRecipientHashes,
    maxSends: input.maxSends,
    sendsUsed: 0,
    followupsAllowed: input.followupsAllowed === true,
    followupAfterMs: input.followupAfterMs,
    expiresAt: input.expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  await writePrivateJson(campaignPath(options.rootDir, campaign.campaignId), campaign);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.campaign.authorized",
    campaignId: campaign.campaignId,
    actor: campaign.approvedBy,
  });
  return campaign;
}

export async function proposeTextMailroomOutbound(
  options: TextMailroomStoreOptions,
  input: ProposalInput,
): Promise<TextMailroomOutboundItem> {
  await ensureTextMailroomStore(options.rootDir);
  const body = input.body.trim();
  if (!body) {
    throw new Error("Text Mailroom outbound proposal requires a message body");
  }
  if (!input.reason.trim()) {
    throw new Error("Text Mailroom outbound proposal requires a reason");
  }
  const recipient = normalizeTextMailroomPhone(input.recipient);
  const recipientHash = hashTextMailroomRecipient(recipient);
  const bodyHash = hashTextMailroomBody(body);
  const contact = input.contactId
    ? await loadTextMailroomContact(options, input.contactId)
    : await findContactByPhoneHash(options, recipientHash);
  if (contact?.labels.includes("blocked")) {
    throw new Error("Text Mailroom refuses to queue messages to blocked contacts");
  }
  if (input.kind === "conversation_reply" && !input.threadId?.trim()) {
    throw new Error("Text Mailroom conversation replies require a threadId");
  }
  if (input.kind === "campaign_outreach" || input.campaignId) {
    const campaign = await loadRequiredCampaign(options, input.campaignId);
    if (input.kind === "follow_up" && !campaign.followupsAllowed) {
      throw new Error("Text Mailroom campaign does not allow follow-ups");
    }
    validateCampaignForRecipient(campaign, recipientHash, options);
  }
  const requestId = normalizeRequestId(input.requestId);
  if (requestId) {
    const existing = await findOutboundByRequestId(options, requestId);
    if (existing) {
      assertMatchingIdempotentRequest(existing, {
        kind: input.kind,
        recipientHash,
        bodyHash,
        campaignId: input.campaignId,
        contactId: contact?.contactId ?? input.contactId,
        threadId: input.threadId?.trim() || undefined,
      });
      await appendTextMailroomAudit(options, {
        type: "text_mailroom.outbound.deduped",
        itemId: existing.id,
        campaignId: existing.campaignId,
        contactId: existing.contactId,
        recipientHash: existing.recipientHash,
        bodyHash: existing.bodyHash,
      });
      return existing;
    }
  }
  const now = textMailroomNow(options.now);
  const item: TextMailroomOutboundItem = {
    id: textMailroomId("outbound"),
    kind: input.kind,
    status: "queued",
    accountId: input.accountId?.trim() || undefined,
    recipient,
    recipientHash,
    body,
    bodyHash,
    campaignId: input.campaignId,
    contactId: contact?.contactId ?? input.contactId,
    threadId: input.threadId?.trim() || undefined,
    requestId,
    reason: input.reason.trim(),
    source: input.source.trim() || "agent",
    risk: inferOutboundRisk(input, contact),
    requestedBy: input.requestedBy?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await writePrivateJson(outboundPath(options.rootDir, item.id), item);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.outbound.queued",
    itemId: item.id,
    campaignId: item.campaignId,
    contactId: item.contactId,
    recipientHash: item.recipientHash,
    bodyHash: item.bodyHash,
  });
  return item;
}

export async function approveTextMailroomOutbound(
  options: TextMailroomStoreOptions,
  params: {
    itemId: string;
    approvedBy: string;
    editedBody?: string;
    confirmApproval?: boolean;
    confirmHighRisk?: boolean;
  },
): Promise<TextMailroomOutboundItem> {
  if (params.confirmApproval !== true) {
    throw new Error("Text Mailroom approval requires confirmApproval");
  }
  const item = await loadRequiredOutbound(options, params.itemId);
  if (item.status !== "queued") {
    throw new Error(
      `Text Mailroom can only approve queued items; current status is ${item.status}`,
    );
  }
  if (!params.approvedBy.trim()) {
    throw new Error("Text Mailroom approval requires approvedBy");
  }
  if (item.risk === "high" && params.confirmHighRisk !== true) {
    throw new Error("Text Mailroom high-risk approval requires confirmHighRisk");
  }
  const body = params.editedBody?.trim() || item.body;
  if (!body.trim()) {
    throw new Error("Text Mailroom approval body cannot be empty");
  }
  if (item.campaignId) {
    validateCampaignForRecipient(
      await loadRequiredCampaign(options, item.campaignId),
      item.recipientHash,
      options,
    );
  }
  const now = textMailroomNow(options.now);
  const next: TextMailroomOutboundItem = {
    ...item,
    body,
    bodyHash: hashTextMailroomBody(body),
    status: "approved",
    approval: {
      approvedBy: params.approvedBy.trim(),
      approvedAt: now,
      recipientHash: item.recipientHash,
      bodyHash: hashTextMailroomBody(body),
      campaignId: item.campaignId,
      ...(item.risk === "high" ? { highRiskConfirmed: true } : {}),
    },
    updatedAt: now,
  };
  await writePrivateJson(outboundPath(options.rootDir, next.id), next);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.outbound.approved",
    itemId: next.id,
    campaignId: next.campaignId,
    recipientHash: next.recipientHash,
    bodyHash: next.bodyHash,
    actor: next.approval.approvedBy,
  });
  return next;
}

export async function rejectTextMailroomOutbound(
  options: TextMailroomStoreOptions,
  params: { itemId: string; rejectedBy: string; reason?: string },
): Promise<TextMailroomOutboundItem> {
  const rejectedBy = params.rejectedBy.trim();
  if (!rejectedBy) {
    throw new Error("Text Mailroom rejection requires rejectedBy");
  }
  const item = await loadRequiredOutbound(options, params.itemId);
  if (item.status === "sent" || item.status === "sending") {
    throw new Error(`Text Mailroom cannot reject item with status ${item.status}`);
  }
  const now = textMailroomNow(options.now);
  const next: TextMailroomOutboundItem = {
    ...item,
    status: "rejected",
    rejection: { rejectedBy, rejectedAt: now, reason: params.reason },
    updatedAt: now,
  };
  await writePrivateJson(outboundPath(options.rootDir, next.id), next);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.outbound.rejected",
    itemId: next.id,
    campaignId: next.campaignId,
    recipientHash: next.recipientHash,
    actor: rejectedBy,
  });
  return next;
}

export async function sendApprovedTextMailroomOutbound(
  options: TextMailroomOutboundOptions,
  params: { itemId: string },
): Promise<TextMailroomOutboundItem> {
  assertTextMailroomSendOptIn();
  const releaseClaim = await acquireOutboundSendClaim(options, params.itemId);
  let releaseCampaignClaim: (() => Promise<void>) | null = null;
  let sending: TextMailroomOutboundItem | null = null;
  try {
    const item = await loadRequiredOutbound(options, params.itemId);
    assertApprovedForSend(item, options);
    if (item.campaignId) {
      releaseCampaignClaim = await acquireCampaignSendClaim(options, item.campaignId);
      validateCampaignForRecipient(
        await loadRequiredCampaign(options, item.campaignId),
        item.recipientHash,
        options,
      );
    }
    sending = { ...item, status: "sending" as const, updatedAt: textMailroomNow(options.now) };
    await writePrivateJson(outboundPath(options.rootDir, sending.id), sending);
    // Injected senders are for tests/adapters; the production default keeps BlueBubbles' own send gate.
    const sender =
      options.sender ??
      ((sendParams) =>
        sendMessageBlueBubbles(sendParams.to, sendParams.body, {
          accountId: sendParams.accountId,
          cfg: sendParams.cfg,
        }));
    const result = await sender({
      to: sending.recipient,
      body: sending.body,
      accountId: sending.accountId,
      cfg: options.cfg,
    });
    if (sending.campaignId) {
      await incrementCampaignSendCount(options, sending.campaignId);
    }
    const sent: TextMailroomOutboundItem = {
      ...sending,
      status: "sent",
      sent: { sentAt: textMailroomNow(options.now), messageId: result.messageId },
      updatedAt: textMailroomNow(options.now),
    };
    await writePrivateJson(outboundPath(options.rootDir, sent.id), sent);
    await appendTextMailroomAudit(options, {
      type: "text_mailroom.outbound.sent",
      itemId: sent.id,
      campaignId: sent.campaignId,
      recipientHash: sent.recipientHash,
      bodyHash: sent.bodyHash,
    });
    return sent;
  } catch (error) {
    if (!sending) {
      await appendTextMailroomAudit(options, {
        type: "text_mailroom.outbound.blocked",
        itemId: params.itemId,
      });
      throw error;
    }
    const failed: TextMailroomOutboundItem = {
      ...sending,
      status: "failed",
      failure: { failedAt: textMailroomNow(options.now), message: (error as Error).message },
      updatedAt: textMailroomNow(options.now),
    };
    await writePrivateJson(outboundPath(options.rootDir, failed.id), failed);
    await appendTextMailroomAudit(options, {
      type: "text_mailroom.outbound.failed",
      itemId: failed.id,
      campaignId: failed.campaignId,
      recipientHash: failed.recipientHash,
      bodyHash: failed.bodyHash,
    });
    throw error;
  } finally {
    try {
      await releaseCampaignClaim?.();
    } finally {
      await releaseClaim();
    }
  }
}

export async function listTextMailroomOutboundItems(
  options: TextMailroomStoreOptions,
): Promise<TextMailroomOutboundItem[]> {
  const paths = textMailroomPaths(options.rootDir);
  return (await listPrivateJson<TextMailroomOutboundItem>(paths.outboundItems)).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export async function listTextMailroomContacts(
  options: TextMailroomStoreOptions,
): Promise<TextMailroomContact[]> {
  return (
    await listPrivateJson<TextMailroomContact>(textMailroomPaths(options.rootDir).contacts)
  ).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findTextMailroomContactByRecipient(
  options: TextMailroomStoreOptions,
  recipient: string,
): Promise<TextMailroomContact | null> {
  return findContactByPhoneHash(options, hashTextMailroomRecipient(recipient));
}

export async function listTextMailroomCampaigns(
  options: TextMailroomStoreOptions,
): Promise<TextMailroomCampaign[]> {
  return (
    await listPrivateJson<TextMailroomCampaign>(textMailroomPaths(options.rootDir).campaigns)
  ).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function loadTextMailroomOutboundItem(
  options: TextMailroomStoreOptions,
  itemId: string,
): Promise<TextMailroomOutboundItem | null> {
  return readPrivateJson<TextMailroomOutboundItem>(outboundPath(options.rootDir, itemId));
}

export async function loadTextMailroomContact(
  options: TextMailroomStoreOptions,
  contactId: string,
): Promise<TextMailroomContact | null> {
  return readPrivateJson<TextMailroomContact>(contactPath(options.rootDir, contactId));
}

export async function loadTextMailroomCampaign(
  options: TextMailroomStoreOptions,
  campaignId: string,
): Promise<TextMailroomCampaign | null> {
  return readPrivateJson<TextMailroomCampaign>(campaignPath(options.rootDir, campaignId));
}

function assertApprovedForSend(
  item: TextMailroomOutboundItem,
  options: TextMailroomOutboundOptions,
): void {
  if (item.status !== "approved" || !item.approval) {
    throw new Error(
      `Text Mailroom item must be approved before sending; current status is ${item.status}`,
    );
  }
  if (item.approval.recipientHash !== hashTextMailroomRecipient(item.recipient)) {
    throw new Error("Text Mailroom approval recipient hash mismatch");
  }
  if (item.approval.bodyHash !== hashTextMailroomBody(item.body)) {
    throw new Error("Text Mailroom approval body hash mismatch");
  }
  const approvedAt = Date.parse(item.approval.approvedAt);
  const now = options.now?.().getTime() ?? Date.now();
  const maxAge = options.maxApprovalAgeMs ?? DEFAULT_MAX_APPROVAL_AGE_MS;
  if (!Number.isFinite(approvedAt) || now - approvedAt > maxAge) {
    throw new Error("Text Mailroom approval is stale");
  }
}

async function acquireOutboundSendClaim(
  options: TextMailroomStoreOptions,
  itemId: string,
): Promise<() => Promise<void>> {
  const dir = textMailroomPaths(options.rootDir).outboundClaims;
  await ensurePrivateDir(dir);
  const filePath = path.join(dir, `${safeFileStem(itemId)}.lock`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({ itemId, claimedAt: textMailroomNow(options.now) })}\n`,
      "utf8",
    );
    await handle.chmod(0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Text Mailroom outbound item is already claimed for sending");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return async () => {
    await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  };
}

async function acquireCampaignSendClaim(
  options: TextMailroomStoreOptions,
  campaignId: string,
): Promise<() => Promise<void>> {
  const dir = textMailroomPaths(options.rootDir).outboundClaims;
  await ensurePrivateDir(dir);
  const filePath = path.join(dir, `campaign-${safeFileStem(campaignId)}.lock`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({ campaignId, claimedAt: textMailroomNow(options.now) })}\n`,
      "utf8",
    );
    await handle.chmod(0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Text Mailroom campaign is already claimed for sending");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return async () => {
    await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  };
}

async function incrementCampaignSendCount(
  options: TextMailroomStoreOptions,
  campaignId: string,
): Promise<void> {
  const campaign = await loadRequiredCampaign(options, campaignId);
  const next = {
    ...campaign,
    sendsUsed: campaign.sendsUsed + 1,
    updatedAt: textMailroomNow(options.now),
  };
  await writePrivateJson(campaignPath(options.rootDir, campaignId), next);
}

async function loadRequiredCampaign(
  options: TextMailroomStoreOptions,
  campaignId?: string,
): Promise<TextMailroomCampaign> {
  if (!campaignId) {
    throw new Error("Text Mailroom campaign is required");
  }
  const campaign = await loadTextMailroomCampaign(options, campaignId);
  if (!campaign) {
    throw new Error("Text Mailroom campaign not found");
  }
  return campaign;
}

async function loadRequiredOutbound(
  options: TextMailroomStoreOptions,
  itemId: string,
): Promise<TextMailroomOutboundItem> {
  const item = await readPrivateJson<TextMailroomOutboundItem>(
    outboundPath(options.rootDir, itemId),
  );
  if (!item) {
    throw new Error("Text Mailroom outbound item not found");
  }
  return item;
}

async function findContactByPhoneHash(
  options: TextMailroomStoreOptions,
  phoneHash: string,
): Promise<TextMailroomContact | null> {
  const contacts = await listPrivateJson<TextMailroomContact>(
    textMailroomPaths(options.rootDir).contacts,
  );
  return contacts.find((contact) => contact.phoneHash === phoneHash) ?? null;
}

async function findOutboundByRequestId(
  options: TextMailroomStoreOptions,
  requestId: string,
): Promise<TextMailroomOutboundItem | null> {
  const items = await listTextMailroomOutboundItems(options);
  return items.find((item) => item.requestId === requestId) ?? null;
}

function assertMatchingIdempotentRequest(
  existing: TextMailroomOutboundItem,
  input: {
    kind: TextMailroomOutboundKind;
    recipientHash: string;
    bodyHash: string;
    campaignId?: string;
    contactId?: string;
    threadId?: string;
  },
): void {
  const matches =
    existing.kind === input.kind &&
    existing.recipientHash === input.recipientHash &&
    existing.bodyHash === input.bodyHash &&
    (existing.campaignId ?? "") === (input.campaignId ?? "") &&
    (existing.contactId ?? "") === (input.contactId ?? "") &&
    (existing.threadId ?? "") === (input.threadId ?? "");
  if (!matches) {
    throw new Error("Text Mailroom request_id already exists with different outbound payload");
  }
}

function normalizeRequestId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 160) {
    throw new Error("Text Mailroom request_id is too long");
  }
  return trimmed;
}

function validateCampaignForRecipient(
  campaign: TextMailroomCampaign,
  recipientHash: string,
  options: TextMailroomStoreOptions,
): void {
  if (campaign.approved !== true) {
    throw new Error("Text Mailroom campaign is not approved");
  }
  if (!campaign.allowedRecipientHashes.includes(recipientHash)) {
    throw new Error("Text Mailroom campaign does not allow this recipient");
  }
  if (campaign.sendsUsed >= campaign.maxSends) {
    throw new Error("Text Mailroom campaign send limit reached");
  }
  if (campaign.expiresAt) {
    const expiresAt = Date.parse(campaign.expiresAt);
    const now = options.now?.().getTime() ?? Date.now();
    if (!Number.isFinite(expiresAt) || now > expiresAt) {
      throw new Error("Text Mailroom campaign is expired");
    }
  }
}

function normalizeLabels(labels: TextMailroomContactLabel[]): TextMailroomContactLabel[] {
  const normalized =
    labels.length > 0 ? labels : (["unknown"] satisfies TextMailroomContactLabel[]);
  for (const label of normalized) {
    if (!VALID_CONTACT_LABELS.has(label)) {
      throw new Error(`Text Mailroom contact label is invalid: ${label}`);
    }
  }
  return Array.from(new Set<TextMailroomContactLabel>(normalized)).sort();
}

function inferOutboundRisk(
  input: ProposalInput,
  contact: TextMailroomContact | null | undefined,
): TextMailroomRisk {
  return maxOutboundRisk(inferDefaultOutboundRisk(input, contact), input.risk);
}

function inferDefaultOutboundRisk(
  input: ProposalInput,
  contact: TextMailroomContact | null | undefined,
): TextMailroomRisk {
  if (input.kind === "campaign_outreach" || input.kind === "follow_up") {
    return "high";
  }
  if (!contact || contact.labels.includes("unknown")) {
    return "high";
  }
  if (contact.labels.includes("lead") || contact.labels.includes("personal")) {
    return "medium";
  }
  if (
    contact.labels.includes("client") ||
    contact.labels.includes("known") ||
    contact.labels.includes("vendor")
  ) {
    return "low";
  }
  return "medium";
}

function maxOutboundRisk(
  inferred: TextMailroomRisk,
  explicit: TextMailroomRisk | undefined,
): TextMailroomRisk {
  if (!explicit) {
    return inferred;
  }
  const rank: Record<TextMailroomRisk, number> = { low: 0, medium: 1, high: 2 };
  return rank[explicit] > rank[inferred] ? explicit : inferred;
}

function contactPath(rootDir: string, contactId: string): string {
  return path.join(textMailroomPaths(rootDir).contacts, `${safeFileStem(contactId)}.json`);
}

function campaignPath(rootDir: string, campaignId: string): string {
  return path.join(textMailroomPaths(rootDir).campaigns, `${safeFileStem(campaignId)}.json`);
}

function outboundPath(rootDir: string, itemId: string): string {
  return path.join(textMailroomPaths(rootDir).outboundItems, `${safeFileStem(itemId)}.json`);
}
