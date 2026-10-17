# Validation

Verified locally on 2026-10-17 with macOS 27.2 (Apple Silicon), installed Computer Use plugin 26.1007.30912, helper MCP server rmcp 1.5.0, Claude Code 2.1.302, and Grok Build 1.0.61.

## Automated coverage

`npm test`: 24 tests pass. Coverage includes plugin discovery/version sorting, malformed manifests, transport concurrency, metadata, hidden-tool rejection, consent accept/cancel/decline, app allowlists, non-app prompt denial, startup errors/timeouts, child-process cleanup, CLI validation/JSON, unique semantic targets despite changing numeric indices, command help, installer idempotency/uninstall/collisions, symlink paths with spaces, malformed image handling, and mixed-display coordinate math.

CI repeats these tests on macOS with Node 18, 22, and 24, then installs the npm tarball and checks its launcher. Synthetic tests do not need a ChatGPT account or computer-use permissions. Live acceptance is separate.

## Live acceptance

| Boundary | Observed result |
| --- | --- |
| Checkout installation | `~/.local/bin/codex-cu` resolves the checkout and runs |
| npm artifact installation | Tarball installs into an isolated prefix; launcher/version and real helper initialization pass |
| Real helper discovery/transport | `doctor` passes core checks |
| Calculator input and read-back | `demo --json` returns `144` for `12 × 12` |
| Screenshot capture | Valid image captured on a 1× display alongside a Retina display; corrected image visually inspected |
| Coordinate input | A coordinate click on the observed All Clear button changes the actual display to zero |
| Stable selectors | `id:` and `label:` resolve fresh state; missing targets fail rather than clicking another element |
| Claude Code through shell | With MCP disabled, clicked `7 × 8` and read `56`; independently read back afterward |
| Grok Build through shell | Using fresh semantic selectors, clicked `9 × 4` and read `36`; independently read back afterward |
| TextEdit | Disposable document: keyboard selection, typed text, paste, save, disk verification, accessibility read-back, and close pass |
| Native browser read | Chrome Beta accessibility tree returned successfully; no page contents are included here |
| Live denial | `CODEX_CU_AUTO_APPROVE=none` refuses Calculator access |

The Grok run using reused numeric indices exposed wrong-button clicks when the accessibility tree changed. This led to the fresh `id:` / `label:` resolver and its regression tests; the subsequent Grok run passed. Numeric indices remain available for explicit use with a current observation; they are not stable selectors.

## Security review

Gitleaks 8.30.1 and a manual path/artifact review are used before publication. Only adapter source, synthetic fixtures, documentation, CI, and the MIT license belong in Git/release artifacts. Live transcripts, screenshots, local config, credentials, and proprietary OpenAI packages are excluded. Commit attribution uses a GitHub noreply email.

## Limits

- No extension-connected browser was available on the test Mac. Rich browser-tab APIs are **not end-to-end verified**; native browser accessibility is a separate path.
- Tests do not certify all apps, every drag/scroll/gesture variant, multiple concurrent agents, Intel Macs, or every display layout.
- Interactive consent UI varies by harness. Protocol response handling is tested; a headless test does not prove an interactive panel appeared.
- App access is not per-action approval. There is no universal guard for consequential actions hidden in arbitrary JavaScript.
- The adapter is OSS; the required ChatGPT runtime/helper is proprietary and uses undocumented interfaces. Future updates can break compatibility.
- No claim of universal or permanent “100%” compatibility is made.
