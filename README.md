# Naughty Awards Tracker

Naughty Awards Tracker is an open-source Torn userscript that gives players a focused, privacy-conscious view of medals, honors, and the nearest configured award milestones. It runs only on Torn’s Awards page and is designed for Tampermonkey and TornPDA.

**Project goal:** make award progress easy to inspect and plan without sending player data to a third-party service. The script reads the Torn API only with the user’s own key and keeps its cache and preferences in local userscript/TornPDA storage.

## Features

- **Awards** dashboard showing the five closest configured progress milestones, including current value, target, type, percentage, and progress bar.
- **Honors** and **Medals** collections with earned and incomplete views.
- Persistent search in Honors and Medals by award name, description, rarity, or ID.
- Collection completion summaries, completion bars, earned/incomplete counts, and rarity chips.
- Award rows with rarity color, title, description, and earned date when applicable.
- Dark and lower-glare light themes.
- Manual refresh plus an automatic daily refresh at 00:00 UTC. Automatic refresh pauses while the document/tab is inactive and safely resumes when it becomes active again.
- Persistent API key, panel layout, theme, active tab, collection view, and search state.
- Native TornPDA detection, safe-area handling, orientation-aware layout, touch-friendly controls, toasts, and daily refresh reminders.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or use TornPDA’s userscript support.
2. Open the [raw userscript](https://raw.githubusercontent.com/SharpSplinter/Naughty-Awards-Tracker/main/Naughty%20Awards%20Tracker.user.js) and install it.
3. Open Torn’s [Awards page](https://www.torn.com/page.php?sid=awards).
4. Open **Settings**, save a Torn API key, then select **Refresh**.

## Using the tracker

### Awards

The default **Awards** tab is a short planning view. It shows the configured milestones closest to completion so the next practical goals are visible without scanning the full catalog.

### Honors and Medals

Each collection provides:

- **Completed** and **Incomplete** switches.
- A persistent search field that matches name, description, rarity, or ID.
- Completion counts and a collection progress bar.
- Rarity grouping and color cues.

Search state and the selected completed/incomplete view are retained locally when switching tabs or reopening the widget.

### Settings and refresh

Use the settings button to save or replace the Torn API key, switch theme, inspect the detected runtime, schedule a refresh reminder, and reset the widget layout. The refresh button reloads award and progress data immediately. A daily timer refreshes automatically at 00:00 UTC only while the script is active; inactive tabs/documents do not start background refreshes and catch up safely when restored.

## Desktop and TornPDA

The desktop widget is movable, resizable, and minimizable. A minimized launcher restores when tapped or clicked anywhere on its icon; drag the icon to choose its saved launcher location, which is reused on later minimizes without changing the full widget's saved placement. TornPDA is detected through its native bridge; the mobile layout follows the live viewport, safe areas, and orientation. Saved dimensions and placement are clamped to the live, safe-area-adjusted bounds, while compact controls, cards, and award rows reflow without horizontal scrolling. Long content uses one keyboard-focusable content region: desktop wheel/keyboard and TornPDA touch scrolling stay active while scrollbar tracks remain hidden. Its metadata declares both legacy and modern userscript storage/network grants for TornPDA and Tampermonkey compatibility.

## TornPDA compatibility and storage

On TornPDA, `PDA_storage` is the first-choice durable, per-script store. The tracker loads that namespace once during bootstrap and sends ordinary saves through one short debounced queue, so nearby API-key, dashboard, position, cache, and refresh-time changes become one native `setMany` call. Native values remain authoritative; a legacy value is copied into the native store only once when its native counterpart is missing. If native storage is unavailable or its quota is exceeded, the same queued change falls back to compatible GM storage and then browser-local storage if needed. Deletions use TornPDA's native `PDA_storage.delete(key)` and clear the compatibility copy too, preventing stale values from returning.

Settings shows the current runtime, live screen size, and storage method. **Use legacy GM storage** is unchecked by default: enabling it first copies the current tracker data to GM/Tampermonkey storage, then makes that store primary; disabling it copies the current data back to `PDA_storage` when available, otherwise retains GM as the fallback. The preference is persisted separately so the chosen primary store survives restarts. Storage diagnostics never include API-key values.

Settings also provides **Backup & Restore**. Download creates a versioned local JSON backup of the tracker cache, refresh timestamp, layout, collection/search preferences, theme, and storage choice. The saved manual API key is excluded by default; it can be included only by checking the explicit export option. TornPDA-injected keys are never exported. In TornPDA, the backup is passed to the documented `shareFile({ base64Data, fileName })` handler so the native system share sheet opens; desktop uses a local file download. Android and iOS choose Files or another destination from that sheet rather than a browser save-location picker. A native share error is reported rather than falsely calling the backup downloaded, and duplicate share requests are prevented. Loading accepts only a validated Awards Tracker backup, shows the pending replacement clearly, and requires a separate Restore action. A key-free backup preserves the API key already saved on the device; restoring only affects local tracker storage and never changes Torn data.

The tracker treats native identity and layout separately. It waits for `flutterInAppWebViewPlatformReady`, then verifies `isTornPDA` before treating the session as TornPDA. A confirmed native session follows the live viewport, safe areas, and orientation, with an additional compact treatment for narrow TornPDA screens; it is not inferred merely from touch capability or a small desktop window. TornPDA's `###PDA-APIKEY###` injected key is adopted automatically when available, takes precedence for the active session, and is never displayed, persisted, or logged by the tracker. Native toast feedback uses `showToast`; **Remind Me at Next Refresh** uses TornPDA's native reminder when available, with a desktop in-page/browser-notification fallback while the tab remains open. Requests use the declared legacy/modern GM network APIs when present and use TornPDA's native `PDA_httpGet` handler only after the bridge is ready. `PDA_storage` needs no extra userscript `@grant`.

## Console diagnostics

The browser Console records startup/runtime confirmation, TornPDA bridge and storage fallbacks, API request start/completion duration, refresh lifecycle, and failures under the `[Naughty Awards Tracker]` prefix. Request logs include only method, host, and path; API keys, query strings, and request headers are never logged.

## Data and privacy

The script stores the Torn API key, UI preferences, cached awards data, and refresh timestamp in local per-script storage. Requests go directly to `api.torn.com`; no third-party award service receives your data.

API keys are secrets. Revoke and replace a key if it may have been exposed.

## Community and governance

Naughty Awards Tracker welcomes focused, well-tested improvements. Before opening an issue or pull request, please read the project standards:

- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- [Feature request template](.github/ISSUE_TEMPLATE/feature_request.yml)
- [Pull request template](.github/pull_request_template.md)

Use the issue templates for normal bugs and ideas. Do not post API keys, exported backups containing keys, or suspected security vulnerabilities in public issues; follow the [security policy](SECURITY.md) instead.

## License

This project is released under the [MIT License](LICENSE). It permits broad use, modification, and redistribution while preserving the copyright and license notice.

## Updating and verification

Reopen the raw userscript URL in your userscript manager to update.

```powershell
node --check "Naughty Awards Tracker.user.js"
node --test awards-regression.test.js
```
