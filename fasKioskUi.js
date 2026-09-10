(function () {
    "use strict";

    const fasHosts = new Set([
        "idp.iamfas.belgium.be",
        "idp.iamfas.int.belgium.be"
    ]);

    const kioskChromeSelector = [
        "header",
        "#header",
        ".header",
        ".navbar",
        ".csam-header",
        "[role='banner']",
        "footer",
        "#footer",
        ".footer",
        ".csam-footer-container",
        ".csam-footer-content-container",
        "[role='contentinfo']",
        "video",
        ".video-preview-btn",
        "iframe[src*='youtube.com' i]",
        "iframe[src*='youtube-nocookie.com' i]",
        "iframe[src*='youtu.be' i]",
        "iframe[src*='vimeo.com' i]",
        "a[href*='sma-help.bosa.belgium.be' i]",
        "[id*='video' i]",
        "[class*='video' i]"
    ].join(",");

    const helpControlSelector = "a,button,[role='link']";
    const helpLabels = [
        "besoin d'aide",
        "need help",
        "hulp nodig",
        "hilfe"
    ];

    function isFasKioskPage(pageUrl) {
        try {
            const url = new URL(pageUrl);
            const normalizedPath = url.pathname.toLowerCase();

            return (
                url.protocol === "https:" &&
                fasHosts.has(url.hostname.toLowerCase()) &&
                (normalizedPath === "/fas/xui" ||
                    normalizedPath.startsWith("/fas/xui/"))
            );
        } catch (error) {
            return false;
        }
    }

    function normalizeLabel(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[’`]/g, "'")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function isHelpControl(element) {
        const labels = [
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title")
        ].map(normalizeLabel);

        return labels.some((label) =>
            helpLabels.some((helpLabel) => label.includes(helpLabel))
        );
    }

    function hideElement(element) {
        if (element.getAttribute("data-inactivity-plugin-hidden") === "true") {
            return false;
        }

        element.setAttribute("data-inactivity-plugin-hidden", "true");
        element.setAttribute("aria-hidden", "true");
        return true;
    }

    function applyFasKioskRestrictions(documentObject, pageUrl) {
        if (!isFasKioskPage(pageUrl)) {
            return 0;
        }

        let hiddenCount = 0;

        for (const element of documentObject.querySelectorAll(kioskChromeSelector)) {
            hiddenCount += hideElement(element) ? 1 : 0;
        }

        for (const element of documentObject.querySelectorAll(helpControlSelector)) {
            if (isHelpControl(element)) {
                hiddenCount += hideElement(element) ? 1 : 0;
            }
        }

        return hiddenCount;
    }

    function activateFasKioskRestrictions(
        documentObject,
        pageUrl,
        createObserver
    ) {
        if (!isFasKioskPage(pageUrl)) {
            return null;
        }

        applyFasKioskRestrictions(documentObject, pageUrl);

        const observer = createObserver(() => {
            applyFasKioskRestrictions(documentObject, pageUrl);
        });

        observer.observe(documentObject.documentElement, {
            childList: true,
            subtree: true
        });

        return observer;
    }

    const api = {
        activateFasKioskRestrictions,
        applyFasKioskRestrictions,
        isFasKioskPage
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    if (
        typeof document !== "undefined" &&
        typeof window !== "undefined" &&
        typeof MutationObserver !== "undefined"
    ) {
        activateFasKioskRestrictions(
            document,
            window.location.href,
            (callback) => new MutationObserver(callback)
        );
    }
})();
