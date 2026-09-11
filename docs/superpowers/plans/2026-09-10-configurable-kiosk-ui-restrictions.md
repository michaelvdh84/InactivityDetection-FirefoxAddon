# Configurable Kiosk UI Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded FAS UI filter with validated Managed Storage rules, add the IBZ PIN/PUK restriction, and expose one locally overridable global switch.

**Architecture:** A dependency-free core module validates and matches administrator-owned rules. `background.js` incorporates those rules into the existing atomic configuration resolver, while a generic content-script controller applies and restores the matching DOM restrictions. The options page can override only the global switch and displays a read-only rule summary.

**Tech Stack:** Firefox Manifest V3 WebExtensions, plain JavaScript, DOM APIs, `browser.storage.managed`, `browser.storage.local`, Node's built-in `node:test` and `node:assert`.

**Spec:** `docs/superpowers/specs/2026-09-10-configurable-kiosk-ui-restrictions-design.md`

## Global Constraints

- Keep the project dependency-free: no package manager, bundler, transpiler, framework, or build step.
- Managed configuration remains atomic and allow-listed.
- `kioskRestrictions` is managed-only and must never be accepted from `localOverrides`.
- `kioskRestrictionsEnabled` is the only locally editable kiosk-filtering value.
- Match exact HTTPS hostnames and normalized path-prefix boundaries; ignore query parameters and fragments.
- Keep at most one DOM observer and restore only elements marked by this extension.
- Preserve FAS authentication controls and the IBZ PIN/PUK form.
- Do not bump `manifest.json` version unless a separate release request requires it.

---

## File structure

- Create `kioskRestrictionsCore.js`: rule defaults, schema validation,
  normalization, URL matching, and matching-selector resolution.
- Rename `fasKioskUi.js` to `kioskUiRestrictions.js`: browser content-script
  lifecycle, DOM hiding/restoration, observer lifecycle, and storage updates.
- Replace `tests/fasKioskUi.test.js` with
  `tests/kioskRestrictionsCore.test.js` and
  `tests/kioskUiRestrictions.test.js`.
- Create `tests/backgroundConfiguration.test.js`: VM-backed tests for managed,
  fallback, and local-override resolution in the real background script.
- Create `tests/optionsKioskRestrictions.test.js`: options-form behavior test
  with a minimal DOM and browser API fixture.
- Modify `background.js`: include the two new configuration keys and delegate
  rule validation to the core.
- Modify `manifest.json`: load the core in the background and load core plus
  controller before `timeoutModal.js` in pages.
- Modify `popup/options.html`, `popup/options.js`, and `popup/options.css`: add
  the global switch and managed rule summary.
- Modify `managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json`:
  deploy the FAS and IBZ rules.
- Modify `README.md`, `managedStorage.md`, `AGENTS.md`, and `SKILL.md`: document
  the generalized behavior, schema, operational boundaries, and checks.

---

### Task 1: Rule schema, defaults, and URL matching

**Files:**
- Create: `kioskRestrictionsCore.js`
- Create: `tests/kioskRestrictionsCore.test.js`

**Interfaces:**
- Produces: `globalThis.InactivityKioskRestrictionsCore` in Firefox and the
  same object through `module.exports` in Node.
- Produces: `DEFAULT_KIOSK_RESTRICTIONS`,
  `validateKioskRestrictions(value, validateSelector?)`,
  `matchesKioskRule(rule, pageUrl)`, and
  `getMatchingKioskSelectors(rules, pageUrl)`.
- `validateKioskRestrictions` returns a newly allocated normalized array and
  throws an `Error` naming the invalid rule and field.
- `getMatchingKioskSelectors` returns objects shaped as
  `{ ruleId: string, selector: string }` for enabled matching rules.

- [ ] **Step 1: Write failing schema and matching tests**

Create table-driven tests with literal expectations covering:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

let core = {};
try {
    core = require("../kioskRestrictionsCore.js");
} catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
}

