// ==UserScript==
// @name         Naughty Awards Tracker
// @namespace    https://github.com/xf4k31tx/Naughty-Awards-Tracker
// @version      1.0.2
// @description  Focused Torn medal, honor, and award-progress tracker.
// @author       sharpsplinter [315311]
// @match        https://www.torn.com/page.php?sid=awards*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.torn.com
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.0.2";
    const BASE_URL = "https://api.torn.com/v2/";
    const STORAGE = {
        key: "NAT_TORN_API_KEY",
        dashboard: "NAT_DASHBOARD_STATE",
        position: "NAT_WIDGET_POSITION",
        cache: "NAT_AWARDS_CACHE",
        refreshedAt: "NAT_AWARDS_REFRESHED_AT"
    };
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
        dashboard: null, refreshInFlight: false, dailyTimer: null, error: ""
    };

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

    async function gmGet(key, fallback) {
        try { return await GM.getValue(key, fallback); } catch { return fallback; }
    }
    function gmSet(key, value) {
        void GM.setValue(key, value).catch(() => {});
    }
    function requestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url, headers: { Accept: "application/json" },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error("HTTP " + response.status));
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data?.error) reject(new Error(data.error.error || "Torn API error"));
                        else resolve(data);
                    } catch { reject(new Error("Unable to parse API response")); }
                },
                onerror: () => reject(new Error("Network request failed"))
            });
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
        const catalog = normalizeCatalog(catalogRaw);
        const byId = new Map(catalog.map((item) => [Number(item.id), item]));
        const earned = (Array.isArray(earnedRaw) ? earnedRaw : []).map((item) => {
            const metadata = byId.get(Number(item.id)) || {};
            return {
                id: Number(item.id), timestamp: Number(item.timestamp || 0),
                name: metadata.name || fallback + " #" + item.id,
                description: metadata.description || "", rarity: metadata.rarity || "Unknown"
            };
        }).sort((a, b) => b.timestamp - a.timestamp);
        const rarity = earned.reduce((result, item) => {
            result[item.rarity] = (result[item.rarity] || 0) + 1;
            return result;
        }, {});
        return { totalEarned: earned.length, totalAvailable: catalog.length, earned, rarity };
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
        if (!state.apiKey || state.refreshInFlight || state.isMinimized) return;
        state.refreshInFlight = true;
        state.error = "";
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
            gmSet(STORAGE.cache, state.cache);
            gmSet(STORAGE.refreshedAt, state.refreshedAt);
        } catch (error) {
            state.error = error.message || "Unable to refresh awards";
        } finally {
            state.refreshInFlight = false;
            render();
        }
    }

    function rarityChips(summary) {
        return Object.entries(summary?.rarity || {}).map(([rarity, count]) =>
            "<span class='nat-chip' style='color:" + (RARITY[rarity] || "#cbd5e1") + "'>" + escapeHtml(rarity) + ": " + formatInteger(count) + "</span>"
        ).join("");
    }
    function awardRows(items, emptyText, limit) {
        const visible = (items || []).slice(0, limit);
        if (!visible.length) return "<div class='nat-empty'>" + escapeHtml(emptyText) + "</div>";
        return visible.map((item) =>
            "<article class='nat-award-row'><div class='nat-award-copy'><div class='nat-award-name' style='color:" + (RARITY[item.rarity] || "#cbd5e1") + "'>" + escapeHtml(item.name) + "</div>" +
            (item.description ? "<div class='nat-description'>" + escapeHtml(item.description) + "</div>" : "") +
            "</div><time>" + formatDate(item.timestamp) + "</time></article>"
        ).join("");
    }
    function summaryCard(title, summary, limit) {
        return "<section class='nat-card'><header class='nat-card-header'><h2>" + title + "</h2><strong>" +
            formatInteger(summary?.totalEarned) + " / " + formatInteger(summary?.totalAvailable) +
            "</strong></header><div class='nat-chips'>" + rarityChips(summary) + "</div>" +
            awardRows(summary?.earned, "No " + title.toLowerCase() + " earned yet.", limit) + "</section>";
    }
    function progressCard(progress) {
        const rows = (progress || []).map((item) =>
            "<article class='nat-progress-row'><div class='nat-progress-header'><div><div class='nat-award-name' style='color:" +
            (RARITY[item.rarity] || "#cbd5e1") + "'>" + escapeHtml(item.name) + "</div>" +
            (item.description ? "<div class='nat-description'>" + escapeHtml(item.description) + "</div>" : "") +
            "</div><strong>" + item.percent.toFixed(1) + "%</strong></div><div class='nat-progress-track'><div style='width:" +
            item.percent + "%'></div></div><div class='nat-progress-value'>" + formatInteger(item.current) + " / " +
            formatInteger(item.target) + " · " + escapeHtml(item.type) + "</div></article>"
        ).join("");
        return "<section class='nat-card'><header class='nat-card-header'><h2>Closest to Completion</h2></header>" +
            (rows || "<div class='nat-empty'>No configured award progress is available.</div>") + "</section>";
    }
    function awardsView() {
        if (!state.cache) return "<div class='nat-empty'>Save an API key, then use Refresh to load your awards.</div>";
        if (state.activeTab === "honors") return "<div class='nat-list'>" + summaryCard("Honors", state.cache.honors, Infinity) + "</div>";
        if (state.activeTab === "medals") return "<div class='nat-list'>" + summaryCard("Medals", state.cache.medals, Infinity) + "</div>";
        return "<div class='nat-grid nat-awards-main'>" + progressCard(state.cache.progress) + "</div>";
    }
    function settingsView() {
        return "<section class='nat-card nat-settings'><div class='nat-card-header'><h2>Settings</h2><button data-tab='awards'>Awards</button></div><label for='nat-api-key'>Torn API Key</label>" +
            "<div class='nat-key-row'><input id='nat-api-key' type='password' autocomplete='off' value='" + escapeHtml(state.apiKey) +
            "' placeholder='Enter Torn API key'><button data-action='save-key'>Save Key</button></div>" +
            "<p>Automatic refresh runs once per day at 00:00 UTC. Manual refresh stays available on the Awards tabs.</p>" +
            "<button data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button></section>";
    }
    function saveDashboardState() {
        gmSet(STORAGE.dashboard, {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized, windowSizes: state.windowSizes
        });
    }
    function sizeKey() {
        return state.activeTab === "settings" ? "settings" : "awards";
    }
    function getSizeLimits() {
        return {
            minWidth: Math.min(380, Math.max(260, window.innerWidth - 20)),
            minHeight: Math.min(620, Math.max(320, window.innerHeight - 20)),
            maxWidth: Math.max(260, window.innerWidth - 20),
            maxHeight: Math.max(320, window.innerHeight - 20)
        };
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const rect = dashboard.getBoundingClientRect();
        const saved = position || { edge: "right", x: window.innerWidth - rect.width, y: 20 };
        const x = clamp(Number(saved.x || 0), 0, window.innerWidth - rect.width);
        const y = clamp(Number(saved.y || 0), 0, window.innerHeight - rect.height);
        dashboard.style.right = "auto";
        dashboard.style.bottom = "auto";
        if (saved.edge === "left") { dashboard.style.left = "0px"; dashboard.style.top = y + "px"; }
        else if (saved.edge === "top") { dashboard.style.left = x + "px"; dashboard.style.top = "0px"; }
        else if (saved.edge === "bottom") { dashboard.style.left = x + "px"; dashboard.style.top = Math.max(0, window.innerHeight - rect.height) + "px"; }
        else { dashboard.style.left = Math.max(0, window.innerWidth - rect.width) + "px"; dashboard.style.top = y + "px"; }
    }
    function savePosition() {
        const rect = state.dashboard.getBoundingClientRect();
        const distances = { left: rect.left, right: window.innerWidth - rect.right, top: rect.top, bottom: window.innerHeight - rect.bottom };
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
        const saved = state.windowSizes[sizeKey()] || { width: 480, height: Math.min(720, window.innerHeight * .8) };
        dashboard.style.width = clamp(Number(saved.width || 480), limits.minWidth, limits.maxWidth) + "px";
        dashboard.style.height = clamp(Number(saved.height || 620), limits.minHeight, limits.maxHeight) + "px";
        applyPosition();
        fitContent();
    }
    function fitContent() {
        const body = state.dashboard?.querySelector("#nat-body");
        const content = state.dashboard?.querySelector("#nat-content");
        if (!body || !content || state.isMinimized) return;
        body.style.setProperty("--nat-scale", "1");
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
            body.style.display = "none";
            dashboard.style.width = "48px";
            dashboard.style.height = "36px";
            title.textContent = "NAT";
            button.style.display = "none";
            handles.forEach((handle) => { handle.style.display = "none"; });
            applyPosition();
        } else {
            body.style.display = "flex";
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
        const content = dashboard.querySelector("#nat-content");
        const tabs = [["awards", "Awards"], ["honors", "Honors"], ["medals", "Medals"]].map(([id, label]) =>
            "<button class='nat-tab " + (state.activeTab === id ? "active" : "") + "' data-tab='" + id + "'>" + label + "</button>"
        ).join("");
        content.innerHTML = state.activeTab === "settings" ? settingsView() :
            "<div class='nat-refresh'><span>UPDATED: " + (state.refreshedAt ? formatRelative(state.refreshedAt) : "Never") +
            " · daily at 00:00 UTC</span><button data-action='refresh' " + (state.refreshInFlight || !state.apiKey ? "disabled" : "") +
            ">↻ " + (state.refreshInFlight ? "Refreshing…" : "Refresh") + "</button><button data-tab='settings'>⚙</button></div><nav class='nat-tabs'>" + tabs + "</nav>" +
            (state.error ? "<div class='nat-error'>" + escapeHtml(state.error) + "</div>" : "") + awardsView();
        dashboard.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => {
            state.activeTab = button.dataset.tab;
            saveDashboardState();
            applySize();
            render();
        });
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
        let dragging = false, moved = false, offsetX = 0, offsetY = 0;
        drag.addEventListener("mousedown", (event) => {
            if (event.target.closest("#nat-minimize")) return;
            const rect = dashboard.getBoundingClientRect();
            dragging = true; moved = false; offsetX = event.clientX - rect.left; offsetY = event.clientY - rect.top;
        });
        document.addEventListener("mousemove", (event) => {
            if (!dragging) return;
            moved = true;
            const rect = dashboard.getBoundingClientRect();
            dashboard.style.left = clamp(event.clientX - offsetX, 0, window.innerWidth - rect.width) + "px";
            dashboard.style.top = clamp(event.clientY - offsetY, 0, window.innerHeight - rect.height) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (dragging) savePosition();
            dragging = false;
        });
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
        let resizing = false, start = null;
        dashboard.querySelectorAll(".nat-resize").forEach((handle) => handle.addEventListener("mousedown", (event) => {
            if (state.isMinimized) return;
            event.preventDefault(); event.stopPropagation();
            resizing = true;
            start = { x: event.clientX, y: event.clientY, rect: dashboard.getBoundingClientRect(), corner: handle.dataset.corner };
            document.body.style.userSelect = "none";
        }));
        document.addEventListener("mousemove", (event) => {
            if (!resizing || !start) return;
            const limits = getSizeLimits();
            const fromLeft = start.corner.endsWith("left");
            const fromTop = start.corner.startsWith("top");
            const width = clamp(start.rect.width + (fromLeft ? start.x - event.clientX : event.clientX - start.x), limits.minWidth, Math.min(limits.maxWidth, fromLeft ? start.rect.right : window.innerWidth - start.rect.left));
            const height = clamp(start.rect.height + (fromTop ? start.y - event.clientY : event.clientY - start.y), limits.minHeight, Math.min(limits.maxHeight, fromTop ? start.rect.bottom : window.innerHeight - start.rect.top));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = (fromLeft ? start.rect.right - width : start.rect.left) + "px";
            dashboard.style.top = (fromTop ? start.rect.bottom - height : start.rect.top) + "px";
            fitContent();
        });
        document.addEventListener("mouseup", () => {
            if (!resizing) return;
            resizing = false; start = null; document.body.style.userSelect = "";
            saveSize(); savePosition(); render();
        });
        window.addEventListener("resize", () => { applySize(); saveSize(); });
    }
    function initializeDashboard() {
        const dashboard = document.createElement("aside");
        dashboard.id = "nat-wrapper";
        dashboard.innerHTML = "<style>" +
            "#nat-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:rgba(24,24,24,.97);color:#fff;border:1px solid #3b3b3b;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.6);font-family:Arial,sans-serif}" +
            "#nat-wrapper[data-theme='light']{background:#f8fafc;color:#172033;border-color:#cbd5e1}#nat-wrapper *,#nat-wrapper *:before,#nat-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}" +
            "#nat-drag{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#2c2c2c;border-bottom:1px solid #444;cursor:move;user-select:none}#nat-wrapper[data-theme='light'] #nat-drag{background:#e2e8f0;border-color:#cbd5e1}" +
            "#nat-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#nat-minimize{width:36px;height:30px;flex:0 0 36px;place-items:center;border:1px solid #666;border-radius:5px;color:#fff;background:#444;font-size:19px;font-weight:700;cursor:pointer}" +
            "#nat-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;scrollbar-width:none;-ms-overflow-style:none}#nat-body::-webkit-scrollbar,.nat-list::-webkit-scrollbar{width:0;height:0}#nat-content{display:grid;gap:8px;align-items:stretch;transform:scale(var(--nat-scale,1));transform-origin:top left;width:calc(100% / var(--nat-scale,1))}" +
            ".nat-refresh{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#aab4c4;font-size:10px}.nat-tabs{display:flex;gap:5px;flex-wrap:wrap}button{border:1px solid #4b5563;border-radius:4px;background:#2a2a2a;color:#fff;padding:6px 8px;font-size:11px;cursor:pointer}button:hover{filter:brightness(1.18)}button:disabled{opacity:.55;cursor:not-allowed}#nat-wrapper[data-theme='light'] button{background:#e2e8f0;color:#172033;border-color:#94a3b8}.nat-tab.active{background:#3b5998!important;color:#fff!important;font-weight:700}" +
            ".nat-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:stretch;width:100%}.nat-card{width:100%;border:1px solid #2a2a2a;border-radius:8px;padding:10px;background:rgba(20,20,20,.7)}#nat-wrapper[data-theme='light'] .nat-card{background:#fff;border-color:#cbd5e1}.nat-card-header,.nat-progress-header{display:flex;justify-content:space-between;gap:8px;align-items:start}h2{margin:0 0 6px;font-size:13px}.nat-card-header strong,.nat-progress-header strong{color:#9dd8ff;font-size:11px;white-space:nowrap}.nat-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}.nat-chip{border:1px solid #3b3b3b;border-radius:4px;padding:2px 5px;font-size:10px}" +
            ".nat-award-row,.nat-progress-row{border-top:1px solid #2b2b2b;padding:7px 0}#nat-wrapper[data-theme='light'] .nat-award-row,#nat-wrapper[data-theme='light'] .nat-progress-row{border-color:#e2e8f0}.nat-award-row{display:flex;justify-content:space-between;gap:8px}.nat-award-copy{flex:1}.nat-award-row time,.nat-progress-value,.nat-description,.nat-empty,.nat-settings p{color:#9ca3af;font-size:10px;line-height:1.35}.nat-award-row time{white-space:nowrap}.nat-award-name{font-size:11px;font-weight:700}.nat-description{margin-top:2px}.nat-progress-track{height:6px;margin-top:6px;overflow:hidden;border-radius:3px;background:#222}.nat-progress-track>div{height:100%;background:#7fe18d}.nat-progress-value{margin-top:3px}.nat-list{width:100%;max-height:100%;overflow:auto;scrollbar-width:none;-ms-overflow-style:none}.nat-settings{display:grid;gap:8px}.nat-settings label{font-size:11px;font-weight:700}.nat-key-row{display:flex;gap:6px}.nat-key-row input{flex:1;min-width:0;border:1px solid #64748b;border-radius:4px;background:#111;color:#fff;padding:6px}#nat-wrapper[data-theme='light'] .nat-key-row input{background:#fff;color:#172033}.nat-error{padding:7px;border:1px solid #a33;border-radius:5px;color:#ff9b9b;background:rgba(160,30,30,.18);font-size:11px}" +
            ".nat-resize{position:absolute;z-index:4;width:20px;height:20px;touch-action:none}.nat-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nat-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nat-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}@container(max-width:430px){.nat-grid{grid-template-columns:1fr}.nat-card{padding:7px}}" +
            "</style><header id='nat-drag'><span id='nat-title'></span><button id='nat-minimize' aria-label='Minimize Naughty Awards Tracker'>−</button></header><main id='nat-body'><div id='nat-content'></div></main><i class='nat-resize' data-corner='top-left' title='Resize this tab'></i><i class='nat-resize' data-corner='bottom-left' title='Resize this tab'></i><i class='nat-resize' data-corner='bottom-right' title='Resize this tab'></i>";
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        const [apiKey, dashboard, position, cache, refreshedAt] = await Promise.all([
            gmGet(STORAGE.key, ""), gmGet(STORAGE.dashboard, {}), gmGet(STORAGE.position, null),
            gmGet(STORAGE.cache, null), gmGet(STORAGE.refreshedAt, 0)
        ]);
        state.apiKey = String(apiKey || "").trim();
        state.activeTab = ["awards", "honors", "medals", "settings"].includes(dashboard?.activeTab) ? dashboard.activeTab : "awards";
        state.theme = dashboard?.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard?.isMinimized === true;
        state.windowSizes = dashboard?.windowSizes && typeof dashboard.windowSizes === "object" ? dashboard.windowSizes : {};
        state.position = position;
        state.cache = cache;
        state.refreshedAt = Number(refreshedAt || 0);
        initializeDashboard();
        scheduleDailyRefresh();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
