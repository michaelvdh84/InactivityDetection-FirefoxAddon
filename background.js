const RESET_SESSION_MESSAGE = "reset-session";
const DEFAULT_REDIRECT_URL = "about:blank";
const RESET_PAGE_URL = browser.runtime.getURL("reset.html");

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

    return resetSession(tabId);
});

async function resetSession(tabId) {
    if (resetsInProgress.has(tabId)) {
        return { ok: true, alreadyInProgress: true };
    }

    resetsInProgress.add(tabId);

    try {
        const { redirectUrl } = await browser.storage.local.get("redirectUrl");
        const targetUrl = normalizeRedirectUrl(redirectUrl);

        // Leave the current site before clearing its data so it cannot recreate
        // cookies or storage while cleanup is running.
        const resetPageLoaded = waitForTabToLoad(tabId, RESET_PAGE_URL);
        await browser.tabs.update(tabId, { url: RESET_PAGE_URL });
        await resetPageLoaded;

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

function waitForTabToLoad(tabId, expectedUrl) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out while loading the reset page."));
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
                tab.url === expectedUrl
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
    });
}
