# Self-hosted Cloudflare Tunnel

A server can publish its own Cloudflare Tunnel instead of using a hosted relay. Set all of these
environment variables before starting the server:

| Variable                            | Meaning                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `T3CODE_CLOUDFLARE_API_TOKEN`       | Cloudflare API token with **Tunnel:Edit** and **DNS:Edit** for the zone.                                   |
| `T3CODE_CLOUDFLARE_ACCOUNT_ID`      | Cloudflare account that owns the tunnel.                                                                   |
| `T3CODE_CLOUDFLARE_ZONE_ID`         | Cloudflare zone that owns the hostname.                                                                    |
| `T3CODE_CLOUDFLARE_TUNNEL_HOSTNAME` | Public hostname, e.g. `t3.example.com`.                                                                    |
| `T3CODE_CLOUDFLARE_TUNNEL_NAME`     | Optional tunnel name; defaults to `t3code-fork` and is sanitized to lowercase letters, digits and hyphens. |

If any required variable is missing or blank, the feature is disabled and the server uses its
normal connection paths.

On startup the server finds or creates the named tunnel, points its ingress at the server's
loopback origin with a fallback `http_status:404` rule, reads a connector token, and creates or
updates a proxied CNAME from the hostname to `<tunnel-id>.cfargotunnel.com`. It then starts a local
connector with that token and advertises `https://<hostname>/` as a public direct endpoint to
clients. Provisioning failures are logged as warnings and do not stop the server.

Direct tunnel mode takes precedence: when it is enabled, relay-managed tunnel startup is skipped.
A relay link established later in the running server can still change the connector configuration;
restart the server to reassert the direct configuration.

On shutdown only the connector is stopped. The tunnel, its configuration, and the DNS record are
left in place for the next start; nothing is deleted automatically. Pointing the hostname at a
different service requires changing the DNS record yourself.
