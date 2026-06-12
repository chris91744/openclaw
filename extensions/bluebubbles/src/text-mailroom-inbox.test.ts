import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTextMailroomDigest,
  classifyTextMailroomThread,
  exportPrestigioTextSignals,
  findTextMailroomFollowUps,
  queueTextMailroomFollowUps,
  recordTextMailroomInbound,
} from "./text-mailroom-inbox.js";
import {
  approveTextMailroomOutbound,
  authorizeTextMailroomCampaign,
  sendApprovedTextMailroomOutbound,
  proposeTextMailroomOutbound,
} from "./text-mailroom-outbound.js";
import { TEXT_MAILROOM_SEND_OPTIN_ENV } from "./text-mailroom-types.js";

const roots: string[] = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "text-mailroom-inbox-"));
  roots.push(root);
  return root;
}

describe("Text Mailroom inbox, follow-ups, and integration signals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T09:00:00.000Z"));
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("classifies_inbound_threads_and_exports_prestigio_signals_without_raw_phone_numbers", async () => {
    const rootDir = await makeRoot();
    const thread = await recordTextMailroomInbound(
      { rootDir },
      {
        sender: "+15551234567",
        body: "Can you send a Prestigio quote for the cushion fabric today?",
        threadId: "client-thread",
        source: "bluebubbles",
      },
    );

    const classified = await classifyTextMailroomThread({ rootDir }, { threadId: thread.threadId });
    const digest = await buildTextMailroomDigest({ rootDir });
    const exported = await exportPrestigioTextSignals({ rootDir });
    const signal = await fs.readFile(exported.path, "utf8");

    expect(classified.tags).toContain("prestigio");
    expect(classified.tags).toContain("urgent");
    expect(classified.needsReply).toBe(true);
    expect(digest[0]).toMatchObject({
      threadId: "client-thread",
      needsReply: true,
      priority: "high",
    });
    expect(exported.count).toBe(1);
    expect(signal).toContain("prestigio");
    expect(signal).not.toContain("+15551234567");
  });

  it("detects_and_dedupes_campaign_followups_when_no_reply_arrived", async () => {
    const rootDir = await makeRoot();
    const sender = vi.fn(async () => ({ messageId: "msg-1" }));
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Handyman outreach",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567"],
        maxSends: 3,
        followupsAllowed: true,
        followupAfterMs: 60 * 60 * 1000,
      },
    );
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15551234567",
        body: "Hi, are you available?",
        campaignId: campaign.campaignId,
        reason: "initial outreach",
        source: "craigslist",
      },
    );
    await approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" });
    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id });

    vi.setSystemTime(new Date("2026-06-12T11:00:00.000Z"));
    expect(await findTextMailroomFollowUps({ rootDir })).toHaveLength(1);
    expect(await queueTextMailroomFollowUps({ rootDir }, { requestedBy: "agent" })).toHaveLength(1);
    expect(await queueTextMailroomFollowUps({ rootDir }, { requestedBy: "agent" })).toHaveLength(0);
  });

  it("does_not_follow_up_after_later_inbound_reply", async () => {
    const rootDir = await makeRoot();
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Handyman outreach",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567"],
        maxSends: 3,
        followupsAllowed: true,
        followupAfterMs: 60 * 60 * 1000,
      },
    );
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15551234567",
        body: "Hi, are you available?",
        campaignId: campaign.campaignId,
        reason: "initial outreach",
        source: "craigslist",
      },
    );
    await approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" });
    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await sendApprovedTextMailroomOutbound(
      { rootDir, sender: async () => ({ messageId: "msg-1" }) },
      { itemId: item.id },
    );
    await recordTextMailroomInbound(
      { rootDir, now: () => new Date("2026-06-12T10:30:00.000Z") },
      {
        sender: "+15551234567",
        body: "Yes, I can come by tomorrow.",
        receivedAt: "2026-06-12T10:30:00.000Z",
      },
    );

    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    expect(await findTextMailroomFollowUps({ rootDir })).toHaveLength(0);
  });
});
