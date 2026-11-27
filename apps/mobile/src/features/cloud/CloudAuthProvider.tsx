import { ClerkProvider, getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import type { ReactNode } from "react";

import { cloudAccountService, deactivateCloudRelayAccount } from "./cloudAccountService";
import { resolveCloudPublicConfig, resolveSelfHostedConfig } from "./publicConfig";

const cloudConfig = resolveCloudPublicConfig();
// Build-time constants: null when this build has no relay and no self-hosted server.
const relayPublishableKey = cloudConfig.relay.url ? cloudConfig.clerk.publishableKey : null;
const publishableKey =
  relayPublishableKey ?? resolveSelfHostedConfig(cloudConfig)?.publishableKey ?? null;

if (relayPublishableKey) {
  // The same native singleton ClerkProvider renders with, so the service
  // observes it for the app's lifetime without a React subscription.
  cloudAccountService.attach(getClerkInstance({ publishableKey: relayPublishableKey }));
} else {
  // Without a relay no account can ever activate, so drop anything a
  // previous build with cloud enabled left registered. Self-hosted sign-in
  // only mints a server session and never joins the cloud account.
  deactivateCloudRelayAccount();
}

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  if (!publishableKey) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {props.children}
    </ClerkProvider>
  );
}
