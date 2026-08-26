// ==UserScript==
// @name         Naughty Awards Tracker
// @namespace    https://github.com/SharpSplinter/Naughty-Awards-Tracker
// @version      1.3.14
// @description  Focused Torn medal, honor, and award-progress tracker.
// @author       SharpSplinter [315311]
// @license      MIT
// @match        https://www.torn.com/page.php?sid=awards*
// @source       https://raw.githubusercontent.com/SharpSplinter/Naughty-Awards-Tracker/main/Naughty%20Awards%20Tracker.user.js
// @updateURL    https://raw.githubusercontent.com/SharpSplinter/Naughty-Awards-Tracker/main/Naughty%20Awards%20Tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/SharpSplinter/Naughty-Awards-Tracker/main/Naughty%20Awards%20Tracker.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_deleteValue
// @grant        GM.deleteValue
// @connect      api.torn.com
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.3.14";
    const BASE_URL = "https://api.torn.com/v2/";
    const PDA_INJECTED_API_KEY = "_###PDA-APIKEY###_";
    const NATIVE_REMINDER_ID = 6324;
    const BACKUP_NAMESPACE = "naughty-awards-tracker.backup";
    const BACKUP_SCHEMA_VERSION = 1;
    const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
    const KEYBOARD_OVERLAY_MIN_HEIGHT_LOSS = 96;
    const KEYBOARD_OVERLAY_MIN_HEIGHT_RATIO = .18;
    const STORAGE = {
        key: "NAT_TORN_API_KEY",
        dashboard: "NAT_DASHBOARD_STATE",
        position: "NAT_WIDGET_POSITION",
        cache: "NAT_AWARDS_CACHE",
        refreshedAt: "NAT_AWARDS_REFRESHED_AT",
        useLegacyGMStorage: "NAT_USE_LEGACY_GM_STORAGE"
    };
    const PDA_STORE = { loaded: null, values: null, quotaExceeded: false };
    const STORAGE_DELETE = Symbol("NAT_STORAGE_DELETE");
    const STORAGE_MISSING = "__NAT_STORAGE_MISSING_V2__";
    const STORAGE_TOMBSTONE = "__NAT_STORAGE_DELETED_V2__";
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
        apiKey: "", savedApiKey: "", apiKeySource: "saved", activeTab: "awards", theme: "dark", isMinimized: false,
        windowSizes: {}, position: null, cache: null, refreshedAt: 0,
        dashboard: null, refreshInFlight: false, dailyTimer: null, dailyRefreshDueAt: 0, autoRefreshQueued: false, refreshPaused: false,
        reminderTimer: null, toastTimers: new Set(), activityBound: false, nativeTabActive: true, nativeTabVisible: true,
        backupIncludeApiKey: false, pendingBackup: null, restoreInFlight: false, backupExportInFlight: false, error: "", useLegacyGMStorage: false,
        searchQueries: { honors: "", medals: "" }, collectionViews: { honors: "completed", medals: "completed" }, searchSaveTimer: null,
        runtime: {
            isTornPDA: false,
            confirmed: false,
            keyboard: {
                focused: false,
                active: false,
                stableViewport: null,
                layoutViewport: null,
                releaseTimer: null,
                nativeOverlaySupported: false,
                nativeOverlayEnabled: false
            }
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
    function copyViewportMetrics(viewport) {
        const width = Math.max(1, Math.round(Number(viewport?.width) || 1));
        const height = Math.max(1, Math.round(Number(viewport?.height) || 1));
        return {
            width, height,
            left: Math.round(Number(viewport?.left) || 0),
            top: Math.round(Number(viewport?.top) || 0),
            orientation: viewport?.orientation === "landscape" ? "landscape" : (viewport?.orientation === "portrait" ? "portrait" : (height >= width ? "portrait" : "landscape"))
        };
    }
    function keyboardState() {
        if (!state.runtime.keyboard || typeof state.runtime.keyboard !== "object") {
            state.runtime.keyboard = { focused: false, active: false, stableViewport: null, layoutViewport: null, releaseTimer: null, nativeOverlaySupported: false, nativeOverlayEnabled: false };
        }
        return state.runtime.keyboard;
    }
    function isTextEntryTarget(target) {
        if (!target || target.nodeType !== 1 || typeof target.matches !== "function") return false;
        if (target.matches("textarea,[contenteditable='true']")) return true;
        if (!target.matches("input")) return false;
        return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(String(target.type || "text").toLowerCase());
    }
    function isKeyboardOverlayResize(viewport, stableViewport) {
        const current = copyViewportMetrics(viewport);
        const stable = copyViewportMetrics(stableViewport);
        const widthChanged = Math.abs(current.width - stable.width) > Math.max(72, stable.width * .18);
        const heightLoss = stable.height - current.height;
        return !widthChanged && heightLoss >= Math.max(KEYBOARD_OVERLAY_MIN_HEIGHT_LOSS, stable.height * KEYBOARD_OVERLAY_MIN_HEIGHT_RATIO);
    }
    function enableNativeKeyboardOverlay() {
        const keyboard = keyboardState();
        const virtualKeyboard = typeof navigator === "undefined" ? null : navigator.virtualKeyboard;
        keyboard.nativeOverlaySupported = Boolean(state.runtime.isTornPDA && virtualKeyboard && "overlaysContent" in virtualKeyboard);
        keyboard.nativeOverlayEnabled = false;
        if (!keyboard.nativeOverlaySupported) return false;
        try {
            virtualKeyboard.overlaysContent = true;
            keyboard.nativeOverlayEnabled = virtualKeyboard.overlaysContent === true;
            logDebug("Native keyboard overlay " + (keyboard.nativeOverlayEnabled ? "enabled" : "unavailable"));
        } catch (error) {
            logDebug("Native keyboard overlay unavailable", { error: safeDiagnosticError(error) });
        }
        return keyboard.nativeOverlayEnabled;
    }
    function getPanelViewportMetrics() {
        const keyboard = keyboardState();
        if (state.runtime.isTornPDA && keyboard.active && keyboard.layoutViewport) return copyViewportMetrics(keyboard.layoutViewport);
        return getViewportMetrics();
    }
    function updateKeyboardOverlayState(viewport = getViewportMetrics(), forceLayout = false) {
        const keyboard = keyboardState();
        if (!state.runtime.isTornPDA) {
            keyboard.active = false;
            keyboard.layoutViewport = null;
            keyboard.stableViewport = null;
            return false;
        }
        const current = copyViewportMetrics(viewport);
        if (forceLayout || !keyboard.stableViewport) {
            keyboard.active = false;
            keyboard.layoutViewport = null;
            keyboard.stableViewport = current;
            return false;
        }
        if (keyboard.focused && isKeyboardOverlayResize(current, keyboard.stableViewport)) {
            if (!keyboard.active) logDebug("Virtual keyboard overlay detected", { viewport: current, layoutViewport: keyboard.stableViewport });
            keyboard.active = true;
            keyboard.layoutViewport = copyViewportMetrics(keyboard.stableViewport);
            return true;
        }
        if (keyboard.active && isKeyboardOverlayResize(current, keyboard.stableViewport)) return true;
        if (keyboard.active) logDebug("Virtual keyboard overlay released", { viewport: current });
        keyboard.active = false;
        keyboard.layoutViewport = null;
        keyboard.stableViewport = current;
        return false;
    }
    function prepareKeyboardOverlay(target) {
        if (!state.runtime.isTornPDA || !isTextEntryTarget(target)) return;
        const keyboard = keyboardState();
        clearTimeout(keyboard.releaseTimer);
        if (!keyboard.focused && !keyboard.active) keyboard.stableViewport = copyViewportMetrics(getViewportMetrics());
        keyboard.focused = true;
    }
    function releaseKeyboardOverlay() {
        if (!state.runtime.isTornPDA) return;
        const keyboard = keyboardState();
        clearTimeout(keyboard.releaseTimer);
        keyboard.releaseTimer = window.setTimeout(() => {
            const activeElement = document.activeElement;
            if (state.dashboard?.contains(activeElement) && isTextEntryTarget(activeElement)) return;
            keyboard.focused = false;
            const overlayActive = updateKeyboardOverlayState(getViewportMetrics());
            updateRuntimeLayout();
            if (state.dashboard && !overlayActive) state.isMinimized ? applyPosition() : applySize();
        }, 180);
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
    function nativeErrorCategory(error) {
        if (error?.code === "QuotaExceeded") return "QuotaExceeded";
        if (error?.name === "AbortError") return "AbortError";
        return "unavailable";
    }
    function nativeBridgeCall(handler, payload) {
        if (!state.runtime.isTornPDA || !state.runtime.confirmed || !isTornPdaBridgeAvailable()) {
            return Promise.reject(new Error("TornPDA native handler is unavailable."));
        }
        return window.flutter_inappwebview.callHandler(handler, payload);
    }
    function injectedPdaApiKey() {
        const key = String(PDA_INJECTED_API_KEY || "").trim();
        return key && key !== "_###PDA-APIKEY###_" ? key : "";
    }
    function adoptInjectedPdaApiKey() {
        const key = state.runtime.isTornPDA && state.runtime.confirmed ? injectedPdaApiKey() : "";
        if (!key) return false;
        state.apiKey = key;
        state.apiKeySource = "tornpda";
        return true;
    }
    function nativeToast(text, tone = "blue") {
        if (!text || !state.runtime.isTornPDA || !state.runtime.confirmed) return;
        const colors = {
            blue: { a: 255, r: 28, g: 86, b: 136 },
            green: { a: 255, r: 25, g: 109, b: 81 },
            red: { a: 255, r: 135, g: 51, b: 61 }
        };
        void nativeBridgeCall("showToast", {
            text: String(text), clickClose: true, seconds: 4,
            bgColor: colors[tone] || colors.blue,
            textColor: { a: 255, r: 255, g: 255, b: 255 }
        }).catch((error) => logDebug("Native toast unavailable", { category: nativeErrorCategory(error) }));
    }
    function standardFeedbackLayer() {
        const dashboard = state.dashboard;
        if (!dashboard) return null;
        if (!dashboard.querySelector("#nat-standard-feedback-style")) {
            const style = document.createElement("style");
            style.id = "nat-standard-feedback-style";
            style.textContent = "#nat-wrapper .nat-tab-status{display:flex;align-items:center;flex-wrap:wrap;gap:5px 8px;min-width:0;padding:8px 9px;border:1px solid #3c587b;border-radius:8px;background:rgba(14,32,54,.62);color:#aac1dc;font-size:10px;line-height:1.35}#nat-wrapper .nat-tab-status strong{color:#9de3aa;font-size:10px}#nat-wrapper .nat-tab-status time{min-width:0;color:#9baec6;overflow-wrap:anywhere}#nat-wrapper .nat-tab-status[data-state='partial'] strong{color:#ffd276}#nat-wrapper .nat-tab-status[data-state='stale'] strong,#nat-wrapper .nat-tab-status[data-state='not-updated'] strong{color:#ff9ca8}#nat-wrapper #nat-toast-stack{position:absolute;z-index:12;right:10px;bottom:10px;display:grid;gap:7px;width:min(340px,calc(100% - 20px));pointer-events:none}#nat-wrapper .nat-toast{padding:9px 11px;border:1px solid #4a668d;border-radius:8px;background:rgba(20,41,68,.97);color:#f7fbff;font-size:11px;font-weight:700;line-height:1.35;box-shadow:0 8px 20px rgba(0,0,0,.34)}#nat-wrapper .nat-toast[data-tone='green']{border-color:#3d8b64;background:rgba(25,85,61,.97)}#nat-wrapper .nat-toast[data-tone='red']{border-color:#a34b55;background:rgba(120,42,50,.97)}#nat-wrapper[data-theme='light'] .nat-tab-status{border-color:#9eb2c9;background:#e7eff8;color:#465c76}#nat-wrapper[data-theme='light'] .nat-tab-status time{color:#506783}#nat-wrapper[data-theme='light'] .nat-toast{border-color:#8097b4;background:#e6eef7;color:#142238}";
            dashboard.append(style);
        }
        let stack = dashboard.querySelector("#nat-toast-stack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "nat-toast-stack";
            stack.setAttribute("aria-live", "polite");
            stack.setAttribute("aria-relevant", "additions");
            dashboard.append(stack);
        }
        return stack;
    }
    function showToast(text, tone = "blue") {
        const message = String(text || "").trim();
        if (!message) return;
        const stack = standardFeedbackLayer();
        if (stack) {
            const toast = document.createElement("div");
            toast.className = "nat-toast";
            toast.dataset.tone = tone;
            toast.setAttribute("role", "status");
            toast.textContent = message;
            stack.append(toast);
            const timer = window.setTimeout(() => {
                toast.remove();
                state.toastTimers.delete(timer);
            }, 4200);
            state.toastTimers.add(timer);
        }
        nativeToast(message, tone);
    }
    function nextDailyRefreshAt(now = Date.now()) {
        const date = new Date(now);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) + 250;
    }
    function scheduleDesktopReminder(timestamp) {
        clearTimeout(state.reminderTimer);
        const delay = Math.max(1000, timestamp - Date.now());
        state.reminderTimer = window.setTimeout(() => {
            try {
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                    new Notification("Naughty Awards Tracker", { body: "Your awards snapshot is ready to refresh." });
                }
            } catch {}
            showToast("Awards refresh reminder.", "blue");
        }, delay);
        return timestamp;
    }
    async function scheduleRefreshReminder() {
        const timestamp = state.dailyRefreshDueAt > Date.now() ? state.dailyRefreshDueAt : nextDailyRefreshAt();
        if (!state.runtime.isTornPDA || !state.runtime.confirmed) return { native: false, timestamp: scheduleDesktopReminder(timestamp) };
        await nativeBridgeCall("scheduleNotification", {
            title: "Naughty Awards Tracker",
            subtitle: "Your awards snapshot is ready to refresh.",
            id: NATIVE_REMINDER_ID,
            timestamp,
            overwriteID: true,
            launchNativeToast: true,
            toastMessage: "Awards refresh reminder scheduled.",
            toastColor: "green",
            toastDurationSeconds: 4,
            urlCallback: "https://www.torn.com/page.php?sid=awards"
        });
        return { native: true, timestamp };
    }
    function runtimeLabel() {
        if (!state.runtime.isTornPDA) return "Desktop browser";
        return state.runtime.confirmed ? "TornPDA" : "TornPDA · verifying";
    }
    function runtimeDescription() {
        return state.runtime.isTornPDA
            ? (keyboardState().nativeOverlayEnabled ? "Native TornPDA bridge detected. The native keyboard overlays the panel while you type." : "Native TornPDA bridge detected. The panel follows your active device viewport.")
            : "Standard desktop browser layout is active.";
    }
    function screenSizeLabel() {
        const viewport = getPanelViewportMetrics();
        return formatInteger(viewport.width) + " × " + formatInteger(viewport.height) + " px · " + viewport.orientation;
    }
    function storageMethodLabel() {
        if (state.useLegacyGMStorage) return "Legacy GM storage (primary)";
        if (PDA_STORE.quotaExceeded) return "Legacy GM storage (PDA_storage quota fallback)";
        return hasPdaStorage() && PDA_STORE.values ? "TornPDA PDA_storage (primary)" : "Legacy GM storage (fallback)";
    }
    function storageMethodDescription() {
        if (state.useLegacyGMStorage) return "Selected by preference. Legacy GM storage is primary; TornPDA storage remains a recovery fallback.";
        if (PDA_STORE.quotaExceeded) return "TornPDA storage is full, so compatible GM/local storage is keeping new changes safe.";
        if (hasPdaStorage() && PDA_STORE.values) return "Default: TornPDA PDA_storage is primary, with legacy GM storage as a fallback.";
        return "TornPDA storage is unavailable, so legacy GM storage is currently the fallback.";
    }
    function updateRuntimeLayout() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const viewport = getPanelViewportMetrics();
        const bounds = getPanelBounds();
        const profile = layoutProfile();
        dashboard.dataset.runtime = state.runtime.isTornPDA ? "tornpda" : "desktop";
        dashboard.dataset.orientation = viewport.orientation;
        dashboard.dataset.layoutProfile = profile;
        dashboard.dataset.compact = state.runtime.isTornPDA && (bounds.width < 480 || bounds.height < 520) ? "true" : "false";
        dashboard.dataset.keyboardOverlay = state.runtime.isTornPDA && keyboardState().active ? "true" : "false";
        dashboard.style.setProperty("--nat-viewport-width", viewport.width + "px");
        dashboard.style.setProperty("--nat-viewport-height", viewport.height + "px");
        dashboard.style.setProperty("--nat-panel-max-width", Math.max(1, Math.floor(bounds.width)) + "px");
        dashboard.style.setProperty("--nat-panel-max-height", Math.max(1, Math.floor(bounds.height)) + "px");
        const label = dashboard.querySelector("[data-runtime-label]");
        const detail = dashboard.querySelector("[data-runtime-detail]");
        const screen = dashboard.querySelector("[data-screen-size]");
        const layout = dashboard.querySelector("[data-layout-profile]");
        const storage = dashboard.querySelector("[data-storage-method]");
        const storageDetail = dashboard.querySelector("[data-storage-detail]");
        if (label) label.textContent = runtimeLabel();
        if (detail) detail.textContent = runtimeDescription();
        if (screen) screen.textContent = screenSizeLabel();
        if (layout) layout.textContent = profile;
        if (storage) storage.textContent = storageMethodLabel();
        if (storageDetail) storageDetail.textContent = storageMethodDescription();
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
            updateKeyboardOverlayState(getViewportMetrics(), true);
            if (state.runtime.isTornPDA) enableNativeKeyboardOverlay();
            const adoptedInjectedKey = state.runtime.isTornPDA && adoptInjectedPdaApiKey();
            updateRuntimeLayout();
            if (state.dashboard) state.isMinimized ? applyPosition() : applySize();
            if (state.runtime.isTornPDA) void refreshNativeTabState();
            if (adoptedInjectedKey && state.dashboard) render();
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
    const formatUtcTimestamp = (value) => {
        const timestamp = Number(value || 0);
        return timestamp ? new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";
    };
    function layoutProfile() {
        const viewport = getPanelViewportMetrics();
        const bounds = getPanelBounds();
        const panelWidth = Number(state.dashboard?.getBoundingClientRect?.().width || 0);
        const width = Math.max(1, Math.round(panelWidth || bounds.width || viewport.width));
        if (width <= 360 || viewport.height <= 480) return "narrow";
        if (width <= 520 || viewport.height <= 580) return "compact";
        if (width <= 920) return "standard";
        return "wide";
    }
    function awardsFreshness() {
        const refreshedAt = Number(state.refreshedAt || 0);
        if (!refreshedAt) return { state: "Not updated", source: "Torn API", timestamp: "—", relative: "Never" };
        const age = Math.max(0, Date.now() - refreshedAt);
        const stateLabel = state.error && state.cache ? "Partial" : age > 36 * 60 * 60 * 1000 ? "Stale" : "Fresh";
        return { state: stateLabel, source: "Torn API", timestamp: formatUtcTimestamp(refreshedAt), relative: formatRelative(refreshedAt) };
    }
    function awardsStatusRow() {
        const freshness = awardsFreshness();
        const dateTime = state.refreshedAt ? new Date(state.refreshedAt).toISOString() : "";
        return "<div class='nat-tab-status' data-state='" + freshness.state.toLowerCase().replace(/\s+/g, "-") + "'><strong>" + freshness.state + "</strong><span>Awards data · " + freshness.source + "</span><time datetime='" + dateTime + "'>" + freshness.timestamp + " · " + freshness.relative + "</time></div>";
    }
    const clamp = (number, min, max) => Math.min(Math.max(number, min), Math.max(min, max));
    function panelBounds(viewport, safeArea = {}, gutter = 0) {
        const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const width = Math.max(1, finite(viewport?.width, 1));
        const height = Math.max(1, finite(viewport?.height, 1));
        const left = finite(viewport?.left);
        const top = finite(viewport?.top);
        const inset = (name) => Math.max(0, finite(safeArea?.[name])) + Math.max(0, finite(gutter));
        const constrain = (start, end, span) => {
            const requested = start + end;
            const availableInset = Math.max(0, span - 1);
            const scale = requested > availableInset && requested > 0 ? availableInset / requested : 1;
            return { start: start * scale, end: end * scale };
        };
        const horizontal = constrain(inset("left"), inset("right"), width);
        const vertical = constrain(inset("top"), inset("bottom"), height);
        const bounds = {
            left: left + horizontal.start,
            top: top + vertical.start,
            right: left + width - horizontal.end,
            bottom: top + height - vertical.end
        };
        bounds.width = Math.max(1, bounds.right - bounds.left);
        bounds.height = Math.max(1, bounds.bottom - bounds.top);
        return bounds;
    }
    function getSafeAreaInsets() {
        const probe = state.dashboard?.querySelector("#nat-safe-area-probe");
        if (!probe || typeof window.getComputedStyle !== "function") return { top: 0, right: 0, bottom: 0, left: 0 };
        const style = window.getComputedStyle(probe);
        const pixels = (property) => Math.max(0, Number.parseFloat(style.getPropertyValue(property)) || 0);
        return {
            top: pixels("padding-top"), right: pixels("padding-right"),
            bottom: pixels("padding-bottom"), left: pixels("padding-left")
        };
    }
    function getPanelBounds() {
        const viewport = getPanelViewportMetrics();
        return panelBounds(viewport, state.runtime.isTornPDA ? getSafeAreaInsets() : {}, state.runtime.isTornPDA ? 6 : 10);
    }
    function clampPanelSize(size, fallback, limits) {
        const number = (value, fallbackValue) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
        };
        const maxWidth = Math.max(1, Number(limits.maxWidth) || 1);
        const maxHeight = Math.max(1, Number(limits.maxHeight) || 1);
        const minWidth = Math.min(maxWidth, Math.max(1, Number(limits.minWidth) || 1));
        const minHeight = Math.min(maxHeight, Math.max(1, Number(limits.minHeight) || 1));
        return {
            width: clamp(number(size?.width, fallback.width), minWidth, maxWidth),
            height: clamp(number(size?.height, fallback.height), minHeight, maxHeight)
        };
    }
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
            }).catch(() => {
                logWarn("TornPDA storage unavailable; using userscript storage", { category: "unavailable" });
                PDA_STORE.values = null;
                return null;
            });
        }
        return PDA_STORE.loaded;
    }
    function localGetValue(key, fallback) {
        try {
            const raw = window.localStorage?.getItem(key);
            return raw === null || raw === undefined ? fallback : JSON.parse(raw);
        } catch {}
        return fallback;
    }
    function localSetValue(key, value) {
        try {
            window.localStorage?.setItem(key, JSON.stringify(value));
            return true;
        } catch {}
        return false;
    }
    function localDeleteValue(key) {
        try {
            window.localStorage?.removeItem(key);
            return true;
        } catch {}
        return false;
    }
    async function legacyGet(key, fallback) {
        try {
            if (typeof GM !== "undefined" && typeof GM.getValue === "function") {
                const value = await GM.getValue(key, STORAGE_MISSING);
                if (value === STORAGE_TOMBSTONE) return fallback;
                if (value !== STORAGE_MISSING && value !== undefined) return value;
            }
        } catch {}
        try {
            if (typeof GM_getValue === "function") {
                const value = await Promise.resolve(GM_getValue(key, STORAGE_MISSING));
                if (value === STORAGE_TOMBSTONE) return fallback;
                if (value !== STORAGE_MISSING && value !== undefined) return value;
            }
        } catch {}
        return localGetValue(key, fallback);
    }
    async function legacyRead(key) {
        const value = await legacyGet(key, STORAGE_MISSING);
        return value === STORAGE_MISSING ? { found: false, value: undefined } : { found: true, value };
    }
    async function legacySetValue(key, value) {
        try {
            if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
                await Promise.resolve(GM.setValue(key, value));
                return true;
            }
        } catch {}
        try {
            if (typeof GM_setValue === "function") {
                await Promise.resolve(GM_setValue(key, value));
                return true;
            }
        } catch {}
        return localSetValue(key, value);
    }
    async function legacyDeleteValue(key) {
        try {
            if (typeof GM !== "undefined" && typeof GM.deleteValue === "function") {
                await Promise.resolve(GM.deleteValue(key));
                return true;
            }
        } catch {}
        try {
            if (typeof GM_deleteValue === "function") {
                await Promise.resolve(GM_deleteValue(key));
                return true;
            }
        } catch {}
        try {
            if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
                await Promise.resolve(GM.setValue(key, STORAGE_TOMBSTONE));
                return true;
            }
            if (typeof GM_setValue === "function") {
                await Promise.resolve(GM_setValue(key, STORAGE_TOMBSTONE));
                return true;
            }
        } catch {}
        return localDeleteValue(key);
    }
    async function legacySetMany(values) {
        const entries = Object.entries(values || {});
        if (!entries.length) return true;
        const saved = (await Promise.all(entries.map(([key, value]) => legacySetValue(key, value)))).every(Boolean);
        if (saved) logDebug("Userscript storage saved", { keys: entries.length });
        else logWarn("Userscript storage write failed", { keys: entries.length });
        return saved;
    }
    async function legacyDeleteMany(keys) {
        const uniqueKeys = [...new Set((keys || []).map(String).filter(Boolean))];
        if (!uniqueKeys.length) return true;
        const deleted = (await Promise.all(uniqueKeys.map(legacyDeleteValue))).every(Boolean);
        if (deleted) logDebug("Userscript storage deleted", { keys: uniqueKeys.length });
        else logWarn("Userscript storage delete failed", { keys: uniqueKeys.length });
        return deleted;
    }
    async function writePdaValues(values) {
        const entries = Object.entries(values || {});
        if (!entries.length) return true;
        const stored = await loadPdaStorage();
        if (!stored || !hasPdaStorage() || PDA_STORE.quotaExceeded) return false;
        try {
            await PDA_storage.setMany(values);
            Object.assign(stored, values);
            logDebug("TornPDA storage saved", { keys: entries.length });
            return true;
        } catch (error) {
            if (error?.code === "QuotaExceeded") {
                PDA_STORE.quotaExceeded = true;
                logWarn("TornPDA storage quota exceeded; using userscript storage", { keys: entries.length, category: "QuotaExceeded" });
            } else logWarn("TornPDA storage write failed; using userscript storage", { keys: entries.length, category: nativeErrorCategory(error) });
            return false;
        }
    }
    async function deletePdaValues(keys) {
        const uniqueKeys = [...new Set((keys || []).map(String).filter(Boolean))];
        if (!uniqueKeys.length) return true;
        const stored = await loadPdaStorage();
        if (!stored || !hasPdaStorage() || typeof PDA_storage.delete !== "function") return false;
        try {
            await Promise.all(uniqueKeys.map((key) => PDA_storage.delete(key)));
            uniqueKeys.forEach((key) => delete stored[key]);
            logDebug("TornPDA storage deleted", { keys: uniqueKeys.length });
            return true;
        } catch (error) {
            logWarn("TornPDA storage delete failed; using userscript storage", { keys: uniqueKeys.length, category: nativeErrorCategory(error) });
            return false;
        }
    }
    function createStorageAdapter(options = {}) {
        const pending = new Map();
        const migrated = new Set();
        const waiters = [];
        const debounceMs = Math.max(0, Number(options.debounceMs) || 140);
        const schedule = options.schedule || ((callback, delay) => window.setTimeout(callback, delay));
        const cancel = options.cancel || ((timer) => clearTimeout(timer));
        let timer = null;
        let flushing = null;
        let nativeBlocked = false;
        const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
        const normalize = (changes) => {
            const values = {};
            const deletes = [];
            Object.entries(changes || {}).forEach(([key, value]) => {
                if (!key) return;
                if (value === STORAGE_DELETE) deletes.push(key);
                else values[key] = value;
            });
            return { values, deletes: [...new Set(deletes)] };
        };
        const empty = (batch) => !Object.keys(batch.values).length && !batch.deletes.length;
        const call = async (operation, nativeOperation, ...args) => {
            if (typeof operation !== "function") return false;
            try { return (await operation(...args)) !== false; }
            catch (error) {
                if (nativeOperation && error?.code === "QuotaExceeded") nativeBlocked = true;
                return false;
            }
        };
        const nativeWrite = async (values) => {
            if (!Object.keys(values).length) return true;
            if (nativeBlocked || options.isNativeBlocked?.()) return false;
            const saved = await call(options.writeNative, true, values);
            if (!saved && options.isNativeBlocked?.()) nativeBlocked = true;
            return saved;
        };
        const nativeDelete = async (keys) => !keys.length || call(options.deleteNative, true, keys);
        const legacyWrite = async (values) => !Object.keys(values).length || call(options.writeLegacy, false, values);
        const legacyDelete = async (keys) => !keys.length || call(options.deleteLegacy, false, keys);
        const persistTo = async (backend, batch) => {
            const write = backend === "legacy" ? legacyWrite : nativeWrite;
            const remove = backend === "legacy" ? legacyDelete : nativeDelete;
            return (await write(batch.values)) && (await remove(batch.deletes));
        };
        const persist = async (batch, legacyPrimary = Boolean(options.isLegacyPrimary?.())) => {
            if (empty(batch)) return true;
            let saved = true;
            if (Object.keys(batch.values).length) {
                saved = legacyPrimary ? await legacyWrite(batch.values) : await nativeWrite(batch.values);
                if (!saved) saved = legacyPrimary ? await nativeWrite(batch.values) : await legacyWrite(batch.values);
            }
            if (!batch.deletes.length) return saved;
            const [nativeDeleted, legacyDeleted, nativeValues] = await Promise.all([
                nativeDelete(batch.deletes), legacyDelete(batch.deletes), Promise.resolve(options.loadNative?.()).catch(() => null)
            ]);
            return saved && (nativeValues ? nativeDeleted : legacyDeleted);
        };
        const scheduleFlush = () => {
            if (timer !== null || flushing || !pending.size) return;
            timer = schedule(() => {
                timer = null;
                void flush();
            }, debounceMs);
        };
        async function flush() {
            if (flushing) return flushing;
            if (!pending.size) return true;
            if (timer !== null) {
                cancel(timer);
                timer = null;
            }
            const changes = Object.fromEntries(pending);
            pending.clear();
            const batchWaiters = waiters.splice(0);
            flushing = Promise.resolve(persist(normalize(changes))).catch(() => false);
            const saved = await flushing;
            flushing = null;
            batchWaiters.forEach((resolve) => resolve(saved));
            scheduleFlush();
            return saved;
        }
        async function flushNow() {
            if (timer !== null) {
                cancel(timer);
                timer = null;
            }
            let saved = true;
            while (flushing || pending.size) saved = (await flush()) && saved;
            return saved;
        }
        const enqueue = (changes) => {
            const batch = normalize(changes);
            if (empty(batch)) return Promise.resolve(true);
            Object.entries(batch.values).forEach(([key, value]) => pending.set(key, value));
            batch.deletes.forEach((key) => pending.set(key, STORAGE_DELETE));
            const completion = new Promise((resolve) => waiters.push(resolve));
            scheduleFlush();
            return completion;
        };
        const read = async (key, fallback) => {
            let nativeValues = null;
            try { nativeValues = await options.loadNative?.(); } catch {}
            const nativeFound = Boolean(nativeValues && own(nativeValues, key));
            if (!options.isLegacyPrimary?.() && nativeFound) return nativeValues[key];
            const legacy = await options.readLegacy(key);
            if (options.isLegacyPrimary?.()) {
                if (legacy.found) return legacy.value;
                if (nativeFound) {
                    const migrationKey = "legacy:" + key;
                    if (!migrated.has(migrationKey)) {
                        migrated.add(migrationKey);
                        await persistTo("legacy", normalize({ [key]: nativeValues[key] }));
                    }
                    return nativeValues[key];
                }
                return fallback;
            }
            if (legacy.found) {
                const migrationKey = "native:" + key;
                if (nativeValues && !migrated.has(migrationKey)) {
                    migrated.add(migrationKey);
                    await persist(normalize({ [key]: legacy.value }), false);
                }
                return legacy.value;
            }
            return fallback;
        };
        const writeImmediately = async (changes, configuration = {}) => {
            if (!(await flushNow())) return false;
            return persist(normalize(changes), configuration.legacyPrimary);
        };
        const writeEverywhere = async (changes) => {
            if (!(await flushNow())) return { native: false, legacy: false };
            const batch = normalize(changes);
            return {
                native: await persistTo("native", batch),
                legacy: await persistTo("legacy", batch)
            };
        };
        return {
            read, enqueue, flush, flushNow, writeImmediately, writeEverywhere,
            remove: (key) => enqueue({ [key]: STORAGE_DELETE }),
            get pendingCount() { return pending.size; },
            get migrationCount() { return migrated.size; },
            get nativeBlocked() { return nativeBlocked || Boolean(options.isNativeBlocked?.()); }
        };
    }
    const STORAGE_ADAPTER = createStorageAdapter({
        debounceMs: 160,
        loadNative: loadPdaStorage,
        readLegacy: legacyRead,
        writeNative: writePdaValues,
        deleteNative: deletePdaValues,
        writeLegacy: legacySetMany,
        deleteLegacy: legacyDeleteMany,
        isLegacyPrimary: () => state.useLegacyGMStorage,
        isNativeBlocked: () => PDA_STORE.quotaExceeded
    });
    async function loadStoragePreference() {
        const legacy = await legacyRead(STORAGE.useLegacyGMStorage);
        if (legacy.found && typeof legacy.value === "boolean") {
            state.useLegacyGMStorage = legacy.value;
            return;
        }
        const values = await loadPdaStorage();
        state.useLegacyGMStorage = values?.[STORAGE.useLegacyGMStorage] === true;
    }
    const gmGet = (key, fallback) => STORAGE_ADAPTER.read(key, fallback);
    const pdaSetMany = (values) => STORAGE_ADAPTER.enqueue(values);
    const pdaDelete = (key) => STORAGE_ADAPTER.remove(key);
    function gmSet(key, value) {
        void pdaSetMany({ [key]: value });
    }
    function gmDelete(key) {
        void pdaDelete(key);
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
                id, name: String(item?.name || fallback + " #" + formatInteger(id)),
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
            const metadata = byId.get(id) || { id, name: fallback + " #" + formatInteger(id), description: "", rarity: "Unknown" };
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
                    name: track.award.name || track.type + " #" + formatInteger(track.id),
                    description: track.award.description || "", rarity: track.award.rarity || "Unknown",
                    type: track.type, current, target: track.target, percent: Math.min(100, current / track.target * 100)
                };
            }).filter((track) => track.current < track.target)
            .sort((a, b) => b.percent - a.percent || a.target - b.target).slice(0, 5);
    }
    function isTrackerActive() {
        return document.visibilityState !== "hidden" && (!state.runtime.isTornPDA || (state.nativeTabActive && state.nativeTabVisible));
    }
    function pauseAutomaticRefresh() {
        clearTimeout(state.dailyTimer);
        state.dailyTimer = null;
        state.refreshPaused = true;
    }
    function resumeAutomaticRefresh() {
        if (!isTrackerActive()) return;
        const dueAt = Number(state.dailyRefreshDueAt || 0);
        state.refreshPaused = false;
        if (state.autoRefreshQueued || (dueAt && Date.now() >= dueAt)) {
            state.autoRefreshQueued = false;
            if (!state.isMinimized) void refreshAwards({ automatic: true }).finally(scheduleDailyRefresh);
            else scheduleDailyRefresh();
            return;
        }
        armDailyRefresh(dueAt > Date.now() ? dueAt : nextDailyRefreshAt());
    }
    function updateTrackerActivity(next = {}) {
        const wasActive = isTrackerActive();
        if (typeof next.isActiveTab === "boolean") state.nativeTabActive = next.isActiveTab;
        if (typeof next.isWebViewVisible === "boolean") state.nativeTabVisible = next.isWebViewVisible;
        const active = isTrackerActive();
        if (!active) pauseAutomaticRefresh();
        else if (!wasActive || state.refreshPaused) resumeAutomaticRefresh();
        return active;
    }
    async function refreshNativeTabState() {
        if (!state.runtime.isTornPDA || !state.runtime.confirmed) return;
        try {
            updateTrackerActivity(await nativeBridgeCall("PDA_getTabState"));
        } catch (error) {
            logDebug("Native tab-state check unavailable", { category: nativeErrorCategory(error) });
        }
    }
    function bindActivityLifecycle() {
        if (state.activityBound) return;
        state.activityBound = true;
        document.addEventListener("visibilitychange", () => updateTrackerActivity());
        window.addEventListener("tornpda:tabState", (event) => updateTrackerActivity(event.detail || {}));
        window.addEventListener("pagehide", () => void STORAGE_ADAPTER.flushNow());
        void refreshNativeTabState();
    }
    async function refreshAwards(options = {}) {
        const automatic = options.automatic === true;
        if (automatic && !isTrackerActive()) {
            state.autoRefreshQueued = true;
            pauseAutomaticRefresh();
            logDebug("Automatic awards refresh paused", { reason: "inactive-tab" });
            return false;
        }
        if (!state.apiKey || state.refreshInFlight || state.isMinimized) {
            logDebug("Awards refresh skipped", { hasApiKey: Boolean(state.apiKey), inFlight: state.refreshInFlight, minimized: state.isMinimized });
            return false;
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
            if (!automatic) showToast("Awards refreshed.", "green");
        } catch (error) {
            state.error = error.message || "Unable to refresh awards";
            logError("Awards refresh failed", { durationMs: Date.now() - startedAt }, error);
            showToast("Awards refresh failed. See the tracker for details.", "red");
        } finally {
            state.refreshInFlight = false;
            if (!state.error) logInfo("Awards refresh completed", { durationMs: Date.now() - startedAt, medals: state.cache?.medals?.totalEarned || 0, honors: state.cache?.honors?.totalEarned || 0 });
            render();
        }
        return !state.error;
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
        const legacyChecked = state.useLegacyGMStorage ? " checked" : "";
        const usingInjectedKey = state.apiKeySource === "tornpda";
        const backupKeyChecked = state.backupIncludeApiKey ? " checked" : "";
        const backupPending = state.pendingBackup;
        const profile = layoutProfile();
        const backupConfirmation = backupPending ? "<div class='nat-backup-confirm' role='status'><strong>Restore " + escapeHtml(backupPending.filename) + "?</strong><p>This replaces the tracker cache, layout, and preferences" + (backupPending.payload.data.includesApiKey ? ", including its saved manual API key." : ". Your current saved API key stays unchanged.") + "</p><div class='nat-settings-actions'><button data-action='confirm-backup-restore'" + (state.restoreInFlight ? " disabled" : "") + ">" + (state.restoreInFlight ? "Restoring…" : "Restore Backup Now") + "</button><button class='nat-ghost-button' data-action='cancel-backup-restore'" + (state.restoreInFlight ? " disabled" : "") + ">Cancel</button></div></div>" : "";
        return "<section class='nat-card nat-settings'><div class='nat-card-header'><div><span class='nat-eyebrow'>Tracker preferences</span><h2>Settings</h2></div><button class='nat-ghost-button' data-tab='awards'>Awards</button></div><label for='nat-api-key'>Torn API Key</label>" +
            "<div class='nat-key-row'><input id='nat-api-key' type='password' autocomplete='off' value='" + escapeHtml(usingInjectedKey ? "" : state.savedApiKey) +
            "' placeholder='" + (usingInjectedKey ? "Using TornPDA injected API key" : "Enter Torn API key") + "'><button data-action='save-key'>Save Key</button></div>" +
            (usingInjectedKey ? "<p class='nat-key-source'>A TornPDA injected API key is active and is never shown or stored by this tracker.</p>" : "") +
            "<div class='nat-setting-note'><span>Refresh schedule</span><strong>Daily at 00:00 UTC</strong><p>Automatic refresh pauses while the tab is inactive and resumes safely when it returns.</p></div>" +
            "<div class='nat-setting-note nat-runtime-note'><span>Runtime</span><strong data-runtime-label>" + runtimeLabel() + "</strong><p data-runtime-detail>" + runtimeDescription() + "</p></div>" +
            "<div class='nat-setting-note'><span>Screen Size</span><strong data-screen-size>" + screenSizeLabel() + "</strong><p>Live layout viewport; it stays stable while the native keyboard is open.</p></div>" +
            "<div class='nat-setting-note'><span>Layout Profile</span><strong data-layout-profile>" + profile + "</strong><p>Measured from the available panel, viewport, zoom, and orientation.</p></div>" +
            "<div class='nat-setting-note'><span>Storage Method</span><strong data-storage-method>" + storageMethodLabel() + "</strong><p data-storage-detail>" + storageMethodDescription() + "</p></div>" +
            "<label class='nat-storage-toggle' for='nat-use-legacy-gm-storage'><input id='nat-use-legacy-gm-storage' type='checkbox' data-action='toggle-legacy-storage'" + legacyChecked + "><span><strong>Use legacy GM storage</strong><small>Moves current tracker data before switching the primary store.</small></span></label>" +
            "<div class='nat-setting-note nat-backup-note'><span>Backup &amp; Restore</span><strong>Local tracker data</strong><p>Downloads your cache, layout, and preferences. TornPDA injected keys are never included.</p></div>" +
            "<label class='nat-storage-toggle' for='nat-backup-include-key'><input id='nat-backup-include-key' type='checkbox' data-action='toggle-backup-api-key'" + backupKeyChecked + "><span><strong>Include saved manual API key</strong><small>Unchecked by default. Include it only in a backup you can keep secure.</small></span></label>" +
            "<input id='nat-backup-file' type='file' accept='application/json,.json' hidden><div class='nat-settings-actions nat-backup-actions'><button data-action='download-backup'" + (state.backupExportInFlight ? " disabled" : "") + ">Download Backup</button><button class='nat-ghost-button' data-action='choose-backup'>Restore Backup</button></div>" + backupConfirmation +
            (state.error ? "<div class='nat-error'>" + escapeHtml(state.error) + "</div>" : "") +
            "<div class='nat-settings-actions'><button data-action='native-reminder'>Remind Me at Next Refresh</button><button class='nat-theme-button' data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button></div></section>";
    }
    function dashboardStateValue() {
        return {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized,
            windowSizes: state.windowSizes, searchQueries: state.searchQueries, collectionViews: state.collectionViews
        };
    }
    function saveDashboardState() {
        gmSet(STORAGE.dashboard, dashboardStateValue());
    }
    function currentStorageValues() {
        return {
            [STORAGE.key]: state.savedApiKey ? state.savedApiKey : STORAGE_DELETE,
            [STORAGE.dashboard]: dashboardStateValue(),
            [STORAGE.position]: state.position,
            [STORAGE.cache]: state.cache,
            [STORAGE.refreshedAt]: state.refreshedAt
        };
    }
    function isBackupRecord(value) {
        return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
    }
    function hasExactBackupKeys(value, expected) {
        if (!isBackupRecord(value)) return false;
        const actual = Object.keys(value).sort();
        const keys = [...expected].sort();
        return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
    }
    function isSafeBackupJson(value, depth = 0, budget = { count: 0 }) {
        if (++budget.count > 50000 || depth > 40) return false;
        if (value === null || typeof value === "boolean") return true;
        if (typeof value === "number") return Number.isFinite(value);
        if (typeof value === "string") return value.length <= 200000;
        if (Array.isArray(value)) return value.every((item) => isSafeBackupJson(item, depth + 1, budget));
        if (!isBackupRecord(value)) return false;
        const keys = Object.keys(value);
        if (keys.length > 10000 || keys.some((key) => ["__proto__", "prototype", "constructor"].includes(key))) return false;
        return keys.every((key) => isSafeBackupJson(value[key], depth + 1, budget));
    }
    function validateBackupDashboard(value) {
        if (!hasExactBackupKeys(value, ["activeTab", "theme", "isMinimized", "windowSizes", "searchQueries", "collectionViews"])) return false;
        if (!["awards", "honors", "medals", "settings"].includes(value.activeTab) || !["dark", "light"].includes(value.theme) || typeof value.isMinimized !== "boolean") return false;
        if (!isBackupRecord(value.windowSizes) || !isBackupRecord(value.searchQueries) || !isBackupRecord(value.collectionViews)) return false;
        if (!Object.keys(value.windowSizes).every((key) => ["awards", "settings"].includes(key) && hasExactBackupKeys(value.windowSizes[key], ["width", "height"]) &&
            [value.windowSizes[key].width, value.windowSizes[key].height].every((number) => Number.isFinite(number) && number > 0 && number <= 20000))) return false;
        if (!hasExactBackupKeys(value.searchQueries, ["honors", "medals"]) || !Object.values(value.searchQueries).every((query) => typeof query === "string" && query.length <= 500)) return false;
        return hasExactBackupKeys(value.collectionViews, ["honors", "medals"]) && Object.values(value.collectionViews).every((view) => ["completed", "incomplete"].includes(view));
    }
    function validateBackupPosition(value) {
        if (value === null || !isBackupRecord(value)) return value === null;
        const hasBasePosition = (hasExactBackupKeys(value, ["edge", "x", "y"]) || hasExactBackupKeys(value, ["edge", "x", "y", "minimized"])) &&
            ["left", "right", "top", "bottom"].includes(value.edge) &&
            [value.x, value.y].every((number) => Number.isFinite(number) && Math.abs(number) <= 1000000);
        if (!hasBasePosition) return false;
        return !Object.hasOwn(value, "minimized") || (hasExactBackupKeys(value.minimized, ["x", "y"]) &&
            [value.minimized.x, value.minimized.y].every((number) => Number.isFinite(number) && Math.abs(number) <= 1000000));
    }
    function validateBackupPayload(payload) {
        if (!hasExactBackupKeys(payload, ["namespace", "schemaVersion", "createdAt", "data"]) || payload.namespace !== BACKUP_NAMESPACE || payload.schemaVersion !== BACKUP_SCHEMA_VERSION ||
            !Number.isSafeInteger(payload.createdAt) || payload.createdAt <= 0 || !isBackupRecord(payload.data)) throw new Error("Invalid backup");
        const data = payload.data;
        const expectedKeys = ["dashboard", "position", "cache", "refreshedAt", "useLegacyGMStorage", "includesApiKey"];
        if (!hasExactBackupKeys(data, data.includesApiKey === true ? [...expectedKeys, "apiKey"] : expectedKeys)) throw new Error("Invalid backup");
        if (typeof data.includesApiKey !== "boolean" || (data.includesApiKey && (typeof data.apiKey !== "string" || data.apiKey.length > 256))) throw new Error("Invalid backup");
        if (!validateBackupDashboard(data.dashboard) || !validateBackupPosition(data.position) || !Number.isSafeInteger(data.refreshedAt) || data.refreshedAt < 0 || typeof data.useLegacyGMStorage !== "boolean") throw new Error("Invalid backup");
        if (data.cache !== null && (!hasExactBackupKeys(data.cache, ["medals", "honors", "progress"]) || !isSafeBackupJson(data.cache))) throw new Error("Invalid backup");
        return payload;
    }
    function createBackupPayload(includeApiKey = false) {
        const includesApiKey = Boolean(includeApiKey && state.savedApiKey);
        const data = {
            dashboard: dashboardStateValue(), position: state.position, cache: state.cache,
            refreshedAt: Math.max(0, Math.round(Number(state.refreshedAt) || 0)),
            useLegacyGMStorage: Boolean(state.useLegacyGMStorage), includesApiKey
        };
        if (includesApiKey) data.apiKey = state.savedApiKey;
        return {
            namespace: BACKUP_NAMESPACE, schemaVersion: BACKUP_SCHEMA_VERSION,
            createdAt: Date.now(), data
        };
    }
    function serializeBackupPayload(payload) {
        return JSON.stringify(validateBackupPayload(payload), null, 2);
    }
    function parseBackupPayload(text) {
        if (typeof text !== "string" || !text.length || text.length > BACKUP_MAX_BYTES) throw new Error("Invalid backup");
        try {
            return validateBackupPayload(JSON.parse(text));
        } catch {
            throw new Error("Invalid backup");
        }
    }
    function backupFilename() {
        const date = new Date();
        const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
        return "naughty-awards-backup-v" + BACKUP_SCHEMA_VERSION + "-" + stamp + ".json";
    }
    function utf8Base64(text) {
        if (typeof TextEncoder !== "function" || typeof btoa !== "function") return "";
        const bytes = new TextEncoder().encode(String(text));
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            const limit = Math.min(bytes.length, offset + 0x8000);
            for (let index = offset; index < limit; index += 1) binary += String.fromCharCode(bytes[index]);
        }
        return btoa(binary);
    }
    async function shareTextWithTornPDA(text, fileName) {
        if (!state.runtime.confirmed) await confirmTornPdaRuntime();
        if (!state.runtime.isTornPDA || !isTornPdaBridgeAvailable()) return { native: false, shared: false };
        const base64Data = utf8Base64(text);
        if (!base64Data) return { native: true, shared: false, message: "This runtime could not encode the backup." };
        try {
            const response = await window.flutter_inappwebview.callHandler("shareFile", { base64Data, fileName });
            if (response?.status === "success") return { native: true, shared: true };
            return { native: true, shared: false, message: String(response?.message || "TornPDA could not open its share sheet.") };
        } catch (error) {
            logError("Native backup share failed", { fileName }, error);
            return { native: true, shared: false, message: "TornPDA could not open its share sheet." };
        }
    }
    async function downloadBackupPayload(payload) {
        const serialized = serializeBackupPayload(payload);
        const share = await shareTextWithTornPDA(serialized, backupFilename());
        if (share.native && !share.shared) throw new Error(share.message || "TornPDA could not open its share sheet.");
        if (share.shared) return { transport: "share" };
        const blob = new Blob([serialized], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = backupFilename();
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return { transport: "download" };
    }
    async function readBackupFile(file) {
        if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > BACKUP_MAX_BYTES) throw new Error("Invalid backup");
        if (typeof file.text === "function") return file.text();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Invalid backup"));
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsText(file);
        });
    }
    async function prepareBackupRestore(file) {
        const payload = parseBackupPayload(await readBackupFile(file));
        state.pendingBackup = { payload, filename: String(file.name || "backup.json").replace(/[\\/]/g, "_").slice(0, 128) };
        state.error = "";
        showToast("Backup verified. Confirm to restore.", "blue");
        return payload;
    }
    async function applyBackupPayload(payload) {
        const backup = validateBackupPayload(payload);
        const restoredSavedApiKey = backup.data.includesApiKey ? backup.data.apiKey : state.savedApiKey;
        const values = {
            [STORAGE.key]: restoredSavedApiKey ? restoredSavedApiKey : STORAGE_DELETE,
            [STORAGE.dashboard]: backup.data.dashboard,
            [STORAGE.position]: backup.data.position,
            [STORAGE.cache]: backup.data.cache,
            [STORAGE.refreshedAt]: backup.data.refreshedAt
        };
        const targetLegacy = backup.data.useLegacyGMStorage;
        if (!(await STORAGE_ADAPTER.writeImmediately(values, { legacyPrimary: targetLegacy }))) throw new Error("Backup write failed");
        const preference = await STORAGE_ADAPTER.writeEverywhere({ [STORAGE.useLegacyGMStorage]: targetLegacy });
        if (!preference.legacy) throw new Error("Backup preference failed");
        state.savedApiKey = restoredSavedApiKey;
        state.apiKey = restoredSavedApiKey;
        state.apiKeySource = "saved";
        adoptInjectedPdaApiKey();
        state.activeTab = backup.data.dashboard.activeTab;
        state.theme = backup.data.dashboard.theme;
        state.isMinimized = backup.data.dashboard.isMinimized;
        state.windowSizes = backup.data.dashboard.windowSizes;
        state.searchQueries = backup.data.dashboard.searchQueries;
        state.collectionViews = backup.data.dashboard.collectionViews;
        state.position = backup.data.position;
        state.cache = backup.data.cache;
        state.refreshedAt = backup.data.refreshedAt;
        state.useLegacyGMStorage = targetLegacy;
        state.pendingBackup = null;
        state.error = "";
        if (state.dashboard) {
            applyWidgetView();
            render();
        }
        showToast("Backup restored.", "green");
        return true;
    }
    async function setUseLegacyGMStorage(enabled) {
        const useLegacy = Boolean(enabled);
        if (useLegacy === state.useLegacyGMStorage) return true;
        const values = currentStorageValues();
        const migrated = await STORAGE_ADAPTER.writeImmediately(values, { legacyPrimary: useLegacy });
        if (!migrated) {
            state.error = "Could not move all tracker data to " + (useLegacy ? "legacy GM storage" : "TornPDA PDA_storage") + "; the storage method was not changed.";
            return false;
        }
        const preference = await STORAGE_ADAPTER.writeEverywhere({ [STORAGE.useLegacyGMStorage]: useLegacy });
        if (!preference.legacy) {
            state.error = "Could not persist the storage preference; the storage method was not changed.";
            return false;
        }
        state.useLegacyGMStorage = useLegacy;
        state.error = "";
        logInfo("Storage method changed", { method: storageMethodLabel() });
        showToast(useLegacy ? "Legacy GM storage is now primary." : "Preferred TornPDA storage is now primary.", "green");
        return true;
    }
    function sizeKey() {
        return state.activeTab === "settings" ? "settings" : "awards";
    }
    function getSizeLimits() {
        const bounds = getPanelBounds();
        const maxWidth = bounds.width;
        const maxHeight = bounds.height;
        return {
            minWidth: Math.min(state.runtime.isTornPDA ? 300 : 380, maxWidth),
            minHeight: Math.min(state.runtime.isTornPDA ? 340 : 620, maxHeight),
            maxWidth, maxHeight
        };
    }
    function defaultSize(limits) {
        const viewport = getPanelViewportMetrics();
        const bounds = getPanelBounds();
        if (state.runtime.isTornPDA) {
            const topOffset = viewport.orientation === "portrait" ? 60 : 12;
            return {
                width: limits.maxWidth,
                height: clamp(bounds.height - topOffset, limits.minHeight, limits.maxHeight)
            };
        }
        return { width: 480, height: Math.min(720, Math.round(bounds.height * .8)) };
    }
    function getMinimizedPosition(position) {
        const location = position?.minimized;
        if (!isBackupRecord(location) || !Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) return null;
        return { x: Number(location.x), y: Number(location.y) };
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const viewport = getPanelViewportMetrics();
        const bounds = getPanelBounds();
        const rect = dashboard.getBoundingClientRect();
        const defaultTop = bounds.top + (state.runtime.isTornPDA && viewport.orientation === "portrait" ? 60 : 20);
        const saved = position || { edge: "right", x: bounds.right - rect.width, y: defaultTop };
        const minimizedPosition = state.isMinimized ? getMinimizedPosition(saved) : null;
        const maxX = Math.max(bounds.left, bounds.right - rect.width);
        const maxY = Math.max(bounds.top, bounds.bottom - rect.height);
        const coordinate = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const x = clamp(coordinate(minimizedPosition?.x ?? saved.x, bounds.left), bounds.left, maxX);
        const y = clamp(coordinate(minimizedPosition?.y ?? saved.y, bounds.top), bounds.top, maxY);
        dashboard.style.right = "auto";
        dashboard.style.bottom = "auto";
        dashboard.dataset.edge = minimizedPosition ? "free" : (saved.edge || "right");
        if (minimizedPosition) { dashboard.style.left = x + "px"; dashboard.style.top = y + "px"; return; }
        if (saved.edge === "left") { dashboard.style.left = bounds.left + "px"; dashboard.style.top = y + "px"; }
        else if (saved.edge === "top") { dashboard.style.left = x + "px"; dashboard.style.top = bounds.top + "px"; }
        else if (saved.edge === "bottom") { dashboard.style.left = x + "px"; dashboard.style.top = maxY + "px"; }
        else { dashboard.style.left = maxX + "px"; dashboard.style.top = y + "px"; }
    }
    function savePosition() {
        const rect = state.dashboard.getBoundingClientRect();
        if (state.isMinimized) {
            const previous = state.position && typeof state.position === "object" ? state.position : { edge: "right", x: rect.left, y: rect.top };
            state.position = {
                edge: ["left", "right", "top", "bottom"].includes(previous.edge) ? previous.edge : "right",
                x: Number.isFinite(Number(previous.x)) ? Number(previous.x) : rect.left,
                y: Number.isFinite(Number(previous.y)) ? Number(previous.y) : rect.top,
                minimized: { x: rect.left, y: rect.top }
            };
            gmSet(STORAGE.position, state.position);
            applyPosition();
            return;
        }
        const minimizedPosition = getMinimizedPosition(state.position);
        const bounds = getPanelBounds();
        const distances = {
            left: rect.left - bounds.left, right: bounds.right - rect.right,
            top: rect.top - bounds.top, bottom: bounds.bottom - rect.bottom
        };
        const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
        state.position = { edge, x: rect.left, y: rect.top };
        if (minimizedPosition) state.position.minimized = minimizedPosition;
        gmSet(STORAGE.position, state.position);
        applyPosition();
    }
    function saveSize() {
        if (state.isMinimized) return;
        const rect = state.dashboard.getBoundingClientRect();
        const limits = getSizeLimits();
        state.windowSizes[sizeKey()] = clampPanelSize(rect, defaultSize(limits), limits);
        saveDashboardState();
    }
    function applySize() {
        if (state.isMinimized) return;
        const dashboard = state.dashboard;
        const limits = getSizeLimits();
        const fallback = defaultSize(limits);
        const saved = clampPanelSize(state.windowSizes[sizeKey()], fallback, limits);
        dashboard.style.width = saved.width + "px";
        dashboard.style.height = saved.height + "px";
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
        const statusRow = awardsStatusRow();
        content.innerHTML = state.activeTab === "settings" ? statusRow + settingsView() :
            statusRow + "<div class='nat-refresh'><div class='nat-sync-status'><span class='nat-sync-dot " + (state.refreshInFlight ? "is-refreshing" : "") + "'></span><span>" + (state.refreshInFlight ? "Refreshing awards from Torn API" : state.refreshPaused ? "Refresh paused while inactive" : "Daily at 00:00 UTC") +
            "</span></div><div class='nat-top-actions'><button class='nat-refresh-button' data-action='refresh' " + (state.refreshInFlight || !state.apiKey ? "disabled" : "") +
            ">↻ " + (state.refreshInFlight ? "Refreshing awards…" : "Refresh awards") + "</button><button class='nat-icon-button' data-tab='settings' title='Settings' aria-label='Settings'>⚙</button></div></div><nav class='nat-tabs' aria-label='Awards views'>" + tabs + "</nav>" +
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
            const saved = content.querySelector("#nat-api-key").value.trim();
            if (state.apiKeySource === "tornpda" && !saved) {
                showToast("TornPDA injected API key remains active.", "blue");
                return;
            }
            state.savedApiKey = saved;
            if (!adoptInjectedPdaApiKey()) {
                state.apiKey = state.savedApiKey;
                state.apiKeySource = "saved";
            }
            state.error = "";
            if (state.savedApiKey) gmSet(STORAGE.key, state.savedApiKey);
            else gmDelete(STORAGE.key);
            if (state.apiKey && !state.cache) void refreshAwards();
            showToast(state.apiKeySource === "tornpda" ? "TornPDA injected API key is active." : (state.apiKey ? "API key saved." : "API key cleared."), "green");
            render();
        });
        content.querySelector("[data-action='toggle-legacy-storage']")?.addEventListener("change", async (event) => {
            const checkbox = event.currentTarget;
            checkbox.disabled = true;
            const changed = await setUseLegacyGMStorage(checkbox.checked);
            if (!changed) checkbox.checked = state.useLegacyGMStorage;
            render();
        });
        content.querySelector("[data-action='toggle-backup-api-key']")?.addEventListener("change", (event) => {
            state.backupIncludeApiKey = Boolean(event.currentTarget.checked);
        });
        content.querySelector("[data-action='download-backup']")?.addEventListener("click", async () => {
            if (state.backupExportInFlight) return;
            const payload = createBackupPayload(state.backupIncludeApiKey);
            state.backupExportInFlight = true;
            render();
            try {
                const result = await downloadBackupPayload(payload);
                state.error = "";
                showToast(result.transport === "share" ? "Backup opened in the TornPDA share sheet." : "Backup downloaded.", "green");
            } catch (error) {
                state.error = safeDiagnosticError(error) || "Backup could not be created.";
                showToast(state.error, "red");
                render();
            } finally {
                state.backupExportInFlight = false;
                render();
            }
        });
        content.querySelector("[data-action='choose-backup']")?.addEventListener("click", () => content.querySelector("#nat-backup-file")?.click());
        content.querySelector("#nat-backup-file")?.addEventListener("change", async (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            try {
                await prepareBackupRestore(file);
            } catch {
                state.pendingBackup = null;
                state.error = "That file is not a valid Naughty Awards Tracker backup.";
                showToast("Backup validation failed.", "red");
            }
            render();
        });
        content.querySelector("[data-action='cancel-backup-restore']")?.addEventListener("click", () => {
            if (state.restoreInFlight) return;
            state.pendingBackup = null;
            state.error = "";
            render();
        });
        content.querySelector("[data-action='confirm-backup-restore']")?.addEventListener("click", async () => {
            if (!state.pendingBackup || state.restoreInFlight) return;
            state.restoreInFlight = true;
            render();
            try {
                await applyBackupPayload(state.pendingBackup.payload);
            } catch {
                state.error = "Backup could not be restored. Your current data has not been reloaded; retry after checking the selected storage method.";
                showToast("Backup restore failed.", "red");
            } finally {
                state.restoreInFlight = false;
                if (state.dashboard) render();
            }
        });
        content.querySelector("[data-action='native-reminder']")?.addEventListener("click", async () => {
            try {
                const reminder = await scheduleRefreshReminder();
                showToast(reminder.native ? "Native refresh reminder scheduled." : "Reminder is scheduled while this desktop tab remains open.", "green");
            } catch (error) {
                logDebug("Native reminder unavailable", { category: nativeErrorCategory(error) });
                showToast("Native reminders are unavailable in this runtime.", "blue");
            }
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
    function armDailyRefresh(dueAt) {
        clearTimeout(state.dailyTimer);
        state.dailyTimer = null;
        state.dailyRefreshDueAt = Number(dueAt) || nextDailyRefreshAt();
        if (!isTrackerActive()) {
            state.refreshPaused = true;
            return;
        }
        state.refreshPaused = false;
        state.dailyTimer = window.setTimeout(async () => {
            state.dailyTimer = null;
            if (!isTrackerActive()) {
                state.autoRefreshQueued = true;
                state.refreshPaused = true;
                return;
            }
            state.autoRefreshQueued = false;
            await refreshAwards({ automatic: true });
            scheduleDailyRefresh();
        }, Math.max(1000, state.dailyRefreshDueAt - Date.now()));
    }
    function scheduleDailyRefresh() {
        armDailyRefresh(nextDailyRefreshAt());
    }
    function restoreMinimizedWidget() {
        if (!state.isMinimized) return false;
        state.isMinimized = false;
        saveDashboardState();
        applyWidgetView();
        render();
        return true;
    }
    function bindWindowControls() {
        const dashboard = state.dashboard;
        let dragging = false, moved = false, dragPointerId = null, offsetX = 0, offsetY = 0, dragStartX = 0, dragStartY = 0;
        const isPrimaryPointer = (event) => event.isPrimary && (event.pointerType !== "mouse" || event.button === 0);
        dashboard.addEventListener("pointerdown", (event) => prepareKeyboardOverlay(event.target), true);
        dashboard.addEventListener("focusin", (event) => prepareKeyboardOverlay(event.target));
        dashboard.addEventListener("focusout", (event) => {
            if (isTextEntryTarget(event.target)) releaseKeyboardOverlay();
        });
        dashboard.addEventListener("pointerdown", (event) => {
            if (!state.isMinimized && !event.target.closest("#nat-drag")) return;
            if (!isPrimaryPointer(event) || event.target.closest("#nat-minimize")) return;
            const rect = dashboard.getBoundingClientRect();
            dragging = true;
            moved = false;
            dragPointerId = event.pointerId;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            dashboard.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        document.addEventListener("pointermove", (event) => {
            if (!dragging || event.pointerId !== dragPointerId) return;
            const bounds = getPanelBounds();
            const rect = dashboard.getBoundingClientRect();
            const left = clamp(event.clientX - offsetX, bounds.left, Math.max(bounds.left, bounds.right - rect.width));
            const top = clamp(event.clientY - offsetY, bounds.top, Math.max(bounds.top, bounds.bottom - rect.height));
            moved = moved || Math.abs(event.clientX - dragStartX) > 2 || Math.abs(event.clientY - dragStartY) > 2;
            dashboard.style.left = left + "px";
            dashboard.style.top = top + "px";
        });
        const finishDragging = (event) => {
            if (!dragging || (event && event.pointerId !== dragPointerId)) return;
            const restoreAfterTap = event?.type === "pointerup" && state.isMinimized && !moved;
            if (dragging) savePosition();
            dragging = false;
            dragPointerId = null;
            if (restoreAfterTap) restoreMinimizedWidget();
        };
        document.addEventListener("pointerup", finishDragging);
        document.addEventListener("pointercancel", finishDragging);
        dashboard.addEventListener("click", () => {
            if (!state.isMinimized || moved) return;
            restoreMinimizedWidget();
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
            const bounds = getPanelBounds();
            const limits = getSizeLimits();
            const corner = handle.dataset.corner || "bottom-right";
            const fromLeft = corner.endsWith("left");
            const fromTop = corner.startsWith("top");
            const step = event.shiftKey ? 24 : 8;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            const maxWidth = Math.min(limits.maxWidth, fromLeft ? rect.right - bounds.left : bounds.right - rect.left);
            const maxHeight = Math.min(limits.maxHeight, fromTop ? rect.bottom - bounds.top : bounds.bottom - rect.top);
            const width = clamp(rect.width + (fromLeft ? -dx : dx), limits.minWidth, Math.max(limits.minWidth, maxWidth));
            const height = clamp(rect.height + (fromTop ? -dy : dy), limits.minHeight, Math.max(limits.minHeight, maxHeight));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = clamp(fromLeft ? rect.right - width : rect.left, bounds.left, Math.max(bounds.left, bounds.right - width)) + "px";
            dashboard.style.top = clamp(fromTop ? rect.bottom - height : rect.top, bounds.top, Math.max(bounds.top, bounds.bottom - height)) + "px";
            fitContent();
            saveSize();
            savePosition();
            const status = dashboard.querySelector("#nat-resize-status");
            if (status) status.textContent = "Window size " + formatInteger(width) + " by " + formatInteger(height) + " pixels.";
        }));
        document.addEventListener("pointermove", (event) => {
            if (!resizing || !start || event.pointerId !== resizePointerId) return;
            const limits = getSizeLimits();
            const bounds = getPanelBounds();
            const fromLeft = start.corner.endsWith("left");
            const fromTop = start.corner.startsWith("top");
            const maxWidth = Math.min(limits.maxWidth, fromLeft ? start.rect.right - bounds.left : bounds.right - start.rect.left);
            const maxHeight = Math.min(limits.maxHeight, fromTop ? start.rect.bottom - bounds.top : bounds.bottom - start.rect.top);
            const width = clamp(start.rect.width + (fromLeft ? start.x - event.clientX : event.clientX - start.x), limits.minWidth, Math.max(limits.minWidth, maxWidth));
            const height = clamp(start.rect.height + (fromTop ? start.y - event.clientY : event.clientY - start.y), limits.minHeight, Math.max(limits.minHeight, maxHeight));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = clamp(fromLeft ? start.rect.right - width : start.rect.left, bounds.left, Math.max(bounds.left, bounds.right - width)) + "px";
            dashboard.style.top = clamp(fromTop ? start.rect.bottom - height : start.rect.top, bounds.top, Math.max(bounds.top, bounds.bottom - height)) + "px";
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
        const refreshViewportLayout = (reason = "resize") => {
            cancelAnimationFrame(viewportFrame);
            viewportFrame = requestAnimationFrame(() => {
                const keyboardOverlay = updateKeyboardOverlayState(getViewportMetrics(), reason === "orientationchange");
                updateRuntimeLayout();
                if (keyboardOverlay) return;
                if (state.isMinimized) applyPosition();
                else applySize();
            });
        };
        window.addEventListener("resize", refreshViewportLayout);
        window.addEventListener("orientationchange", () => refreshViewportLayout("orientationchange"));
        window.visualViewport?.addEventListener("resize", refreshViewportLayout);
        window.visualViewport?.addEventListener("scroll", refreshViewportLayout);
    }
    function initializeDashboard() {
        const dashboard = document.createElement("aside");
        dashboard.id = "nat-wrapper";
        dashboard.innerHTML = "<style>" +
            "#nat-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:rgba(24,24,24,.97);color:#fff;border:1px solid #3b3b3b;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.6);font-family:Arial,sans-serif}" +
            "#nat-wrapper[data-theme='light']{background:#f8fafc;color:#172033;border-color:#cbd5e1}#nat-wrapper *,#nat-wrapper *:before,#nat-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}" +
            "#nat-drag{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#2c2c2c;border-bottom:1px solid #444;cursor:move;user-select:none}#nat-wrapper[data-theme='light'] #nat-drag{background:#e2e8f0;border-color:#cbd5e1}" +
            "#nat-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#nat-minimize{width:36px;height:30px;flex:0 0 36px;place-items:center;border:1px solid #666;border-radius:5px;color:#fff;background:#444;font-size:19px;font-weight:700;cursor:pointer}" +
            "#nat-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;padding:10px;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-body::-webkit-scrollbar,.nat-list::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important}#nat-body::-webkit-scrollbar-track,#nat-body::-webkit-scrollbar-thumb,#nat-body::-webkit-scrollbar-corner,.nat-list::-webkit-scrollbar-track,.nat-list::-webkit-scrollbar-thumb,.nat-list::-webkit-scrollbar-corner{background:transparent!important;border:0!important}#nat-content{display:grid;gap:8px;align-items:stretch;transform:scale(var(--nat-scale,1));transform-origin:top left;width:calc(100% / var(--nat-scale,1))}" +
            ".nat-refresh{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#aab4c4;font-size:10px}.nat-tabs{display:flex;gap:5px;flex-wrap:wrap}#nat-wrapper button{border:1px solid #4b5563;border-radius:4px;background:#2a2a2a;color:#fff;padding:6px 8px;font-size:11px;cursor:pointer}#nat-wrapper button:hover{filter:brightness(1.18)}#nat-wrapper button:disabled{opacity:.55;cursor:not-allowed}#nat-wrapper[data-theme='light'] button{background:#e2e8f0;color:#172033;border-color:#94a3b8}.nat-tab.active{background:#3b5998!important;color:#fff!important;font-weight:700}" +
            ".nat-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:stretch;width:100%}.nat-card{width:100%;border:1px solid #2a2a2a;border-radius:8px;padding:10px;background:rgba(20,20,20,.7)}#nat-wrapper[data-theme='light'] .nat-card{background:#fff;border-color:#cbd5e1}.nat-card-header,.nat-progress-header{display:flex;justify-content:space-between;gap:8px;align-items:start}#nat-wrapper h2{margin:0 0 6px;font-size:13px}.nat-card-header strong,.nat-progress-header strong{color:#9dd8ff;font-size:11px;white-space:nowrap}.nat-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}.nat-chip{border:1px solid #3b3b3b;border-radius:4px;padding:2px 5px;font-size:10px}" +
            ".nat-award-row,.nat-progress-row{border-top:1px solid #2b2b2b;padding:7px 0}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#e2e8f0}.nat-award-row{display:flex;justify-content:space-between;gap:8px}.nat-award-copy{flex:1}.nat-award-row time,.nat-progress-value,.nat-description,.nat-empty,.nat-settings p{color:#9ca3af;font-size:10px;line-height:1.35}.nat-award-row time{white-space:nowrap}.nat-award-name{font-size:11px;font-weight:700}.nat-description{margin-top:2px}.nat-progress-track{height:6px;margin-top:6px;overflow:hidden;border-radius:3px;background:#222}.nat-progress-track>div{height:100%;background:#7fe18d}.nat-progress-value{margin-top:3px}.nat-list{width:100%;max-height:none;overflow:visible;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}.nat-settings{display:grid;gap:8px}.nat-settings label{font-size:11px;font-weight:700}.nat-key-row{display:flex;gap:6px}.nat-key-row input{flex:1;min-width:0;border:1px solid #64748b;border-radius:4px;background:#111;color:#fff;padding:6px}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#fff;color:#172033}.nat-error{padding:7px;border:1px solid #a33;border-radius:5px;color:#ff9b9b;background:rgba(160,30,30,.18);font-size:11px}" +
            ".nat-resize{position:absolute;z-index:4;display:block;width:28px;min-width:28px!important;height:28px;min-height:28px!important;padding:0!important;border:0!important;background:transparent!important;color:#8eb5e5!important;touch-action:none}.nat-resize:hover:not(:disabled){filter:none!important;transform:none!important}.nat-resize:focus-visible{outline:2px solid #8eb5e5;outline-offset:-2px}.nat-resize::after{content:'';position:absolute;right:5px;bottom:5px;width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;opacity:.82;pointer-events:none}.nat-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nat-resize[data-corner='top-left']::after{top:5px;right:auto;bottom:auto;left:5px;transform:rotate(180deg)}.nat-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nat-resize[data-corner='bottom-left']::after{right:auto;left:5px;transform:scaleX(-1)}.nat-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}.nat-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}@container(max-width:430px){.nat-grid{grid-template-columns:1fr}.nat-card{padding:7px}}" +
            "</style><style>" +
            "#nat-wrapper{container-type:inline-size;background:linear-gradient(155deg,rgba(17,25,38,.99),rgba(11,16,25,.99));color:#edf4ff;border-color:#34445e;border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.55);font-family:Inter,Segoe UI,Arial,sans-serif}#nat-wrapper[data-theme='light']{background:linear-gradient(155deg,#f8fbff,#edf3fa);color:#172033;border-color:#bfd0e3;box-shadow:0 14px 32px rgba(30,48,72,.18)}" +
            "#nat-drag{min-height:48px;padding:9px 11px;background:linear-gradient(90deg,#182337,#243a5a);border-color:#435b7d}#nat-wrapper[data-theme='light'] #nat-drag{background:linear-gradient(90deg,#e8f0fa,#dce9f7);border-color:#bfd0e3}#nat-title{font-size:12px;font-weight:800;letter-spacing:.01em}#nat-minimize{width:38px;height:32px;flex-basis:38px;border-color:#6980a0;border-radius:7px;background:#263b59;transition:transform .15s ease,filter .15s ease}#nat-minimize:hover{transform:translateY(-1px)}" +
            "#nat-body{display:flex!important;padding:12px;background:linear-gradient(180deg,rgba(15,22,34,.45),rgba(10,15,24,.18));overflow:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-body:focus-visible{outline:2px solid #8eb5e5;outline-offset:-2px}#nat-wrapper[data-theme='light'] #nat-body{background:rgba(227,237,248,.35)}#nat-content{gap:10px;width:calc(100% / var(--nat-scale,1));align-content:start}.nat-list{padding:0;width:100%;max-height:none;overflow:visible;scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none}#nat-body::-webkit-scrollbar,.nat-list::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important}#nat-body::-webkit-scrollbar-track,#nat-body::-webkit-scrollbar-thumb,#nat-body::-webkit-scrollbar-corner,.nat-list::-webkit-scrollbar-track,.nat-list::-webkit-scrollbar-thumb,.nat-list::-webkit-scrollbar-corner{background:transparent!important;border:0!important}" +
            "#nat-wrapper button{border:1px solid #455f84;border-radius:7px;background:#263b59;color:#f7fbff;padding:7px 9px;font-size:11px;font-weight:700;line-height:1.15;transition:transform .15s ease,filter .15s ease,background .15s ease}#nat-wrapper button:hover:not(:disabled){filter:brightness(1.13);transform:translateY(-1px)}#nat-wrapper button:focus-visible{outline:2px solid #8eb5e5;outline-offset:2px}#nat-wrapper[data-theme='light'] button{background:#e4edf8;color:#172033;border-color:#9aafc9}.nat-refresh{align-items:flex-start;gap:10px;padding:1px 1px 0;color:#aebed3;font-size:10px}.nat-sync-status{display:flex;align-items:center;gap:6px;min-width:0;line-height:1.35}.nat-sync-status strong{color:#edf4ff;font-weight:800}.nat-sync-status small{color:#8191a9;white-space:nowrap}.nat-sync-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#86d49b;box-shadow:0 0 0 3px rgba(134,212,155,.14)}.nat-sync-dot.is-refreshing{background:#8eb5e5;animation:nat-pulse 1s ease-in-out infinite}@keyframes nat-pulse{50%{transform:scale(.6);opacity:.55}}.nat-top-actions{display:flex;flex:0 0 auto;gap:6px}.nat-refresh-button{background:#28704d!important;border-color:#3b8b62!important}.nat-icon-button{display:grid;place-items:center;width:32px;padding:6px!important;font-size:15px!important}.nat-tabs{display:flex;gap:6px;padding:4px;border:1px solid #34445e;border-radius:9px;background:rgba(7,12,20,.35);flex-wrap:nowrap}.nat-tab{flex:1 1 0;background:transparent!important;border-color:transparent!important;color:#aebed3!important;padding:7px 9px!important}.nat-tab.active{background:#365d99!important;border-color:#5279b3!important;color:#fff!important;box-shadow:0 3px 8px rgba(6,12,22,.28)}" +
            ".nat-grid{gap:10px}.nat-card{position:relative;padding:12px;border-color:#34445e;border-radius:10px;background:linear-gradient(145deg,rgba(34,50,76,.88),rgba(15,22,34,.9));box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 6px 16px rgba(0,0,0,.14)}#nat-wrapper[data-theme='light'] .nat-card{background:linear-gradient(145deg,#ffffff,#f4f8fc);border-color:#cbd8e7;box-shadow:0 5px 14px rgba(38,59,88,.08)}.nat-card-header{align-items:flex-start;margin-bottom:9px}.nat-card-header h2{margin:2px 0 0!important;color:#f7fbff;font-size:15px;font-weight:800;letter-spacing:-.01em}#nat-wrapper[data-theme='light'] .nat-card-header h2{color:#172033}.nat-eyebrow{display:block;color:#8eb5e5;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.nat-total{display:grid;justify-items:end;gap:2px;flex:0 0 auto}.nat-total strong{color:#9dd8ff!important;font-size:12px!important}.nat-total span,.nat-card-note{color:#93a5bc;font-size:9px;font-weight:700;white-space:nowrap}.nat-card-note{padding:3px 6px;border:1px solid #416081;border-radius:999px;color:#9dd8ff;background:rgba(69,103,145,.16)}.nat-collection-track,.nat-progress-track{height:7px;overflow:hidden;border:1px solid rgba(107,133,166,.28);border-radius:999px;background:rgba(6,11,18,.58)}.nat-collection-track i,.nat-progress-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#58c98a,#9de3aa);box-shadow:0 0 12px rgba(88,201,138,.34)}.nat-collection-track{margin:0 0 10px}.nat-chips{gap:5px;margin:0 0 10px}.nat-chip{padding:3px 6px;border-color:#3e5372;border-radius:999px;background:rgba(9,16,26,.36);font-size:9px;font-weight:750}.nat-section-label{margin:0 -1px 1px;color:#8a9bb1;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}" +
            ".nat-award-row{display:grid;grid-template-columns:4px minmax(0,1fr) auto;gap:9px;align-items:start;padding:9px 2px;border-color:#2c3c52;transition:background .15s ease}.nat-award-row:hover{background:rgba(87,125,172,.12)}.nat-award-marker{display:block;min-height:31px;border-radius:999px;box-shadow:0 0 10px currentColor}.nat-award-copy{min-width:0}.nat-award-name{font-size:11px;font-weight:800;line-height:1.25}.nat-description{margin-top:3px;color:#aebed3;font-size:10px;line-height:1.4}.nat-award-row time{align-self:start;margin-top:1px;padding:3px 5px;border:1px solid #3d5270;border-radius:5px;color:#9fb0c7;font-size:9px;line-height:1.2;text-align:right;white-space:nowrap}.nat-progress-card{padding-bottom:6px}.nat-progress-row{padding:10px 0;border-color:#2c3c52}.nat-progress-row:first-of-type{border-top:0;padding-top:0}.nat-progress-header{align-items:start}.nat-progress-percent{padding:3px 6px;border:1px solid #3b855e;border-radius:999px;color:#9de3aa!important;background:rgba(46,122,79,.17);font-size:10px!important}.nat-progress-track{height:8px;margin-top:8px}.nat-progress-value{display:flex;justify-content:space-between;gap:8px;margin-top:5px;color:#98a9bf;font-size:10px}.nat-progress-type{color:#8eb5e5;font-weight:800;text-transform:capitalize}" +
            ".nat-empty-card{display:grid;justify-items:start;gap:8px;min-height:180px;align-content:center;text-align:left}.nat-empty-card h2{margin:0!important;font-size:16px!important}.nat-empty-card p,.nat-empty{margin:0;color:#9baabd;font-size:11px;line-height:1.5}.nat-empty-icon{font-size:24px;filter:drop-shadow(0 4px 8px rgba(82,142,209,.25))}.nat-settings{gap:11px}.nat-settings label{color:#dbe8f8;font-size:11px;font-weight:800}.nat-key-row{gap:7px}.nat-key-row input{border-color:#4d6282;border-radius:7px;background:#111a28;color:#f7fbff;padding:8px 9px;font-size:11px}.nat-key-row button{white-space:nowrap;background:#28704d!important;border-color:#3b8b62!important}.nat-ghost-button{background:transparent!important;color:#9dd8ff!important}.nat-setting-note{padding:9px;border:1px solid #3c5271;border-radius:8px;background:rgba(7,13,22,.28)}.nat-setting-note span{display:block;color:#8eb5e5;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.nat-setting-note strong{display:block;margin-top:3px;color:#edf4ff;font-size:11px}.nat-setting-note p{margin:4px 0 0;color:#9baabd;font-size:10px;line-height:1.4}.nat-theme-button{justify-self:start}.nat-error{padding:9px 10px;border-color:#a34b55;border-radius:8px;color:#ffb1b7;background:rgba(151,45,55,.18);font-size:10px;font-weight:650}" +
            "#nat-wrapper[data-theme='light'] .nat-refresh{color:#60728a}#nat-wrapper[data-theme='light'] .nat-sync-status strong,#nat-wrapper[data-theme='light'] .nat-setting-note strong{color:#172033}#nat-wrapper[data-theme='light'] .nat-sync-status small,#nat-wrapper[data-theme='light'] .nat-total span,#nat-wrapper[data-theme='light'] .nat-description,#nat-wrapper[data-theme='light'] .nat-progress-value,#nat-wrapper[data-theme='light'] .nat-empty-card p,#nat-wrapper[data-theme='light'] .nat-setting-note p{color:#63758c}#nat-wrapper[data-theme='light'] .nat-tabs{border-color:#cbd8e7;background:#f7faff}#nat-wrapper[data-theme='light'] .nat-tab{color:#5d6e84!important}#nat-wrapper[data-theme='light'] .nat-tab.active{background:#416cab!important;border-color:#416cab!important}#nat-wrapper[data-theme='light'] .nat-collection-track,#nat-wrapper[data-theme='light'] .nat-progress-track{background:#e7eef7;border-color:#cfdae8}#nat-wrapper[data-theme='light'] .nat-chip,#nat-wrapper[data-theme='light'] .nat-setting-note{background:#f7faff;border-color:#cbd8e7}#nat-wrapper[data-theme='light'] .nat-section-label{color:#73869c}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#e0e8f1}#nat-wrapper[data-theme='light'] .nat-award-row:hover{background:#edf4fb}#nat-wrapper[data-theme='light'] .nat-award-row time{border-color:#cfdae8;color:#64758b}#nat-wrapper[data-theme='light'] .nat-settings label{color:#172033}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#fff;color:#172033;border-color:#aebed1}" +
            "@container (max-width:380px){#nat-body{padding:9px}.nat-refresh{gap:6px}.nat-sync-status small{display:none}.nat-refresh-button{padding:6px 7px!important}.nat-icon-button{width:29px;font-size:13px!important}.nat-tabs{gap:4px;padding:3px}.nat-tab{padding:6px 5px!important;font-size:10px!important}.nat-card{padding:10px}.nat-card-header h2{font-size:13px}.nat-total span{display:none}.nat-award-row{grid-template-columns:4px minmax(0,1fr);gap:7px}.nat-award-row time{grid-column:2;justify-self:start;margin:1px 0 0}.nat-progress-value{font-size:9px}.nat-key-row{flex-direction:column}.nat-key-row button,.nat-theme-button{width:100%}}" +
            "</style><style>" +
            "#nat-wrapper{isolation:isolate}#nat-drag{touch-action:none}#nat-wrapper[data-theme='light']{background:linear-gradient(155deg,#d7e0e9,#c5d0dc);color:#142238;border-color:#96aabd;box-shadow:0 14px 32px rgba(29,46,68,.24)}#nat-wrapper[data-theme='light'] #nat-drag{background:linear-gradient(90deg,#aebdce,#95a8bb);border-color:#8197ad;color:#112036}#nat-wrapper[data-theme='light'] #nat-body{background:linear-gradient(180deg,rgba(178,194,211,.62),rgba(205,216,228,.48))}#nat-wrapper[data-theme='light'] .nat-card{background:linear-gradient(145deg,#e1e8ef,#d5e0ea);border-color:#a9bacb;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 5px 13px rgba(34,53,77,.13)}#nat-wrapper[data-theme='light'] .nat-card-header h2,#nat-wrapper[data-theme='light'] .nat-sync-status strong,#nat-wrapper[data-theme='light'] .nat-setting-note strong{color:#142238}#nat-wrapper[data-theme='light'] .nat-refresh{color:#465b73}#nat-wrapper[data-theme='light'] .nat-sync-status small,#nat-wrapper[data-theme='light'] .nat-total span,#nat-wrapper[data-theme='light'] .nat-description,#nat-wrapper[data-theme='light'] .nat-progress-value,#nat-wrapper[data-theme='light'] .nat-empty-card p,#nat-wrapper[data-theme='light'] .nat-setting-note p{color:#4c6076}#nat-wrapper[data-theme='light'] button{background:#c8d5e2;color:#142238;border-color:#859bb4}#nat-wrapper[data-theme='light'] .nat-resize{color:#365f99!important}#nat-wrapper[data-theme='light'] .nat-tabs{background:rgba(173,190,207,.64);border-color:#93a8bd}#nat-wrapper[data-theme='light'] .nat-tab{color:#3c526b!important}#nat-wrapper[data-theme='light'] .nat-tab.active{background:#365f99!important;border-color:#2b568f!important;color:#fff!important}#nat-wrapper[data-theme='light'] .nat-collection-track,#nat-wrapper[data-theme='light'] .nat-progress-track{background:#bdcad8;border-color:#9eafc0}#nat-wrapper[data-theme='light'] .nat-chip,#nat-wrapper[data-theme='light'] .nat-setting-note{background:#d5dfe9;border-color:#a7b8c9}#nat-wrapper[data-theme='light'] .nat-section-label{color:#526981}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#b7c5d3}#nat-wrapper[data-theme='light'] .nat-award-row:hover{background:rgba(104,133,166,.14)}#nat-wrapper[data-theme='light'] .nat-award-row time{border-color:#a9bacb;color:#42576f}#nat-wrapper[data-theme='light'] .nat-settings label{color:#142238}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#e3e9ef;color:#142238;border-color:#91a6bc}" +
            ".nat-search-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;align-items:center;margin:0 0 11px;padding:8px;border:1px solid #3a5274;border-radius:9px;background:rgba(8,15,25,.28)}.nat-search-label{grid-column:1/-1;color:#a7c3e5;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.nat-search-field{display:flex;align-items:center;gap:6px;min-width:0;padding:0 7px;border:1px solid #4d6688;border-radius:7px;background:#101a29;transition:border-color .15s ease,box-shadow .15s ease}.nat-search-field:focus-within{border-color:#7ca8dc;box-shadow:0 0 0 3px rgba(98,150,210,.2)}.nat-search-field>span{color:#8eb5e5;font-size:15px;line-height:1}.nat-search-field input{width:100%;min-width:0;min-height:34px;border:0!important;outline:0;background:transparent!important;color:#f1f6ff!important;font:inherit;font-size:11px}.nat-search-field input::placeholder{color:#71839b}.nat-search-clear{width:26px;min-width:26px!important;min-height:26px!important;padding:0!important;border-color:transparent!important;background:transparent!important;color:#aebed3!important;font-size:18px!important;line-height:1}.nat-search-count{color:#8eb5e5;font-size:9px;font-weight:800;white-space:nowrap}.nat-summary-card [data-search-results]{min-width:0}#nat-wrapper[data-theme='light'] .nat-search-panel{background:rgba(171,188,205,.34);border-color:#a2b3c5}#nat-wrapper[data-theme='light'] .nat-search-label,#nat-wrapper[data-theme='light'] .nat-search-count{color:#385a7e}#nat-wrapper[data-theme='light'] .nat-search-field{background:#e6ecf2;border-color:#93a8bd}#nat-wrapper[data-theme='light'] .nat-search-field:focus-within{border-color:#4c78ad;box-shadow:0 0 0 3px rgba(72,112,162,.18)}#nat-wrapper[data-theme='light'] .nat-search-field input{color:#142238!important}#nat-wrapper[data-theme='light'] .nat-search-field input::placeholder{color:#667a90}#nat-wrapper[data-theme='light'] .nat-search-clear{color:#415b79!important}" +
            "#nat-wrapper[data-runtime='tornpda']{border-radius:14px;max-width:calc(100vw - 12px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));max-height:calc(100dvh - 12px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));box-shadow:0 10px 28px rgba(0,0,0,.48)}#nat-wrapper[data-runtime='tornpda'][data-edge='left']{margin-left:env(safe-area-inset-left, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='right']{margin-right:env(safe-area-inset-right, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='top']{margin-top:env(safe-area-inset-top, 0px)}#nat-wrapper[data-runtime='tornpda'][data-edge='bottom']{margin-bottom:env(safe-area-inset-bottom, 0px)}#nat-wrapper[data-runtime='tornpda'][data-keyboard-overlay='true']{max-block-size:var(--nat-panel-max-height)}#nat-wrapper[data-runtime='tornpda'] #nat-drag{min-height:52px;padding:10px 12px;touch-action:none}#nat-wrapper[data-runtime='tornpda'] #nat-minimize{width:44px;height:40px;flex-basis:44px;font-size:23px}#nat-wrapper[data-runtime='tornpda'] #nat-body{padding:10px;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch}#nat-wrapper[data-runtime='tornpda'] #nat-content{width:100%!important;transform:none!important}#nat-wrapper[data-runtime='tornpda'] button:not(.nat-search-clear){min-height:40px;padding:9px 11px;font-size:12px}#nat-wrapper[data-runtime='tornpda'] .nat-icon-button{width:40px;min-height:40px;font-size:17px!important}#nat-wrapper[data-runtime='tornpda'] .nat-tabs{min-height:48px;padding:4px;gap:5px}#nat-wrapper[data-runtime='tornpda'] .nat-tab{min-height:38px!important}#nat-wrapper[data-runtime='tornpda'] .nat-card{padding:12px}#nat-wrapper[data-runtime='tornpda'] .nat-list{max-height:none;overflow:visible}#nat-wrapper[data-runtime='tornpda'] .nat-resize{width:36px;min-width:36px!important;height:36px;min-height:36px!important;touch-action:none}#nat-wrapper[data-runtime='tornpda'] input,#nat-wrapper[data-runtime='tornpda'] textarea,#nat-wrapper[data-runtime='tornpda'] select{font-size:16px!important;-webkit-user-select:text;user-select:text}#nat-wrapper[data-runtime='tornpda'] .nat-search-field input{min-height:40px}#nat-wrapper[data-runtime='tornpda'] .nat-search-clear{width:32px;min-width:32px!important;min-height:32px!important;font-size:21px!important}" +
            "@container (max-width:430px){#nat-wrapper[data-runtime='tornpda'] #nat-body{padding:8px}#nat-wrapper[data-runtime='tornpda'] .nat-refresh{flex-wrap:wrap;gap:7px}#nat-wrapper[data-runtime='tornpda'] .nat-sync-status{flex:1 1 100%}#nat-wrapper[data-runtime='tornpda'] .nat-top-actions{display:grid;width:100%;grid-template-columns:minmax(0,1fr) 40px;gap:7px}#nat-wrapper[data-runtime='tornpda'] .nat-refresh-button{width:100%}#nat-wrapper[data-runtime='tornpda'] .nat-tabs{gap:3px;padding:3px}#nat-wrapper[data-runtime='tornpda'] .nat-tab{padding:7px 5px!important;font-size:10px!important}#nat-wrapper[data-runtime='tornpda'] .nat-card{padding:10px}#nat-wrapper[data-runtime='tornpda'] .nat-search-panel{grid-template-columns:minmax(0,1fr)}#nat-wrapper[data-runtime='tornpda'] .nat-search-count{justify-self:start}#nat-wrapper[data-runtime='tornpda'] .nat-card-header{gap:6px}#nat-wrapper[data-runtime='tornpda'] .nat-total strong{font-size:11px!important}}@media (max-height:560px){#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-drag{min-height:44px;padding:7px 10px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-minimize{width:40px;height:34px;flex-basis:40px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] #nat-body{padding:7px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] .nat-card{padding:9px}#nat-wrapper[data-runtime='tornpda'][data-orientation='landscape'] button:not(.nat-search-clear){min-height:34px;padding:7px 9px;font-size:11px}}" +
            ".nat-collection-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:0 0 10px;padding:4px;border:1px solid #3a5274;border-radius:9px;background:rgba(8,15,25,.28)}.nat-collection-tab{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;background:transparent!important;border-color:transparent!important;color:#aebed3!important}.nat-collection-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nat-collection-tab b{display:grid;place-items:center;min-width:22px;padding:2px 5px;border-radius:999px;color:#c9d9ef;background:rgba(118,151,193,.2);font-size:9px}.nat-collection-tab.active{background:#365d99!important;border-color:#5279b3!important;color:#fff!important;box-shadow:0 3px 8px rgba(6,12,22,.28)}.nat-collection-tab.active b{color:#fff;background:rgba(255,255,255,.18)}.nat-award-meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;color:#8fa7c3;font-size:9px;font-weight:750}.nat-award-meta span{padding:2px 5px;border:1px solid #38506e;border-radius:999px;background:rgba(9,16,26,.26)}.nat-award-rarity{color:inherit}.nat-award-status{align-self:start;margin-top:1px;padding:3px 5px;border:1px solid #5c6680;border-radius:5px;color:#b8c7dc;background:rgba(94,111,140,.16);font-size:9px;font-weight:800;line-height:1.2;white-space:nowrap}#nat-wrapper[data-theme='light'] .nat-collection-switch{background:rgba(171,188,205,.34);border-color:#a2b3c5}#nat-wrapper[data-theme='light'] .nat-collection-tab{color:#3c526b!important}#nat-wrapper[data-theme='light'] .nat-collection-tab.active{background:#365f99!important;border-color:#2b568f!important;color:#fff!important}#nat-wrapper[data-theme='light'] .nat-award-meta{color:#526981}#nat-wrapper[data-theme='light'] .nat-award-meta span{border-color:#a9bacb;background:#dce5ee}#nat-wrapper[data-theme='light'] .nat-award-status{border-color:#a0afbf;color:#3f536b;background:#d7e0e9}@container (max-width:380px){.nat-collection-switch{gap:3px;padding:3px}.nat-collection-tab{padding:6px 5px!important;font-size:10px!important}.nat-award-status{grid-column:2;justify-self:start;margin:1px 0 0}}" +
            "</style><style>" +
            "#nat-wrapper{box-sizing:border-box;max-inline-size:var(--nat-panel-max-width,calc(100vw - 20px));max-block-size:var(--nat-panel-max-height,calc(100dvh - 20px))}#nat-wrapper[data-runtime='tornpda'][data-edge]{margin:0}#nat-safe-area-probe{display:block;position:fixed;inset:0 auto auto 0;visibility:hidden;pointer-events:none;inline-size:0;block-size:0;min-inline-size:0!important;min-block-size:0!important;margin:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);border:0}#nat-drag{min-width:0}#nat-title{flex:1 1 auto;min-width:0}#nat-body{overflow-x:clip;overflow-y:auto}#nat-content,.nat-grid,.nat-list,.nat-card,.nat-summary-card,.nat-search-panel,.nat-refresh,.nat-tabs,.nat-card-header,.nat-progress-header,.nat-award-row,.nat-progress-row,.nat-key-row,.nat-collection-switch{min-width:0;max-width:100%}.nat-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}.nat-tab{width:100%;min-width:0}.nat-card-header>div,.nat-progress-header>div,.nat-total,.nat-card-note,.nat-progress-percent,.nat-award-row time,.nat-award-status{min-width:0;max-width:100%}.nat-progress-value{min-width:0}" +
            ".nat-storage-toggle{display:flex;align-items:flex-start;gap:9px;padding:9px;border:1px solid #3c5271;border-radius:8px;background:rgba(7,13,22,.28);cursor:pointer}.nat-storage-toggle input{flex:0 0 auto;width:18px;height:18px;margin:1px 0 0;accent-color:#4c78ad}.nat-storage-toggle span{display:grid;gap:3px;min-width:0}.nat-storage-toggle strong{color:#edf4ff;font-size:11px}.nat-storage-toggle small{color:#9baabd;font-size:10px;line-height:1.35}#nat-wrapper[data-theme='light'] .nat-storage-toggle{border-color:#a7b8c9;background:#d5dfe9}#nat-wrapper[data-theme='light'] .nat-storage-toggle strong{color:#142238}#nat-wrapper[data-theme='light'] .nat-storage-toggle small{color:#4c6076}.nat-settings-actions{display:flex;flex-wrap:wrap;gap:7px}.nat-backup-confirm{display:grid;gap:7px;padding:9px;border:1px solid #5279b3;border-radius:8px;background:rgba(30,55,88,.35)}.nat-backup-confirm strong,.nat-backup-confirm p{min-width:0;overflow-wrap:anywhere}.nat-backup-confirm p{margin:0;color:#b9c9dd;font-size:10px;line-height:1.4}#nat-wrapper[data-theme='light'] .nat-backup-confirm{border-color:#879fbd;background:#d5e1ed}#nat-wrapper[data-theme='light'] .nat-backup-confirm p{color:#40556c}.nat-key-source{margin:0;color:#9dd8ff!important;font-size:10px;line-height:1.4}#nat-toast{position:absolute;z-index:8;right:10px;bottom:10px;max-width:calc(100% - 20px);padding:9px 11px;border:1px solid #4a668d;border-radius:8px;background:rgba(20,41,68,.97);color:#f7fbff;font-size:11px;font-weight:700;box-shadow:0 8px 20px rgba(0,0,0,.34)}#nat-toast[data-tone='green']{border-color:#3d8b64;background:rgba(25,85,61,.97)}#nat-toast[data-tone='red']{border-color:#a34b55;background:rgba(120,42,50,.97)}#nat-toast[hidden]{display:none}#nat-wrapper[data-theme='light'] .nat-key-source{color:#365f99!important}#nat-wrapper[data-theme='light'] #nat-toast{border-color:#8097b4;background:#e6eef7;color:#142238}" +
            "@container (max-width:430px){.nat-refresh{flex-wrap:wrap;gap:7px}.nat-sync-status{flex:1 1 100%}.nat-top-actions{display:grid;width:100%;grid-template-columns:minmax(0,1fr) 40px;gap:7px}.nat-refresh-button{width:100%}.nat-search-panel{grid-template-columns:minmax(0,1fr)}.nat-search-count{justify-self:start}.nat-key-row{flex-direction:column}.nat-key-row button,.nat-theme-button{width:100%}.nat-settings-actions{display:grid;grid-template-columns:minmax(0,1fr);width:100%}.nat-settings-actions button{width:100%}.nat-card-header,.nat-progress-header{flex-wrap:wrap;gap:6px}.nat-total{justify-items:start}.nat-card-note{justify-self:start}.nat-award-row{grid-template-columns:4px minmax(0,1fr);gap:7px}.nat-award-row time,.nat-award-status{grid-column:2;justify-self:start;margin:1px 0 0}.nat-progress-value{flex-wrap:wrap}.nat-tabs{gap:3px;padding:3px}.nat-tab{padding:7px 4px!important;font-size:10px!important}}@container (max-width:300px){#nat-body{padding:6px}.nat-card{padding:8px}.nat-tabs{gap:2px;padding:2px}.nat-tab{padding:6px 2px!important;font-size:9px!important}.nat-collection-switch{gap:3px;padding:3px}.nat-collection-tab{padding:6px 4px!important;font-size:9px!important}.nat-search-panel{padding:6px}.nat-search-field{padding:0 5px}}" +
            "</style><header id='nat-drag'><span id='nat-title'></span><button id='nat-minimize' aria-label='Minimize Naughty Awards Tracker'>−</button></header><main id='nat-body' tabindex='0' aria-label='Awards Tracker content'><div id='nat-content'></div></main><i id='nat-safe-area-probe' aria-hidden='true'></i><span id='nat-toast' role='status' aria-live='polite' hidden></span><span id='nat-resize-status' class='nat-sr-only' aria-live='polite'></span><button type='button' class='nat-resize' data-corner='top-left' title='Resize from the upper-left corner' aria-label='Resize window from the upper-left corner. Use arrow keys; hold Shift for larger changes.'></button><button type='button' class='nat-resize' data-corner='bottom-left' title='Resize from the bottom-left corner' aria-label='Resize window from the bottom-left corner. Use arrow keys; hold Shift for larger changes.'></button><button type='button' class='nat-resize' data-corner='bottom-right' title='Resize from the bottom-right corner' aria-label='Resize window from the bottom-right corner. Use arrow keys; hold Shift for larger changes.'></button>";
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        standardFeedbackLayer();
        updateRuntimeLayout();
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        await loadPdaStorage();
        await loadStoragePreference();
        const [apiKey, dashboard, position, cache, refreshedAt] = await Promise.all([
            gmGet(STORAGE.key, ""), gmGet(STORAGE.dashboard, {}), gmGet(STORAGE.position, null),
            gmGet(STORAGE.cache, null), gmGet(STORAGE.refreshedAt, 0)
        ]);
        state.savedApiKey = String(apiKey || "").trim();
        state.apiKey = state.savedApiKey;
        state.apiKeySource = "saved";
        adoptInjectedPdaApiKey();
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
        bindActivityLifecycle();
        scheduleDailyRefresh();
    }
    detectRuntimeAtStartup();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
