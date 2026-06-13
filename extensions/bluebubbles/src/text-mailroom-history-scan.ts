import type { BlueBubblesHistoryMessage } from "./history-read.js";
import type { TextMailroomStoreOptions } from "./text-mailroom-store.js";
import type { TextMailroomThread } from "./text-mailroom-types.js";
import {
  classifyTextMailroomThread,
  loadTextMailroomThread,
  recordTextMailroomInbound,
} from "./text-mailroom-inbox.js";

export type TextMailroomHistoryScanCandidate = {
  threadId: string;
  providerMessageId: string;
  sender: string;
  senderHash: string;
  receivedAt: string;
  body: string;
  bodyHash: string;
  reasons: string[];
  tags: string[];
  priority: TextMailroomThread["priority"];
  messageCount: number;
};

export type TextMailroomHistoryScanPlan = {
  mode: "dry-run" | "apply";
  source: "bluebubbles-history";
  since: string;
  until: string;
  dmOnly: boolean;
  scannedMessages: number;
  scannedThreads: number;
  candidates: TextMailroomHistoryScanCandidate[];
  skipped: {
    groups: number;
    lastOutbound: number;
    noSignal: number;
    tooRecent: number;
    doNotContact: number;
  };
};

export type TextMailroomHistoryScanSummary = Omit<TextMailroomHistoryScanPlan, "candidates"> & {
  candidates: Array<{
    threadId: string;
    senderHash: string;
    receivedAt: string;
    bodyHash: string;
    reasons: string[];
    tags: string[];
    priority: TextMailroomThread["priority"];
    messageCount: number;
  }>;
};

export type TextMailroomHistoryImportSummary = TextMailroomHistoryScanSummary & {
  imported: number;
  alreadyImported: number;
  skippedExistingClosed: number;
  skippedDoNotContact: number;
};

export function buildTextMailroomHistoryScanPlan(params: {
  messages: BlueBubblesHistoryMessage[];
  sinceMs: number;
  untilMs: number;
  now?: () => Date;
  dmOnly?: boolean;
  minReplyAgeMs?: number;
  maxCandidates?: number;
}): TextMailroomHistoryScanPlan {
  const dmOnly = params.dmOnly !== false;
  const minReplyAgeMs = params.minReplyAgeMs ?? 60 * 60 * 1000;
  const nowMs = params.now?.().getTime() ?? Date.now();
  const grouped = new Map<string, BlueBubblesHistoryMessage[]>();
  const skipped = {
    groups: 0,
    lastOutbound: 0,
    noSignal: 0,
    tooRecent: 0,
    doNotContact: 0,
  };
  for (const message of params.messages) {
    if (dmOnly && message.isGroup) {
      skipped.groups += 1;
      continue;
    }
    const thread = grouped.get(message.threadId) ?? [];
    thread.push(message);
    grouped.set(message.threadId, thread);
  }

  const candidates: TextMailroomHistoryScanCandidate[] = [];
  for (const [threadId, messages] of grouped) {
    const sorted = messages.toSorted((a, b) => a.timestampMs - b.timestampMs);
    const latest = sorted.at(-1);
    if (!latest) {
      continue;
    }
    if (latest.direction !== "inbound") {
      skipped.lastOutbound += 1;
      continue;
    }
    if (nowMs - latest.timestampMs < minReplyAgeMs) {
      skipped.tooRecent += 1;
      continue;
    }
    const signal = classifyLooseThreadBody(latest.body);
    if (signal.tags.includes("do_not_contact")) {
      skipped.doNotContact += 1;
      continue;
    }
    if (signal.reasons.length === 0) {
      skipped.noSignal += 1;
      continue;
    }
    candidates.push({
      threadId,
      providerMessageId: latest.providerMessageId,
      sender: latest.handle,
      senderHash: latest.handleHash,
      receivedAt: latest.receivedAt,
      body: latest.body,
      bodyHash: latest.bodyHash,
      reasons: signal.reasons,
      tags: signal.tags,
      priority: signal.priority,
      messageCount: sorted.length,
    });
  }

  return {
    mode: "dry-run",
    source: "bluebubbles-history",
    since: new Date(params.sinceMs).toISOString(),
    until: new Date(params.untilMs).toISOString(),
    dmOnly,
    scannedMessages: params.messages.length,
    scannedThreads: grouped.size,
    candidates: candidates
      .toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, params.maxCandidates ?? 50),
    skipped,
  };
}

