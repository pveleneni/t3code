import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel.ts";

const withLabel = (label: string) =>
  Layer.succeed(
    ConfigProvider.ConfigProvider,
    ConfigProvider.fromUnknown({ T3CODE_ENVIRONMENT_LABEL: label }),
  );

it.effect("uses the fork placeholder instead of reading the hostname", () =>
  Effect.gen(function* () {
    assert.equal(yield* resolveServerEnvironmentLabel(), "t3code-fork");
  }),
);

it.effect("lets T3CODE_ENVIRONMENT_LABEL name the environment", () =>
  Effect.gen(function* () {
    assert.equal(yield* resolveServerEnvironmentLabel(), "My environment");
  }).pipe(Effect.provide(withLabel(" My environment "))),
);
