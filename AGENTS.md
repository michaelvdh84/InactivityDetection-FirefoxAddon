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
- `inactivityplugin.css`: styles for the modal injected by the content script.
- `reset.html`: neutral page displayed while cleanup is running.
- `popup/options.html`: toolbar configuration form.
- `popup/options.js`: default settings, form hydration, and persistence through
  `browser.storage.local`.
- `popup/options.css`: configuration popup styles.
- `icons/`: packaged extension icons.
- `README.md`: manual installation and user-facing behavior.

There is no automated test suite or generated output in the repository.

## Behavioral invariants

- Stored durations are seconds. `timeoutModal.js` converts them to milliseconds
  for `setInterval` and `setTimeout`.
- `modalAfter` defaults to 60 seconds and `popupLife` defaults to 30 seconds.
  Defaults also exist in `popup/options.js`; keep both locations consistent when
  changing them.
- User activity resets the idle counter. Choosing **Continue** must remove the
  modal, cancel its grace-period timeout, and restart idle detection.
- `redirectUrl` defaults to `about:blank` and accepts `about:blank` or an
  absolute HTTP(S) URL.
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
- The `iclangplug` URL parameter is stored as `epnLang`. Values containing `fr`,
  `nl`, or `en` select the corresponding title, message, and button labels;
  French is the fallback.
- Preserve the itsme/FAS exceptions unless a task explicitly changes them:
  detection on `itsme.be` starts only when `#phoneForm` exists; FAS authorization
  redirects do not start the timer; the exact FAS `itsme/refused` pages reset
  the session immediately.
- Modal selectors (`#modalJS`, `#titleInactivity`, `#askingInactivity`,
  `.modal-timeout`, `.modal-content-timeout`, and `.buttonTimeOut`) connect the
  JavaScript and CSS. Update both files if a selector changes.

## Implementation guidance

- Use plain JavaScript, DOM APIs, and Firefox's promise-based `browser.*` API.
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
- The modal stylesheet is already injected through `manifest.json`.
  `loadCSS()` in `timeoutModal.js` is legacy code that points to an unbundled
  `style.css`; do not rely on it or add a second stylesheet injection path.
- Keep storage key names backward compatible unless migration is part of the
  task: `modalAfter`, `popupLife`, `titleFR`, `txtFR`, `titleNL`, `txtNL`,
  `titleEN`, `txtEN`, `epnLang`, and `redirectUrl`.
- If user-visible behavior, defaults, installation, or cleanup scope changes,
  update `README.md`. Bump the version in `manifest.json` only when the
  requested release workflow calls for it.

## Validation

Run the checks that match the change:

```powershell
node --check timeoutModal.js
node --check popup/options.js
node --check background.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
```

If `web-ext` is already installed, also run `web-ext lint`; do not add it as a
project dependency solely for a small change.

For behavior changes, load `manifest.json` as a temporary add-on from
`about:debugging#/runtime/this-firefox` and verify with short configured values:

1. Activity postpones the modal.
2. Inactivity shows exactly one modal.
3. **Continue** removes it and starts a fresh idle period.
4. On a Dynamics page containing the sign-out button, **Exit** and grace-period
   expiry visit its logout URL before showing `reset.html`, clearing the
   session, and reaching the configured URL.
5. Cookies, local/session storage, IndexedDB, and service worker state from a
   test site are absent after reset.
6. The extension settings survive cleanup and reopening the toolbar popup.
7. An invalid redirect URL is rejected by the popup; a missing stored value
   safely redirects to `about:blank`.
8. Any affected itsme/FAS exception still follows its documented branch.

Report manual checks that could not be performed. Also report whether Dynamics
Power Pages signs out only its local session or the external identity provider;
the latter depends on the portal's External logout configuration.
