import * as HostProcess from "@t3tools/shared/HostProcess";
import { it as effectIt } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse, HttpBody } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as DirectEndpoints from "../environment/DirectEndpoints.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import * as SelfHostedTunnel from "./SelfHostedTunnel.ts";

interface Call {
  readonly method: string;
  readonly url: URL;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly authorization: string | undefined;
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

const ok = (result: unknown): Reply => ({
  status: 200,
  body: { success: true, result, errors: [] },
});

const FULL_ENV: NodeJS.ProcessEnv = {
  T3CODE_CLOUDFLARE_API_TOKEN: "cf-token",
  T3CODE_CLOUDFLARE_ACCOUNT_ID: "acct",
  T3CODE_CLOUDFLARE_ZONE_ID: "zone",
  T3CODE_CLOUDFLARE_TUNNEL_HOSTNAME: "t3.example.com",
};

const requestBody = (body: HttpBody.HttpBody): unknown => {
  if (body._tag === "Raw") return body.body;
  if (body._tag === "Uint8Array") return JSON.parse(new TextDecoder().decode(body.body));
  return undefined;
};

const build = (
  env: NodeJS.ProcessEnv,
  reply: (call: Call) => Reply,
): Effect.Effect<{
  readonly service: SelfHostedTunnel.SelfHostedTunnel["Service"];
  readonly calls: Ref.Ref<ReadonlyArray<Call>>;
  readonly applied: Ref.Ref<ReadonlyArray<unknown>>;
  readonly registered: Ref.Ref<ReadonlyArray<string>>;
}> =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Call>>([]);
    const applied = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const registered = yield* Ref.make<ReadonlyArray<string>>([]);
    const dependencies = Layer.mergeAll(
      Layer.succeed(HostProcess.Environment, env),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const authorization = Object.entries(request.headers).find(
              ([name]) => name.toLowerCase() === "authorization",
            )?.[1];
            const call: Call = {
              method: request.method,
              url: new URL(request.url),
              query: Object.fromEntries(
                [...request.urlParams].map(([name, value]) => [name, String(value)]),
              ),
              body: requestBody(request.body),
              authorization: Array.isArray(authorization) ? authorization[0] : authorization,
            };
            yield* Ref.update(calls, (current) => [...current, call]);
            const response = reply(call);
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(response.body), {
                status: response.status,
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      ),
      Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({
        applyConfig: (config) =>
          Ref.update(applied, (current) => [...current, config]).pipe(
            Effect.as({ status: "disabled" } as const),
          ),
      }),
      Layer.mock(DirectEndpoints.DirectEndpoints)({
        registerPublicEndpoint: (url) => Ref.update(registered, (current) => [...current, url]),
      }),
    );
    const service = yield* Effect.service(SelfHostedTunnel.SelfHostedTunnel).pipe(
      Effect.provide(SelfHostedTunnel.layer.pipe(Layer.provide(dependencies))),
    );
    return { service, calls, applied, registered };
  });

