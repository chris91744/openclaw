import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../runtime.js";
import { registerTextMailroomCli } from "./text-mailroom-cli.js";

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
