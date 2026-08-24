# Contributing to Naughty Awards Tracker

Thanks for contributing. This project is a small, standalone userscript for Torn’s Awards page, so changes should stay focused, understandable, and safe for both Tampermonkey and TornPDA users.

## Before you begin

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues before starting work.
- Use the issue templates for bugs and feature requests.
- Do not open a public issue for a suspected vulnerability; follow the [security policy](SECURITY.md).
- Never include Torn API keys, TornPDA-injected keys, raw backups containing keys, cookies, account data, or personally identifying information in issues, pull requests, screenshots, or logs.

## Good contributions

Useful contributions improve one or more of the following:

- award, honor, medal, or milestone clarity;
- accessibility, responsive layout, and TornPDA usability;
- reliable local storage, backup, and restore behavior;
- privacy-preserving API handling and error feedback;
- tests, documentation, and reproducible bug reports.

Please keep changes compatible with the script’s limited page scope. Do not add unrelated browsing automation, bypass Torn’s rules, scrape private data, or introduce a service that receives another player’s API key.

## Development workflow

The project has no build step. Make changes directly to the userscript and keep the metadata block accurate.

1. Create a branch from the current `main` branch.
2. Make the smallest practical change.
3. Test the affected desktop and TornPDA/mobile behavior when applicable.
4. Run the checks below from the repository root.
5. Open a pull request using the provided template.

```powershell
node --check "Naughty Awards Tracker.user.js"
node --test awards-regression.test.js
```

## Pull request expectations

- Explain the user-visible change and its reason.
- Keep unrelated formatting or refactors out of the pull request.
- Include or update regression coverage for behavior changes where practical.
- State how the change was tested, including the runtime(s) used.
- Update `README.md` when installation, permissions, storage, backup, privacy, or user-facing behavior changes.
- Preserve API-key redaction in diagnostics and exports.
- Keep the script restricted to its intended Torn page and retain the grants required by Tampermonkey and TornPDA.

Maintainers may request changes for scope, privacy, compatibility, maintainability, or alignment with Torn’s rules and API terms.

## Reporting a bug

A strong report includes:

- concise steps to reproduce;
- expected and actual behavior;
- runtime and screen details (desktop browser or TornPDA, version, orientation when relevant);
- redacted Console output or screenshots;
- whether the issue started after an update.

Do not include secrets. Replace any API key with `[redacted]` before sharing a log or backup.

## License for contributions

By submitting a contribution, you agree that your contribution is licensed under the repository’s [MIT License](LICENSE).
