import { describe, expect, it } from "vite-plus/test";

import {
  buildConnectAuthorizeRequestUrl,
  configuredHostedAppOrigin,
  connectLoopbackRedirectUri,
  normalizeHostedAppOrigin,
  readConnectAuthorizeRequest,
} from "./connectAuth.ts";

describe("connectAuth", () => {
  it("reads only a configured hosted origin, with loopback HTTP allowed for development", () => {
    expect(configuredHostedAppOrigin({ T3CODE_HOSTED_APP_URL: " https://app.example.com/ " })).toBe(
      "https://app.example.com",
    );
    expect(configuredHostedAppOrigin({ T3CODE_HOSTED_APP_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(configuredHostedAppOrigin({})).toBeNull();
    expect(normalizeHostedAppOrigin("http://app.example.com")).toBeNull();
    expect(normalizeHostedAppOrigin("https://app.example.com/new")).toBeNull();
  });

  it("round-trips state, challenge, and loopback port through the authorize URL fragment", () => {
    const url = buildConnectAuthorizeRequestUrl({
      hostedAppUrl: "https://app.example.com",
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://app.example.com");
    expect(parsed.pathname).toBe("/connect");
    expect(parsed.search).toBe("");
    expect(readConnectAuthorizeRequest(parsed)).toEqual({
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    expect(connectLoopbackRedirectUri(34338)).toBe("http://127.0.0.1:34338/callback");
  });

  it("rejects authorize requests missing state, challenge, or port", () => {
    expect(readConnectAuthorizeRequest(new URL("https://app.example.com/connect"))).toBeNull();
    expect(
      readConnectAuthorizeRequest(new URL("https://app.example.com/connect#state=abc&port=34338")),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(
        new URL("https://app.example.com/connect#challenge=abc&port=34338"),
      ),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(
        new URL("https://app.example.com/connect#state=abc&challenge=abc"),
      ),
    ).toBeNull();
  });

  it("rejects authorize requests whose loopback port is corrupted", () => {
    for (const port of ["", "abc", "-1", "0", "65536", "34338x", "34 38"]) {
      const url = new URL(
        `https://app.example.com/connect#state=state-1&challenge=challenge-1&port=${encodeURIComponent(port)}`,
      );
      expect(readConnectAuthorizeRequest(url), port).toBeNull();
    }
  });
});
