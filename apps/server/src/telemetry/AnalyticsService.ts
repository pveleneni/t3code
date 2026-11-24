import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

interface BufferedAnalyticsEvent {
  readonly uuid: string;
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

interface DeliveryState {
  readonly failedBatch: ReadonlyArray<BufferedAnalyticsEvent>;
  readonly batchAttempts: number;
  readonly firstFailedAt: number;
  readonly failures: number;
  readonly retryAt: number;
}

const FLUSH_INTERVAL_MS = 10_000;
const SEND_TIMEOUT = "10 seconds";
const SHUTDOWN_FLUSH_TIMEOUT = "1 second";
const MAX_BATCH_RETRY_MS = 30 * 60_000;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 300_000;
const REJECTED_BATCH_STATUSES = new Set([400, 401, 413]);

/** `random` is in [0, 1). */
function retryDelayMs(failures: number, random: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

function batchEndpoint(host: string): string | undefined {
  try {
    const url = new URL(host.trim());
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      return undefined;
    }
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return undefined;
    }
    return `${url.toString().replace(/\/+$/, "")}/batch/`;
  } catch {
    return undefined;
  }
}

const TelemetryEnvConfig = Config.all({
  enabled: Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(false)),
  posthogKey: Config.String("T3CODE_POSTHOG_KEY").pipe(Config.option),
  posthogHost: Config.String("T3CODE_POSTHOG_HOST").pipe(Config.option),
  distinctId: Config.String("T3CODE_POSTHOG_DISTINCT_ID").pipe(Config.withDefault("t3code-fork")),
  flushBatchSize: Config.Number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.Number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
});

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Whether the event was queued to send; false when telemetry is off. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<boolean>;

    readonly flush: Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

const make = Effect.gen(function* () {
  const config = yield* TelemetryEnvConfig;
  const key = Option.getOrElse(config.posthogKey, () => "").trim();
  const distinctId = config.distinctId.trim();
  const endpoint = batchEndpoint(Option.getOrElse(config.posthogHost, () => ""));

  if (!config.enabled || key === "" || endpoint === undefined || distinctId === "") {
    return AnalyticsService.of({
      record: Effect.fn("AnalyticsService.record")(() => Effect.succeed(false)),
      flush: Effect.void,
    });
  }

  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* SecureRandom.SecureRandom;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const deliveryRef = yield* Ref.make<DeliveryState>({
    failedBatch: [],
    batchAttempts: 0,
    firstFailedAt: 0,
    failures: 0,
    retryAt: 0,
  });
  const flushLock = yield* Semaphore.make(1);
  const batchSize = Math.max(1, Math.floor(config.flushBatchSize));
  const bufferLimit = Math.max(batchSize, Math.floor(config.maxBufferedEvents));

  const sendBatch = Effect.fn("AnalyticsService.sendBatch")(function* (
    events: ReadonlyArray<BufferedAnalyticsEvent>,
  ) {
    const payload = {
      api_key: key,
      batch: events.map((event) => ({
        uuid: event.uuid,
        event: event.event,
        distinct_id: distinctId,
        properties: {
          ...event.properties,
          $process_person_profile: false,
        },
        timestamp: event.capturedAt,
      })),
    };

    yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.timeout(SEND_TIMEOUT),
    );
  });

  const takeBatch = Ref.modify(bufferRef, (current) => {
    const nextBatch = current.slice(0, batchSize);
    return [nextBatch, current.slice(nextBatch.length)] as const;
  });

  const flush: AnalyticsService["Service"]["flush"] = Effect.gen(function* () {
    while (true) {
      const delivery = yield* Ref.get(deliveryRef);
      const batch = delivery.failedBatch.length > 0 ? delivery.failedBatch : yield* takeBatch;
      if (batch.length === 0) {
        return;
      }

      const sent = yield* Effect.result(sendBatch(batch));
      if (Result.isSuccess(sent)) {
        yield* Ref.set(deliveryRef, {
          failedBatch: [],
          batchAttempts: 0,
          firstFailedAt: 0,
          failures: 0,
          retryAt: 0,
        });
        continue;
      }

      const now = yield* Clock.currentTimeMillis;
      const failures = delivery.failures + 1;
      const batchAttempts = delivery.batchAttempts + 1;
      const firstFailedAt = delivery.batchAttempts === 0 ? now : delivery.firstFailedAt;
      const retryAt = now + retryDelayMs(failures, yield* Random.next);
      const error = sent.failure;
      const rejected =
        error._tag === "HttpClientError" &&
        error.reason._tag === "StatusCodeError" &&
        REJECTED_BATCH_STATUSES.has(error.reason.response.status);
      if (!rejected && now - firstFailedAt < MAX_BATCH_RETRY_MS) {
        yield* Ref.set(deliveryRef, {
          failedBatch: batch,
          batchAttempts,
          firstFailedAt,
          failures,
          retryAt,
        });
        yield* Effect.logDebug("Failed to send telemetry batch; will retry", {
          attempt: batchAttempts,
          cause: error,
        });
        return;
      }
      yield* Ref.set(deliveryRef, {
        failedBatch: [],
        batchAttempts: 0,
        firstFailedAt: 0,
        failures,
        retryAt,
      });
      yield* Effect.logWarning(
        rejected
          ? "Dropped telemetry batch the endpoint rejected"
          : "Dropped telemetry batch after repeated send failures",
        { events: batch.length, attempts: batchAttempts, cause: error },
      );
      return;
    }
  }).pipe(flushLock.withPermit);

  const flushWhenDue = Effect.gen(function* () {
    const { retryAt } = yield* Ref.get(deliveryRef);
    if ((yield* Clock.currentTimeMillis) >= retryAt) {
      yield* flush;
    }
  });

  const record: AnalyticsService["Service"]["record"] = Effect.fn("AnalyticsService.record")(
    function* (event, properties) {
      const uuid = yield* Effect.exit(crypto.uuidV7());
      if (Exit.isFailure(uuid)) return false;

      const capturedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      const dropped = yield* Ref.modify(bufferRef, (current) => {
        const appended = [
          ...current,
          {
            uuid: uuid.value,
            event,
            ...(properties ? { properties } : {}),
            capturedAt,
          } satisfies BufferedAnalyticsEvent,
        ];
        const next = appended.slice(Math.max(0, appended.length - bufferLimit));
        return [next.length !== appended.length, next] as const;
      });
      if (dropped) {
        yield* Effect.logDebug("analytics buffer full; dropping oldest event", { event });
      }
      return true;
    },
  );

  yield* Effect.forever(Effect.sleep(FLUSH_INTERVAL_MS).pipe(Effect.andThen(flushWhenDue)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  yield* Effect.addFinalizer(() =>
    flush.pipe(Effect.timeout(SHUTDOWN_FLUSH_TIMEOUT), Effect.ignore),
  );

  return AnalyticsService.of({ record, flush });
});

export const layer = Layer.effect(AnalyticsService, make);
