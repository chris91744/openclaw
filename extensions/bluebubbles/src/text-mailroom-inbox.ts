import path from "node:path";
import {
  findTextMailroomContactByRecipient,
  listTextMailroomOutboundItems,
  loadTextMailroomCampaign,
  proposeTextMailroomOutbound,
} from "./text-mailroom-outbound.js";
import {
  appendPrivateNdjson,
  appendTextMailroomAudit,
  ensureTextMailroomStore,
  listPrivateJson,
  readPrivateJson,
  safeFileStem,
  textMailroomPaths,
  type TextMailroomStoreOptions,
  writePrivateJson,
} from "./text-mailroom-store.js";
import {
  hashTextMailroomBody,
  hashTextMailroomRecipient,
  normalizeTextMailroomPhone,
  textMailroomId,
  textMailroomNow,
  textMailroomSha256,
  type TextMailroomInboundMessage,
  type TextMailroomOutboundItem,
  type TextMailroomThread,
} from "./text-mailroom-types.js";

type InboundInput = {
  sender: string;
  body: string;
  accountId?: string;
  threadId?: string;
  contactId?: string;
  receivedAt?: string;
  source?: string;
  providerMessageId?: string;
};

export type TextMailroomDigestItem = {
  threadId: string;
  senderHash: string;
  status: TextMailroomThread["status"];
  tags: string[];
  priority: TextMailroomThread["priority"];
  needsReply: boolean;
  lastInboundAt?: string;
  summary?: string;
};

export async function recordTextMailroomInbound(
  options: TextMailroomStoreOptions,
  input: InboundInput,
): Promise<TextMailroomThread> {
  await ensureTextMailroomStore(options.rootDir);
  const sender = normalizeTextMailroomPhone(input.sender);
  const body = input.body.trim();
  if (!body) {
    throw new Error("Text Mailroom inbound message body is required");
  }
  const senderHash = hashTextMailroomRecipient(sender);
  const threadId = input.threadId?.trim() || `thread_${senderHash.slice(0, 24)}`;
  const existing = await loadTextMailroomThread(options, threadId);
  const providerMessageId = input.providerMessageId?.trim();
  const bodyHash = hashTextMailroomBody(body);
  const receivedAt = input.receivedAt ?? textMailroomNow(options.now);
  if (providerMessageId && existing) {
    const duplicate = existing.messages.find(
      (message) => message.providerMessageId === providerMessageId,
    );
    if (duplicate) {
      if (duplicate.bodyHash !== bodyHash || duplicate.receivedAt !== receivedAt) {
        throw new Error("Text Mailroom provider message id collision");
      }
      return existing;
    }
  }
  const contact = input.contactId
    ? null
    : await findTextMailroomContactByRecipient(options, sender);
  const message: TextMailroomInboundMessage = {
    id: providerMessageId
      ? `inbound_${textMailroomSha256(providerMessageId).slice(0, 24)}`
      : textMailroomId("inbound"),
    direction: "inbound",
    providerMessageId,
    sender,
    senderHash,
    body,
    bodyHash,
    receivedAt,
    source: input.source,
  };
  const next: TextMailroomThread = {
    threadId,
    accountId: input.accountId ?? existing?.accountId,
    contactId: input.contactId ?? existing?.contactId ?? contact?.contactId,
    sender,
    senderHash,
    status: existing?.status ?? "open",
    tags: existing?.tags ?? [],
    priority: existing?.priority ?? "normal",
    needsReply: existing?.needsReply ?? false,
    lastInboundAt: receivedAt,
    summary: summarizeBody(body),
    messages: [...(existing?.messages ?? []), message].slice(-50),
    updatedAt: textMailroomNow(options.now),
  };
  await writePrivateJson(threadPath(options.rootDir, threadId), next);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.inbound.recorded",
    threadIdHash: hashTextMailroomRecipient(threadId),
    recipientHash: senderHash,
    bodyHash: message.bodyHash,
  });
  return next;
}

