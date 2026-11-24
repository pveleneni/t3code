import {
  productUrls,
  type ProductEnvironment,
  type ProductUrls,
} from "@t3tools/contracts/productUrls";

/** Vite replaces each property with its build-time T3CODE_* value (empty when unset). */
const PRODUCT_ENV: ProductEnvironment = {
  T3CODE_GITHUB_REPOSITORY: import.meta.env.T3CODE_GITHUB_REPOSITORY,
  T3CODE_RELEASE_BASE_URL: import.meta.env.T3CODE_RELEASE_BASE_URL,
  T3CODE_RELEASE_REPOSITORY: import.meta.env.T3CODE_RELEASE_REPOSITORY,
  T3CODE_DOCS_BASE_URL: import.meta.env.T3CODE_DOCS_BASE_URL,
  T3CODE_INSTALL_URL: import.meta.env.T3CODE_INSTALL_URL,
  T3CODE_INSTALL_PS1_URL: import.meta.env.T3CODE_INSTALL_PS1_URL,
  T3CODE_DOWNLOAD_URL: import.meta.env.T3CODE_DOWNLOAD_URL,
  T3CODE_PRIVACY_URL: import.meta.env.T3CODE_PRIVACY_URL,
  T3CODE_ISSUE_URL: import.meta.env.T3CODE_ISSUE_URL,
  T3CODE_MODEL_MANIFEST_URL: import.meta.env.T3CODE_MODEL_MANIFEST_URL,
};

export const PRODUCT_URLS: ProductUrls = productUrls(PRODUCT_ENV);
