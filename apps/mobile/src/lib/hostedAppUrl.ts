import { normalizeHostedAppOrigin } from "@t3tools/shared/connectAuth";

let hostedAppUrl = "";

/** App startup sets this from the host baked into app config; pure logic reads it without importing Expo. */
export function setConfiguredHostedAppUrl(value: string | null | undefined): void {
  hostedAppUrl = normalizeHostedAppOrigin(value) ?? "";
}

/** The configured hosted app origin, or an empty string when the build has none. */
export function configuredHostedAppUrl(): string {
  return hostedAppUrl;
}
