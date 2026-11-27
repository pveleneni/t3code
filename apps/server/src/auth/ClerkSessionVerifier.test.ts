// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no generateKeyPairSync or sign.
import * as NodeCrypto from "node:crypto";

import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Signature from "effect/crypto/Signature";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ClerkSessionVerifier from "./ClerkSessionVerifier.ts";

const FRONTEND_API = "clerk.example.com";
const ISSUER = `https://${FRONTEND_API}`;
const PUBLISHABLE_KEY = `pk_test_${Buffer.from(`${FRONTEND_API}$`).toString("base64")}`;
const ALLOWED = "user_allowed1";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const makeSigner = (kid: string) => {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
    sign: (
      claims: Record<string, unknown>,
      header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid },
    ) => {
      const signingInput = `${encode(header)}.${encode(claims)}`;
      const signature = NodeCrypto.sign("sha256", Buffer.from(signingInput), privateKey);
      return `${signingInput}.${signature.toString("base64url")}`;
    },
  };
};

const signer = makeSigner("ins_good");
const stranger = makeSigner("ins_other");

const now = () => Math.floor(DateTime.nowUnsafe().epochMilliseconds / 1_000);
const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  sub: ALLOWED,
  sts: "active",
  iat: now(),
  nbf: now() - 5,
  exp: now() + 60,
  ...overrides,
});

const jwksClient = (requested: Array<string>) =>
  HttpClient.make((request) => {
    requested.push(request.url);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify({ keys: [signer.jwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

const verifier = (
  config: Partial<ClerkSessionVerifier.ClerkSessionVerifierConfig> = {},
  requested: Array<string> = [],
) =>
  ClerkSessionVerifier.make({
    publishableKey: PUBLISHABLE_KEY,
    allowedUserIds: [ALLOWED],
    ...config,
  }).pipe(Effect.provideService(HttpClient.HttpClient, jwksClient(requested)));

const rejects = (
  token: string,
  config?: Partial<ClerkSessionVerifier.ClerkSessionVerifierConfig>,
) =>
  verifier(config).pipe(
    Effect.flatMap((service) => service.verify(token)),
    Effect.flip,
    Effect.map((error) => error._tag),
  );

describe("ClerkSessionVerifier", () => {
  const live = <E>(
    name: string,
    effect: Effect.Effect<void, E, Scope.Scope | Signature.Signature>,
  ) => it.live(name, () => effect.pipe(Effect.scoped, Effect.provide(NodePlatformCrypto.layer)));

  live(
    "accepts an allowlisted user's session and reads the JWKS from the issuer",
    Effect.gen(function* () {
      const requested: Array<string> = [];
      const service = yield* verifier({}, requested);
      expect(service.enabled).toBe(true);
      expect(yield* service.verify(signer.sign(claims()))).toEqual({ userId: ALLOWED });
      yield* service.verify(signer.sign(claims()));
      expect(requested).toEqual([`${ISSUER}/.well-known/jwks.json`]);
    }),
  );

  live(
    "accepts a trailing-slash issuer and a session within the clock skew",
    Effect.gen(function* () {
      const service = yield* verifier();
      yield* service.verify(signer.sign(claims({ iss: `${ISSUER}/`, exp: now() - 2 })));
    }),
  );

  live(
    "rejects every other session with the same error",
    Effect.gen(function* () {
      const invalid = "ClerkSessionInvalidError";
      expect(yield* rejects(signer.sign(claims({ iss: "https://evil.example.com" })))).toBe(
        invalid,
      );
      expect(yield* rejects(signer.sign(claims({ exp: now() - 60 })))).toBe(invalid);
      expect(yield* rejects(signer.sign(claims({ nbf: now() + 60 })))).toBe(invalid);
      expect(yield* rejects(signer.sign(claims({ sub: "user_someoneelse" })))).toBe(invalid);
      expect(yield* rejects(signer.sign(claims({ sts: "pending" })))).toBe(invalid);
      expect(yield* rejects(signer.sign({ ...claims(), sub: undefined }))).toBe(invalid);
      expect(yield* rejects(stranger.sign(claims()))).toBe(invalid);
      expect(
        yield* rejects(signer.sign(claims(), { alg: "RS256", typ: "JWT", kid: "unknown" })),
      ).toBe(invalid);
      expect(yield* rejects(signer.sign(claims(), { alg: "RS256", typ: "JWT" }))).toBe(invalid);
      expect(yield* rejects(signer.sign(claims(), { alg: "none", kid: "ins_good" }))).toBe(invalid);
      expect(yield* rejects(signer.sign(claims(), { alg: "RS384", kid: "ins_good" }))).toBe(
        invalid,
      );
      expect(yield* rejects("not-a-jwt")).toBe(invalid);
    }),
  );

  live(
    "fails closed when the JWKS cannot be fetched",
    Effect.gen(function* () {
      const service = yield* ClerkSessionVerifier.make({
        publishableKey: PUBLISHABLE_KEY,
        allowedUserIds: [ALLOWED],
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response("down", { status: 503 })),
            ),
          ),
        ),
      );
      expect((yield* service.verify(signer.sign(claims())).pipe(Effect.flip))._tag).toBe(
        "ClerkSessionInvalidError",
      );
    }),
  );

  live(
    "is disabled without an allowlist or a valid publishable key",
    Effect.gen(function* () {
      for (const config of [
        { allowedUserIds: [] },
        { publishableKey: "" },
        { publishableKey: "pk_test_!!" },
      ]) {
        const service = yield* verifier(config);
        expect(service.enabled).toBe(false);
        expect(yield* rejects(signer.sign(claims()), config)).toBe("ClerkSessionInvalidError");
      }
    }),
  );

  it("only accepts Clerk user IDs in the allowlist setting", () => {
    expect(
      ClerkSessionVerifier.parseClerkAllowedUserIds("user_a1, user_b2\nnot-an-id  user_a1 *"),
    ).toEqual(["user_a1", "user_b2"]);
  });
});
