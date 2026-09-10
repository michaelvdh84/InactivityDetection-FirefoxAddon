let timer, currSeconds = 0;
let sessionResetRequested = false;
let activityDetectionEnabled = false;
let effectiveConfiguration = null;

const activityEvents = [
    "mousemove",
    "mousedown",
    "touchstart",
    "click",
    "keypress"
];

//This is the GET value passed by the EPNLauncher to define the language
const epnAutoParamLang = "iclangplug";

//This function resets the timer if an activity is detected
function resetTimer() {

    console.log("Reset Counter !");
    clearInterval(timer);

    currSeconds = 0;
    /* Set a new interval */
    timer = setInterval(function () {
        showModal(effectiveConfiguration);
    }, 1000);
}

function enableActivityDetection() {
    if (activityDetectionEnabled) {
        return;
    }

    activityDetectionEnabled = true;
    for (const eventName of activityEvents) {
        window.addEventListener(eventName, resetTimer);
    }
    resetTimer();
}

// WARNING : Promise = cascade function processing
// The popup will be displayed by calling "popupLife" function
function startIdleTimer(allowedIdleTime) {
              
    currSeconds+= 1000;
    console.log(currSeconds+"ms");

    if (currSeconds == allowedIdleTime ) {      
        console.log("Idle Time need to show modal");
        // SHOW MODAL WINDOW
        popupLife(effectiveConfiguration);
    }
}

// Reset the timer and reset the global timer when the user clicks on "Continue"
function hidePrompt(counter) {
    console.log("Clicked on 'Continuer' ");
    document.getElementById("modalJS").remove()

    clearTimeout(counter);
    resetTimer();
}

// Get the current URL
var currentUrl = document.URL;
console.log("Current URL : " + currentUrl);

//Define a new URL Object
const curl = new URL(currentUrl);


//Check if the EPNLaunche Language is defined
if (curl.searchParams.has(epnAutoParamLang)) {
    console.log("Language parameter found !");
    var params = curl.search;
    const urlParams = new URLSearchParams(params);
    launcherLang = urlParams.get(epnAutoParamLang);

    let epnLang = {};
    epnLang["epnLang"] = launcherLang;
    // Store the EPNLauncher value
    browser.storage.local.set(epnLang);
    console.log("EPN Launcher Language: " + launcherLang);
}

var urlContains = "itsme.be"

//var urlItsMe = "https://merchant.itsme.be/oidc/authorization/phone/confirmation"
var fasUrl = "idp.iamfas"

// Fix Itsme bug
// If the element "phoneForm" is found on the itsme.be website, the timer executed
if (currentUrl.includes(urlContains)) {
    console.log("It's Me Site !");
    var phoneForm = document.getElementById('phoneForm');
    if (phoneForm != null) {
        loadEffectiveConfiguration().then(enableActivityDetection, (error) => {
            onError(error);
        });
    }

} else if ((currentUrl.includes("https://idp.iamfas.belgium.be/fas/oauth2/authorize")) || (currentUrl.includes("https://idp.iamfas.int.belgium.be/fas/oauth2/authorize"))) {
    //Disable the timer when there is a auto redirection
    console.log("FAS Redirection, stop timeout");
}
else if ((currentUrl == "https://idp.iamfas.int.belgium.be/fasui/itsme/refused") || (currentUrl == "https://idp.iamfas.belgium.be/fasui/itsme/refused")) {
    //This condition is to fix the second itsme bug
    //There is already a JS timer when you validate you phone number on itsme and it causes a conflict
    //The bug is bypassed by resetting the session if the URL corresponds to xxxxxx/fasui/itsme/refused

    console.log("itsme refused, reset session !");
    requestSessionReset();
}
else {
    loadEffectiveConfiguration().then((config) => {
        if (isConfiguredStartPage(currentUrl, config.redirectUrl)) {
            console.log("Start page detected, inactivity timer disabled.");
        } else {
            enableActivityDetection();
        }
    }, (error) => {
        onError(error);
    });
}

async function loadEffectiveConfiguration() {
    try {
        const result = await browser.runtime.sendMessage({
            type: "get-effective-config"
        });
        if (!result?.ok || !isCompleteConfiguration(result.config)) {
            throw new Error("The background returned an incomplete configuration.");
        }

        effectiveConfiguration = result.config;
        return effectiveConfiguration;
    } catch (error) {
        // Keep the last resolved local values usable if the background context
        // cannot answer during browser startup.
        onError(error);
        const storedConfiguration = await browser.storage.local.get(null);
        if (!isCompleteConfiguration(storedConfiguration)) {
            throw new Error("No complete inactivity configuration is available.");
        }
        effectiveConfiguration = storedConfiguration;
        return effectiveConfiguration;
    }
}

function isCompleteConfiguration(config) {
    const requiredTextKeys = [
        "redirectUrl",
        "titleFR",
        "txtFR",
        "titleNL",
        "txtNL",
        "titleEN",
        "txtEN"
    ];

    return Boolean(
        config &&
        Number.isFinite(Number(config.modalAfter)) &&
        Number(config.modalAfter) > 0 &&
        Number.isFinite(Number(config.popupLife)) &&
        Number(config.popupLife) > 0 &&
        requiredTextKeys.every((key) => typeof config[key] === "string")
    );
}

// Options-page saves are resolved by the background into these top-level local
// keys. Reflect them in already loaded pages without restarting their timer.
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !effectiveConfiguration) {
        return;
    }

    for (const [key, change] of Object.entries(changes)) {
        if (key in effectiveConfiguration && change.newValue !== undefined) {
            effectiveConfiguration[key] = change.newValue;
        }
    }
});

