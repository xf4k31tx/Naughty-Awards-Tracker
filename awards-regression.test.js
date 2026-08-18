"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.join(__dirname, "Naughty Awards Tracker.user.js");
const source = fs.readFileSync(file, "utf8");
const instrumented = source.replace(
    /    detectRuntimeAtStartup\(\);[\s\S]*?\n\}\)\(\);\s*$/,
    "    globalThis.__natTest = { buildSummary, incompleteAwardItems, filterAwardItems };\n})();\n"
);
assert.notEqual(instrumented, source, "Unable to instrument the Awards Tracker source");

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
