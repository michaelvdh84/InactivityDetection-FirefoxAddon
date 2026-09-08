---
name: maintain-firefox-inactivity-extension
description: Maintain and troubleshoot this repository's Firefox Manifest V3 inactivity extension, including timers, session-data cleanup, redirects, multilingual options, storage keys, and itsme/FAS URL exceptions. Use for code, configuration, review, or release work in this repository; do not use for unrelated Firefox extensions.
---

# Maintain the Firefox inactivity extension

Use this skill for changes to the extension in this repository. Read
`AGENTS.md` first, then inspect the files involved in the requested behavior.

## Establish the affected flow

Trace changes through the smallest relevant path:

- Idle detection: `manifest.json` -> `timeoutModal.js` ->
  `inactivityplugin.css`.
- Session reset: Dynamics `data-logout-url` detection in `timeoutModal.js` ->
  runtime `reset-session` message -> remote logout in `background.js` ->
  `reset.html` -> `browsingData.remove()` -> configured `redirectUrl`.
- Settings or defaults: `popup/options.html` -> `popup/options.js` ->
  `browser.storage.local` reads in `timeoutModal.js`.
- Language: the page's `iclangplug` query parameter -> stored `epnLang` ->
  `titleFR`/`txtFR`, `titleNL`/`txtNL`, or `titleEN`/`txtEN` -> modal text.
- Site exception: evaluate the ordered itsme/FAS URL branches in
  `timeoutModal.js` before changing general timer startup.
- Packaging or permissions: `manifest.json`, with corresponding user-facing
  documentation in `README.md` when behavior changes.

Do not assume a bundler, dependency manifest, or automated test harness; none
currently exists. Firefox runs `background.js` as a non-persistent Manifest V3
background script.

## Preserve the timing contract

Storage and the options UI express `modalAfter` and `popupLife` in seconds.
Timer APIs use milliseconds. Keep that conversion explicit and keep fallback
defaults synchronized between the options code and the content script.

Any timer refactor must maintain these transitions:

```text
configured start page -> keep inactivity detection disabled
navigation to another page -> start idle detection
page activity -> reset idle period
idle period expires -> show one confirmation modal
Continue -> remove modal + cancel close timeout + restart idle period
Exit or grace expiry -> request cleanup -> redirect
```

Audit interval, timeout, modal, message, and listener cleanup together. Test
with small durations so a duplicate timer, modal, or reset is observable.
Compare the current URL with `redirectUrl` using only the HTTP(S) origin and
normalized pathname. Ignore all query parameters, fragments, and trailing slash
differences. Do not register activity listeners on that page and do not persist
a global "session started" flag: navigation away from the configured start page
is enough for the next content script instance to start its timer normally.

## Preserve the reset contract

Keep the reset sequence ordered and fail closed:

1. Resolve and validate `redirectUrl`, falling back to `about:blank`.
2. If the page supplies a same-origin HTTP(S) Dynamics logout URL, navigate to
   it and wait for its redirect chain to finish while cookies still exist.
3. Move the requesting tab to `reset.html` and wait for the previous site to
   unload.
4. Clear normal web data without clearing extension storage.
5. Navigate to the configured URL only after cleanup succeeds.

Do not navigate to the portal after a cleanup error; doing so can expose the
next kiosk user to stale authentication state. Keep cleanup deduplicated per
tab. Treat remote logout as best-effort so an unavailable endpoint cannot skip
local cleanup. Changes to the global cleanup scope require explicit review
because they affect every normal website in the Firefox profile.

## Preserve compatibility and page safety

- Retain Firefox's promise-based `browser.storage.local` usage.
- Keep existing storage keys compatible unless the task includes migration.
- Accept only absolute HTTP(S) redirect URLs or `about:blank`; never permit
  `javascript:`, `data:`, or arbitrary local-file redirects.
- Accept a DOM-provided logout URL only when it resolves to HTTP(S) on the
  current page's origin. Revalidate it in `background.js`; never trust a URL
  supplied by a content script based solely on its DOM checks.
- Insert configurable title and message values with `textContent`, never
  `innerHTML`; legacy stored strings may contain HTML entities and can be
  decoded before safe insertion.
- Remember that the content script matches all URLs. Avoid page-specific DOM
  assumptions outside the explicit exceptions, and avoid disturbing host-page
  event handlers when changing activity detection.
- Treat the CSS entry in `manifest.json` as the only stylesheet injection path.
- Keep injected modal IDs/classes aligned with `inactivityplugin.css`.
- Keep privileged cleanup and tab navigation in `background.js`; content scripts
  should only send the reset request.

## Handle site exceptions deliberately

Before editing URL matching, verify all three existing behaviors:

- On `itsme.be`, start detection only if `#phoneForm` is present.
- On the production and integration FAS OAuth authorization URLs, do not start
  detection during automatic redirection.
- On the exact production and integration `/fasui/itsme/refused` URLs, reset the
  session immediately.

Prefer URL parsing or narrowly scoped predicates when revising these rules, and
do not broaden a close condition without an explicit requirement.

## Verify the result

Always run JavaScript syntax checks, including `background.js`, and parse
`manifest.json`. Use `web-ext lint`
when it is already available. For logic changes, perform or clearly request the
manual Firefox scenarios listed in `AGENTS.md`; report any scenario not run.

Keep the patch focused. Update `README.md` for user-visible behavior or defaults,
and change the manifest version only as part of an explicit release task.
