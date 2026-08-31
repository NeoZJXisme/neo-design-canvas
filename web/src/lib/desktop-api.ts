import axios from "axios";

const DESKTOP_PROXY_PARAM = "neoDesktopProxy";
const DESKTOP_PROXY_PATH = "/__neo_api_proxy__";

let installed = false;

function desktopProxyToken() {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get(DESKTOP_PROXY_PARAM)?.trim() || "";
}

/**
 * Desktop builds keep Chromium webSecurity enabled. Route remote HTTP(S) calls
 * through the Electron main-process localhost proxy so OpenAI-compatible
 * gateways do not need to expose browser CORS headers.
 */
export function desktopApiUrl(targetUrl: string) {
    const token = desktopProxyToken();
    if (!token || typeof window === "undefined" || !/^https?:\/\//i.test(targetUrl)) return targetUrl;
    try {
        const target = new URL(targetUrl);
        if (target.origin === window.location.origin) return targetUrl;
    } catch {
        return targetUrl;
    }
    const url = new URL(DESKTOP_PROXY_PATH, window.location.origin);
    url.searchParams.set("token", token);
    url.searchParams.set("target", targetUrl);
    return url.toString();
}

export function isDesktopApiProxyEnabled() {
    return Boolean(desktopProxyToken());
}

/** Install once at application startup so existing API code does not need to
 * special-case Electron. Both fetch and axios/XHR calls are transparently
 * routed through the localhost main-process proxy in desktop builds only. */
export function installDesktopApiProxy() {
    if (installed || typeof window === "undefined" || !isDesktopApiProxyEnabled()) return;
    installed = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const proxiedUrl = desktopApiUrl(rawUrl);
        if (proxiedUrl === rawUrl) return originalFetch(input, init);
        if (input instanceof Request) return originalFetch(new Request(proxiedUrl, input), init);
        return originalFetch(proxiedUrl, init);
    }) as typeof window.fetch;

    axios.interceptors.request.use((config) => {
        if (typeof config.url === "string" && /^https?:\/\//i.test(config.url)) {
            config.url = desktopApiUrl(config.url);
        }
        return config;
    });
}
