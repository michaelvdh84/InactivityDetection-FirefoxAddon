const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

async function openHomepage(response) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.chrome_settings_overrides?.homepage, "home.html");

    const html = fs.readFileSync(path.join(root, "home.html"), "utf8");
    const scriptPath = html.match(/<script src="([^"]+)"/u)?.[1];
    assert.equal(scriptPath, "home.js");

    const navigations = [];
    const context = vm.createContext({
        browser: { runtime: { sendMessage: async (message) => {
            if (message?.type !== "get-effective-config") {
                throw new Error("Unexpected configuration request");
            }
            return response;
        } } },
        location: { replace(url) { navigations.push(url); } },
        URL,
        console: { error() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(root, scriptPath), "utf8"), context);
    await new Promise((resolve) => setImmediate(resolve));
    return navigations;
}

test("Firefox Home opens the current effective redirect URL", async () => {
    const navigations = await openHomepage({
        ok: true,
        config: { redirectUrl: "https://portal.example/fr-BE/?source=home" }
    });

    assert.deepEqual(navigations, ["https://portal.example/fr-BE/?source=home"]);
});

test("Firefox Home falls back safely when the effective redirect URL is invalid", async () => {
    const navigations = await openHomepage({
        ok: true,
        config: { redirectUrl: "javascript:alert(1)" }
    });

    assert.deepEqual(navigations, ["about:blank"]);
});