describe("SelfHostedTunnel", () => {
  effectIt.effect("stays inert when a required setting is missing or blank", () =>
    Effect.gen(function* () {
      const incomplete: ReadonlyArray<NodeJS.ProcessEnv> = [
        {},
        { ...FULL_ENV, T3CODE_CLOUDFLARE_API_TOKEN: "   " },
        { ...FULL_ENV, T3CODE_CLOUDFLARE_ACCOUNT_ID: "" },
        { ...FULL_ENV, T3CODE_CLOUDFLARE_ZONE_ID: undefined },
        { ...FULL_ENV, T3CODE_CLOUDFLARE_TUNNEL_HOSTNAME: " " },
      ];
      for (const env of incomplete) {
        const { service, calls, applied, registered } = yield* build(env, () => {
          throw new Error("unexpected HTTP call");
        });
        expect(service.enabled).toBe(false);
        yield* Effect.scoped(service.start("http://127.0.0.1:3773"));
        expect(yield* Ref.get(calls)).toEqual([]);
        expect(yield* Ref.get(applied)).toEqual([]);
        expect(yield* Ref.get(registered)).toEqual([]);
      }
    }),
  );

  effectIt.effect("creates the tunnel, ingress and DNS record, then runs the connector", () =>
    Effect.gen(function* () {
      const { service, calls, applied, registered } = yield* build(FULL_ENV, (call) => {
        const path = call.url.pathname;
        if (call.method === "GET" && path === "/client/v4/accounts/acct/cfd_tunnel") return ok([]);
        if (call.method === "POST" && path === "/client/v4/accounts/acct/cfd_tunnel") {
          return ok({ id: "tunnel-1", name: "t3code-fork" });
        }
        if (call.method === "PUT" && path.endsWith("/configurations")) return ok({ config: {} });
        if (call.method === "GET" && path.endsWith("/token")) return ok("connector-token");
        if (call.method === "GET" && path.endsWith("/dns_records")) return ok([]);
        if (call.method === "POST" && path.endsWith("/dns_records")) return ok({ id: "dns-1" });
        throw new Error(`unexpected request ${call.method} ${call.url}`);
      });

      yield* Effect.scoped(service.start("http://127.0.0.1:3773"));

      const made = yield* Ref.get(calls);
      expect(made.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
        "GET /client/v4/accounts/acct/cfd_tunnel",
        "POST /client/v4/accounts/acct/cfd_tunnel",
        "PUT /client/v4/accounts/acct/cfd_tunnel/tunnel-1/configurations",
        "GET /client/v4/accounts/acct/cfd_tunnel/tunnel-1/token",
        "GET /client/v4/zones/zone/dns_records",
        "POST /client/v4/zones/zone/dns_records",
      ]);
      expect(made[0]!.query).toEqual({ name: "t3code-fork", is_deleted: "false" });
      expect(made[4]!.query).toEqual({ name: "t3.example.com" });
      expect(made.every((call) => call.authorization === "Bearer cf-token")).toBe(true);
      expect(made[1]!.body).toEqual({ name: "t3code-fork", config_src: "cloudflare" });
      expect(made[2]!.body).toEqual({
        config: {
          ingress: [
            { hostname: "t3.example.com", service: "http://127.0.0.1:3773" },
            { service: "http_status:404" },
          ],
        },
      });
      expect(made[5]!.body).toEqual({
        type: "CNAME",
        name: "t3.example.com",
        content: "tunnel-1.cfargotunnel.com",
        ttl: 1,
        proxied: true,
      });
      expect(yield* Ref.get(registered)).toEqual(["https://t3.example.com/"]);
      expect(yield* Ref.get(applied)).toEqual([
        {
          providerKind: "cloudflare_tunnel",
          connectorToken: "connector-token",
          tunnelId: "tunnel-1",
          tunnelName: "t3code-fork",
        },
        null,
      ]);
    }),
  );

  effectIt.effect("reuses a named tunnel and updates its existing DNS record", () =>
    Effect.gen(function* () {
      const env = { ...FULL_ENV, T3CODE_CLOUDFLARE_TUNNEL_NAME: "My Fork / One" };
      const { service, calls, applied } = yield* build(env, (call) => {
        const path = call.url.pathname;
        if (call.method === "GET" && path === "/client/v4/accounts/acct/cfd_tunnel") {
          return ok([{ id: "existing", name: "my-fork-one" }]);
        }
        if (call.method === "PUT" && path.endsWith("/configurations")) return ok({ config: {} });
        if (call.method === "GET" && path.endsWith("/token")) return ok("reused-token");
        if (call.method === "GET" && path.endsWith("/dns_records")) {
          return ok([{ id: "dns-1", name: "t3.example.com" }]);
        }
        if (call.method === "PUT" && path.endsWith("/dns_records/dns-1"))
          return ok({ id: "dns-1" });
        throw new Error(`unexpected request ${call.method} ${call.url}`);
      });

      yield* Effect.scoped(service.start("http://127.0.0.1:3773"));

      const made = yield* Ref.get(calls);
      expect(made.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
        "GET /client/v4/accounts/acct/cfd_tunnel",
        "PUT /client/v4/accounts/acct/cfd_tunnel/existing/configurations",
        "GET /client/v4/accounts/acct/cfd_tunnel/existing/token",
        "GET /client/v4/zones/zone/dns_records",
        "PUT /client/v4/zones/zone/dns_records/dns-1",
      ]);
      expect(made[0]!.query.name).toBe("my-fork-one");
      expect(made[4]!.body).toMatchObject({
        content: "existing.cfargotunnel.com",
        proxied: true,
      });
      expect(yield* Ref.get(applied)).toEqual([
        {
          providerKind: "cloudflare_tunnel",
          connectorToken: "reused-token",
          tunnelId: "existing",
          tunnelName: "my-fork-one",
        },
        null,
      ]);
    }),
  );

  effectIt.effect("fails with a typed Cloudflare error without starting the connector", () =>
    Effect.gen(function* () {
      const { service, applied } = yield* build(FULL_ENV, () => ({
        status: 403,
        body: {
          success: false,
          result: null,
          errors: [{ code: 9109, message: "Invalid access token" }],
        },
      }));

      const result = yield* Effect.result(Effect.scoped(service.start("http://127.0.0.1:3773")));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("SelfHostedTunnelError");
        expect(result.failure.stage).toBe("find-tunnel");
        expect(result.failure.status).toBe(403);
        expect(result.failure.details).toEqual(["Invalid access token"]);
        expect(result.failure.message).toContain("Invalid access token");
      }
      expect(yield* Ref.get(applied)).toEqual([]);
    }),
  );
});
