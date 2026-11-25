# Configurable Kiosk UI Restrictions Design

## Context

The extension currently contains a FAS-specific content script that hides
navigation, help, and video elements on the production and integration FAS XUI
pages. Additional kiosk journeys now need the same protection, starting with
the Belgian National Register PIN/PUK request page.

The replacement must let administrators add, remove, enable, or disable site
rules through Firefox Managed Storage without releasing another extension
version. Operators may only toggle the complete filtering feature from the
options page; they must not be able to edit managed hosts, paths, or CSS
selectors locally.

## Goals

- Replace the hard-coded FAS filter with a generic, configuration-driven rule
  engine.
- Preserve the current FAS filtering behavior.
- Add an IBZ PIN/PUK rule that hides the header, primary navigation, left
  navigation, social links, and footer without hiding the request form.
- Support a global operator-controlled switch and administrator-controlled
  per-rule switches.
- Validate and apply managed rules atomically.
- Reapply restrictions to dynamically inserted DOM content.
- Document configuration, deployment, operation, and troubleshooting in
  detail.

## Non-goals

- Editing hosts, paths, selectors, or individual rule switches in
  `options.html`.
- Blocking arbitrary navigation at the Firefox or network-policy level.
- Supporting regular expressions, wildcard hostnames, executable JavaScript,
  or arbitrary CSS declarations in configuration.
- Expanding the IBZ rule beyond the configured PIN/PUK page paths.

## Configuration schema

Two top-level effective configuration keys are added:

```json
{
  "kioskRestrictionsEnabled": true,
  "kioskRestrictions": [
    {
      "id": "fas-login",
      "enabled": true,
      "hostnames": [
        "idp.iamfas.belgium.be",
        "idp.iamfas.int.belgium.be"
      ],
      "pathPrefixes": ["/fas/XUI/"],
      "selectors": [
        ".csam-header",
        ".csam-footer-container",
        ".csam-footer-content-container",
        ".video-preview-btn",
        "iframe[src*='youtube.com' i]",
        "a[href*='sma-help.bosa.belgium.be' i]"
      ]
    },
    {
      "id": "ibz-pin-puk",
      "enabled": true,
      "hostnames": ["www.ibz.rrn.fgov.be"],
      "pathPrefixes": [
        "/fr/citoyen/documents-didentite/eid/demande-dun-code-pin"
      ],
      "selectors": [
        "header.header",
        "#superfish-main",
        "#sidebar-first",
        ".footer-top",
        ".region-footer-bottom"
      ]
    }
  ]
}
```

`kioskRestrictionsEnabled` is an editable boolean and therefore participates
in the existing local override workflow. `kioskRestrictions` is managed-only:
the resolved rules are copied to top-level `browser.storage.local` for content
script consumption and fallback, but the options page never writes them into
`localOverrides`.

Each rule has:

- `id`: unique non-empty identifier used for diagnostics;
- `enabled`: administrator-controlled boolean;
- `hostnames`: non-empty list of exact lower-case DNS hostnames, without a
  scheme, path, port, or wildcard;
- `pathPrefixes`: non-empty list of absolute path prefixes beginning with `/`;
- `selectors`: non-empty list of CSS selectors whose matching elements must be
  hidden.

Query parameters and fragments are ignored. Hostnames are exact and
case-insensitive. Paths are matched as URL path prefixes. A trailing slash in a
configured prefix is normalized so `/fas/XUI` and `/fas/XUI/` behave
consistently without broadening the rule to another path segment.

Reasonable bounds protect startup and page performance: at most 50 rules, 10
hosts and 20 path prefixes per rule, 100 selectors per rule, and bounded string
lengths. Empty arrays, duplicate rule IDs, malformed hostnames or paths,
incorrect types, and syntactically invalid CSS selectors reject the complete
managed configuration.

## Configuration precedence and migration

The existing precedence remains:

1. built-in defaults;
2. one complete and valid Managed Storage document;
3. `browser.storage.local.localOverrides`, when `allowLocalOverrides` is true.

Built-in defaults contain the FAS and IBZ rules so development and managed
storage failure remain fail-safe. The last complete resolved rules are stored
with the existing top-level local fallback.

`kioskRestrictionsEnabled` is added to editable configuration validation and
may be present in `localOverrides`. `kioskRestrictions` is added to complete
configuration validation but excluded from editable/local-override keys.

This is an atomic schema change. Existing deployed Managed Storage JSON files
without both new keys become invalid until updated. Documentation must call out
the required JSON deployment and full Firefox restart before installing the
extension version that consumes this schema.

## Components

### Rule core

A small dependency-free module owns:

- schema validation and normalization;
- exact hostname and normalized path-prefix matching;
- safe cloning of resolved rules;
- CSS selector syntax checks using the available document selector parser.

It exposes one narrowly named extension namespace for Firefox scripts and a
CommonJS export for Node tests. The background and content script load the same
implementation so configuration validation and matching cannot drift.

