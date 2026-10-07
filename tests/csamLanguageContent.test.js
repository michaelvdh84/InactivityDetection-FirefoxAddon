const assert = require("node:assert/strict");
const test = require("node:test");
const { createLanguageSynchronizer, WAIT_MS } = require("../csamLanguageContent.js");

function fixture({ language = "nl", current = "fr", missing = false, target = undefined, consume = undefined } = {}) {
    const listeners = new Set(), pagehide = new Set();
    const controls = ["fr", "nl", "de", "en"].map((text) => ({
        textContent: text, clicks: 0, classList: { contains: () => current === text },
        click() { this.clicks++; current = text; }
    }));
    let unavailable = missing, timer, mutations, timeoutCanceled = false, disconnects = 0;
    let consumes = 0, observerCreated = 0;
    const controller = createLanguageSynchronizer({
        documentObject: { querySelectorAll: () => unavailable ? [] : controls },
        pageUrl: () => "https://idp.iamfas.belgium.be/fas/XUI/",
        loadTarget: async () => target === undefined ? { language, token: "journey" } : target,
        consume: async (token) => { consumes++; assert.equal(token, "journey"); return consume ? consume() : { allowed: true }; },
        createObserver(callback) { observerCreated++; mutations = callback; return { observe() {}, disconnect() { disconnects++; } }; },
        addStorageListener: (listener) => listeners.add(listener),
        removeStorageListener: (listener) => listeners.delete(listener),
        addPageHideListener: (listener) => pagehide.add(listener),
        removePageHideListener: (listener) => pagehide.delete(listener),
        scheduleTimeout(callback, duration) { assert.equal(duration, WAIT_MS); timer = callback; return 1; },
        cancelTimeout() { timeoutCanceled = true; }
    });
    return { controller, controls, listeners, pagehide,
        snapshot: () => ({ consumes, observerCreated, timeoutCanceled, disconnects }),
        showControls() { unavailable = false; mutations(); },
        mutate() { mutations?.(); }, expire() { timer(); },
        manual(language) { current = language; },
        disable() { for (const listener of [...listeners]) listener({ csamLanguageSyncEnabled: { newValue: false } }, "local"); },
        hidePage() { for (const listener of [...pagehide]) listener(); }
    };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

for (const language of ["fr", "nl", "en"]) {
    test("clicks the existing CSAM control once for " + language, async () => {
        const f = fixture({ language, current: "de" });
        await f.controller.start();
        assert.equal(f.controls.find((control) => control.textContent === language).clicks, 1);
        assert.equal(f.snapshot().consumes, 1);
        f.manual("de"); f.mutate();
        await settle();
        assert.equal(f.snapshot().consumes, 1);
        assert.equal(f.listeners.size, 0);
        assert.equal(f.pagehide.size, 0);
        assert.equal(f.snapshot().timeoutCanceled, true);
    });
}

test("already correct language consumes the attempt without clicking", async () => {
    const f = fixture({ language: "fr", current: "fr" });
    await f.controller.start();
    assert.equal(f.snapshot().consumes, 1);
    assert.equal(f.controls.reduce((sum, control) => sum + control.clicks, 0), 0);
});

test("no known portal language creates no DOM observer and performs no action", async () => {
    const f = fixture({ target: null });
    await f.controller.start();
    assert.equal(f.snapshot().observerCreated, 0);
    assert.equal(f.snapshot().consumes, 0);
    assert.equal(f.listeners.size, 0);
});

test("waits for async controls and coalesces repeated mutations", async () => {
    const f = fixture({ missing: true });
    await f.controller.start();
    f.showControls(); f.mutate(); f.mutate();
    await settle();
    assert.equal(f.snapshot().consumes, 1);
    assert.equal(f.controls.find((c) => c.textContent === "nl").clicks, 1);
});

for (const stop of ["expire", "disable", "hidePage"]) {
    test(stop + " cleans up the observer and never clicks a late control", async () => {
        const f = fixture({ missing: true });
        await f.controller.start();
        f[stop](); f.showControls();
        await settle();
        assert.equal(f.snapshot().consumes, 0);
        assert.equal(f.snapshot().disconnects, 1);
        assert.equal(f.listeners.size, 0);
        assert.equal(f.pagehide.size, 0);
    });
}

test("disable while the claim is pending prevents the click", async () => {
    let reply;
    const f = fixture({ consume: () => new Promise((resolve) => { reply = resolve; }) });
    const pending = f.controller.start();
    await settle();
    f.disable(); reply({ allowed: true });
    await pending;
    assert.equal(f.controls.reduce((sum, control) => sum + control.clicks, 0), 0);
});

test("a refused claim leaves the page alone", async () => {
    const f = fixture({ consume: () => null });
    await f.controller.start();
    assert.equal(f.controls.reduce((sum, control) => sum + control.clicks, 0), 0);
});
