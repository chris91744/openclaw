import type { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildTextMailroomDigest,
  classifyTextMailroomThread,
  exportPrestigioTextSignals,
  loadTextMailroomThread,
  queueTextMailroomFollowUps,
  recordTextMailroomInbound,
} from "../../extensions/bluebubbles/src/text-mailroom-inbox.js";
import {
  approveTextMailroomOutbound,
  authorizeTextMailroomCampaign,
  listTextMailroomCampaigns,
  listTextMailroomContacts,
  listTextMailroomOutboundItems,
  loadTextMailroomCampaign,
  loadTextMailroomContact,
  loadTextMailroomOutboundItem,
  proposeTextMailroomOutbound,
  rejectTextMailroomOutbound,
  sendApprovedTextMailroomOutbound,
  upsertTextMailroomContact,
} from "../../extensions/bluebubbles/src/text-mailroom-outbound.js";
import {
  TEXT_MAILROOM_SEND_OPTIN_ENV,
  type TextMailroomContactLabel,
  type TextMailroomOutboundKind,
  type TextMailroomRisk,
} from "../../extensions/bluebubbles/src/text-mailroom-types.js";
import { BLUEBUBBLES_OUTBOUND_ENABLED_ENV } from "../../extensions/bluebubbles/src/types.js";
import {
  loadConfig,
  readConfigFileSnapshot,
  writeConfigFile,
  type OpenClawConfig,
} from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";

const LEGACY_IMESSAGE_SEND_OPTIN_ENV = "OPENCLAW_IMESSAGE_SEND_OPTIN";

type TextMailroomCliOptions = {
  root?: string;
  json?: boolean;
};

type BlueBubblesTextMailroomConfigInput = {
  serverUrl: string;
  password: string;
  allowFrom: string[];
  rootDir?: string;
  includeGroups?: boolean;
  autoClassify?: boolean;
  exportPrestigio?: boolean;
};

type BlueBubblesTextMailroomConfigSummary = {
  channelWasPresent: boolean;
  serverUrlConfigured: boolean;
  passwordConfigured: boolean;
  allowFromCount: number;
  dmPolicy: "allowlist";
  groupPolicy: "disabled";
  textMailroom: {
    enabled: true;
    includeGroups: boolean;
    autoClassify: boolean;
    exportPrestigio: boolean;
    rootDirConfigured: boolean;
  };
  sendGatesChanged: false;
};

