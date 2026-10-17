# Contributing

Use Node 18 or newer. Run `npm test` and `npm pack --dry-run` before submitting a pull request. There are no runtime npm dependencies.

Keep protocol tests synthetic and deterministic. `npm run test:live` is optional and controls Calculator on the current Mac; it is not part of CI. Do not add app screenshots, live logs, configuration files, private dependencies, or credentials to the repository.

Shared transport and screenshot code originated in codex-cu-mcp. Changes to these files should be considered for both repositories; the CLI is independently installable and does not depend on the MCP package.
