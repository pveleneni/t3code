# Product analytics

Product analytics is off by default. There is no built-in PostHog key, host, or ingest endpoint:
events leave the server only when the operator configures their own PostHog key and host and
explicitly enables telemetry.

A personal setup sets `T3CODE_TELEMETRY_ENABLED=true`, `T3CODE_POSTHOG_KEY`, and
`T3CODE_POSTHOG_HOST`. `T3CODE_POSTHOG_DISTINCT_ID` defaults to the constant `t3code-fork`; it can
be overridden, but nothing derives it from the machine or account. Batches go to `${host}/batch/`
only. `http` is accepted for localhost; other hosts require `https`.

- No install ID, anonymous ID, device ID, or persistent telemetry identity is created or stored.
- No provider account IDs are read from `~/.codex/auth.json`, `~/.claude.json`, or anywhere else.
- No hostname, username, machine name, OS, architecture, WSL distro, or device model is collected
  for telemetry.
- No client-reported owner hashes, relay traces, or crash reports leave the machine.

Do not reintroduce a system-derived identifier or a default analytics endpoint. Telemetry must stay
opt-in, documented in `docs/user/telemetry.md`, and must not identify the machine or its accounts.
