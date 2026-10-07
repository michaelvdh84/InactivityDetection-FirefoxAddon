(function () {
    "use strict";

    const core = typeof module !== "undefined" && module.exports
        ? require("./csamLanguageCore.js") : globalThis.InactivityCsamLanguageCore;
    const WAIT_MS = 10000;

    function createLanguageSynchronizer({ documentObject, pageUrl, loadTarget, consume,
        createObserver, addStorageListener, removeStorageListener,
        addPageHideListener, removePageHideListener,
        scheduleTimeout = setTimeout, cancelTimeout = clearTimeout }) {
        let stopped = false;
        let busy = false;
        let observer = null;
        let timeout = null;
        let target = null;

        function stop() {
            if (stopped) return;
            stopped = true;
            observer?.disconnect();
            if (timeout !== null) cancelTimeout(timeout);
            removeStorageListener(onStorageChanged);
            removePageHideListener(stop);
        }

        function onStorageChanged(changes, areaName) {
            if (areaName === "local" && changes.csamLanguageSyncEnabled &&
                changes.csamLanguageSyncEnabled.newValue !== true) stop();
        }

        async function trySynchronize() {
            if (stopped || busy || !target || !core.isCsamPage(pageUrl())) return;
            const control = core.findLanguageControl(documentObject, target.language);
            if (!control) return;
            busy = true;
            observer?.disconnect();
            try {
                const permission = await consume(target.token);
                if (stopped) return;
                const currentControl = core.findLanguageControl(documentObject, target.language);
                stop();
                if (permission?.allowed && currentControl && core.isCsamPage(pageUrl()) &&
                    currentControl.currentLanguage !== target.language) currentControl.target.click();
            } catch { stop(); }
        }

        async function start() {
            if (!core.isCsamPage(pageUrl())) return;
            addStorageListener(onStorageChanged);
            addPageHideListener(stop);
            timeout = scheduleTimeout(stop, WAIT_MS);
            try {
                target = await loadTarget();
                if (stopped) return;
                if (!target || !["fr", "nl", "en"].includes(target.language) ||
                    typeof target.token !== "string") { stop(); return; }
                observer = createObserver(() => { void trySynchronize(); });
                observer.observe(documentObject, { childList: true, subtree: true,
                    attributes: true, attributeFilter: ["class", "role"] });
                await trySynchronize();
            } catch { stop(); }
        }

        return { start, stop };
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { createLanguageSynchronizer, WAIT_MS };
    } else if (!globalThis.InactivityCsamLanguageStarted) {
        // Injected only when enabled and a pending MyBxl journey exists.
        globalThis.InactivityCsamLanguageStarted = true;
        const owner = crypto.randomUUID();
        const controller = createLanguageSynchronizer({ documentObject: document,
            pageUrl: () => window.location.origin + window.location.pathname,
            loadTarget: () => browser.runtime.sendMessage({ type: "csam-language-target", owner }),
            consume: (token) => browser.runtime.sendMessage({ type: "csam-language-consume", token, owner }),
            createObserver: (callback) => new MutationObserver(callback),
            addStorageListener: (listener) => browser.storage.onChanged.addListener(listener),
            removeStorageListener: (listener) => browser.storage.onChanged.removeListener(listener),
            addPageHideListener: (listener) => window.addEventListener("pagehide", listener, { once: true }),
            removePageHideListener: (listener) => window.removeEventListener("pagehide", listener)
        });
        void controller.start();
    }
})();
