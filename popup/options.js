console.log("Load options.js script");

const defaultParameters = {
    modalAfter: 60, // Temps avant d'afficher le modal (en secondes)
    popupLife: 30,  // Durée de vie du popup (en secondes)
    redirectUrl: 'about:blank',
    titleFR: 'Inactivit&eacute; d&eacute;tect&eacute;e !',
    txtFR: 'Voulez-vous maintenir la session ouverte?',
    titleNL: 'Inactiviteit gedetecteerd !',
    txtNL: 'Wil je de sessie open houden?',
    titleEN: 'Inactivity detected !',
    txtEN: 'Do you want to keep the session open?',
    hostname: '',
    ip: ''
};

// Initialiser les paramètres par défaut si non définis
async function initializeDefaultParameters() {
    try {
        const results = await browser.storage.local.get(null);
        const missingParameters = {};

        // Vérifier si chaque clé par défaut existe, sinon l'ajouter
        for (const [key, value] of Object.entries(defaultParameters)) {
            if (!(key in results)) {
                missingParameters[key] = value;
            }
        }

        if (Object.keys(missingParameters).length > 0) {
            await browser.storage.local.set(missingParameters);
        }

        // Get existing stored values and fill in the popup form
        getSavedParameters();
    } catch (error) {
        onError(error);
    }
}

// Charger les paramètres existants et remplir le formulaire
function getSavedParameters() {
    return browser.storage.local.get(null).then((results) => {
        let keys = Object.keys(results);
        for (let key of keys) {
            let value = results[key];
            showSavedParameters(key, value);
        }
    }, onError);
}

// Afficher les paramètres dans les champs du formulaire
// function showSavedParameters(id, value) {
//     console.log("Key : " + id + " | Value : " + value);
//     const element = document.getElementById(id);
//     if (element == null) {
//         console.log("Element '" + id + "' does not exist");
//     } else {
//         element.value = value;
//     }
// }

function showSavedParameters(id, value) {
    console.log("Key : " + id + " | Value : " + value);
    const element = document.getElementById(id);
    if (element == null) {
        console.log("Element '" + id + "' does not exist");
    } else {
        element.value = decodeHTML(value); // Decode HTML entities before displaying
    }
}


// Enregistrer les modifications apportées par l'utilisateur
var btnTimeoutModifier = document.getElementById("extTimeoutOptionbtn");
btnTimeoutModifier.addEventListener("click", function () {
    console.log("Clicked on button");

    const modalAfter = document.getElementById("modalAfter").value;
    const popupLife = document.getElementById("popupLife").value;
    const redirectUrlInput = document.getElementById("redirectUrl");
    const redirectUrl = normalizeRedirectUrl(redirectUrlInput.value);
    const titleFR = document.getElementById("titleFR").value;
    const titleNL = document.getElementById("titleNL").value;
    const titleEN = document.getElementById("titleEN").value;
    const txtFR = document.getElementById("txtFR").value;
    const txtNL = document.getElementById("txtNL").value;
    const txtEN = document.getElementById("txtEN").value;

    if (!redirectUrl) {
        alert("Redirect URL must be an absolute HTTP(S) URL or about:blank.");
        redirectUrlInput.focus();
        return;
    }

    const modalAfterSeconds = Number(modalAfter);
    const popupLifeSeconds = Number(popupLife);
    if (
        !Number.isFinite(modalAfterSeconds) ||
        !Number.isFinite(popupLifeSeconds) ||
        modalAfterSeconds <= 0 ||
        popupLifeSeconds <= 0
    ) {
        alert("Timeout values must be greater than zero.");
        return;
    }

    let paramToStore = {
        modalAfter: modalAfterSeconds,
        popupLife: popupLifeSeconds,
        redirectUrl: redirectUrl,
        titleFR: titleFR,
        titleNL: titleNL,
        titleEN: titleEN,
        txtFR: txtFR,
        txtNL: txtNL,
        txtEN: txtEN
    };

    console.log("Show Modal after : " + modalAfter);
    console.log("Popup life : " + popupLife);

    // Enregistrer les champs modifiés
    //browser.storage.local.set(paramToStore);
    browser.storage.local.set(paramToStore).then(() => {
        console.log("Parameters saved successfully!");
        alert("Settings have been updated.");
    });
});

const importNativeConfigButton = document.getElementById("importNativeConfigBtn");
const nativeConfigStatus = document.getElementById("nativeConfigStatus");

importNativeConfigButton.addEventListener("click", async function () {
    importNativeConfigButton.disabled = true;
    nativeConfigStatus.className = "";
    nativeConfigStatus.textContent = "Import in progress…";

    try {
        const result = await browser.runtime.sendMessage({ type: "refresh-native-config" });
        if (!result?.ok) {
            throw new Error(result?.error || "The native host did not return a configuration.");
        }

        await getSavedParameters();
        nativeConfigStatus.className = "status-success";
        nativeConfigStatus.textContent = `Imported from ${result.hostname || "unknown host"} (${result.ip || "no IP"}).`;
    } catch (error) {
        nativeConfigStatus.className = "status-error";
        nativeConfigStatus.textContent = `Import failed: ${error.message || error}`;
    } finally {
        importNativeConfigButton.disabled = false;
    }
});

// Gérer les erreurs
function onError(error) {
    console.log(error);
}

function decodeHTML(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
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
        console.log(error);
    }

    return null;
}

// Initialiser les paramètres par défaut au chargement
initializeDefaultParameters();
