import { useAuth } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import {
  connectClerkEnvironment,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { resolveSelfHostedConfig } from "../cloud/publicConfig";

const selfHosted = resolveSelfHostedConfig();

/** One-tap Clerk sign-in to the server this build was made for; hidden once it is connected. */
export function SelfHostedSignIn(props: { readonly onConnected?: () => void }) {
  return selfHosted ? (
    <ConfiguredSelfHostedSignIn {...selfHosted} onConnected={props.onConnected} />
  ) : null;
}

function ConfiguredSelfHostedSignIn(props: {
  readonly url: string;
  readonly host: string;
  readonly jwtTemplate: string | null;
  readonly onConnected: (() => void) | undefined;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const { isLoaded, isSignedIn, getToken } = useAuth({ treatPendingAsSignedOut: false });
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaitingSignIn = useRef(false);

  const connect = async () => {
    setError(null);
    setConnecting(true);
    const clerkSessionToken = await getToken({
      skipCache: true,
      ...(props.jwtTemplate ? { template: props.jwtTemplate } : {}),
    }).catch(() => null);
    const outcome = clerkSessionToken
      ? await connectClerkEnvironment({ host: props.url, clerkSessionToken })
      : { ok: false, error: gt("Couldn't sign in. Try again.") };
    setConnecting(false);
    setError(outcome.error);
    if (outcome.ok) props.onConnected?.();
  };

  // Clerk reports the finished sign-in only through its auth store, after the sign-in screen pops.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- continues the connection once Clerk's auth store reports the sign-in this button started
  useEffect(() => {
    if (awaitingSignIn.current && isSignedIn) {
      awaitingSignIn.current = false;
      void connect();
    }
  });

  const alreadyConnected = Object.values(savedConnectionsById).some(
    (connection) => new URL(connection.httpBaseUrl).origin === props.url,
  );
  if (alreadyConnected) return null;

  return (
    <View collapsable={false} className="gap-2">
      <Button
        tone="primary"
        label={gt("Sign in to {host}", { host: props.host })}
        loading={connecting}
        disabled={!isLoaded || connecting}
        onPress={() => {
          if (isSignedIn) {
            void connect();
          } else {
            awaitingSignIn.current = true;
            navigation.navigate("SettingsAuth");
          }
        }}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="px-4 text-center text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
