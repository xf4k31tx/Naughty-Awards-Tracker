"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const file = path.join(__dirname, "Naughty Awards Tracker.user.js");
const source = fs.readFileSync(file, "utf8");
const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
const instrumented = source.replace(
    /    detectRuntimeAtStartup\(\);[\s\S]*?\n\}\)\(\);\s*$/,
    "    globalThis.__natTest = { buildSummary, incompleteAwardItems, filterAwardItems, panelBounds, clampPanelSize, state, STORAGE, STORAGE_DELETE, createStorageAdapter, STORAGE_ADAPTER, loadStoragePreference, setUseLegacyGMStorage, storageMethodLabel, formatInteger, createBackupPayload, validateBackupPayload, validateBackupPosition, parseBackupPayload, getMinimizedPosition, isKeyboardOverlayResize, nextDailyRefreshAt, dailyRefreshPeriodKey, hasAwardsSnapshotForRefreshPeriod, needsDailyAwardsRefresh };\n})();\n"
);
assert.notEqual(instrumented, source, "Unable to instrument the Awards Tracker source");
assert.match(source, /@version\s+\d+\.\d+\.\d+/, "Userscript metadata must retain a semantic version");
assert.match(source, /@license\s+MIT/, "metadata must declare the MIT license");
assert.match(source, /https:\/\/github\.com\/SharpSplinter\/Naughty-Awards-Tracker/, "metadata must use the renamed GitHub account");
assert.match(source, /https:\/\/raw\.githubusercontent\.com\/SharpSplinter\/Naughty-Awards-Tracker\/main/, "metadata must update from the renamed account");
assert.doesNotMatch(source + readme, /xf4k31tx/, "stale GitHub account links must not remain");
assert.match(source, /data-corner='bottom-left'[^>]*aria-label='Resize window from the bottom-left corner/, "Bottom-left resize control must remain accessible");
assert.match(source, /data-corner='bottom-right'[^>]*aria-label='Resize window from the bottom-right corner/, "Bottom-right resize control must remain accessible");
assert.match(source, /querySelectorAll\("\.nat-resize"\)\.forEach\(\(handle\) => handle\.addEventListener\("keydown"/, "Resize controls must retain keyboard support");
assert.match(source, /#nat-body\{[^}]*overflow:auto[^}]*scrollbar-width:none[^}]*scrollbar-color:transparent transparent/, "The main scroll region must remain scrollable with hidden scrollbars");
assert.match(source, /#nat-body::-webkit-scrollbar,\.nat-list::-webkit-scrollbar\{display:none!important/, "WebKit scrollbars must stay hidden");
assert.match(source, /#nat-body\{[^}]*overflow:auto[^}]*touch-action:pan-y pinch-zoom[^}]*-webkit-overflow-scrolling:touch/, "The main scroll region must preserve touch scrolling");
assert.match(source, /\.nat-list\{[^}]*max-height:none[^}]*overflow:visible/, "Collection wrappers must not create clipped nested scrolling");
assert.match(source, /#nat-body::-webkit-scrollbar-track[^}]*background:transparent!important/, "Scrollbar tracks must stay visually hidden");
assert.match(source, /<main id='nat-body' tabindex='0' aria-label='Awards Tracker content'>/, "The main scroll region must remain keyboard-focusable");
assert.match(readme, /one keyboard-focusable content region/, "README must document the scrolling behavior");
assert.match(source, /function panelBounds\(viewport, safeArea = \{\}, gutter = 0\)/, "Panel geometry must be calculated from viewport and safe-area bounds");
assert.match(source, /#nat-safe-area-probe\{[^}]*padding:env\(safe-area-inset-top/, "Safe-area insets must be measurable by the layout clamp");
assert.match(source, /#nat-wrapper\{box-sizing:border-box;max-inline-size:var\(--nat-panel-max-width/, "The panel must cap its border box to the live viewport bounds");
assert.match(source, /window\.visualViewport\?\.addEventListener\("scroll", refreshViewportLayout\)/, "Visual viewport movement must re-clamp the panel");
assert.match(source, /function isKeyboardOverlayResize\(viewport, stableViewport\)/, "TornPDA keyboard resizes must be identified before reflowing the panel");
assert.match(source, /navigator\.virtualKeyboard/, "TornPDA must feature-detect the native virtual keyboard API");
assert.match(source, /virtualKeyboard\.overlaysContent = true/, "Supported TornPDA runtimes must opt into native keyboard overlay mode");
assert.match(source, /if \(keyboardOverlay\) return;/, "Keyboard visual-viewport changes must not resize or move the active panel");
assert.match(source, /dashboard\.addEventListener\("focusin", \(event\) => prepareKeyboardOverlay\(event\.target\)\)/, "Text focus must preserve the pre-keyboard viewport before the native keyboard opens");
assert.match(source, /font-size:16px!important;-webkit-user-select:text/, "TornPDA text inputs must avoid mobile browser auto-zoom while typing");
assert.match(readme, /navigator\.virtualKeyboard\.overlaysContent/, "README must document the native keyboard overlay behavior");
assert.match(source, /if \(state\.isMinimized\) applyPosition\(\);\s*else applySize\(\);/, "Minimized panels must also remain inside live viewport bounds");
assert.match(source, /function restoreMinimizedWidget\(\)/, "Minimized launchers must use one restore path");
assert.match(source, /dashboard\.addEventListener\("pointerdown", \(event\) => \{\s*if \(!state\.isMinimized && !event\.target\.closest\("#nat-drag"\)\) return;/, "The entire minimized launcher must start a drag");
assert.match(source, /const restoreAfterTap = event\?\.type === "pointerup" && state\.isMinimized && !moved;/, "A tap on the minimized launcher must restore it without confusing a drag for a tap");
assert.match(source, /dragStartX = event\.clientX;\s*dragStartY = event\.clientY;/, "Launcher drag detection must track the initial pointer location");
assert.match(source, /moved = moved \|\| Math\.abs\(event\.clientX - dragStartX\) > 2 \|\| Math\.abs\(event\.clientY - dragStartY\) > 2;/, "Slow launcher drags must not be mistaken for taps");
assert.match(source, /dashboard\.addEventListener\("click", \(\) => \{\s*if \(!state\.isMinimized \|\| moved\) return;\s*restoreMinimizedWidget\(\);/, "Click fallback must restore from any part of the minimized launcher");
assert.match(source, /minimized: \{ x: rect\.left, y: rect\.top \}/, "Dragging a minimized launcher must persist its exact coordinates");
assert.match(source, /const minimizedPosition = state\.isMinimized \? getMinimizedPosition\(saved\) : null;/, "Saved minimized coordinates must be reapplied only for the launcher");
assert.match(source, /@container \(max-width:430px\)\{[^}]*\.nat-refresh\{flex-wrap:wrap/, "Compact controls must reflow from the actual panel container width");
assert.match(source, /@container \(max-width:430px\)[\s\S]*?\.nat-award-row\{grid-template-columns:4px minmax\(0,1fr\)/, "Compact award rows must remove their fixed trailing column");
assert.match(source, /#nat-body\{overflow-x:clip;overflow-y:auto\}/, "The content region must never offer horizontal scrolling");
assert.match(readme, /safe-area-adjusted bounds/, "README must document the responsive panel clamp");
assert.match(source, /<span>Screen Size<\/span><strong data-screen-size>/, "Settings must show the live screen size");
assert.match(source, /<span>Layout Profile<\/span><strong data-layout-profile>/, "Settings must show the measured layout profile");
assert.match(source, /<span>Storage Method<\/span><strong data-storage-method>/, "Settings must show the active storage method");
assert.match(source, /data-action='toggle-legacy-storage'/, "Settings must expose the legacy GM storage switch");
assert.match(source, /async function setUseLegacyGMStorage\(enabled\)/, "Legacy storage selection must perform a real storage migration");
assert.match(source, /function createStorageAdapter\(options = \{\}\)/, "Persistence must be centralized in a storage adapter");
assert.match(source, /const pdaSetMany = \(values\) => STORAGE_ADAPTER\.enqueue\(values\)/, "Normal saves must use the debounced storage queue");
assert.match(source, /PDA_storage\.delete\(key\)/, "Native deletion must use TornPDA's single-key delete API");
assert.match(source, /@grant\s+GM_deleteValue/, "Legacy delete support must be granted for Tampermonkey");
assert.match(source, /PDA_INJECTED_API_KEY = "_###PDA-APIKEY###_"/, "TornPDA's injected-key placeholder must remain available");
assert.match(source, /escapeHtml\(usingInjectedKey \? "" : state\.savedApiKey\)/, "An injected key must never be placed into the settings input");
assert.match(source, /\[STORAGE\.key\]: state\.savedApiKey \? state\.savedApiKey : STORAGE_DELETE/, "An injected key must never be persisted by the tracker");
assert.match(source, /nativeBridgeCall\("showToast"/, "TornPDA feedback must use the native toast handler");
assert.match(source, /function awardsFreshness\(\)/, "Each tab must report source-aware data freshness");
assert.match(source, /Awards data · " \+ freshness\.source/, "Status rows must identify their data source");
assert.match(source, /Refresh awards/, "Refresh controls must state their purpose");
assert.match(source, /function standardFeedbackLayer\(\)/, "Desktop feedback must have a stacked-toast layer");
assert.match(source, /toast\.remove\(\);\s*state\.toastTimers\.delete\(timer\);/, "Stacked toasts must clean up independently");
assert.match(source, /nativeBridgeCall\("scheduleNotification"/, "TornPDA reminders must use the native notification handler");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "Automatic refresh must track document visibility");
assert.match(source, /function queueMissedDailyRefresh\(reason = "stale-snapshot"\)/, "A stale snapshot must queue one guarded catch-up refresh");
assert.match(source, /queueMissedDailyRefresh\("startup"\)/, "Startup must catch up a missed UTC-day refresh");
assert.match(source, /queueMissedDailyRefresh\("tab-resumed"\)/, "Returning to an active tab must catch up a missed UTC-day refresh");
assert.doesNotMatch(source, /const scale = Math\.max\(\.72/, "Desktop content must scroll rather than shrink below readable size");
assert.match(readme, /Use legacy GM storage/, "README must document the storage preference");
assert.match(source, /const LOG_PREFIX = "\[Naughty Awards Tracker\]";/, "Console diagnostics must retain a clear script prefix");
assert.match(source, /function apiDiagnosticTarget\(url, method = "GET"\)/, "API logs must use a query-free target helper");
assert.match(source, /API request started/, "API request lifecycle logs must remain available");
assert.match(source, /Runtime confirmed/, "Runtime confirmation logs must remain available");
assert.match(readme, /API keys, query strings, and request headers are never logged/, "README must document secret-safe Console diagnostics");
assert.match(source, /const BACKUP_NAMESPACE = "naughty-awards-tracker\.backup";/, "Awards backups must use a tracker-specific namespace");
assert.match(source, /function validateBackupPayload\(payload\)/, "Awards backup files must be validated before restore");
assert.match(source, /data-action='confirm-backup-restore'/, "Awards backup restore must require a second user action");
assert.match(source, /data-action='toggle-backup-api-key'/, "Awards backup keys must remain opt-in");
assert.match(source, /async function shareTextWithTornPDA\(text, fileName\)/, "Awards backups must use the documented TornPDA native share path");
assert.match(source, /callHandler\("shareFile", \{ base64Data, fileName \}\)/, "Awards backups must pass Base64 data and a filename to TornPDA shareFile");
assert.match(source, /response\?\.status === "success"/, "Awards backups must wait for a successful TornPDA share response");
assert.match(source, /Backup opened in the TornPDA share sheet\./, "Awards backup feedback must identify the native share sheet");
assert.match(source, /backupExportInFlight: false/, "Awards backups must prevent overlapping native share requests");

const legacyValues = new Map();
const pdaValues = {};
const diagnostics = [];
const logger = Object.fromEntries(["log", "info", "debug", "warn", "error"].map((level) => [level, (...args) => diagnostics.push(args.join(" "))]));
const sandbox = {
    window: { setTimeout, clearTimeout }, document: { visibilityState: "visible" }, console: logger, setTimeout, clearTimeout,
    GM_info: { script: { version: "test" } },
    GM: {
        getValue: async (key, fallback) => legacyValues.has(key) ? legacyValues.get(key) : fallback,
        setValue: async (key, value) => { legacyValues.set(key, value); }
    },
    PDA_storage: {
        loadAll: async () => pdaValues,
        setMany: async (values) => { Object.assign(pdaValues, values); },
        delete: async (key) => { delete pdaValues[key]; }
    }
};
sandbox.globalThis = sandbox;
vm.runInNewContext(instrumented, sandbox, { filename: file });
const {
    buildSummary, incompleteAwardItems, filterAwardItems, panelBounds, clampPanelSize,
    state, STORAGE, STORAGE_DELETE, createStorageAdapter, loadStoragePreference,
    setUseLegacyGMStorage, storageMethodLabel, formatInteger, createBackupPayload, validateBackupPayload, validateBackupPosition, parseBackupPayload, getMinimizedPosition, isKeyboardOverlayResize, nextDailyRefreshAt, dailyRefreshPeriodKey, hasAwardsSnapshotForRefreshPeriod, needsDailyAwardsRefresh
} = sandbox.__natTest;

const portraitBounds = panelBounds(
    { left: 0, top: 0, width: 320, height: 480 },
    { left: 10, right: 15, top: 20, bottom: 10 },
    6
);
assert.equal(portraitBounds.left, 16, "Safe-area-aware bounds must preserve the left inset and gutter");
assert.equal(portraitBounds.right, 299, "Safe-area-aware bounds must preserve the right inset and gutter");
assert.equal(portraitBounds.width, 283, "Portrait panel width must fit inside the actual safe viewport");
const portraitSize = clampPanelSize(
    { width: 960, height: 960 },
    { width: 480, height: 620 },
    { minWidth: 300, minHeight: 340, maxWidth: portraitBounds.width, maxHeight: portraitBounds.height }
);
assert.equal(portraitSize.width, portraitBounds.width, "Oversized saved widths must clamp to the portrait safe viewport");
assert.equal(portraitSize.height, portraitBounds.height, "Oversized saved heights must clamp to the portrait safe viewport");
const tinyBounds = panelBounds({ left: 0, top: 0, width: 20, height: 20 }, { left: 100, right: 100, top: 100, bottom: 100 }, 6);
assert.equal(tinyBounds.width, 1, "Extreme insets must not create negative or horizontal-overflowing bounds");
assert.equal(tinyBounds.height, 1, "Extreme insets must not create negative or vertically-overflowing bounds");

assert.equal(
    isKeyboardOverlayResize({ left: 0, top: 0, width: 390, height: 360, orientation: "portrait" }, { left: 0, top: 0, width: 390, height: 840, orientation: "portrait" }),
    true,
    "A focused TornPDA viewport that only loses substantial height must be treated as a native keyboard overlay"
);
assert.equal(
    isKeyboardOverlayResize({ left: 0, top: 0, width: 844, height: 390, orientation: "landscape" }, { left: 0, top: 0, width: 390, height: 840, orientation: "portrait" }),
    false,
    "An orientation-sized width change must remain a normal responsive layout update"
);
assert.equal(
    isKeyboardOverlayResize({ left: 0, top: 0, width: 390, height: 780, orientation: "portrait" }, { left: 0, top: 0, width: 390, height: 840, orientation: "portrait" }),
    false,
    "Small browser-chrome viewport changes must remain normal responsive updates"
);

const beforeDailyRefresh = Date.UTC(2026, 7, 27, 0, 3, 59);
state.refreshedAt = Date.UTC(2026, 7, 26, 0, 4, 1);
assert.equal(dailyRefreshPeriodKey(state.refreshedAt), "2026-08-26", "Daily refresh periods must shift at 00:04 UTC");
assert.equal(dailyRefreshPeriodKey(Number.MAX_VALUE), "", "Invalid stored refresh timestamps must not break the tracker");
assert.equal(nextDailyRefreshAt(beforeDailyRefresh), Date.UTC(2026, 7, 27, 0, 4, 0, 250), "The next automatic refresh must wait for 00:04 UTC");
assert.equal(hasAwardsSnapshotForRefreshPeriod(beforeDailyRefresh), true, "A prior snapshot remains current until the 00:04 UTC boundary");
assert.equal(needsDailyAwardsRefresh(beforeDailyRefresh), false, "The 00:00 UTC update window must not trigger a duplicate request");
assert.equal(needsDailyAwardsRefresh(Date.UTC(2026, 7, 27, 0, 4, 1)), true, "A new 00:04 UTC refresh period must become eligible for one catch-up request");

const savedLauncherPosition = getMinimizedPosition({ minimized: { x: 42, y: 84 } });
assert.equal(savedLauncherPosition?.x, 42, "Saved launcher x-coordinate must be reusable");
assert.equal(savedLauncherPosition?.y, 84, "Saved launcher y-coordinate must be reusable");
assert.equal(getMinimizedPosition({ minimized: { x: "not-a-coordinate", y: 84 } }), null, "Invalid launcher coordinates must be ignored");
assert.equal(validateBackupPosition({ edge: "right", x: 10, y: 20, minimized: { x: 42, y: 84 } }), true, "Backups must preserve minimized launcher positions");
assert.equal(validateBackupPosition({ edge: "right", x: 10, y: 20, minimized: { x: 42 } }), false, "Backups must reject incomplete minimized launcher positions");

const summary = buildSummary([
    { id: "1", name: "First Steps", description: "First catalog award", rarity: "Common" },
    { id: 1, name: "Duplicate", description: "Must be ignored", rarity: "Rare" },
    { id: 2, name: "Second Wind", description: "Second catalog award", rarity: "Uncommon" },
    { id: 3, name: "Missing Link", description: "Unowned catalog award", rarity: "Rare" }
], [
    { id: "1", timestamp: 50 },
    { id: 1, timestamp: 25 },
    { id: 2, timestamp: 10 },
    { id: 0, timestamp: 99 }
], "Honor");

assert.equal(summary.totalAvailable, 3, "Catalog IDs should be deduplicated");
assert.equal(summary.totalEarned, 2, "Owned IDs should be deduplicated");
assert.equal(summary.earned[0].timestamp, 50, "The most recent earned timestamp should be kept");
assert.equal(summary.earned[0].name, "First Steps", "Completed rows should use catalog metadata");
assert.deepEqual(Array.from(summary.ownedIds), [1, 2], "Owned IDs should use numeric catalog IDs");
assert.deepEqual(Array.from(incompleteAwardItems(summary), (item) => item.id), [3], "Incomplete must contain every and only unowned catalog definition");
assert.deepEqual(Array.from(filterAwardItems(incompleteAwardItems(summary), "rare"), (item) => item.name), ["Missing Link"], "Incomplete search should include rarity");
assert.deepEqual(Array.from(filterAwardItems(summary.earned, "second catalog"), (item) => item.id), [2], "Completed search should include descriptions");

test("storage adapter prefers native reads and migrates a legacy value once", async () => {
    const native = { current: "native" };
    const legacy = new Map([["current", "legacy"], ["migrate", "legacy-only"]]);
    const writes = [];
    let legacyReads = 0;
    const adapter = createStorageAdapter({
        loadNative: async () => native,
        readLegacy: async (key) => {
            legacyReads += 1;
            return legacy.has(key) ? { found: true, value: legacy.get(key) } : { found: false };
        },
        writeNative: async (values) => { writes.push(values); Object.assign(native, values); return true; },
        deleteNative: async (keys) => { keys.forEach((key) => delete native[key]); return true; },
        writeLegacy: async (values) => { Object.entries(values).forEach(([key, value]) => legacy.set(key, value)); return true; },
        deleteLegacy: async (keys) => { keys.forEach((key) => legacy.delete(key)); return true; },
        isLegacyPrimary: () => false,
        schedule: () => 0,
        cancel: () => {}
    });
    assert.equal(await adapter.read("current", "fallback"), "native", "Native storage must win over stale legacy data");
    assert.equal(legacyReads, 0, "A native hit must not wait on the compatibility backend");
    assert.equal(await adapter.read("migrate", "fallback"), "legacy-only", "Legacy data must remain readable during native adoption");
    assert.equal(await adapter.read("migrate", "fallback"), "legacy-only", "The migrated value must read from the native cache thereafter");
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ migrate: "legacy-only" }], "A legacy value must be promoted into native storage only once");
});

test("storage adapter batches queued writes and falls back after a native quota error", async () => {
    const nativeWrites = [];
    const legacy = new Map();
    let nativeAttempts = 0;
    const adapter = createStorageAdapter({
        loadNative: async () => ({}),
        readLegacy: async () => ({ found: false }),
        writeNative: async (values) => { nativeWrites.push(values); return true; },
        deleteNative: async () => true,
        writeLegacy: async (values) => { Object.entries(values).forEach(([key, value]) => legacy.set(key, value)); return true; },
        deleteLegacy: async () => true,
        isLegacyPrimary: () => false,
        schedule: () => 0,
        cancel: () => {}
    });
    const first = adapter.enqueue({ first: 1 });
    const second = adapter.enqueue({ second: 2 });
    assert.equal(adapter.pendingCount, 2, "Queued saves must coalesce before the debounce flush");
    assert.equal(await adapter.flushNow(), true, "The queued batch must persist successfully");
    await Promise.all([first, second]);
    assert.deepEqual(JSON.parse(JSON.stringify(nativeWrites)), [{ first: 1, second: 2 }], "Multiple saves in one debounce window must make one native setMany batch");

    const quotaAdapter = createStorageAdapter({
        loadNative: async () => ({}),
        readLegacy: async () => ({ found: false }),
        writeNative: async () => {
            nativeAttempts += 1;
            const error = new Error("quota");
            error.code = "QuotaExceeded";
            throw error;
        },
        deleteNative: async () => true,
        writeLegacy: async (values) => { Object.entries(values).forEach(([key, value]) => legacy.set(key, value)); return true; },
        deleteLegacy: async () => true,
        isLegacyPrimary: () => false,
        schedule: () => 0,
        cancel: () => {}
    });
    const quotaFirst = quotaAdapter.enqueue({ quotaFirst: 1 });
    assert.equal(await quotaAdapter.flushNow(), true, "Quota errors must preserve the save through legacy storage");
    await quotaFirst;
    const quotaSecond = quotaAdapter.enqueue({ quotaSecond: 2 });
    assert.equal(await quotaAdapter.flushNow(), true, "Future saves must continue through the fallback after quota failure");
    await quotaSecond;
    assert.equal(nativeAttempts, 1, "Quota fallback must stop retrying the blocked native backend");
    assert.equal(legacy.get("quotaFirst"), 1, "The first quota-failed value must be retained by legacy storage");
    assert.equal(legacy.get("quotaSecond"), 2, "Later values must use the fallback safely");
});

test("storage adapter deletion clears native and legacy values without resurrection", async () => {
    const native = { removeMe: "native" };
    const legacy = new Map([["removeMe", "legacy"]]);
    const adapter = createStorageAdapter({
        loadNative: async () => native,
        readLegacy: async (key) => legacy.has(key) ? { found: true, value: legacy.get(key) } : { found: false },
        writeNative: async (values) => { Object.assign(native, values); return true; },
        deleteNative: async (keys) => { keys.forEach((key) => delete native[key]); return true; },
        writeLegacy: async (values) => { Object.entries(values).forEach(([key, value]) => legacy.set(key, value)); return true; },
        deleteLegacy: async (keys) => { keys.forEach((key) => legacy.delete(key)); return true; },
        isLegacyPrimary: () => false,
        schedule: () => 0,
        cancel: () => {}
    });
    const deleted = adapter.remove("removeMe");
    assert.equal(await adapter.flushNow(), true, "Queued deletes must persist");
    await deleted;
    assert.equal(Object.hasOwn(native, "removeMe"), false, "Native data must be removed with PDA_storage.delete semantics");
    assert.equal(legacy.has("removeMe"), false, "Legacy fallback data must also be removed to prevent resurrection");
    assert.equal(await adapter.read("removeMe", "fallback"), "fallback", "A removed key must not return from either backend");
});

test("storage preference migrates current data without diagnostics leaking an API key", async () => {
    legacyValues.clear();
    Object.keys(pdaValues).forEach((key) => delete pdaValues[key]);
    await loadStoragePreference();
    assert.equal(state.useLegacyGMStorage, false, "PDA storage must remain the unchecked default");
    state.apiKey = "nat-test-secret-key";
    state.savedApiKey = "nat-test-secret-key";
    state.cache = { honors: { totalEarned: 2 } };
    state.position = { edge: "right", x: 10, y: 20 };
    state.refreshedAt = 42;
    assert.equal(await setUseLegacyGMStorage(true), true, "Switching to legacy storage must migrate current tracker data");
    assert.equal(state.useLegacyGMStorage, true, "Legacy GM storage must become the active primary store");
    assert.equal(legacyValues.get(STORAGE.key), "nat-test-secret-key", "The saved key must migrate to the selected store");
    assert.equal(legacyValues.get(STORAGE.useLegacyGMStorage), true, "The legacy preference must persist");
    assert.match(storageMethodLabel(), /Legacy GM storage/, "Settings must report legacy GM as the active method");
    assert.equal(await setUseLegacyGMStorage(false), true, "Switching back must migrate current tracker data to PDA storage");
    assert.equal(state.useLegacyGMStorage, false, "PDA storage must become the active primary store again");
    assert.equal(pdaValues[STORAGE.key], "nat-test-secret-key", "The saved key must migrate back to PDA storage");
    assert.equal(legacyValues.get(STORAGE.useLegacyGMStorage), false, "The unchecked preference must persist safely");
    assert.match(storageMethodLabel(), /TornPDA PDA_storage/, "Settings must report PDA storage as the active method");
    assert.equal(await setUseLegacyGMStorage(true), true, "Legacy storage must remain selectable before testing the desktop fallback");
    delete sandbox.PDA_storage;
    assert.equal(await setUseLegacyGMStorage(false), true, "Unchecking must retain GM as a safe fallback when PDA storage is unavailable");
    assert.equal(state.useLegacyGMStorage, false, "The unchecked default must still persist without PDA storage");
    assert.match(storageMethodLabel(), /Legacy GM storage \(fallback\)/, "Settings must identify GM as the fallback when native storage is unavailable");
    assert.doesNotMatch(diagnostics.join("\n"), /nat-test-secret-key/, "Storage diagnostics must never expose the API key");
});

test("numeric values use comma-separated integer formatting", () => {
    assert.equal(formatInteger(1234567.6), "1,234,568");
    assert.match(source, /formatInteger\(viewport\.width\)/, "Screen dimensions must use integer formatting");
    assert.match(source, /formatInteger\(width\).*formatInteger\(height\)/, "Resize feedback must use integer formatting");
});

test("backup files exclude API keys by default and reject foreign or malformed payloads", () => {
    state.savedApiKey = "awards-local-key";
    state.cache = null;
    state.position = null;
    state.refreshedAt = 0;
    state.activeTab = "awards";
    state.theme = "dark";
    state.isMinimized = false;
    state.windowSizes = {};
    state.searchQueries = { honors: "", medals: "" };
    state.collectionViews = { honors: "completed", medals: "completed" };

    const withoutKey = createBackupPayload(false);
    assert.equal(withoutKey.data.includesApiKey, false);
    assert.equal(Object.hasOwn(withoutKey.data, "apiKey"), false);
    assert.doesNotThrow(() => validateBackupPayload(withoutKey));

    const withKey = createBackupPayload(true);
    assert.equal(withKey.data.includesApiKey, true);
    assert.equal(withKey.data.apiKey, "awards-local-key");
    assert.equal(parseBackupPayload(JSON.stringify(withKey)).data.apiKey, "awards-local-key");
    assert.throws(() => validateBackupPayload({ ...withoutKey, namespace: "other" }), /Invalid backup/);
    assert.throws(() => parseBackupPayload("{bad json"), /Invalid backup/);
});
