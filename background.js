const RESET_SESSION_MESSAGE = "reset-session";
const REFRESH_NATIVE_CONFIG_MESSAGE = "refresh-native-config";
const NATIVE_HOST_NAME = "be.brucity.inactivity_detection";
const DEFAULT_REDIRECT_URL = "about:blank";
const RESET_PAGE_URL = browser.runtime.getURL("reset.html");

const NATIVE_TEXT_LIMITS = {
    titleFR: 500,
    txtFR: 2000,
    titleNL: 500,
    txtNL: 2000,
    titleEN: 500,
    txtEN: 2000,
    hostname: 255,
    ip: 255
};

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

browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === REFRESH_NATIVE_CONFIG_MESSAGE) {
        return importNativeConfiguration();
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
    importNativeConfiguration().catch(logNativeImportError);
});

browser.runtime.onStartup.addListener(() => {
    importNativeConfiguration().catch(logNativeImportError);
});

async function importNativeConfiguration() {
    try {
        const response = await browser.runtime.sendNativeMessage(
            NATIVE_HOST_NAME,
            { type: "get-config" }
        );

        if (!response || response.ok !== true || !isPlainObject(response.config)) {
            throw new Error(response?.error || "The native host returned an invalid response.");
        }

        const config = validateNativeConfiguration(response.config);
        const importedAt = new Date().toISOString();
        await browser.storage.local.set({
            ...config,
            nativeConfigImportedAt: importedAt
        });

        return {
            ok: true,
            hostname: config.hostname,
            ip: config.ip,
            importedAt
        };
    } catch (error) {
        logNativeImportError(error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function validateNativeConfiguration(source) {
    const config = {
        modalAfter: requirePositiveNumber(source.modalAfter, "modalAfter"),
        popupLife: requirePositiveNumber(source.popupLife, "popupLife"),
        redirectUrl: requireRedirectUrl(source.redirectUrl)
    };

    for (const [key, maxLength] of Object.entries(NATIVE_TEXT_LIMITS)) {
        config[key] = requireString(source[key], key, maxLength);
    }

    return config;
}

function requirePositiveNumber(value, key) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`Native configuration key "${key}" must be a positive number.`);
    }
    return number;
}

function requireRedirectUrl(value) {
    const normalized = normalizeRedirectUrl(value);
    if (normalized === DEFAULT_REDIRECT_URL && String(value ?? "").trim() !== DEFAULT_REDIRECT_URL) {
        throw new Error('Native configuration key "redirectUrl" must be about:blank or an absolute HTTP(S) URL.');
    }
    return normalized;
}

function requireString(value, key, maxLength) {
    if (typeof value !== "string" || value.length > maxLength) {
        throw new Error(`Native configuration key "${key}" must be a string of at most ${maxLength} characters.`);
    }
    return value;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function logNativeImportError(error) {
    console.warn(`Native configuration import failed (${NATIVE_HOST_NAME}):`, error);
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