### Background configuration

`background.js` extends its defaults, editable keys, complete keys, managed
validation, stored fallback, and local override handling:

- the global boolean is editable;
- the rules array is managed-only;
- a local save cannot inject or replace rules;
- resolved values continue to be persisted under top-level local keys;
- malformed managed rules cause the whole managed source to be rejected and
  preserve the last valid local fallback.

### Content-script controller

The current `fasKioskUi.js` is replaced by a generic
`kioskUiRestrictions.js`. On page startup it requests the same effective
configuration used by the inactivity script and then:

1. clears only markers previously applied by this extension;
2. stops when the global switch is false;
3. selects enabled rules matching the current URL;
4. runs every selector independently and marks matching elements with
   `data-inactivity-plugin-hidden="true"`;
5. installs at most one `MutationObserver` when an enabled rule matches;
6. reapplies matching rules after child nodes are inserted.

Invalid selectors are expected to have been rejected during configuration
validation. A defensive runtime catch logs the rule ID and selector, skips that
selector, and continues with the remaining configured selectors.

The controller listens for top-level local storage changes. Disabling the
global switch immediately removes the extension marker from elements hidden by
this feature and disconnects its observer. Re-enabling it reapplies matching
rules and restarts one observer. It does not remove nodes or replace host-page
event handlers.

The stylesheet keeps one shared marker rule:

```css
[data-inactivity-plugin-hidden="true"] {
    display: none !important;
}
```

No `aria-hidden` mutation is needed because `display: none` already removes the
element from rendering and accessibility navigation, while removing the marker
fully restores the original element state.

### Options page

The options form adds one checkbox or switch labelled **Kiosk UI
restrictions**. It follows the current lock workflow:

- disabled when the popup opens;
- enabled by **Unlock configuration** only when local overrides are allowed;
- persisted by **Validate** as
  `localOverrides.kioskRestrictionsEnabled`;
- restored to the managed value by **Use managed values**.

A read-only summary lists each rule ID, enabled state, hostnames, and path
prefixes. CSS selectors remain visible only in the managed JSON and
documentation, reducing accidental operator changes.

## Initial rules

### FAS XUI

The default FAS rule retains the production and integration hosts and the
current navigation, footer, video, and BOSA help selectors. Authentication
provider controls remain outside those selectors.

### IBZ PIN/PUK

The initial IBZ rule targets only
`www.ibz.rrn.fgov.be/fr/citoyen/documents-didentite/eid/demande-dun-code-pin`
and hides:

- `header.header`, including language links and the Accueil/Citoyen/
  Professionnel primary menu;
- `#superfish-main` as explicit protection for the primary menu;
- `#sidebar-first`, disabling the left navigation tree;
- `.footer-top`, including social-network and footer navigation links;
- `.region-footer-bottom`, including the linked footer logo.

The main content and PIN/PUK request form are not selected and remain usable.
Additional localized paths can be added to `pathPrefixes` administratively
after verification without changing extension code.

## Error handling and diagnostics

- Managed validation errors identify the failing rule ID and field without
  partially applying the document.
- Runtime selector errors include the rule ID and selector in the extension
  console and do not stop other selectors.
- Missing or invalid Managed Storage uses the last complete local fallback.
- An empty matching-rule set leaves the page untouched.
- Disabling the feature restores all elements marked by this controller.
- The options summary clearly distinguishes managed rules, fallback rules, and
  active local override state.

## Testing

Dependency-free Node tests cover:

- valid FAS and IBZ URL matches;
- exact-host rejection, path boundary behavior, and query/fragment handling;
- global and per-rule switches;
- DOM filtering and restoration;
- dynamic DOM insertion with a single observer;
- invalid selector isolation at runtime;
- atomic rejection of malformed rules, duplicates, excessive limits, and
  attempts to place managed-only rules in local overrides;
- preservation of authentication controls and the IBZ request form.

Repository verification also runs JavaScript syntax checks, parses the
extension manifest and Managed Storage example, and runs `git diff --check`.

Manual Firefox validation uses both live sites and confirms:

1. FAS authentication remains usable while its navigation/help/video chrome is
   hidden.
2. The IBZ PIN/PUK form remains usable while header, primary menu, sidebar,
   social links, and footer are hidden.
3. The global options switch restores and reapplies elements in an already
   loaded page.
4. A disabled rule and a non-matching URL remain untouched.
5. Dynamic content does not reintroduce restricted elements.

## Documentation

- `README.md`: user-visible behavior, options switch, and testing overview.
- `managedStorage.md`: complete schema, bounds, FAS/IBZ examples, adding and
  removing rules, deployment ordering, restart requirements, and diagnostics.
- `AGENTS.md`: code map, security invariants, and validation checklist.
- `SKILL.md`: maintenance flow, managed-only rule boundary, and test commands.

