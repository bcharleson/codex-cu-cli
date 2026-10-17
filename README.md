# codex-cu-cli

Control macOS apps from the terminal with **Codex Computer Use**. Give Claude Code, Grok Build, or another shell-capable agent one command: `codex-cu`.

**No MCP registration is needed in your harness.** The CLI manages the installed helper's protocol internally. This is an MIT-licensed, dependency-free adapter; OpenAI's proprietary runtime/helper is required and is not included.

## Install

Requirements: macOS, the ChatGPT desktop app, and Computer Use enabled at least once in Codex. Grant the **Codex Computer Use** helper Accessibility and Screen Recording access when macOS requests it. Feature availability depends on your installed ChatGPT version/account.

```bash
git clone https://github.com/bcharleson/codex-cu-cli.git
cd codex-cu-cli
./install.sh
```

The installer links `~/.local/bin/codex-cu` to this checkout. Keep the checkout in place. If that directory is not on PATH, add this to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

No separate Node installation is needed for this route: the launcher uses ChatGPT's bundled Node. An explicit runtime can be selected with `CODEX_CU_NODE=/absolute/path/to/node` (Node 18+).

Then verify the real helper:

```bash
codex-cu doctor
codex-cu demo                         # Calculator: 12 × 12 = 144
codex-cu screenshot Calculator -o /tmp/calculator.jpg
```

With npm installed, a checkout or release tarball can also be installed globally:

```bash
npm install -g .
# or: npm install -g /path/to/codex-cu-cli-0.1.0.tgz
```

Both `codex-cu` and `codex-cu-cli` are npm binary names. No npm registry publication is assumed; use the repository or a release tarball.

## Use from any harness

Ask an agent with shell access:

> Use the codex-cu CLI through your shell tool to calculate 7 × 8 in Calculator. Read back the actual display. Run codex-cu help first if needed. Leave the window in the background.

The harness must run on the same Mac, have `codex-cu` on PATH (or use its absolute path), and permit the shell commands. Remote Linux/cloud sandboxes cannot access this Mac's helper. Use the harness's image-viewing capability to inspect screenshot files when clicking by coordinates.

