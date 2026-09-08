# EPN Inactivity Detection Extension for Firefox

## Description

The EPN Inactivity Detection extension monitors activity in Firefox and displays a confirmation modal after a configured period of inactivity. If the user does not respond before the modal expires, the extension clears browsing-session data and redirects the tab to a configured URL.

### Key Features:
- Set the inactivity period after which the popup is displayed.
- Define the popup's lifetime before the session is reset.
- Redirect to a configurable URL after each reset.
- Clear cookies, cache, site storage, browsing history, form data, and download history without closing Firefox.
- Multilingual support for popup messages (French, Dutch, English).
- Customizable popup messages and titles for each language.
- Firefox Manifest V3 extension.

## Installation

1. Clone or download this repository.
2. Open Firefox and navigate to `about:debugging`.
3. Click on **This Firefox** and then **Load Temporary Add-on**.
4. Select the `manifest.json` file from the project directory.

## Usage

1. Open the extension's options page by clicking on the extension icon in the toolbar.
2. Configure the following settings:
   - **Inactivity Period**: Time (in seconds) before the popup is displayed.
   - **Popup Lifetime**: Time (in seconds) before the session is reset if no action is taken.
   - **Redirect URL**: Absolute HTTP(S) URL loaded after cleanup. The default is `about:blank`.
   - **Popup Messages**: Customize the title and message for each supported language (FR, NL, EN).
3. Save your settings by clicking the **Validate** button.

The redirect URL must use `http://` or `https://`; `about:blank` is also accepted as a safe fallback.

## Session reset

The reset is triggered by the **Exit** button, expiry of the modal's grace period, or the existing FAS `itsme/refused` exception.

The extension performs the following sequence:

1. Navigate the active tab to the packaged `reset.html` page so the previous website can no longer recreate session data.
2. Clear normal website data through Firefox's `browsingData` API.
3. Navigate the same tab to the configured redirect URL.

The reset clears:

- cookies;
- browser cache;
- `localStorage` and `sessionStorage`;
- IndexedDB;
- service worker registrations and cached data;
- browsing history;
- saved form data;
- download history.

Downloaded files and saved passwords are not deleted. The extension's own `browser.storage.local` data is preserved, including timeouts, translations, language, and redirect URL.

The cleanup is browser-wide for normal web content in the current Firefox profile. For kiosk use, dedicate the profile to the portal and avoid unrelated browsing in that profile.

Clearing client-side data does not revoke a server-side SSO or OAuth session. If the portal exposes a logout or token-revocation endpoint, invoke it before cleanup when a server-side logout is required.

## Permissions

- `storage`: saves the extension configuration.
- `tabs`: moves the tab to the reset page and then to the configured destination.
- `browsingData`: removes normal website session and browsing data.
- `activeTab`: retained for compatibility with the existing toolbar workflow.

## Improvements

### Recent Updates:
- **08-09-2026**:
  - Migrated the extension to Firefox Manifest V3.
  - Added a configurable session redirect URL.
  - Replaced automatic window closing with browser-data cleanup and redirection.
  - Added an extension background script and an intermediate reset page.
- **02-05-2025**:
  - Refactored promises for better readability.
  - Added default values for `showModal`, `popupLife`, `title`, and `message`.
  - Enhanced modal window with rounded corners and shadows.
  - Replaced `innerHTML` usage for improved security.
  - Added multilingual buttons for "Continue" and "Close".

## Bug Fixes

- **12-05-2025**: Add Default `defaultMessage` and `defaultModalTitle` in timeoutModal.js, without this, it finds nothing in memory, as there is no parameter validation via the extension interface.
- **07-05-2025**: Decoded HTML entities and updated `modalText.id` to `askingInactivity`.
- **29-12-2022**: Added parameters for EPNLauncher language detection, multilingual functionality, and fixed itsme timer conflict.
- **07-12-2022**: Added timeout for itsme and exceptions for CSAM Authorized URLs.
- **05-12-2022**: Fixed redirection issues for URLs containing `idp.iamfas`.
- **03-12-2022**: Resolved timer conflicts for `itsme.be` and renamed modal selectors for `MyBXL.be`.
- **02-12-2022**: Fixed timer issues when the modal is displayed.

## Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and push them to your fork.
4. Submit a pull request with a detailed description of your changes.

## Authors

- [@michaelvdh84](https://github.com/michaelvdh84)

## License

This project is licensed under the GNU General Public License v3.0. See the `LICENSE` file for details.
