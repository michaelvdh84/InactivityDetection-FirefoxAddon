let timer, currSeconds = 0;
let sessionResetRequested = false;
let url, timeout;

//This is the GET value passed by the EPNLauncher to define the language
let epnAutoParamLang = "iclangplug";

//Inject Custom CSS file
function loadCSS() {
    var cssId = 'InactivityExtCSS';  
    if (!document.getElementById(cssId))
    {
        var head  = document.getElementsByTagName('head')[0];
        var link  = document.createElement('link');
        link.id   = cssId;
        link.rel  = 'stylesheet';
        link.type = 'text/css';
        link.href = 'style.css';
        link.media = 'all';
        head.appendChild(link);
    }
}

//This function resets the timer if an activity is detected
function resetTimer() {

    console.log("Reset Counter !");
    clearInterval(timer);

    currSeconds = 0;
    modalTime = browser.storage.local.get("modalAfter")
    //console.log("Show Modal Popup After :" + modalTime)
    /* Set a new interval */
    timer = 
        setInterval(function () {
        browser.storage.local.get("modalAfter").then(showModal, onError);
    }, 1000);
}

// function resetTimer() {
//     console.log("Reset Counter !");
//     clearInterval(timer);

//     currSeconds = 0;

//     // Resolve the Promise to get the value of "modalAfter"
//     browser.storage.local.get("modalAfter").then((result) => {
//         // Assign a default value of 10 seconds if modalAfter is undefined
//         const modalTime = result.modalAfter ?? 60; // Default to 10 seconds
//         console.log("Show Modal Popup After :" + modalTime);

//         /* Set a new interval */
//         timer = setInterval(function () {
//             browser.storage.local.get("modalAfter").then(showModal, onError);
//         }, 1000);
//     }).catch(onError);
// }

// WARNING : Promise = cascade function processing  
// The popup will be displayed by calling "popupLife" function
function startIdleTimer(allowedIdleTime) {
              
    currSeconds+= 1000;
    console.log(currSeconds+"ms");

    if (currSeconds == allowedIdleTime ) {      
        console.log("Idle Time need to show modal");
        // SHOW MODAL WINDOW
        browser.storage.local.get("popupLife").then(popupLife, onError);
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
        resetTimer();
        loadCSS();
        window.onload = resetTimer;
        window.onmousemove = resetTimer;
        window.onmousedown = resetTimer;
        window.ontouchstart = resetTimer;
        window.onclick = resetTimer;
        window.onkeypress = resetTimer;
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
    resetTimer();
    loadCSS()
    window.onload = resetTimer;
    window.onmousemove = resetTimer;
    window.onmousedown = resetTimer;
    window.ontouchstart = resetTimer;
    window.onclick = resetTimer;
    window.onkeypress = resetTimer;
}

//Promise
function showModal(item) {
    const modalAfter = item.modalAfter ?? 60; // Default to 60 seconds
    const showModalAfter = modalAfter * 1000; // Convert to milliseconds
    console.log("ShowModal After : " + showModalAfter);
    startIdleTimer(showModalAfter);
}

// //Promise
function popupLife(item) {
    const popupLife = item.popupLife ?? 30; // Default to 60 seconds
    var showPopupLife = popupLife * 1000;
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
        //add default value if no value
        let defaultModalTitle = "Inactivit&eacute; d&eacute;tect&eacute;e !";
        let defaultMessage = "Voulez-vous maintenir la session ouverte ?";

        if (epnLang) {
            if (epnLang.includes("nl")) {
                languageKey = "txtNL";
                languageTitleKey = "titleNL";
                language = "nl";
                defaultMessage = "Wil je de sessie open houden ?";
                defaultModalTitle = "Inactiviteit gedetecteerd !";
            } else if (epnLang.includes("en")) {
                languageKey = "txtEN";
                languageTitleKey = "titleEN";
                language = "en";
                defaultMessage = "Do you want to keep the session open?";
                defaultModalTitle = "Inactivity detected !";
            } else if (epnLang.includes("fr")) {
                languageKey = "txtFR";
                languageTitleKey = "titleFR";
                language = "fr";
                defaultModalTitle = "Inactivit&eacute; d&eacute;tect&eacute;e !";
                defaultMessage = "Voulez-vous maintenir la session ouverte ?";
            }
        }
        const textData = await browser.storage.local.get(languageKey);
        const titleData = await browser.storage.local.get(languageTitleKey);
        const modalText = textData[languageKey] ?? defaultMessage;
        const modalTitle = titleData[languageTitleKey] ?? defaultModalTitle;
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
