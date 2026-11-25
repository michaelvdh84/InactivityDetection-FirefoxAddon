const assert = require("node:assert/strict");
const test = require("node:test");
const { createLanguageSyncBackground, STATE_PREFIX } = require("../csamLanguageBackground.js");
const CSAM = "https://idp.iamfas.belgium.be/fas/XUI/";
const portal = (language) => "https://www.mybxl.be/" + language + "/";

function event() {
    const listeners = new Set();
    return { listeners, addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); } };
}
function fixture({ enabled = true, state = {}, openTabs = [] } = {}) {
    const states = state, tabs = new Map(openTabs.map((tab) => [tab.id, tab]));
    let clock = 1000, token = 0, queries = 0;
    const injected = [];
    const browserObject = {
        storage: {
            session: {
                async get(key) { return structuredClone(key === null ? states : { [key]: states[key] }); },
                async set(values) { Object.assign(states, structuredClone(values)); },
                async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete states[key]; }
            }, onChanged: event()
        },
        tabs: { onUpdated: event(), onRemoved: event(),
            async query() { queries++; return [...tabs.values()]; },
            async get(id) { if (!tabs.has(id)) throw new Error("closed"); return tabs.get(id); } },
        runtime: { onMessage: event() },
        scripting: { async executeScript(details) { injected.push(details); } }
    };
    const make = () => createLanguageSyncBackground({ browserObject,
        loadConfiguration: async () => ({ config: { csamLanguageSyncEnabled: enabled } }),
        now: () => clock, createToken: () => "t" + (++token) });
    let controller = make();
    return { controller, states, injected, browserObject, tabs, queries: () => queries,
        advance() { clock += 16 * 60 * 1000; },
        make,
        async navigate(id, url, changed = true) {
            tabs.set(id, { id, url });
            await controller.onUpdated(id, changed ? { url } : { status: "complete" }, { id, url });
        },
        message(id, owner = "owner", type = "csam-language-target", token) {
            return controller.onMessage({ type, owner, token }, { frameId: 0, tab: { id }, url: CSAM });
        }
    };
}

for (const [locale, language] of [["fr-BE", "fr"], ["nl-BE", "nl"], ["en-US", "en"]]) {
    test("preserves " + language + " across B2C without injecting there", async () => {
        const f = fixture(); await f.controller.start();
        await f.navigate(1, portal(locale));
        await f.navigate(1, "https://example.b2clogin.com/path");
        assert.equal(f.injected.length, 0);
        await f.navigate(1, CSAM);
        assert.equal(f.injected.length, 1);
        const target = await f.message(1);
        assert.equal(target.language, language);
        assert.deepEqual(await f.message(1, "owner", "csam-language-consume", target.token), { allowed: true });
        await f.navigate(1, CSAM); await f.navigate(1, CSAM, false);
        assert.equal(f.injected.length, 1);
        assert.equal(await f.message(1), null);
    });
}

test("two tabs have independent languages and claims", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("fr-BE")); await f.navigate(2, portal("nl-BE"));
    await f.navigate(1, CSAM); await f.navigate(2, CSAM);
    const a = await f.message(1), b = await f.message(2);
    assert.equal(a.language, "fr"); assert.equal(b.language, "nl");
    assert.equal(await f.message(2, "owner", "csam-language-consume", a.token), null);
    assert.deepEqual(await f.message(1, "owner", "csam-language-consume", a.token), { allowed: true });
    assert.deepEqual(await f.message(2, "owner", "csam-language-consume", b.token), { allowed: true });
});

test("disabled feature leaves wake-up listeners inert, scans no tabs and injects nothing", async () => {
    const f = fixture({ enabled: false, openTabs: [{ id: 1, url: portal("fr-BE") }] });
    await f.controller.start();
    assert.equal(f.queries(), 0);
    assert.equal(f.browserObject.tabs.onUpdated.listeners.size, 1);
    assert.equal(f.browserObject.runtime.onMessage.listeners.size, 1);
    await f.controller.onUpdated(1, { get url() { throw new Error("disabled detection"); } }, {});
    await f.navigate(1, portal("fr-BE")); await f.navigate(1, CSAM);
    assert.deepEqual(f.states, {});
    assert.equal(f.injected.length, 0);
});

