import {
  hashTextMailroomBody,
  hashTextMailroomRecipient,
  textMailroomSha256,
} from "./text-mailroom-types.js";
import { buildBlueBubblesApiUrl, blueBubblesFetchWithTimeout } from "./types.js";

type BlueBubblesFetch = (
  url: string,
  init: RequestInit,
  timeoutMs?: number,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

type RawRecord = Record<string, unknown>;

export type BlueBubblesHistoryMessage = {
  providerMessageId: string;
  threadId: string;
  providerThreadId: string;
  handle: string;
  handleHash: string;
  direction: "inbound" | "outbound";
  timestampMs: number;
  receivedAt: string;
  body: string;
  bodyHash: string;
  service?: string;
  isGroup: boolean;
};

export type BlueBubblesHistoryQuery = {
  baseUrl: string;
  password: string;
  sinceMs: number;
  untilMs: number;
  limit?: number;
  maxMessages?: number;
  dmOnly?: boolean;
  timeoutMs?: number;
  fetcher?: BlueBubblesFetch;
};

export type BlueBubblesHistoryProbe = {
  ok: boolean;
  endpoint: "/api/v1/message/query";
  method: "POST";
  status?: number;
  returnedCount: number;
  normalizedCount: number;
  topLevelKeys: string[];
  dataShape: "array" | "object" | "missing";
  error?: string;
};

export async function queryBlueBubblesMessageHistory(
  params: BlueBubblesHistoryQuery,
): Promise<BlueBubblesHistoryMessage[]> {
  validateWindow(params.sinceMs, params.untilMs);
  const fetcher = params.fetcher ?? blueBubblesFetchWithTimeout;
  const limit = clampInt(params.limit ?? 200, 1, 500);
  const maxMessages = clampInt(params.maxMessages ?? 1000, 1, 10_000);
  const messages: BlueBubblesHistoryMessage[] = [];
  for (let offset = 0; offset < maxMessages; offset += limit) {
    const payload = await queryMessagePage({
      ...params,
      fetcher,
      limit: Math.min(limit, maxMessages - offset),
      offset,
    });
    const raw = extractPayloadRows(payload.body);
    for (const row of raw) {
      const normalized = normalizeBlueBubblesHistoryMessage(row);
      if (!normalized) {
        continue;
      }
      if (params.dmOnly !== false && normalized.isGroup) {
        continue;
      }
      if (normalized.timestampMs < params.sinceMs || normalized.timestampMs > params.untilMs) {
        continue;
      }
      messages.push(normalized);
    }
    if (raw.length < limit) {
      break;
    }
  }
  return messages.toSorted((a, b) => a.timestampMs - b.timestampMs);
}

export async function probeBlueBubblesMessageHistory(
  params: Omit<BlueBubblesHistoryQuery, "maxMessages" | "limit">,
): Promise<BlueBubblesHistoryProbe> {
  try {
    validateWindow(params.sinceMs, params.untilMs);
    const payload = await queryMessagePage({
      ...params,
      fetcher: params.fetcher ?? blueBubblesFetchWithTimeout,
      limit: 1,
      offset: 0,
    });
    const rows = extractPayloadRows(payload.body);
    return {
      ok: true,
      endpoint: "/api/v1/message/query",
      method: "POST",
      status: payload.status,
      returnedCount: rows.length,
      normalizedCount: rows.map(normalizeBlueBubblesHistoryMessage).filter(Boolean).length,
      topLevelKeys: topLevelKeys(payload.body),
      dataShape: payloadShape(payload.body),
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: "/api/v1/message/query",
      method: "POST",
      returnedCount: 0,
      normalizedCount: 0,
      topLevelKeys: [],
      dataShape: "missing",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function queryMessagePage(
  params: BlueBubblesHistoryQuery & { fetcher: BlueBubblesFetch; limit: number; offset: number },
): Promise<{ status: number; body: unknown }> {
  const url = buildBlueBubblesApiUrl({
    baseUrl: params.baseUrl,
    path: "/api/v1/message/query",
    password: params.password,
  });
  const res = await params.fetcher(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: params.limit,
        offset: params.offset,
        startDate: new Date(params.sinceMs).toISOString(),
        endDate: new Date(params.untilMs).toISOString(),
        with: ["chat", "handle"],
      }),
    },
    params.timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`BlueBubbles history query failed: HTTP ${res.status}`);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export function normalizeBlueBubblesHistoryMessage(
  record: unknown,
): BlueBubblesHistoryMessage | null {
  const row = asRecord(record);
  if (!row) {
    return null;
  }
  const body = firstString(row, ["text", "body", "message", "content", "plainText"]);
  if (!body?.trim()) {
    return null;
  }
  const timestampMs = extractTimestampMs(row);
  if (timestampMs === null) {
    return null;
  }
  const chat = asRecord(row.chat);
  const handleRecord = asRecord(row.handle);
  const chatGuid =
    firstString(row, ["chatGuid", "chat_guid", "chatIdentifier", "chat_identifier"]) ??
    firstString(chat, ["guid", "chatGuid", "chat_guid", "identifier"]);
  const handle =
    firstString(row, ["handle", "address", "sender", "from", "to", "destination"]) ??
    firstString(handleRecord, ["address", "handle", "id", "identifier", "originalAddress"]) ??
    extractHandleFromChatGuid(chatGuid) ??
    "unknown";
  const providerThreadId = chatGuid ?? handle;
  const providerMessageId =
    firstString(row, ["guid", "messageGuid", "message_guid", "id", "ROWID", "rowid"]) ??
    `${providerThreadId}:${timestampMs}:${textMailroomSha256(body).slice(0, 16)}`;
  const isGroup = extractIsGroup(row, chat);
  return {
    providerMessageId,
    threadId: `thread_bluebubbles_${textMailroomSha256(providerThreadId).slice(0, 24)}`,
    providerThreadId,
    handle,
    handleHash: hashTextMailroomRecipient(handle),
    direction: extractDirection(row),
    timestampMs,
    receivedAt: new Date(timestampMs).toISOString(),
    body: body.trim(),
    bodyHash: hashTextMailroomBody(body),
    service: firstString(row, ["service", "itemType"])?.toLowerCase(),
    isGroup,
  };
}

function extractPayloadRows(payload: unknown): RawRecord[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const data = root.data;
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  const dataRecord = asRecord(data);
  for (const key of ["messages", "items", "results"]) {
    const value = dataRecord?.[key] ?? root[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function topLevelKeys(payload: unknown): string[] {
  return Object.keys(asRecord(payload) ?? {}).sort();
}

function payloadShape(payload: unknown): BlueBubblesHistoryProbe["dataShape"] {
  const data = asRecord(payload)?.data;
  if (Array.isArray(data)) {
    return "array";
  }
  if (data && typeof data === "object") {
    return "object";
  }
  return "missing";
}

function extractTimestampMs(row: RawRecord): number | null {
  const value =
    row.dateCreated ??
    row.date_created ??
    row.createdAt ??
    row.created_at ??
    row.timestamp ??
    row.date ??
    row.time;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value > 1_000_000_000_000_000) {
    return Math.round(value / 1_000_000);
  }
  if (value < 10_000_000_000) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

function extractDirection(row: RawRecord): BlueBubblesHistoryMessage["direction"] {
  const fromMe = row.isFromMe ?? row.is_from_me ?? row.fromMe ?? row.from_me;
  if (fromMe === true || fromMe === 1 || fromMe === "1" || fromMe === "true") {
    return "outbound";
  }
  const direction = firstString(row, ["direction", "type"])?.toLowerCase();
  return direction === "outbound" || direction === "sent" ? "outbound" : "inbound";
}

function extractIsGroup(row: RawRecord, chat?: RawRecord): boolean {
  const explicit =
    row.isGroup ??
    row.is_group ??
    row.group ??
    row.groupChat ??
    chat?.isGroup ??
    chat?.is_group ??
    chat?.group ??
    chat?.groupChat;
  if (explicit === true || explicit === 1 || explicit === "1" || explicit === "true") {
    return true;
  }
  const participants = row.participants ?? chat?.participants ?? chat?.handles;
  return Array.isArray(participants) && participants.length > 1;
}

function extractHandleFromChatGuid(chatGuid?: string): string | null {
  const parts = chatGuid?.split(";") ?? [];
  const identifier = parts.at(-1)?.trim();
  return identifier || null;
}

function firstString(record: RawRecord | undefined, keys: string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function validateWindow(sinceMs: number, untilMs: number): void {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || sinceMs >= untilMs) {
    throw new Error("BlueBubbles history query requires a valid time window");
  }
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.floor(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.min(max, Math.max(min, rounded));
}

function asRecord(value: unknown): RawRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
