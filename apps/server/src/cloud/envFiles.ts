// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

/**
 * User env files: `$T3CODE_HOME/.env` may set any T3 key, the shared `$HOME/.env` only `T3CODE_*`.
 * Precedence: `$HOME/.env` < `$T3CODE_HOME/.env` < `service.env` < the process environment.
 * Both are optional, so an install that configures nothing still runs.
 */
const HOME_ENV_FILE = ".env";

const HOME_ENV_ALLOWED_PREFIX = "T3CODE_";

/**
 * Names the process, the shell or the service unit owns. A `.env` file that set one of these
 * would silently change how this process is launched rather than how it behaves.
 */
const PROCESS_OWNED_ENV_NAMES = new Set([
  "PATH",
  "PATHEXT",
  "NODE_OPTIONS",
  "T3CODE_HOME",
  "T3CODE_STARTUP_PROFILE_DIR",
  "T3_BOOT_SERVICE_UNIT",
]);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type EnvFileScope = "home" | "t3home";

export interface EnvFile {
  readonly path: string;
  readonly scope: EnvFileScope;
  readonly values: Readonly<Record<string, string>>;
}

export interface EnvFileOptions {
  /** This install's home directory: `$T3CODE_HOME`, defaulting to `~/.t3`. */
  readonly t3Home: string;
  /** The user's home directory. `os.homedir()` on Windows resolves `USERPROFILE`. */
  readonly homeDir?: string | undefined;
}

function accepts(scope: EnvFileScope, name: string): boolean {
  if (!ENV_NAME.test(name)) return false;
  if (PROCESS_OWNED_ENV_NAMES.has(name.toUpperCase())) return false;
  return scope === "t3home" || name.startsWith(HOME_ENV_ALLOWED_PREFIX);
}

function filterValues(
  scope: EnvFileScope,
  parsed: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (value !== undefined && accepts(scope, name)) values[name] = value;
  }
  return values;
}

async function readEnvFile(path: string, scope: EnvFileScope): Promise<EnvFile | undefined> {
  let contents: string;
  try {
    contents = await NodeFSP.readFile(path, "utf8");
  } catch (cause) {
    // An absent file is the common case: most installs configure nothing.
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }
  return { path, scope, values: filterValues(scope, NodeUtil.parseEnv(contents)) };
}

/**
 * Read the optional env files in ascending precedence order. The same path is read once, so a
 * `T3CODE_HOME` that happens to be the user's home directory is not applied twice.
 */
export async function readEnvFiles(options: EnvFileOptions): Promise<readonly EnvFile[]> {
  const homeDir = options.homeDir ?? NodeOS.homedir();
  const t3HomePath = NodePath.resolve(options.t3Home);
  const homeEnvPath = NodePath.resolve(homeDir, HOME_ENV_FILE);
  const t3HomeEnvPath = NodePath.join(t3HomePath, HOME_ENV_FILE);

  const files: EnvFile[] = [];
  const shared = await readEnvFile(homeEnvPath, "home");
  if (shared) files.push(shared);
  if (t3HomeEnvPath !== homeEnvPath) {
    // Anything already read from `$HOME/.env` wins: a duplicate here is the same file's
    // contents re-filtered more permissively, which would be surprising.
    const own = await readEnvFile(t3HomeEnvPath, "t3home");
    if (own) files.push(own);
  }
  return files;
}

/**
 * Copy the file values into `target`. `overwrite: false` keeps anything already present, which
 * is how a direct `t3` run treats an explicit `T3CODE_X=... t3` prefix.
 */
export function applyEnvFileValues(
  target: NodeJS.ProcessEnv,
  files: readonly EnvFile[],
  options: { readonly overwrite: boolean } = { overwrite: true },
): readonly string[] {
  const applied: string[] = [];
  for (const file of files) {
    for (const [name, value] of Object.entries(file.values)) {
      if (!options.overwrite && target[name] !== undefined) continue;
      target[name] = value;
      applied.push(name);
    }
  }
  return applied;
}

/** `$T3CODE_HOME` resolved the way the rest of the server resolves it, without the Effect layers. */
export function resolveT3Home(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.T3CODE_HOME?.trim();
  if (raw && raw.length > 0) return raw;
  return NodePath.join(NodeOS.homedir(), ".t3");
}

/**
 * Load the env files into this process. Called at CLI startup so a downloaded release can be
 * configured without a rebuild; the real environment is never overridden.
 */
export async function loadEnvFilesIntoProcessEnv(
  options: Partial<EnvFileOptions> = {},
): Promise<readonly string[]> {
  const files = await readEnvFiles({
    t3Home: options.t3Home ?? resolveT3Home(),
    homeDir: options.homeDir,
  });
  return applyEnvFileValues(process.env, files, { overwrite: false });
}
