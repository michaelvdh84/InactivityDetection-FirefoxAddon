(function () {
    "use strict";

    const HIDDEN_ATTRIBUTE = "data-inactivity-plugin-hidden";
    const HIDDEN_SELECTOR = '[data-inactivity-plugin-hidden="true"]';
    const EFFECTIVE_CONFIGURATION_KEYS = new Set([
        "kioskRestrictionsEnabled",
        "kioskRestrictions"
    ]);
    const core = typeof globalThis.InactivityKioskRestrictionsCore !== "undefined"
        ? globalThis.InactivityKioskRestrictionsCore
        : typeof module !== "undefined" && module.exports
            ? require("./kioskRestrictionsCore.js")
            : null;

    function hasCompleteConfiguration(config) {
        return Boolean(
            config &&
            typeof config.kioskRestrictionsEnabled === "boolean" &&
            Array.isArray(config.kioskRestrictions)
        );
    }

    function createKioskRestrictionsController({
        documentObject,
        pageUrl,
        createObserver,
        loadConfiguration,
        addStorageListener,
        logError
    }) {
        let configuration = null;
        let observer = null;
        let running = false;
        let storageListenerRegistered = false;

        function reportError(message, error) {
            logError(message, error);
        }

        function disconnectObserver() {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }

        function restoreMarkedElements() {
            for (const element of documentObject.querySelectorAll(HIDDEN_SELECTOR)) {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
        }

        function getMatchingSelectors() {
            return core.getMatchingKioskSelectors(
                configuration.kioskRestrictions,
                pageUrl
            );
        }

        function applyMatchingSelectors(matchingSelectors) {
            for (const { ruleId, selector } of matchingSelectors) {
                try {
                    for (const element of documentObject.querySelectorAll(selector)) {
                        element.setAttribute(HIDDEN_ATTRIBUTE, "true");
                    }
                } catch (error) {
                    reportError(`Invalid kiosk selector in rule "${ruleId}": ${selector}`, error);
                }
            }
        }

        function observeMatchingSelectors(matchingSelectors) {
            if (!matchingSelectors.length) return;
            observer = createObserver(() => {
                if (running && configuration.kioskRestrictionsEnabled) {
                    applyMatchingSelectors(getMatchingSelectors());
                }
            });
            observer.observe(documentObject.documentElement, {
                childList: true,
                subtree: true
            });
        }

        function applyConfiguration(nextConfiguration) {
            if (!hasCompleteConfiguration(nextConfiguration)) {
                reportError("Kiosk restrictions configuration is incomplete.");
                return;
            }

            disconnectObserver();
            restoreMarkedElements();
            configuration = nextConfiguration;

            if (!configuration.kioskRestrictionsEnabled) return;

            const matchingSelectors = getMatchingSelectors();
            applyMatchingSelectors(matchingSelectors);
            observeMatchingSelectors(matchingSelectors);
        }

        function onStorageChanged(changes, areaName) {
            if (!running || areaName !== "local" || !configuration) return;

            const changedConfiguration = { ...configuration };
            let hasEffectiveChange = false;

            for (const key of EFFECTIVE_CONFIGURATION_KEYS) {
                const change = changes[key];
                if (change && Object.prototype.hasOwnProperty.call(change, "newValue")) {
                    changedConfiguration[key] = change.newValue;
                    hasEffectiveChange = true;
                }
            }

            if (hasEffectiveChange) applyConfiguration(changedConfiguration);
        }

        async function start() {
            let loadedConfiguration;
            try {
                loadedConfiguration = await loadConfiguration();
            } catch (error) {
                reportError("Unable to load kiosk restrictions configuration.", error);
                return;
            }

            if (!hasCompleteConfiguration(loadedConfiguration)) {
                reportError("Kiosk restrictions configuration is incomplete.");
                return;
            }

            running = true;
            applyConfiguration(loadedConfiguration);
            if (!storageListenerRegistered) {
                addStorageListener(onStorageChanged);
                storageListenerRegistered = true;
            }
        }

        function stop() {
            running = false;
            disconnectObserver();
            restoreMarkedElements();
        }

        return { start, applyConfiguration, stop };
    }

    const api = { createKioskRestrictionsController };
    if (typeof module !== "undefined" && module.exports) module.exports = api;

    if (
        typeof browser !== "undefined" &&
        typeof document !== "undefined" &&
        typeof window !== "undefined" &&
        typeof MutationObserver !== "undefined"
    ) {
        const controller = createKioskRestrictionsController({
            documentObject: document,
            pageUrl: window.location.href,
            createObserver: (callback) => new MutationObserver(callback),
            async loadConfiguration() {
                const response = await browser.runtime.sendMessage({ type: "get-effective-config" });
                if (!response || response.ok !== true) {
                    throw new Error("The background script did not provide effective configuration.");
                }
                return response.config;
            },
            addStorageListener(listener) {
                browser.storage.onChanged.addListener(listener);
            },
            logError(message, error) {
                console.error(message, error);
            }
        });
        controller.start();
    }
})();
