# Product usage data

Product usage data is off by default. It does not create or persist an install ID, does not read
Claude or Codex account files, does not hash account identifiers, and does not collect machine
names, hostnames, OS versions, architectures, WSL distro names, or device models. Relay traces and
mobile crash reports are disabled.

## Send product events to your own PostHog

Set all three variables before starting the server to send events to a PostHog project you control:

- `T3CODE_TELEMETRY_ENABLED=true`
- `T3CODE_POSTHOG_KEY` with your project's API key
- `T3CODE_POSTHOG_HOST` with your PostHog host (for example `https://posthog.example.com`)

There is no default key or host. If the flag is unset or false, or either value is empty, no events
are buffered or sent. `T3CODE_POSTHOG_DISTINCT_ID` is optional and defaults to the constant
`t3code-fork`; no machine, hostname, username, OS, architecture, or account detail is added to it or
to event properties. Events are batched to `POST {host}/batch/`. `http` is allowed for localhost;
other hosts require `https`. To stop sending, remove the configuration and restart the server.

Relay diagnostics and crash reports remain disabled in this fork.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the T3 Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
product events and relay diagnostics.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

## Export diagnostics to your own receiver

OpenTelemetry export is opt-in and goes only to the receiver you configure. To send traces,
metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `T3CODE_OTLP_*_URL`, set `T3CODE_OTLP_HEADERS` for
receivers that need authentication and `T3CODE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
