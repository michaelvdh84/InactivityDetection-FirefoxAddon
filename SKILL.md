---
name: maintain-firefox-inactivity-extension
description: Maintain and troubleshoot this repository's Firefox inactivity-detection extension, including its timers, injected modal, multilingual options, storage keys, and itsme/FAS URL exceptions. Use for code, configuration, review, or release work in this repository; do not use for unrelated Firefox extensions.
---

# Maintain the Firefox inactivity extension

Use this skill for changes to the extension in this repository. Read
`AGENTS.md` first, then inspect the files involved in the requested behavior.

## Establish the affected flow

Trace changes through the smallest relevant path:

- Idle detection or closing: `manifest.json` -> `timeoutModal.js` ->
  `inactivityplugin.css`.
- Settings or defaults: `popup/options.html` -> `popup/options.js` ->
  `browser.storage.local` reads in `timeoutModal.js`.
- Language: the page's `iclangplug` query parameter -> stored `epnLang` ->
  `titleFR`/`txtFR`, `titleNL`/`txtNL`, or `titleEN`/`txtEN` -> modal text.
- Site exception: evaluate the ordered itsme/FAS URL branches in
  `timeoutModal.js` before changing general timer startup.
- Packaging or permissions: `manifest.json`, with corresponding user-facing
  documentation in `README.md` when behavior changes.

Do not assume a background script, bundler, dependency manifest, or automated
test harness; none currently exists.

## Preserve the timing contract

Storage and the options UI express `modalAfter` and `popupLife` in seconds.
Timer APIs use milliseconds. Keep that conversion explicit and keep fallback
defaults synchronized between the options code and the content script.

Any timer refactor must maintain these transitions:

```text
page activity -> reset idle period
idle period expires -> show one confirmation modal
Continue -> remove modal + cancel close timeout + restart idle period
Exit or grace expiry -> attempt window.top.close()
```

Audit interval, timeout, modal, and listener cleanup together. Test with small
durations so a duplicate timer or modal is observable.

## Preserve compatibility and page safety

- Retain Firefox's promise-based `browser.storage.local` usage.
- Keep existing storage keys compatible unless the task includes migration.
- Insert configurable title and message values with `textContent`, never
  `innerHTML`; legacy stored strings may contain HTML entities and can be
  decoded before safe insertion.
- Remember that the content script matches all URLs. Avoid page-specific DOM
  assumptions outside the explicit exceptions, and avoid disturbing host-page
  event handlers when changing activity detection.
- Treat the CSS entry in `manifest.json` as the active stylesheet injection.
  The legacy `loadCSS()` helper references a `style.css` file that is not in the
  repository; do not mistake it for the source of the modal's styles.
- Keep injected modal IDs/classes aligned with `inactivityplugin.css`.
- Treat `window.top.close()` as an attempted close, not a guaranteed full-browser
  shutdown. Its effect depends on Firefox context and
  `dom.allow_scripts_to_close_windows`.

## Handle site exceptions deliberately

Before editing URL matching, verify all three existing behaviors:

- On `itsme.be`, start detection only if `#phoneForm` is present.
- On the production and integration FAS OAuth authorization URLs, do not start
  detection during automatic redirection.
- On the exact production and integration `/fasui/itsme/refused` URLs, close the
  top-level context immediately.

Prefer URL parsing or narrowly scoped predicates when revising these rules, and
do not broaden a close condition without an explicit requirement.

## Verify the result

Always run JavaScript syntax checks and parse `manifest.json`. Use `web-ext lint`
when it is already available. For logic changes, perform or clearly request the
manual Firefox scenarios listed in `AGENTS.md`; report any scenario not run.

Keep the patch focused. Update `README.md` for user-visible behavior or defaults,
and change the manifest version only as part of an explicit release task.