export async function classifyTextMailroomThread(
  options: TextMailroomStoreOptions,
  params: { threadId: string },
): Promise<TextMailroomThread> {
  const thread = await loadRequiredThread(options, params.threadId);
  const latest = thread.messages.at(-1);
  const body = latest?.body.toLowerCase() ?? "";
  const tags = new Set(thread.tags);
  if (/\b(quote|invoice|fabric|yardage|cushion|order|prestigio|diana|jay)\b/.test(body)) {
    tags.add("prestigio");
  }
  if (/\b(handyman|contractor|estimate|available|appointment|schedule)\b/.test(body)) {
    tags.add("vendor");
  }
  if (/\b(urgent|asap|emergency|today|leak|broken)\b/.test(body)) {
    tags.add("urgent");
  }
  if (/\b(stop|unsubscribe|wrong number)\b/.test(body)) {
    tags.add("do_not_contact");
  }
  const needsReply =
    /[?？]\s*$/.test(body) || /\b(can you|could you|please|available|quote)\b/.test(body);
  const priority = tags.has("urgent")
    ? "high"
    : tags.has("prestigio") || needsReply
      ? "normal"
      : "low";
  const next: TextMailroomThread = {
    ...thread,
    tags: Array.from(tags).sort(),
    priority,
    needsReply,
    summary: summarizeBody(latest?.body ?? thread.summary ?? ""),
    updatedAt: textMailroomNow(options.now),
  };
  await writePrivateJson(threadPath(options.rootDir, thread.threadId), next);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.inbound.classified",
    threadIdHash: hashTextMailroomRecipient(thread.threadId),
    recipientHash: thread.senderHash,
  });
  return next;
}

export async function updateTextMailroomThreadStatus(
  options: TextMailroomStoreOptions,
  params: {
    threadId: string;
    status: TextMailroomThread["status"];
    updatedBy: string;
    reason?: string;
  },
): Promise<TextMailroomThread> {
  const updatedBy = params.updatedBy.trim();
  if (!updatedBy) {
    throw new Error("Text Mailroom thread status update requires updatedBy");
  }
  const thread = await loadRequiredThread(options, params.threadId);
  const reason = params.reason?.trim();
  const next: TextMailroomThread = {
    ...thread,
    status: params.status,
    needsReply: params.status === "open" ? thread.needsReply : false,
    updatedAt: textMailroomNow(options.now),
  };
  await writePrivateJson(threadPath(options.rootDir, thread.threadId), next);
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.inbound.status_updated",
    threadIdHash: hashTextMailroomRecipient(thread.threadId),
    recipientHash: thread.senderHash,
    actor: updatedBy,
    note: reason ? `status=${params.status}; reason=${reason}` : `status=${params.status}`,
  });
  return next;
}

export async function buildTextMailroomDigest(
  options: TextMailroomStoreOptions,
): Promise<TextMailroomDigestItem[]> {
  const threads = await listPrivateJson<TextMailroomThread>(
    textMailroomPaths(options.rootDir).inboxThreads,
  );
  return threads
    .map((thread) => ({
      threadId: thread.threadId,
      senderHash: thread.senderHash,
      status: thread.status,
      tags: thread.tags,
      priority: thread.priority,
      needsReply: thread.needsReply,
      lastInboundAt: thread.lastInboundAt,
      summary: thread.summary,
    }))
    .toSorted((a, b) => (b.lastInboundAt ?? "").localeCompare(a.lastInboundAt ?? ""));
}

