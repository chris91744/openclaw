import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../runtime.js";
import {
  buildBlueBubblesTextMailroomConfig,
  buildTextMailroomReadinessStatus,
  formatTextMailroomReadinessStatus,
  registerTextMailroomCli,
} from "./text-mailroom-cli.js";

const roots: string[] = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "text-mailroom-cli-"));
  roots.push(root);
  return root;
}

async function runCli(args: string[]) {
  const program = new Command();
  program.name("test");
  program.exitOverride();
  registerTextMailroomCli(program);
  await program.parseAsync(args, { from: "user" });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("text-mailroom cli", () => {
  it("builds_a_redacted_bluebubbles_ingest_config_plan_without_send_gates", () => {
    const plan = buildBlueBubblesTextMailroomConfig({
      config: {
        channels: {
          telegram: { enabled: true },
        },
      } as never,
      input: {
        serverUrl: "http://secret-bluebubbles.local:1234",
        password: "super-secret-password",
        allowFrom: ["+15551234567", "+15551234567", "vendor@example.com"],
        rootDir: "/private/text-mailroom",
        includeGroups: false,
        autoClassify: true,
        exportPrestigio: false,
      },
    });

    expect(plan.config.channels?.bluebubbles).toMatchObject({
      enabled: true,
      serverUrl: "http://secret-bluebubbles.local:1234",
      password: "super-secret-password",
      webhookPath: "/bluebubbles-webhook",
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567", "vendor@example.com"],
      groupPolicy: "disabled",
      textMailroom: {
        enabled: true,
        rootDir: "/private/text-mailroom",
        includeGroups: false,
        autoClassify: true,
        exportPrestigio: false,
      },
    });
    expect(plan.config.channels?.telegram).toEqual({ enabled: true });
    expect(plan.config).not.toHaveProperty("OPENCLAW_TEXT_MAILROOM_SEND_OPTIN");
    expect(plan.config).not.toHaveProperty("OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED");
    expect(plan.config).not.toHaveProperty("OPENCLAW_IMESSAGE_SEND_OPTIN");

    expect(plan.summary).toEqual({
      channelWasPresent: false,
      serverUrlConfigured: true,
      passwordConfigured: true,
      allowFromCount: 2,
      dmPolicy: "allowlist",
      groupPolicy: "disabled",
      textMailroom: {
        enabled: true,
        includeGroups: false,
        autoClassify: true,
        exportPrestigio: false,
        rootDirConfigured: true,
      },
      sendGatesChanged: false,
    });

    const summary = JSON.stringify(plan.summary);
    expect(summary).not.toContain("secret-bluebubbles");
    expect(summary).not.toContain("super-secret-password");
    expect(summary).not.toContain("+15551234567");
    expect(summary).not.toContain("vendor@example.com");
  });

  it("builds_a_redacted_readiness_status_without_config_secrets_or_recipients", () => {
    const status = buildTextMailroomReadinessStatus({
      rootDir: "/tmp/text-mailroom",
      env: {
        OPENCLAW_TEXT_MAILROOM_SEND_OPTIN: "1",
        OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED: "0",
        OPENCLAW_IMESSAGE_SEND_OPTIN: "1",
      },
      config: {
        channels: {
          bluebubbles: {
            enabled: true,
            serverUrl: "http://secret-bluebubbles.local:1234",
            password: "super-secret-password",
            dmPolicy: "allowlist",
            allowFrom: ["+15551234567"],
            groupPolicy: "disabled",
            textMailroom: {
              enabled: true,
              includeGroups: false,
              autoClassify: true,
              exportPrestigio: false,
            },
          },
        },
      } as never,
    });

    expect(status.bluebubbles).toMatchObject({
      channelPresent: true,
      enabled: true,
      configured: true,
      serverUrlConfigured: true,
      passwordConfigured: true,
      allowFromCount: 1,
      groupPolicy: "disabled",
      textMailroom: {
        enabled: true,
        includeGroups: false,
        autoClassify: true,
        exportPrestigio: false,
      },
    });
    expect(status.sendGates).toEqual({
      textMailroomApprovedSendOptIn: true,
      blueBubblesTransportOptIn: false,
      legacyImessageSendOptIn: true,
    });

    const serialized = JSON.stringify(status);
    const human = formatTextMailroomReadinessStatus(status);
    expect(serialized).not.toContain("secret-bluebubbles");
    expect(serialized).not.toContain("super-secret-password");
    expect(serialized).not.toContain("+15551234567");
    expect(human).not.toContain("secret-bluebubbles");
    expect(human).not.toContain("super-secret-password");
    expect(human).not.toContain("+15551234567");
  });

  it("queues_and_lists_outbound_items_without_body_or_phone_in_list_output", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "propose",
      "--to",
      "+1 (555) 123-4567",
      "--body",
      "Secret body text",
      "--reason",
      "handyman outreach",
    ]);
    await runCli(["text-mailroom", "--root", root, "list"]);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Queued outbound_");
    expect(output).toContain("handyman outreach");
    expect(output).not.toContain("+1 (555) 123-4567");
    expect(output).not.toContain("Secret body text");
  });

  it("approves_but_refuses_to_send_without_explicit_confirm_flag", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "propose",
      "--to",
      "+15551234567",
      "--body",
      "hello",
      "--reason",
      "manual test",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { id: string };
    await runCli(["text-mailroom", "--root", root, "approve", queued.id, "--by", "Chris"]);

    await expect(runCli(["text-mailroom", "--root", root, "send", queued.id])).rejects.toThrow(
      "Refusing to send without --confirm-send",
    );
  });

  it("request_send_queues_a_safe_summary_without_raw_body_or_phone", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "request-send",
      "--to",
      "+15551234567",
      "--body",
      "Secret request-send body",
      "--reason",
      "operator shortcut smoke",
    ]);

    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      id: string;
      stage: string;
      status: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret request-send body");
  });

  it("request_send_can_queue_by_contact_id_without_echoing_the_raw_phone_or_body", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "contacts",
      "upsert",
      "--phone",
      "+15551234567",
      "--name",
      "Handyman Lead",
      "--labels",
      "lead,vendor",
    ]);
    const contact = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { contactId: string };
    log.mockClear();

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "request-send",
      "--contact-id",
      contact.contactId,
      "--body",
      "Secret contact-id body",
      "--reason",
      "operator contact shortcut smoke",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      id: string;
      contactId?: string;
      stage: string;
      status: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.contactId).toBe(contact.contactId);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");

    await runCli(["text-mailroom", "--root", root, "list"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("operator contact shortcut smoke");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret contact-id body");
  });

  it("request_send_rejects_conflicting_to_and_contact_id", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "contacts",
      "upsert",
      "--phone",
      "+15551234567",
      "--name",
      "Handyman Lead",
    ]);
    const contact = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { contactId: string };

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--to",
        "+15550000000",
        "--contact-id",
        contact.contactId,
        "--body",
        "hello",
        "--reason",
        "conflict smoke",
      ]),
    ).rejects.toThrow("either --to or --contact-id");
  });

  it("request_send_refuses_send_without_confirm_before_queueing", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--to",
        "+15551234567",
        "--body",
        "hello",
        "--reason",
        "manual test",
        "--approve-by",
        "Chris",
        "--send",
      ]),
    ).rejects.toThrow("Refusing to send without --confirm-send");

    await runCli(["text-mailroom", "--root", root, "list"]);
    expect(String(log.mock.calls.at(-1)?.[0])).toBe("No outbound queue items.");
  });

  it("request_send_confirmed_attempt_still_stops_at_send_opt_in_gate", async () => {
    const root = await makeRoot();

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--to",
        "+15551234567",
        "--body",
        "hello",
        "--reason",
        "manual test",
        "--approve-by",
        "Chris",
        "--send",
        "--confirm-send",
      ]),
    ).rejects.toThrow("OPENCLAW_TEXT_MAILROOM_SEND_OPTIN");
  });

  it("lists_contacts_and_campaigns_without_raw_recipient_values", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "contacts",
      "upsert",
      "--phone",
      "+15551234567",
      "--name",
      "Handyman Lead",
      "--labels",
      "lead,vendor",
    ]);
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "campaigns",
      "authorize",
      "--purpose",
      "Handyman outreach",
      "--by",
      "Chris",
      "--recipient",
      "+15551234567",
      "--max-sends",
      "1",
    ]);
    await runCli(["text-mailroom", "--root", root, "contacts", "list"]);
    await runCli(["text-mailroom", "--root", root, "campaigns", "list"]);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Handyman Lead");
    expect(output).toContain("lead,vendor");
    expect(output).toContain("Handyman outreach");
    expect(output).not.toContain("+15551234567");
  });

  it("request_send_respects_campaign_recipient_boundaries", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "campaigns",
      "authorize",
      "--purpose",
      "Handyman outreach",
      "--by",
      "Chris",
      "--recipient",
      "+15551234567",
      "--max-sends",
      "1",
    ]);
    const campaign = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { campaignId: string };

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "request-send",
      "--kind",
      "campaign_outreach",
      "--campaign-id",
      campaign.campaignId,
      "--to",
      "+15551234567",
      "--body",
      "Hi, are you available?",
      "--reason",
      "approved campaign smoke",
    ]);

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--kind",
        "campaign_outreach",
        "--campaign-id",
        campaign.campaignId,
        "--to",
        "+15550000000",
        "--body",
        "Hi, are you available?",
        "--reason",
        "outside campaign smoke",
      ]),
    ).rejects.toThrow("does not allow this recipient");
  });

  it("authorizes_campaigns_and_records_inbox_digests", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "campaigns",
      "authorize",
      "--purpose",
      "Handyman outreach",
      "--by",
      "Chris",
      "--recipient",
      "+15551234567",
      "--max-sends",
      "2",
    ]);
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "inbox",
      "record",
      "--from",
      "+15551234567",
      "--body",
      "Can you send a Prestigio quote today?",
      "--thread-id",
      "client-thread",
    ]);
    await runCli(["text-mailroom", "--root", root, "inbox", "classify", "client-thread"]);
    await runCli(["text-mailroom", "--root", root, "inbox", "digest"]);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Authorized campaign");
    expect(output).toContain("Recorded inbound client-thread");
    expect(output).toContain("Classified client-thread");
    expect(output).toContain("reply client-thread");
  });
});
