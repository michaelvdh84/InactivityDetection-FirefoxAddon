console.log("Load options.js script");

// Defaults let the popup render if the background context is temporarily
// unavailable. background.js remains the authority for validation and merging.
const defaultParameters = {
    modalAfter: 60,
    popupLife: 30,
    redirectUrl: "about:blank",
    titleFR: "Inactivit&eacute; d&eacute;tect&eacute;e !",
    txtFR: "Voulez-vous maintenir la session ouverte?",
    titleNL: "Inactiviteit gedetecteerd !",
    txtNL: "Wil je de sessie open houden?",
    titleEN: "Inactivity detected !",
    txtEN: "Do you want to keep the session open?",
    hostname: "",
    ip: ""
};

const editableFieldIds = [
    "modalAfter",
    "popupLife",
    "redirectUrl",
    "titleFR",
    "txtFR",
    "titleNL",
    "txtNL",
    "titleEN",
    "txtEN"
];

const validateButton = document.getElementById("extTimeoutOptionbtn");
const refreshManagedButton = document.getElementById("refreshManagedConfigBtn");
const clearOverridesButton = document.getElementById("clearLocalOverridesBtn");
const managedConfigStatus = document.getElementById("managedConfigStatus");

validateButton.addEventListener("click", saveLocalOverrides);
refreshManagedButton.addEventListener("click", refreshManagedConfiguration);
clearOverridesButton.addEventListener("click", clearLocalOverrides);

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
    for (const [key, value] of Object.entries(result.config)) {
        const element = document.getElementById(key);
        if (element) {
            element.value = decodeHTML(String(value));
        }
    }

    const editingLocked =
        result.managedAvailable && !result.allowLocalOverrides;
    for (const fieldId of editableFieldIds) {
        document.getElementById(fieldId).disabled = editingLocked;
    }
    validateButton.disabled = editingLocked;
    clearOverridesButton.disabled = !result.localOverridesPresent;

    if (result.managedAvailable) {
        managedConfigStatus.className = "status-success";
        if (editingLocked) {
            managedConfigStatus.textContent =
                "Managed configuration loaded. Local changes are disabled.";
        } else if (result.localOverridesActive) {
            managedConfigStatus.textContent =
                "Managed configuration loaded with local overrides.";
        } else {
            managedConfigStatus.textContent = "Managed configuration loaded.";
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

async function refreshManagedConfiguration() {
    setButtonsDisabled(true);
    managedConfigStatus.className = "";
    managedConfigStatus.textContent = "Reload in progress…";

    try {
        const result = await browser.runtime.sendMessage({
            type: "refresh-managed-config"
        });
        renderConfiguration(result);
    } catch (error) {
        managedConfigStatus.className = "status-error";
        managedConfigStatus.textContent = `Reload failed: ${error.message || error}`;
    } finally {
        refreshManagedButton.disabled = false;
    }
}

async function clearLocalOverrides() {
    setButtonsDisabled(true);

    try {
        const result = await browser.runtime.sendMessage({
            type: "clear-local-overrides"
        });
        renderConfiguration(result);
    } catch (error) {
        managedConfigStatus.className = "status-error";
        managedConfigStatus.textContent = `Reset failed: ${error.message || error}`;
    } finally {
        refreshManagedButton.disabled = false;
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
        titleNL: document.getElementById("titleNL").value,
        txtNL: document.getElementById("txtNL").value,
        titleEN: document.getElementById("titleEN").value,
        txtEN: document.getElementById("txtEN").value
    };
}

function setButtonsDisabled(disabled) {
    validateButton.disabled = disabled;
    refreshManagedButton.disabled = disabled;
    clearOverridesButton.disabled = disabled;
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
