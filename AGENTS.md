# Repository Guidelines

## Project scope

This repository contains a Firefox WebExtension that detects inactivity in each
page where its content script runs. After the configured idle period it injects
a confirmation modal. If the user does not choose **Continue** before the grace
period expires, the extension resets browsing data and redirects the tab.

Keep changes limited to this extension. It is a small, dependency-free Firefox
Manifest V3 project: do not introduce a framework, package manager, transpiler, or build
step unless the task explicitly requires one.

## Code map

- `manifest.json`: extension metadata, permissions, toolbar popup, and the
  content-script registration for all URLs.
- `background.js`: session-reset coordinator; moves the source tab to a neutral
  extension page, clears normal web data, and performs the final redirect.
- `timeoutModal.js`: page activity listeners, idle counter, modal lifecycle,
  language selection, site-specific exceptions, and reset requests.
- `kioskRestrictionsCore.js`: validates Managed Storage kiosk rules, supplies
  FAS/IBZ defaults, and matches exact HTTPS hosts and path boundaries.
- `kioskUiRestrictions.js`: applies matching managed selectors and restores
  immediately when the global switch or a matching rule becomes disabled.
- `inactivityplugin.css`: styles for the modal injected by the content script.
- `reset.html`: neutral page displayed while cleanup is running.
- `popup/options.html`: toolbar configuration form.
- `popup/options.js`: default settings, form hydration, and persistence through
  `browser.storage.local`.
- `popup/options.css`: configuration popup styles.
- `managed-storage/`: deployable example of the Firefox Managed Storage
  manifest associated with the extension ID.
- `managedStorage.md`: Windows Managed Storage installation, registry,
  deployment, validation, and troubleshooting guide.
- `icons/`: packaged extension icons.
- `README.md`: manual installation and user-facing behavior.

The repository has dependency-free Node behavior tests for managed kiosk-rule
validation and matching, and no generated output.

## Behavioral invariants

- Stored durations are seconds. `timeoutModal.js` converts them to milliseconds
  for `setInterval` and `setTimeout`.
- Managed configuration is read from `browser.storage.managed` when Firefox
  starts. Content scripts must await resolution before using `redirectUrl` to
  decide whether inactivity detection starts.
- Content scripts keep the returned effective configuration in memory and use
  that same object for timeout values and modal text. They listen for resolved
  top-level local-storage changes so an options save updates an open page.
- Managed configuration is atomic and allow-listed: validate every supported
  key before applying any of it. A missing or invalid manifest preserves the
  last valid local configuration.
- Configuration precedence is defaults, then valid Managed Storage, then the
  `browser.storage.local.localOverrides` object when `allowLocalOverrides` is
  true. Persist the resolved values under the backward-compatible top-level
  storage keys consumed by the content script.
- `hostname` and `ip` are supplied by Managed Storage and remain read-only in
  the popup. Local overrides apply only to editable form settings.
- `modalAfter` defaults to 60 seconds and `popupLife` defaults to 30 seconds.
  Authoritative runtime defaults live in `background.js`; `popup/options.js`
  duplicates them only to render a degraded popup when the background is
  unavailable. Do not add independent timer or modal-text defaults back to
  `timeoutModal.js`, because they can mask configuration propagation failures.
- User activity resets the idle counter. Choosing **Continue** must remove the
  modal, cancel its grace-period timeout, and restart idle detection.
- `redirectUrl` defaults to `about:blank` and accepts `about:blank` or an
  absolute HTTP(S) URL.
- When the current document matches `redirectUrl`, the idle interval must not
  start and activity listeners must not be registered. Detection begins only
  after navigation to a different page. Match only the HTTP(S) origin and
  normalized pathname; ignore every query parameter, fragment, and trailing
  slash difference.
- Choosing **Exit**, allowing the grace period to expire, or reaching an exact
  FAS `itsme/refused` URL sends a `reset-session` message to `background.js`.
- When the current page contains `#header-sign-out[data-logout-url]`, resolve
  the value against the page URL and send it with the reset request. Both the
  content script and background script must restrict it to same-origin HTTP(S).
- The reset order is significant: request the Dynamics logout with existing
  cookies, load `reset.html`, clear normal website data, then navigate to
  `redirectUrl`. Do not clear cookies before the remote logout request and do
  not redirect to the portal before cleanup finishes.
- Cleanup intentionally preserves the extension's `browser.storage.local`
  values and does not remove saved passwords or downloaded files.
- Select modal language from the current URL: `fr-BE` selects French, `nl-BE`
  selects Belgian Dutch, and `en-US` selects English. French is the fallback.
  The legacy `iclangplug` value may remain stored as `epnLang`, but modal
  rendering must use the locale in the current URL.
- Preserve the itsme/FAS exceptions unless a task explicitly changes them:
  detection on `itsme.be` starts only when `#phoneForm` exists; FAS authorization
  redirects do not start the timer; the exact FAS `itsme/refused` pages reset
  the session immediately.
- Kiosk UI restrictions are managed-only. The global
  `kioskRestrictionsEnabled` switch may be locally overridden when allowed, but
  `kioskRestrictions` rules and selectors may never be locally edited or
  overridden. Disabled rules, an off global switch, or a no-longer-matching URL
  must restore every extension-hidden element immediately.