export type TextMailroomReadinessStatus = {
  rootDir: string;
  sendGates: {
    textMailroomApprovedSendOptIn: boolean;
    blueBubblesTransportOptIn: boolean;
    legacyImessageSendOptIn: boolean;
  };
  bluebubbles: {
    channelPresent: boolean;
    enabled: boolean;
    configured: boolean;
    serverUrlConfigured: boolean;
    passwordConfigured: boolean;
    dmPolicy?: string;
    allowFromCount: number;
    groupPolicy?: string;
    accountCount: number;
    textMailroom: {
      enabled: boolean;
      includeGroups: boolean;
      autoClassify: boolean;
      exportPrestigio: boolean;
      rootDirConfigured: boolean;
    };
  };
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringConfigured(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function readAllowFromFile(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return normalizeList(parsed.map((entry) => String(entry)));
  }
  const record = asRecord(parsed);
  if (Array.isArray(record?.allowFrom)) {
    return normalizeList(record.allowFrom.map((entry) => String(entry)));
  }
  throw new Error("Allow-from file must be a JSON array or an object with allowFrom array");
}

function readRequiredEnv(envName: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(envName)) {
    throw new Error("Password env var name is invalid");
  }
  const value = env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing required password env var: ${envName}`);
  }
  return value;
}

export function buildBlueBubblesTextMailroomConfig(params: {
  config: OpenClawConfig;
  input: BlueBubblesTextMailroomConfigInput;
}): { config: OpenClawConfig; summary: BlueBubblesTextMailroomConfigSummary } {
  const serverUrl = params.input.serverUrl.trim();
  const password = params.input.password.trim();
  const allowFrom = normalizeList(params.input.allowFrom);
  if (!serverUrl) {
    throw new Error("BlueBubbles server URL is required");
  }
  if (!password) {
    throw new Error("BlueBubbles password is required");
  }
  if (allowFrom.length === 0) {
    throw new Error("At least one BlueBubbles allowlist entry is required");
  }

  const next = structuredClone(params.config) as OpenClawConfig;
  const channels = asRecord(next.channels) ?? {};
  next.channels = channels as OpenClawConfig["channels"];
  const existingBlueBubbles = asRecord(channels.bluebubbles);
  const existingTextMailroom = asRecord(existingBlueBubbles?.textMailroom);
  const rootDir = params.input.rootDir?.trim();
  const textMailroom = {
    ...existingTextMailroom,
    enabled: true,
    includeGroups: params.input.includeGroups === true,
    autoClassify: params.input.autoClassify !== false,
    exportPrestigio: params.input.exportPrestigio === true,
    ...(rootDir ? { rootDir } : {}),
  };
  channels.bluebubbles = {
    ...existingBlueBubbles,
    enabled: true,
    serverUrl,
    password,
    webhookPath:
      typeof existingBlueBubbles?.webhookPath === "string"
        ? existingBlueBubbles.webhookPath
        : "/bluebubbles-webhook",
    dmPolicy: "allowlist",
    allowFrom,
    groupPolicy: "disabled",
    textMailroom,
  };

  return {
    config: next,
    summary: {
      channelWasPresent: Boolean(existingBlueBubbles),
      serverUrlConfigured: true,
      passwordConfigured: true,
      allowFromCount: allowFrom.length,
      dmPolicy: "allowlist",
      groupPolicy: "disabled",
      textMailroom: {
        enabled: true,
        includeGroups: textMailroom.includeGroups,
        autoClassify: textMailroom.autoClassify,
        exportPrestigio: textMailroom.exportPrestigio,
        rootDirConfigured: stringConfigured(textMailroom.rootDir),
      },
      sendGatesChanged: false,
    },
  };
}

export function buildTextMailroomReadinessStatus(params: {
  rootDir: string;
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): TextMailroomReadinessStatus {
  const env = params.env ?? process.env;
  const channels = asRecord(params.config.channels);
  const bluebubbles = asRecord(channels?.bluebubbles);
  const accounts = asRecord(bluebubbles?.accounts);
  const textMailroom = asRecord(bluebubbles?.textMailroom);
  const serverUrlConfigured = stringConfigured(bluebubbles?.serverUrl);
  const passwordConfigured = stringConfigured(bluebubbles?.password);
  return {
    rootDir: params.rootDir,
    sendGates: {
      textMailroomApprovedSendOptIn: env[TEXT_MAILROOM_SEND_OPTIN_ENV] === "1",
      blueBubblesTransportOptIn: env[BLUEBUBBLES_OUTBOUND_ENABLED_ENV] === "1",
      legacyImessageSendOptIn: env[LEGACY_IMESSAGE_SEND_OPTIN_ENV] === "1",
    },
    bluebubbles: {
      channelPresent: Boolean(bluebubbles),
      enabled: booleanValue(bluebubbles?.enabled),
      configured: serverUrlConfigured && passwordConfigured,
      serverUrlConfigured,
      passwordConfigured,
      dmPolicy: typeof bluebubbles?.dmPolicy === "string" ? bluebubbles.dmPolicy : undefined,
      allowFromCount: countArray(bluebubbles?.allowFrom),
      groupPolicy:
        typeof bluebubbles?.groupPolicy === "string" ? bluebubbles.groupPolicy : undefined,
      accountCount: accounts ? Object.keys(accounts).length : 0,
      textMailroom: {
        enabled: booleanValue(textMailroom?.enabled),
        includeGroups: booleanValue(textMailroom?.includeGroups),
        autoClassify: textMailroom?.autoClassify === false ? false : true,
        exportPrestigio: booleanValue(textMailroom?.exportPrestigio),
        rootDirConfigured: stringConfigured(textMailroom?.rootDir),
      },
    },
  };
}

export function formatTextMailroomReadinessStatus(status: TextMailroomReadinessStatus): string {
  const gate = (enabled: boolean) => (enabled ? "enabled" : "disabled");
  const blue = status.bluebubbles;
  return [
    `Text Mailroom root: ${status.rootDir}`,
    `BlueBubbles: channel=${blue.channelPresent ? "present" : "missing"} enabled=${blue.enabled ? "yes" : "no"} configured=${blue.configured ? "yes" : "no"} textMailroom=${blue.textMailroom.enabled ? "enabled" : "disabled"}`,
    `BlueBubbles policy: dm=${blue.dmPolicy ?? "unset"} allowFrom=${blue.allowFromCount} group=${blue.groupPolicy ?? "unset"} accounts=${blue.accountCount}`,
    `Text Mailroom ingest: includeGroups=${blue.textMailroom.includeGroups ? "yes" : "no"} autoClassify=${blue.textMailroom.autoClassify ? "yes" : "no"} exportPrestigio=${blue.textMailroom.exportPrestigio ? "yes" : "no"}`,
    `Send gates: textMailroom=${gate(status.sendGates.textMailroomApprovedSendOptIn)} blueBubblesTransport=${gate(status.sendGates.blueBubblesTransportOptIn)} legacyIMessage=${gate(status.sendGates.legacyImessageSendOptIn)}`,
  ].join("\n");
}

function requireOption(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required option: ${name}`);
  }
  return trimmed;
}

