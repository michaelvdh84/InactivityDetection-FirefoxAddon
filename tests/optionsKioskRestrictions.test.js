const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "popup", "options.js"), "utf8");
const fieldIds = [
    "modalAfter", "popupLife", "redirectUrl", "titleFR", "txtFR",
    "btnContinueFR", "btnQuitFR", "titleNL", "txtNL", "btnContinueNL",
    "btnQuitNL", "titleEN", "txtEN", "btnContinueEN", "btnQuitEN",
    "hostname", "ip", "kioskRestrictionsEnabled", "kioskRestrictionsSummary",
    "extTimeoutOptionbtn", "unlockConfigBtn", "useManagedValuesBtn",
    "managedConfigStatus"
];

const managedRules = [
    {
        id: "fas-login", enabled: true,
        hostnames: ["idp.iamfas.belgium.be"], pathPrefixes: ["/fas/XUI/"] ,
        selectors: ["header"]
    },
    {
        id: "ibz-pin-puk", enabled: false,
        hostnames: ["www.ibz.rrn.fgov.be"], pathPrefixes: ["/fr/citoyen"],
        selectors: ["footer"]
    }
];

function createElement() {
    const element = {
        value: "", checked: false, disabled: false, textContent: "", className: "",
        children: [], listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        appendChild(child) { this.children.push(child); this.textContent += child.textContent; },
        replaceChildren(...children) { this.children = []; this.textContent = ""; children.forEach((child) => this.appendChild(child)); },
        focus() {}
    };
    Object.defineProperty(element, "innerHTML", {
        set(value) { element.value = value; }
    });
    return element;
}

function createFixture({ allowLocalOverrides = true } = {}) {
    const elements = Object.fromEntries(fieldIds.map((id) => [id, createElement()]));
    let savedConfig;
    const managedConfig = {
        modalAfter: 60, popupLife: 30, redirectUrl: "about:blank",
        titleFR: "FR", txtFR: "FR", btnContinueFR: "Continue", btnQuitFR: "Quit",
        titleNL: "NL", txtNL: "NL", btnContinueNL: "Continue", btnQuitNL: "Quit",
        titleEN: "EN", txtEN: "EN", btnContinueEN: "Continue", btnQuitEN: "Quit",
        hostname: "", ip: "", kioskRestrictionsEnabled: true,
        kioskRestrictions: managedRules
    };
    let effectiveConfig = { ...managedConfig };
    const response = () => ({
        ok: true, config: effectiveConfig, managedAvailable: true,
        allowLocalOverrides, localOverridesActive: false, localOverridesPresent: false
    });
    const browser = {
        runtime: { async sendMessage(message) {
            if (message.type === "get-effective-config") return response();
            if (message.type === "save-local-overrides") {
                savedConfig = message.config;
                effectiveConfig = { ...effectiveConfig, ...message.config };
                return response();
            }
            if (message.type === "clear-local-overrides") {
                effectiveConfig = { ...managedConfig };
                return response();
            }
            throw new Error(`Unexpected message: ${message.type}`);
        } },
        storage: { local: { async get() { return {}; } } }
    };
    const document = {
        getElementById(id) { return elements[id] || null; },
        createElement() { return createElement(); }
    };
    const context = vm.createContext({ browser, document, console: { log() {}, error() {} }, URL, alert() {} });
    vm.runInContext(source, context, { filename: "popup/options.js" });
    return { elements, get savedConfig() { return savedConfig; } };
}

async function click(element) {
    await element.listeners.click();
}

function waitForInitialRender() {
    return new Promise((resolve) => setImmediate(resolve));
}

test("renders managed kiosk switch and rules, and saves only its editable boolean", async () => {
    const fixture = createFixture();
    await waitForInitialRender();
    const { elements } = fixture;

    assert.equal(elements.kioskRestrictionsEnabled.checked, true);
    assert.equal(elements.kioskRestrictionsEnabled.disabled, true);
    assert.match(elements.kioskRestrictionsSummary.textContent, /fas-login/);
    assert.match(elements.kioskRestrictionsSummary.textContent, /ibz-pin-puk/);

    await click(elements.unlockConfigBtn);
    elements.kioskRestrictionsEnabled.checked = false;
    await click(elements.extTimeoutOptionbtn);
    assert.equal(fixture.savedConfig.kioskRestrictionsEnabled, false);
    assert.equal(fixture.savedConfig.kioskRestrictions, undefined);
});

test("keeps the kiosk switch locked when managed configuration forbids overrides", async () => {
    const { elements } = createFixture({ allowLocalOverrides: false });
    await waitForInitialRender();
    await click(elements.unlockConfigBtn);
    assert.equal(elements.kioskRestrictionsEnabled.disabled, true);
});

test("using managed values rerenders the managed kiosk switch and rule summary", async () => {
    const { elements } = createFixture();
    await waitForInitialRender();
    await click(elements.unlockConfigBtn);
    elements.kioskRestrictionsEnabled.checked = false;
    await click(elements.extTimeoutOptionbtn);
    elements.kioskRestrictionsSummary.textContent = "stale";
    await click(elements.useManagedValuesBtn);
    assert.equal(elements.kioskRestrictionsEnabled.checked, true);
    assert.match(elements.kioskRestrictionsSummary.textContent, /fas-login/);
});
