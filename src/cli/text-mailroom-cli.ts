import type { Command } from "commander";
import path from "node:path";
import type {
  TextMailroomContactLabel,
  TextMailroomOutboundKind,
  TextMailroomRisk,
} from "../../extensions/bluebubbles/src/text-mailroom-types.js";
import {
  buildTextMailroomDigest,
  classifyTextMailroomThread,
  exportPrestigioTextSignals,
  queueTextMailroomFollowUps,
  recordTextMailroomInbound,
} from "../../extensions/bluebubbles/src/text-mailroom-inbox.js";
import {
  approveTextMailroomOutbound,
  authorizeTextMailroomCampaign,
  listTextMailroomOutboundItems,
  loadTextMailroomOutboundItem,
  proposeTextMailroomOutbound,
  rejectTextMailroomOutbound,
  sendApprovedTextMailroomOutbound,
  upsertTextMailroomContact,
} from "../../extensions/bluebubbles/src/text-mailroom-outbound.js";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";

type TextMailroomCliOptions = {
  root?: string;
  json?: boolean;
};

function resolveRoot(command: Command): string {
  const opts = command.optsWithGlobals<TextMailroomCliOptions>();
  return path.resolve(
    opts.root?.trim() ||
      process.env.OPENCLAW_TEXT_MAILROOM_DIR?.trim() ||
      path.join(resolveStateDir(), "workspace", "text-mailroom"),
  );
}

function output(command: Command, value: unknown, human?: string): void {
  const opts = command.optsWithGlobals<TextMailroomCliOptions>();
  if (opts.json) {
    defaultRuntime.log(JSON.stringify(value, null, 2));
    return;
  }
  defaultRuntime.log(human ?? JSON.stringify(value, null, 2));
}