test("direct CSAM and expired journeys perform no injection", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, CSAM);
    assert.equal(f.injected.length, 0);
    await f.navigate(1, portal("en-US")); f.advance(); await f.navigate(1, CSAM);
    assert.equal(f.injected.length, 0);
});

test("reload cannot repeat an attempted sync even if no selector was found", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("nl-BE")); await f.navigate(1, CSAM); await f.navigate(1, CSAM);
    assert.equal(f.injected.length, 1);
    await f.navigate(1, portal("en-US")); await f.navigate(1, CSAM);
    assert.equal(f.injected.length, 2);
});

test("background restart preserves attempted state and prunes closed tabs", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("fr-BE")); await f.navigate(1, CSAM);
    f.states[STATE_PREFIX + 9] = { language: "nl" };
    const restarted = f.make(); await restarted.start();
    await restarted.onUpdated(1, { status: "complete" }, { url: CSAM });
    assert.equal(f.injected.length, 1);
    assert.equal(f.states[STATE_PREFIX + 9], undefined);
});

test("closing tabs, reset-session and disabling clear only feature state", async () => {
    const f = fixture(); await f.controller.start();
    f.states.otherFeature = "preserved";
    await f.navigate(1, portal("fr-BE")); await f.controller.onRemoved(1);
    assert.equal(f.states[STATE_PREFIX + 1], undefined);
    await f.navigate(1, portal("fr-BE"));
    assert.equal(f.controller.onMessage({ type: "reset-session" }, { tab: { id: 1 } }), undefined);
    await f.controller.onRemoved(1);
    assert.equal(f.states[STATE_PREFIX + 1], undefined);
    await f.navigate(2, portal("nl-BE")); await f.controller.setEnabled(false);
    assert.deepEqual(f.states, { otherFeature: "preserved" });
    assert.equal(f.browserObject.tabs.onUpdated.listeners.size, 1);
});

test("one owner and one concurrent claim are authorized", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("fr-BE")); await f.navigate(1, CSAM);
    const target = await f.message(1, "first");
    assert.equal(await f.message(1, "second"), null);
    const replies = await Promise.all([f.message(1, "first", "csam-language-consume", target.token),
        f.message(1, "first", "csam-language-consume", target.token)]);
    assert.equal(replies.filter((reply) => reply?.allowed).length, 1);
});

test("rejects subframes and a tab which has left CSAM", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("fr-BE")); await f.navigate(1, CSAM);
    assert.equal(await f.controller.onMessage({ type: "csam-language-target", owner: "a" },
        { tab: { id: 1 }, url: CSAM, frameId: 2 }), null);
    f.tabs.set(1, { id: 1, url: "https://example.org/" });
    assert.equal(await f.message(1), null);
});

test("registers event-page listeners synchronously before configuration resolves", async () => {
    const f = fixture({ enabled: false });
    const pending = f.controller.start();
    assert.equal(f.browserObject.tabs.onUpdated.listeners.size, 1);
    assert.equal(f.browserObject.runtime.onMessage.listeners.size, 1);
    await pending;
});


test("background restart resumes a pending journey on an already loaded CSAM page", async () => {
    const f = fixture(); await f.controller.start();
    await f.navigate(1, portal("nl-BE"));
    f.tabs.set(1, { id: 1, url: CSAM });
    const restarted = f.make(); await restarted.start();
    assert.equal(f.injected.length, 1);
    const target = await restarted.onMessage({ type: "csam-language-target", owner: "restart" },
        { tab: { id: 1 }, frameId: 0, url: CSAM });
    assert.equal(target.language, "nl");
});
