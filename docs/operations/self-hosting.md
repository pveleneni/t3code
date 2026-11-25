# Self-hosting a fork

This is the runbook for running T3 Code from your own build: how a tag becomes downloadable
artifacts, and how the people downloading them configure auth, tunnels and telemetry without
rebuilding anything.

## Building and publishing

`.github/workflows/selfhost-release.yml` runs on a tag push (`git tag v1.4.0 && git push
origin v1.4.0`) and publishes a GitHub Release for that tag containing:

| Artifact                           | Used by                           |
| ---------------------------------- | --------------------------------- |
| `t3-<version>-linux-x64.tar.gz`    | `scripts/install.sh`              |
| `t3-<version>-linux-arm64.tar.gz`  | `scripts/install.sh`              |
| `t3-<version>-darwin-arm64.tar.gz` | `scripts/install.sh`              |
| `t3-<version>-win32-x64.zip`       | `scripts/install.ps1`             |
| `SHA256SUMS`                       | both installers verify against it |
| `*.dmg`, `*.AppImage`, `*.exe`     | desktop apps                      |

The assets are named exactly as the installers expect, so the install command on the release
page works with no edits.

Two things the workflow deliberately does not do:

- **It does not reuse `release.yml`.** That pipeline is gated on the upstream repository slug
  (`if: github.repository == 'pingdotgg/t3code'`) and runs on Blacksmith runners, so in a fork
  every job is skipped and nothing is produced. Disable it in your fork to keep tag pushes from
  showing a second, empty run.
- **It publishes no `latest*.yml` / `*.blockmap`.** Those are `electron-updater` manifests.
  Handing them out would point other people's installs at your build as an update feed. Without
  them the desktop app reports updates as unavailable, which is the right answer for a fork.

Everything is on GitHub-hosted runners (`macos-latest`, `ubuntu-24.04`, `ubuntu-24.04-arm`,
`windows-2025`), and the packaging reuses `release-desktop.yml`, the same reusable workflow the
upstream release calls. Both macOS architectures and Linux x64/arm64 are built; Windows x64 is
cross-built on Linux and verified on a Windows runner, the same way upstream does it.

### Values the build needs

Set these as **Repository Variables** (Settings → Secrets and variables → Actions → Variables),
not Secrets. They are public identifiers, and a Variable that is empty is visibly empty instead
of silently wrong. `.env.build.example` lists them all; the important ones:

- `T3CODE_CLERK_PUBLISHABLE_KEY`, `T3CODE_CLERK_JWT_TEMPLATE`,
  `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID` — bake your Clerk instance in, so users get working sign-in
  with no configuration. Leave them empty and cloud features stay off until a user sets them.
- `T3CODE_HOSTED_APP_URL`, `T3CODE_RELAY_URL` — the origin of your install and your relay.

No secrets are required to produce a release. Code signing is optional: without Apple
credentials the `.dmg` is unsigned (Gatekeeper asks the user to right-click → Open) and without
Azure Trusted Signing the `.exe` raises SmartScreen warnings. Both are worth adding before you
ask strangers to install your build; neither blocks publishing.

The Cloudflare tunnel token is **not** a build value. It belongs to the person running the
install, and it is the only real secret in the runtime config.

## Configuring a downloaded build

There is one file to edit, in one of two places:

- `$T3CODE_HOME/.env` — default `~/.t3/.env`. Belongs to this install and accepts any T3 key.
- `$HOME/.env` — shared with every other tool on the machine, so **only `T3CODE_*` names are
  read from it**. Useful when several installs should share one set of credentials.

Copy `.env.example` into place, uncomment what you need, and restart the server
(`t3 service restart`, or stop and start `t3`). Nothing is re-downloaded and nothing is rebuilt.

Precedence, lowest to highest:

```
$HOME/.env  <  $T3CODE_HOME/.env  <  service.env  <  the real process environment
```

`service.env` sits above the user files because `t3 up` owns the network keys there (host, port,
LAN, T3 Connect); change those through the CLI rather than by hand. An explicit
`T3CODE_X=... t3` still wins over every file, which is what makes one-off overrides work.

Nothing in either file is required. A local-only server with no `.env` runs exactly as before —
unset values disable the cloud feature that needs them.

### Per-platform paths

|                | macOS / Linux                                                  | Windows                                             |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Install home   | `~/.t3` or `$T3CODE_HOME`                                      | `%USERPROFILE%\.t3` or `%T3CODE_HOME%`              |
| Runtime config | `~/.t3/.env`                                                   | `C:\Users\<you>\.t3\.env`                           |
| Shared config  | `$HOME/.env`                                                   | `C:\Users\<you>\.env`                               |
| Service unit   | `~/.config/systemd/user/*` or `~/Library/LaunchAgents/*.plist` | `%LOCALAPPDATA%\t3code\<task>.xml` (Task Scheduler) |
| CLI on PATH    | `~/.local/bin`                                                 | `~/.local\bin` (add it to PATH yourself)            |

`T3CODE_HOME` is resolved first, then `os.homedir()` — which on Windows is `USERPROFILE`. There
is no `HOME` variable on Windows, so scripts must not depend on one.

On Windows the config file's protection is NTFS inheritance on your profile (you, SYSTEM and
Administrators), not a file mode: `chmod` is a no-op there. Keep `~\.t3` inside the profile and
do not put the Cloudflare token on a share.

### What still needs a rebuild

The mobile app. `EXPO_PUBLIC_*` values and the Clerk relying party are compiled into the binary,
so a user who wants their own domain and their own Clerk on mobile has to build the app. The
desktop app and the CLI resolve all of the above at runtime, so they do not.

## Verifying an install

```bash
t3 status --json      # service state and resolved remote-access settings
t3 service status     # is the background service installed and running
```

The server prints a named-env message when a cloud feature is missing a value, and
`hasCloudPublicConfig` stays false when the Clerk publishable key or relay URL is absent — the
hosted UI then simply does not appear. If sign-in is missing after editing `.env`, check that the
file is in the install home (not the shell's working directory) and that the service was
restarted.
