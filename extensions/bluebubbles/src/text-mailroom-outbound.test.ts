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

  it("infers_risk_from_contact_labels_and_message_kind", async () => {
    const rootDir = await makeRoot();
    await upsertTextMailroomContact(
      { rootDir },
      { phone: "+15551234567", labels: ["vendor"], source: "manual" },
    );
    await upsertTextMailroomContact(
      { rootDir },
      { phone: "+15557654321", labels: ["lead"], source: "manual" },
    );

    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15550000000",
          body: "raw number",
          reason: "unknown recipient",
          source: "agent",
        },
      ),
    ).resolves.toMatchObject({ risk: "high" });
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15551234567",
          body: "known vendor",
          reason: "known vendor recipient",
          source: "agent",
        },
      ),
    ).resolves.toMatchObject({ risk: "low" });
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15557654321",
          body: "lead",
          reason: "lead recipient",
          source: "agent",
        },
      ),
    ).resolves.toMatchObject({ risk: "medium" });
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15550000000",
          body: "downgrade blocked",
          reason: "explicit low risk cannot downgrade unknown recipient",
          source: "agent",
          risk: "low",
        },
      ),
    ).resolves.toMatchObject({ risk: "high" });
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15551234567",
          body: "upgrade allowed",
          reason: "explicit high risk can upgrade known recipient",
          source: "agent",
          risk: "high",
        },
      ),
    ).resolves.toMatchObject({ risk: "high" });
  });

  it("does_not_allow_explicit_risk_to_downgrade_campaign_or_followup_items", async () => {
    const rootDir = await makeRoot();
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Handyman outreach",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567"],
        maxSends: 2,
        followupsAllowed: true,
      },
    );

    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "campaign_outreach",
          recipient: "+15551234567",
          body: "campaign",
          campaignId: campaign.campaignId,
          reason: "explicit low risk cannot downgrade campaign",
          source: "agent",
          risk: "low",
        },
      ),
    ).resolves.toMatchObject({ risk: "high" });
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "follow_up",
          recipient: "+15551234567",
          body: "follow up",
          campaignId: campaign.campaignId,
          reason: "explicit low risk cannot downgrade follow-up",
          source: "agent",
          risk: "low",
        },
      ),
    ).resolves.toMatchObject({ risk: "high" });
  });

  it("requires_explicit_confirmation_to_approve_high_risk_items", async () => {
    const rootDir = await makeRoot();
    const item = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15550000000",
        body: "high risk",
        reason: "unknown recipient",
        source: "agent",
      },
    );

    await expect(
      approveTextMailroomOutbound({ rootDir }, { itemId: item.id, approvedBy: "Chris" }),
    ).rejects.toThrow("high-risk approval requires confirmHighRisk");
    await expect(
      approveTextMailroomOutbound(
        { rootDir },
        { itemId: item.id, approvedBy: "Chris", confirmHighRisk: true },
      ),
    ).resolves.toMatchObject({
      status: "approved",
      approval: { highRiskConfirmed: true },
    });
  });

  it("dedupes_retried_outbound_proposals_by_request_id", async () => {
    const rootDir = await makeRoot();
    const first = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+15551234567",
        body: "hello",
        reason: "retry-safe request",
        source: "agent",
        requestId: "agent-request-1",
      },
    );
    const retry = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "manual",
        recipient: "+1 (555) 123-4567",
        body: "hello",
        reason: "retry-safe request",
        source: "agent",
        requestId: "agent-request-1",
      },
    );

    expect(retry.id).toBe(first.id);
    expect(retry.requestId).toBe("agent-request-1");
    await expect(listTextMailroomOutboundItems({ rootDir })).resolves.toHaveLength(1);
    await expect(
      proposeTextMailroomOutbound(
        { rootDir },
        {
          kind: "manual",
          recipient: "+15551234567",
          body: "different body",
          reason: "retry collision",
          source: "agent",
          requestId: "agent-request-1",
        },
      ),
    ).rejects.toThrow("request_id already exists with different outbound payload");
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

    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: item.id, approvedBy: "Chris", confirmHighRisk: true },
    );
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

  it("rechecks_campaign_send_limits_at_send_time", async () => {
    const rootDir = await makeRoot();
    let sentCount = 0;
    const sender = vi.fn(async () => ({ messageId: `msg-${++sentCount}` }));
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Limited campaign",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567", "+15557654321"],
        maxSends: 1,
      },
    );
    const first = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15551234567",
        body: "first",
        campaignId: campaign.campaignId,
        reason: "first authorized send",
        source: "agent",
      },
    );
    const second = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15557654321",
        body: "second",
        campaignId: campaign.campaignId,
        reason: "second authorized send",
        source: "agent",
      },
    );
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: first.id, approvedBy: "Chris", confirmHighRisk: true },
    );
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: second.id, approvedBy: "Chris", confirmHighRisk: true },
    );

    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: first.id }),
    ).resolves.toMatchObject({ status: "sent" });
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: second.id }),
    ).rejects.toThrow("send limit reached");
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("serializes_campaign_sends_so_concurrent_items_do_not_exceed_the_limit", async () => {
    const rootDir = await makeRoot();
    let releaseSender: ((value: { messageId: string }) => void) | undefined;
    const sender = vi.fn(
      () =>
        new Promise<{ messageId: string }>((resolve) => {
          releaseSender = resolve;
        }),
    );
    const campaign = await authorizeTextMailroomCampaign(
      { rootDir },
      {
        purpose: "Limited campaign",
        approvedBy: "Chris",
        allowedRecipients: ["+15551234567", "+15557654321"],
        maxSends: 1,
      },
    );
    const first = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15551234567",
        body: "first",
        campaignId: campaign.campaignId,
        reason: "first authorized send",
        source: "agent",
      },
    );
    const second = await proposeTextMailroomOutbound(
      { rootDir },
      {
        kind: "campaign_outreach",
        recipient: "+15557654321",
        body: "second",
        campaignId: campaign.campaignId,
        reason: "second authorized send",
        source: "agent",
      },
    );
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: first.id, approvedBy: "Chris", confirmHighRisk: true },
    );
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: second.id, approvedBy: "Chris", confirmHighRisk: true },
    );

    vi.stubEnv(TEXT_MAILROOM_SEND_OPTIN_ENV, "1");
    const firstSend = sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: first.id });
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await expect(
      sendApprovedTextMailroomOutbound({ rootDir, sender }, { itemId: second.id }),
    ).rejects.toThrow("campaign is already claimed");
    releaseSender?.({ messageId: "msg-1" });
    await expect(firstSend).resolves.toMatchObject({ status: "sent" });
    expect(sender).toHaveBeenCalledTimes(1);
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
      { itemId: item.id, approvedBy: "Chris", confirmHighRisk: true },
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
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: item.id, approvedBy: "Chris", confirmHighRisk: true },
    );

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
    await approveTextMailroomOutbound(
      { rootDir },
      { itemId: item.id, approvedBy: "Chris", confirmHighRisk: true },
    );

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