async function resolveRequestSendRecipient(params: {
  rootDir: string;
  to?: string;
  contactId?: string;
  contactQuery?: string;
}): Promise<{ recipient: string; contactId?: string }> {
  const contactId = params.contactId?.trim();
  const contactQuery = params.contactQuery?.trim();
  const to = params.to?.trim();
  const selected = [to, contactId, contactQuery].filter(Boolean);
  if (selected.length > 1) {
    throw new Error("request-send accepts only one of --to, --contact-id, or --contact");
  }
  if (contactId) {
    const contact = await loadTextMailroomContact({ rootDir: params.rootDir }, contactId);
    if (!contact) {
      throw new Error("Text Mailroom contact not found");
    }
    return { recipient: contact.phone, contactId: contact.contactId };
  }
  if (contactQuery) {
    const contact = await resolveSingleContactByQuery({
      rootDir: params.rootDir,
      query: contactQuery,
    });
    return { recipient: contact.phone, contactId: contact.contactId };
  }
  return { recipient: requireOption(to, "--to, --contact-id, or --contact") };
}

async function resolveSingleContactByQuery(params: {
  rootDir: string;
  query: string;
}): Promise<Awaited<ReturnType<typeof listTextMailroomContacts>>[number]> {
  const needle = normalizeContactQuery(params.query);
  const contacts = await listTextMailroomContacts({ rootDir: params.rootDir });
  const exactMatches = contacts.filter((contact) => {
    return (
      normalizeContactQuery(contact.contactId) === needle ||
      normalizeContactQuery(contact.displayName ?? "") === needle ||
      contact.labels.some((label) => normalizeContactQuery(label) === needle)
    );
  });
  const matches =
    exactMatches.length > 0
      ? exactMatches
      : contacts.filter((contact) =>
          normalizeContactQuery(contact.displayName ?? "").includes(needle),
        );
  if (matches.length === 0) {
    throw new Error("Text Mailroom contact query did not match any saved contact");
  }
  if (matches.length > 1) {
    throw new Error("Text Mailroom contact query matched multiple contacts; use --contact-id");
  }
  return matches[0]!;
}

async function searchContactsByQuery(params: {
  rootDir: string;
  query: string;
}): Promise<Awaited<ReturnType<typeof listTextMailroomContacts>>> {
  const needle = normalizeContactQuery(params.query);
  if (!needle) {
    throw new Error("Text Mailroom contact search query is required");
  }
  const contacts = await listTextMailroomContacts({ rootDir: params.rootDir });
  return contacts.filter((contact) => {
    return [
      contact.contactId,
      contact.displayName ?? "",
      ...contact.labels,
      contact.source ?? "",
    ].some((value) => normalizeContactQuery(value).includes(needle));
  });
}

function normalizeContactQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
    threadId: item.threadId,
    requestId: item.requestId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reason: item.reason,
  };
}

