/**
 * Public product URLs. An unset value stays unset: callers hide the feature or
 * explain that the relevant T3CODE_* variable must be configured.
 */
export type ProductEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProductUrls {
  readonly githubRepository: string | undefined;
  readonly releaseBaseUrl: string | undefined;
  readonly releaseRepository: string | undefined;
  readonly docsBaseUrl: string | undefined;
  readonly installUrl: string | undefined;
  readonly installPs1Url: string | undefined;
  readonly downloadUrl: string | undefined;
  readonly privacyUrl: string | undefined;
  readonly issueUrl: string | undefined;
  readonly modelManifestUrl: string | undefined;
}

const REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]+$/u;

export function repositorySlug(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  const [owner, name, ...extra] = trimmed.split("/");
  if (
    extra.length > 0 ||
    owner === undefined ||
    name === undefined ||
    owner === "." ||
    owner === ".." ||
    name === "." ||
    name === ".." ||
    !REPOSITORY_SEGMENT.test(owner) ||
    !REPOSITORY_SEGMENT.test(name)
  ) {
    return undefined;
  }
  return trimmed;
}

function httpUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function productUrls(env: ProductEnvironment): ProductUrls {
  const githubRepository = repositorySlug(env["T3CODE_GITHUB_REPOSITORY"]);
  return {
    githubRepository,
    releaseBaseUrl: httpUrl(env["T3CODE_RELEASE_BASE_URL"]),
    releaseRepository: repositorySlug(env["T3CODE_RELEASE_REPOSITORY"]) ?? githubRepository,
    docsBaseUrl: httpUrl(env["T3CODE_DOCS_BASE_URL"]),
    installUrl: httpUrl(env["T3CODE_INSTALL_URL"]),
    installPs1Url: httpUrl(env["T3CODE_INSTALL_PS1_URL"]),
    downloadUrl: httpUrl(env["T3CODE_DOWNLOAD_URL"]),
    privacyUrl: httpUrl(env["T3CODE_PRIVACY_URL"]),
    issueUrl:
      httpUrl(env["T3CODE_ISSUE_URL"]) ??
      (githubRepository === undefined ? undefined : githubIssuesUrl(githubRepository)),
    modelManifestUrl: httpUrl(env["T3CODE_MODEL_MANIFEST_URL"]),
  };
}

/** Node callers pass `process.env`; browser callers pass an explicit `import.meta.env` subset. */
export function runtimeProductEnvironment(): ProductEnvironment {
  const processValue = (globalThis as { readonly process?: { readonly env?: ProductEnvironment } })
    .process;
  return processValue?.env ?? {};
}

export function githubRepositoryUrl(repository: string | undefined): string | undefined {
  const slug = repositorySlug(repository);
  return slug === undefined ? undefined : `https://github.com/${slug}`;
}

export function githubReleasesUrl(repository: string | undefined): string | undefined {
  const url = githubRepositoryUrl(repository);
  return url === undefined ? undefined : `${url}/releases`;
}

export function githubIssuesUrl(repository: string | undefined): string | undefined {
  const url = githubRepositoryUrl(repository);
  return url === undefined ? undefined : `${url}/issues/new`;
}

export function docsPageUrl(baseUrl: string | undefined, path: string): string | undefined {
  const base = httpUrl(baseUrl);
  return base === undefined
    ? undefined
    : `${base.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

export function installCommand(
  urls: Pick<ProductUrls, "installUrl" | "installPs1Url">,
  platform: string = "linux",
): string | undefined {
  const url = platform === "win32" ? urls.installPs1Url : urls.installUrl;
  if (url === undefined) return undefined;
  return platform === "win32" ? `irm ${url} | iex` : `curl -fsSL ${url} | sh`;
}

export function requireProductUrl(
  value: string | undefined,
  envName: string,
  feature: string,
): string {
  if (value === undefined) {
    throw new Error(`${envName} is not configured; ${feature} is unavailable.`);
  }
  return value;
}
