import { describe, expect, it } from "@effect/vitest";

import {
  docsPageUrl,
  githubReleasesUrl,
  installCommand,
  productUrls,
  repositorySlug,
} from "./productUrls.ts";

describe("productUrls", () => {
  it("leaves every product URL unset without a T3 fallback", () => {
    const urls = productUrls({});
    expect(urls).toEqual({
      githubRepository: undefined,
      releaseBaseUrl: undefined,
      releaseRepository: undefined,
      docsBaseUrl: undefined,
      installUrl: undefined,
      installPs1Url: undefined,
      downloadUrl: undefined,
      privacyUrl: undefined,
      issueUrl: undefined,
      modelManifestUrl: undefined,
    });
    expect(githubReleasesUrl(urls.githubRepository)).toBeUndefined();
    expect(docsPageUrl(urls.docsBaseUrl, "user/workflows.md")).toBeUndefined();
    expect(installCommand(urls)).toBeUndefined();
  });

  it("uses configured values and derives release/issue URLs from the repository", () => {
    const urls = productUrls({
      T3CODE_GITHUB_REPOSITORY: "example/t3code",
      T3CODE_RELEASE_BASE_URL: "https://mirror.example.com/releases/download/",
      T3CODE_DOCS_BASE_URL: "https://docs.example.com/",
      T3CODE_INSTALL_URL: "https://example.com/install.sh",
      T3CODE_INSTALL_PS1_URL: "https://example.com/install.ps1",
      T3CODE_MODEL_MANIFEST_URL: "https://example.com/model-manifest.json",
    });
    expect(urls.releaseRepository).toBe("example/t3code");
    expect(urls.issueUrl).toBe("https://github.com/example/t3code/issues/new");
    expect(githubReleasesUrl(urls.releaseRepository)).toBe(
      "https://github.com/example/t3code/releases",
    );
    expect(docsPageUrl(urls.docsBaseUrl, "user/workflows.md")).toBe(
      "https://docs.example.com/user/workflows.md",
    );
    expect(installCommand(urls)).toBe("curl -fsSL https://example.com/install.sh | sh");
    expect(installCommand(urls, "win32")).toBe("irm https://example.com/install.ps1 | iex");
  });

  it("ignores malformed overrides and non-HTTP URLs", () => {
    expect(repositorySlug("owner/repo/extra")).toBeUndefined();
    expect(repositorySlug("../repo")).toBeUndefined();
    expect(productUrls({ T3CODE_INSTALL_URL: "javascript:alert(1)" }).installUrl).toBeUndefined();
    expect(productUrls({ T3CODE_GITHUB_REPOSITORY: "example/repo" }).githubRepository).toBe(
      "example/repo",
    );
    expect(
      githubReleasesUrl(
        productUrls({ T3CODE_RELEASE_REPOSITORY: "example/releases" }).releaseRepository,
      ),
    ).toBe("https://github.com/example/releases/releases");
  });
});
