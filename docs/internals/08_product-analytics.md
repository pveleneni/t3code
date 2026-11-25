# Product analytics

The server owns analytics delivery for every connected client. Clients never load an analytics
browser SDK, and visiting hosted web without an authenticated connection does not count as product
use.

Product analytics is off by default. There is no built-in PostHog key, host, or ingest endpoint:
events leave the server only when the operator configures their own PostHog key and host and
explicitly enables telemetry.

A personal setup sets `T3CODE_TELEMETRY_ENABLED=true`, `T3CODE_POSTHOG_KEY`, and
`T3CODE_POSTHOG_HOST`. `T3CODE_POSTHOG_DISTINCT_ID` defaults to the constant `t3code-fork`; it can
be overridden, but nothing derives it from the machine or account. Batches go to `${host}/batch/`
only. `http` is accepted for localhost; other hosts require `https`.

## Identity

- No install ID, anonymous ID, device ID, or persistent telemetry identity is created or stored.
- No provider account IDs are read from `~/.codex/auth.json`, `~/.claude.json`, or anywhere else.
- No hostname, username, machine name, OS, architecture, WSL distro, or device model is collected
  for telemetry.
- No client-reported owner hashes, relay traces, or crash reports leave the machine.

## Attribution boundaries

- Client dimensions (`surface`, etc.) belong to the event's WebSocket connection, never a
  server-global "current client". Keep client and server dimensions separate, and leave missing
  client metadata unknown rather than backfilling from server properties.
- Active-use reports count `client.turn.requested` (deduplicated by command ID), not connections
  (T3 Connect sessions renew hourly).

## Collection boundary and delivery

- Payloads stay strictly to product metadata, closed contract enums, and normalized measurements:
  never attach prompts, file paths, credentials, raw provider payloads, device names, conversation
  IDs, or user-named provider instance IDs. Models in the bundled manifest or a vendor's own
  model list report their catalog slug, with aliases and routed IDs mapped to it. Any other model
  ID can name a user, a deployment, or a local file, so it reports only `custom:<driver>`.
- The sole exception is opt-in `agent.feedback`, which
  [`FeedbackService`](../../apps/server/src/feedback/FeedbackService.ts) scrubs of paths, private
  values, and secret-shaped strings, and only attaches bounded conversation traces when the user
  explicitly previews and sends them. Each report is sent under its own id, in a request of its
  own, so it links to no other report; reports sent without a preview carry only their categories.
- Delivery ([`AnalyticsService.ts`](../../apps/server/src/telemetry/AnalyticsService.ts)) attaches a
  UUID per event, backs off on failure, and drops batches after bounded retries so a stuck batch
  cannot loop forever.
- This fork never enables telemetry from CI detection, a managed policy, or host facts. It is on
  only with the explicit PostHog configuration above.

Do not reintroduce a system-derived identifier or a default analytics endpoint. Telemetry must stay
opt-in, documented in `docs/user/telemetry.md`, and must not identify the machine or its accounts.