test("matches an exact host and a bounded path prefix", () => {
    assert.equal(typeof core.matchesKioskRule, "function");
    const rule = {
        id: "ibz-pin-puk",
        enabled: true,
        hostnames: ["www.ibz.rrn.fgov.be"],
        pathPrefixes: [
            "/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"
        ],
        selectors: ["header.header"]
    };

    assert.equal(core.matchesKioskRule(
        rule,
        "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin?source=kiosk#form"
    ), true);
    assert.equal(core.matchesKioskRule(
        rule,
        "https://www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin-extra"
    ), false);
    assert.equal(core.matchesKioskRule(
        rule,
        "https://www.ibz.rrn.fgov.be.example/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"
    ), false);
});
```

Add separate cases for the production and integration FAS hosts, disabled
rules, malformed URLs, duplicate IDs, wildcard/URL-shaped hosts, paths without
`/`, empty arrays, non-boolean `enabled`, invalid selectors, and every declared
size limit. Inject `selector => document.querySelector(selector)` as the real
syntax validator shape; use a deterministic test validator that throws for
`"[invalid"`.

- [ ] **Step 2: Run the core test and verify the missing API failure**

Run:

```powershell
node --test tests/kioskRestrictionsCore.test.js
```

Expected: FAIL because `matchesKioskRule` and the core module do not exist.

- [ ] **Step 3: Implement the core module**

Use constants for the documented limits and freeze the two built-in rules.
The initial selector lists must include all current FAS selectors and these IBZ
selectors:

```javascript
const ibzSelectors = [
    "header.header",
    "#superfish-main",
    "#sidebar-first",
    ".footer-top",
    ".region-footer-bottom"
];
```

Normalize hostnames to lower case. Normalize path prefixes by removing trailing
slashes except for `/`. Match paths case-insensitively to preserve the current
FAS `/fas/XUI/` behavior, and require either an exact normalized path or a `/`
boundary after the prefix. Parse only HTTPS URLs.

Validate each selector using the supplied function or this browser default:

```javascript
function validateSelectorSyntax(selector) {
    document.querySelector(selector);
}
```

Expose one immutable API object:

```javascript
const api = Object.freeze({
    DEFAULT_KIOSK_RESTRICTIONS,
    getMatchingKioskSelectors,
    matchesKioskRule,
    validateKioskRestrictions
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
} else {
    globalThis.InactivityKioskRestrictionsCore = api;
}
```

- [ ] **Step 4: Run core tests and syntax validation**

Run:

```powershell
node --test tests/kioskRestrictionsCore.test.js
node --check kioskRestrictionsCore.js
```

Expected: all core tests PASS and both commands exit `0`.

- [ ] **Step 5: Commit the core**

```powershell
git add -- kioskRestrictionsCore.js tests/kioskRestrictionsCore.test.js
git commit -m "feat: add configurable kiosk restriction rules"
```

---

### Task 2: Managed configuration and override boundaries

**Files:**
- Modify: `manifest.json:26-28`
- Modify: `background.js:10-65`
- Modify: `background.js:134-159`
- Modify: `background.js:229-291`
- Create: `tests/backgroundConfiguration.test.js`

**Interfaces:**
- Consumes: `InactivityKioskRestrictionsCore.DEFAULT_KIOSK_RESTRICTIONS` and
  `validateKioskRestrictions` from Task 1.
- Produces: effective configuration keys `kioskRestrictionsEnabled: boolean`
  and `kioskRestrictions: KioskRestriction[]`.
- Preserves runtime messages `get-effective-config`, `save-local-overrides`,
  and `clear-local-overrides`.

- [ ] **Step 1: Build the background VM fixture and write failing tests**

Load `kioskRestrictionsCore.js` and the real `background.js` with `node:vm`.
Provide complete fakes for `browser.runtime`, `browser.storage.local`,
`browser.storage.managed`, `browser.tabs`, and `browser.browsingData`. Capture
the registered runtime message listener and drive it rather than asserting that
the fake listener exists.

Cover these observable cases:

```javascript
test("managed rules override defaults and the local switch overrides only the global flag", async () => {
    const result = await sendMessage({ type: "get-effective-config" });
    assert.equal(result.config.kioskRestrictionsEnabled, false);
    assert.deepEqual(result.config.kioskRestrictions, managedRules);
});

test("save-local-overrides cannot replace managed kiosk rules", async () => {
    const result = await sendMessage({
        type: "save-local-overrides",
        config: {
            ...completeEditableConfig,
            kioskRestrictionsEnabled: false,
            kioskRestrictions: attackerRules
        }
    });
    assert.deepEqual(result.config.kioskRestrictions, managedRules);
    assert.equal(saved.localOverrides.kioskRestrictions, undefined);
});

test("an invalid managed rule preserves the complete stored fallback", async () => {
    const result = await sendMessage({ type: "get-effective-config" });
    assert.deepEqual(result.config.kioskRestrictions, storedFallbackRules);
});
```

Also cover `allowLocalOverrides: false`, clearing overrides, and a first install
with no managed or stored rules using built-in FAS and IBZ defaults.

- [ ] **Step 2: Run the background tests and verify the missing-key failures**

```powershell
node --test tests/backgroundConfiguration.test.js
```

Expected: FAIL because the effective configuration does not contain the new
keys and editable validation does not require the global boolean.

- [ ] **Step 3: Wire the core into the background and manifest**

Change the background scripts to:

```json
"background": {
  "scripts": ["kioskRestrictionsCore.js", "background.js"]
}
```

Extend `DEFAULT_CONFIGURATION` with:

```javascript
kioskRestrictionsEnabled: true,
kioskRestrictions: InactivityKioskRestrictionsCore.DEFAULT_KIOSK_RESTRICTIONS
```

Add `kioskRestrictionsEnabled` to `EDITABLE_CONFIG_KEYS`. Add
`kioskRestrictions` to `CONFIG_KEYS` without adding it to editable keys.
Explicitly add the global boolean in `validateEditableConfiguration` and the
validated rules in `validateCompleteConfiguration`:

```javascript
kioskRestrictionsEnabled: requireBoolean(
    source.kioskRestrictionsEnabled,
    "kioskRestrictionsEnabled"
)

kioskRestrictions: InactivityKioskRestrictionsCore.validateKioskRestrictions(
    source.kioskRestrictions,
    (selector) => document.querySelector(selector)
)
```

Add `requireBoolean` with an exact boolean type check. Ensure
`pickKnownConfiguration`, persisted top-level values, and stored fallback
include the rules. Deep-clone default rules before returning or persisting them
so storage consumers cannot mutate the frozen defaults.

- [ ] **Step 4: Run background and core tests**

```powershell
node --test tests/kioskRestrictionsCore.test.js tests/backgroundConfiguration.test.js
node --check background.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
```

Expected: all tests PASS and all validation commands exit `0`.

- [ ] **Step 5: Commit configuration integration**

```powershell
git add -- manifest.json background.js tests/backgroundConfiguration.test.js
git commit -m "feat: resolve managed kiosk restrictions"
```

---

### Task 3: Generic DOM restriction controller

**Files:**
- Delete: `fasKioskUi.js`
- Delete: `tests/fasKioskUi.test.js`
- Create: `kioskUiRestrictions.js`
- Create: `tests/kioskUiRestrictions.test.js`
- Modify: `manifest.json:36-41`
- Modify: `inactivityplugin.css:1-4`

**Interfaces:**
- Consumes: `get-effective-config` response and
  `InactivityKioskRestrictionsCore.getMatchingKioskSelectors`.
- Produces:
  `createKioskRestrictionsController({ documentObject, pageUrl,
  createObserver, loadConfiguration, addStorageListener, logError })` with
  methods `start()`, `applyConfiguration(config)`, and `stop()`.
- Uses only `data-inactivity-plugin-hidden="true"` for reversible DOM state.

- [ ] **Step 1: Write failing controller tests**

Port the useful FAS cases from `tests/fasKioskUi.test.js` and add IBZ fixtures.
Exercise the real controller through a small selector-aware fake document.

Required behaviors:

```javascript
test("applies only enabled matching rules", async () => {
    await controller.start();
    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(authenticationButton.hasAttribute("data-inactivity-plugin-hidden"), false);
});

test("disabling the global switch restores marked elements and disconnects the observer", async () => {
    await controller.start();
    storageListener({ kioskRestrictionsEnabled: { newValue: false } }, "local");
    assert.equal(fasHeader.hasAttribute("data-inactivity-plugin-hidden"), false);
    assert.equal(observer.disconnectCalls, 1);
});

test("dynamic IBZ navigation is hidden by the single observer", async () => {
    await controller.start();
    documentObject.add("#sidebar-first", sidebar);
    observer.callback([{ addedNodes: [sidebar] }]);
    assert.equal(sidebar.hasAttribute("data-inactivity-plugin-hidden"), true);
    assert.equal(observer.observeCalls, 1);
});
```

Add cases for a disabled individual rule, non-matching URL, runtime selector
failure continuing to the next selector, repeated configuration changes not
creating duplicate observers, and `stop()` restoring only extension-marked
elements. Assert that the IBZ form and FAS authentication controls remain
unmarked.

- [ ] **Step 2: Run the controller tests and verify failure**

```powershell
node --test tests/kioskUiRestrictions.test.js
```

Expected: FAIL because `kioskUiRestrictions.js` does not exist.

- [ ] **Step 3: Implement the controller and browser bootstrap**

Apply selectors independently so one runtime DOM error cannot stop the rule:

```javascript
for (const { ruleId, selector } of matchingSelectors) {
    try {
        for (const element of documentObject.querySelectorAll(selector)) {
            element.setAttribute(HIDDEN_ATTRIBUTE, "true");
        }
    } catch (error) {
        logError(`Invalid kiosk selector in rule "${ruleId}": ${selector}`, error);
    }
}
```

Clear only `[data-inactivity-plugin-hidden="true"]` before applying a changed
configuration. Disconnect and null the previous observer before creating a new
one. Ignore storage areas other than `local`; merge only changed effective keys
into the controller's in-memory configuration.

The browser bootstrap must load effective configuration with
`browser.runtime.sendMessage({ type: "get-effective-config" })`, require an
`ok` response, then register `browser.storage.onChanged`. It must log and leave
the page unchanged if no complete configuration is available.

Change content-script order to:

```json
"js": [
  "kioskRestrictionsCore.js",
  "kioskUiRestrictions.js",
  "timeoutModal.js"
]
```

Keep the existing CSS marker rule. Remove `aria-hidden` mutation from the old
implementation so toggling off restores the host page exactly.

- [ ] **Step 4: Run all rule/controller tests and syntax checks**

```powershell
node --test tests/kioskRestrictionsCore.test.js tests/kioskUiRestrictions.test.js tests/backgroundConfiguration.test.js
node --check kioskRestrictionsCore.js
node --check kioskUiRestrictions.js
node --check timeoutModal.js
```

Expected: all tests PASS and syntax checks exit `0`.

- [ ] **Step 5: Commit the generic controller**

```powershell
git add -- manifest.json inactivityplugin.css kioskUiRestrictions.js tests/kioskUiRestrictions.test.js
git add -u -- fasKioskUi.js tests/fasKioskUi.test.js
git commit -m "feat: apply kiosk restrictions by configured site"
```

---

### Task 4: Options switch and managed rule summary

**Files:**
- Modify: `popup/options.html:8-45`
- Modify: `popup/options.js:4-46`
- Modify: `popup/options.js:68-110`
- Modify: `popup/options.js:166-205`
- Modify: `popup/options.css`
- Create: `tests/optionsKioskRestrictions.test.js`

**Interfaces:**
- Consumes: effective `kioskRestrictionsEnabled` and `kioskRestrictions`.
- Produces: an editable checkbox `#kioskRestrictionsEnabled` and a read-only
  list `#kioskRestrictionsSummary`.
- `readAndValidateForm()` includes the boolean but never includes
  `kioskRestrictions`.

- [ ] **Step 1: Write failing options behavior tests**

Execute the real `popup/options.js` in `node:vm` with DOM elements for every
existing form ID plus the new checkbox and summary. Provide a complete browser
message response.

Assert these results:

```javascript
assert.equal(elements.kioskRestrictionsEnabled.checked, true);
assert.equal(elements.kioskRestrictionsEnabled.disabled, true);
assert.match(elements.kioskRestrictionsSummary.textContent, /fas-login/);
assert.match(elements.kioskRestrictionsSummary.textContent, /ibz-pin-puk/);

await click("unlockConfigBtn");
elements.kioskRestrictionsEnabled.checked = false;
await click("extTimeoutOptionbtn");
assert.equal(savedConfig.kioskRestrictionsEnabled, false);
assert.equal(savedConfig.kioskRestrictions, undefined);
```

Also assert that `allowLocalOverrides: false` keeps the switch disabled and
that **Use managed values** rerenders the managed boolean and summary.

- [ ] **Step 2: Run options tests and verify the missing-element failure**

```powershell
node --test tests/optionsKioskRestrictions.test.js
```

Expected: FAIL because the new checkbox and summary do not exist.

- [ ] **Step 3: Add the options UI and behavior**

Add this field near the timeout and redirect settings:

```html
<div class="options-field options-toggle">
    <label for="kioskRestrictionsEnabled">Kiosk UI restrictions:</label>
    <input type="checkbox" id="kioskRestrictionsEnabled" disabled>
</div>
```

Add a managed-rules section containing
`<ul id="kioskRestrictionsSummary" aria-label="Configured kiosk restriction rules"></ul>`.
Render list items with DOM construction and `textContent`, never `innerHTML`.
Each item must show rule ID, enabled/disabled state, hostnames, and path
prefixes; selectors remain absent from the popup.

Add `kioskRestrictionsEnabled: true` to popup fallback defaults and the field ID
to `editableFieldIds`. Hydrate checkboxes through `.checked`, not `.value`, and
return the boolean from `readAndValidateForm()`.

Style the switch and summary consistently with the existing form. Disabled
state must remain visibly muted and the summary must wrap long paths without
expanding the toolbar popup horizontally.

- [ ] **Step 4: Run options and full JavaScript tests**

```powershell
node --test tests/optionsKioskRestrictions.test.js tests/kioskRestrictionsCore.test.js tests/kioskUiRestrictions.test.js tests/backgroundConfiguration.test.js
node --check popup/options.js
```

Expected: all tests PASS and syntax validation exits `0`.

- [ ] **Step 5: Commit the options workflow**

```powershell
git add -- popup/options.html popup/options.js popup/options.css tests/optionsKioskRestrictions.test.js
git commit -m "feat: add kiosk restriction options switch"
```

---

### Task 5: Managed example and operator documentation

**Files:**
- Modify: `managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json`
- Modify: `managedStorage.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `SKILL.md`

**Interfaces:**
- Documents the exact schema and the same FAS/IBZ defaults supplied by
  `kioskRestrictionsCore.js`.
- Preserves the extension ID and registry installation contract.

- [ ] **Step 1: Update the deployable Managed Storage document**

Add `kioskRestrictionsEnabled` and `kioskRestrictions` to `data` using the exact
schema and initial rules from the approved specification. Keep
`allowLocalOverrides` unchanged.

- [ ] **Step 2: Parse the JSON and compare it through the validator**

Create a short Node test case in `tests/kioskRestrictionsCore.test.js` that
loads the deployable JSON, passes `data.kioskRestrictions` to
`validateKioskRestrictions`, and asserts the literal IDs
`["fas-login", "ibz-pin-puk"]`. Then run:

```powershell
Get-Content -Raw managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json | ConvertFrom-Json | Out-Null
node --test tests/kioskRestrictionsCore.test.js
```

Expected: JSON parsing succeeds and the test passes.

- [ ] **Step 3: Expand `managedStorage.md`**

Document:

- the complete schema, types, limits, exact-host and path-boundary behavior;
- the global switch versus per-rule `enabled` distinction;
- why rules cannot be edited or overridden locally;
- how to add a site by inspecting its DOM and adding the narrowest selectors;
- how to remove or disable a rule;
- the initial FAS and IBZ rules;
- the required deployment order: update JSON, fully stop Firefox, install or
  update the extension, restart Firefox, then validate;
- atomic rejection behavior and console diagnostics;
- examples of invalid hostnames, paths, duplicate IDs, and CSS selectors;
- the fact that hiding page elements is not equivalent to browser-level URL or
  network blocking.

- [ ] **Step 4: Update repository and user documentation**

Update `README.md` features, configuration table, options workflow, site rules,
tests, and project structure. Update `AGENTS.md` and `SKILL.md` with the generic
module names, managed-only rule invariant, immediate restore behavior, IBZ
manual scenario, and all new test commands. Follow the repository skill-edit
validation workflow when changing `SKILL.md`.

- [ ] **Step 5: Validate documentation and commit**

```powershell
rg -n "fasKioskUi|FAS kiosk UI" README.md AGENTS.md SKILL.md managedStorage.md
Get-Content -Raw managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json | ConvertFrom-Json | Out-Null
git diff --check
```

Expected: no obsolete hard-coded module references, valid JSON, and no diff
formatting errors.

```powershell
git add -- managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json managedStorage.md README.md AGENTS.md SKILL.md tests/kioskRestrictionsCore.test.js
git commit -m "docs: document configurable kiosk restrictions"
```

---

### Task 6: Full verification and live Firefox acceptance

**Files:**
- Verify only; modify a file only when a preceding test identifies a defect in
  the implemented behavior.

**Interfaces:**
- Consumes the complete implementation from Tasks 1-5.
- Produces recorded automated evidence and a manual acceptance report.

- [ ] **Step 1: Run the complete automated test suite**

```powershell
node --test tests/kioskRestrictionsCore.test.js tests/backgroundConfiguration.test.js tests/kioskUiRestrictions.test.js tests/optionsKioskRestrictions.test.js
```

Expected: zero failed tests.

- [ ] **Step 2: Run syntax and JSON validation**

```powershell
node --check kioskRestrictionsCore.js
node --check kioskUiRestrictions.js
node --check timeoutModal.js
node --check popup/options.js
node --check background.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
Get-Content -Raw managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json | ConvertFrom-Json | Out-Null
git diff --check
```

Expected: every command exits `0`. If `web-ext` is already installed, also run
`web-ext lint` and require zero errors.

- [ ] **Step 3: Validate FAS manually**

Load the temporary extension from `about:debugging#/runtime/this-firefox`,
reload the FAS tab, and confirm:

1. header, footer, help links, and video controls are hidden;
2. every required authentication control remains visible and operable;
3. dynamically rendered restricted elements remain hidden;
4. OAuth authorization and exact `itsme/refused` timeout exceptions retain
   their existing behavior.

- [ ] **Step 4: Validate IBZ manually**

Open the configured French PIN/PUK page and confirm:

1. `header.header`, `#sidebar-first`, `.footer-top`, and
   `.region-footer-bottom` are hidden;
2. Accueil, Citoyen, Professionnel, social-network links, and left navigation
   cannot be reached by mouse or keyboard;
3. the national-number, email, CAPTCHA, and submission controls remain visible
   and usable;
4. another IBZ page outside the configured path remains unchanged.

- [ ] **Step 5: Validate the global and per-rule switches**

With `allowLocalOverrides: true`, unlock the options page, disable **Kiosk UI
restrictions**, validate, and confirm the hidden elements return in the already
open page. Re-enable it and confirm they disappear again. Use **Use managed
values** and confirm the managed boolean returns.

Set `ibz-pin-puk.enabled` to `false` in the managed JSON, fully restart Firefox,
and confirm the IBZ page remains untouched while the FAS rule still applies.
Restore the rule after the test.

- [ ] **Step 6: Record the final state**

Run `git status --short` and report:

- automated test count and failures;
- whether `web-ext lint` ran;
- every manual Firefox scenario completed or not completed;
- any remaining limitation, especially that DOM hiding is not browser-level
  navigation enforcement.

