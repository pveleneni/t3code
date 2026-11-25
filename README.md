> [!NOTE]
> **This is a self-hosted fork of T3 Code.** Nothing here changes T3's hosted service. The fork only removes telemetry defaults (nothing is sent unless you opt in with your own PostHog) and lets you supply your own Cloudflare and Clerk API keys instead of relying on T3's services. See [Using this fork](#using-this-fork) for setup.

## Using this fork

Nothing here changes T3's hosted service. This fork removes telemetry defaults and makes Cloudflare Tunnel and Clerk auth configurable with your own API keys instead of relying on T3's services. Use a build made from this repository: the published T3 Code apps point at T3's hosted service.

### Get a build

Build from source with the [development runbook](./docs/operations/00_development.md#first-checkout) (`vp i`, then `vp run build:desktop` for the CLI and desktop app). Before building, copy `.env.build.example` to `.env` (or `.env.local`) in the repository root and fill in your Clerk keys, hosted app and relay URLs, and install/download links. Those values are compiled into the web, desktop, and CLI artifacts, so changing them later means rebuilding. The tag-driven release workflow described in the [self-hosting runbook](./docs/operations/self-hosting.md) is not included in this fork; add your own GitHub Actions workflow if you want tag pushes to publish releases.

### Configure an installed build

Copy `.env.example` to `~/.t3/.env` (Windows: `%USERPROFILE%\.t3\.env`), uncomment what you need, and restart the server with `t3 service restart` (or stop and start `t3`). No rebuild is needed. `$HOME/.env` also works, but only `T3CODE_*` names are read from it; an explicit `T3CODE_X=... t3` overrides both files.

```dotenv
# ~/.t3/.env — nothing is required for local-only use
T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
T3CODE_CLERK_JWT_TEMPLATE=your_jwt_template
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=your_oauth_client_id
T3CODE_HOSTED_APP_URL=https://t3.example.com
T3CODE_RELAY_URL=https://relay.example.com

T3CODE_CLOUDFLARE_API_TOKEN=your_token       # secret; scope to one zone
T3CODE_CLOUDFLARE_ACCOUNT_ID=your_account_id
T3CODE_CLOUDFLARE_ZONE_ID=your_zone_id
T3CODE_CLOUDFLARE_TUNNEL_HOSTNAME=t3.example.com
T3CODE_CLOUDFLARE_TUNNEL_NAME=t3code-fork   # optional

T3CODE_TELEMETRY_ENABLED=true
T3CODE_POSTHOG_KEY=phc_your_project_key
T3CODE_POSTHOG_HOST=https://posthog.example.com
```

The Cloudflare token needs **Tunnel:Edit** and **DNS:Edit** on the zone; with all tunnel variables set, `t3` provisions the tunnel and DNS record on first start. Telemetry is off unless the flag, key, and host are all set, and events go only to your PostHog project. See [self-hosting](./docs/operations/self-hosting.md), the [tunnel runbook](./docs/operations/self-hosted-cloudflare-tunnel.md), and [telemetry](./docs/user/telemetry.md) for the full list of variables and behavior.

### Mobile apps

The iOS and Android apps from the official stores cannot be pointed at this fork: `EXPO_PUBLIC_*` values and the Clerk passkey relying party are compiled into the app, so using your own domain and auth requires building your own app. Mobile builds also need developer credentials — an Apple Developer Program membership for iOS signing and entitlements, and a Google Play developer account to publish on Android. You are free to fork this repository and publish your own app under your own branding; see [mobile build setup](./apps/mobile/README.md) and [TRADEMARK.md](./TRADEMARK.md).

### Reference

- [Self-hosting this fork](./docs/operations/self-hosting.md)
- [Cloudflare tunnel](./docs/operations/self-hosted-cloudflare-tunnel.md)
- [Telemetry](./docs/user/telemetry.md)

---

*T3 README starts here — everything below is unchanged upstream content.*

<p align="center">
  <a href="https://t3.codes">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="T3 Code logo" />
  </a>
</p>

<h1 align="center">T3 Code</h1>

<p align="center">The open-source control plane for coding agents.</p>

<p align="center">
  <a href="https://t3.codes/download"><strong>Download</strong></a> ·
  <a href="https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824">iOS</a> ·
  <a href="https://play.google.com/store/apps/details?id=com.t3tools.t3code">Android</a> ·
  <a href="https://app.t3.codes">Web</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a>
</p>

<p align="center">
  <a href="https://t3.codes">
    <img src="./.github/readme/hero.webp" width="100%" alt="T3 Code on desktop with a finished Claude thread, next to the phone app asking to approve a command from Codex" />
  </a>
</p>

T3 Code runs the coding agents on your machine and gives them one fast interface. Start a thread at your desk, then approve the next step from your phone.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. If an agent is set up on your computer, T3 Code can control it.

## What you get

- **Your subscriptions.** T3 Code does not resell tokens. It drives the agents you are already signed in to.
- **Every agent in one place.** Change models in the middle of a thread. Let Claude hand a task to Codex.
- **Desktop, web, and phone.** One server, and every client shows the same threads. There are apps for iOS and Android.
- **Remote ready.** Run agents on any machine. Connect over your local network, Tailscale, or [T3 Connect](./docs/user/remote-access.md).
- **Git built in.** Each thread can work in its own worktree. Review the diff, then commit, push, and open a pull request with one button.
- **Fast.** Performance is a feature here. We measure it, and we treat a dropped frame as a bug.
- **Open.** Source code is MIT licensed. If you don't like something, fork it under your own branding (see [Trademarks and forks](#trademarks-and-forks)).

## Install

### Desktop app

[Download T3 Code](https://t3.codes/download) for macOS, Windows, or Linux. You can also use a package manager:

| Platform       | Command                                                              |
| -------------- | -------------------------------------------------------------------- |
| macOS          | `brew install --cask t3-code`                                        |
| Windows        | `winget install T3Tools.T3Code` or `scoop install extras/t3code`     |
| Arch Linux     | `yay -S t3code-bin`                                                  |
| Nix            | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`         |
| Debian, Ubuntu | `.deb` from [Releases](https://github.com/pingdotgg/t3code/releases) |

### Command line

This installs the `t3` command. Run `t3` to start the server and open the web app.

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

To try it once without an install, run `npx t3@latest`.

### Phone

Get the app from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code). Then follow [remote access](./docs/user/remote-access.md) to connect it to your computer.

### Sign in to an agent

T3 Code needs one agent that is installed and signed in. For example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.

[Provider setup](./docs/user/install.md#providers) has the steps for each agent. [Install T3 Code](./docs/user/install.md) covers nightly builds, AppImage, WSL, and NixOS.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork the source code and build the tool that you want, under your own name and branding.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

We have limited review capacity. Small, focused fixes are the most likely to be merged. Features need an approved discussion first.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you report a bug or open a pull request.
- Put feature requests in [Ideas](https://github.com/pingdotgg/t3code/discussions/categories/ideas).
- Build from source with the [development runbook](./docs/operations/00_development.md#first-checkout). The [architecture overview](./docs/internals/01_architecture.md) explains how it works.
- Get help in [Discord](https://discord.gg/jn4EGJjrvv).

## License

The source code in this repository is licensed under the [MIT License](./LICENSE).

## Trademarks and forks

The MIT license applies **only to the source code**. It does not grant any rights to T3 Tools, Inc.'s trademarks, branding, or trade dress, including the **T3 Code** name, wordmark, logos, and application icons.

If you fork, redistribute, or build on T3 Code's source code:

- **Use your own branding.** Replace the T3 Code name, wordmark, logos, and application icons in any public fork, redistributed build, website, package, or app store listing.
- **Be explicitly clear that your project is unofficial.** Do not use the T3 Code name, wordmark, logo, or branding in your own projects without making it unmistakably clear that your project is unofficial and not affiliated with or endorsed by T3 Tools, Inc.

Using our name, wordmark, logo, or branding in a way that suggests official status or affiliation is trademark infringement and unlawful. **Any project indicating or implying that it is an official version of T3 Code when it is not will be pursued to the full extent of the law.**

See [TRADEMARK.md](./TRADEMARK.md) for the full trademark and branding policy.
