const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "kioskRestrictionsCore.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

function fixture({ action, cleanupFails = false, logoutFails = false } = {}) {
    let onMessage;
    const saved = { redirectUrl: "https://portal.example/" };
    if (action !== undefined) saved.sessionEndAction = action;
    const operations = [], updated = new Set(), removed = new Set(), timers = new Set();
    const event = (listeners) => ({
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); }
    });
    const browser = {
        runtime: {
            getURL: (file) => `moz-extension://test/${file}`,
            onMessage: { addListener(listener) { onMessage = listener; } },
            onInstalled: { addListener() {} }, onStartup: { addListener() {} }
        },
        storage: {
            local: {
                async get(keys) { return Object.fromEntries(keys.filter((key) => key in saved).map((key) => [key, saved[key]])); },
                async set(values) { Object.assign(saved, values); }
            },
            managed: { async get() { return {}; } }
        },
        tabs: {
            onUpdated: event(updated), onRemoved: event(removed),
            async update(tabId, { url }) {
                operations.push(url);
                if (logoutFails && url === "https://portal.example/logout") throw new Error("Logout unavailable");
                for (const listener of [...updated]) listener(tabId, { status: "complete" }, { url });
            }
        },
        browsingData: {
            async remove(options, types) {
                operations.push("cleanup");
                assert.deepEqual(Object.keys(options), []);
                assert.deepEqual(Object.keys(types).sort(), ["cache", "cookies", "downloads", "formData", "history", "indexedDB", "localStorage", "serviceWorkers"].sort());
                if (cleanupFails) throw new Error("Cleanup unavailable");
            }
        }
    };
    const context = vm.createContext({
        browser, URL, console: { warn() {}, error() {} },
        document: { querySelector() { return null; } },
        setTimeout(callback, delay) { const id = setTimeout(callback, delay); timers.add(id); return id; },
        clearTimeout(id) { timers.delete(id); clearTimeout(id); }
    });
    vm.runInContext(coreSource, context);
    vm.runInContext(backgroundSource, context);
    return {
        operations, saved, updated, removed, timers,
        end(tabId = 7, logoutUrl = "https://portal.example/logout") {
            return onMessage({ type: "reset-session", logoutUrl }, {
                tab: { id: tabId }, url: "https://portal.example/fr-BE/account"
            });
        },
        invalidSender() { return onMessage({ type: "reset-session" }, {}); }
    };
}

for (const action of [undefined, "close firefox"]) {
    test(`session end ${action ?? "by default"} delegates closing to the content script without reset or navigation`, async () => {
        const f = fixture({ action });
        const result = await f.end();
        assert.equal(result.ok, true);
        assert.equal(result.action, "close firefox");
        assert.deepEqual(f.operations, []);
        assert.equal(f.saved.redirectUrl, "https://portal.example/");
    });
}

test("requests from different tabs each receive the configured close action", async () => {
    const f = fixture();
    const results = await Promise.all([f.end(7), f.end(8)]);
    assert.ok(results.every((result) => result.ok && result.action === "close firefox"));
    assert.deepEqual(f.operations, []);
});

test("deconnexion retains logout, neutral page, cleanup, redirect order and settings", async () => {
    const f = fixture({ action: "deconnexion" });
    const result = await f.end();
    assert.equal(result.ok, true);
    assert.equal(result.action, undefined);
    assert.deepEqual(f.operations, ["https://portal.example/logout", "moz-extension://test/reset.html", "cleanup", "https://portal.example/"]);
    assert.equal(f.saved.sessionEndAction, "deconnexion");
    assert.equal(f.updated.size + f.removed.size + f.timers.size, 0);
});

test("failed logout still performs local cleanup", async () => {
    const f = fixture({ action: "deconnexion", logoutFails: true });
    assert.equal((await f.end()).ok, true);
    assert.deepEqual(f.operations, ["https://portal.example/logout", "moz-extension://test/reset.html", "cleanup", "https://portal.example/"]);
    assert.equal(f.updated.size + f.removed.size + f.timers.size, 0);
});

test("failed cleanup leaves the neutral page and never redirects or closes Firefox", async () => {
    const f = fixture({ action: "deconnexion", cleanupFails: true });
    assert.equal((await f.end()).ok, false);
    assert.deepEqual(f.operations, ["https://portal.example/logout", "moz-extension://test/reset.html", "cleanup"]);
});

test("deconnexion rejects cross-origin logout and duplicate requests from the same tab", async () => {
    const f = fixture({ action: "deconnexion" });
    const first = f.end(7, "https://other.example/logout");
    assert.equal((await f.end(7)).alreadyInProgress, true);
    assert.equal((await first).ok, true);
    assert.deepEqual(f.operations, ["moz-extension://test/reset.html", "cleanup", "https://portal.example/"]);
});

test("a session end request without a source tab cannot close Firefox", async () => {
    const f = fixture();
    assert.equal((await f.invalidSender()).ok, false);
    assert.deepEqual(f.operations, []);
});
