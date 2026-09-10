const RESET_SESSION_MESSAGE = "reset-session";
const GET_EFFECTIVE_CONFIG_MESSAGE = "get-effective-config";
const SAVE_LOCAL_OVERRIDES_MESSAGE = "save-local-overrides";
const CLEAR_LOCAL_OVERRIDES_MESSAGE = "clear-local-overrides";
const DEFAULT_REDIRECT_URL = "about:blank";
const RESET_PAGE_URL = browser.runtime.getURL("reset.html");

// These defaults are the final fallback when neither managed configuration nor
// previously saved local values are available.
const DEFAULT_CONFIGURATION = {
    modalAfter: 60,
    popupLife: 30,
    redirectUrl: DEFAULT_REDIRECT_URL,
    titleFR: "Inactivité détectée",
    txtFR: "Vous n'avez plus interagi avec la borne depuis un certain temps.\nSouhaitez-vous continuer à l'utiliser ?",
    btnContinueFR: "Oui, continuer ma session",
    btnQuitFR: "Non, quitter",
    titleNL: "Inactiviteit gedetecteerd",
    txtNL: "U hebt de kiosk al enige tijd niet meer gebruikt.\nWilt u deze blijven gebruiken?",
    btnContinueNL: "Ja, mijn sessie voortzetten",
    btnQuitNL: "Nee, afsluiten",
    titleEN: "Inactivity detected",
    txtEN: "You have not interacted with the kiosk for some time.\nWould you like to continue using it?",
    btnContinueEN: "Yes, continue my session",
    btnQuitEN: "No, exit",
    hostname: "",
    ip: ""
};

const CONFIG_TEXT_LIMITS = {
    titleFR: 500,
    txtFR: 2000,
    btnContinueFR: 200,
    btnQuitFR: 200,
    titleNL: 500,
    txtNL: 2000,
    btnContinueNL: 200,
    btnQuitNL: 200,
    titleEN: 500,
    txtEN: 2000,
    btnContinueEN: 200,
    btnQuitEN: 200,
    hostname: 255,
    ip: 255
};

const EDITABLE_CONFIG_KEYS = [
    "modalAfter",
    "popupLife",
    "redirectUrl",
    "titleFR",
    "txtFR",
    "btnContinueFR",
    "btnQuitFR",
    "titleNL",
    "txtNL",
    "btnContinueNL",
    "btnQuitNL",
    "titleEN",
    "txtEN",
    "btnContinueEN",
    "btnQuitEN"
];

const CONFIG_KEYS = [...EDITABLE_CONFIG_KEYS, "hostname", "ip"];

const WEB_DATA_TO_REMOVE = {
    cache: true,
    cookies: true,
    downloads: true,
    formData: true,
    history: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true
};

const resetsInProgress = new Set();
let startupManagedRefreshPromise = null;

browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === GET_EFFECTIVE_CONFIG_MESSAGE) {
        return getEffectiveConfiguration();
    }

    if (message?.type === SAVE_LOCAL_OVERRIDES_MESSAGE) {
        return saveLocalOverrides(message.config);
    }

    if (message?.type === CLEAR_LOCAL_OVERRIDES_MESSAGE) {
        return clearLocalOverrides();
    }

    if (message?.type !== RESET_SESSION_MESSAGE) {
        return undefined;
    }

    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) {
        return Promise.resolve({
            ok: false,
            error: "The reset request does not belong to a browser tab."
        });
    }

    return resetSession(tabId, message.logoutUrl, sender.url);
});

browser.runtime.onInstalled.addListener(() => {
    ensureStartupManagedRefresh();
});

browser.runtime.onStartup.addListener(() => {
    ensureStartupManagedRefresh();
});

function ensureStartupManagedRefresh() {
    if (!startupManagedRefreshPromise) {
        startupManagedRefreshPromise = refreshEffectiveConfiguration();
    }

    return startupManagedRefreshPromise;
}

async function getEffectiveConfiguration() {
    // Resolve again for every new page or popup. This avoids retaining a
    // startup fallback if Managed Storage became available after the first
    // background wake-up (a common situation while debugging the extension).
    startupManagedRefreshPromise = refreshEffectiveConfiguration();
    return startupManagedRefreshPromise;
}

