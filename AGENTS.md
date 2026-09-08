# Repository Guidelines

## Project scope

This repository contains a Firefox WebExtension that detects inactivity in each
page where its content script runs. After the configured idle period it injects
a confirmation modal. If the user does not choose **Continue** before the grace
period expires, the script attempts to close the top-level browsing context.

Keep changes limited to this extension. It is a small, dependency-free Manifest
V2 project: do not introduce a framework, package manager, transpiler, or build
step unless the task explicitly requires one.

## Code map

- `manifest.json`: extension metadata, permissions, toolbar popup, and the
  content-script registration for all URLs.
- `timeoutModal.js`: page activity listeners, idle counter, modal lifecycle,
  language selection, site-specific exceptions, and close behavior.
- `inactivityplugin.css`: styles for the modal injected by the content script.
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
- Choosing **Exit**, or allowing the grace period to expire, calls
  `window.top.close()`. Firefox only permits the expected automatic close when
  `dom.allow_scripts_to_close_windows` is enabled, as documented in `README.md`.
- The `iclangplug` URL parameter is stored as `epnLang`. Values containing `fr`,
  `nl`, or `en` select the corresponding title, message, and button labels;
  French is the fallback.
- Preserve the itsme/FAS exceptions unless a task explicitly changes them:
  detection on `itsme.be` starts only when `#phoneForm` exists; FAS authorization
  redirects do not start the timer; the exact FAS `itsme/refused` pages close
  immediately.
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
- Content scripts run in arbitrary web pages. Avoid leaking globals, replacing
  page behavior, or assuming a specific page structure outside the documented
  site exceptions.
- The modal stylesheet is already injected through `manifest.json`.
  `loadCSS()` in `timeoutModal.js` is legacy code that points to an unbundled
  `style.css`; do not rely on it or add a second stylesheet injection path.
- Keep storage key names backward compatible unless migration is part of the
  task: `modalAfter`, `popupLife`, `titleFR`, `txtFR`, `titleNL`, `txtNL`,
  `titleEN`, `txtEN`, and `epnLang`.
- If user-visible behavior, defaults, installation, or the Firefox preference
  changes, update `README.md`. Bump the version in `manifest.json` only when the
  requested release workflow calls for it.

## Validation

Run the checks that match the change:

```powershell
node --check timeoutModal.js
node --check popup/options.js
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
```

If `web-ext` is already installed, also run `web-ext lint`; do not add it as a
project dependency solely for a small change.

For behavior changes, load `manifest.json` as a temporary add-on from
`about:debugging#/runtime/this-firefox` and verify with short configured values:

1. Activity postpones the modal.
2. Inactivity shows exactly one modal.
3. **Continue** removes it and starts a fresh idle period.
4. **Exit** and grace-period expiry exercise the close path.
5. Saved durations and FR/NL/EN text survive reopening the toolbar popup.
6. Any affected itsme/FAS exception still follows its documented branch.

Report manual checks that could not be performed, especially automatic closing,
which depends on the local Firefox preference.
