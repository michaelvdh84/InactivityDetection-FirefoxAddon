const assert = require("node:assert/strict");
const test = require("node:test");

let fasKioskUi = {};

try {
    fasKioskUi = require("../fasKioskUi.js");
} catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") {
        throw error;
    }
}

test("recognizes only the production and integration FAS XUI pages", () => {
    assert.equal(typeof fasKioskUi.isFasKioskPage, "function");
    assert.equal(
        fasKioskUi.isFasKioskPage(
            "https://idp.iamfas.belgium.be/fas/XUI/?realm=citizen#login"
        ),
        true
    );
    assert.equal(
        fasKioskUi.isFasKioskPage(
            "https://idp.iamfas.int.belgium.be/fas/xui/"
        ),
        true
    );
    assert.equal(
        fasKioskUi.isFasKioskPage(
            "https://idp.iamfas.belgium.be/fas/oauth2/authorize"
        ),
        false
    );
    assert.equal(
        fasKioskUi.isFasKioskPage(
            "https://idp.iamfas.belgium.be.example/fas/XUI/"
        ),
        false
    );
});

test("hides kiosk chrome and help controls without hiding authentication", () => {
    const header = createElement();
    const footer = createElement();
    const video = createElement();
    const videoFrame = createElement();
    const frenchHelp = createElement({ text: "Besoin d’aide ?" });
    const dutchHelp = createElement({ ariaLabel: "Hulp nodig?" });
    const englishHelp = createElement({ title: "Need help?" });
    const login = createElement({ text: "Log in with itsme" });
    const documentObject = createDocument(
        [header, footer, video, videoFrame],
        [frenchHelp, dutchHelp, englishHelp, login]
    );

    const hiddenCount = fasKioskUi.applyFasKioskRestrictions(
        documentObject,
        "https://idp.iamfas.belgium.be/fas/XUI/"
    );

    assert.equal(hiddenCount, 7);
    for (const element of [
        header,
        footer,
        video,
        videoFrame,
        frenchHelp,
        dutchHelp,
        englishHelp
    ]) {
        assert.equal(element.attributes["data-inactivity-plugin-hidden"], "true");
        assert.equal(element.attributes["aria-hidden"], "true");
    }
    assert.equal(login.attributes["data-inactivity-plugin-hidden"], undefined);
});

test("does not alter documents outside the FAS XUI pages", () => {
    const header = createElement();
    const help = createElement({ text: "Besoin d’aide ?" });
    const documentObject = createDocument([header], [help]);

    const hiddenCount = fasKioskUi.applyFasKioskRestrictions(
        documentObject,
        "https://www.mybxl.be/fr-BE/"
    );

    assert.equal(hiddenCount, 0);
    assert.deepEqual(header.attributes, {});
    assert.deepEqual(help.attributes, {});
});

test("hides the current FAS navbar and footer containers", () => {
    const navbar = createElement();
    const fasHeader = createElement();
    const fasFooterContainer = createElement();
    const fasFooter = createElement();
    const localizedHelpLink = createElement({ text: "Centro assistenza" });
    const documentObject = {
        querySelectorAll(selector) {
            if (selector === "a,button,[role='link']") {
                return [];
            }

            const selectors = selector.split(",");
            const matches = [];
            if (selectors.includes(".navbar")) {
                matches.push(navbar);
            }
            if (selectors.includes(".csam-header")) {
                matches.push(fasHeader);
            }
            if (selectors.includes(".csam-footer-container")) {
                matches.push(fasFooterContainer);
            }
            if (selectors.includes(".csam-footer-content-container")) {
                matches.push(fasFooter);
            }
            if (
                selectors.includes(
                    "a[href*='sma-help.bosa.belgium.be' i]"
                )
            ) {
                matches.push(localizedHelpLink);
            }
            return matches;
        }
    };

    const hiddenCount = fasKioskUi.applyFasKioskRestrictions(
        documentObject,
        "https://idp.iamfas.belgium.be/fas/XUI/"
    );

    assert.equal(hiddenCount, 5);
    assert.equal(navbar.attributes["data-inactivity-plugin-hidden"], "true");
    assert.equal(fasHeader.attributes["data-inactivity-plugin-hidden"], "true");
    assert.equal(
        fasFooterContainer.attributes["data-inactivity-plugin-hidden"],
        "true"
    );
    assert.equal(fasFooter.attributes["data-inactivity-plugin-hidden"], "true");
    assert.equal(
        localizedHelpLink.attributes["data-inactivity-plugin-hidden"],
        "true"
    );
});

test("reapplies restrictions when FAS adds content dynamically", () => {
    const dynamicHelp = createElement({ text: "Besoin d'aide" });
    const interactiveElements = [];
    const documentObject = createDocument([], interactiveElements);
    let observerCallback;
    const observer = {
        observe() {},
        disconnect() {}
    };

    const result = fasKioskUi.activateFasKioskRestrictions(
        documentObject,
        "https://idp.iamfas.belgium.be/fas/XUI/",
        (callback) => {
            observerCallback = callback;
            return observer;
        }
    );

    interactiveElements.push(dynamicHelp);
    observerCallback();

    assert.equal(result, observer);
    assert.equal(
        dynamicHelp.attributes["data-inactivity-plugin-hidden"],
        "true"
    );
});

function createElement({ text = "", ariaLabel = "", title = "" } = {}) {
    return {
        textContent: text,
        attributes: {},
        getAttribute(name) {
            if (name === "aria-label") {
                return ariaLabel;
            }
            if (name === "title") {
                return title;
            }
            return this.attributes[name] ?? null;
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
    };
}

function createDocument(blockedElements, interactiveElements) {
    let queryNumber = 0;

    return {
        documentElement: {},
        querySelectorAll() {
            queryNumber += 1;
            return queryNumber % 2 === 1
                ? blockedElements
                : interactiveElements;
        }
    };
}
