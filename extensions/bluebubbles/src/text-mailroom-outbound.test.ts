import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveTextMailroomOutbound,
  authorizeTextMailroomCampaign,
  listTextMailroomOutboundItems,
  proposeTextMailroomOutbound,
  rejectTextMailroomOutbound,
  sendApprovedTextMailroomOutbound,
  upsertTextMailroomContact,
} from "./text-mailroom-outbound.js";
import { safeFileStem, textMailroomPaths, writePrivateJson } from "./text-mailroom-store.js";
import {
  TEXT_MAILROOM_SEND_OPTIN_ENV,
  type TextMailroomOutboundItem,
} from "./text-mailroom-types.js";

const roots: string[] = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "text-mailroom-outbound-"));
  roots.push(root);
  return root;
}

async function mode(filePath: string) {
  return (await fs.stat(filePath)).mode & 0o777;
}

describe("Text Mailroom outbound approvals", () => {
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

  it("queues_campaign_outreach_only_inside_authorized_campaign_boundaries", async () => {
    const rootDir = await makeRoot();
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Handyman outreach",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567"],
        maxSends: 1,
      },
    );

    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+1 (555) 123-4567",
        body: "Hi, are you available for a small job?",
        campaignId: campaign.campaignId,
        reason: "authorized handyman campaign",
        source: "craigslist-research",
      },
    );

    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "campaign_outreach",
          recipient: "+15557654321",
          body: "Hi",
          campaignId: campaign.campaignId,
          reason: "outside campaign",
          source: "test",
        },
      ),
    ).rejects.toThrow("does not allow this recipient");
    expect(item.status).toBe("queued");
    expect(item.bodyHash).toHaveLength(64);
    expect(item.recipientHash).toHaveLength(64);
  });

  it("refuses_to_queue_blocked_contacts", async () => {
    const rootDir = await makeRoot();
    await upsertTextMailroomContact(
      { rootDir },
      { phone: "+15551234567", labels: ["blocked"], source: "manual" },
    );

    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15551234567",
          body: "hello",
          reason: "test",
          source: "agent",
        },
      ),
    ).rejects.toThrow("blocked contacts");
  });

  it("requires_approval_and_two_opt_in_flags_before_sender_can_run", async () => {
    const rootDir = await makeRoot();
    const sender = vi.fn(async () => ({ messageId: "msg-1" }));
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "hello",
        reason: "manual test",
        source: "agent",
      },
    );

    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id }),
    ).rejects.toThrow(TEXT_MAILROOM_SEND_OPTIN_ENV);
    expect(sender).not.toHaveBeenCalled();

    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id }),
    ).rejects.toThrow("must be approved");
    expect(sender).not.toHaveBeenCalled();

    await approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" });
    const sent = await sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id });

    expect(sent.status).toBe("sent");
    expect(sent.sent?.messageId).toBe("msg-1");
    expect(sender).toHaveBeenCalledWith({
      to: "+15551234567",
      body: "hello",
      accountId: undefined,
      cfg: undefined,
    });
  });

  it("fails_closed_when_body_changes_after_approval", async () => {
    const rootDir = await makeRoot();
    const sender = vi.fn(async () => ({ messageId: "msg-1" }));
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "approved body",
        reason: "manual test",
        source: "agent",
      },
    );
    const approved = await approveTextMailroomOutbound(
      { rootDir },
      { itemId: item.id, approvedBy: "Chris" },
    );
    const tampered: TextMailroomOutboundItem = { ...approved, body: "changed after approval" };
    await writePrivateJson(
      path.join(textMailroomPaths(rootDir).outboundItems, `${safeFileStem(item.id)}.json`),
      tampered,
    );

    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id }),
    ).rejects.toThrow("body hash mismatch");
    expect(sender).not.toHaveBeenCalled();
  });

  it("fails_closed_when_approval_is_stale", async () => {
    const rootDir = await makeRoot();
    const sender = vi.fn(async () => ({ messageId: "msg-1" }));
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "hello",
        reason: "manual test",
        source: "agent",
      },
    );
    await approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" });

    vi.setSystemTime(new Date("2026-06-12T20:00:00.000Z"));
    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id }),
    ).rejects.toThrow("approval is stale");
    expect(sender).not.toHaveBeenCalled();
  });

  it("claims_approved_items_so_concurrent_senders_do_not_duplicate_transport_calls", async () => {
    const rootDir = await makeRoot();
    let releaseSender: ((value: { messageId: string }) => void) | undefined;
    const sender = vi.fn(
      () =>
        new Promise<{ messageId: string }>((resolve) => {
          releaseSender = resolve;
        }),
    );
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "hello",
        reason: "manual test",
        source: "agent",
      },
    );
    await approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" });

    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    const first = sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id });
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: item.id }),
    ).rejects.toThrow("already claimed");
    releaseSender?.({ messageId: "msg-1" });
    await expect(first).resolves.toMatchObject({ status: "sent" });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("rejects_items_and_preserves_private_store_permissions", async () => {
    const rootDir = await makeRoot();
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "hello",
        reason: "manual test",
        source: "agent",
      },
    );
    const rejected = await rejectTextMailroomOutbound(
      { rootDir },
      { itemId: item.id, rejectedBy: "Chris", reason: "not now" },
    );

    expect(rejected.status).toBe("rejected");
    expect(await mode(textMailroomPaths(rootDir).outboundItems)).toBe(0o700);
    expect(await mode(textMailroomPaths(rootDir).auditDir)).toBe(0o700);
    const audit = await fs.readFile(textMailroomPaths(rootDir).auditEvents, "utf8");
    expect(audit).toContain("text_mailroom.outbound.rejected");
    expect(audit).not.toContain("+15551234567");
    expect(audit).not.toContain("hello");
    expect(await listTextMailroomOutboundItems({ rootDir })).toHaveLength(1);
  });
});
