import { createHash } from "node:crypto";
import path from "node:path";
import type { ResolvedBlueBubblesAccount } from "./accounts.js";
import type { NormalizedWebhookMessage } from "./monitor-normalize.js";
import type { BlueBubblesCoreRuntime, BlueBubblesRuntimeEnv } from "./monitor-shared.js";
import {
  classifyTextMailroomThread,
  exportPrestigioTextSignals,
  recordTextMailroomInbound,
} from "./text-mailroom-inbox.js";

function shortHash(value: string | undefined): string {
  return createHash("sha256")
    .update(value ?? "")
    .digest("hex")
    .slice(0, 12);
}

function resolveTextMailroomRoot(params: {
  core: BlueBubblesCoreRuntime;
  account: ResolvedBlueBubblesAccount;
}): string {
  const configured = params.account.config.textMailroom?.rootDir?.trim();
  if (configured) {
    return configured;
  }
  return path.join(params.core.state.resolveStateDir(), "workspace", "text-mailroom");
}

function resolveThreadPeer(message: NormalizedWebhookMessage, isGroup: boolean): string {
  if (!isGroup) {
    return message.senderId;
  }
  return (
    message.chatGuid?.trim() ||
    message.chatIdentifier?.trim() ||
    (typeof message.chatId === "number" ? `chat_id:${message.chatId}` : "") ||
    `group:${message.senderId}`
  );
}

function buildThreadId(params: {
  account: ResolvedBlueBubblesAccount;
  message: NormalizedWebhookMessage;
  isGroup: boolean;
}): string {
  const peer = resolveThreadPeer(params.message, params.isGroup);
  const digest = createHash("sha256")
    .update(`${params.account.accountId}\0${peer}`)
    .digest("hex")
    .slice(0, 24);
  return `thread_bluebubbles_${digest}`;
}

function formatReceivedAt(timestamp?: number): string | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return undefined;
  }
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function shouldRecordBlueBubblesTextMailroomInbound(params: {
  account: ResolvedBlueBubblesAccount;
  isGroup: boolean;
}): boolean {
  const cfg = params.account.config.textMailroom;
  if (cfg?.enabled !== true) {
    return false;
  }
  if (params.isGroup && cfg.includeGroups !== true) {
    return false;
  }
  return true;
}

export async function recordBlueBubblesTextMailroomInbound(params: {
  core: BlueBubblesCoreRuntime;
  runtime: BlueBubblesRuntimeEnv;
  account: ResolvedBlueBubblesAccount;
  message: NormalizedWebhookMessage;
  isGroup: boolean;
  body: string;
}): Promise<{ rootDir: string; threadId: string } | null> {
  const { account, body, core, isGroup, message, runtime } = params;
  if (!shouldRecordBlueBubblesTextMailroomInbound({ account, isGroup })) {
    return null;
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return null;
  }

  const rootDir = resolveTextMailroomRoot({ core, account });
  const threadId = buildThreadId({ account, message, isGroup });
  try {
    const thread = await recordTextMailroomInbound(
      { rootDir },
      {
        accountId: account.accountId,
        sender: message.senderId,
        body: trimmedBody,
        threadId,
        receivedAt: formatReceivedAt(message.timestamp),
        source: "bluebubbles-webhook",
        providerMessageId: message.messageId
          ? `bluebubbles:${account.accountId}:${message.messageId}`
          : undefined,
      },
    );
    if (account.config.textMailroom?.autoClassify !== false) {
      await classifyTextMailroomThread({ rootDir }, { threadId: thread.threadId });
    }
    if (account.config.textMailroom?.exportPrestigio === true) {
      await exportPrestigioTextSignals({ rootDir });
    }
    return { rootDir, threadId: thread.threadId };
  } catch (error) {
    runtime.error?.(
      `[bluebubbles] text mailroom ingest failed account=${account.accountId} senderHash=${shortHash(
        message.senderId,
      )} bodyLen=${trimmedBody.length} bodyHash=${shortHash(trimmedBody)}: ${String(error)}`,
    );
    return null;
  }
}