[Claude Code](https://code.claude.com/docs/en/permissions) and [Grok Build](https://docs.x.ai/build/features/permissions) control permission to execute shell tools. Their shell approval is separate from the helper's app-access policy below.

## Commands

```bash
codex-cu apps --json
codex-cu state Calculator --json
codex-cu screenshot Calculator -o /tmp/calculator.jpg --json
codex-cu click Calculator 392,745      # example only: use YOUR fresh screenshot
codex-cu click Calculator id:Nine     # resolve a stable accessibility ID now
codex-cu click Calculator label:Multiply
codex-cu click Calculator label:Equals
codex-cu key Calculator Escape
codex-cu type TextEdit 'hello'
codex-cu paste TextEdit 'multi-line text'
codex-cu scroll Safari 400,300 down 2
codex-cu drag Finder 100,100 400,100
codex-cu set TextEdit 12 'value'
codex-cu action Calculator 0 Raise
codex-cu help
```

Coordinates refer to screenshot pixels, not physical desktop coordinates. Coordinate clicks glide the helper's cursor; accessibility-index clicks are faster. Windows stay in place unless you use `--show`, `raise`, or a Raise action. Opening an app that is not running may still change desktop state.

Use `--json` for machine-readable stdout; diagnostics go to stderr. Successful action results contain `ok`, `text`, and `images` (saved file paths). `apps --json` contains inventory arrays; `doctor --json` contains checks. Failures return `ok: false`, an error, and a nonzero exit status. Usage errors exit 2; operational failures exit 1. JSON is a convenience for CLI consumers, not an MCP transport.

Options include `--right`, `--double`, `--key cmd`, `--hold 800`, `--show`, `--quiet`, and `-o <image-path>`. See `help` for where each applies. Use `--` before literal text beginning with `--`.

Every command starts a fresh session. Numeric element indices can change as the UI changes. Prefer `id:Identifier` or `label:Name`: the CLI resolves these against fresh state and refuses zero or multiple matches. Identifiers and labels themselves can also change (for example Calculator Clear vs All Clear). Read state when a target is missing. For dependent steps in one persistent session, use JavaScript:

```bash
codex-cu js --app Calculator 'await app.pressKey("Escape"); await app.pressKey("9"); await app.pressKey("*"); await app.pressKey("4"); await app.pressKey("Return"); await app.getAXState();' --json
```

`--app` binds `app` before your code. Without `--app`, the first call must be one entry point such as `await cua.getState();`. The installed helper returns its own API documentation. JavaScript is trusted code, not a sandboxed command language.

## App approval and data

The CLI is non-interactive and does not show macOS approval pop-ups of its own. By default, `CODEX_CU_AUTO_APPROVE=all` allows helper app-access requests. Restrict it when appropriate:

```bash
CODEX_CU_AUTO_APPROVE=Calculator codex-cu demo
CODEX_CU_AUTO_APPROVE=none codex-cu state Calculator  # expected refusal
```

An allowlist accepts display names, comma-separated and case-insensitive. This policy covers app-access prompts, **not authorization for every action** and not a security sandbox. An allowed app can contain signed-in accounts and sensitive data. The helper's blocked-app policies still apply. Non-app prompts (for example audio recording) are declined by this shell client.

The adapter requires no API key, has no telemetry service, and does not upload screenshots or logs. Output goes to stdout or the requested image file. Your harness and the installed OpenAI components can have their own network behavior and data policies. Do not commit screenshots, app inventories, credentials, or live test output.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_CU_AUTO_APPROVE` | `all` | App access: `all`, `none`, or comma-separated app display names |
| `CODEX_CU_NODE` | ChatGPT's bundled Node | Override the launcher runtime |
| `CODEX_HOME` | `~/.codex` | Installed plugin cache location |
| `CODEX_CU_GLIDE` | `1` | Coordinate-click guidance for custom JS |
| `CODEX_CU_SCALE_FIX` | `1` | Mixed-resolution screenshot correction; `0` disables it |
| `CODEX_CU_VERBOSE` | unset | Log plugin discovery to stderr when `1` |
| `CODEX_CU_BIN_DIR` | `~/.local/bin` | Checkout installer destination |

## Troubleshooting and limits

- **Plugin missing:** open ChatGPT → Codex and enable Computer Use. The adapter cannot install OpenAI's private components.
- **Permission denied / no input / blank screenshot:** check macOS Privacy & Security → Accessibility and Screen Recording for Codex Computer Use; reconnect after permission changes.
- **Doctor passes but an action fails:** doctor verifies inventory and transport. `demo` and `screenshot` separately test input and capture.
- **Browser tabs unavailable:** native browser control uses the same app commands. Rich tab APIs need the Codex browser extension/native host. A browser visible in app inventory is not proof of a tab connection.
- **Clicks land incorrectly:** take a fresh screenshot; avoid moving/resizing the target during execution. Mixed-resolution correction is heuristic; disable `CODEX_CU_SCALE_FIX` if a future helper version no longer needs it.
- **App updates:** discovery selects the newest installed plugin at launch. Unsupported manifest changes fail with an error, rather than silently using an older version.
- **Concurrent agents:** each has its own session, but they share the same desktop. Do not let multiple agents act on the same app at once.

This project relies on undocumented OpenAI interfaces. Tested scenarios are listed in [validation](docs/validation.md); there is no guarantee for every app, harness, display arrangement, or future ChatGPT release.

## Development and removal

```bash
npm test                 # synthetic protocol, failure-path, installer and CLI tests
npm run test:live        # opt-in: operates Calculator, checks 144 and a screenshot
npm run test:live:textedit # opt-in: creates, edits, verifies, closes a temporary TextEdit file
npm pack --dry-run       # review release contents
./install.sh --uninstall # remove this checkout's symlink only
# For an npm install: npm uninstall -g codex-cu-cli
```

The live smoke test saves screenshots only in a temporary directory and removes them. Automated CI uses synthetic fixtures and does not require an OpenAI account or macOS permissions.

[MIT](LICENSE). Derived from [codex-cu-mcp](https://github.com/bcharleson/codex-cu-mcp). This is an unofficial community project, not an OpenAI, Anthropic, or xAI product. Only this adapter is open source; the required ChatGPT runtime/helper is not redistributed.
