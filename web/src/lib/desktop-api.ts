const DESKTOP_PROXY_PARAM = "neoDesktopProxy";
const DESKTOP_PROXY_PATH = "/__neo_api_proxy__";

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
    const url = new URL(DESKTOP_PROXY_PATH, window.location.origin);
    url.searchParams.set("token", token);
    url.searchParams.set("target", targetUrl);
    return url.toString();
}

export function isDesktopApiProxyEnabled() {
    return Boolean(desktopProxyToken());
}
