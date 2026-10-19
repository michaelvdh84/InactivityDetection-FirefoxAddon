const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
const resetUrl = "moz-extension://test/reset.html";
const portalUrl = "https://portal.example/fr-BE/context-selection/";
const logoutUrl = "https://portal.example/fr-BE/Account/Login/LogOff";
const targetUrl = "https://portal.example/start/";

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createFixture({ bulkCleanup, privateCleanup, failLogout = false } = {}) {
    let listener;
    const updates = new Set();
    const removals = new Set();
    const events = [];
    const local = { redirectUrl: targetUrl, localOverrides: { titleFR: "Saved setting" } };
    const cookies = { normal: ["normal-session"], private: ["portal-session", "idp-session"] };
    let currentUrl = portalUrl;
    const browser = {
        runtime: {
            getURL: (file) => `moz-extension://test/${file}`,
            onMessage: { addListener(callback) { listener = callback; } },
            onInstalled: { addListener() {} },
            onStartup: { addListener() {} }
        },
        storage: { local: { async get(key) { return { [key]: local[key] }; } } },
        tabs: {
            onUpdated: {
                addListener(callback) { updates.add(callback); },
                removeListener(callback) { updates.delete(callback); }
            },
            onRemoved: {
                addListener(callback) { removals.add(callback); },
                removeListener(callback) { removals.delete(callback); }
            },
            async update(id, { url }) {
                events.push({ type: "navigate", url });
                if (url === logoutUrl) {
                    assert.equal(cookies.private.length, 2, "logout must retain authentication cookies");
                    if (failLogout) throw new Error("Logout unavailable");
                }
                currentUrl = url;
                queueMicrotask(() => {
                    for (const callback of updates) callback(id, { status: "complete" }, { url });
                });
                return { id, url };
            }
        },
        browsingData: {
            async remove(options, data) {
                assert.equal(currentUrl, resetUrl, "website data must be cleared from the neutral page");
                events.push({ type: "bulk-cleanup", options: { ...options }, data: { ...data } });
                if (bulkCleanup) await bulkCleanup();
                // Model Firefox's empty-options path: private cookies survive.
                cookies.normal.length = 0;
            },
            async removeCookies(options) {
                assert.equal(currentUrl, resetUrl);
                events.push({ type: "private-cookies", options: { ...options } });
                if (privateCleanup) await privateCleanup();
                if (options.cookieStoreId === "firefox-private") cookies.private.length = 0;
            }
        }
    };
    const context = vm.createContext({
        browser, URL, setTimeout, clearTimeout,
        console: { warn() {}, error() {} },
        InactivityKioskRestrictionsCore: { DEFAULT_KIOSK_RESTRICTIONS: [] }
    });
    vm.runInContext(source, context, { filename: "background.js" });
    return {
        events, cookies, local,
        currentUrl: () => currentUrl,
        listenerCount: () => updates.size + removals.size,
        reset: (url = logoutUrl, sender = { tab: { id: 1 }, url: portalUrl }) =>
            listener({ type: "reset-session", logoutUrl: url }, sender)
    };
}

async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
}

test("reset signs out before clearing normal and private cookies and preserves extension settings", async () => {
    const fixture = createFixture();
    assert.equal((await fixture.reset()).ok, true);
    assert.deepEqual(fixture.events.map((event) => event.type), [
        "navigate", "navigate", "bulk-cleanup", "private-cookies", "navigate"
    ]);
    assert.deepEqual(fixture.events.filter((event) => event.type === "navigate").map((event) => event.url), [
        logoutUrl, resetUrl, targetUrl
    ]);
    assert.deepEqual(fixture.cookies, { normal: [], private: [] });
    assert.deepEqual(fixture.events[2].options, {});
    assert.deepEqual(fixture.events[2].data, {
        cache: true, cookies: true, downloads: true, formData: true,
        history: true, indexedDB: true, localStorage: true, serviceWorkers: true
    });
    assert.deepEqual(fixture.events[3].options, { cookieStoreId: "firefox-private" });
    assert.deepEqual(fixture.local.localOverrides, { titleFR: "Saved setting" });
    assert.equal(fixture.listenerCount(), 0);
});

test("the portal cannot reopen until both cleanup operations finish", async () => {
    const bulk = deferred();
    const privateCookies = deferred();
    const fixture = createFixture({
        bulkCleanup: () => bulk.promise,
        privateCleanup: () => privateCookies.promise
    });
    const result = fixture.reset();
    await flush();
    assert.equal(fixture.currentUrl(), resetUrl);
    assert.equal(fixture.events.at(-1).type, "bulk-cleanup");
    bulk.resolve();
    await flush();
    assert.equal(fixture.currentUrl(), resetUrl);
    assert.equal(fixture.events.at(-1).type, "private-cookies");
    privateCookies.resolve();
    assert.equal((await result).ok, true);
    assert.equal(fixture.currentUrl(), targetUrl);
});

test("private cookie cleanup failure leaves the tab on the neutral page and allows retry", async () => {
    let shouldFail = true;
    const fixture = createFixture({ privateCleanup() {
        if (shouldFail) throw new Error("Private cleanup failed");
    } });
    const result = await fixture.reset();
    assert.equal(result.ok, false);
    assert.match(result.error, /Private cleanup failed/);
    assert.equal(fixture.currentUrl(), resetUrl);
    assert.equal(fixture.cookies.private.length, 2);
    assert.equal(fixture.listenerCount(), 0);
    shouldFail = false;
    assert.equal((await fixture.reset(null)).ok, true);
    assert.equal(fixture.cookies.private.length, 0);
});

test("bulk cleanup failure also keeps the portal closed", async () => {
    const fixture = createFixture({ bulkCleanup() { throw new Error("Cleanup failed"); } });
    assert.equal((await fixture.reset()).ok, false);
    assert.equal(fixture.currentUrl(), resetUrl);
    assert.equal(fixture.events.some((event) => event.type === "private-cookies"), false);
});

test("remote logout failure does not prevent local and private cookie cleanup", async () => {
    const fixture = createFixture({ failLogout: true });
    assert.equal((await fixture.reset()).ok, true);
    assert.deepEqual(fixture.cookies, { normal: [], private: [] });
    assert.equal(fixture.currentUrl(), targetUrl);
    assert.equal(fixture.listenerCount(), 0);
});

test("duplicate reset requests in a tab share a single cleanup", async () => {
    const bulk = deferred();
    const fixture = createFixture({ bulkCleanup: () => bulk.promise });
    const first = fixture.reset();
    await flush();
    assert.equal((await fixture.reset()).alreadyInProgress, true);
    bulk.resolve();
    assert.equal((await first).ok, true);
    assert.equal(fixture.events.filter((event) => event.type === "bulk-cleanup").length, 1);
    assert.equal(fixture.events.filter((event) => event.type === "private-cookies").length, 1);
});

test("missing, cross-origin and non-HTTP logout URLs cannot navigate before neutral cleanup", async () => {
    for (const url of [null, "https://other.example/logout", "javascript:alert(1)"]) {
        const fixture = createFixture();
        assert.equal((await fixture.reset(url)).ok, true);
        assert.equal(fixture.events[0].url, resetUrl);
        assert.deepEqual(fixture.cookies, { normal: [], private: [] });
    }
});

test("a reset without a source tab cannot clear any browser data", async () => {
    const fixture = createFixture();
    assert.equal((await fixture.reset(logoutUrl, {})).ok, false);
    assert.equal(fixture.events.length, 0);
});
