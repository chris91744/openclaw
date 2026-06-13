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
   - `--approve-by Chris` approves without sending.
   - `--send` requires `--confirm-send` before any send attempt.
   - The underlying sender still requires `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1`.
   - The BlueBubbles transport still separately requires `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1`.

3. Redacted readiness helper
   - New CLI: `openclaw text-mailroom status`.
   - Reports whether BlueBubbles and Text Mailroom ingestion are configured without printing server URLs, passwords, raw phone numbers, or message bodies.
   - Reports the three outbound send gates so operators can verify that real sends remain disabled.

4. Safer operator lookup helpers
   - `openclaw text-mailroom contacts list` lists contact ids, labels, and names without raw phone numbers.
   - `openclaw text-mailroom campaigns list` lists campaign ids, purposes, and send counts without raw recipients.
   - `request-send --campaign-id ... --kind campaign_outreach` reuses existing campaign recipient/cap/expiry checks.

## Safety Invariants

- No environment send opt-ins are set by this branch.
- No live config is edited by this branch.
- Inbound ingestion is opt-in via config and records local store files only.
- Text Mailroom send remains approval-bound and env-gated.
- The BlueBubbles transport remains separately env-gated.
- `text-mailroom status` redacts BlueBubbles server URLs, passwords, raw phone numbers, and message bodies.
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

Latest result: 4 files / 82 tests passed.

Broader:

```bash
./node_modules/.bin/vitest run \
  extensions/bluebubbles/src/ \
  src/cli/text-mailroom-cli.test.ts \
  src/config/plugin-auto-enable.test.ts \
  src/config/config.schema-regressions.test.ts \
  src/config/config.plugin-validation.test.ts
```

Latest result: 17 files / 323 tests passed.

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
