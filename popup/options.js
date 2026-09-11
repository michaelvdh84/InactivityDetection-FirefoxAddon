console.log("Load options.js script");

// Defaults let the popup render if the background context is temporarily
// unavailable. background.js remains the authority for validation and merging.
const defaultParameters = {
    modalAfter: 60,
    popupLife: 30,
    redirectUrl: "about:blank",
    titleFR: "Inactivité détectée",
    txtFR: "Vous n'avez plus interagi avec la borne depuis un certain temps.\nSouhaitez-vous continuer à l'utiliser ?",
    btnContinueFR: "Oui, continuer ma session",
    btnQuitFR: "Non, quitter",
    titleNL: "Inactiviteit gedetecteerd",
    txtNL: "U hebt de kiosk al enige tijd niet meer gebruikt.\nWilt u deze blijven gebruiken?",
    btnContinueNL: "Ja, mijn sessie voortzetten",
    btnQuitNL: "Nee, afsluiten",
    titleEN: "Inactivity detected",
    txtEN: "You have not interacted with the kiosk for some time.\nWould you like to continue using it?",
    btnContinueEN: "Yes, continue my session",
    btnQuitEN: "No, exit",
    kioskRestrictionsEnabled: true,
    hostname: "",
    ip: ""
};

const editableFieldIds = [
    "modalAfter",
    "popupLife",
    "redirectUrl",
    "kioskRestrictionsEnabled",
    "titleFR",
    "txtFR",
    "btnContinueFR",
    "btnQuitFR",
    "titleNL",
    "txtNL",
    "btnContinueNL",
    "btnQuitNL",
    "titleEN",
    "txtEN",
    "btnContinueEN",
    "btnQuitEN"
];

const validateButton = document.getElementById("extTimeoutOptionbtn");
const unlockConfigButton = document.getElementById("unlockConfigBtn");
const useManagedValuesButton = document.getElementById("useManagedValuesBtn");
const managedConfigStatus = document.getElementById("managedConfigStatus");
const kioskRestrictionsSummary = document.getElementById("kioskRestrictionsSummary");
let currentConfigurationState = null;

validateButton.addEventListener("click", saveLocalOverrides);
unlockConfigButton.addEventListener("click", unlockConfiguration);
useManagedValuesButton.addEventListener("click", useManagedValues);

async function loadEffectiveConfiguration() {
    try {
        const result = await browser.runtime.sendMessage({
            type: "get-effective-config"
        });
        renderConfiguration(result);
    } catch (error) {
        // Managed storage is read-only. If the background is unavailable, only
        // display the already resolved local values; do not attempt a write.
        onError(error);
        const stored = await browser.storage.local.get(null);
        renderConfiguration({
            ok: true,
            config: { ...defaultParameters, ...stored },
            managedAvailable: false,
            managedError: error.message || String(error),
            allowLocalOverrides: true,
            localOverridesActive: Boolean(stored.localOverrides),
            localOverridesPresent: Boolean(stored.localOverrides)
        });
    }
}

function renderConfiguration(result) {
    currentConfigurationState = result;

    for (const [key, value] of Object.entries(result.config)) {
        const element = document.getElementById(key);
        if (element) {
            if (key === "kioskRestrictionsEnabled") {
                element.checked = Boolean(value);
            } else if (key !== "kioskRestrictions") {
                element.value = decodeHTML(String(value));
            }
        }
    }
    renderKioskRestrictionsSummary(result.config.kioskRestrictions);

    // Configuration always opens in read-only mode. Editing requires an
    // explicit user action so merely opening the popup cannot create an
    // accidental local override.
    setEditableFieldsDisabled(true);
    validateButton.disabled = true;
    unlockConfigButton.disabled =
        result.managedAvailable && !result.allowLocalOverrides;
    useManagedValuesButton.disabled = !result.managedAvailable;

    if (result.managedAvailable) {
        managedConfigStatus.className = "status-success";
        if (!result.allowLocalOverrides) {
            managedConfigStatus.textContent =
                "Managed Configuration Loaded — local changes are disabled.";
        } else if (result.localOverridesActive) {
            managedConfigStatus.textContent =
                "Managed Configuration Loaded — local override active.";
        } else {
            managedConfigStatus.textContent = "Managed Configuration Loaded";
        }
    } else {
        managedConfigStatus.className = result.managedError ? "status-error" : "";
        managedConfigStatus.textContent = result.managedError
            ? `Managed configuration unavailable: ${result.managedError}`
            : "No managed configuration found. Local settings are in use.";
    }
}

