import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeBlueBubblesHistoryMessage,
  probeBlueBubblesMessageHistory,
  queryBlueBubblesMessageHistory,
} from "./history-read.js";

const sinceMs = Date.parse("2026-06-01T00:00:00.000Z");
const untilMs = Date.parse("2026-06-15T00:00:00.000Z");

function response(payload: unknown, status = 200): Pick<Response, "ok" | "status" | "json"> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe("BlueBubbles history reader", () => {
  it("queries_only_the_read_history_endpoint_and_redacts_normalized_metadata", async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: [
          {
            guid: "msg-1",
            text: "Secret loose thread body?",
            isFromMe: false,
            dateCreated: "2026-06-12T10:00:00.000Z",
            service: "SMS",
            handle: { address: "+15551234567" },
            chat: { guid: "SMS;-;+15551234567", isGroup: false },
          },
        ],
      }),
    );

    const messages = await queryBlueBubblesMessageHistory({
      baseUrl: "http://bluebubbles.local:1234",
      password: "secret-password",
      sinceMs,
      untilMs,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/message/query");
    expect(String(url)).not.toContain("Secret loose thread body");
    expect(init.method).toBe("POST");
    expect(String(init.body)).not.toContain("Secret loose thread body");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      providerMessageId: "msg-1",
      direction: "inbound",
      service: "sms",
      isGroup: false,
    });
    expect(messages[0]?.handleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(messages[0]?.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("filters_groups_and_out_of_window_messages_while_including_sms_unsaved_handles", async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: [
          {
            guid: "sms-unsaved",
            body: "Can you call me?",
            is_from_me: false,
            timestamp: "2026-06-12T10:00:00.000Z",
            handle: { address: "+15557654321" },
            chat: { guid: "SMS;-;+15557654321" },
          },
          {
            guid: "group-message",
            body: "Group text",
            is_from_me: false,
            timestamp: "2026-06-12T11:00:00.000Z",
            handle: { address: "+15550000000" },
            chat: { guid: "iMessage;-;group", isGroup: true },
          },
          {
            guid: "old-message",
            body: "Old text",
            is_from_me: false,
            timestamp: "2026-05-12T11:00:00.000Z",
            handle: { address: "+15551111111" },
            chat: { guid: "SMS;-;+15551111111" },
          },
        ],
      }),
    );

    const messages = await queryBlueBubblesMessageHistory({
      baseUrl: "http://bluebubbles.local:1234",
      password: "secret-password",
      sinceMs,
      untilMs,
      fetcher,
    });

    expect(messages.map((message) => message.providerMessageId)).toEqual(["sms-unsaved"]);
    expect(messages[0]?.service).toBeUndefined();
    expect(messages[0]?.handleHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("paginates_until_a_short_page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [
            {
              guid: "msg-1",
              body: "First?",
              isFromMe: false,
              timestamp: "2026-06-12T10:00:00.000Z",
              handle: "+15551234567",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              guid: "msg-2",
              body: "Second?",
              isFromMe: false,
              timestamp: "2026-06-12T10:05:00.000Z",
              handle: "+15551234567",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ data: [] }));

    const messages = await queryBlueBubblesMessageHistory({
      baseUrl: "http://bluebubbles.local:1234",
      password: "secret-password",
      sinceMs,
      untilMs,
      limit: 1,
      maxMessages: 3,
      fetcher,
    });

    expect(messages.map((message) => message.providerMessageId)).toEqual(["msg-1", "msg-2"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("probe_reports_shape_without_phone_or_body_bytes", async () => {
    const probe = await probeBlueBubblesMessageHistory({
      baseUrl: "http://bluebubbles.local:1234",
      password: "secret-password",
      sinceMs,
      untilMs,
      fetcher: async () =>
        response({
          data: [
            {
              guid: "msg-1",
              body: "Secret probe body?",
              isFromMe: false,
              timestamp: "2026-06-12T10:00:00.000Z",
              handle: "+15551234567",
            },
          ],
        }),
    });

    const serialized = JSON.stringify(probe);
    expect(probe).toMatchObject({
      ok: true,
      endpoint: "/api/v1/message/query",
      method: "POST",
      returnedCount: 1,
      normalizedCount: 1,
      dataShape: "array",
    });
    expect(serialized).not.toContain("+15551234567");
    expect(serialized).not.toContain("Secret probe body");
  });

  it("normalizes_missing_handles_from_chat_guid_and_generates_stable_ids", () => {
    const message = normalizeBlueBubblesHistoryMessage({
      text: "Can you send the estimate?",
      isFromMe: false,
      dateCreated: "2026-06-12T10:00:00.000Z",
      chat: { guid: "SMS;-;+15551234567" },
    });

    expect(message).toMatchObject({
      handle: "+15551234567",
      direction: "inbound",
      isGroup: false,
    });
    expect(message?.providerMessageId).toMatch(/^SMS;-;\+15551234567:/);
    expect(message?.threadId).toMatch(/^thread_bluebubbles_/);
  });

  it("history_reader_imports_no_outbound_modules_or_gates", async () => {
    const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "history-read.ts");
    const source = await fs.readFile(sourcePath, "utf8");

    expect(source).not.toMatch(
      /from\s+["']\.\/(?:send|media-send|attachments|reactions|channel|chat)\.js["']/,
    );
    expect(source).not.toContain("assertBlueBubblesOutboundEnabled");
    expect(source).not.toContain("OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED");
    expect(source).not.toContain("OPENCLAW_TEXT_MAILROOM_SEND_OPTIN");
    expect(source).not.toContain("OPENCLAW_IMESSAGE_SEND_OPTIN");
  });
});
