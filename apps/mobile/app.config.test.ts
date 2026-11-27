import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_HOSTED_APP_URL: process.env.T3CODE_HOSTED_APP_URL,
    T3CODE_CLERK_PASSKEY_RELYING_PARTY: process.env.T3CODE_CLERK_PASSKEY_RELYING_PARTY,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined, hosted = true, passkeys = true) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  if (hosted) vi.stubEnv("T3CODE_HOSTED_APP_URL", "https://app.example.com");
  if (passkeys) vi.stubEnv("T3CODE_CLERK_PASSKEY_RELYING_PARTY", "clerk.example.com");
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while the configured hosted app lists it.
  expect(config.ios?.associatedDomains).toContain("applinks:app.example.com");
  expect(config.ios?.associatedDomains).toContain("applinks:clerk.example.com");
  expect(config.ios?.associatedDomains).toContain("webcredentials:clerk.example.com");
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host: "app.example.com", pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
  expect(config.extra?.hostedAppUrl).toBe("https://app.example.com");
});

it("omits passkey and hosted app deep-link config when unconfigured", async () => {
  const config = await loadConfig("production", false, false);
  expect(config.ios?.associatedDomains).toEqual([]);
  expect(config.android?.intentFilters).toEqual([]);
  expect(config.extra?.hostedAppUrl).toBeNull();
  expect(config.extra?.selfHosted).toEqual({ url: null });
});