async function refreshEffectiveConfiguration() {
    const stored = await browser.storage.local.get([...CONFIG_KEYS, "localOverrides"]);
    const managed = await readManagedConfiguration();

    // Top-level local keys are retained as the fallback for existing installs.
    // When a valid managed manifest exists it becomes the base configuration.
    const storedFallback = readStoredFallback(stored);
    const localOverrides = readStoredLocalOverrides(stored.localOverrides);
    const baseConfiguration = managed.available
        ? managed.config
        : storedFallback;
    const useLocalOverrides = !managed.available || managed.allowLocalOverrides;
    const effectiveConfig = validateCompleteConfiguration({
        ...baseConfiguration,
        ...(useLocalOverrides ? localOverrides : {})
    });
    const localOverridesActive =
        useLocalOverrides && Object.keys(localOverrides).length > 0;
    const localOverridesPresent = Object.keys(localOverrides).length > 0;

    // Existing consumers read these top-level keys. Persisting only the
    // resolved values keeps timer and reset code simple while localOverrides
    // remains the distinct, user-controlled layer.
    await browser.storage.local.set({
        ...effectiveConfig,
        managedStorageAvailable: managed.available,
        managedStorageAllowsLocalOverrides: managed.allowLocalOverrides,
        managedStorageLoadedAt: managed.available ? new Date().toISOString() : ""
    });

    return {
        ok: true,
        config: effectiveConfig,
        managedAvailable: managed.available,
        managedError: managed.error,
        allowLocalOverrides: managed.allowLocalOverrides,
        localOverridesActive,
        localOverridesPresent
    };
}

async function readManagedConfiguration() {
    try {
        const source = await browser.storage.managed.get(null);
        if (!isPlainObject(source) || Object.keys(source).length === 0) {
            return managedConfigurationUnavailable();
        }

        let allowLocalOverrides = true;
        if ("allowLocalOverrides" in source) {
            if (typeof source.allowLocalOverrides !== "boolean") {
                throw new Error('Managed key "allowLocalOverrides" must be a boolean.');
            }
            allowLocalOverrides = source.allowLocalOverrides;
        }

        return {
            available: true,
            config: validateCompleteConfiguration(source),
            allowLocalOverrides,
            error: null
        };
    } catch (error) {
        // A missing manifest and a malformed manifest both fall back safely to
        // local settings. No managed value is ever partially applied.
        console.warn("Managed configuration unavailable:", error);
        return managedConfigurationUnavailable(error);
    }
}

function managedConfigurationUnavailable(error = null) {
    return {
        available: false,
        config: null,
        allowLocalOverrides: true,
        error: error ? (error.message || String(error)) : null
    };
}

async function saveLocalOverrides(source) {
    const overrides = validateEditableConfiguration(source);
    const managed = await readManagedConfiguration();

    if (managed.available && !managed.allowLocalOverrides) {
        throw new Error("Local changes are disabled by the managed configuration.");
    }

    await browser.storage.local.set({ localOverrides: overrides });
    return refreshEffectiveConfiguration();
}

async function clearLocalOverrides() {
    await browser.storage.local.remove("localOverrides");
    return refreshEffectiveConfiguration();
}

function validateCompleteConfiguration(source) {
    const config = {
        ...validateEditableConfiguration(source),
        hostname: requireString(source.hostname, "hostname", CONFIG_TEXT_LIMITS.hostname),
        ip: requireString(source.ip, "ip", CONFIG_TEXT_LIMITS.ip)
    };

    return config;
}

function validateEditableConfiguration(source) {
    if (!isPlainObject(source)) {
        throw new Error("Configuration must be a JSON object.");
    }

    const config = {
        modalAfter: requirePositiveNumber(source.modalAfter, "modalAfter"),
        popupLife: requirePositiveNumber(source.popupLife, "popupLife"),
        redirectUrl: requireRedirectUrl(source.redirectUrl)
    };

    for (const [key, maxLength] of Object.entries(CONFIG_TEXT_LIMITS)) {
        if (key === "hostname" || key === "ip") {
            continue;
        }
        config[key] = requireString(source[key], key, maxLength);
    }

    return config;
}

function readStoredLocalOverrides(value) {
    if (value === undefined) {
        return {};
    }

    try {
        return validateEditableConfiguration(value);
    } catch (error) {
        console.warn("Ignoring invalid local overrides:", error);
        return {};
    }
}

function readStoredFallback(stored) {
    try {
        return validateCompleteConfiguration({
            ...DEFAULT_CONFIGURATION,
            ...pickKnownConfiguration(stored)
        });
    } catch (error) {
        console.warn("Stored configuration is invalid; using defaults:", error);
        return { ...DEFAULT_CONFIGURATION };
    }
}