export async function findTextMailroomFollowUps(
  options: TextMailroomStoreOptions,
): Promise<TextMailroomOutboundItem[]> {
  const sent = (await listTextMailroomOutboundItems(options)).filter(
    (item) => item.status === "sent",
  );
  const threads = await listPrivateJson<TextMailroomThread>(
    textMailroomPaths(options.rootDir).inboxThreads,
  );
  const due: TextMailroomOutboundItem[] = [];
  const now = options.now?.().getTime() ?? Date.now();
  for (const item of sent) {
    if (!item.campaignId || !item.sent) {
      continue;
    }
    const campaign = await loadTextMailroomCampaign(options, item.campaignId);
    if (!campaign?.followupsAllowed || !campaign.followupAfterMs) {
      continue;
    }
    const sentAt = Date.parse(item.sent.sentAt);
    if (!Number.isFinite(sentAt) || now - sentAt < campaign.followupAfterMs) {
      continue;
    }
    const hasReply = threads.some(
      (thread) =>
        thread.senderHash === item.recipientHash &&
        thread.lastInboundAt &&
        Date.parse(thread.lastInboundAt) > sentAt,
    );
    if (!hasReply) {
      due.push(item);
    }
  }
  return due;
}

export async function queueTextMailroomFollowUps(
  options: TextMailroomStoreOptions,
  params: { requestedBy: string; source?: string },
): Promise<TextMailroomOutboundItem[]> {
  const due = await findTextMailroomFollowUps(options);
  const existing = await listTextMailroomOutboundItems(options);
  const queued: TextMailroomOutboundItem[] = [];
  for (const item of due) {
    const reason = `Follow-up for ${item.id}`;
    const alreadyQueued = existing.some(
      (candidate) =>
        candidate.kind === "follow_up" &&
        candidate.campaignId === item.campaignId &&
        candidate.recipientHash === item.recipientHash &&
        candidate.reason === reason &&
        ["queued", "approved", "sending", "sent"].includes(candidate.status),
    );
    if (alreadyQueued) {
      continue;
    }
    queued.push(
      await proposeTextMailroomOutbound(options, {
        kind: "follow_up",
        recipient: item.recipient,
        body: "Hi, just following up on my previous message. Are you still interested?",
        campaignId: item.campaignId,
        contactId: item.contactId,
        reason,
        source: params.source ?? "text-mailroom-followup",
        risk: item.risk,
        requestedBy: params.requestedBy,
      }),
    );
  }
  return queued;
}

export async function exportPrestigioTextSignals(
  options: TextMailroomStoreOptions,
): Promise<{ count: number; path: string }> {
  await ensureTextMailroomStore(options.rootDir);
  const paths = textMailroomPaths(options.rootDir);
  const threads = await listPrivateJson<TextMailroomThread>(paths.inboxThreads);
  let count = 0;
  for (const thread of threads) {
    if (!thread.tags.includes("prestigio")) {
      continue;
    }
    await appendPrivateNdjson(paths.prestigioSignals, {
      id: textMailroomId("prestigio_signal"),
      at: textMailroomNow(options.now),
      threadId: thread.threadId,
      senderHash: thread.senderHash,
      lastInboundAt: thread.lastInboundAt,
      tags: thread.tags,
      summary: thread.summary,
    });
    count += 1;
  }
  await appendTextMailroomAudit(options, {
    type: "text_mailroom.prestigio.exported",
    note: `signals=${count}`,
  });
  return { count, path: paths.prestigioSignals };
}

export async function loadTextMailroomThread(
  options: TextMailroomStoreOptions,
  threadId: string,
): Promise<TextMailroomThread | null> {
  return readPrivateJson<TextMailroomThread>(threadPath(options.rootDir, threadId));
}

async function loadRequiredThread(
  options: TextMailroomStoreOptions,
  threadId: string,
): Promise<TextMailroomThread> {
  const thread = await loadTextMailroomThread(options, threadId);
  if (!thread) {
    throw new Error("Text Mailroom thread not found");
  }
  return thread;
}

function summarizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 160);
}

function threadPath(rootDir: string, threadId: string): string {
  return path.join(textMailroomPaths(rootDir).inboxThreads, `${safeFileStem(threadId)}.json`);
}
