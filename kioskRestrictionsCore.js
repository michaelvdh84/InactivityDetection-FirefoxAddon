(function () {
    "use strict";

    const MAX_RULES = 50;
    const MAX_HOSTNAMES = 10;
    const MAX_PATH_PREFIXES = 20;
    const MAX_SELECTORS = 100;
    const MAX_ID_LENGTH = 64;
    const MAX_HOSTNAME_LENGTH = 253;
    const MAX_PATH_LENGTH = 2048;
    const MAX_SELECTOR_LENGTH = 512;

    const fasSelectors = [
        "header", "#header", ".header", ".navbar", ".csam-header",
        "[role='banner']", "footer", "#footer", ".footer",
        ".csam-footer-container", ".csam-footer-content-container",
        "[role='contentinfo']", "video", ".video-preview-btn",
        "iframe[src*='youtube.com' i]", "iframe[src*='youtube-nocookie.com' i]",
        "iframe[src*='youtu.be' i]", "iframe[src*='vimeo.com' i]",
        "a[href*='sma-help.bosa.belgium.be' i]", "[id*='video' i]",
        "[class*='video' i]"
    ];
    const ibzSelectors = ["header.header", "#superfish-main", "#sidebar-first", ".footer-top", ".region-footer-bottom"];
    const DEFAULT_KIOSK_RESTRICTIONS = Object.freeze([
        Object.freeze({ id: "fas-login", enabled: true,
            hostnames: Object.freeze(["idp.iamfas.belgium.be", "idp.iamfas.int.belgium.be"]),
            pathPrefixes: Object.freeze(["/fas/XUI/"]), selectors: Object.freeze(fasSelectors) }),
        Object.freeze({ id: "ibz-pin-puk", enabled: true,
            hostnames: Object.freeze(["www.ibz.rrn.fgov.be"]),
            pathPrefixes: Object.freeze(["/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"]),
            selectors: Object.freeze(ibzSelectors) })
    ]);

    function validateSelectorSyntax(selector) {
        if (typeof document !== "undefined") document.querySelector(selector);
    }

    function fail(index, field, message) {
        throw new Error(`Invalid kiosk rule ${index} field ${field}: ${message}`);
    }

    function normalizePath(path) { return path.length > 1 ? path.replace(/\/+$/, "") : path; }

    function validateKioskRestrictions(value, selectorValidator) {
        if (!Array.isArray(value)) throw new Error("Invalid kiosk rules: rules must be an array");
        if (!value.length || value.length > MAX_RULES) throw new Error("Invalid kiosk rules field rules: invalid number of rules");
        const validateSelector = selectorValidator || validateSelectorSyntax;
        const ids = new Set();
        return value.map((rule, index) => {
            if (!rule || typeof rule !== "object" || Array.isArray(rule)) fail(index, "rule", "must be an object");
            if (typeof rule.id !== "string" || !rule.id || rule.id.length > MAX_ID_LENGTH) fail(index, "id", "invalid identifier");
            if (ids.has(rule.id)) fail(index, "id", "duplicate identifier");
            ids.add(rule.id);
            if (typeof rule.enabled !== "boolean") fail(index, "enabled", "must be boolean");
            if (!Array.isArray(rule.hostnames) || !rule.hostnames.length || rule.hostnames.length > MAX_HOSTNAMES) fail(index, "hostnames", "invalid list");
            if (!Array.isArray(rule.pathPrefixes) || !rule.pathPrefixes.length || rule.pathPrefixes.length > MAX_PATH_PREFIXES) fail(index, "pathPrefixes", "invalid list");
            if (!Array.isArray(rule.selectors) || !rule.selectors.length || rule.selectors.length > MAX_SELECTORS) fail(index, "selectors", "invalid list");
            const hostnames = rule.hostnames.map((host) => {
                if (typeof host !== "string" || host.length > MAX_HOSTNAME_LENGTH || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) fail(index, "hostnames", "invalid hostname");
                return host.toLowerCase();
            });
            const pathPrefixes = rule.pathPrefixes.map((path) => {
                if (typeof path !== "string" || path.length > MAX_PATH_LENGTH || !path.startsWith("/")) fail(index, "pathPrefixes", "invalid path");
                return normalizePath(path);
            });
            const selectors = rule.selectors.map((selector) => {
                if (typeof selector !== "string" || !selector || selector.length > MAX_SELECTOR_LENGTH) fail(index, "selectors", "invalid selector");
                try { validateSelector(selector); } catch (error) { fail(index, "selectors", "invalid selector syntax"); }
                return selector;
            });
            return { id: rule.id, enabled: rule.enabled, hostnames, pathPrefixes, selectors };
        });
    }

    function matchesKioskRule(rule, pageUrl) {
        if (!rule || rule.enabled !== true) return false;
        let url;
        try { url = new URL(pageUrl); } catch (error) { return false; }
        if (url.protocol !== "https:") return false;
        if (!rule.hostnames.some((host) => String(host).toLowerCase() === url.hostname.toLowerCase())) return false;
        const path = normalizePath(url.pathname).toLowerCase();
        return rule.pathPrefixes.some((prefix) => {
            const normalized = normalizePath(String(prefix)).toLowerCase();
            return path === normalized || path.startsWith(`${normalized}/`);
        });
    }

    function getMatchingKioskSelectors(rules, pageUrl) {
        const result = [];
        for (const rule of rules || []) if (matchesKioskRule(rule, pageUrl)) for (const selector of rule.selectors || []) result.push({ ruleId: rule.id, selector });
        return result;
    }

    const api = Object.freeze({ DEFAULT_KIOSK_RESTRICTIONS, getMatchingKioskSelectors, matchesKioskRule, validateKioskRestrictions });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else globalThis.InactivityKioskRestrictionsCore = api;
})();