function summarizeContact(contact: Awaited<ReturnType<typeof listTextMailroomContacts>>[number]) {
  return {
    contactId: contact.contactId,
    displayName: contact.displayName,
    labels: contact.labels,
    source: contact.source,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function summarizeCampaign(
  campaign: Awaited<ReturnType<typeof listTextMailroomCampaigns>>[number],
) {
  return {
    campaignId: campaign.campaignId,
    purpose: campaign.purpose,
    approved: campaign.approved,
    approvedBy: campaign.approvedBy,
    approvedAt: campaign.approvedAt,
    maxSends: campaign.maxSends,
    sendsUsed: campaign.sendsUsed,
    followupsAllowed: campaign.followupsAllowed,
    expiresAt: campaign.expiresAt,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

export function registerTextMailroomCli(program: Command) {
  const root = program
    .command("text-mailroom")
    .description("Supervised SMS/iMessage mailroom queue")
    .option("--root <dir>", "Text Mailroom store directory")
    .option("--json", "Print JSON output");

  root
    .command("enable-bluebubbles-ingest")
    .description("Plan or apply BlueBubbles -> Text Mailroom ingestion config")
    .requiredOption("--server-url <url>", "BlueBubbles server URL")
    .requiredOption("--password-env <name>", "Environment variable containing BlueBubbles password")
    .option(
      "--allow-from <entry>",
      "Allowed inbound sender; repeat for multiple entries",
      collectOption,
      [] as string[],
    )
    .option("--allow-from-file <file>", "JSON array or object with allowFrom array")
    .option("--root-dir <dir>", "Text Mailroom store root override")
    .option("--include-groups", "Also ingest group messages", false)
    .option("--no-auto-classify", "Disable automatic Text Mailroom classification")
    .option("--export-prestigio", "Write Prestigio text-signal exports after ingest", false)
    .option("--apply", "Write the config change; dry-run is the default", false)
    .option(
      "--confirm-live-config-change",
      "Required with --apply to acknowledge this writes live OpenClaw config",
      false,
    )
    .action(
      async (opts: {
        serverUrl: string;
        passwordEnv: string;
        allowFrom: string[];
        allowFromFile?: string;
        rootDir?: string;
        includeGroups?: boolean;
        autoClassify?: boolean;
        exportPrestigio?: boolean;
        apply?: boolean;
        confirmLiveConfigChange?: boolean;
      }) => {
        if (opts.apply === true && opts.confirmLiveConfigChange !== true) {
          throw new Error("Refusing to write live config without --confirm-live-config-change");
        }
        const password = readRequiredEnv(opts.passwordEnv);
        const fileAllowFrom = opts.allowFromFile
          ? await readAllowFromFile(path.resolve(opts.allowFromFile))
          : [];
        const snapshot = await readConfigFileSnapshot();
        if (!snapshot.valid) {
          throw new Error(
            "OpenClaw config is invalid; fix config before enabling BlueBubbles ingest",
          );
        }
        const plan = buildBlueBubblesTextMailroomConfig({
          config: structuredClone(snapshot.resolved) as OpenClawConfig,
          input: {
            serverUrl: opts.serverUrl,
            password,
            allowFrom: [...opts.allowFrom, ...fileAllowFrom],
            rootDir: opts.rootDir,
            includeGroups: opts.includeGroups === true,
            autoClassify: opts.autoClassify !== false,
            exportPrestigio: opts.exportPrestigio === true,
          },
        });
        if (opts.apply === true) {
          await writeConfigFile(plan.config);
        }
        output(
          root,
          { mode: opts.apply === true ? "applied" : "dry-run", ...plan.summary },
          [
            `${opts.apply === true ? "Applied" : "Dry run"} BlueBubbles Text Mailroom ingest config.`,
            `BlueBubbles channel: ${plan.summary.channelWasPresent ? "updated" : "would be added"}`,
            `Allowlist entries: ${plan.summary.allowFromCount}`,
            `Text Mailroom ingest: enabled, includeGroups=${plan.summary.textMailroom.includeGroups ? "yes" : "no"}, autoClassify=${plan.summary.textMailroom.autoClassify ? "yes" : "no"}, exportPrestigio=${plan.summary.textMailroom.exportPrestigio ? "yes" : "no"}`,
            "Send gates changed: no",
          ].join("\n"),
        );
      },
    );

  root
    .command("status")
    .description("Show redacted Text Mailroom readiness and send gate status")
    .action(async () => {
      const status = buildTextMailroomReadinessStatus({
        rootDir: resolveRoot(root),
        config: loadConfig(),
      });
      output(root, status, formatTextMailroomReadinessStatus(status));
    });

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
              .map(
                (item) =>
                  `${item.status.padEnd(8)} ${item.id} ${item.kind} risk=${item.risk} ${item.reason}`,
              )
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
    .option("--risk <risk>", "low, medium, or high; inferred when omitted")
    .option("--campaign-id <id>", "Campaign id")
    .option("--contact-id <id>", "Contact id")
    .option("--thread-id <id>", "Thread id")
    .option("--request-id <id>", "Idempotency key for safe retries")
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
        requestId?: string;
      }) => {
        const item = await proposeTextMailroomOutbound(
          { rootDir: resolveRoot(root) },
          {
            kind: opts.kind ?? "manual",
            recipient: requireOption(opts.to, "--to"),
            body: requireOption(opts.body, "--body"),
            reason: requireOption(opts.reason, "--reason"),
            source: opts.source ?? "cli",
            risk: opts.risk,
            campaignId: opts.campaignId,
            contactId: opts.contactId,
            threadId: opts.threadId,
            requestId: opts.requestId,
          },
        );
        output(root, summarizeItem(item), `Queued ${item.id}`);
      },
    );

  root
    .command("request-send")
    .description("Queue a text request, optionally approve it, and optionally attempt send")
    .option("--to <recipient>", "Recipient phone/handle")
    .requiredOption("--body <text>", "Message body")
    .requiredOption("--reason <reason>", "Why this text is proposed")
    .option("--source <source>", "Source/provenance", "cli")
    .option(
      "--kind <kind>",
      "manual, campaign_outreach, conversation_reply, or follow_up",
      "manual",
    )
    .option("--risk <risk>", "low, medium, or high; inferred when omitted")
    .option("--campaign-id <id>", "Campaign id")
    .option("--contact-id <id>", "Contact id")
    .option("--contact <query>", "Saved contact id, exact name, label, or unique name fragment")
    .option("--thread-id <id>", "Thread id")
    .option("--request-id <id>", "Idempotency key for safe retries")
    .option("--approve-by <name>", "Approver name; approval still does not send")
    .option("--confirm-high-risk", "Required to approve high-risk drafts", false)
    .option("--send", "Attempt sending after approval")
    .option("--confirm-send", "Confirm this command may call the sender")
    .action(
      async (opts: {
        to?: string;
        body: string;
        reason: string;
        source?: string;
        kind?: TextMailroomOutboundKind;
        risk?: TextMailroomRisk;
        campaignId?: string;
        contactId?: string;
        contact?: string;
        threadId?: string;
        requestId?: string;
        approveBy?: string;
        confirmHighRisk?: boolean;
        send?: boolean;
        confirmSend?: boolean;
      }) => {
        if (opts.send === true && !opts.approveBy?.trim()) {
          throw new Error("request-send --send requires --approve-by <name>");
        }
        if (opts.send === true && opts.confirmSend !== true) {
          throw new Error("Refusing to send without --confirm-send");
        }

        const rootDir = resolveRoot(root);
        const resolvedRecipient = await resolveRequestSendRecipient({
          rootDir,
          to: opts.to,
          contactId: opts.contactId,
          contactQuery: opts.contact,
        });
        let item = await proposeTextMailroomOutbound(
          { rootDir },
          {
            kind: opts.kind ?? "manual",
            recipient: resolvedRecipient.recipient,
            body: requireOption(opts.body, "--body"),
            reason: requireOption(opts.reason, "--reason"),
            source: opts.source ?? "cli",
            risk: opts.risk,
            campaignId: opts.campaignId,
            contactId: resolvedRecipient.contactId ?? opts.contactId,
            threadId: opts.threadId,
            requestId: opts.requestId,
          },
        );
        let stage = item.status;
        if (opts.approveBy?.trim() && item.status === "queued") {
          item = await approveTextMailroomOutbound(
            { rootDir },
            {
              itemId: item.id,
              approvedBy: opts.approveBy,
              confirmHighRisk: opts.confirmHighRisk,
            },
          );
          stage = "approved";
        }
        if (opts.send === true) {
          item = await sendApprovedTextMailroomOutbound({ rootDir }, { itemId: item.id });
          stage = "sent";
        }
        output(root, { stage, ...summarizeItem(item) }, `${stage} ${item.id}`);
      },
    );

  root
    .command("request-reply")
    .argument("<threadId>")
    .description("Queue a reply to an inbox thread without exposing the sender")
    .requiredOption("--body <text>", "Reply body")
    .requiredOption("--reason <reason>", "Why this reply is proposed")
    .option("--source <source>", "Source/provenance", "cli")
    .option("--risk <risk>", "low, medium, or high; inferred when omitted")
    .option("--request-id <id>", "Idempotency key for safe retries")
    .option("--approve-by <name>", "Approver name; approval still does not send")
    .option("--confirm-high-risk", "Required to approve high-risk drafts", false)
    .option("--send", "Attempt sending after approval")
    .option("--confirm-send", "Confirm this command may call the sender")
    .action(
      async (
        threadId: string,
        opts: {
          body: string;
          reason: string;
          source?: string;
          risk?: TextMailroomRisk;
          requestId?: string;
          approveBy?: string;
          confirmHighRisk?: boolean;
          send?: boolean;
          confirmSend?: boolean;
        },
      ) => {
        if (opts.send === true && !opts.approveBy?.trim()) {
          throw new Error("request-reply --send requires --approve-by <name>");
        }
        if (opts.send === true && opts.confirmSend !== true) {
          throw new Error("Refusing to send without --confirm-send");
        }

        const rootDir = resolveRoot(root);
        const thread = await loadTextMailroomThread({ rootDir }, threadId);
        if (!thread) {
          throw new Error("Text Mailroom thread not found");
        }
        let item = await proposeTextMailroomOutbound(
          { rootDir },
          {
            kind: "conversation_reply",
            recipient: thread.sender,
            body: requireOption(opts.body, "--body"),
            reason: requireOption(opts.reason, "--reason"),
            source: opts.source ?? "cli",
            risk: opts.risk,
            contactId: thread.contactId,
            threadId: thread.threadId,
            requestId: opts.requestId,
          },
        );
        let stage = item.status;
        if (opts.approveBy?.trim() && item.status === "queued") {
          item = await approveTextMailroomOutbound(
            { rootDir },
            {
              itemId: item.id,
              approvedBy: opts.approveBy,
              confirmHighRisk: opts.confirmHighRisk,
            },
          );
          stage = "approved";
        }
        if (opts.send === true) {
          item = await sendApprovedTextMailroomOutbound({ rootDir }, { itemId: item.id });
          stage = "sent";
        }
        output(root, { stage, ...summarizeItem(item) }, `${stage} ${item.id}`);
      },
    );

  root
    .command("approve")
    .argument("<itemId>")
    .description("Approve a queued text; does not send")
    .requiredOption("--by <name>", "Approver")
    .option("--body <text>", "Edited body to approve")
    .option("--confirm-high-risk", "Required to approve high-risk drafts", false)
    .action(
      async (itemId: string, opts: { by: string; body?: string; confirmHighRisk?: boolean }) => {
        const item = await approveTextMailroomOutbound(
          { rootDir: resolveRoot(root) },
          {
            itemId,
            approvedBy: opts.by,
            editedBody: opts.body,
            confirmHighRisk: opts.confirmHighRisk,
          },
        );
        output(root, summarizeItem(item), `Approved ${item.id}`);
      },
    );

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
    .command("list")
    .description("List contacts without raw phone numbers")
    .action(async () => {
      const contacts = await listTextMailroomContacts({ rootDir: resolveRoot(root) });
      output(
        root,
        contacts.map(summarizeContact),
        contacts.length
          ? contacts
              .map(
                (contact) =>
                  `${contact.contactId} ${(contact.displayName ?? "").padEnd(20)} ${contact.labels.join(",")}`,
              )
              .join("\n")
          : "No Text Mailroom contacts.",
      );
    });

  contacts
    .command("search")
    .argument("<query>")
    .description("Search contacts without raw phone numbers")
    .action(async (query: string) => {
      const contacts = await searchContactsByQuery({ rootDir: resolveRoot(root), query });
      output(
        root,
        contacts.map(summarizeContact),
        contacts.length
          ? contacts
              .map(
                (contact) =>
                  `${contact.contactId} ${(contact.displayName ?? "").padEnd(20)} ${contact.labels.join(",")}`,
              )
              .join("\n")
          : "No Text Mailroom contacts matched.",
      );
    });

  contacts
    .command("show")
    .argument("<contactId>")
    .description("Show one contact for deliberate human review")
    .action(async (contactId: string) => {
      const contact = await loadTextMailroomContact({ rootDir: resolveRoot(root) }, contactId);
      if (!contact) {
        throw new Error("Text Mailroom contact not found");
      }
      output(root, contact);
    });

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
    .command("list")
    .description("List authorized campaigns without raw recipients")
    .action(async () => {
      const campaigns = await listTextMailroomCampaigns({ rootDir: resolveRoot(root) });
      output(
        root,
        campaigns.map(summarizeCampaign),
        campaigns.length
          ? campaigns
              .map(
                (campaign) =>
                  `${campaign.campaignId} ${campaign.sendsUsed}/${campaign.maxSends} ${campaign.purpose}`,
              )
              .join("\n")
          : "No Text Mailroom campaigns.",
      );
    });

  campaigns
    .command("show")
    .argument("<campaignId>")
    .description("Show one campaign authorization")
    .action(async (campaignId: string) => {
      const campaign = await loadTextMailroomCampaign({ rootDir: resolveRoot(root) }, campaignId);
      if (!campaign) {
        throw new Error("Text Mailroom campaign not found");
      }
      output(root, campaign);
    });

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
