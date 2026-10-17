# Security and privacy

This repository contains adapter source, synthetic fixtures, and documentation. Do not submit credentials, private app content, screenshots, live transcripts, local configuration, or OpenAI binaries in issues or pull requests.

Report a suspected vulnerability through GitHub's private vulnerability reporting for this repository. If that facility is unavailable, open an issue asking for a private reporting channel without disclosing exploitation details or sensitive data.

The CLI executes trusted JavaScript and delegates to a locally installed proprietary helper. It is not a sandbox. App approval does not distinguish reading from sending, deleting, or purchasing. Use harness permissions and explicit user authorization for consequential actions. The adapter cannot guarantee per-action approval from an arbitrary script.

Release review includes Gitleaks scans of the working tree, Git history, and npm package, plus a manual check for machine-specific paths and private artifacts. Automated scanning reduces risk; it cannot prove the absence of every possible secret.
