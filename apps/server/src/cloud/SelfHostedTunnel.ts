import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as DirectEndpoints from "../environment/DirectEndpoints.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TUNNEL_NAME = "t3code-fork";

const TUNNEL_STAGES = [
  "find-tunnel",
  "create-tunnel",
  "configure-ingress",
  "read-token",
  "find-dns-record",
  "upsert-dns-record",
] as const;

export class SelfHostedTunnelError extends Schema.TaggedError<SelfHostedTunnelError>()(
  "SelfHostedTunnelError",
  {
    stage: Schema.Literals(TUNNEL_STAGES),
    status: Schema.optional(Schema.Number),
    details: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (HTTP ${this.status})`;
    const detail = this.details[0] ?? "the Cloudflare API request failed";
    return `Self-hosted Cloudflare Tunnel: ${this.stage} failed${status}: ${detail}`;
  }
}

interface SelfHostedTunnelConfig {
  readonly apiToken: string;
  readonly accountId: string;
  readonly zoneId: string;
  readonly hostname: string;
  readonly tunnelName: string;
}

/** Cloudflare tunnel names are DNS labels; keep an operator-supplied name usable. */
function sanitizeTunnelName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/gu, "");
  return name === "" ? DEFAULT_TUNNEL_NAME : name;
}

function readConfig(env: NodeJS.ProcessEnv): SelfHostedTunnelConfig | null {
  const required = (value: string | undefined) => (value ?? "").trim();
  const apiToken = required(env.T3CODE_CLOUDFLARE_API_TOKEN);
  const accountId = required(env.T3CODE_CLOUDFLARE_ACCOUNT_ID);
  const zoneId = required(env.T3CODE_CLOUDFLARE_ZONE_ID);
  const hostname = required(env.T3CODE_CLOUDFLARE_TUNNEL_HOSTNAME)
    .toLowerCase()
    .replace(/\.$/u, "");
  if (!apiToken || !accountId || !zoneId || !hostname) return null;
  return {
    apiToken,
    accountId,
    zoneId,
    hostname,
    tunnelName: sanitizeTunnelName(
      required(env.T3CODE_CLOUDFLARE_TUNNEL_NAME) || DEFAULT_TUNNEL_NAME,
    ),
  };
}

const envelopeSchema = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  result: Schema.Unknown,
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        code: Schema.optional(Schema.Number),
        message: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const tunnelSchema = Schema.Struct({ id: Schema.String, name: Schema.String });
const dnsRecordSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

function failure(
  stage: SelfHostedTunnelError["stage"],
  status: number | undefined,
  errors: ReadonlyArray<{ readonly message?: string | undefined }> | undefined,
): SelfHostedTunnelError {
  const details = (errors ?? [])
    .flatMap((error) => (error.message ?? "").trim().slice(0, 200))
    .filter((message) => message !== "")
    .slice(0, 3);
  return new SelfHostedTunnelError({ stage, status, details });
}

/**
 * All Cloudflare v4 calls share one request shape, so the fake-client tests pin
 * the paths and payloads the tunnel provisioning depends on.
 */
const cloudflareRequest = <A>(
  client: HttpClient.HttpClient,
  config: SelfHostedTunnelConfig,
  stage: SelfHostedTunnelError["stage"],
  method: "GET" | "POST" | "PUT",
  path: string,
  query: Readonly<Record<string, string>> | undefined,
  payload: unknown | undefined,
  resultSchema: Schema.ConstraintDecoder<A>,
): Effect.Effect<A, SelfHostedTunnelError> =>
  Effect.scoped(
    Effect.gen(function* () {
      let request = HttpClientRequest.make(method)(`${CLOUDFLARE_API_BASE_URL}${path}`).pipe(
        HttpClientRequest.bearerToken(config.apiToken),
        HttpClientRequest.acceptJson,
      );
      for (const [key, value] of Object.entries(query ?? {})) {
        request = HttpClientRequest.appendUrlParam(key, value)(request);
      }
      if (payload !== undefined) {
        request = yield* HttpClientRequest.bodyJson(payload)(request).pipe(
          Effect.mapError(() => failure(stage, undefined, undefined)),
        );
      }

      const response = yield* client
        .execute(request)
        .pipe(Effect.mapError(() => failure(stage, undefined, undefined)));
      const body = yield* response.json.pipe(Effect.orElseSucceed(() => null));
      const envelope = Schema.decodeUnknownOption(envelopeSchema)(body);
      if (Option.isNone(envelope)) {
        return yield* failure(stage, response.status, undefined);
      }
      const { success, errors } = envelope.value;
      if (response.status < 200 || response.status >= 300 || success !== true) {
        return yield* failure(stage, response.status, errors);
      }
      const result = Schema.decodeUnknownOption(resultSchema)(envelope.value.result);
      if (Option.isNone(result)) {
        return yield* failure(stage, response.status, undefined);
      }
      return result.value;
    }),
  );

export class SelfHostedTunnel extends Context.Service<
  SelfHostedTunnel,
  {
    readonly enabled: boolean;
    /** Provisions the tunnel and connector; keeps it running until the scope closes. */
    readonly start: (
      localOrigin: string,
    ) => Effect.Effect<void, SelfHostedTunnelError, Scope.Scope>;
  }
>()("t3/cloud/SelfHostedTunnel") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const config = readConfig(environment);
  const httpClient = yield* HttpClient.HttpClient;
  const endpointRuntime = yield* Effect.serviceOption(
    ManagedEndpointRuntime.CloudManagedEndpointRuntime,
  );
  const directEndpoints = yield* Effect.serviceOption(DirectEndpoints.DirectEndpoints);

  const start = Effect.fn("SelfHostedTunnel.start")(function* (localOrigin: string) {
    const active = config;
    if (active === null || Option.isNone(endpointRuntime) || Option.isNone(directEndpoints)) return;
    const request = <A>(
      stage: SelfHostedTunnelError["stage"],
      method: "GET" | "POST" | "PUT",
      path: string,
      query: Readonly<Record<string, string>> | undefined,
      payload: unknown | undefined,
      resultSchema: Schema.ConstraintDecoder<A>,
    ) => cloudflareRequest(httpClient, active, stage, method, path, query, payload, resultSchema);

    const accountPath = `/accounts/${encodeURIComponent(active.accountId)}`;
    const tunnels = yield* request(
      "find-tunnel",
      "GET",
      `${accountPath}/cfd_tunnel`,
      { name: active.tunnelName, is_deleted: "false" },
      undefined,
      Schema.Array(tunnelSchema),
    );
    const existing = tunnels.find((tunnel) => tunnel.name === active.tunnelName);
    const tunnelId =
      existing?.id ??
      (yield* request(
        "create-tunnel",
        "POST",
        `${accountPath}/cfd_tunnel`,
        undefined,
        { name: active.tunnelName, config_src: "cloudflare" },
        tunnelSchema,
      )).id;

    yield* request(
      "configure-ingress",
      "PUT",
      `${accountPath}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
      undefined,
      {
        config: {
          ingress: [
            { hostname: active.hostname, service: localOrigin },
            { service: "http_status:404" },
          ],
        },
      },
      Schema.Unknown,
    );

    const connectorToken = yield* request(
      "read-token",
      "GET",
      `${accountPath}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`,
      undefined,
      undefined,
      Schema.String,
    );

    const zonePath = `/zones/${encodeURIComponent(active.zoneId)}`;
    const records = yield* request(
      "find-dns-record",
      "GET",
      `${zonePath}/dns_records`,
      { name: active.hostname },
      undefined,
      Schema.Array(dnsRecordSchema),
    );
    const record = records.find(
      (candidate) => candidate.name.toLowerCase() === active.hostname.toLowerCase(),
    );
    yield* request(
      "upsert-dns-record",
      record === undefined ? "POST" : "PUT",
      record === undefined
        ? `${zonePath}/dns_records`
        : `${zonePath}/dns_records/${encodeURIComponent(record.id)}`,
      undefined,
      {
        type: "CNAME",
        name: active.hostname,
        content: `${tunnelId}.cfargotunnel.com`,
        ttl: 1,
        proxied: true,
      },
      Schema.Unknown,
    );

    yield* endpointRuntime.value.applyConfig({
      providerKind: "cloudflare_tunnel",
      connectorToken,
      tunnelId,
      tunnelName: active.tunnelName,
    });
    // Advertise only after the connector config is applied; a failed API call must not
    // leave clients with an unreachable public route.
    yield* directEndpoints.value.registerPublicEndpoint(`https://${active.hostname}/`);
    // Only the connector is stopped. The user's tunnel and DNS record stay in place.
    yield* Effect.addFinalizer(() => endpointRuntime.value.applyConfig(null).pipe(Effect.ignore));
  });

  return SelfHostedTunnel.of({ enabled: config !== null, start });
});

export const layer = Layer.effect(SelfHostedTunnel, make);
