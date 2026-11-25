import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  applyEnvFileValues,
  loadEnvFilesIntoProcessEnv,
  readEnvFiles,
  resolveT3Home,
} from "./envFiles.ts";

/** Write `home/.env` and `t3home/.env` under a throwaway root and hand back both homes. */
const withTempTree = async (
  layout: Readonly<Record<string, string>>,
  run: (paths: { homeDir: string; t3Home: string }) => Promise<void>,
) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-env-files-"));
  const homeDir = NodePath.join(root, "home");
  const t3Home = NodePath.join(root, "t3home");
  await NodeFSP.mkdir(homeDir, { recursive: true });
  await NodeFSP.mkdir(t3Home, { recursive: true });
  for (const [relativePath, contents] of Object.entries(layout)) {
    await NodeFSP.writeFile(NodePath.join(root, relativePath), contents);
  }
  try {
    await run({ homeDir, t3Home });
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
};

it("reads auth, tunnel and telemetry keys from $T3CODE_HOME/.env", async () => {
  await withTempTree(
    {
      "t3home/.env": [
        "# self-hosted configuration",
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_abc",
        "T3CODE_CLOUDFLARE_API_TOKEN=cf-token",
        'T3CODE_POSTHOG_HOST="https://posthog.example.com"',
        "",
      ].join("\n"),
    },
    async ({ homeDir, t3Home }) => {
      const files = await readEnvFiles({ t3Home, homeDir });
      assert.lengthOf(files, 1);
      assert.equal(files[0]?.scope, "t3home");
      const target: NodeJS.ProcessEnv = {};
      applyEnvFileValues(target, files);
      assert.equal(target.T3CODE_CLERK_PUBLISHABLE_KEY, "pk_test_abc");
      assert.equal(target.T3CODE_CLOUDFLARE_API_TOKEN, "cf-token");
      assert.equal(target.T3CODE_POSTHOG_HOST, "https://posthog.example.com");
    },
  );
});

it("reads only T3CODE_ names from the shared $HOME/.env", async () => {
  await withTempTree(
    {
      "home/.env": [
        "T3CODE_TELEMETRY_ENABLED=true",
        "AWS_SECRET_ACCESS_KEY=do-not-read",
        "PATH=/evil/bin",
        "T3CODE_HOME=/somewhere/else",
      ].join("\n"),
    },
    async ({ homeDir, t3Home }) => {
      const files = await readEnvFiles({ t3Home, homeDir });
      assert.lengthOf(files, 1);
      assert.equal(files[0]?.scope, "home");
      const target: NodeJS.ProcessEnv = {};
      applyEnvFileValues(target, files);
      assert.equal(target.T3CODE_TELEMETRY_ENABLED, "true");
      assert.isUndefined(target.AWS_SECRET_ACCESS_KEY);
      assert.isUndefined(target.PATH);
      assert.isUndefined(target.T3CODE_HOME);
    },
  );
});

it("applies $HOME/.env before $T3CODE_HOME/.env so the install's own file wins", async () => {
  await withTempTree(
    {
      "home/.env": "T3CODE_HOSTED_APP_URL=https://home.example.com\n",
      "t3home/.env": "T3CODE_HOSTED_APP_URL=https://install.example.com\n",
    },
    async ({ homeDir, t3Home }) => {
      const files = await readEnvFiles({ t3Home, homeDir });
      assert.deepEqual(
        files.map((file) => file.scope),
        ["home", "t3home"],
      );
      const target: NodeJS.ProcessEnv = {};
      applyEnvFileValues(target, files);
      assert.equal(target.T3CODE_HOSTED_APP_URL, "https://install.example.com");
    },
  );
});

it("keeps an explicit process environment when overwrite is off", async () => {
  await withTempTree(
    { "t3home/.env": "T3CODE_RELAY_URL=https://from-file.example.com\n" },
    async ({ homeDir, t3Home }) => {
      const files = await readEnvFiles({ t3Home, homeDir });
      const target: NodeJS.ProcessEnv = { T3CODE_RELAY_URL: "https://from-shell.example.com" };
      const applied = applyEnvFileValues(target, files, { overwrite: false });
      assert.deepEqual(applied, []);
      assert.equal(target.T3CODE_RELAY_URL, "https://from-shell.example.com");
    },
  );
});

it("is a no-op when neither file exists", async () => {
  await withTempTree({}, async ({ homeDir, t3Home }) => {
    assert.deepEqual(await readEnvFiles({ t3Home, homeDir }), []);
  });
});

it("resolves $T3CODE_HOME before falling back to ~/.t3", () => {
  assert.equal(resolveT3Home({ T3CODE_HOME: "/srv/t3/" }), "/srv/t3/");
  assert.equal(resolveT3Home({}), NodePath.join(NodeOS.homedir(), ".t3"));
});

it("does not override the environment it is loaded into", async () => {
  await withTempTree(
    { "t3home/.env": "T3CODE_PRIVACY_URL=https://file.example.com/privacy\n" },
    async ({ homeDir, t3Home }) => {
      const previous = process.env.T3CODE_PRIVACY_URL;
      process.env.T3CODE_PRIVACY_URL = "https://shell.example.com/privacy";
      try {
        const applied = await loadEnvFilesIntoProcessEnv({ t3Home, homeDir });
        assert.deepEqual(applied, []);
        assert.equal(process.env.T3CODE_PRIVACY_URL, "https://shell.example.com/privacy");
      } finally {
        if (previous === undefined) delete process.env.T3CODE_PRIVACY_URL;
        else process.env.T3CODE_PRIVACY_URL = previous;
      }
    },
  );
});
