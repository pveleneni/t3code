import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as AnalyticsService from "./AnalyticsService.ts";

interface SentEvent {
  readonly uuid?: string;
  readonly event?: string;
  readonly distinct_id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly timestamp?: string;
}

interface CapturedRequest {
  readonly url: string;
  readonly payload: {
    readonly api_key?: string;
    readonly batch?: ReadonlyArray<SentEvent>;
  };
}

const recordingClient = (requests: Array<CapturedRequest>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const body = request.body;
      if (body._tag === "Uint8Array") {
        const text = new TextDecoder().decode(body.body);
        const payload = yield* Effect.sync(() => JSON.parse(text) as CapturedRequest["payload"]);
        requests.push({ url: request.url, payload });
      }
      return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
    }),
  );

const withAnalytics = <A>(
  config: Readonly<Record<string, unknown>>,
  requests: Array<CapturedRequest>,
  effect: Effect.Effect<A, never, AnalyticsService.AnalyticsService>,
) =>
  effect.pipe(
    Effect.provide(
      AnalyticsService.layer.pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, recordingClient(requests))),
      ),
    ),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("AnalyticsService test", (it) => {
  it.effect("sends nothing by default or when telemetry is explicitly off", () =>
    Effect.gen(function* () {
      const defaultRequests: Array<CapturedRequest> = [];
      const defaultRecorded = yield* withAnalytics(
        {},
        defaultRequests,
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          const recorded = yield* analytics.record("test.default");
          yield* analytics.flush;
          return recorded;
        }),
      );
      assert.equal(defaultRecorded, false);
      assert.deepEqual(defaultRequests, []);

      const offRequests: Array<CapturedRequest> = [];
      const offRecorded = yield* withAnalytics(
        {
          T3CODE_TELEMETRY_ENABLED: false,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "http://localhost:54321",
        },
        offRequests,
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          const recorded = yield* analytics.record("test.off");
          yield* analytics.flush;
          return recorded;
        }),
      );
      assert.equal(offRecorded, false);
      assert.deepEqual(offRequests, []);
    }),
  );

  it.effect("sends nothing when the flag is on but a key or host is missing", () =>
    Effect.gen(function* () {
      for (const config of [
        { T3CODE_TELEMETRY_ENABLED: true, T3CODE_POSTHOG_HOST: "http://localhost:54321" },
        { T3CODE_TELEMETRY_ENABLED: true, T3CODE_POSTHOG_KEY: "phc_test_key" },
        {
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "",
          T3CODE_POSTHOG_HOST: "http://localhost:54321",
        },
        {
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "   ",
        },
      ]) {
        const requests: Array<CapturedRequest> = [];
        const recorded = yield* withAnalytics(
          config,
          requests,
          Effect.gen(function* () {
            const analytics = yield* AnalyticsService.AnalyticsService;
            const recorded = yield* analytics.record("test.incomplete-config");
            yield* analytics.flush;
            return recorded;
          }),
        );
        assert.equal(recorded, false);
        assert.deepEqual(requests, []);
      }
    }),
  );

  it.effect("sends to the configured PostHog host without machine or account identifiers", () =>
    Effect.gen(function* () {
      const requests: Array<CapturedRequest> = [];
      yield* withAnalytics(
        {
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "http://localhost:54321/",
        },
        requests,
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          assert.equal(yield* analytics.record("test.configured", { index: 1 }), true);
          yield* analytics.flush;
        }),
      );

      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.equal(request?.url, "http://localhost:54321/batch/");
      assert.equal(request?.payload.api_key, "phc_test_key");
      const event = request?.payload.batch?.[0];
      assert.equal(event?.event, "test.configured");
      assert.equal(event?.distinct_id, "t3code-fork");
      assert.isString(event?.uuid);
      assert.isString(event?.timestamp);
      assert.equal(event?.properties?.$process_person_profile, false);
      assert.equal(event?.properties?.index, 1);

      const properties = event?.properties ?? {};
      for (const key of [
        "installId",
        "anonymousId",
        "platform",
        "arch",
        "serverOs",
        "serverArch",
        "serverWslDistro",
        "hostname",
        "username",
        "deviceModel",
        "ownerId",
      ]) {
        assert.equal(Object.hasOwn(properties, key), false, `unexpected property ${key}`);
      }
      assert.equal(
        requests.every((captured) => !/t3\.codes|posthog\.com/i.test(captured.url)),
        true,
      );
    }),
  );
});
