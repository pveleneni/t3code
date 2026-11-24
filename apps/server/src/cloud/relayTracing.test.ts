import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";
import { relayLayer } from "./relayTracing.ts";

it.effect("never exports relay traces", () => {
  const layerRelay = relayLayer({
    serviceName: "t3code-server",
    runtime: "node",
    client: "environment-server",
  }).pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-relay-tracing-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
  );

  return Effect.gen(function* () {
    const tracer = yield* RelayTracing.RelayClientTracer;
    assert.isTrue(Option.isNone(tracer));
  }).pipe(Effect.provide(layerRelay));
});
