# Text Mailroom Loose-Thread History Scan Packet

Scope: read-only BlueBubbles history scan plus gated local Text Mailroom import.

## What Changed

1. Added a read-only BlueBubbles history adapter:
   - `extensions/bluebubbles/src/history-read.ts`
   - `extensions/bluebubbles/src/history-read.test.ts`
   - Uses `POST /api/v1/message/query` through the normal non-outbound fetch helper.
   - Normalizes SMS/iMessage direct messages, unsaved handles, timestamps, body hashes, sender hashes, provider message ids, and stable Text Mailroom thread ids.
   - Static tests assert no imports from send/media/reaction/chat/channel modules and no send gate references.

2. Added deterministic loose-thread scanning:
   - `extensions/bluebubbles/src/text-mailroom-history-scan.ts`
   - `extensions/bluebubbles/src/text-mailroom-history-scan.test.ts`
   - Groups history by thread, keeps direct messages only, requires last message inbound, skips too-recent messages, skips do-not-contact language, and flags question/request/scheduling/vendor/payment/Prestigio signals.
   - Safe summaries contain only thread ids, sender/body hashes, timestamps, priorities, tags, reasons, and counts.

3. Added idempotent import:
   - `recordTextMailroomInbound` now accepts an optional `providerMessageId`.
   - Replays with the same provider id and same content return the existing thread.
   - Same provider id with different content fails closed.
   - BlueBubbles live webhook ingestion now passes `bluebubbles:<accountId>:<messageId>` so live-ingested messages and history scans can dedupe.
   - History imports use source `history-scan` and provider key `bluebubbles-history:<messageId>`.

4. Added CLI commands:
   - `openclaw text-mailroom probe-history`
   - `openclaw text-mailroom scan-history`
   - `scan-history` defaults to dry-run: last 14 days, direct messages only, groups excluded, no imports.
   - Import requires `--apply --confirm-import`.
   - `inbox digest --json` now omits body-derived `summary`; plain digest was already summary-safe.

5. Updated docs and local operating layer:
   - `docs/cli/text-mailroom.md`
   - `/Users/chrisreyes/.codex/skills/sms-supervisor/SKILL.md`
   - The phrase "scan my texts for loose threads" now maps to a dry-run scan, not raw file reads, drafting, or sending.

## Safety Invariants

- No send gates are enabled or changed.
- The history reader imports no outbound send modules.
- The history scanner imports no outbound queue/send modules.
- Dry-run is the default.
- Local import requires both `--apply` and `--confirm-import`.
- Normal JSON/human output does not include raw phone numbers, message bodies, BlueBubbles server URLs, passwords, or full API URLs.
- Groups are excluded in v1.
- Text bodies are treated as data only; there is no LLM classifier in this pass.

## Verification Commands Run

```bash
./node_modules/.bin/vitest run extensions/bluebubbles/src/history-read.test.ts extensions/bluebubbles/src/text-mailroom-history-scan.test.ts extensions/bluebubbles/src/text-mailroom-inbox.test.ts src/cli/text-mailroom-cli.test.ts
```

Result: 4 test files passed, 49 tests passed.

```bash
./node_modules/.bin/oxfmt --check extensions/bluebubbles/src/history-read.ts extensions/bluebubbles/src/history-read.test.ts extensions/bluebubbles/src/text-mailroom-history-scan.ts extensions/bluebubbles/src/text-mailroom-history-scan.test.ts extensions/bluebubbles/src/text-mailroom-inbox.ts extensions/bluebubbles/src/text-mailroom-inbox.test.ts extensions/bluebubbles/src/text-mailroom-types.ts extensions/bluebubbles/src/text-mailroom-bridge.ts src/cli/text-mailroom-cli.ts src/cli/text-mailroom-cli.test.ts docs/cli/text-mailroom.md
```

Result: all matched files use the correct format.

```bash
./node_modules/.bin/vitest run extensions/bluebubbles/src/ src/cli/text-mailroom-cli.test.ts
```

Result: 16 test files passed, 342 tests passed.

## Typecheck Caveat

Full-project `tsgo --noEmit --pretty false` remains red because of pre-existing repo-wide dependency/type issues outside this slice, including missing optional extension dependencies and a pre-existing `text-mailroom-outbound.ts` warning. A targeted file-mode `tsgo` run is not useful here because it drops the repo tsconfig/path-alias context and reports unrelated module-resolution noise.

## Known Limitations

- The BlueBubbles history endpoint shape is covered by mocked fixtures only. Before relying on live history, run `openclaw text-mailroom probe-history`; it prints only counts and response shape.
- Scan results are BlueBubbles-indexed only. Texts unavailable to BlueBubbles are outside v1 coverage.
- v1 scans direct messages only. Group chats are intentionally excluded.
- The scanner is deterministic only. No LLM is used over historical message bodies in this pass.
- Importing scan candidates creates local Text Mailroom inbox entries; it does not draft, approve, or send replies.
