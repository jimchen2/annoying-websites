/* Shared configuration and Chrome match-pattern helpers. No remote code. */
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true,
    intervalMinutes: 1.5,
    waitSeconds: 30,
    showTimerInConsole: true,
    websites: Object.freeze([
      "*://*.1point3acres.com/*",
      "*://*.huaren.us/*",
      "*://*.baidu.com/*",
      "*://*.bilibili.com/*",
      "*://*.zombsroyale.io/*",
      "*://llm.jimchen.me/random*",
      "https://aistudio.google.com/*"
    ])
  });
  const KEYS = Object.keys(DEFAULTS);
  const MAX_WEBSITES = 100;
  const MAX_WEBSITE_BYTES = 7500; // Leave room below sync's 8 KiB/item limit.

  function normalizePattern(input) {
    let value = String(input).trim();
    if (!value) throw new Error("Enter a website or Chrome match pattern.");
    if (/\s/.test(value)) throw new Error(`Spaces are not allowed: ${value}`);

    // A bare domain includes its subdomains, just like the original userscript.
    if (!value.includes("://")) {
      if (/[/:?#]/.test(value)) {
        throw new Error(`Use a full pattern for a path, for example *://example.com/path*: ${value}`);
      }
      const host = value.toLowerCase();
      const wildcard = host === "*" || host.startsWith("*.") || host === "localhost" || /^\d+(\.\d+){3}$/.test(host);
      value = `*://${wildcard ? host : `*.${host}`}/*`;
    } else if (/^(\*|https?):\/\/[^/]+$/i.test(value)) {
      value += "/*";
    }

    const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/i.exec(value);
    if (!match) throw new Error(`Use http://, https://, or *:// followed by a host and path: ${value}`);
    const scheme = match[1].toLowerCase();
    const host = match[2].toLowerCase();
    const path = match[3];
    const domain = host.startsWith("*.") ? host.slice(2) : host;
    const labels = domain.split(".");
    const validDomain = domain.length <= 253 && labels.every(label =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
    if (host !== "*" && !validDomain) {
      throw new Error(`Invalid host in ${value}. Use an ASCII domain (or punycode), without ports.`);
    }
    if (path.includes("#")) throw new Error(`URL fragments are not supported in match patterns: ${value}`);
    if (value.length > 1000) throw new Error("A website pattern is too long (maximum 1,000 characters).");
    return `${scheme}://${host}${path}`;
  }

  function parseWebsites(text) {
    const lines = String(text).split(/\r?\n/);
    const patterns = [];
    lines.forEach((line, index) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return;
      try {
        const pattern = normalizePattern(value);
        if (!patterns.includes(pattern)) patterns.push(pattern);
      } catch (error) {
        throw new Error(`Line ${index + 1}: ${error.message}`);
      }
    });
    if (patterns.length > MAX_WEBSITES) throw new Error(`Use at most ${MAX_WEBSITES} website patterns.`);
    const bytes = new TextEncoder().encode(JSON.stringify({ websites: patterns })).length;
    if (bytes > MAX_WEBSITE_BYTES) throw new Error("The website list is too large for Chrome Sync. Shorten the list or its patterns.");
    return patterns;
  }

  function originForPattern(pattern) {
    const match = /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
    if (!match) throw new Error("Invalid website pattern.");
    return `${match[1]}://${match[2]}/*`;
  }

  function matchesUrl(pattern, input) {
    try {
      const url = new URL(input);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      const [, scheme, host, path] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
      if (scheme !== "*" && `${scheme}:` !== url.protocol) return false;
      if (host !== "*") {
        const domain = host.startsWith("*.") ? host.slice(2) : host;
        if (host.startsWith("*.")) {
          if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return false;
        } else if (url.hostname !== host) return false;
      }
      const regex = path.split("*").map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      return new RegExp(`^${regex}$`).test(url.pathname + url.search);
    } catch {
      return false;
    }
  }

  function matchesAny(patterns, url) {
    return patterns.some(pattern => matchesUrl(pattern, url));
  }

  function normalizeSettings(raw = {}) {
    let websites;
    try {
      websites = Array.isArray(raw.websites)
        ? parseWebsites(raw.websites.join("\n"))
        : [...DEFAULTS.websites];
    } catch {
      // Keep any valid entries if externally edited sync data is malformed.
      websites = [];
      if (Array.isArray(raw.websites)) {
        for (const value of raw.websites.slice(0, MAX_WEBSITES)) {
          try {
            const pattern = normalizePattern(value);
            if (!websites.includes(pattern)) websites.push(pattern);
          } catch { /* Ignore invalid entries rather than running on an unintended site. */ }
        }
      }
    }
    const interval = Number(raw.intervalMinutes);
    const wait = Number(raw.waitSeconds);
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
      intervalMinutes: Number.isFinite(interval) && interval >= 0.1 && interval <= 1440 ? interval : DEFAULTS.intervalMinutes,
      waitSeconds: Number.isInteger(wait) && wait >= 1 && wait <= 3600 ? wait : DEFAULTS.waitSeconds,
      showTimerInConsole: typeof raw.showTimerInConsole === "boolean" ? raw.showTimerInConsole : DEFAULTS.showTimerInConsole,
      websites
    };
  }

  async function readSettings() {
    return normalizeSettings(await chrome.storage.sync.get(KEYS));
  }

  function validateForm({ enabled, intervalMinutes, waitSeconds, showTimerInConsole, websitesText }) {
    const interval = Number(intervalMinutes);
    const wait = Number(waitSeconds);
    if (!Number.isFinite(interval) || interval < 0.1 || interval > 1440) {
      throw new Error("The browsing interval must be between 0.1 and 1,440 minutes.");
    }
    if (!Number.isInteger(wait) || wait < 1 || wait > 3600) {
      throw new Error("The pause must be a whole number between 1 and 3,600 seconds.");
    }
    return {
      enabled: Boolean(enabled),
      intervalMinutes: interval,
      waitSeconds: wait,
      showTimerInConsole: Boolean(showTimerInConsole),
      websites: parseWebsites(websitesText)
    };
  }

  globalThis.AnnoyConfig = Object.freeze({
    DEFAULTS, KEYS, MAX_WEBSITES, MAX_WEBSITE_BYTES,
    normalizePattern, parseWebsites, originForPattern, matchesUrl, matchesAny,
    normalizeSettings, readSettings, validateForm
  });
})();
