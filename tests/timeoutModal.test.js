const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "timeoutModal.js"), "utf8");
const START_URL = "https://portal.example/fr-BE/start/";
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ url = START_URL, phoneForm = false, configPromise, action = "close firefox", closeFails = false } = {}) {
    const config = { modalAfter: 2, popupLife: 3, redirectUrl: START_URL };
    for (const suffix of ["FR", "NL", "EN"]) {
        config[`title${suffix}`] = "Inactivity";
        config[`txt${suffix}`] = "Continue?";
        config[`btnContinue${suffix}`] = "Continue";
        config[`btnQuit${suffix}`] = "Quit";
    }
    const intervals = new Map(), timeouts = new Map(), listeners = new Map(), messages = [];
    let nextId = 0;
    let closeCalls = 0;
    function element(tag) {
        return {
            tag, children: [], listeners: {}, textContent: "",
            setAttribute() {},
            appendChild(child) { this.children.push(child); child.parent = this; },
            remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
            addEventListener(event, handler) { this.listeners[event] = handler; },
            set innerHTML(value) { this.value = value; }
        };
    }
    const body = element("body");
    function find(predicate, node = body) {
        if (predicate(node)) return node;
        for (const child of node.children) { const match = find(predicate, child); if (match) return match; }
        return null;
    }
    const context = vm.createContext({
        URL, URLSearchParams, console: { log() {} },
        window: {
            location: new URL(url), addEventListener(event, handler) { listeners.set(event, handler); },
            top: { close() { closeCalls++; if (closeFails) throw new Error("Close failed"); } }
        },
        document: {
            URL: url, body, createElement: element, querySelector() { return null; },
            getElementById(id) { return id === "phoneForm" && phoneForm ? {} : find((node) => node.id === id); }
        },
        browser: {
            runtime: { async sendMessage(message) {
                messages.push(message);
                return message.type === "get-effective-config" ? { ok: true, config: configPromise ? await configPromise : config } : { ok: true, action };
            } },
            storage: { local: { async set() {}, async get() { return config; } }, onChanged: { addListener() {} } }
        },
        setInterval(callback) { const id = ++nextId; intervals.set(id, callback); return id; },
        clearInterval(id) { intervals.delete(id); },
        setTimeout(callback, delay) { const id = ++nextId; timeouts.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timeouts.delete(id); }
    });
    vm.runInContext(source, context, { filename: "timeoutModal.js" });
    return {
        config, intervals, timeouts, listeners, messages, body,
        get closeCalls() { return closeCalls; },
        tick() { for (const callback of [...intervals.values()]) callback(); },
        modal: () => find((node) => node.id === "modalJS"),
        continue() { find((node) => node.id === "continuerTimeout").listeners.click(); },
        quit() { find((node) => node.className === "buttonTimeOut button-timeout-quit").onclick(); },
        expire() { for (const [id, timeout] of [...timeouts]) { timeouts.delete(id); timeout.callback(); } }
    };
}

for (const url of [START_URL, `${START_URL}?source=kiosk#top`, START_URL.slice(0, -1), "https://portal.example/fr-BE/other"]) {
    test(`inactivity starts and shows one modal on ${url}`, async () => {
        const f = fixture({ url });
        await settle();
        assert.equal(f.intervals.size, 1);
        assert.equal(f.listeners.size, 9);
        f.tick(); f.tick(); f.tick();
        assert.ok(f.modal());
        assert.equal(f.body.children.length, 1);
        assert.equal(f.timeouts.size, 1);
        assert.equal([...f.timeouts.values()][0].delay, 3000);
    });
}

test("start page waits for resolved configuration before starting detection", async () => {
    let release;
    const configPromise = new Promise((resolve) => { release = resolve; });
    const f = fixture({ configPromise });
    assert.equal(f.intervals.size, 0);
    assert.equal(f.listeners.size, 0);
    release(f.config);
    await settle();
    assert.equal(f.intervals.size, 1);
});

test("start page activity postpones the modal and Continue cancels expiry and restarts detection", async () => {
    const f = fixture();
    await settle();
    for (const event of ["mousemove", "touchstart", "click", "keydown"]) {
        f.tick();
        f.listeners.get(event)({ isTrusted: true });
        assert.equal(f.intervals.size, 1);
        assert.equal(f.modal(), null);
    }
    f.tick(); f.tick();
    f.continue();
    assert.equal(f.modal(), null);
    assert.equal(f.timeouts.size, 0);
    assert.equal(f.intervals.size, 1);
    f.expire();
    assert.equal(f.closeCalls, 0);
    assert.equal(f.messages.filter((message) => message.type === "reset-session").length, 0);
    f.tick(); f.tick();
    assert.ok(f.modal());
});

for (const trigger of ["quit", "expire"]) {
    test(`start page ${trigger} requests the configured session end once`, async () => {
        const f = fixture();
        await settle();
        f.tick(); f.tick();
        f[trigger](); f.expire();
        await settle();
        assert.equal(f.messages.filter((message) => message.type === "reset-session").length, 1);
        assert.equal(f.intervals.size, 0);
        assert.equal(f.closeCalls, 1);
    });
}

for (const url of [
    "https://idp.iamfas.belgium.be/fas/oauth2/authorize",
    "https://idp.iamfas.int.belgium.be/fas/oauth2/authorize",
    "https://merchant.itsme.be/confirmation"
]) {
    test(`authentication timer exception remains on ${url}`, async () => {
        const f = fixture({ url });
        await settle();
        assert.equal(f.intervals.size, 0);
        assert.equal(f.listeners.size, 0);
    });
}

test("itsme phone form still starts detection", async () => {
    const f = fixture({ url: "https://merchant.itsme.be/confirmation", phoneForm: true });
    await settle();
    assert.equal(f.intervals.size, 1);
});

for (const host of ["idp.iamfas.belgium.be", "idp.iamfas.int.belgium.be"]) {
    test(`exact refused URL on ${host} immediately requests session end`, async () => {
        const f = fixture({ url: `https://${host}/fasui/itsme/refused` });
        await settle();
        assert.equal(f.intervals.size, 0);
        assert.equal(f.messages.filter((message) => message.type === "reset-session").length, 1);
        assert.equal(f.closeCalls, 1);
    });
}

test("deconnexion does not call window.top.close", async () => {
    const f = fixture({ action: "deconnexion" });
    await settle();
    f.tick(); f.tick(); f.quit();
    await settle();
    assert.equal(f.closeCalls, 0);
    assert.equal(f.messages.filter((message) => message.type === "reset-session").length, 1);
});

test("a thrown close error is handled and allows a retry", async () => {
    const f = fixture({ closeFails: true });
    await settle();
    f.tick(); f.tick(); f.quit();
    await settle();
    assert.equal(f.closeCalls, 1);
    f.quit();
    await settle();
    assert.equal(f.closeCalls, 2);
});