function requireOption(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required option: ${name}`);
  }
  return trimmed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Expected a positive integer");
  }
  return parsed;
}

function parseLabels(value: string | undefined): TextMailroomContactLabel[] {
  if (!value?.trim()) {
    return ["unknown"];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as TextMailroomContactLabel[];
}

function summarizeItem(item: Awaited<ReturnType<typeof listTextMailroomOutboundItems>>[number]) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    risk: item.risk,
    campaignId: item.campaignId,
    contactId: item.contactId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reason: item.reason,
  };
}

export function registerTextMailroomCli(program: Command) {
  const root = program
    .command("text-mailroom")
    .description("Supervised SMS/iMessage mailroom queue")
    .option("--root <dir>", "Text Mailroom store directory")
    .option("--json", "Print JSON output");

  root
    .command("list")
    .description("List outbound queue items without raw recipients or message bodies")
    .action(async () => {
      const items = await listTextMailroomOutboundItems({ rootDir: resolveRoot(root) });
      output(
        root,
        items.map(summarizeItem),
        items.length
          ? items
              .map((item) => `${item.status.padEnd(8)} ${item.id} ${item.kind} ${item.reason}`)
              .join("\n")
          : "No outbound queue items.",
      );
    });

  root
    .command("show")
    .argument("<itemId>")
    .description("Show one outbound item for human review")
    .action(async (itemId: string) => {
      const item = await loadTextMailroomOutboundItem({ rootDir: resolveRoot(root) }, itemId);
      if (!item) {
        throw new Error("Text Mailroom outbound item not found");
      }
      output(root, item);
    });

  root
    .command("propose")
    .description("Queue a proposed outbound text without sending it")
    .requiredOption("--to <recipient>", "Recipient phone/handle")
    .requiredOption("--body <text>", "Message body")
    .requiredOption("--reason <reason>", "Why this text is proposed")
    .option("--source <source>", "Source/provenance", "cli")
    .option(
      "--kind <kind>",
      "manual, campaign_outreach, conversation_reply, or follow_up",
      "manual",
    )
    .option("--risk <risk>", "low, medium, or high", "medium")
    .option("--campaign-id <id>", "Campaign id")
    .option("--contact-id <id>", "Contact id")
    .option("--thread-id <id>", "Thread id")
    .action(
      async (opts: {
        to: string;
        body: string;
        reason: string;
        source?: string;
        kind?: TextMailroomOutboundKind;
        risk?: TextMailroomRisk;
        campaignId?: string;
        contactId?: string;
        threadId?: string;
      }) => {
        const item = await proposeTextMailroomOutbound(
          { rootDir: resolveRoot(root) },
          {
            kind: opts.kind ?? "manual",
            recipient: requireOption(opts.to, "--to"),
            body: requireOption(opts.body, "--body"),
            reason: requireOption(opts.reason, "--reason"),
            source: opts.source ?? "cli",
            risk: opts.risk ?? "medium",
            campaignId: opts.campaignId,
            contactId: opts.contactId,
            threadId: opts.threadId,
          },
        );
        output(root, summarizeItem(item), `Queued ${item.id}`);
      },
    );

  root
    .command("approve")
    .argument("<itemId>")
    .description("Approve a queued text; does not send")
    .requiredOption("--by <name>", "Approver")
    .option("--body <text>", "Edited body to approve")
    .action(async (itemId: string, opts: { by: string; body?: string }) => {
      const item = await approveTextMailroomOutbound(
        { rootDir: resolveRoot(root) },
        { itemId, approvedBy: opts.by, editedBody: opts.body },
      );
      output(root, summarizeItem(item), `Approved ${item.id}`);
    });

  root
    .command("reject")
    .argument("<itemId>")
    .description("Reject a queued or approved text")
    .requiredOption("--by <name>", "Reviewer")
    .option("--reason <reason>", "Reason")
    .action(async (itemId: string, opts: { by: string; reason?: string }) => {
      const item = await rejectTextMailroomOutbound(
        { rootDir: resolveRoot(root) },
        { itemId, rejectedBy: opts.by, reason: opts.reason },
      );
      output(root, summarizeItem(item), `Rejected ${item.id}`);
    });

  root
    .command("send")
    .argument("<itemId>")
    .description("Send one already-approved item; requires explicit env opt-ins")
    .option("--confirm-send", "Confirm this command may call the sender")
    .action(async (itemId: string, opts: { confirmSend?: boolean }) => {
      if (opts.confirmSend !== true) {
        throw new Error("Refusing to send without --confirm-send");
      }
      const item = await sendApprovedTextMailroomOutbound(
        { rootDir: resolveRoot(root) },
        { itemId },
      );
      output(root, summarizeItem(item), `Sent ${item.id}`);
    });

  const contacts = root.command("contacts").description("Contact identity helpers");
  contacts
    .command("upsert")
    .requiredOption("--phone <phone>", "Phone or handle")
    .option("--name <name>", "Display name")
    .option("--labels <labels>", "Comma-separated labels", "unknown")
    .option("--source <source>", "Source/provenance", "cli")
    .action(async (opts: { phone: string; name?: string; labels?: string; source?: string }) => {
      const contact = await upsertTextMailroomContact(
        { rootDir: resolveRoot(root) },
        {
          phone: opts.phone,
          displayName: opts.name,
          labels: parseLabels(opts.labels),
          source: opts.source,
        },
      );
      output(root, contact, `Saved contact ${contact.contactId}`);
    });

  const campaigns = root.command("campaigns").description("Campaign authorization helpers");
  campaigns
    .command("authorize")
    .requiredOption("--purpose <purpose>", "Campaign purpose")
    .requiredOption("--by <name>", "Approver")
    .requiredOption("--recipient <recipient...>", "Allowed recipient; repeat or pass multiple")
    .option("--max-sends <n>", "Maximum sends", "1")
    .option("--followups", "Allow one queued follow-up per sent item")
    .option("--followup-after-ms <ms>", "Follow-up wait window in milliseconds")
    .option("--expires-at <iso>", "Expiration timestamp")
    .action(
      async (opts: {
        purpose: string;
        by: string;
        recipient: string[];
        maxSends?: string;
        followups?: boolean;
        followupAfterMs?: string;
        expiresAt?: string;
      }) => {
        const campaign = await authorizeTextMailroomCampaign(
          { rootDir: resolveRoot(root) },
          {
            purpose: opts.purpose,
            approvedBy: opts.by,
            allowedRecipients: opts.recipient,
            maxSends: parsePositiveInt(opts.maxSends, 1),
            followupsAllowed: opts.followups === true,
            followupAfterMs: opts.followupAfterMs
              ? parsePositiveInt(opts.followupAfterMs, 0)
              : undefined,
            expiresAt: opts.expiresAt,
          },
        );
        output(root, campaign, `Authorized campaign ${campaign.campaignId}`);
      },
    );

  const inbox = root.command("inbox").description("Inbox triage helpers");
  inbox
    .command("record")
    .requiredOption("--from <sender>", "Sender phone/handle")
    .requiredOption("--body <text>", "Inbound body")
    .option("--thread-id <id>", "Thread id")
    .option("--source <source>", "Source/provenance", "cli")
    .action(async (opts: { from: string; body: string; threadId?: string; source?: string }) => {
      const thread = await recordTextMailroomInbound(
        { rootDir: resolveRoot(root) },
        { sender: opts.from, body: opts.body, threadId: opts.threadId, source: opts.source },
      );
      output(root, thread, `Recorded inbound ${thread.threadId}`);
    });

  inbox
    .command("classify")
    .argument("<threadId>")
    .action(async (threadId: string) => {
      const thread = await classifyTextMailroomThread({ rootDir: resolveRoot(root) }, { threadId });
      output(root, thread, `Classified ${thread.threadId}: ${thread.tags.join(",") || "none"}`);
    });

  inbox.command("digest").action(async () => {
    const digest = await buildTextMailroomDigest({ rootDir: resolveRoot(root) });
    output(
      root,
      digest,
      digest.length
        ? digest
            .map(
              (item) =>
                `${item.priority.padEnd(6)} ${item.needsReply ? "reply" : "     "} ${item.threadId}`,
            )
            .join("\n")
        : "No inbox threads.",
    );
  });

  root
    .command("queue-followups")
    .requiredOption("--by <name>", "Requester")
    .action(async (opts: { by: string }) => {
      const items = await queueTextMailroomFollowUps(
        { rootDir: resolveRoot(root) },
        { requestedBy: opts.by },
      );
      output(root, items.map(summarizeItem), `Queued ${items.length} follow-up(s).`);
    });

  root.command("export-prestigio").action(async () => {
    const result = await exportPrestigioTextSignals({ rootDir: resolveRoot(root) });
    output(root, result, `Exported ${result.count} Prestigio text signal(s).`);
  });
}
