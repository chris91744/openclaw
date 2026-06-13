# Text Mailroom Completion Packet

This packet documents the post-Slice-3B completion branch for Claude verification.

## Branch Context

- Worktree: `/Users/chrisreyes/Documents/Codex/2026-06-11/can-you-scrape-craiglist-for-me/work/openclaw-text-mailroom-completion`
- Branch: `codex/text-mailroom-completion`
- Base checkpoint: `fork/codex/openclaw-local-services-base` at merge commit `b6417b50c33f036c6c59421478e334ce01cd274d`
- Live services: not restarted
- Outbound sending: not enabled

## Completed Build Order

1. Outbound approval queue
   - `text-mailroom-outbound.ts`
   - Agents can queue proposed outbound items.
   - Items store recipient/body hashes and approval state.

2. Human approval surface
   - `src/cli/text-mailroom-cli.ts`
   - `openclaw text-mailroom` provides `list`, `show`, `propose`, `approve`, `reject`, and `send`.
   - `list` avoids raw recipient/body output; `show` is the deliberate human review view.

3. Approved-only sender
   - `sendApprovedTextMailroomOutbound`
   - Requires approved status, matching approval hashes, fresh approval timestamp, an exclusive send claim, and `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1`.
   - The underlying BlueBubbles transport still separately requires `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1`.

4. Contacts and identity
   - `upsertTextMailroomContact`
   - Contacts store labels such as `known`, `vendor`, `client`, `lead`, `personal`, `unknown`, and `blocked`.
   - Blocked contacts cannot be queued.

5. Campaign authorization
   - `authorizeTextMailroomCampaign`
   - Campaigns require explicit approver, allowed recipient hashes, `maxSends`, optional expiry, and explicit follow-up permission.
   - Campaign outbound proposals fail closed outside those bounds.

6. Inbox/Text Mailroom
   - `text-mailroom-inbox.ts`
   - Inbound texts can be recorded, classified, digested, and held as local data.
   - Classifier is deterministic and rule-based in this slice; no LLM tools are exposed.

7. Follow-up logic
   - `findTextMailroomFollowUps`
   - `queueTextMailroomFollowUps`
   - Follow-ups only queue proposed outbound items; they do not send.
   - Follow-up queuing dedupes existing queued/approved/sending/sent follow-ups.

8. Prestigio integration hook
   - `exportPrestigioTextSignals`
   - Prestigio-tagged threads export local NDJSON signal records only.
   - No live Prestigio write service is called.

9. Hardening and audit
   - Private file store helpers in `text-mailroom-store.ts`.
   - Audit logs record metadata and hashes, not raw phone numbers or message bodies.
   - Tests cover blocked contacts, campaign boundaries, approval binding, stale approvals, concurrent send claim, follow-up dedupe, CLI list privacy, and send confirmation.

## Safety Invariants

- Existing `mailroom.ts` stays read-only and has no outbound verb.
- Generic BlueBubbles outbound remains gated by `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED`.
- Text Mailroom approved sending adds a second gate: `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN`.
- Approval binds to recipient hash and body hash.
- Mutating the body after approval fails closed.
- Stale approvals fail closed.
- Concurrent sends fail closed through an exclusive claim file.
- Concurrent campaign sends also serialize through a campaign-level claim file, so campaign send caps cannot be overrun by parallel approved items.
- A crash after claiming a send leaves the claim lock in place by design; manual review is required before clearing it.
- Campaign authorization is explicit, scoped, capped, and optionally expiring.
- Follow-up logic queues only; it never sends automatically.
- Prestigio integration is a local signal export only.

## Validation Run

Focused suite:

```bash
./node_modules/.bin/vitest run \
  extensions/bluebubbles/src/text-mailroom-outbound.test.ts \
  extensions/bluebubbles/src/text-mailroom-inbox.test.ts \
  src/cli/text-mailroom-cli.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       13 passed (13)
```

Broader BlueBubbles/config regression:

```bash
./node_modules/.bin/vitest run extensions/bluebubbles/src/ src/config/plugin-auto-enable.test.ts
```

Result:

```text
Test Files  14 passed (14)
Tests       301 passed (301)
```

Legacy iMessage hardening regression:

```bash
node --check imessage-service/index.js
node --test imessage-service/index.test.js
```

Result:

```text
node --check passed
tests 9
pass 9
fail 0
```

Format check:

```bash
./node_modules/.bin/oxfmt --check <touched files>
```

Result:

```text
All matched files use the correct format.
```

Typecheck:

```bash
./node_modules/.bin/tsgo
```

Result: still exits `2` because of the known optional extension/UI dependency noise already seen before this slice (`diagnostics-otel`, `matrix`, `memory-lancedb`, `twitch`, `ui`, etc.). After fixing one new local type error, the remaining output contains no `text-mailroom` files and no `src/cli/text-mailroom-cli.ts` errors.

## Known Non-Goals In This Slice

- No live service restart.
- No live SMS/iMessage send.
- No web UI.
- No automatic Prestigio writes.
- No LLM-driven send authority.
- No upstream OpenClaw PR.

## Suggested Claude Verification

Claude should verify:

- Branch/base facts.
- File diff scope.
- The read-only `mailroom.ts` invariant still holds.
- Focused tests pass.
- No direct live-service/config changes occurred.
- Sending still requires both opt-in env vars.
