# Text Mailroom Live-Send Workflow Packet

This packet documents the branch that moves Text Mailroom from a safe queue foundation toward the operator request: "text this person for me."

## Branch Context

- Worktree: `/Users/chrisreyes/Documents/Codex/2026-06-11/can-you-scrape-craiglist-for-me/work/openclaw-text-mailroom-completion`
- Branch: `codex/text-mailroom-live-send-workflow`
- Base: `fork/codex/openclaw-local-services-base` at `eaf8b99c7edddbd7ac9541223b275662b9bd4087`
- Live outbound sending: not enabled
- Live SMS/iMessage sends: not performed

## What This Adds

1. BlueBubbles inbound ingestion into Text Mailroom
   - New explicit config: `channels.bluebubbles.textMailroom.enabled`.
   - Direct messages are recorded by default when enabled.
   - Groups are skipped unless `includeGroups=true`.
   - Thread ids are hashed/stable and do not embed raw phone numbers.
   - Ingestion runs before allowlist/pairing/agent-reply handling, so unknown senders can be captured for review without triggering replies.
   - Ingestion errors log only sender/body hashes and lengths.

2. Operator shortcut for "text this person for me"
   - New CLI: `openclaw text-mailroom request-send`.
   - Default behavior queues only.
   - Supports `--contact-id contact_...` so saved contacts can be queued without retyping raw phone numbers.
   - Supports `--contact <query>` for a saved contact id, exact name, exact label, or unique name fragment.
   - `--to`, `--contact-id`, and `--contact` are mutually exclusive to avoid recipient/contact mismatch.
   - Ambiguous contact lookups fail closed and require `--contact-id`.
   - Risk is inferred when `--risk` is omitted: raw/unknown recipients are high risk, leads/personal contacts are medium risk, known/vendor/client contacts are low risk, and campaign/follow-up sends are high risk.
   - `--approve-by Chris` approves without sending.
   - `--send` requires `--confirm-send` before any send attempt.
   - The underlying sender still requires `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1`.
   - The BlueBubbles transport still separately requires `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1`.

3. Operator shortcut for replying to an inbound text
   - New CLI: `openclaw text-mailroom request-reply <threadId>`.
   - Resolves the recipient from the inbox thread and queues a `conversation_reply`.
   - Default behavior queues only.
   - Safe summaries include the thread id and risk, but not the raw sender or body.
   - `--send` requires `--approve-by` and `--confirm-send`, then still hits the same env gates.

4. Redacted readiness helper
   - New CLI: `openclaw text-mailroom status`.
   - Reports whether BlueBubbles and Text Mailroom ingestion are configured without printing server URLs, passwords, raw phone numbers, or message bodies.
   - Reports the three outbound send gates so operators can verify that real sends remain disabled.

5. Safer operator lookup helpers
   - `openclaw text-mailroom contacts list` lists contact ids, labels, and names without raw phone numbers.
   - `openclaw text-mailroom campaigns list` lists campaign ids, purposes, and send counts without raw recipients.
   - `request-send --campaign-id ... --kind campaign_outreach` reuses existing campaign recipient/cap/expiry checks.

6. Dry-run-first BlueBubbles config helper
   - New CLI: `openclaw text-mailroom enable-bluebubbles-ingest`.
   - Dry-run is the default.
   - Passwords are supplied through an environment variable name, not a direct CLI argument.
   - `--apply` requires `--confirm-live-config-change`.
   - The redacted summary omits server URLs, passwords, and allowlisted recipients.
   - The helper writes `channels.bluebubbles` only; it does not set outbound send env gates.

## Safety Invariants

- No environment send opt-ins are set by this branch.
- No live config is edited unless an operator explicitly runs `enable-bluebubbles-ingest --apply --confirm-live-config-change`.
- Inbound ingestion is opt-in via config and records local store files only.
- Text Mailroom send remains approval-bound and env-gated.
- The BlueBubbles transport remains separately env-gated.
- `request-send --contact-id` and `request-send --contact` resolve stored contacts internally and keep list/request summaries redacted.
- Ambiguous `request-send --contact` lookups refuse before queueing.
- Omitted risk is inferred in the queue layer, not just the CLI, and explicit `--risk` still overrides inference.
- `request-reply` resolves recipients from stored threads and refuses missing `--confirm-send` before queueing any send attempt.
- `text-mailroom status` redacts BlueBubbles server URLs, passwords, raw phone numbers, and message bodies.
- `enable-bluebubbles-ingest` dry-runs by default and its summary redacts BlueBubbles server URLs, passwords, and allowlisted recipients.
- Campaign sends are still bounded by allowed recipient hashes, expiry, max sends, and campaign send locks.
- List commands avoid raw phone numbers and message bodies.

## Verification To Run

Focused:

```bash
./node_modules/.bin/vitest run \
  src/cli/text-mailroom-cli.test.ts \
  extensions/bluebubbles/src/monitor.test.ts \
  extensions/bluebubbles/src/text-mailroom-inbox.test.ts \
  extensions/bluebubbles/src/text-mailroom-outbound.test.ts
```

Latest result: 4 files / 90 tests passed.

Broader:

```bash
./node_modules/.bin/vitest run \
  extensions/bluebubbles/src/ \
  src/cli/text-mailroom-cli.test.ts \
  src/config/plugin-auto-enable.test.ts \
  src/config/config.schema-regressions.test.ts \
  src/config/config.plugin-validation.test.ts
```

Latest result: 17 files / 331 tests passed.

Format:

```bash
./node_modules/.bin/oxfmt --check \
  extensions/bluebubbles/src/config-schema.ts \
  extensions/bluebubbles/src/monitor-processing.ts \
  extensions/bluebubbles/src/monitor.test.ts \
  extensions/bluebubbles/src/text-mailroom-bridge.ts \
  extensions/bluebubbles/src/text-mailroom-outbound.ts \
  extensions/bluebubbles/src/types.ts \
  src/cli/text-mailroom-cli.ts \
  src/cli/text-mailroom-cli.test.ts
```

## Remaining Stop Gate

The system is not allowed to send real texts until Chris explicitly approves enabling:

- `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1`
- `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1`
