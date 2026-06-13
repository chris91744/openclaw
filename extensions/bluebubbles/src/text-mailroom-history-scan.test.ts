import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueBubblesHistoryMessage } from "./history-read.js";
import {
  buildTextMailroomHistoryScanPlan,
  importTextMailroomHistoryScan,
  summarizeTextMailroomHistoryScanPlan,
} from "./text-mailroom-history-scan.js";
import { buildTextMailroomDigest, loadTextMailroomThread } from "./text-mailroom-inbox.js";

const roots: string[] = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "text-mailroom-history-"));
  roots.push(root);
  return root;
}

function msg(
  providerMessageId: string,
  overrides: Partial<BlueBubblesHistoryMessage> = {},
): BlueBubblesHistoryMessage {
  const timestampMs = overrides.timestampMs ?? Date.parse("2026-06-12T10:00:00.000Z");
  return {
    providerMessageId,
    threadId: overrides.threadId ?? "thread_bluebubbles_fixture",
    providerThreadId: overrides.providerThreadId ?? "SMS;-;+15551234567",
    handle: overrides.handle ?? "+15551234567",
    handleHash: overrides.handleHash ?? "sender-hash",
    direction: overrides.direction ?? "inbound",
    timestampMs,
    receivedAt: new Date(timestampMs).toISOString(),
    body: overrides.body ?? "Can you send an estimate?",
    bodyHash: overrides.bodyHash ?? `body-hash-${providerMessageId}`,
    service: overrides.service ?? "sms",
    isGroup: overrides.isGroup ?? false,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Text Mailroom history scan", () => {
  it("detects_unresolved_last_inbound_threads_without_raw_summary_bytes", () => {
    const plan = buildTextMailroomHistoryScanPlan({
      messages: [
        msg("inbound-1", { body: "Can you mount the TV tomorrow?" }),
        msg("outbound-1", {
          threadId: "thread_bluebubbles_replied",
          direction: "outbound",
          body: "Already replied",
        }),
        msg("group-1", { threadId: "thread_bluebubbles_group", isGroup: true }),
        msg("stop-1", { threadId: "thread_bluebubbles_stop", body: "Stop texting me" }),
      ],
      sinceMs: Date.parse("2026-06-01T00:00:00.000Z"),
      untilMs: Date.parse("2026-06-15T00:00:00.000Z"),
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });
    const summary = summarizeTextMailroomHistoryScanPlan(plan);
    const serialized = JSON.stringify(summary);

    expect(summary.candidates).toHaveLength(1);
    expect(summary.candidates[0]).toMatchObject({
      threadId: "thread_bluebubbles_fixture",
      reasons: ["question_or_request", "scheduling", "vendor_work"],
      tags: ["scheduling", "vendor"],
      priority: "normal",
    });
    expect(summary.skipped.groups).toBe(1);
    expect(summary.skipped.lastOutbound).toBe(1);
    expect(summary.skipped.doNotContact).toBe(1);
    expect(serialized).not.toContain("+15551234567");
    expect(serialized).not.toContain("mount the TV");
  });

  it("skips_recent_inbound_messages", () => {
    const plan = buildTextMailroomHistoryScanPlan({
      messages: [msg("fresh-1", { timestampMs: Date.parse("2026-06-12T11:45:00.000Z") })],
      sinceMs: Date.parse("2026-06-01T00:00:00.000Z"),
      untilMs: Date.parse("2026-06-15T00:00:00.000Z"),
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });

    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped.tooRecent).toBe(1);
  });

  it("imports_candidates_once_and_marks_them_as_history_scan", async () => {
    const rootDir = await makeRoot();
    const plan = buildTextMailroomHistoryScanPlan({
      messages: [msg("history-guid-1", { body: "Can you send the quote today?" })],
      sinceMs: Date.parse("2026-06-01T00:00:00.000Z"),
      untilMs: Date.parse("2026-06-15T00:00:00.000Z"),
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    });

    const first = await importTextMailroomHistoryScan({ rootDir }, plan);
    const second = await importTextMailroomHistoryScan({ rootDir }, plan);
    const thread = await loadTextMailroomThread({ rootDir }, "thread_bluebubbles_fixture");
    const digest = await buildTextMailroomDigest({ rootDir });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.alreadyImported).toBe(1);
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0]).toMatchObject({
      source: "history-scan",
      providerMessageId: "bluebubbles-history:history-guid-1",
    });
    expect(digest[0]).toMatchObject({
      threadId: "thread_bluebubbles_fixture",
      needsReply: true,
    });
  });

  it("history_scan_imports_no_outbound_modules_or_gates", async () => {
    const sourcePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "text-mailroom-history-scan.ts",
    );
    const source = await fs.readFile(sourcePath, "utf8");

    expect(source).not.toMatch(
      /from\s+["']\.\/(?:send|media-send|attachments|reactions|channel|chat|text-mailroom-outbound)\.js["']/,
    );
    expect(source).not.toContain("sendApprovedTextMailroomOutbound");
    expect(source).not.toContain("proposeTextMailroomOutbound");
    expect(source).not.toContain("OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED");
    expect(source).not.toContain("OPENCLAW_TEXT_MAILROOM_SEND_OPTIN");
    expect(source).not.toContain("OPENCLAW_IMESSAGE_SEND_OPTIN");
  });
});
