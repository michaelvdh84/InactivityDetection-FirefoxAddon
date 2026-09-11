(async () => {
    const DEFAULT_REDIRECT_URL = "about:blank";

    try {
        const result = await browser.runtime.sendMessage({
            type: "get-effective-config"
        });
        const candidate = String(result?.config?.redirectUrl ?? "").trim();

        if (result?.ok && candidate === DEFAULT_REDIRECT_URL) {
            location.replace(DEFAULT_REDIRECT_URL);
            return;
        }

        if (result?.ok) {
            const target = new URL(candidate);
            if (target.protocol === "http:" || target.protocol === "https:") {
                location.replace(target.href);
                return;
            }
        }
    } catch (error) {
        console.error("Unable to open the configured home page:", error);
    }

    location.replace(DEFAULT_REDIRECT_URL);
})();
