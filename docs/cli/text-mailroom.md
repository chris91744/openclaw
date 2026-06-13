# Text Mailroom CLI

`openclaw text-mailroom` manages a local supervised SMS/iMessage queue. It is designed for Chris's local Text Mailroom workflow: agents may propose, triage, and queue work, but sending requires an approved outbound item plus explicit send opt-ins.

## Store

By default, the CLI uses:

```text
~/.openclaw/workspace/text-mailroom
```

Override it with either:

```bash
openclaw text-mailroom --root /path/to/store ...
OPENCLAW_TEXT_MAILROOM_DIR=/path/to/store openclaw text-mailroom ...
```

The store uses private directories (`0700`) and private JSON/NDJSON files (`0600`).

## Status

Check Text Mailroom readiness without printing BlueBubbles passwords, server URLs, raw phone numbers, or message bodies:

```bash
openclaw text-mailroom status
```

Use JSON for verifiers:

```bash
openclaw text-mailroom --json status
```

The status output reports the store root, whether `channels.bluebubbles` is present/configured, whether `channels.bluebubbles.textMailroom.enabled` is on, allowlist counts, group policy, and the three outbound send gates.

## Enable BlueBubbles Ingest

Plan the live BlueBubbles -> Text Mailroom config change without writing it:

```bash
BLUEBUBBLES_PASSWORD="..." \
openclaw text-mailroom enable-bluebubbles-ingest \
  --server-url "http://host.docker.internal:1234" \
  --password-env BLUEBUBBLES_PASSWORD \
  --allow-from-file ~/.openclaw/credentials/bluebubbles-default-allowFrom.json
```

The command is dry-run by default and prints only a redacted summary. It does not print the server URL, password, or allowlisted recipients.

Apply requires both `--apply` and `--confirm-live-config-change`:

```bash
BLUEBUBBLES_PASSWORD="..." \
openclaw text-mailroom enable-bluebubbles-ingest \
  --server-url "http://host.docker.internal:1234" \
  --password-env BLUEBUBBLES_PASSWORD \
  --allow-from-file ~/.openclaw/credentials/bluebubbles-default-allowFrom.json \
  --apply \
  --confirm-live-config-change
```

This writes `channels.bluebubbles` with `dmPolicy="allowlist"`, `groupPolicy="disabled"`, and `textMailroom.enabled=true`. It does not set `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN` or `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED`.

## Queue And Approval

Queue a proposed text without sending:

```bash
openclaw text-mailroom propose \
  --to "+15551234567" \
  --body "Hi, are you available for a small job?" \
  --reason "authorized handyman campaign"
```

For the "text this person for me" operator path, use `request-send`. By default it only queues:

```bash
openclaw text-mailroom request-send \
  --to "+15551234567" \
  --body "Hi, are you available for a small job?" \
  --reason "Chris requested handyman outreach"
```

If the person is already saved as a Text Mailroom contact, use `--contact-id` instead of retyping the raw phone number:

```bash
openclaw text-mailroom request-send \
  --contact-id contact_... \
  --body "Hi, are you available for a small job?" \
  --reason "Chris requested handyman outreach"
```

It can also approve in the same command without sending:

```bash
openclaw text-mailroom request-send \
  --to "+15551234567" \
  --body "Hi, are you available for a small job?" \
  --reason "Chris requested handyman outreach" \
  --approve-by Chris
```

Adding `--send` is still blocked unless `--confirm-send` is present and both send opt-in environment variables are enabled.

List queued items without raw recipient or body:

```bash
openclaw text-mailroom list
```

Show one item for human review:

```bash
openclaw text-mailroom show outbound_...
```

Approve without sending:

```bash
openclaw text-mailroom approve outbound_... --by Chris
```

Reject:

```bash
openclaw text-mailroom reject outbound_... --by Chris --reason "not now"
```

## Sending

Sending is separate from approval. The CLI refuses to send without `--confirm-send`, and the executor refuses to send unless the item is approved and `OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1` is set. The lower-level BlueBubbles transport remains separately gated by `OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1`.

```bash
OPENCLAW_TEXT_MAILROOM_SEND_OPTIN=1 \
OPENCLAW_BLUEBUBBLES_OUTBOUND_ENABLED=1 \
openclaw text-mailroom send outbound_... --confirm-send
```

The executor recomputes recipient/body hashes before sending, claims the item to prevent concurrent duplicate sends, rejects stale approvals, and records sent/failed state.

If the process crashes after an item is claimed for sending, the claim lock intentionally remains in place so a restart cannot duplicate the text. That fail-closed state requires manual review before removing the matching lock file from the store's `outbound/claims` directory.

## Contacts And Campaigns

Add or update contact identity:

```bash
openclaw text-mailroom contacts upsert \
  --phone "+15551234567" \
  --name "Handyman Lead" \
  --labels "lead,vendor" \
  --source "craigslist"
```

Allowed labels are `known`, `vendor`, `client`, `lead`, `personal`, `unknown`, and `blocked`; invalid labels fail before saving.

List contacts without raw phone numbers:

```bash
openclaw text-mailroom contacts list
```

Search saved contacts without raw phone numbers:

```bash
openclaw text-mailroom contacts search "marina handyman"
```

Authorize a bounded outreach campaign:

```bash
openclaw text-mailroom campaigns authorize \
  --purpose "Handyman outreach" \
  --by Chris \
  --recipient "+15551234567" \
  --recipient "+15557654321" \
  --max-sends 4 \
  --followups \
  --followup-after-ms 172800000
```

List campaigns without raw recipients:

```bash
openclaw text-mailroom campaigns list
```

Campaign sends require the recipient hash to be in the campaign allowlist, the campaign to be unexpired, and the send count to stay under `maxSends`.

Queue a text inside an approved campaign:

```bash
openclaw text-mailroom request-send \
  --kind campaign_outreach \
  --campaign-id campaign_... \
  --to "+15551234567" \
  --body "Hi, are you available for a small job?" \
  --reason "approved handyman campaign"
```

## Inbox And Follow-Ups

Record an inbound message:

```bash
openclaw text-mailroom inbox record \
  --from "+15551234567" \
  --body "Can you send a Prestigio quote today?" \
  --thread-id client-thread
```

Classify and digest:

```bash
openclaw text-mailroom inbox classify client-thread
openclaw text-mailroom inbox digest
```

Queue due follow-ups for campaigns that explicitly allow follow-ups:

```bash
openclaw text-mailroom queue-followups --by agent
```

Export Prestigio-tagged text signals to a local NDJSON handoff:

```bash
openclaw text-mailroom export-prestigio
```

This only writes local signal records; it does not write to the live Prestigio app.
