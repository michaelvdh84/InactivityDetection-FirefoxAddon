const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../csamLanguageCore.js");

for (const [locale, language] of [["fr-BE", "fr"], ["nl-BE", "nl"], ["en-US", "en"]]) {
    test("detects official MyBxl locale " + locale, () => {
        assert.equal(core.getPortalLanguage("https://www.mybxl.be/" + locale + "/account?language=de#en-US"), language);
        assert.equal(core.getPortalLanguage("https://www.mybxl.be/" + locale.toLowerCase() + "/"), language);
    });
}

test("ignores translations, other hosts, query locales and unsupported languages", () => {
    for (const url of ["https://www-mybxl-be.translate.goog/fr-BE/", "http://www.mybxl.be/fr-BE/",
        "https://www.mybxl.be.evil/fr-BE/", "https://mybxl.be/fr-BE/", "https://www.mybxl.be/de-DE/",
        "https://www.mybxl.be/path?redirect=fr-BE", "https://www.mybxl.be/fr-BE-extra/", "invalid"]) {
        assert.equal(core.getPortalLanguage(url), null);
    }
});

test("restricts CSAM DOM access to the production HTTPS XUI path", () => {
    assert.equal(core.isCsamPage("https://idp.iamfas.belgium.be/fas/XUI/?ignored=value#view"), true);
    for (const url of ["https://idp.iamfas.belgium.be/fas/XUI-extra/", "https://idp.iamfas.belgium.be/fas/oauth2/authorize",
        "http://idp.iamfas.belgium.be/fas/XUI/", "https://idp.iamfas.belgium.be.evil/fas/XUI/",
        "https://idp.iamfas.int.belgium.be/fas/XUI/"]) assert.equal(core.isCsamPage(url), false);
});

test("requires one matching language control and one active code", () => {
    const element = (text, active) => ({ textContent: text, classList: { contains: () => active } });
    const fr = element("fr", true), nl = element("nl", false), en = element("en", false);
    const documentObject = { querySelectorAll(selector) {
        assert.equal(selector, '.language-bar .language-list a[role="button"]');
        return [fr, nl, en];
    } };
    assert.deepEqual(core.findLanguageControl(documentObject, "nl"), { target: nl, currentLanguage: "fr" });
    assert.equal(core.findLanguageControl(documentObject, "de"), null);
    assert.equal(core.findLanguageControl({ querySelectorAll: () => [fr, nl, nl] }, "nl"), null);
    assert.equal(core.findLanguageControl({ querySelectorAll: () => [nl] }, "nl"), null);
});

test("addresses passed to queued navigation work discard queries and fragments", () => {
    assert.equal(core.getPageAddress("https://idp.iamfas.belgium.be/fas/XUI/?ignored=value#view"),
        "https://idp.iamfas.belgium.be/fas/XUI/");
    assert.equal(core.getPageAddress("invalid"), null);
});
