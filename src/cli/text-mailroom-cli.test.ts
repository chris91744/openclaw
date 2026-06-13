import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeFileStem,
  textMailroomPaths,
} from "../../extensions/bluebubbles/src/text-mailroom-store.js";
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
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "approve",
      queued.id,
      "--by",
      "Chris",
      "--confirm-high-risk",
    ]);

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
      risk: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");
    expect(queued.risk).toBe("high");
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret request-send body");
  });

  it("request_send_dedupes_retries_by_request_id", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runCli([
        "text-mailroom",
        "--root",
        root,
        "--json",
        "request-send",
        "--to",
        "+15551234567",
        "--body",
        "Secret retry body",
        "--reason",
        "operator retry smoke",
        "--request-id",
        "operator-request-1",
      ]);
    }
    const first = JSON.parse(String(log.mock.calls.at(-2)?.[0])) as {
      id: string;
      requestId?: string;
    };
    const second = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      id: string;
      requestId?: string;
    };
    expect(second.id).toBe(first.id);
    expect(second.requestId).toBe("operator-request-1");

    log.mockClear();
    await runCli(["text-mailroom", "--root", root, "list"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output.match(/operator retry smoke/g)).toHaveLength(1);
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret retry body");

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--to",
        "+15551234567",
        "--body",
        "Different retry body",
        "--reason",
        "operator retry collision",
        "--request-id",
        "operator-request-1",
      ]),
    ).rejects.toThrow("request_id already exists with different outbound payload");
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
      risk: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.contactId).toBe(contact.contactId);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");
    expect(queued.risk).toBe("medium");

    await runCli(["text-mailroom", "--root", root, "list"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("operator contact shortcut smoke");
    expect(output).toContain("risk=medium");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret contact-id body");
  });

  it("request_send_can_queue_by_unique_contact_name_without_echoing_the_raw_phone_or_body", async () => {
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
      "Marina Handyman",
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
      "--contact",
      "marina handyman",
      "--body",
      "Secret contact-name body",
      "--reason",
      "operator natural contact smoke",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      id: string;
      contactId?: string;
      stage: string;
      status: string;
      risk: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.contactId).toBe(contact.contactId);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");
    expect(queued.risk).toBe("medium");

    await runCli(["text-mailroom", "--root", root, "list"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("operator natural contact smoke");
    expect(output).toContain("risk=medium");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret contact-name body");
  });

  it("contacts_search_returns_safe_matching_contact_summaries", async () => {
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
      "Marina Handyman",
      "--labels",
      "lead,vendor",
      "--source",
      "craigslist",
    ]);
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "contacts",
      "upsert",
      "--phone",
      "+15557654321",
      "--name",
      "Window Installer",
      "--labels",
      "vendor",
      "--source",
      "referral",
    ]);
    log.mockClear();

    await runCli(["text-mailroom", "--root", root, "--json", "contacts", "search", "marina"]);
    const results = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Array<{
      contactId: string;
      displayName?: string;
      labels: string[];
      phone?: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.displayName).toBe("Marina Handyman");
    expect(results[0]?.labels).toEqual(["lead", "vendor"]);
    expect(results[0]).not.toHaveProperty("phone");

    log.mockClear();
    await runCli(["text-mailroom", "--root", root, "contacts", "search", "vendor"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Marina Handyman");
    expect(output).toContain("Window Installer");
    expect(output).toContain("lead,vendor");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("+15557654321");
  });

  it("contacts_upsert_rejects_invalid_labels", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "contacts",
        "upsert",
        "--phone",
        "+15551234567",
        "--name",
        "Invalid Label Contact",
        "--labels",
        "vendor,vip",
      ]),
    ).rejects.toThrow("contact label is invalid: vip");

    await runCli(["text-mailroom", "--root", root, "contacts", "list"]);
    expect(String(log.mock.calls.at(-1)?.[0])).toBe("No Text Mailroom contacts.");
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
    ).rejects.toThrow("only one of --to, --contact-id, or --contact");
  });

  it("request_send_rejects_ambiguous_contact_queries", async () => {
    const root = await makeRoot();
    vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "contacts",
      "upsert",
      "--phone",
      "+15551234567",
      "--name",
      "Marina Handyman One",
      "--labels",
      "vendor",
    ]);
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "contacts",
      "upsert",
      "--phone",
      "+15557654321",
      "--name",
      "Marina Handyman Two",
      "--labels",
      "vendor",
    ]);

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-send",
        "--contact",
        "vendor",
        "--body",
        "hello",
        "--reason",
        "ambiguous contact smoke",
      ]),
    ).rejects.toThrow("matched multiple contacts");
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

  it("approve_refuses_high_risk_items_without_explicit_high_risk_confirmation", async () => {
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
      "High risk body",
      "--reason",
      "high risk approval smoke",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { id: string };

    await expect(
      runCli(["text-mailroom", "--root", root, "approve", queued.id, "--by", "Chris"]),
    ).rejects.toThrow("high-risk approval requires confirmHighRisk");
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "approve",
      queued.id,
      "--by",
      "Chris",
      "--confirm-high-risk",
    ]);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain(`Approved ${queued.id}`);
  });

  it("request_send_does_not_allow_explicit_risk_to_downgrade_unknown_recipients", async () => {
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
      "Risk downgrade body",
      "--reason",
      "risk downgrade smoke",
      "--risk",
      "low",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { risk: string };
    expect(queued.risk).toBe("high");
  });

  it("request_reply_queues_from_an_inbox_thread_without_echoing_sender_or_body", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "inbox",
      "record",
      "--from",
      "+15551234567",
      "--body",
      "Secret inbound body",
      "--thread-id",
      "handyman-thread",
    ]);
    await runCli([
      "text-mailroom",
      "--root",
      root,
      "--json",
      "request-reply",
      "handyman-thread",
      "--body",
      "Secret reply body",
      "--reason",
      "operator thread reply smoke",
    ]);
    const queued = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      id: string;
      stage: string;
      status: string;
      kind: string;
      threadId?: string;
      risk: string;
    };
    expect(queued.id).toMatch(/^outbound_/);
    expect(queued.stage).toBe("queued");
    expect(queued.status).toBe("queued");
    expect(queued.kind).toBe("conversation_reply");
    expect(queued.threadId).toBe("handyman-thread");
    expect(queued.risk).toBe("high");

    await runCli(["text-mailroom", "--root", root, "list"]);
    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("operator thread reply smoke");
    expect(output).toContain("risk=high");
    expect(output).not.toContain("+15551234567");
    expect(output).not.toContain("Secret inbound body");
    expect(output).not.toContain("Secret reply body");
  });

  it("request_reply_refuses_do_not_contact_threads_before_queueing", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "inbox",
      "record",
      "--from",
      "+15551234567",
      "--body",
      "Stop texting this number",
      "--thread-id",
      "stop-thread",
    ]);
    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-reply",
        "stop-thread",
        "--body",
        "Sorry",
        "--reason",
        "blocked reply smoke",
      ]),
    ).rejects.toThrow("do_not_contact threads");

    await runCli(["text-mailroom", "--root", root, "list"]);
    expect(String(log.mock.calls.at(-1)?.[0])).toBe("No outbound queue items.");
  });

  it("request_reply_refuses_closed_threads_before_queueing", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});
    const threadId = "closed-thread";

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "inbox",
      "record",
      "--from",
      "+15551234567",
      "--body",
      "hello",
      "--thread-id",
      threadId,
    ]);
    const threadPath = path.join(
      textMailroomPaths(root).inboxThreads,
      `${safeFileStem(threadId)}.json`,
    );
    const thread = JSON.parse(await fs.readFile(threadPath, "utf8")) as { status: string };
    await fs.writeFile(threadPath, JSON.stringify({ ...thread, status: "closed" }, null, 2));

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-reply",
        threadId,
        "--body",
        "hello back",
        "--reason",
        "closed reply smoke",
      ]),
    ).rejects.toThrow("closed threads");

    await runCli(["text-mailroom", "--root", root, "list"]);
    expect(String(log.mock.calls.at(-1)?.[0])).toBe("No outbound queue items.");
  });

  it("request_reply_refuses_send_without_confirm_before_queueing", async () => {
    const root = await makeRoot();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await runCli([
      "text-mailroom",
      "--root",
      root,
      "inbox",
      "record",
      "--from",
      "+15551234567",
      "--body",
      "hello",
      "--thread-id",
      "reply-thread",
    ]);

    await expect(
      runCli([
        "text-mailroom",
        "--root",
        root,
        "request-reply",
        "reply-thread",
        "--body",
        "hello back",
        "--reason",
        "reply smoke",
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
        "--confirm-high-risk",
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
