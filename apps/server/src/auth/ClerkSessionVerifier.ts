import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Signature from "effect/crypto/Signature";
import { FetchHttpClient } from "effect/http";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";

declare const __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

const buildTimeClerkPublishableKey =
  typeof __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? ""
    : __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__.trim();

const CLERK_USER_ID = /^user_[A-Za-z0-9]+$/u;

export class ClerkSessionInvalidError extends Schema.TaggedError<ClerkSessionInvalidError>()(
  "ClerkSessionInvalidError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Clerk session token is invalid.";
  }
}

const isClerkSessionInvalid = Schema.is(ClerkSessionInvalidError);

export interface ClerkSessionVerifierConfig {
  readonly publishableKey: string;
  readonly allowedUserIds: ReadonlyArray<string>;
}

export function parseClerkAllowedUserIds(value: string): ReadonlyArray<string> {
  return [...new Set(value.split(/[\s,]+/u).filter((id) => CLERK_USER_ID.test(id)))];
}

const ClerkSessionClaims = Schema.Struct({
  sub: Schema.String,
  sts: Schema.optionalKey(Schema.String),
});

export class ClerkSessionVerifier extends Context.Service<
  ClerkSessionVerifier,
  {
    /** True only with a valid publishable key and a non-empty allowlist. */
    readonly enabled: boolean;
    readonly verify: (
      token: string,
    ) => Effect.Effect<{ readonly userId: string }, ClerkSessionInvalidError>;
  }
>()("t3/auth/ClerkSessionVerifier") {}

const disabled = ClerkSessionVerifier.of({
  enabled: false,
  verify: Effect.fn("ClerkSessionVerifier.verify")(function* () {
    return yield* new ClerkSessionInvalidError({});
  }),
});

export const make = Effect.fn("ClerkSessionVerifier.make")(function* (
  config: ClerkSessionVerifierConfig,
) {
  const allowed = new Set(config.allowedUserIds);
  if (allowed.size === 0) return disabled;
  const issuer = yield* Effect.try({
    try: () => clerkFrontendApiUrlFromPublishableKey(config.publishableKey).replace(/\/+$/u, ""),
    catch: (cause) => new ClerkSessionInvalidError({ cause }),
  }).pipe(Effect.option);
  if (issuer._tag === "None") return disabled;
  const jwks = yield* Jwks.makeRemote({
    url: `${issuer.value}/.well-known/jwks.json`,
    timeToLive: "1 hour",
    cooldown: "1 minute",
  }).pipe(Effect.option);
  if (jwks._tag === "None") return disabled;
  const signature = yield* Signature.Signature;

  const verify = Effect.fn("ClerkSessionVerifier.verify")(
    function* (token: string) {
      const unverified = yield* Jwt.decodeUnverified(token);
      if (unverified.protectedHeader.kid === undefined) {
        return yield* new ClerkSessionInvalidError({});
      }
      const verified = yield* Jwt.verifyWithKeySet(ClerkSessionClaims, token, {
        issuer: [issuer.value, `${issuer.value}/`],
        algorithms: ["RS256"],
        clockTolerance: "5 seconds",
        requiredClaims: ["exp", "sub"],
      }).pipe(Effect.provideService(Jwks.Jwks, jwks.value));
      const { sub, sts } = verified.claims;
      if (!allowed.has(sub) || (sts !== undefined && sts !== "active")) {
        return yield* new ClerkSessionInvalidError({});
      }
      return { userId: sub };
    },
    Effect.provideService(Signature.Signature, signature),
    Effect.mapError((cause) =>
      isClerkSessionInvalid(cause) ? cause : new ClerkSessionInvalidError({ cause }),
    ),
  );

  return ClerkSessionVerifier.of({ enabled: true, verify });
});

const layerWith = (config: ClerkSessionVerifierConfig) =>
  Layer.effect(ClerkSessionVerifier, make(config));

const configFromEnv = Config.all({
  publishableKey: Config.String("T3CODE_CLERK_PUBLISHABLE_KEY").pipe(
    Config.withDefault(buildTimeClerkPublishableKey),
  ),
  allowedUserIds: Config.String("T3CODE_CLERK_ALLOWED_USER_IDS").pipe(
    Config.withDefault(""),
    Config.map(parseClerkAllowedUserIds),
  ),
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* configFromEnv;
    return layerWith({ ...config, publishableKey: config.publishableKey.trim() });
  }).pipe(Effect.orElseSucceed(() => Layer.succeed(ClerkSessionVerifier, disabled))),
).pipe(
  Layer.provide(
    FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
    ),
  ),
  Layer.provide(NodeCrypto.layer),
);
