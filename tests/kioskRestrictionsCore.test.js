const assert = require("node:assert/strict");
const test = require("node:test");

let core = {};
try { core = require("../kioskRestrictionsCore.js"); } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
}

const validRule = {
    id: "ibz-pin-puk", enabled: true,
    hostnames: ["www.ibz.rrn.fgov.be"],
    pathPrefixes: ["/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"],
    selectors: ["header.header"]
};
const validateSelector = (selector) => { if (selector === "[invalid") throw new Error("invalid"); };

test("matches an exact host and a bounded path prefix", () => {
    assert.equal(typeof core.matchesKioskRule, "function");
    assert.equal(core.matchesKioskRule(validRule, "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin?source=kiosk#form"), true);
    assert.equal(core.matchesKioskRule(validRule, "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin-extra"), false);
    assert.equal(core.matchesKioskRule(validRule, "https://www.ibz.rrn.fgov.be.example/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"), false);
});

test("matches FAS hosts case-insensitively and requires HTTPS", () => {
    const rule = { ...validRule, hostnames: ["idp.iamfas.belgium.be", "idp.iamfas.int.belgium.be"], pathPrefixes: ["/fas/XUI/"] };
    assert.equal(core.matchesKioskRule(rule, "https://IDP.IAMFAS.BELGIUM.BE/fas/xui/login"), true);
    assert.equal(core.matchesKioskRule(rule, "http://idp.iamfas.belgium.be/fas/XUI/"), false);
    assert.equal(core.matchesKioskRule({ ...rule, enabled: false }, "https://idp.iamfas.belgium.be/fas/XUI/"), false);
});

test("returns false for malformed page URLs", () => {
    assert.equal(core.matchesKioskRule(validRule, "not a URL"), false);
    assert.equal(core.matchesKioskRule(validRule, "https://"), false);
    assert.equal(core.matchesKioskRule(validRule, "javascript:alert(1)"), false);
});

test("validates and normalizes rules", () => {
    const result = core.validateKioskRestrictions([{ ...validRule, hostnames: ["WWW.IBZ.RRN.FGOV.BE"], pathPrefixes: ["/foo///"] }], validateSelector);
    assert.deepEqual(result, [{ ...validRule, hostnames: ["www.ibz.rrn.fgov.be"], pathPrefixes: ["/foo"] }]);
    assert.notEqual(result[0], validRule);
});

test("rejects malformed rules with rule and field names", () => {
    const cases = [
        [[], "rules"], [{ ...validRule, id: "" }, "id"], [{ ...validRule, enabled: "true" }, "enabled"],
        [{ ...validRule, hostnames: [] }, "hostnames"], [{ ...validRule, hostnames: ["*.example.com"] }, "hostnames"],
        [{ ...validRule, hostnames: ["https://example.com/path"] }, "hostnames"], [{ ...validRule, pathPrefixes: ["foo"] }, "pathPrefixes"],
        [{ ...validRule, selectors: [] }, "selectors"], [{ ...validRule, selectors: ["[invalid"] }, "selectors"]
    ];
    for (const [value, field] of cases) assert.throws(() => core.validateKioskRestrictions(Array.isArray(value) ? value : [value], validateSelector), new RegExp(field));
    assert.throws(() => core.validateKioskRestrictions([validRule, validRule], validateSelector), /duplicate.*id/i);
});

test("returns selectors only for enabled matching rules", () => {
    const rules = core.validateKioskRestrictions([validRule, { ...validRule, id: "off", enabled: false, selectors: ["footer"] }], validateSelector);
    assert.deepEqual(core.getMatchingKioskSelectors(rules, "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"), [{ ruleId: "ibz-pin-puk", selector: "header.header" }]);
});

test("rejects configured array and string size limits", () => {
    const tooMany = (n) => Array.from({ length: n }, (_, i) => `x${i}.example.com`);
    assert.throws(() => core.validateKioskRestrictions(Array.from({ length: 51 }, (_, i) => ({ ...validRule, id: `r${i}` })), validateSelector), /rules/);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, hostnames: tooMany(11) }], validateSelector), /hostnames/);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, pathPrefixes: Array(21).fill("/x") }], validateSelector), /pathPrefixes/);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, selectors: Array(101).fill("div") }], validateSelector), /selectors/);
});

test("accepts each declared string limit and rejects the next character", () => {
    const idAtLimit = "i".repeat(64);
    assert.equal(core.validateKioskRestrictions([{ ...validRule, id: idAtLimit }], validateSelector)[0].id, idAtLimit);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, id: `${idAtLimit}x` }], validateSelector), /id/);

    const label = "a".repeat(63);
    const hostnameAtLimit = `${label}.${label}.${label}.${"a".repeat(61)}`;
    assert.equal(hostnameAtLimit.length, 253);
    assert.equal(core.validateKioskRestrictions([{ ...validRule, hostnames: [hostnameAtLimit] }], validateSelector)[0].hostnames[0], hostnameAtLimit);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, hostnames: [`${hostnameAtLimit}a`] }], validateSelector), /hostnames/);

    const pathAtLimit = `/${"p".repeat(2047)}`;
    assert.equal(pathAtLimit.length, 2048);
    assert.equal(core.validateKioskRestrictions([{ ...validRule, pathPrefixes: [pathAtLimit] }], validateSelector)[0].pathPrefixes[0], pathAtLimit);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, pathPrefixes: [`${pathAtLimit}p`] }], validateSelector), /pathPrefixes/);

    const selectorAtLimit = "x".repeat(512);
    assert.equal(core.validateKioskRestrictions([{ ...validRule, selectors: [selectorAtLimit] }], validateSelector)[0].selectors[0], selectorAtLimit);
    assert.throws(() => core.validateKioskRestrictions([{ ...validRule, selectors: [`${selectorAtLimit}x`] }], validateSelector), /selectors/);
});
