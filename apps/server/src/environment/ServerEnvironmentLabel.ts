import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const FALLBACK_LABEL = "t3code-fork";

// Names this environment instead of the fork placeholder, e.g. for staged demos and scenario captures.
const labelOverride = Config.String("T3CODE_ENVIRONMENT_LABEL").pipe(
  Config.option,
  Config.map(
    Option.flatMap((label) => {
      const trimmed = label.trim();
      return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
    }),
  ),
);

/**
 * This fork never reads the machine name, hostname, or WSL distro. Use
 * `T3CODE_ENVIRONMENT_LABEL` when environments need distinct names.
 */
export const resolveServerEnvironmentLabel = Effect.fn("resolveServerEnvironmentLabel")(
  function* () {
    const override = yield* labelOverride.pipe(Effect.orElseSucceed(() => Option.none<string>()));
    return Option.isSome(override) ? override.value : FALLBACK_LABEL;
  },
);
