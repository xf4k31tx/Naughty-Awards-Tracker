"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.join(__dirname, "Naughty Awards Tracker.user.js");
const source = fs.readFileSync(file, "utf8");
const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
const instrumented = source.replace(
    /    detectRuntimeAtStartup\(\);[\s\S]*?\n\}\)\(\);\s*$/,
    "    globalThis.__natTest = { buildSummary, incompleteAwardItems, filterAwardItems };\n})();\n"
);
assert.notEqual(instrumented, source, "Unable to instrument the Awards Tracker source");
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
assert.match(source, /const LOG_PREFIX = "\[Naughty Awards Tracker\]";/, "Console diagnostics must retain a clear script prefix");
assert.match(source, /function apiDiagnosticTarget\(url, method = "GET"\)/, "API logs must use a query-free target helper");
assert.match(source, /API request started/, "API request lifecycle logs must remain available");
assert.match(source, /Runtime confirmed/, "Runtime confirmation logs must remain available");
assert.match(readme, /API keys, query strings, and request headers are never logged/, "README must document secret-safe Console diagnostics");

const sandbox = { window: {}, document: {}, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(instrumented, sandbox, { filename: file });
const { buildSummary, incompleteAwardItems, filterAwardItems } = sandbox.__natTest;

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

console.log("Awards completion regression checks passed.");
