(function () {
    "use strict";

    const core = typeof module !== "undefined" && module.exports
        ? require("./csamLanguageCore.js") : globalThis.InactivityCsamLanguageCore;
    const POLICY_KEY = "csamLanguageSyncEnabled";
    const STATE_PREFIX = "csamLanguageTab:";

    function createLanguageSyncBackground({ browserObject, loadConfiguration,
        now = Date.now, createToken = () => crypto.randomUUID() }) {
        let enabled = false;
        let policyInitialized = false;
        let generation = 0;
        let queue = Promise.resolve();
        let ready = Promise.resolve();
        const session = browserObject.storage.session;
        const key = (tabId) => STATE_PREFIX + tabId;
        const enqueue = (operation) => {
            const task = queue.then(operation);
            queue = task.catch(() => {}); // Fail silently, without logging authentication URLs.
            return task;
        };

        async function readState(tabId) {
            const state = (await session.get(key(tabId)))[key(tabId)];
            if (!state || !["fr", "nl", "en"].includes(state.language) ||
                typeof state.token !== "string" || !Number.isFinite(state.expiresAt) || state.expiresAt <= now()) return null;
            return state;
        }

        async function processNavigation(tabId, url, portalNavigation) {
            if (!enabled) return null;
            const language = core.getPortalLanguage(url);
            if (language && portalNavigation) {
                await session.set({ [key(tabId)]: { language, token: createToken(),
                    expiresAt: now() + core.JOURNEY_LIFETIME_MS, attempted: false, consumed: false } });
                return null;
            }
            if (!core.isCsamPage(url)) return null;
            const state = await readState(tabId);
            if (!state || state.attempted || state.consumed) return null;
            // Persist before injection: reloads and background restarts cannot repeat an attempt.
            await session.set({ [key(tabId)]: { ...state, attempted: true } });
            return { tabId, generation };
        }

        async function inject(attempt) {
            if (!attempt || !enabled || attempt.generation !== generation) return;
            try {
                await browserObject.scripting.executeScript({
                    target: { tabId: attempt.tabId, frameIds: [0] },
                    files: ["csamLanguageCore.js", "csamLanguageContent.js"]
                });
            } catch { /* Navigation, missing permission or a closed tab: leave the page alone. */ }
        }

        function onUpdated(tabId, changeInfo, tab) {
            return ready.then(() => {
                // Wake-up listeners are synchronous, but disabled policy never inspects the URL.
                if (!enabled || (!changeInfo.url && changeInfo.status !== "complete")) return null;
                const operationGeneration = generation;
                const url = core.getPageAddress(changeInfo.url || tab.url);
                return enqueue(() => operationGeneration === generation
                    ? processNavigation(tabId, url, Boolean(changeInfo.url)) : null);
            }).then(inject).catch(() => {});
        }

        function onRemoved(tabId) {
            if (!enabled) return Promise.resolve();
            return enqueue(() => session.remove(key(tabId))).catch(() => {});
        }

        function onMessage(message, sender) {
            // Reset only this feature's state; do not respond to or alter the existing reset handler.
            if (message?.type === "reset-session") {
                if (Number.isInteger(sender.tab?.id)) onRemoved(sender.tab.id);
                return undefined;
            }
            if (!["csam-language-target", "csam-language-consume"].includes(message?.type)) return undefined;
            return ready.then(() => enqueue(async () => {
                const tabId = sender.tab?.id;
                if (!enabled || sender.frameId !== 0 || !Number.isInteger(tabId) ||
                    !core.isCsamPage(sender.url) || typeof message.owner !== "string" ||
                    !message.owner || message.owner.length > 64) return null;
                const tab = await browserObject.tabs.get(tabId);
                if (!core.isCsamPage(tab.url)) return null;
                const state = await readState(tabId);
                if (!state || !state.attempted || state.consumed ||
                    (state.owner && state.owner !== message.owner)) return null;
                if (message.type === "csam-language-target") {
                    await session.set({ [key(tabId)]: { ...state, owner: message.owner } });
                    return { language: state.language, token: state.token };
                }
                if (state.token !== message.token || state.owner !== message.owner) return null;
                // Claim once, before the click; two documents cannot both activate the control.
                await session.set({ [key(tabId)]: { ...state, consumed: true } });
                return { allowed: enabled };
            })).catch(() => null);
        }

        async function seedOpenTabs() {
            if (!enabled) return;
            const tabs = await browserObject.tabs.query({});
            const liveIds = new Set(tabs.map((tab) => key(tab.id)));
            const stored = await session.get(null);
            const staleKeys = Object.keys(stored).filter((name) =>
                name.startsWith(STATE_PREFIX) && !liveIds.has(name));
            if (staleKeys.length) await session.remove(staleKeys);
            for (const tab of tabs) {
                if (!enabled) break;
                // Seed only real portal pages. Never infer a source language on direct CSAM access.
                if (core.getPortalLanguage(tab.url)) await processNavigation(tab.id, tab.url, true);
                else if (core.isCsamPage(tab.url)) void inject(await processNavigation(tab.id, tab.url, false));
            }
        }

        function setEnabled(value) {
            const next = value === true && Boolean(session && browserObject.scripting);
            if (policyInitialized && next === enabled) return queue;
            policyInitialized = true;
            enabled = next;
            generation += 1;
            if (enabled) return enqueue(seedOpenTabs);
            return enqueue(async () => {
                const stored = await session.get(null);
                const keys = Object.keys(stored).filter((name) => name.startsWith(STATE_PREFIX));
                if (keys.length) await session.remove(keys);
            });
        }

        function start() {
            // MV3 event pages must register wake-up listeners synchronously on every start.
            // Guards below policy resolution keep them inert when the feature is disabled.
            browserObject.tabs.onUpdated.addListener(onUpdated, {
                urls: ["https://www.mybxl.be/*", "https://idp.iamfas.belgium.be/*"],
                properties: ["url", "status"]
            });
            browserObject.tabs.onRemoved.addListener(onRemoved);
            browserObject.runtime.onMessage.addListener(onMessage);
            browserObject.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === "local" && changes[POLICY_KEY]) {
                    setEnabled(changes[POLICY_KEY].newValue).catch(() => {});
                }
            });
            ready = (async () => {
                try {
                    const response = await loadConfiguration();
                    await setEnabled(response?.config?.[POLICY_KEY]);
                } catch { /* No valid effective configuration: stay disabled. */ }
            })();
            return ready;
        }

        return { start, setEnabled, onUpdated, onRemoved, onMessage };
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { createLanguageSyncBackground, POLICY_KEY, STATE_PREFIX };
    } else {
        createLanguageSyncBackground({ browserObject: browser,
            loadConfiguration: () => ensureStartupManagedRefresh() }).start();
    }
})();
