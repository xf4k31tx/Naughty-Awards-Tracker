// ==UserScript==
// @name         Naughty Awards Tracker
// @namespace    https://github.com/xf4k31tx/Naughty-Awards-Tracker
// @version      1.3.3
// @description  Focused Torn medal, honor, and award-progress tracker.
// @author       sharpsplinter [315311]
// @match        https://www.torn.com/page.php?sid=awards*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.torn.com
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.3.3";
    const BASE_URL = "https://api.torn.com/v2/";
    const STORAGE = {
        key: "NAT_TORN_API_KEY",
        dashboard: "NAT_DASHBOARD_STATE",
        position: "NAT_WIDGET_POSITION",
        cache: "NAT_AWARDS_CACHE",
        refreshedAt: "NAT_AWARDS_REFRESHED_AT"
    };
    const PDA_STORE = { loaded: null, values: null };
    const RARITY = {
        "Very Common": "#9ca3af",
        Common: "#cbd5e1",
        Uncommon: "#7fe18d",
        Rare: "#60a5fa",
        "Very Rare": "#c9a0ff",
        "Extremely Rare": "#f59e0b",
        Limited: "#e0a25e"
    };
    const CRIME_PATHS = {
        vandalism: ["crimes", "offenses", "vandalism"],
        theft: ["crimes", "offenses", "theft"],
        counterfeiting: ["crimes", "offenses", "counterfeiting"],
        fraud: ["crimes", "offenses", "fraud"],
        "illicit service": ["crimes", "offenses", "illicit_services"],
        cybercrime: ["crimes", "offenses", "cybercrime"],
        extortion: ["crimes", "offenses", "extortion"],
        "illegal production": ["crimes", "offenses", "illegal_production"]
    };
    const state = {
        apiKey: "", activeTab: "awards", theme: "dark", isMinimized: false,
        windowSizes: {}, position: null, cache: null, refreshedAt: 0,
        dashboard: null, refreshInFlight: false, dailyTimer: null, error: "",
        searchQueries: { honors: "", medals: "" }, collectionViews: { honors: "completed", medals: "completed" }, searchSaveTimer: null,
        runtime: {
            isTornPDA: false,
            confirmed: false
        }
    };
    const LOG_PREFIX = "[Naughty Awards Tracker]";

    function redactDiagnostic(value) {
        return String(value ?? "")
            .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
            .replace(/(\bkey\s*[:=]\s*)[^,\s}]+/gi, "$1[redacted]");
    }
    function safeDiagnosticError(error) {
        return redactDiagnostic(error?.message || error || "Unknown error");
    }
    function apiDiagnosticTarget(url, method = "GET") {
        try {
            const target = new URL(String(url), window.location?.origin || "https://www.torn.com");
            return { method: String(method).toUpperCase(), host: target.host, path: target.pathname };
        } catch {
            return { method: String(method).toUpperCase(), host: "unknown", path: "unknown" };
        }
    }
    function logConsole(level, event, details = undefined) {
        const logger = typeof console === "undefined" ? null : (typeof console[level] === "function" ? console[level] : console.log);
        if (typeof logger === "function") logger.call(console, `${LOG_PREFIX} ${event}`, details);
    }
    const logInfo = (event, details) => logConsole("info", event, details);
    const logDebug = (event, details) => logConsole("debug", event, details);
    const logWarn = (event, details) => logConsole("warn", event, details);
    const logError = (event, details, error) => logConsole("error", event, { ...(details || {}), error: safeDiagnosticError(error) });

    function getViewportMetrics() {
        const viewport = window.visualViewport;
        const width = Math.max(1, Math.round(Number(viewport?.width) || window.innerWidth || document.documentElement.clientWidth || 1));
        const height = Math.max(1, Math.round(Number(viewport?.height) || window.innerHeight || document.documentElement.clientHeight || 1));
        return {
            width, height,
            left: Math.round(Number(viewport?.offsetLeft) || 0),
            top: Math.round(Number(viewport?.offsetTop) || 0),
            orientation: height >= width ? "portrait" : "landscape"
        };
    }
    function isTornPdaBridgeAvailable() {
        return Boolean(window.flutter_inappwebview && typeof window.flutter_inappwebview.callHandler === "function");
    }
    function waitForPdaBridge(timeout = 1200) {
        if (isTornPdaBridgeAvailable()) return Promise.resolve(true);
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                window.removeEventListener("flutterInAppWebViewPlatformReady", ready);
                resolve(isTornPdaBridgeAvailable());
            };
            const ready = () => finish();
            window.addEventListener("flutterInAppWebViewPlatformReady", ready, { once: true });
            window.setTimeout(finish, timeout);
        });
    }
    async function pdaCall(handler, ...args) {
        const handlerName = String(handler || "unknown");
        if (!(await waitForPdaBridge())) {
            const error = new Error("TornPDA native bridge is unavailable.");
            logWarn("Native bridge unavailable", { handler: handlerName });
            throw error;
        }
        logDebug("Native handler requested", { handler: handlerName });
        try {
            const response = await window.flutter_inappwebview.callHandler(handler, ...args);
            logDebug("Native handler completed", { handler: handlerName, status: response?.status || "ok" });
            return response;
        } catch (error) {
            logError("Native handler failed", { handler: handlerName }, error);
            throw error;
        }
    }
    function runtimeLabel() {
        if (!state.runtime.isTornPDA) return "Desktop browser";
        return state.runtime.confirmed ? "TornPDA" : "TornPDA · verifying";
    }
    function runtimeDescription() {
        return state.runtime.isTornPDA
            ? "Native TornPDA bridge detected. The panel follows your active device viewport."
            : "Standard desktop browser layout is active.";
    }
    function updateRuntimeLayout() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const viewport = getViewportMetrics();
        dashboard.dataset.runtime = state.runtime.isTornPDA ? "tornpda" : "desktop";
        dashboard.dataset.orientation = viewport.orientation;
        dashboard.dataset.compact = state.runtime.isTornPDA && (viewport.width < 480 || viewport.height < 520) ? "true" : "false";
        dashboard.style.setProperty("--nat-viewport-width", viewport.width + "px");
        dashboard.style.setProperty("--nat-viewport-height", viewport.height + "px");
        const label = dashboard.querySelector("[data-runtime-label]");
        const detail = dashboard.querySelector("[data-runtime-detail]");
        if (label) label.textContent = runtimeLabel();
        if (detail) detail.textContent = runtimeDescription();
    }
    async function confirmTornPdaRuntime() {
        if (!(await waitForPdaBridge())) {
            state.runtime.isTornPDA = false;
            state.runtime.confirmed = true;
            updateRuntimeLayout();
            logInfo("Runtime confirmed", { runtime: "desktop", bridge: false, viewport: getViewportMetrics() });
            return;
        }
        try {
            const response = await pdaCall("isTornPDA");
            state.runtime.isTornPDA = response === true || response?.isTornPDA === true || response?.is_torn_pda === true;
        } catch (error) {
            state.runtime.isTornPDA = false;
            logWarn("TornPDA runtime confirmation failed; using desktop mode", { error: safeDiagnosticError(error) });
        } finally {
            state.runtime.confirmed = true;
            updateRuntimeLayout();
            if (!state.isMinimized && state.dashboard) applySize();
            logInfo("Runtime confirmed", {
                runtime: state.runtime.isTornPDA ? "TornPDA" : "desktop",
                bridge: isTornPdaBridgeAvailable(),
                viewport: getViewportMetrics()
            });
        }
    }
    function detectRuntimeAtStartup() {
        state.runtime.isTornPDA = false;
        state.runtime.confirmed = false;
        logInfo("Runtime detection started", { version: VERSION, page: window.location?.pathname || "unknown", viewport: getViewportMetrics() });
        window.addEventListener("flutterInAppWebViewPlatformReady", () => void confirmTornPdaRuntime(), { once: true });
        window.setTimeout(() => void confirmTornPdaRuntime(), 0);
    }

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
    const formatInteger = (value) => {
        const number = Number(value ?? 0);
        return Number.isFinite(number) ? Math.round(number).toLocaleString() : "0";
    };
    const formatDate = (value) => {
        const seconds = Number(value || 0);
        return seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown";
    };
    const formatRelative = (value) => {
        const elapsed = Math.max(0, Date.now() - Number(value || 0));
        if (elapsed < 60000) return "just now";
        if (elapsed < 3600000) return Math.floor(elapsed / 60000) + "m ago";
        if (elapsed < 86400000) return Math.floor(elapsed / 3600000) + "h ago";
        return Math.floor(elapsed / 86400000) + "d ago";
    };
    const clamp = (number, min, max) => Math.min(Math.max(number, min), Math.max(min, max));
    const getNestedNumber = (value, path) => Number(path.reduce((current, key) => current && current[key], value) || 0);

    function hasPdaStorage() {
        return typeof PDA_storage !== "undefined" && typeof PDA_storage.loadAll === "function";
    }
    async function loadPdaStorage() {
        if (!hasPdaStorage()) return null;
        if (!PDA_STORE.loaded) {
            PDA_STORE.loaded = Promise.resolve(PDA_storage.loadAll()).then((values) => {
                PDA_STORE.values = values && typeof values === "object" ? values : {};
                logDebug("TornPDA storage loaded", { keys: Object.keys(PDA_STORE.values).length });
                return PDA_STORE.values;
            }).catch((error) => {
                logWarn("TornPDA storage unavailable; using userscript storage", { error: safeDiagnosticError(error) });
                PDA_STORE.values = null;
                return null;
            });
        }
        return PDA_STORE.loaded;
    }
    async function legacyGet(key, fallback) {
        try {
            if (typeof GM !== "undefined" && typeof GM.getValue === "function") return await GM.getValue(key, fallback);
            if (typeof GM_getValue === "function") return await Promise.resolve(GM_getValue(key, fallback));
        } catch {}
        return fallback;
    }
    async function gmGet(key, fallback) {
        const values = await loadPdaStorage();
        if (values && Object.prototype.hasOwnProperty.call(values, key)) return values[key];
        const value = await legacyGet(key, fallback);
        if (values) await pdaSetMany({ [key]: value });
        return value;
    }
    function legacySet(key, value) {
        try {
            if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
                void Promise.resolve(GM.setValue(key, value)).catch(() => {});
                return;
            }
            if (typeof GM_setValue === "function") GM_setValue(key, value);
        } catch {}
    }
    async function pdaSetMany(values) {
        const stored = await loadPdaStorage();
        if (!stored || !hasPdaStorage()) {
            logDebug("Storage save using userscript fallback", { keys: Object.keys(values || {}).length });
            Object.entries(values).forEach(([key, value]) => legacySet(key, value));
            return;
        }
        try {
            await PDA_storage.setMany(values);
            Object.assign(stored, values);
            logDebug("TornPDA storage saved", { keys: Object.keys(values || {}).length });
        } catch (error) {
            if (error?.code === "QuotaExceeded") logWarn("TornPDA storage quota exceeded; using userscript storage", { keys: Object.keys(values || {}).length });
            else logWarn("TornPDA storage write failed; using userscript storage", { keys: Object.keys(values || {}).length, error: safeDiagnosticError(error) });
            Object.entries(values).forEach(([key, value]) => legacySet(key, value));
        }
    }
    function gmSet(key, value) {
        void pdaSetMany({ [key]: value });
    }
    function requestJson(url) {
        return new Promise((resolve, reject) => {
            const target = apiDiagnosticTarget(url);
            const startedAt = Date.now();
            const fail = (event, error, response = null) => {
                logError(event, { ...target, status: Number(response?.status) || null, durationMs: Date.now() - startedAt }, error);
                reject(error);
            };
            const request = {
                method: "GET", url, headers: { Accept: "application/json" },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        fail("API request failed", new Error("HTTP " + response.status), response);
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data?.error) {
                            fail("API request rejected", new Error(data.error.error || "Torn API error"), response);
                            return;
                        }
                        logInfo("API request completed", { ...target, status: Number(response.status) || 200, durationMs: Date.now() - startedAt });
                        resolve(data);
                    } catch (error) { fail("API response parse failed", new Error("Unable to parse API response"), response); }
                },
                onerror: (error) => fail("API network request failed", new Error("Network request failed"), error)
            };
            if (typeof GM_xmlhttpRequest === "function") {
                logInfo("API request started", { ...target, transport: "GM_xmlhttpRequest" });
                GM_xmlhttpRequest(request);
            }
            else if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function") {
                logInfo("API request started", { ...target, transport: "GM.xmlHttpRequest" });
                GM.xmlHttpRequest(request);
            }
            else {
                logInfo("API request started", { ...target, transport: "PDA_httpGet" });
                pdaCall("PDA_httpGet", url, request.headers).then(request.onload).catch((error) => fail("Native API request failed", error));
            }
        });
    }
    function apiUrl(path, params = {}) {
        return BASE_URL + path + "?" + new URLSearchParams({ key: state.apiKey, ...params });
    }
    function normalizeCatalog(raw) {
        if (Array.isArray(raw)) return raw;
        return Object.entries(raw || {}).map(([id, item]) => ({ ...(item || {}), id: item?.id ?? Number(id) }));
    }
    function buildSummary(catalogRaw, earnedRaw, fallback) {
        const byId = new Map();
        normalizeCatalog(catalogRaw).forEach((item) => {
            const id = Number(item?.id);
            if (!Number.isInteger(id) || id < 1 || byId.has(id)) return;
            byId.set(id, {
                id, name: String(item?.name || fallback + " #" + id),
                description: String(item?.description || ""), rarity: String(item?.rarity || "Unknown")
            });
        });
        const earnedById = new Map();
        (Array.isArray(earnedRaw) ? earnedRaw : []).forEach((item) => {
            const id = Number(item?.id);
            if (!Number.isInteger(id) || id < 1) return;
            const timestamp = Number(item?.timestamp);
            earnedById.set(id, Math.max(Number.isFinite(timestamp) ? timestamp : 0, Number(earnedById.get(id) || 0)));
        });
        const catalog = [...byId.values()].sort((a, b) => a.id - b.id);
        const earned = [...earnedById.entries()].map(([id, timestamp]) => {
            const metadata = byId.get(id) || { id, name: fallback + " #" + id, description: "", rarity: "Unknown" };
            return { ...metadata, timestamp };
        }).sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name));
        const rarity = earned.reduce((result, item) => {
            result[item.rarity] = (result[item.rarity] || 0) + 1;
            return result;
        }, {});
        return { totalEarned: earned.length, totalAvailable: catalog.length, catalog, ownedIds: [...earnedById.keys()], earned, rarity };
    }
    function getTracks(catalogRaw, type) {
        return normalizeCatalog(catalogRaw).flatMap((award) => {
            const description = String(award.description || "");
            let match = description.match(/^Win ([\d,]+) attacks$/i);
            if (type === "medal" && match) return [{ id: Number(award.id), type, path: ["attacking", "attacks", "won"], target: Number(match[1].replace(/,/g, "")), award }];
            match = description.match(/^Commit ([\d,]+) (.+?) offenses$/i);
            const crime = match && match[2].toLowerCase();
            if (type === "medal" && crime && CRIME_PATHS[crime]) return [{ id: Number(award.id), type, path: CRIME_PATHS[crime], target: Number(match[1].replace(/,/g, "")), award }];
            match = description.match(/^Use ([\d,]+) Xanax$/i);
            if (type === "honor" && match) return [{ id: Number(award.id), type, path: ["drugs", "xanax"], target: Number(match[1].replace(/,/g, "")), award }];
            match = description.match(/^Bust ([\d,]+) people from the Torn City jail$/i);
            if (type === "honor" && match) return [{ id: Number(award.id), type, path: ["jail", "busts", "success"], target: Number(match[1].replace(/,/g, "")), award }];
            match = description.match(/^Revive ([\d,]+) people$/i);
            if (type === "honor" && match) return [{ id: Number(award.id), type, path: ["hospital", "reviving", "revives"], target: Number(match[1].replace(/,/g, "")), award }];
            return [];
        });
    }
    function buildProgress(personalstats, medalsRaw, honorsRaw, userMedals, userHonors) {
        const earnedMedals = new Set((Array.isArray(userMedals) ? userMedals : []).map((item) => Number(item.id)));
        const earnedHonors = new Set((Array.isArray(userHonors) ? userHonors : []).map((item) => Number(item.id)));
        return [...getTracks(medalsRaw, "medal"), ...getTracks(honorsRaw, "honor")]
            .filter((track) => !(track.type === "medal" ? earnedMedals : earnedHonors).has(track.id))
            .map((track) => {
                const current = getNestedNumber(personalstats, track.path);
                return {
                    name: track.award.name || track.type + " #" + track.id,
                    description: track.award.description || "", rarity: track.award.rarity || "Unknown",
                    type: track.type, current, target: track.target, percent: Math.min(100, current / track.target * 100)
                };
            }).filter((track) => track.current < track.target)
            .sort((a, b) => b.percent - a.percent || a.target - b.target).slice(0, 5);
    }
    async function refreshAwards() {
        if (!state.apiKey || state.refreshInFlight || state.isMinimized) {
            logDebug("Awards refresh skipped", { hasApiKey: Boolean(state.apiKey), inFlight: state.refreshInFlight, minimized: state.isMinimized });
            return;
        }
        state.refreshInFlight = true;
        state.error = "";
        const startedAt = Date.now();
        logInfo("Awards refresh started", { cached: Boolean(state.cache), runtime: runtimeLabel() });
        render();
        try {
            const requests = [
                requestJson(apiUrl("torn/medals")),
                requestJson(apiUrl("user/medals")),
                requestJson(apiUrl("torn/honors")),
                requestJson(apiUrl("user/honors")),
                ...["attacking", "crimes", "drugs", "jail", "hospital"].map((cat) => requestJson(apiUrl("user/personalstats", { cat })))
            ];
            const [medalCatalogResponse, userMedalsResponse, honorCatalogResponse, userHonorsResponse, ...statResponses] = await Promise.all(requests);
            const medalsRaw = medalCatalogResponse?.medals || medalCatalogResponse;
            const honorsRaw = honorCatalogResponse?.honors || honorCatalogResponse;
            const userMedals = userMedalsResponse?.medals || userMedalsResponse;
            const userHonors = userHonorsResponse?.honors || userHonorsResponse;
            const personalstats = Object.assign({}, ...statResponses.map((response) => response?.personalstats || response || {}));
            state.cache = {
                medals: buildSummary(medalsRaw, userMedals, "Medal"),
                honors: buildSummary(honorsRaw, userHonors, "Honor"),
                progress: buildProgress(personalstats, medalsRaw, honorsRaw, userMedals, userHonors)
            };
            state.refreshedAt = Date.now();
            void pdaSetMany({ [STORAGE.cache]: state.cache, [STORAGE.refreshedAt]: state.refreshedAt });
        } catch (error) {
            state.error = error.message || "Unable to refresh awards";
            logError("Awards refresh failed", { durationMs: Date.now() - startedAt }, error);
        } finally {
            state.refreshInFlight = false;
            if (!state.error) logInfo("Awards refresh completed", { durationMs: Date.now() - startedAt, medals: state.cache?.medals?.totalEarned || 0, honors: state.cache?.honors?.totalEarned || 0 });
            render();
        }
    }

    function rarityChips(summary) {
        return Object.entries(summary?.rarity || {}).map(([rarity, count]) =>
            "<span class='nat-chip' style='color:" + (RARITY[rarity] || "#cbd5e1") + "'>" + escapeHtml(rarity) + ": " + formatInteger(count) + "</span>"
        ).join("");
    }
    function awardRows(items, emptyText, limit, collectionView = "completed") {
        const visible = (items || []).slice(0, limit);
        if (!visible.length) return "<div class='nat-empty'>" + escapeHtml(emptyText) + "</div>";
        return visible.map((item) =>
            "<article class='nat-award-row'><span class='nat-award-marker' style='background:" + (RARITY[item.rarity] || "#cbd5e1") + ";color:" + (RARITY[item.rarity] || "#cbd5e1") + "'></span><div class='nat-award-copy'><div class='nat-award-name' style='color:" + (RARITY[item.rarity] || "#cbd5e1") + "'>" + escapeHtml(item.name) + "</div>" +
            (item.description ? "<div class='nat-description'>" + escapeHtml(item.description) + "</div>" : "") +
            "<div class='nat-award-meta'><span class='nat-award-rarity'>" + escapeHtml(item.rarity || "Unknown") + "</span><span>ID " + formatInteger(item.id) + "</span></div></div>" +
            (collectionView === "incomplete" ? "<span class='nat-award-status'>Not earned</span>" : "<time>" + formatDate(item.timestamp) + "</time>") + "</article>"
        ).join("");
    }
    function filterAwardItems(items, query) {
        const needle = String(query || "").trim().toLocaleLowerCase();
        if (!needle) return Array.isArray(items) ? items : [];
        return (items || []).filter((item) => [item.id, item.name, item.description, item.rarity]
            .some((value) => String(value || "").toLocaleLowerCase().includes(needle)));
    }
    function searchPanel(tab, title, count, query) {
        const clear = "<button class='nat-search-clear' data-action='clear-search' data-search-tab='" + tab + "' type='button' aria-label='Clear " + title + " search'" + (query ? "" : " hidden") + ">×</button>";
        return "<div class='nat-search-panel'><label class='nat-search-label' for='nat-search-" + tab + "'>Search " + title + "</label>" +
            "<div class='nat-search-field'><span aria-hidden='true'>⌕</span><input id='nat-search-" + tab + "' data-award-search='" + tab + "' type='search' autocomplete='off' spellcheck='false' value='" + escapeHtml(query) + "' placeholder='Name, description, rarity…' aria-label='Search " + title + "'>" + clear + "</div>" +
            "<span class='nat-search-count' data-search-count='" + tab + "'>" + formatInteger(count) + " shown</span></div>";
    }
    function queueSearchStateSave() {
        clearTimeout(state.searchSaveTimer);
        state.searchSaveTimer = setTimeout(saveDashboardState, 180);
    }
    function selectedCollectionView(tab) {
        return state.collectionViews[tab] === "incomplete" ? "incomplete" : "completed";
    }
    function incompleteAwardItems(summary) {
        const ownedIds = new Set(Array.isArray(summary?.ownedIds) ? summary.ownedIds.map(Number) : (summary?.earned || []).map((item) => Number(item.id)));
        return (summary?.catalog || []).filter((item) => !ownedIds.has(Number(item.id)))
            .slice().sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    }
    function collectionItems(summary, collectionView) {
        return collectionView === "incomplete" ? incompleteAwardItems(summary) : (summary?.earned || []);
    }
    function collectionSwitcher(tab, title, summary) {
        const selected = selectedCollectionView(tab);
        const completed = (summary?.earned || []).length;
        const incomplete = incompleteAwardItems(summary).length;
        return "<div class='nat-collection-switch' role='tablist' aria-label='" + escapeHtml(title) + " collection view'>" +
            ["completed", "incomplete"].map((view) => {
                const active = selected === view;
                const count = view === "completed" ? completed : incomplete;
                const label = view === "completed" ? "Completed" : "Incomplete";
                return "<button type='button' class='nat-collection-tab " + (active ? "active" : "") + "' role='tab' aria-selected='" + active + "' data-action='collection-view' data-collection-tab='" + tab + "' data-collection-view='" + view + "'><span>" + label + "</span><b>" + formatInteger(count) + "</b></button>";
            }).join("") + "</div>";
    }
    function updateAwardSearchResults(tab, query) {
        const normalized = String(query || "");
        state.searchQueries[tab] = normalized;
        const summary = state.cache?.[tab];
        const collectionView = selectedCollectionView(tab);
        const matches = filterAwardItems(collectionItems(summary, collectionView), normalized);
        const results = state.dashboard?.querySelector("[data-search-results='" + tab + "']");
        const counter = state.dashboard?.querySelector("[data-search-count='" + tab + "']");
        const clear = state.dashboard?.querySelector("[data-action='clear-search'][data-search-tab='" + tab + "']");
        const modeLabel = collectionView === "incomplete" ? "incomplete" : "completed";
        const hasCatalog = Array.isArray(summary?.catalog);
        const emptyText = !normalized.trim() && collectionView === "incomplete" && !hasCatalog
            ? "Refresh to load the full " + tab + " catalog."
            : (normalized.trim() ? "No " + tab + " match this search." : "No " + modeLabel + " " + tab + ".");
        if (results) results.innerHTML = awardRows(matches, emptyText, Infinity, collectionView);
        if (counter) counter.textContent = formatInteger(matches.length) + " shown";
        if (clear) clear.hidden = !normalized.trim();
        queueSearchStateSave();
        fitContent();
    }
    function summaryCard(title, summary, limit) {
        const earned = Number(summary?.totalEarned || 0);
        const available = Number(summary?.totalAvailable || 0);
        const percent = available ? Math.min(100, earned / available * 100) : 0;
        const tab = state.activeTab;
        const searchable = (tab === "honors" || tab === "medals") && limit === Infinity;
        const collectionView = selectedCollectionView(tab);
        const query = searchable ? (state.searchQueries[tab] || "") : "";
        const allItems = collectionItems(summary, collectionView);
        const visible = searchable ? filterAwardItems(allItems, query) : allItems;
        const hasCatalog = Array.isArray(summary?.catalog);
        const emptyText = !query && collectionView === "incomplete" && !hasCatalog
            ? "Refresh to load the full " + title.toLowerCase() + " catalog."
            : (query ? "No " + title.toLowerCase() + " match this search." : "No " + (collectionView === "incomplete" ? "incomplete" : "completed") + " " + title.toLowerCase() + ".");
        return "<section class='nat-card nat-summary-card'><header class='nat-card-header'><div><span class='nat-eyebrow'>Collection</span><h2>" + title + "</h2></div><div class='nat-total'><strong>" +
            formatInteger(earned) + " / " + formatInteger(available) + "</strong><span>" + percent.toFixed(1) + "% complete</span></div>" +
            "</header><div class='nat-collection-track' aria-label='" + escapeHtml(title) + " collection progress'><i style='width:" + percent + "%'></i></div><div class='nat-chips'>" + rarityChips(summary) +
            "</div>" + (searchable ? collectionSwitcher(tab, title, summary) + searchPanel(tab, title, visible.length, query) : "") + "<div class='nat-section-label'>" + (query ? "Matching awards" : (collectionView === "incomplete" ? "Not yet earned" : "Completed awards")) + "</div><div data-search-results='" + (searchable ? tab : "") + "'>" + awardRows(visible, emptyText, limit, collectionView) + "</div></section>";
    }
    function progressCard(progress) {
        const rows = (progress || []).map((item) =>
            "<article class='nat-progress-row'><div class='nat-progress-header'><div><div class='nat-award-name' style='color:" +
            (RARITY[item.rarity] || "#cbd5e1") + "'>" + escapeHtml(item.name) + "</div>" +
            (item.description ? "<div class='nat-description'>" + escapeHtml(item.description) + "</div>" : "") +
            "</div><strong class='nat-progress-percent'>" + item.percent.toFixed(1) + "%</strong></div><div class='nat-progress-track'><i style='width:" +
            item.percent + "%'></i></div><div class='nat-progress-value'><span>" + formatInteger(item.current) + " / " +
            formatInteger(item.target) + "</span><span class='nat-progress-type'>" + escapeHtml(item.type) + "</span></div></article>"
        ).join("");
        return "<section class='nat-card nat-progress-card'><header class='nat-card-header'><div><span class='nat-eyebrow'>Next milestones</span><h2>Closest to Completion</h2></div><span class='nat-card-note'>Top 5</span></header>" +
            (rows || "<div class='nat-empty'>No configured award progress is available.</div>") + "</section>";
    }
    function awardsView() {
        if (!state.cache) return "<section class='nat-card nat-empty-card'><span class='nat-empty-icon'>🏅</span><h2>Your awards, at a glance</h2><p>Save a Torn API key in Settings, then refresh to load your medals, honors, and closest milestones.</p><button data-tab='settings'>Open Settings</button></section>";
        if (state.activeTab === "honors") return "<div class='nat-list'>" + summaryCard("Honors", state.cache.honors, Infinity) + "</div>";
        if (state.activeTab === "medals") return "<div class='nat-list'>" + summaryCard("Medals", state.cache.medals, Infinity) + "</div>";
        return "<div class='nat-grid nat-awards-main'>" + progressCard(state.cache.progress) + "</div>";
    }
    function settingsView() {
        return "<section class='nat-card nat-settings'><div class='nat-card-header'><div><span class='nat-eyebrow'>Tracker preferences</span><h2>Settings</h2></div><button class='nat-ghost-button' data-tab='awards'>Awards</button></div><label for='nat-api-key'>Torn API Key</label>" +
            "<div class='nat-key-row'><input id='nat-api-key' type='password' autocomplete='off' value='" + escapeHtml(state.apiKey) +
            "' placeholder='Enter Torn API key'><button data-action='save-key'>Save Key</button></div>" +
            "<div class='nat-setting-note'><span>Refresh schedule</span><strong>Daily at 00:00 UTC</strong><p>Manual refresh remains available whenever you need a new snapshot.</p></div>" +
            "<div class='nat-setting-note nat-runtime-note'><span>Runtime</span><strong data-runtime-label>" + runtimeLabel() + "</strong><p data-runtime-detail>" + runtimeDescription() + "</p></div>" +
            "<button class='nat-theme-button' data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button></section>";
    }
    function saveDashboardState() {
        gmSet(STORAGE.dashboard, {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized,
            windowSizes: state.windowSizes, searchQueries: state.searchQueries, collectionViews: state.collectionViews
        });
    }
    function sizeKey() {
        return state.activeTab === "settings" ? "settings" : "awards";
    }
    function getSizeLimits() {
        const viewport = getViewportMetrics();
        const margin = state.runtime.isTornPDA ? 12 : 20;
        const maxWidth = Math.max(1, viewport.width - margin);
        const maxHeight = Math.max(1, viewport.height - margin);
        return {
            minWidth: Math.min(state.runtime.isTornPDA ? 300 : 380, maxWidth),
            minHeight: Math.min(state.runtime.isTornPDA ? 340 : 620, maxHeight),
            maxWidth, maxHeight
        };
    }
    function defaultSize(limits) {
        const viewport = getViewportMetrics();
        if (state.runtime.isTornPDA) {
            const topOffset = viewport.orientation === "portrait" ? 60 : 12;
            return {
                width: limits.maxWidth,
                height: clamp(viewport.height - topOffset - 12, limits.minHeight, limits.maxHeight)
            };
        }
        return { width: 480, height: Math.min(720, Math.round(viewport.height * .8)) };
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const viewport = getViewportMetrics();
        const rect = dashboard.getBoundingClientRect();
        const defaultTop = viewport.top + (state.runtime.isTornPDA && viewport.orientation === "portrait" ? 60 : 20);
        const saved = position || { edge: "right", x: viewport.left + viewport.width - rect.width, y: defaultTop };
        const maxX = Math.max(viewport.left, viewport.left + viewport.width - rect.width);
        const maxY = Math.max(viewport.top, viewport.top + viewport.height - rect.height);
        const x = clamp(Number(saved.x ?? viewport.left), viewport.left, maxX);
        const y = clamp(Number(saved.y ?? viewport.top), viewport.top, maxY);
        dashboard.style.right = "auto";
        dashboard.style.bottom = "auto";
        dashboard.dataset.edge = saved.edge || "right";
        if (saved.edge === "left") { dashboard.style.left = viewport.left + "px"; dashboard.style.top = y + "px"; }
        else if (saved.edge === "top") { dashboard.style.left = x + "px"; dashboard.style.top = viewport.top + "px"; }
        else if (saved.edge === "bottom") { dashboard.style.left = x + "px"; dashboard.style.top = maxY + "px"; }
        else { dashboard.style.left = maxX + "px"; dashboard.style.top = y + "px"; }
    }
    function savePosition() {
        const rect = state.dashboard.getBoundingClientRect();
        const viewport = getViewportMetrics();
        const distances = {
            left: rect.left - viewport.left, right: viewport.left + viewport.width - rect.right,
            top: rect.top - viewport.top, bottom: viewport.top + viewport.height - rect.bottom
        };
        const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
        state.position = { edge, x: rect.left, y: rect.top };
        gmSet(STORAGE.position, state.position);
        applyPosition();
    }
    function saveSize() {
        if (state.isMinimized) return;
        const rect = state.dashboard.getBoundingClientRect();
        state.windowSizes[sizeKey()] = { width: rect.width, height: rect.height };
        saveDashboardState();
    }
    function applySize() {
        if (state.isMinimized) return;
        const dashboard = state.dashboard;
        const limits = getSizeLimits();
        const fallback = defaultSize(limits);
        const saved = state.windowSizes[sizeKey()] || fallback;
        dashboard.style.width = clamp(Number(saved.width || fallback.width), limits.minWidth, limits.maxWidth) + "px";
        dashboard.style.height = clamp(Number(saved.height || fallback.height), limits.minHeight, limits.maxHeight) + "px";
        applyPosition();
        fitContent();
    }
    function fitContent() {
        const body = state.dashboard?.querySelector("#nat-body");
        const content = state.dashboard?.querySelector("#nat-content");
        if (!body || !content || state.isMinimized) return;
        body.style.setProperty("--nat-scale", "1");
        if (state.runtime.isTornPDA) return;
        const scale = Math.max(.72, Math.min(1, Math.max(1, body.clientHeight - 4) / Math.max(1, content.scrollHeight)));
        body.style.setProperty("--nat-scale", String(scale));
    }
    function applyWidgetView() {
        const dashboard = state.dashboard;
        const body = dashboard.querySelector("#nat-body");
        const title = dashboard.querySelector("#nat-title");
        const button = dashboard.querySelector("#nat-minimize");
        const handles = dashboard.querySelectorAll(".nat-resize");
        if (state.isMinimized) {
            body.style.setProperty("display", "none", "important");
            dashboard.style.width = "48px";
            dashboard.style.height = "36px";
            title.textContent = "NAT";
            button.style.display = "none";
            handles.forEach((handle) => { handle.style.display = "none"; });
            applyPosition();
        } else {
            body.style.setProperty("display", "flex", "important");
            title.textContent = "🏅 Naughty Awards Tracker v" + VERSION;
            button.style.display = "grid";
            handles.forEach((handle) => { handle.style.display = "block"; });
            applySize();
        }
    }
    function render() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        dashboard.dataset.theme = state.theme;
        updateRuntimeLayout();
        const content = dashboard.querySelector("#nat-content");
        const tabs = [["awards", "Awards"], ["honors", "Honors"], ["medals", "Medals"]].map(([id, label]) =>
            "<button class='nat-tab " + (state.activeTab === id ? "active" : "") + "' data-tab='" + id + "'>" + label + "</button>"
        ).join("");
        content.innerHTML = state.activeTab === "settings" ? settingsView() :
            "<div class='nat-refresh'><div class='nat-sync-status'><span class='nat-sync-dot " + (state.refreshInFlight ? "is-refreshing" : "") + "'></span><span>Updated <strong>" + (state.refreshedAt ? formatRelative(state.refreshedAt) : "Never") +
            "</strong></span><small>Daily at 00:00 UTC</small></div><div class='nat-top-actions'><button class='nat-refresh-button' data-action='refresh' " + (state.refreshInFlight || !state.apiKey ? "disabled" : "") +
            ">↻ " + (state.refreshInFlight ? "Refreshing…" : "Refresh") + "</button><button class='nat-icon-button' data-tab='settings' title='Settings' aria-label='Settings'>⚙</button></div></div><nav class='nat-tabs' aria-label='Awards views'>" + tabs + "</nav>" +
            (state.error ? "<div class='nat-error'>" + escapeHtml(state.error) + "</div>" : "") + awardsView();
        dashboard.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => {
            state.activeTab = button.dataset.tab;
            saveDashboardState();
            applySize();
            render();
        });
        content.querySelectorAll("[data-action='collection-view']").forEach((button) => button.addEventListener("click", () => {
            const tab = button.dataset.collectionTab;
            if (!tab || !["honors", "medals"].includes(tab)) return;
            state.collectionViews[tab] = button.dataset.collectionView === "incomplete" ? "incomplete" : "completed";
            saveDashboardState();
            render();
        }));
        content.querySelector("[data-action='refresh']")?.addEventListener("click", () => void refreshAwards());
        content.querySelector("[data-action='save-key']")?.addEventListener("click", () => {
            state.apiKey = content.querySelector("#nat-api-key").value.trim();
            state.error = "";
            gmSet(STORAGE.key, state.apiKey);
            if (state.apiKey && !state.cache) void refreshAwards();
            render();
        });
        content.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-award-search]").forEach((input) => input.addEventListener("input", () => {
            updateAwardSearchResults(input.dataset.awardSearch, input.value);
        }));
        content.querySelectorAll("[data-action='clear-search']").forEach((button) => button.addEventListener("click", () => {
            const tab = button.dataset.searchTab;
            const input = content.querySelector("#nat-search-" + tab);
            if (!input) return;
            input.value = "";
            updateAwardSearchResults(tab, "");
            input.focus();
        }));
        fitContent();
    }
    function scheduleDailyRefresh() {
        clearTimeout(state.dailyTimer);
        const now = new Date();
        const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        state.dailyTimer = setTimeout(async () => {
            if (!state.isMinimized) await refreshAwards();
            scheduleDailyRefresh();
        }, Math.max(1000, next - Date.now() + 250));
    }
    function bindWindowControls() {
        const dashboard = state.dashboard;
        const drag = dashboard.querySelector("#nat-drag");
        let dragging = false, moved = false, dragPointerId = null, offsetX = 0, offsetY = 0;
        const isPrimaryPointer = (event) => event.isPrimary && (event.pointerType !== "mouse" || event.button === 0);
        drag.addEventListener("pointerdown", (event) => {
            if (!isPrimaryPointer(event) || event.target.closest("#nat-minimize")) return;
            const rect = dashboard.getBoundingClientRect();
            dragging = true;
            moved = false;
            dragPointerId = event.pointerId;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            drag.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        document.addEventListener("pointermove", (event) => {
            if (!dragging || event.pointerId !== dragPointerId) return;
            const viewport = getViewportMetrics();
            const rect = dashboard.getBoundingClientRect();
            const left = clamp(event.clientX - offsetX, viewport.left, Math.max(viewport.left, viewport.left + viewport.width - rect.width));
            const top = clamp(event.clientY - offsetY, viewport.top, Math.max(viewport.top, viewport.top + viewport.height - rect.height));
            moved = moved || Math.abs(left - rect.left) > 2 || Math.abs(top - rect.top) > 2;
            dashboard.style.left = left + "px";
            dashboard.style.top = top + "px";
        });
        const finishDragging = (event) => {
            if (!dragging || (event && event.pointerId !== dragPointerId)) return;
            if (dragging) savePosition();
            dragging = false;
            dragPointerId = null;
        };
        document.addEventListener("pointerup", finishDragging);
        document.addEventListener("pointercancel", finishDragging);
        drag.addEventListener("click", () => {
            if (!state.isMinimized || moved) return;
            state.isMinimized = false;
            saveDashboardState();
            applyWidgetView();
            render();
        });
        dashboard.querySelector("#nat-minimize").addEventListener("click", (event) => {
            event.stopPropagation();
            saveSize();
            state.isMinimized = true;
            saveDashboardState();
            applyWidgetView();
        });
        let resizing = false, resizePointerId = null, start = null;
        dashboard.querySelectorAll(".nat-resize").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
            if (state.isMinimized || !isPrimaryPointer(event)) return;
            event.preventDefault(); event.stopPropagation();
            resizing = true;
            resizePointerId = event.pointerId;
            start = { x: event.clientX, y: event.clientY, rect: dashboard.getBoundingClientRect(), corner: handle.dataset.corner };
            document.body.style.userSelect = "none";
            handle.setPointerCapture?.(event.pointerId);
        }));
        dashboard.querySelectorAll(".nat-resize").forEach((handle) => handle.addEventListener("keydown", (event) => {
            if (state.isMinimized || !/^Arrow(?:Left|Right|Up|Down)$/.test(event.key)) return;
            event.preventDefault();
            const rect = dashboard.getBoundingClientRect();
            const viewport = getViewportMetrics();
            const limits = getSizeLimits();
            const corner = handle.dataset.corner || "bottom-right";
            const fromLeft = corner.endsWith("left");
            const fromTop = corner.startsWith("top");
            const step = event.shiftKey ? 24 : 8;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            const maxWidth = Math.min(limits.maxWidth, fromLeft ? rect.right - viewport.left : viewport.left + viewport.width - rect.left);
            const maxHeight = Math.min(limits.maxHeight, fromTop ? rect.bottom - viewport.top : viewport.top + viewport.height - rect.top);
            const width = clamp(rect.width + (fromLeft ? -dx : dx), limits.minWidth, Math.max(limits.minWidth, maxWidth));
            const height = clamp(rect.height + (fromTop ? -dy : dy), limits.minHeight, Math.max(limits.minHeight, maxHeight));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = (fromLeft ? rect.right - width : rect.left) + "px";
            dashboard.style.top = (fromTop ? rect.bottom - height : rect.top) + "px";
            fitContent();
            saveSize();
            savePosition();
            const status = dashboard.querySelector("#nat-resize-status");
            if (status) status.textContent = "Window size " + Math.round(width) + " by " + Math.round(height) + " pixels.";
        }));
        document.addEventListener("pointermove", (event) => {
            if (!resizing || !start || event.pointerId !== resizePointerId) return;
            const limits = getSizeLimits();
            const viewport = getViewportMetrics();
            const fromLeft = start.corner.endsWith("left");
            const fromTop = start.corner.startsWith("top");
            const maxWidth = Math.min(limits.maxWidth, fromLeft ? start.rect.right - viewport.left : viewport.left + viewport.width - start.rect.left);
            const maxHeight = Math.min(limits.maxHeight, fromTop ? start.rect.bottom - viewport.top : viewport.top + viewport.height - start.rect.top);
            const width = clamp(start.rect.width + (fromLeft ? start.x - event.clientX : event.clientX - start.x), limits.minWidth, Math.max(limits.minWidth, maxWidth));
            const height = clamp(start.rect.height + (fromTop ? start.y - event.clientY : event.clientY - start.y), limits.minHeight, Math.max(limits.minHeight, maxHeight));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = (fromLeft ? start.rect.right - width : start.rect.left) + "px";
            dashboard.style.top = (fromTop ? start.rect.bottom - height : start.rect.top) + "px";
            fitContent();
        });
        const finishResizing = (event) => {
            if (!resizing || (event && event.pointerId !== resizePointerId)) return;
            resizing = false;
            resizePointerId = null;
            start = null;
            document.body.style.userSelect = "";
            saveSize(); savePosition(); render();
        };
        document.addEventListener("pointerup", finishResizing);
        document.addEventListener("pointercancel", finishResizing);
        let viewportFrame = 0;
        const refreshViewportLayout = () => {
            cancelAnimationFrame(viewportFrame);
            viewportFrame = requestAnimationFrame(() => {
                updateRuntimeLayout();
                if (!state.isMinimized) applySize();
            });
        };
        window.addEventListener("resize", refreshViewportLayout);
        window.addEventListener("orientationchange", refreshViewportLayout);
        window.visualViewport?.addEventListener("resize", refreshViewportLayout);
    }
    function initializeDashboard() {
        const dashboard = document.createElement("aside");
        dashboard.id = "nat-wrapper";
        dashboard.innerHTML = "<style>" +
            "#nat-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:rgba(24,24,24,.97);color:#fff;border:1px solid #3b3b3b;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.6);font-family:Arial,sans-serif}" +
            "#nat-wrapper[data-theme='light']{background:#f8fafc;color:#172033;border-color:#cbd5e1}#nat-wrapper *,#nat-wrapper *:before,#nat-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}" +
            "#nat-drag{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#2c2c2c;border-bottom:1px solid #444;cursor:move;user-select:none}#nat-wrapper[data-theme='light'] #nat-drag{background:#e2e8f0;border-color:#cbd5e1}" +
            "#nat-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#nat-minimize{width:36px;height:30px;flex:0 0 36px;place-items:center;border:1px solid #666;border-radius:5px;color:#fff;background:#444;font-size:19px;font-weight:700;cursor:pointer}" +
            "#nat-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-body::-webkit-scrollbar,.nat-list::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important}#nat-content{display:grid;gap:8px;align-items:stretch;transform:scale(var(--nat-scale,1));transform-origin:top left;width:calc(100% / var(--nat-scale,1))}" +
            ".nat-refresh{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#aab4c4;font-size:10px}.nat-tabs{display:flex;gap:5px;flex-wrap:wrap}#nat-wrapper button{border:1px solid #4b5563;border-radius:4px;background:#2a2a2a;color:#fff;padding:6px 8px;font-size:11px;cursor:pointer}#nat-wrapper button:hover{filter:brightness(1.18)}#nat-wrapper button:disabled{opacity:.55;cursor:not-allowed}#nat-wrapper[data-theme='light'] button{background:#e2e8f0;color:#172033;border-color:#94a3b8}.nat-tab.active{background:#3b5998!important;color:#fff!important;font-weight:700}" +
            ".nat-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:stretch;width:100%}.nat-card{width:100%;border:1px solid #2a2a2a;border-radius:8px;padding:10px;background:rgba(20,20,20,.7)}#nat-wrapper[data-theme='light'] .nat-card{background:#fff;border-color:#cbd5e1}.nat-card-header,.nat-progress-header{display:flex;justify-content:space-between;gap:8px;align-items:start}#nat-wrapper h2{margin:0 0 6px;font-size:13px}.nat-card-header strong,.nat-progress-header strong{color:#9dd8ff;font-size:11px;white-space:nowrap}.nat-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}.nat-chip{border:1px solid #3b3b3b;border-radius:4px;padding:2px 5px;font-size:10px}" +
            ".nat-award-row,.nat-progress-row{border-top:1px solid #2b2b2b;padding:7px 0}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#e2e8f0}.nat-award-row{display:flex;justify-content:space-between;gap:8px}.nat-award-copy{flex:1}.nat-award-row time,.nat-progress-value,.nat-description,.nat-empty,.nat-settings p{color:#9ca3af;font-size:10px;line-height:1.35}.nat-award-row time{white-space:nowrap}.nat-award-name{font-size:11px;font-weight:700}.nat-description{margin-top:2px}.nat-progress-track{height:6px;margin-top:6px;overflow:hidden;border-radius:3px;background:#222}.nat-progress-track>div{height:100%;background:#7fe18d}.nat-progress-value{margin-top:3px}.nat-list{width:100%;max-height:100%;overflow:auto;scrollbar-width:none;-ms-overflow-style:none}.nat-settings{display:grid;gap:8px}.nat-settings label{font-size:11px;font-weight:700}.nat-key-row{display:flex;gap:6px}.nat-key-row input{flex:1;min-width:0;border:1px solid #64748b;border-radius:4px;background:#111;color:#fff;padding:6px}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#fff;color:#172033}.nat-error{padding:7px;border:1px solid #a33;border-radius:5px;color:#ff9b9b;background:rgba(160,30,30,.18);font-size:11px}" +
            ".nat-resize{position:absolute;z-index:4;display:block;width:28px;min-width:28px!important;height:28px;min-height:28px!important;padding:0!important;border:0!important;background:transparent!important;color:#8eb5e5!important;touch-action:none}.nat-resize:hover:not(:disabled){filter:none!important;transform:none!important}.nat-resize:focus-visible{outline:2px solid #8eb5e5;outline-offset:-2px}.nat-resize::after{content:'';position:absolute;right:5px;bottom:5px;width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;opacity:.82;pointer-events:none}.nat-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nat-resize[data-corner='top-left']::after{top:5px;right:auto;bottom:auto;left:5px;transform:rotate(180deg)}.nat-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nat-resize[data-corner='bottom-left']::after{right:auto;left:5px;transform:scaleX(-1)}.nat-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}.nat-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}@container(max-width:430px){.nat-grid{grid-template-columns:1fr}.nat-card{padding:7px}}" +
            "</style><style>" +
            "#nat-wrapper{container-type:inline-size;background:linear-gradient(155deg,rgba(17,25,38,.99),rgba(11,16,25,.99));color:#edf4ff;border-color:#34445e;border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.55);font-family:Inter,Segoe UI,Arial,sans-serif}#nat-wrapper[data-theme='light']{background:linear-gradient(155deg,#f8fbff,#edf3fa);color:#172033;border-color:#bfd0e3;box-shadow:0 14px 32px rgba(30,48,72,.18)}" +
            "#nat-drag{min-height:48px;padding:9px 11px;background:linear-gradient(90deg,#182337,#243a5a);border-color:#435b7d}#nat-wrapper[data-theme='light'] #nat-drag{background:linear-gradient(90deg,#e8f0fa,#dce9f7);border-color:#bfd0e3}#nat-title{font-size:12px;font-weight:800;letter-spacing:.01em}#nat-minimize{width:38px;height:32px;flex-basis:38px;border-color:#6980a0;border-radius:7px;background:#263b59;transition:transform .15s ease,filter .15s ease}#nat-minimize:hover{transform:translateY(-1px)}" +
            "#nat-body{display:flex!important;padding:12px;background:linear-gradient(180deg,rgba(15,22,34,.45),rgba(10,15,24,.18));overflow:auto;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-wrapper[data-theme='light'] #nat-body{background:rgba(227,237,248,.35)}#nat-content{gap:10px;width:calc(100% / var(--nat-scale,1));align-content:start}.nat-list{padding:0;width:100%;overflow:auto;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-body::-webkit-scrollbar,.nat-list::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important}" +
            "#nat-wrapper button{border:1px solid #455f84;border-radius:7px;background:#263b59;color:#f7fbff;padding:7px 9px;font-size:11px;font-weight:700;line-height:1.15;transition:transform .15s ease,filter .15s ease,background .15s ease}#nat-wrapper button:hover:not(:disabled){filter:brightness(1.13);transform:translateY(-1px)}#nat-wrapper button:focus-visible{outline:2px solid #8eb5e5;outline-offset:2px}#nat-wrapper[data-theme='light'] button{background:#e4edf8;color:#172033;border-color:#9aafc9}.nat-refresh{align-items:flex-start;gap:10px;padding:1px 1px 0;color:#aebed3;font-size:10px}.nat-sync-status{display:flex;align-items:center;gap:6px;min-width:0;line-height:1.35}.nat-sync-status strong{color:#edf4ff;font-weight:800}.nat-sync-status small{color:#8191a9;white-space:nowrap}.nat-sync-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#86d49b;box-shadow:0 0 0 3px rgba(134,212,155,.14)}.nat-sync-dot.is-refreshing{background:#8eb5e5;animation:nat-pulse 1s ease-in-out infinite}@keyframes nat-pulse{50%{transform:scale(.6);opacity:.55}}.nat-top-actions{display:flex;flex:0 0 auto;gap:6px}.nat-refresh-button{background:#28704d!important;border-color:#3b8b62!important}.nat-icon-button{display:grid;place-items:center;width:32px;padding:6px!important;font-size:15px!important}.nat-tabs{display:flex;gap:6px;padding:4px;border:1px solid #34445e;border-radius:9px;background:rgba(7,12,20,.35);flex-wrap:nowrap}.nat-tab{flex:1 1 0;background:transparent!important;border-color:transparent!important;color:#aebed3!important;padding:7px 9px!important}.nat-tab.active{background:#365d99!important;border-color:#5279b3!important;color:#fff!important;box-shadow:0 3px 8px rgba(6,12,22,.28)}" +
            ".nat-grid{gap:10px}.nat-card{position:relative;padding:12px;border-color:#34445e;border-radius:10px;background:linear-gradient(145deg,rgba(34,50,76,.88),rgba(15,22,34,.9));box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 6px 16px rgba(0,0,0,.14)}#nat-wrapper[data-theme='light'] .nat-card{background:linear-gradient(145deg,#ffffff,#f4f8fc);border-color:#cbd8e7;box-shadow:0 5px 14px rgba(38,59,88,.08)}.nat-card-header{align-items:flex-start;margin-bottom:9px}.nat-card-header h2{margin:2px 0 0!important;color:#f7fbff;font-size:15px;font-weight:800;letter-spacing:-.01em}#nat-wrapper[data-theme='light'] .nat-card-header h2{color:#172033}.nat-eyebrow{display:block;color:#8eb5e5;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.nat-total{display:grid;justify-items:end;gap:2px;flex:0 0 auto}.nat-total strong{color:#9dd8ff!important;font-size:12px!important}.nat-total span,.nat-card-note{color:#93a5bc;font-size:9px;font-weight:700;white-space:nowrap}.nat-card-note{padding:3px 6px;border:1px solid #416081;border-radius:999px;color:#9dd8ff;background:rgba(69,103,145,.16)}.nat-collection-track,.nat-progress-track{height:7px;overflow:hidden;border:1px solid rgba(107,133,166,.28);border-radius:999px;background:rgba(6,11,18,.58)}.nat-collection-track i,.nat-progress-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#58c98a,#9de3aa);box-shadow:0 0 12px rgba(88,201,138,.34)}.nat-collection-track{margin:0 0 10px}.nat-chips{gap:5px;margin:0 0 10px}.nat-chip{padding:3px 6px;border-color:#3e5372;border-radius:999px;background:rgba(9,16,26,.36);font-size:9px;font-weight:750}.nat-section-label{margin:0 -1px 1px;color:#8a9bb1;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}" +
            ".nat-award-row{display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:9px;align-items:start;padding:9px 2px;border-color:#2c3c52;transition:background .15s ease}.nat-award-row:hover{background:rgba(87,125,172,.12)}.nat-award-marker{display:block;min-height:31px;border-radius:999px;box-shadow:0 0 10px currentColor}.nat-award-copy{min-width:0}.nat-award-name{font-size:11px;font-weight:800;line-height:1.25}.nat-description{margin-top:3px;color:#aebed3;font-size:10px;line-height:1.4}.nat-award-row time{align-self:start;margin-top:1px;padding:3px 5px;border:1px solid #3d5270;border-radius:5px;color:#9fb0c7;font-size:9px;line-height:1.2;text-align:right;white-space:nowrap}.nat-progress-card{padding-bottom:6px}.nat-progress-row{padding:10px 0;border-color:#2c3c52}.nat-progress-row:first-of-type{border-top:0;padding-top:0}.nat-progress-header{align-items:start}.nat-progress-percent{padding:3px 6px;border:1px solid #3b855e;border-radius:999px;color:#9de3aa!important;background:rgba(46,122,79,.17);font-size:10px!important}.nat-progress-track{height:8px;margin-top:8px}.nat-progress-value{display:flex;justify-content:space-between;gap:8px;margin-top:5px;color:#98a9bf;font-size:10px}.nat-progress-type{color:#8eb5e5;font-weight:800;text-transform:capitalize}" +
            ".nat-empty-card{display:grid;justify-items:start;gap:8px;min-height:180px;align-content:center;text-align:left}.nat-empty-card h2{margin:0!important;font-size:16px!important}.nat-empty-card p,.nat-empty{margin:0;color:#9baabd;font-size:11px;line-height:1.5}.nat-empty-icon{font-size:24px;filter:drop-shadow(0 4px 8px rgba(82,142,209,.25))}.nat-settings{gap:11px}.nat-settings label{color:#dbe8f8;font-size:11px;font-weight:800}.nat-key-row{gap:7px}.nat-key-row input{border-color:#4d6282;border-radius:7px;background:#111a28;color:#f7fbff;padding:8px 9px;font-size:11px}.nat-key-row button{white-space:nowrap;background:#28704d!important;border-color:#3b8b62!important}.nat-ghost-button{background:transparent!important;color:#9dd8ff!important}.nat-setting-note{padding:9px;border:1px solid #3c5271;border-radius:8px;background:rgba(7,13,22,.28)}.nat-setting-note span{display:block;color:#8eb5e5;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.nat-setting-note strong{display:block;margin-top:3px;color:#edf4ff;font-size:11px}.nat-setting-note p{margin:4px 0 0;color:#9baabd;font-size:10px;line-height:1.4}.nat-theme-button{justify-self:start}.nat-error{padding:9px 10px;border-color:#a34b55;border-radius:8px;color:#ffb1b7;background:rgba(151,45,55,.18);font-size:10px;font-weight:650}" +
            "#nat-wrapper[data-theme='light'] .nat-refresh{color:#60728a}#nat-wrapper[data-theme='light'] .nat-sync-status strong,#nat-wrapper[data-theme='light'] .nat-setting-note strong{color:#172033}#nat-wrapper[data-theme='light'] .nat-sync-status small,#nat-wrapper[data-theme='light'] .nat-total span,#nat-wrapper[data-theme='light'] .nat-description,#nat-wrapper[data-theme='light'] .nat-progress-value,#nat-wrapper[data-theme='light'] .nat-empty-card p,#nat-wrapper[data-theme='light'] .nat-setting-note p{color:#63758c}#nat-wrapper[data-theme='light'] .nat-tabs{border-color:#cbd8e7;background:#f7faff}#nat-wrapper[data-theme='light'] .nat-tab{color:#5d6e84!important}#nat-wrapper[data-theme='light'] .nat-tab.active{background:#416cab!important;border-color:#416cab!important}#nat-wrapper[data-theme='light'] .nat-collection-track,#nat-wrapper[data-theme='light'] .nat-progress-track{background:#e7eef7;border-color:#cfdae8}#nat-wrapper[data-theme='light'] .nat-chip,#nat-wrapper[data-theme='light'] .nat-setting-note{background:#f7faff;border-color:#cbd8e7}#nat-wrapper[data-theme='light'] .nat-section-label{color:#73869c}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#e0e8f1}#nat-wrapper[data-theme='light'] .nat-award-row:hover{background:#edf4fb}#nat-wrapper[data-theme='light'] .nat-award-row time{border-color:#cfdae8;color:#64758b}#nat-wrapper[data-theme='light'] .nat-settings label{color:#172033}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#fff;color:#172033;border-color:#aebed1}" +
            "@container (max-width:380px){#nat-body{padding:9px}.nat-refresh{gap:6px}.nat-sync-status small{display:none}.nat-refresh-button{padding:6px 7px!important}.nat-icon-button{width:29px;font-size:13px!important}.nat-tabs{gap:4px;padding:3px}.nat-tab{padding:6px 5px!important;font-size:10px!important}.nat-card{padding:10px}.nat-card-header h2{font-size:13px}.nat-total span{display:none}.nat-award-row{grid-template-columns:4px minmax(0,1fr);gap:7px}.nat-award-row time{grid-column:2;justify-self:start;margin:1px 0 0}.nat-progress-value{font-size:9px}.nat-key-row{flex-direction:column}.nat-key-row button,.nat-theme-button{width:100%}}" +
            "</style><style>" +
            "#nat-wrapper{isolation:isolate}#nat-drag{touch-action:none}#nat-wrapper[data-theme='light']{background:linear-gradient(155deg,#d7e0e9,#c5d0dc);color:#142238;border-color:#96aabd;box-shadow:0 14px 32px rgba(29,46,68,.24)}#nat-wrapper[data-theme='light'] #nat-drag{background:linear-gradient(90deg,#aebdce,#95a8bb);border-color:#8197ad;color:#112036}#nat-wrapper[data-theme='light'] #nat-body{background:linear-gradient(180deg,rgba(178,194,211,.62),rgba(205,216,228,.48))}#nat-wrapper[data-theme='light'] .nat-card{background:linear-gradient(145deg,#e1e8ef,#d5e0ea);border-color:#a9bacb;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 5px 13px rgba(34,53,77,.13)}#nat-wrapper[data-theme='light'] .nat-card-header h2,#nat-wrapper[data-theme='light'] .nat-sync-status strong,#nat-wrapper[data-theme='light'] .nat-setting-note strong{color:#142238}#nat-wrapper[data-theme='light'] .nat-refresh{color:#465b73}#nat-wrapper[data-theme='light'] .nat-sync-status small,#nat-wrapper[data-theme='light'] .nat-total span,#nat-wrapper[data-theme='light'] .nat-description,#nat-wrapper[data-theme='light'] .nat-progress-value,#nat-wrapper[data-theme='light'] .nat-empty-card p,#nat-wrapper[data-theme='light'] .nat-setting-note p{color:#4c6076}#nat-wrapper[data-theme='light'] button{background:#c8d5e2;color:#142238;border-color:#859bb4}#nat-wrapper[data-theme='light'] .nat-resize{color:#365f99!important}#nat-wrapper[data-theme='light'] .nat-tabs{background:rgba(173,190,207,.64);border-color:#93a8bd}#nat-wrapper[data-theme='light'] .nat-tab{color:#3c526b!important}#nat-wrapper[data-theme='light'] .nat-tab.active{background:#365f99!important;border-color:#2b568f!important;color:#fff!important}#nat-wrapper[data-theme='light'] .nat-collection-track,#nat-wrapper[data-theme='light'] .nat-progress-track{background:#bdcad8;border-color:#9eafc0}#nat-wrapper[data-theme='light'] .nat-chip,#nat-wrapper[data-theme='light'] .nat-setting-note{background:#d5dfe9;border-color:#a7b8c9}#nat-wrapper[data-theme='light'] .nat-section-label{color:#526981}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#b7c5d3}#nat-wrapper[data-theme='light'] .nat-award-row:hover{background:rgba(104,133,166,.14)}#nat-wrapper[data-theme='light'] .nat-award-row time{border-color:#a9bacb;color:#42576f}#nat-wrapper[data-theme='light'] .nat-settings label{color:#142238}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#e3e9ef;color:#142238;border-color:#91a6bc}" +
            ".nat-search-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;align-items:center;margin:0 0 11px;padding:8px;border:1px solid #3a5274;border-radius:9px;background:rgba(8,15,25,.28)}.nat-search-label{grid-column:1/-1;color:#a7c3e5;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.nat-search-field{display:flex;align-items:center;gap:6px;min-width:0;padding:0 7px;border:1px solid #4d6688;border-radius:7px;background:#101a29;transition:border-color .15s ease,box-shadow .15s ease}.nat-search-field:focus-within{border-color:#7ca8dc;box-shadow:0 0 0 3px rgba(98,150,210,.2)}.nat-search-field>span{color:#8eb5e5;font-size:15px;line-height:1}.nat-search-field input{width:100%;min-width:0;min-height:34px;border:0!important;outline:0;background:transparent!important;color:#f1f6ff!important;font:inherit;font-size:11px}.nat-search-field input::placeholder{color:#71839b}.nat-search-clear{width:26px;min-width:26px!important;min-height:26px!important;padding:0!important;border-color:transparent!important;background:transparent!important;color:#aebed3!important;font-size:18px!important;line-height:1}.nat-search-count{color:#8eb5e5;font-size:9px;font-weight:800;white-space:nowrap}.nat-summary-card [data-search-results]{min-width:0}#nat-wrapper[data-theme='light'] .nat-search-panel{background:rgba(171,188,205,.34);border-color:#a2b3c5}#nat-wrapper[data-theme='light'] .nat-search-label,#nat-wrapper[data-theme='light'] .nat-search-count{color:#385a7e}#nat-wrapper[data-theme='light'] .nat-search-field{background:#e6ecf2;border-color:#93a8bd}#nat-wrapper[data-theme='light'] .nat-search-field:focus-within{border-color:#4c78ad;box-shadow:0 0 0 3px rgba(72,112,162,.18)}#nat-wrapper[data-theme='light'] .nat-search-field input{color:#142238!important}#nat-wrapper[data-theme='light'] .nat-search-field input::placeholder{color:#667a90}#nat-wrapper[data-theme='light'] .nat-search-clear{color:#415b79!important}" +
            "#nat-wrapper[data-runtime='tornpda']{border-radius:14px;max-width:calc(100vw - 12px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));max-height:calc(100dvh - 12px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));box-shadow:0 10px 28px rgba(0,0,0,.48)}#nat-wrapper[data-runtime='tornpda'][data-edge='left']{margin-left:env(safe-area-inset-left, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='right']{margin-right:env(safe-area-inset-right, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='top']{margin-top:env(safe-area-inset-top, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='bottom']{margin-bottom:env(safe-area-inset-bottom, 0px)}#nat-wrapper[data-runtime='tornpda'] #nat-drag{min-height:52px;padding:10px 12px;touch-action:none}#nat-wrapper[data-runtime='tornpda'] #nat-minimize{width:44px;height:40px;flex-basis:44px;font-size:23px}#nat-wrapper[data-runtime='tornpda'] #nat-body{padding:10px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}#nat-wrapper[data-runtime='tornpda'] #nat-content{width:100%!important;transform:none!important}#nat-wrapper[data-runtime='tornpda'] button:not(.nat-search-clear){min-height:40px;padding:9px 11px;font-size:12px}#nat-wrapper[data-runtime='tornpda'] .nat-icon-button{width:40px;min-height:40px;font-size:17px!important}#nat-wrapper[data-runtime='tornpda'] .nat-tabs{min-height:48px;padding:4px;gap:5px}#nat-wrapper[data-runtime='tornpda'] .nat-tab{min-height:38px!important}#nat-wrapper[data-runtime='tornpda'] .nat-card{padding:12px}#nat-wrapper[data-runtime='tornpda'] .nat-list{max-height:none;overflow:visible}#nat-wrapper[data-runtime='tornpda'] .nat-resize{width:36px;min-width:36px!important;height:36px;min-height:36px!important;touch-action:none}#nat-wrapper[data-runtime='tornpda'] .nat-search-field input{min-height:40px;font-size:12px}#nat-wrapper[data-runtime='tornpda'] .nat-search-clear{width:32px;min-width:32px!important;min-height:32px!important;font-size:21px!important}" +
            "@container (max-width:430px){#nat-wrapper[data-runtime='tornpda'] #nat-body{padding:8px}#nat-wrapper[data-runtime='tornpda'] .nat-refresh{flex-wrap:wrap;gap:7px}#nat-wrapper[data-runtime='tornpda'] .nat-sync-status{flex:1 1 100%}#nat-wrapper[data-runtime='tornpda'] .nat-top-actions{display:grid;width:100%;grid-template-columns:minmax(0,1fr) 40px;gap:7px}#nat-wrapper[data-runtime='tornpda'] .nat-refresh-button{width:100%}#nat-wrapper[data-runtime='tornpda'] .nat-tabs{gap:3px;padding:3px}#nat-wrapper[data-runtime='tornpda'] .nat-tab{padding:7px 5px!important;font-size:10px!important}#nat-wrapper[data-runtime='tornpda'] .nat-card{padding:10px}#nat-wrapper[data-runtime='tornpda'] .nat-search-panel{grid-template-columns:minmax(0,1fr)}#nat-wrapper[data-runtime='tornpda'] .nat-search-count{justify-self:start}#nat-wrapper[data-runtime='tornpda'] .nat-card-header{gap:6px}#nat-wrapper[data-runtime='tornpda'] .nat-total strong{font-size:11px!important}}@media (max-height:560px){#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-drag{min-height:44px;padding:7px 10px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-minimize{width:40px;height:34px;flex-basis:40px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-body{padding:7px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] .nat-card{padding:9px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] button:not(.nat-search-clear){min-height:34px;padding:7px 9px;font-size:11px}}" +
            ".nat-collection-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:0 0 10px;padding:4px;border:1px solid #3a5274;border-radius:9px;background:rgba(8,15,25,.28)}.nat-collection-tab{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;background:transparent!important;border-color:transparent!important;color:#aebed3!important}.nat-collection-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nat-collection-tab b{display:grid;place-items:center;min-width:22px;padding:2px 5px;border-radius:999px;color:#c9d9ef;background:rgba(118,151,193,.2);font-size:9px}.nat-collection-tab.active{background:#365d99!important;border-color:#5279b3!important;color:#fff!important;box-shadow:0 3px 8px rgba(6,12,22,.28)}.nat-collection-tab.active b{color:#fff;background:rgba(255,255,255,.18)}.nat-award-meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;color:#8fa7c3;font-size:9px;font-weight:750}.nat-award-meta span{padding:2px 5px;border:1px solid #38506e;border-radius:999px;background:rgba(9,16,26,.26)}.nat-award-rarity{color:inherit}.nat-award-status{align-self:start;margin-top:1px;padding:3px 5px;border:1px solid #5c6680;border-radius:5px;color:#b8c7dc;background:rgba(94,111,140,.16);font-size:9px;font-weight:800;line-height:1.2;white-space:nowrap}#nat-wrapper[data-theme='light'] .nat-collection-switch{background:rgba(171,188,205,.34);border-color:#a2b3c5}#nat-wrapper[data-theme='light'] .nat-collection-tab{color:#3c526b!important}#nat-wrapper[data-theme='light'] .nat-collection-tab.active{background:#365f99!important;border-color:#2b568f!important;color:#fff!important}#nat-wrapper[data-theme='light'] .nat-award-meta{color:#526981}#nat-wrapper[data-theme='light'] .nat-award-meta span{border-color:#a9bacb;background:#dce5ee}#nat-wrapper[data-theme='light'] .nat-award-status{border-color:#a0afbf;color:#3f536b;background:#d7e0e9}@container (max-width:380px){.nat-collection-switch{gap:3px;padding:3px}.nat-collection-tab{padding:6px 5px!important;font-size:10px!important}.nat-award-status{grid-column:2;justify-self:start;margin:1px 0 0}}" +
            "</style><header id='nat-drag'><span id='nat-title'></span><button id='nat-minimize' aria-label='Minimize Naughty Awards Tracker'>−</button></header><main id='nat-body'><div id='nat-content'></div></main><span id='nat-resize-status' class='nat-sr-only' aria-live='polite'></span><button type='button' class='nat-resize' data-corner='top-left' title='Resize from the upper-left corner' aria-label='Resize window from the upper-left corner. Use arrow keys; hold Shift for larger changes.'></button><button type='button' class='nat-resize' data-corner='bottom-left' title='Resize from the bottom-left corner' aria-label='Resize window from the bottom-left corner. Use arrow keys; hold Shift for larger changes.'></button><button type='button' class='nat-resize' data-corner='bottom-right' title='Resize from the bottom-right corner' aria-label='Resize window from the bottom-right corner. Use arrow keys; hold Shift for larger changes.'></button>";
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        updateRuntimeLayout();
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        await loadPdaStorage();
        const [apiKey, dashboard, position, cache, refreshedAt] = await Promise.all([
            gmGet(STORAGE.key, ""), gmGet(STORAGE.dashboard, {}), gmGet(STORAGE.position, null),
            gmGet(STORAGE.cache, null), gmGet(STORAGE.refreshedAt, 0)
        ]);
        state.apiKey = String(apiKey || "").trim();
        state.activeTab = ["awards", "honors", "medals", "settings"].includes(dashboard?.activeTab) ? dashboard.activeTab : "awards";
        state.theme = dashboard?.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard?.isMinimized === true;
        state.windowSizes = dashboard?.windowSizes && typeof dashboard.windowSizes === "object" ? dashboard.windowSizes : {};
        state.searchQueries = {
            honors: String(dashboard?.searchQueries?.honors || ""),
            medals: String(dashboard?.searchQueries?.medals || "")
        };
        state.collectionViews = {
            honors: dashboard?.collectionViews?.honors === "incomplete" ? "incomplete" : "completed",
            medals: dashboard?.collectionViews?.medals === "incomplete" ? "incomplete" : "completed"
        };
        state.position = position;
        state.cache = cache;
        state.refreshedAt = Number(refreshedAt || 0);
        logInfo("Bootstrap completed", { version: VERSION, hasApiKey: Boolean(state.apiKey), cached: Boolean(state.cache), runtime: runtimeLabel() });
        initializeDashboard();
        scheduleDailyRefresh();
    }
    detectRuntimeAtStartup();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