async function saveLocalOverrides() {
    try {
        const config = readAndValidateForm();
        const result = await browser.runtime.sendMessage({
            type: "save-local-overrides",
            config
        });
        renderConfiguration(result);
        alert("Local settings have been updated.");
    } catch (error) {
        alert(error.message || String(error));
    }
}

function unlockConfiguration() {
    if (
        currentConfigurationState?.managedAvailable &&
        !currentConfigurationState.allowLocalOverrides
    ) {
        managedConfigStatus.className = "status-error";
        managedConfigStatus.textContent =
            "Managed Configuration Loaded — local changes are disabled.";
        return;
    }

    setEditableFieldsDisabled(false);
    validateButton.disabled = false;
    managedConfigStatus.className = "";
    managedConfigStatus.textContent =
        "Configuration unlocked. Validate to save a local override.";
}

async function useManagedValues() {
    setButtonsDisabled(true);

    try {
        // Managed storage itself is read-only. Removing localOverrides makes
        // the background resolve and expose the managed values again.
        const result = await browser.runtime.sendMessage({
            type: "clear-local-overrides"
        });
        renderConfiguration(result);
    } catch (error) {
        if (currentConfigurationState) {
            renderConfiguration(currentConfigurationState);
        }
        managedConfigStatus.className = "status-error";
        managedConfigStatus.textContent =
            `Unable to use managed values: ${error.message || error}`;
    }
}

function readAndValidateForm() {
    const modalAfter = Number(document.getElementById("modalAfter").value);
    const popupLife = Number(document.getElementById("popupLife").value);
    const redirectUrlInput = document.getElementById("redirectUrl");
    const redirectUrl = normalizeRedirectUrl(redirectUrlInput.value);

    if (!Number.isFinite(modalAfter) || modalAfter <= 0 ||
        !Number.isFinite(popupLife) || popupLife <= 0) {
        throw new Error("Timeout values must be greater than zero.");
    }

    if (!redirectUrl) {
        redirectUrlInput.focus();
        throw new Error(
            "Redirect URL must be an absolute HTTP(S) URL or about:blank."
        );
    }

    return {
        modalAfter,
        popupLife,
        redirectUrl,
        titleFR: document.getElementById("titleFR").value,
        txtFR: document.getElementById("txtFR").value,
        btnContinueFR: document.getElementById("btnContinueFR").value,
        btnQuitFR: document.getElementById("btnQuitFR").value,
        titleNL: document.getElementById("titleNL").value,
        txtNL: document.getElementById("txtNL").value,
        btnContinueNL: document.getElementById("btnContinueNL").value,
        btnQuitNL: document.getElementById("btnQuitNL").value,
        titleEN: document.getElementById("titleEN").value,
        txtEN: document.getElementById("txtEN").value,
        btnContinueEN: document.getElementById("btnContinueEN").value,
        btnQuitEN: document.getElementById("btnQuitEN").value,
        kioskRestrictionsEnabled: document.getElementById("kioskRestrictionsEnabled").checked
    };
}

function renderKioskRestrictionsSummary(rules) {
    kioskRestrictionsSummary.replaceChildren();

    for (const rule of Array.isArray(rules) ? rules : []) {
        const item = document.createElement("li");
        const state = rule.enabled ? "enabled" : "disabled";
        const hostnames = Array.isArray(rule.hostnames) ? rule.hostnames.join(", ") : "";
        const pathPrefixes = Array.isArray(rule.pathPrefixes) ? rule.pathPrefixes.join(", ") : "";
        item.textContent = `${rule.id} (${state}) — Hosts: ${hostnames}; Paths: ${pathPrefixes}`;
        kioskRestrictionsSummary.appendChild(item);
    }
}

function setButtonsDisabled(disabled) {
    validateButton.disabled = disabled;
    unlockConfigButton.disabled = disabled;
    useManagedValuesButton.disabled = disabled;
}

function setEditableFieldsDisabled(disabled) {
    for (const fieldId of editableFieldIds) {
        document.getElementById(fieldId).disabled = disabled;
    }
}

function decodeHTML(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
}

function normalizeRedirectUrl(value) {
    const candidate = value.trim();
    if (candidate === "about:blank") {
        return candidate;
    }

    try {
        const parsedUrl = new URL(candidate);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
            return parsedUrl.href;
        }
    } catch (error) {
        onError(error);
    }

    return null;
}

function onError(error) {
    console.error(error);
}

loadEffectiveConfiguration();
