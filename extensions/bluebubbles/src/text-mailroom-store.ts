import fs from "node:fs/promises";
import path from "node:path";
import {
  textMailroomId,
  textMailroomNow,
  textMailroomSha256,
  type TextMailroomAuditEvent,
} from "./text-mailroom-types.js";

export type TextMailroomStoreOptions = {
  rootDir: string;
  now?: () => Date;
};

export function textMailroomPaths(rootDir: string) {
  return {
    root: rootDir,
    contacts: path.join(rootDir, "contacts"),
    campaigns: path.join(rootDir, "campaigns"),
    outbound: path.join(rootDir, "outbound"),
    outboundItems: path.join(rootDir, "outbound", "items"),
    outboundClaims: path.join(rootDir, "outbound", "claims"),
    inboxThreads: path.join(rootDir, "inbox", "threads"),
    integrations: path.join(rootDir, "integrations"),
    prestigioSignals: path.join(rootDir, "integrations", "prestigio", "signals.ndjson"),
    auditDir: path.join(rootDir, "audit"),
    auditEvents: path.join(rootDir, "audit", "events.ndjson"),
  };
}

export async function ensureTextMailroomStore(rootDir: string): Promise<void> {
  const dirs = textMailroomPaths(rootDir);
  await Promise.all(
    [
      dirs.root,
      dirs.contacts,
      dirs.campaigns,
      dirs.outbound,
      dirs.outboundItems,
      dirs.outboundClaims,
      dirs.inboxThreads,
      dirs.integrations,
      path.dirname(dirs.prestigioSignals),
      dirs.auditDir,
    ].map(ensurePrivateDir),
  );
}

export async function readPrivateJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(tempPath, 0o600);
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
}

export async function listPrivateJson<T>(dir: string): Promise<T[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const out: T[] = [];
  for (const entry of entries.toSorted()) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const value = await readPrivateJson<T>(path.join(dir, entry));
    if (value) {
      out.push(value);
    }
  }
  return out;
}

export async function appendPrivateNdjson(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600);
}

export async function appendTextMailroomAudit(
  options: TextMailroomStoreOptions,
  event: Omit<TextMailroomAuditEvent, "id" | "at">,
): Promise<void> {
  const paths = textMailroomPaths(options.rootDir);
  await appendPrivateNdjson(paths.auditEvents, {
    id: textMailroomId("audit"),
    at: textMailroomNow(options.now),
    ...event,
  } satisfies TextMailroomAuditEvent);
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

export function safeFileStem(value: string): string {
  return textMailroomSha256(value).slice(0, 32);
}
