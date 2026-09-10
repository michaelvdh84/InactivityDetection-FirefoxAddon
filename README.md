# EPN Inactivity Detection for Firefox

Firefox Manifest V3 extension for public self-service kiosks. It monitors user
activity, displays a multilingual confirmation dialog after an idle period,
then signs out, clears browser data, and redirects the tab when the session is
abandoned.

The extension is intended for dedicated Firefox profiles. Session cleanup is
profile-wide for normal website data and may affect every site open in the same
profile.

## Features

- configurable inactivity delay and confirmation grace period;
- responsive I-City inactivity dialog with configurable titles, messages, and
  buttons in French, Belgian Dutch, and English;
- language selection from `fr-BE`, `nl-BE`, or `en-US` in the current URL;
- configurable redirect after each session reset;
- Dynamics Power Pages logout before local data cleanup;
- removal of cookies, cache, site storage, history, form data, and download
  history without closing Firefox;
- automatic disabling of inactivity detection on the configured start page;
- centralized kiosk configuration through Firefox Managed Storage;
- optional local overrides through the extension options panel;
- existing itsme and FAS navigation exceptions;
- centrally managed, selector-based kiosk UI restrictions for narrowly scoped
  FAS and IBZ pages, including matching dynamically inserted elements.

## How it works

On ordinary pages, mouse, touch, click, and keyboard activity restart the idle
period. When `modalAfter` expires, the extension displays one confirmation
dialog:

- **Continue** closes the dialog, cancels the grace-period timeout, and starts
  a new idle period;
- **Quit**, or expiry of `popupLife`, starts the session-reset workflow.

No activity listeners or timer are registered when the current document is the
configured `redirectUrl`. Start-page matching compares only the HTTP(S) origin
and normalized pathname. Query parameters, fragments, and trailing-slash
differences are ignored. Detection begins normally after navigation to another
page.

## Language selection

The modal language comes from the current page URL:

| URL locale | Language | Configuration suffix |
| --- | --- | --- |
| `fr-BE` | French | `FR` |
| `nl-BE` | Belgian Dutch | `NL` |
| `en-US` | English | `EN` |

French is the fallback when no supported locale is found. For each suffix, the
extension reads four configurable values: `title`, `txt`, `btnContinue`, and
`btnQuit`. For example, French uses `titleFR`, `txtFR`, `btnContinueFR`, and
`btnQuitFR`.

## Configuration

The effective configuration is resolved in this order:

1. built-in defaults;
2. a complete and valid Firefox Managed Storage configuration, when available;
3. `browser.storage.local.localOverrides`, when local overrides are allowed.

Managed Storage is read-only. The extension never modifies the administrator's
JSON file. It stores user changes separately in local extension storage.

### Configuration keys

