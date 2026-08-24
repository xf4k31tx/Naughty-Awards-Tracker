# Naughty Awards Tracker

Naughty Awards Tracker is a focused Torn userscript for tracking medals, honors, and the nearest configured award milestones. It is designed for Tampermonkey and TornPDA and runs only on Torn’s Awards page.

## Features

- **Awards** dashboard showing the five closest configured progress milestones, including current value, target, type, percentage, and progress bar.
- **Honors** and **Medals** collections with earned and incomplete views.
- Persistent search in Honors and Medals by award name, description, rarity, or ID.
- Collection completion summaries, completion bars, earned/incomplete counts, and rarity chips.
- Award rows with rarity color, title, description, and earned date when applicable.
- Dark and lower-glare light themes.
- Manual refresh plus an automatic daily refresh at 00:00 UTC.
- Persistent API key, panel layout, theme, active tab, collection view, and search state.
- Native TornPDA detection, safe-area handling, orientation-aware layout, and touch-friendly controls.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or use TornPDA’s userscript support.
2. Open the [raw userscript](https://raw.githubusercontent.com/xf4k31tx/Naughty-Awards-Tracker/main/Naughty%20Awards%20Tracker.user.js) and install it.
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

Use the settings button to save or replace the Torn API key, switch theme, inspect the detected runtime, and reset the widget layout. The refresh button reloads award and progress data immediately. A daily timer also refreshes automatically at 00:00 UTC while the script is active.

## Desktop and TornPDA

The desktop widget is movable, resizable, and minimizable. TornPDA is detected through its native bridge; the mobile layout follows the live viewport, safe areas, and orientation. Small screens reflow award rows and controls instead of relying on cramped desktop dimensions. Its metadata declares both legacy and modern userscript storage/network grants for TornPDA and Tampermonkey compatibility.

## Data and privacy

The script stores the Torn API key, UI preferences, cached awards data, and refresh timestamp in local userscript storage. Requests go directly to `api.torn.com`; no third-party award service receives your data.

API keys are secrets. Revoke and replace a key if it may have been exposed.

## Updating and verification

Reopen the raw userscript URL in your userscript manager to update.

```powershell
node --check "Naughty Awards Tracker.user.js"
node --test awards-regression.test.js
```
