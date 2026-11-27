import { describe, expect, it, vi } from "vite-plus/test";

import { resolveCloudPublicConfig, resolveSelfHostedConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      clerk: {
        publishableKey: "pk_test_example",
        jwtTemplate: "t3-relay",
      },
      relay: {
        url: null,
      },
      selfHosted: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });

  it("offers self-hosted sign-in only for an https server with a Clerk key", () => {
    const resolve = (url: string, publishableKey: string | null) =>
      resolveSelfHostedConfig(
        resolveCloudPublicConfig({ clerk: { publishableKey }, selfHosted: { url } }),
      );

    expect(resolve("https://t3.example.test/", "pk_test_example")).toEqual({
      url: "https://t3.example.test",
      host: "t3.example.test",
      publishableKey: "pk_test_example",
      jwtTemplate: null,
    });
    expect(resolve("http://t3.example.test", "pk_test_example")).toBeNull();
    expect(resolve("https://t3.example.test", null)).toBeNull();
  });
});