| Key | Type | Default or purpose |
| --- | --- | --- |
| `modalAfter` | positive number | `60`; seconds before displaying the dialog |
| `popupLife` | positive number | `30`; seconds before automatic reset |
| `redirectUrl` | string | `about:blank`; accepts `about:blank` or an absolute HTTP(S) URL |
| `titleFR` | string | `Inactivité détectée` |
| `txtFR` | string | French inactivity message |
| `btnContinueFR` | string | `Oui, continuer ma session` |
| `btnQuitFR` | string | `Non, quitter` |
| `titleNL`, `txtNL` | strings | Belgian Dutch title and message |
| `btnContinueNL`, `btnQuitNL` | strings | Belgian Dutch button labels |
| `titleEN`, `txtEN` | strings | English title and message |
| `btnContinueEN`, `btnQuitEN` | strings | English button labels |
| `hostname` | string | machine metadata supplied by Managed Storage; read-only in options |
| `ip` | string | machine metadata supplied by Managed Storage; read-only in options |
| `allowLocalOverrides` | boolean | managed-only flag; defaults to `true` |
| `kioskRestrictionsEnabled` | boolean | global Managed Storage switch; defaults to `true` |
| `kioskRestrictions` | array of rule objects | Managed Storage-only site UI rules; see [Managed Storage setup](managedStorage.md#règles-de-restriction-dinterface-kiosque) |

Managed configuration is applied atomically: every required value must be
present and valid. Unknown keys are ignored. An absent or invalid managed
manifest preserves the last valid local configuration.

### Options panel

When Managed Storage is available, the options panel displays **Managed
Configuration Loaded** and initially keeps the fields disabled.

- **Unlock configuration** enables editable fields when
  `allowLocalOverrides` is `true`.
- **Validate** validates the form and saves a local override.
- **Use managed values** removes the local override and displays the managed
  values already loaded by Firefox.

The global kiosk-restrictions checkbox is editable only when local overrides
are allowed. Individual rules and selectors remain Managed Storage-only, so a
kiosk user cannot create, weaken, or broaden a page restriction from the popup.

Changing the managed JSON on disk requires a complete Firefox restart. **Use
managed values** does not force Firefox to reread the file.

For registry paths, JSON deployment, validation, and troubleshooting, see
[Managed Storage setup](managedStorage.md).

## Session reset and Dynamics logout

A reset can be triggered by the **Quit** button, grace-period expiry, or the
existing exact FAS `itsme/refused` exception.

On a Dynamics Power Pages document containing
`#header-sign-out[data-logout-url]`, the extension resolves that logout path
against the current page. Both the content script and background script accept
it only when it is an HTTP(S) URL on the same origin.

The reset order is deliberate:

1. request the Dynamics logout URL while authentication cookies still exist;
2. navigate the tab to the packaged neutral `reset.html` page;
3. clear normal website data with Firefox's `browsingData` API;
4. navigate the same tab to `redirectUrl`.

The remote logout request is best-effort: local cleanup continues if it cannot
be loaded. Local cleanup fails closed: if it fails, the portal is not reopened
with potentially stale session data.

### Data removed

- cookies;
- browser cache;
- local and session storage;
- IndexedDB;
- service workers and their cached data;
- browsing history;
- saved form data;
- download history.

Downloaded files, saved passwords, Managed Storage, and the extension's own
local configuration are preserved.

Clearing browser data does not necessarily revoke an external SSO or OAuth
session. The Dynamics logout step addresses the portal session. Signing out of
Microsoft Entra ID or another external identity provider also depends on the
portal's External logout configuration.

## itsme and managed kiosk restrictions

The extension preserves the portal's authentication-flow exceptions:

- on `itsme.be`, inactivity detection starts only when `#phoneForm` exists;
- FAS OAuth authorization redirects do not start an inactivity timer;
- the exact production and integration FAS `itsme/refused` pages immediately
  request a session reset;
- the default managed `fas-login` rule hides selected navigation, footer, video,
  and help elements only on the two exact FAS hosts below `/fas/XUI/`;
- the default managed `ibz-pin-puk` rule hides selected page chrome only on the
  exact IBZ PIN/PUK path. Matching elements restore immediately when its rule
  is disabled, the global switch is off, or the URL no longer matches;
- rules use exact hostnames and path-prefix boundaries: `/a/b` matches `/a/b`
  and `/a/b/child`, but not `/a/b-extra`.

These are presentation restrictions, not browser security controls: hiding an
element does not block its URL, network request, or browser navigation.

## Installation for development

1. Clone or download the repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Select the repository's `manifest.json`.
5. After reloading the temporary extension, reload any portal tab that was
   already open so Firefox injects the current content script and stylesheet.

The temporary add-on is removed when Firefox closes. Managed kiosk deployment
should use the organization's normal Firefox extension-distribution mechanism.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | read Managed Storage and save resolved settings/local overrides |
| `tabs` | navigate the requesting tab during logout, cleanup, and redirection |
| `browsingData` | remove normal website session and browsing data |
| `activeTab` | compatibility with the toolbar workflow |

The extension declares that it does not require data collection through its
Firefox `browser_specific_settings` configuration.

## Validation

There is no build step or external test dependency. Run the Node behavior test,
syntax checks, and JSON checks from PowerShell:

```powershell
node --test tests/kioskRestrictionsCore.test.js
node --check kioskRestrictionsCore.js
node --check kioskUiRestrictions.js
node --check timeoutModal.js
node --check popup/options.js
node --check background.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
Get-Content -Raw managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json | ConvertFrom-Json | Out-Null
git diff --check
```

For a manual test, use short timeout values and verify:

1. the configured start page remains idle even after mouse, touch, click, and
   keyboard interaction;
2. navigating away from the start page enables normal detection;
3. inactivity shows exactly one dialog;
4. `fr-BE`, `nl-BE`, and `en-US` select the expected title, message, and button
   labels;
5. **Continue** starts a fresh idle period;
6. **Quit** and grace-period expiry request Dynamics logout before cleanup and
   redirection;
7. website cookies and storage are absent after reset while extension settings
   remain available;
8. Managed Storage, local override, and **Use managed values** precedence works
   as documented;
9. on a production or integration `/fas/XUI/` page, the header, footer, video,
   and help link remain hidden after dynamic page updates while every required
   authentication method remains usable.
10. on the IBZ PIN/PUK page, only the configured elements are hidden; turning
    off the global switch or disabling its rule restores them immediately, and
    the sibling `.../code-pin-extra` path does not match.

## Project structure

- `manifest.json`: Manifest V3 metadata, permissions, background, and content
  script registration;
- `background.js`: configuration resolution, validation, and session-reset
  coordination;
- `timeoutModal.js`: activity tracking, URL-language selection, modal lifecycle,
  and site-specific exceptions;
- `kioskRestrictionsCore.js`: Managed Storage rule validation, defaults, and
  exact-host/path-boundary matching;
- `kioskUiRestrictions.js`: selector restriction application, dynamic-content
  observation, and immediate restoration;
- `inactivityplugin.css`: responsive injected modal design;
- `popup/`: options page and local-override workflow;
- `managed-storage/`: deployable Managed Storage example;
- `managedStorage.md`: Windows Managed Storage deployment guide;
- `reset.html`: neutral page used while browser data is cleared.

## License

This project is licensed under the GNU General Public License v3.0. See
[`LICENCSE`](LICENCSE) for details (the filename is preserved from the
repository).