function pickKnownConfiguration(source) {
    const picked = {};
    for (const key of CONFIG_KEYS) {
        if (key in source) {
            picked[key] = source[key];
        }
    }
    return picked;
}

function requirePositiveNumber(value, key) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`Configuration key "${key}" must be a positive number.`);
    }
    return number;
}

function requireRedirectUrl(value) {
    const normalized = normalizeRedirectUrl(value);
    if (normalized === DEFAULT_REDIRECT_URL && String(value ?? "").trim() !== DEFAULT_REDIRECT_URL) {
        throw new Error('Configuration key "redirectUrl" must be about:blank or an absolute HTTP(S) URL.');
    }
    return normalized;
}

function requireString(value, key, maxLength) {
    if (typeof value !== "string" || value.length > maxLength) {
        throw new Error(`Configuration key "${key}" must be a string of at most ${maxLength} characters.`);
    }
    return value;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function resetSession(tabId, requestedLogoutUrl, sourceUrl) {
    if (resetsInProgress.has(tabId)) {
        return { ok: true, alreadyInProgress: true };
    }

    resetsInProgress.add(tabId);

    try {
        const { redirectUrl } = await browser.storage.local.get("redirectUrl");
        const targetUrl = normalizeRedirectUrl(redirectUrl);
        const logoutUrl = normalizeLogoutUrl(requestedLogoutUrl, sourceUrl);

        if (logoutUrl) {
            try {
                // Dynamics Power Pages must receive its logout request while
                // authentication cookies are still available so it can
                // invalidate the server-side session.
                await navigateAndWait(tabId, logoutUrl);
            } catch (error) {
                // Continue with local cleanup even if the remote logout page is
                // unavailable. The final redirect remains guarded by cleanup.
                console.warn("Portal logout request failed:", error);
            }
        }

        // Leave the current site before clearing its data so it cannot recreate
        // cookies or storage while cleanup is running.
        await navigateAndWait(tabId, RESET_PAGE_URL, RESET_PAGE_URL);

        // originTypes is intentionally omitted: Firefox then removes normal web
        // data without deleting this extension's own stored configuration.
        await browser.browsingData.remove({}, WEB_DATA_TO_REMOVE);
        await browser.tabs.update(tabId, { url: targetUrl });

        return { ok: true };
    } catch (error) {
        console.error("Session reset failed:", error);
        return { ok: false, error: String(error) };
    } finally {
        resetsInProgress.delete(tabId);
    }
}

function normalizeRedirectUrl(value) {
    const candidate = String(value ?? "").trim();

    if (!candidate || candidate === DEFAULT_REDIRECT_URL) {
        return DEFAULT_REDIRECT_URL;
    }

    try {
        const parsedUrl = new URL(candidate);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
            return parsedUrl.href;
        }
    } catch (error) {
        console.error("Invalid redirect URL:", error);
    }

    console.warn("Using about:blank because the configured redirect URL is invalid.");
    return DEFAULT_REDIRECT_URL;
}

function normalizeLogoutUrl(value, sourceUrl) {
    if (!value || !sourceUrl) {
        return null;
    }

    try {
        const logoutUrl = new URL(String(value));
        const source = new URL(String(sourceUrl));

        if (
            (logoutUrl.protocol === "http:" || logoutUrl.protocol === "https:") &&
            logoutUrl.origin === source.origin
        ) {
            return logoutUrl.href;
        }
    } catch (error) {
        console.error("Invalid portal logout URL:", error);
    }

    console.warn("Ignoring a logout URL that is invalid or not same-origin.");
    return null;
}

function navigateAndWait(tabId, url, expectedUrl = null) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out while loading ${url}.`));
        }, 10000);

        function cleanup() {
            clearTimeout(timeoutId);
            browser.tabs.onUpdated.removeListener(onUpdated);
            browser.tabs.onRemoved.removeListener(onRemoved);
        }

        function onUpdated(updatedTabId, changeInfo, tab) {
            if (
                updatedTabId === tabId &&
                changeInfo.status === "complete" &&
                (!expectedUrl || tab.url === expectedUrl)
            ) {
                cleanup();
                resolve();
            }
        }

        function onRemoved(removedTabId) {
            if (removedTabId === tabId) {
                cleanup();
                reject(new Error("The tab was closed during session reset."));
            }
        }

        browser.tabs.onUpdated.addListener(onUpdated);
        browser.tabs.onRemoved.addListener(onRemoved);

        browser.tabs.update(tabId, { url }).catch((error) => {
            cleanup();
            reject(error);
        });
    });
}