- Rules use exact HTTPS host matching and normalized path-prefix boundaries;
  retain the narrow default FAS and IBZ rules, avoid hiding authentication
  controls, and reapply matching restrictions to dynamically inserted elements.
- Modal selectors (`#modalJS`, `#titleInactivity`, `#askingInactivity`,
  `.modal-timeout`, `.modal-content-timeout`, `.inactivity-warning-icon`,
  `.inactivity-button-container`, and `.buttonTimeOut`) connect the JavaScript
  and CSS. Update both files if a selector changes.

## Implementation guidance

- Use plain JavaScript, DOM APIs, and Firefox's promise-based `browser.*` API.
- Resolve Managed Storage and local overrides in `background.js`; content
  scripts and the popup consume the validated effective configuration. Do not
  make modal text or timers independently reread stale top-level keys.
- Never trust managed or local JSON merely because it is machine-controlled.
  Keep the explicit key allow-list, duration/text bounds, redirect protocol
  validation, and all-or-nothing managed application.
- `browser.storage.managed` is read-only. Never attempt to write it from the
  extension; options-page changes belong in `localOverrides`.
- Treat values read from the options form as untrusted. Validate durations as
  finite positive numbers when changing that flow.
- Do not render configurable text with `innerHTML`. Keep the existing safe
  pattern of decoding legacy entities and assigning the result through
  `textContent`.
- Prevent more than one inactivity interval, modal, or grace-period timeout from
  remaining active. Check cleanup paths when changing timers or event handling.
- Keep one reset operation per tab. A cleanup failure must leave the tab on the
  neutral reset page instead of loading the portal with stale session data.
- Failure of the remote logout navigation is best-effort and must not prevent
  local cleanup. Failure of local cleanup remains fail-closed.
- `browsingData.remove()` currently clears normal web cookies, cache, local and
  session storage, IndexedDB, service workers, history, form data, and download
  history across the Firefox profile. Treat changes to that scope as
  security- and privacy-sensitive.
- Content scripts run in arbitrary web pages. Avoid leaking globals, replacing
  page behavior, or assuming a specific page structure outside the documented
  site exceptions.
- The modal stylesheet is injected through `manifest.json`; do not add a second
  runtime stylesheet injection path.
- Keep storage key names backward compatible unless migration is part of the
  task: `modalAfter`, `popupLife`, `titleFR`, `txtFR`, `titleNL`, `txtNL`,
  `titleEN`, `txtEN`, `btnContinueFR`, `btnQuitFR`, `btnContinueNL`,
  `btnQuitNL`, `btnContinueEN`, `btnQuitEN`, `epnLang`, `redirectUrl`, and
  `kioskRestrictionsEnabled`.
- If user-visible behavior, defaults, installation, or cleanup scope changes,
  update `README.md`. Bump the version in `manifest.json` only when the
  requested release workflow calls for it.

## Validation

Run the checks that match the change:

```powershell
node --test tests/kioskRestrictionsCore.test.js
node --check kioskRestrictionsCore.js
node --check kioskUiRestrictions.js
node --check timeoutModal.js
node --check popup/options.js
node --check background.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
Get-Content -Raw managed-storage/michael.vanderhoudelinghen@i-city.brucity.be.json | ConvertFrom-Json | Out-Null
```

If `web-ext` is already installed, also run `web-ext lint`; do not add it as a
project dependency solely for a small change.

For behavior changes, load `manifest.json` as a temporary add-on from
`about:debugging#/runtime/this-firefox` and verify with short configured values:

1. Activity postpones the modal.
2. The configured start page remains idle indefinitely, including after mouse,
   touch, click, and keyboard interaction and after a completed reset redirect.
3. Navigation from the start page to another page starts normal detection.
4. Inactivity shows exactly one modal.
5. **Continue** removes it and starts a fresh idle period.
6. On a Dynamics page containing the sign-out button, **Exit** and grace-period
   expiry visit its logout URL before showing `reset.html`, clearing the
   session, and reaching the configured URL.
7. Cookies, local/session storage, IndexedDB, and service worker state from a
   test site are absent after reset.
8. The extension settings survive cleanup and reopening the toolbar popup.
9. An invalid redirect URL is rejected by the popup; a missing stored value
   safely redirects to `about:blank`.
10. Any affected itsme/FAS exception still follows its documented branch.
11. A valid Managed Storage manifest supplies every option plus `hostname` and
    `ip`; an absent or invalid manifest falls back to local values.
12. The options page initially shows disabled fields. With
    `allowLocalOverrides: true`, **Unlock configuration** enables them,
    **Validate** saves editable values to local overrides, and **Use managed
    values** removes those overrides. With `false`, unlocking is disabled.
13. URLs containing `fr-BE`, `nl-BE`, and `en-US` display the configured title,
    message, quit label, and continue label for the matching language.
14. On both FAS `/fas/XUI/` hosts, matching configured selectors stay hidden
    while required authentication controls remain operable; newly inserted
    matching elements also hide.
15. On the IBZ PIN/PUK page, only configured selectors hide. Toggle the global
    switch or disable its managed rule and verify immediate restoration; verify a
    sibling path such as `.../code-pin-extra` does not match.

Report manual checks that could not be performed. Also report whether Dynamics
Power Pages signs out only its local session or the external identity provider;
the latter depends on the portal's External logout configuration.
