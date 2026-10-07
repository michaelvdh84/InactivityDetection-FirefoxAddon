(function () {
    "use strict";

    const PORTAL_HOST = "www.mybxl.be";
    const CSAM_HOST = "idp.iamfas.belgium.be";
    const CONTROL_SELECTOR = '.language-bar .language-list a[role="button"]';
    const JOURNEY_LIFETIME_MS = 15 * 60 * 1000;

    function parseHttpsUrl(value) {
        try {
            // Discard authentication queries/fragments before parsing or retaining an address.
            const url = new URL(String(value).split(/[?#]/, 1)[0]);
            return url.protocol === "https:" ? url : null;
        } catch { return null; }
    }

    function getPageAddress(value) {
        const url = parseHttpsUrl(value);
        return url ? url.origin + url.pathname : null;
    }

    function getPortalLanguage(value) {
        const url = parseHttpsUrl(value);
        if (!url || url.hostname !== PORTAL_HOST) return null;
        // The official path is authoritative; translated DOM and query values are not.
        const locale = /^\/(fr-BE|nl-BE|en-US)(?:\/|$)/i.exec(url.pathname);
        return locale ? locale[1].slice(0, 2).toLowerCase() : null;
    }

    function isCsamPage(value) {
        const url = parseHttpsUrl(value);
        return Boolean(url && url.hostname === CSAM_HOST &&
            /^\/fas\/XUI(?:\/|$)/.test(url.pathname));
    }

    function findLanguageControl(documentObject, language) {
        if (!["fr", "nl", "en"].includes(language)) return null;
        const controls = [...documentObject.querySelectorAll(CONTROL_SELECTOR)];
        const code = (element) => element.textContent.trim().toLowerCase();
        const targets = controls.filter((element) => code(element) === language);
        const active = controls.filter((element) =>
            ["fr", "nl", "en", "de"].includes(code(element)) && element.classList.contains("active"));
        // An unknown or ambiguous selector state must never trigger a guessed click.
        if (targets.length !== 1 || active.length !== 1) return null;
        return { target: targets[0], currentLanguage: code(active[0]) };
    }

    const api = Object.freeze({ PORTAL_HOST, CSAM_HOST, CONTROL_SELECTOR,
        JOURNEY_LIFETIME_MS, getPageAddress, getPortalLanguage, isCsamPage, findLanguageControl });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else globalThis.InactivityCsamLanguageCore = api;
})();
