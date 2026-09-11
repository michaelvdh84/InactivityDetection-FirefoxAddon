const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "kioskRestrictionsCore.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

const completeEditableConfig = {
    modalAfter: 60, popupLife: 30, redirectUrl: "about:blank",
    titleFR: "FR", txtFR: "FR text", btnContinueFR: "Continue", btnQuitFR: "Quit",
    titleNL: "NL", txtNL: "NL text", btnContinueNL: "Continue", btnQuitNL: "Quit",
    titleEN: "EN", txtEN: "EN text", btnContinueEN: "Continue", btnQuitEN: "Quit"
};

const completeConfig = {
    ...completeEditableConfig,
    kioskRestrictionsEnabled: true,
    hostname: "", ip: ""
};

const managedRules = [{
    id: "managed-rule", enabled: true, hostnames: ["managed.example"],
    pathPrefixes: ["/kiosk"], selectors: [".managed"]
}];
const attackerRules = [{
    id: "attacker-rule", enabled: true, hostnames: ["attacker.example"],
    pathPrefixes: ["/"], selectors: [".attacker"]
}];
const storedFallbackRules = [{
    id: "stored-rule", enabled: true, hostnames: ["stored.example"],
    pathPrefixes: ["/fallback"], selectors: [".stored"]
}];

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function createFixture({ managed = {}, local = {} } = {}) {
    let messageListener;
    const saved = clone(local);
    const listeners = { addListener() {}, removeListener() {} };
    const storageArea = (values, writable) => ({
        async get(keys) {
            if (keys === null) return clone(values);
            if (typeof keys === "string") return { [keys]: clone(values[keys]) };
            return Object.fromEntries(keys.map((key) => [key, clone(values[key])]).filter(([, value]) => value !== undefined));
        },
        async set(valuesToSave) {
            if (!writable) throw new Error("managed storage is read-only");
            Object.assign(values, clone(valuesToSave));
        },
        async remove(key) { if (writable) delete values[key]; }
    });
    const browser = {
        runtime: {
            getURL: (file) => `moz-extension://test/${file}`,
            onMessage: { addListener(listener) { messageListener = listener; } },
            onInstalled: { addListener() {} }, onStartup: { addListener() {} }
        },
        storage: { local: storageArea(saved, true), managed: storageArea(managed, false) },
        tabs: { onUpdated: listeners, onRemoved: listeners, async update() {} },
        browsingData: { async remove() {} }
    };
    const context = vm.createContext({
        browser, console: { warn() {}, error() {} }, URL, setTimeout, clearTimeout,
        document: { querySelector(selector) {
            if (selector === "[") throw new SyntaxError("Invalid selector");
            return null;
        } }
    });
    vm.runInContext(coreSource, context, { filename: "kioskRestrictionsCore.js" });
    vm.runInContext(backgroundSource, context, { filename: "background.js" });
    return { saved, sendMessage: (message) => messageListener(message, {}) };
}

test("managed rules override defaults and the local switch overrides only the global flag", async () => {
    const { sendMessage } = createFixture({
        managed: { ...completeConfig, kioskRestrictions: managedRules, allowLocalOverrides: true },
        local: { localOverrides: { ...completeEditableConfig, kioskRestrictionsEnabled: false } }
    });
    const result = await sendMessage({ type: "get-effective-config" });
    assert.equal(result.config.kioskRestrictionsEnabled, false);
    assert.deepEqual(plain(result.config.kioskRestrictions), managedRules);
});

test("save-local-overrides cannot replace managed kiosk rules", async () => {
    const { saved, sendMessage } = createFixture({ managed: { ...completeConfig, kioskRestrictions: managedRules } });
    const result = await sendMessage({ type: "save-local-overrides", config: {
        ...completeEditableConfig, kioskRestrictionsEnabled: false, kioskRestrictions: attackerRules
    } });
    assert.deepEqual(plain(result.config.kioskRestrictions), managedRules);
    assert.equal(saved.localOverrides.kioskRestrictions, undefined);
});

test("an invalid managed rule preserves the complete stored fallback", async () => {
    const { sendMessage } = createFixture({
        managed: { ...completeConfig, kioskRestrictions: [{ ...managedRules[0], selectors: ["["] }] },
        local: { ...completeConfig, kioskRestrictions: storedFallbackRules }
    });
    const result = await sendMessage({ type: "get-effective-config" });
    assert.deepEqual(plain(result.config.kioskRestrictions), storedFallbackRules);
});

test("managed configuration can forbid local overrides", async () => {
    const { sendMessage } = createFixture({
        managed: { ...completeConfig, kioskRestrictions: managedRules, allowLocalOverrides: false },
        local: { localOverrides: { ...completeEditableConfig, kioskRestrictionsEnabled: false } }
    });
    const result = await sendMessage({ type: "get-effective-config" });
    assert.equal(result.config.kioskRestrictionsEnabled, true);
    await assert.rejects(sendMessage({ type: "save-local-overrides", config: { ...completeEditableConfig, kioskRestrictionsEnabled: false } }));
});

test("clearing overrides restores the managed global switch", async () => {
    const { saved, sendMessage } = createFixture({
        managed: { ...completeConfig, kioskRestrictions: managedRules },
        local: { localOverrides: { ...completeEditableConfig, kioskRestrictionsEnabled: false } }
    });
    const result = await sendMessage({ type: "clear-local-overrides" });
    assert.equal(saved.localOverrides, undefined);
    assert.equal(result.config.kioskRestrictionsEnabled, true);
});

test("first install uses independent copies of built-in FAS and IBZ rules", async () => {
    const { saved, sendMessage } = createFixture();
    const result = await sendMessage({ type: "get-effective-config" });
    assert.equal(result.config.kioskRestrictionsEnabled, true);
    assert.deepEqual(plain(result.config.kioskRestrictions.map((rule) => rule.id)), ["fas-login", "ibz-pin-puk"]);
    assert.notEqual(result.config.kioskRestrictions, saved.kioskRestrictions);
});
