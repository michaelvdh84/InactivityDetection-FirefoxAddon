const assert = require("node:assert/strict");
const test = require("node:test");

const {
    createKioskRestrictionsController
} = require("../kioskUiRestrictions.js");

const FAS_URL = "https://idp.iamfas.belgium.be/fas/XUI/";
const IBZ_URL = "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin";

const FAS_RULE = {
    id: "fas-login",
    enabled: true,
    hostnames: ["idp.iamfas.belgium.be"],
    pathPrefixes: ["/fas/XUI/"],
    selectors: ["header", "footer", "a[href*='sma-help.bosa.belgium.be' i]"]
};

const IBZ_RULE = {
    id: "ibz-pin-puk",
    enabled: true,
    hostnames: ["www.ibz.rrn.fgov.be"],
    pathPrefixes: ["/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"],
    selectors: ["header.header", "#superfish-main", "#sidebar-first", ".footer-top", ".region-footer-bottom"]
};

function configuration({ enabled = true, rules = [FAS_RULE, IBZ_RULE] } = {}) {
    return { kioskRestrictionsEnabled: enabled, kioskRestrictions: rules };
}

function createElement() {
    const attributes = new Map();
    return {
        getAttribute(name) { return attributes.get(name) ?? null; },
        hasAttribute(name) { return attributes.has(name); },
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); }
    };
}

function createDocument(matches = {}, runtimeFailures = []) {
    const elementsBySelector = new Map(
        Object.entries(matches).map(([selector, elements]) => [selector, [...elements]])
    );
    const failures = new Set(runtimeFailures);
    const documentObject = {
        documentElement: {},
        add(selector, element) {
            const elements = elementsBySelector.get(selector) || [];
            elements.push(element);
            elementsBySelector.set(selector, elements);
        },
        querySelectorAll(selector) {
            if (selector === '[data-inactivity-plugin-hidden="true"]') {
                return [...elementsBySelector.values()]
                    .flat()
                    .filter((element, index, elements) =>
                        elements.indexOf(element) === index &&
                        element.getAttribute("data-inactivity-plugin-hidden") === "true"
                    );
            }
            if (failures.has(selector)) throw new SyntaxError(`Invalid selector: ${selector}`);
            return elementsBySelector.get(selector) || [];
        }
    };
    return documentObject;
}

function createObserverFactory() {
    const observer = {
        callback: null,
        observeCalls: 0,
        disconnectCalls: 0,
        observe() { this.observeCalls += 1; },
        disconnect() { this.disconnectCalls += 1; }
    };
    return {
        observer,
        createObserver(callback) {
            observer.callback = callback;
            return observer;
        }
    };
}

function createController({ pageUrl, documentObject, config = configuration(), logError = () => {} }) {
    const observerFactory = createObserverFactory();
    let storageListener;
    const controller = createKioskRestrictionsController({
        documentObject,
        pageUrl,
        createObserver: observerFactory.createObserver,
        loadConfiguration: async () => config,
        addStorageListener(listener) { storageListener = listener; },
        logError
    });
    return { controller, observer: observerFactory.observer, storageListener: (...args) => storageListener(...args) };
}

test("applies only enabled matching rules", async () => {
    const fasHeader = createElement();
    const authenticationButton = createElement();
    const documentObject = createDocument({ header: [fasHeader], "#login": [authenticationButton] });
    const { controller } = createController({ pageUrl: FAS_URL, documentObject });

    await controller.start();

    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(authenticationButton.hasAttribute("data-inactivity-plugin-hidden"), false);
});

test("disabling the global switch restores marked elements and disconnects the observer", async () => {
    const fasHeader = createElement();
    const documentObject = createDocument({ header: [fasHeader] });
    const { controller, observer, storageListener } = createController({ pageUrl: FAS_URL, documentObject });

    await controller.start();
    storageListener({ kioskRestrictionsEnabled: { newValue: false } }, "local");

    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(observer.disconnectCalls, 1);

    storageListener({ kioskRestrictionsEnabled: { newValue: true } }, "local");

    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(observer.observeCalls, 2);
});

test("dynamic IBZ navigation is hidden by the single observer", async () => {
    const ibzForm = createElement();
    const sidebar = createElement();
    const documentObject = createDocument({ "#pin-form": [ibzForm] });
    const { controller, observer } = createController({ pageUrl: IBZ_URL, documentObject });

    await controller.start();
    documentObject.add("#sidebar-first", sidebar);
    observer.callback([{ addedNodes: [sidebar] }]);

    assert.equal(sidebar.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(ibzForm.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(observer.observeCalls, 1);
});

test("does not apply a disabled individual rule", async () => {
    const ibzHeader = createElement();
    const documentObject = createDocument({ "header.header": [ibzHeader] });
    const { controller, observer } = createController({
        pageUrl: IBZ_URL,
        documentObject,
        config: configuration({ rules: [{ ...IBZ_RULE, enabled: false }] })
    });

    await controller.start();

    assert.equal(ibzHeader.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(observer.observeCalls, 0);
});

test("does not alter a non-matching URL", async () => {
    const fasHeader = createElement();
    const documentObject = createDocument({ header: [fasHeader] });
    const { controller, observer } = createController({
        pageUrl: "https://idp.iamfas.belgium.be/fas/oauth2/authorize",
        documentObject
    });

    await controller.start();

    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(observer.observeCalls, 0);
});

test("continues applying selectors after a runtime selector failure", async () => {
    const footer = createElement();
    const documentObject = createDocument({ footer: [footer] }, ["header"]);
    const errors = [];
    const { controller } = createController({
        pageUrl: FAS_URL,
        documentObject,
        logError(...args) { errors.push(args); }
    });

    await controller.start();

    assert.equal(footer.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /fas-login.*header/);
});

test("configuration changes replace rather than duplicate the observer", async () => {
    const fasHeader = createElement();
    const documentObject = createDocument({ header: [fasHeader] });
    const { controller, observer } = createController({ pageUrl: FAS_URL, documentObject });

    await controller.start();
    controller.applyConfiguration(configuration());
    controller.applyConfiguration(configuration());

    assert.equal(observer.observeCalls, 3);
    assert.equal(observer.disconnectCalls, 2);
});

test("stop restores only elements marked by the extension", async () => {
    const extensionMarked = createElement();
    const hostMarked = createElement();
    hostMarked.setAttribute("aria-hidden", "true");
    const documentObject = createDocument({ header: [extensionMarked], ".host": [hostMarked] });
    const { controller, observer } = createController({ pageUrl: FAS_URL, documentObject });

    await controller.start();
    controller.stop();

    assert.equal(extensionMarked.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(hostMarked.getAttribute("aria-hidden"), "true");
    assert.equal(observer.disconnectCalls, 1);
});