export async function importTextMailroomHistoryScan(
  options: TextMailroomStoreOptions,
  plan: TextMailroomHistoryScanPlan,
): Promise<TextMailroomHistoryImportSummary> {
  let imported = 0;
  let alreadyImported = 0;
  let skippedExistingClosed = 0;
  let skippedDoNotContact = 0;

  for (const candidate of plan.candidates) {
    const existing = await loadTextMailroomThread(options, candidate.threadId);
    if (existing?.status === "closed" || existing?.status === "held") {
      skippedExistingClosed += 1;
      continue;
    }
    if (existing?.tags.includes("do_not_contact") || candidate.tags.includes("do_not_contact")) {
      skippedDoNotContact += 1;
      continue;
    }
    if (
      existing?.messages.some(
        (message) =>
          message.providerMessageId === `bluebubbles-history:${candidate.providerMessageId}`,
      )
    ) {
      alreadyImported += 1;
      continue;
    }
    await recordTextMailroomInbound(options, {
      sender: candidate.sender,
      body: candidate.body,
      threadId: candidate.threadId,
      receivedAt: candidate.receivedAt,
      source: "history-scan",
      providerMessageId: `bluebubbles-history:${candidate.providerMessageId}`,
    });
    await classifyTextMailroomThread(options, { threadId: candidate.threadId });
    imported += 1;
  }

  return {
    ...summarizeTextMailroomHistoryScanPlan({ ...plan, mode: "apply" }),
    imported,
    alreadyImported,
    skippedExistingClosed,
    skippedDoNotContact,
  };
}

export function summarizeTextMailroomHistoryScanPlan(
  plan: TextMailroomHistoryScanPlan,
): TextMailroomHistoryScanSummary {
  return {
    ...plan,
    candidates: plan.candidates.map((candidate) => ({
      threadId: candidate.threadId,
      senderHash: candidate.senderHash,
      receivedAt: candidate.receivedAt,
      bodyHash: candidate.bodyHash,
      reasons: candidate.reasons,
      tags: candidate.tags,
      priority: candidate.priority,
      messageCount: candidate.messageCount,
    })),
  };
}

function classifyLooseThreadBody(body: string): {
  reasons: string[];
  tags: string[];
  priority: TextMailroomThread["priority"];
} {
  const text = body.toLowerCase();
  const reasons = new Set<string>();
  const tags = new Set<string>();
  if (
    /[?？]\s*$/.test(text) ||
    /\b(can you|could you|would you|are you|do you|please)\b/.test(text)
  ) {
    reasons.add("question_or_request");
  }
  if (
    /\b(available|availability|appointment|schedule|tomorrow|today|time|meet|come by)\b/.test(text)
  ) {
    reasons.add("scheduling");
    tags.add("scheduling");
  }
  if (/\b(quote|estimate|invoice|payment|paid|price|cost|deposit)\b/.test(text)) {
    reasons.add("business_followup");
    tags.add("business");
  }
  if (
    /\b(handyman|contractor|repair|install|mount|seal|window|door|cockroach|roaches)\b/.test(text)
  ) {
    reasons.add("vendor_work");
    tags.add("vendor");
  }
  if (/\b(prestigio|fabric|yardage|cushion|chair|sofa|diana|jay)\b/.test(text)) {
    reasons.add("prestigio");
    tags.add("prestigio");
  }
  if (/\b(urgent|asap|emergency|leak|broken|immediately)\b/.test(text)) {
    reasons.add("urgent_language");
    tags.add("urgent");
  }
  if (/\b(stop|unsubscribe|wrong number)\b/.test(text)) {
    tags.add("do_not_contact");
  }
  return {
    reasons: Array.from(reasons).sort(),
    tags: Array.from(tags).sort(),
    priority: tags.has("urgent")
      ? "high"
      : tags.has("prestigio") || reasons.has("question_or_request")
        ? "normal"
        : "low",
  };
}
