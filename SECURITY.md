# Security Policy

## Supported versions

Security fixes are provided for the current release on the `main` branch. Older installed userscript versions should be updated before reporting a problem unless updating would prevent reproduction.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub Security Advisories for Naughty Awards Tracker](https://github.com/SharpSplinter/Naughty-Awards-Tracker/security/advisories/new). Do not report them in a public issue, discussion, review, or chat message.

Include:

- a clear description of the issue and its potential impact;
- minimal reproduction steps or a proof of concept;
- affected script version, runtime (Tampermonkey or TornPDA), and device/browser details;
- any mitigation or fix idea, if available.

Never send a working Torn API key, TornPDA-injected key, browser cookie, or an unredacted backup. Use placeholders and provide only the minimum data necessary to reproduce the behavior.

The maintainer will aim to acknowledge a valid report within 7 days, investigate privately, and coordinate a fix before public disclosure where practical.

## Scope

Examples of in-scope reports include:

- exposure, persistence, logging, or export of API keys or other secrets;
- unsafe handling of backup/restore data;
- unauthorized cross-origin requests or data exfiltration;
- a TornPDA bridge or storage integration that bypasses the intended privacy boundary;
- script behavior that enables execution of untrusted code.

Questions about Torn account access, gameplay disputes, or third-party website security should be reported to the relevant service, not this repository.