//Promise
function showModal(item) {
    const showModalAfter = item.modalAfter * 1000; // Convert to milliseconds
    console.log("ShowModal After : " + showModalAfter);
    startIdleTimer(showModalAfter);
}

// //Promise
function popupLife(item) {
    var showPopupLife = item.popupLife * 1000;
    console.log("Popup Life : " + showPopupLife)
     //console.log("Popup Life : " + popupLife)
     getModalParameters(showPopupLife);

}

function logItem () {
    console.log("Ok !");
}

function onError(error) {
    console.log(error);
}

function isConfiguredStartPage(pageUrl, redirectUrl) {
    if (!redirectUrl || redirectUrl === "about:blank") {
        return false;
    }

    try {
        const page = new URL(pageUrl);
        const startPage = new URL(redirectUrl);

        if (
            !["http:", "https:"].includes(page.protocol) ||
            !["http:", "https:"].includes(startPage.protocol)
        ) {
            return false;
        }

        return (
            page.origin === startPage.origin &&
            normalizePathname(page.pathname) ===
                normalizePathname(startPage.pathname)
        );
    } catch (error) {
        onError(error);
        return false;
    }
}

function normalizePathname(pathname) {
    if (pathname.length <= 1) {
        return pathname;
    }

    return pathname.replace(/\/+$/, "");
}

function requestSessionReset() {
    if (sessionResetRequested) {
        return;
    }

    sessionResetRequested = true;
    clearInterval(timer);

    browser.runtime.sendMessage({
        type: "reset-session",
        logoutUrl: getPortalLogoutUrl()
    }).then((response) => {
        if (!response?.ok) {
            sessionResetRequested = false;
            onError(response?.error ?? "Session reset failed.");
        }
    }, (error) => {
        sessionResetRequested = false;
        onError(error);
    });
}

function getPortalLogoutUrl() {
    const logoutButton = document.querySelector(
        "#header-sign-out[data-logout-url]"
    );

    if (!logoutButton) {
        return null;
    }

    try {
        const logoutUrl = new URL(logoutButton.dataset.logoutUrl, window.location.href);

        if (
            (logoutUrl.protocol === "http:" || logoutUrl.protocol === "https:") &&
            logoutUrl.origin === window.location.origin
        ) {
            return logoutUrl.href;
        }
    } catch (error) {
        onError(error);
    }

    return null;
}


async function getModalParameters(timer) {
    try {
        const { epnLang } = await browser.storage.local.get("epnLang");
        console.log("Debug valueEpnLang:", epnLang);

        let languageKey = "txtFR"; // Default language is French
        let languageTitleKey = "titleFR"; // Default title is French
        let language = "fr"; // Default language is French
        if (epnLang) {
            if (epnLang.includes("nl")) {
                languageKey = "txtNL";
                languageTitleKey = "titleNL";
                language = "nl";
            } else if (epnLang.includes("en")) {
                languageKey = "txtEN";
                languageTitleKey = "titleEN";
                language = "en";
            } else if (epnLang.includes("fr")) {
                languageKey = "txtFR";
                languageTitleKey = "titleFR";
                language = "fr";
            }
        }
        // Read the texts from the same resolved object as the timers. This
        // prevents a managed delay from being mixed with stale local labels.
        const modalText = effectiveConfiguration[languageKey];
        const modalTitle = effectiveConfiguration[languageTitleKey];
        console.log(`Show modal in ${languageKey}:`, modalText);

        // Call the appropriate function to display the modal
        htmlModal(modalText, modalTitle, language, timer);
    } catch (error) {
        onError(error);
    }
}

function htmlModal(txt, title, language, graceIdleTime) {
    console.log("HTMLContent function:", txt);

    // Grace period timer
    const graceCounter = setTimeout(() => {
        console.log("Grace period expired");
        requestSessionReset();
    }, graceIdleTime);

    if (language == "fr") {
        var contButton = "Continuer";
        var exitButton = "Quitter";
    }

    if (language == "nl") {
        var contButton = "Doorgaan";
        var exitButton = "Afsluiten";
    }

    if (language == "en") {
        var contButton = "Continue";
        var exitButton = "Exit";
    }
    // Créer les éléments DOM manuellement
    //const lineBreak = document.createElement("br"); // Saut à la ligne

    const modal = document.createElement("div");
    modal.id = "modalJS";
    modal.className = "modal-timeout";

    const modalContent = document.createElement("div");
    modalContent.className = "modal-content-timeout";

    const modalTitle = document.createElement("h1");
    modalTitle.id = "titleInactivity";
    modalTitle.textContent = decodeHTML(title);

    const modalText = document.createElement("p");
    modalText.id = "askingInactivity";
    modalText.textContent = decodeHTML(txt);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.textAlign = "center";
    buttonContainer.style.display = "flex"; // Utilisation de Flexbox
    buttonContainer.style.justifyContent = "center"; // Centrer les boutons
    buttonContainer.style.gap = "60px"; // Ajout d'un espace de 20px entre les boutons
    
    const continueButton = document.createElement("button");
    continueButton.id = "continuerTimeout";
    continueButton.className = "buttonTimeOut";
    continueButton.textContent = contButton;

    const closeButton = document.createElement("button");
    closeButton.className = "buttonTimeOut";
    closeButton.textContent = exitButton;
    closeButton.onclick = requestSessionReset;

    // Assembler les éléments
    buttonContainer.appendChild(continueButton);
    buttonContainer.appendChild(closeButton);
    modalContent.appendChild(modalTitle);
    modalContent.appendChild(modalText);
    modalContent.appendChild(buttonContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Ajouter l'événement au bouton "Continue"
    continueButton.addEventListener("click", () => hidePrompt(graceCounter), false);
}

function decodeHTML(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
    return textarea.value;
}
