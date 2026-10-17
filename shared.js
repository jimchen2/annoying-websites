/* Shared configuration and prefix match-pattern helpers. No remote code. */
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
      "*://aistudio.google.com/*"
    ])
  });
  const KEYS = ["websites"];
  const MAX_WEBSITES = 100;
  const MAX_WEBSITE_BYTES = 7500; // Leave room below sync's 8 KiB/item limit.

  function normalizePattern(input) {
    let value = String(input).trim();
    if (!value) throw new Error("Enter a website prefix, e.g. example.com/1");
    if (/\s/.test(value)) throw new Error(`Spaces are not allowed: ${value}`);

    // Strip scheme (*://, http://, https://) if the user typed or pasted one.
    value = value.replace(/^(\*|https?):\/\//i, "");
    // Strip URL fragment if present.
    const hashIndex = value.indexOf("#");
    if (hashIndex !== -1) value = value.slice(0, hashIndex);
    // Strip trailing '*' wildcards so we always normalize to *://<host>/<path>*
    value = value.replace(/\*+$/, "");
    if (!value) throw new Error("Enter a website prefix, e.g. example.com/1");

    const slashIndex = value.indexOf("/");
    const queryIndex = value.indexOf("?");
    let splitIndex = slashIndex;
    if (queryIndex !== -1 && (slashIndex === -1 || queryIndex < slashIndex)) {
      splitIndex = queryIndex;
    }

    const rawHost = (splitIndex === -1 ? value : value.slice(0, splitIndex)).toLowerCase();
    let rawPath = splitIndex === -1 ? "/" : value.slice(splitIndex);
    if (!rawPath.startsWith("/")) rawPath = `/${rawPath}`;

    if (!rawHost) throw new Error(`Invalid website prefix: ${input}`);
    const domain = rawHost.startsWith("*.") ? rawHost.slice(2) : rawHost;
    const labels = domain.split(".");
    const validDomain = (domain === "localhost" || labels.length >= 2) &&
      domain.length <= 253 &&
      labels.every(label =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
      );
    if (!validDomain) {
      throw new Error(`Invalid host in "${input}". Example: example.com/1`);
    }
    if (rawPath.includes("*")) {
      throw new Error(`Prefix cannot contain '*' in the middle: ${input}`);
    }

    const pattern = `*://${rawHost}${rawPath}*`;
    if (pattern.length > 1000) throw new Error("Website prefix is too long (max 1,000 characters).");
    return pattern;
  }

  function parseWebsites(listOrText) {
    const items = Array.isArray(listOrText)
      ? listOrText
      : String(listOrText).split(/\r?\n/);
    const patterns = [];
    items.forEach((item, index) => {
      const value = String(item).trim();
      if (!value || value.startsWith("#")) return;
      try {
        const pattern = normalizePattern(value);
        if (!patterns.includes(pattern)) patterns.push(pattern);
      } catch (error) {
        throw new Error(items.length > 1 ? `Line ${index + 1}: ${error.message}` : error.message);
      }
    });
    if (patterns.length > MAX_WEBSITES) throw new Error(`Use at most ${MAX_WEBSITES} website prefixes.`);
    const bytes = new TextEncoder().encode(JSON.stringify({ websites: patterns })).length;
    if (bytes > MAX_WEBSITE_BYTES) throw new Error("The website list is too large for Chrome Sync.");
    return patterns;
  }

  function originForPattern(pattern) {
    const normalized = normalizePattern(pattern);
    const match = /^\*:\/\/([^/]+)\//.exec(normalized);
    if (!match) throw new Error("Invalid website pattern.");
    return `*://${match[1]}/*`;
  }

  function matchesUrl(pattern, input) {
    try {
      const url = new URL(input);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      const normalized = normalizePattern(pattern);
      const match = /^\*:\/\/([^/]+)(\/.*)$/.exec(normalized);
      if (!match) return false;
      const host = match[1];
      const path = match[2];
      if (host !== "*") {
        const domain = host.startsWith("*.") ? host.slice(2) : host;
        if (host.startsWith("*.")) {
          if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return false;
        } else if (url.hostname !== host) return false;
      }
      const prefix = path.endsWith("*") ? path.slice(0, -1) : path;
      return (url.pathname + url.search).startsWith(prefix);
    } catch {
      return false;
    }
  }

  function matchesAny(patterns, url) {
    return patterns.some(pattern => matchesUrl(pattern, url));
  }

  function normalizeSettings(raw = {}) {
    let websites;
    if (Array.isArray(raw.websites)) {
      websites = [];
      for (const value of raw.websites.slice(0, MAX_WEBSITES)) {
        try {
          const pattern = normalizePattern(value);
          if (!websites.includes(pattern)) websites.push(pattern);
        } catch { /* Ignore invalid entries. */ }
      }
    } else {
      websites = [...DEFAULTS.websites];
    }
    return {
      enabled: DEFAULTS.enabled,
      intervalMinutes: DEFAULTS.intervalMinutes,
      waitSeconds: DEFAULTS.waitSeconds,
      showTimerInConsole: DEFAULTS.showTimerInConsole,
      websites
    };
  }

  async function readSettings() {
    return normalizeSettings(await chrome.storage.sync.get(KEYS));
  }

  globalThis.AnnoyConfig = Object.freeze({
    DEFAULTS, KEYS, MAX_WEBSITES, MAX_WEBSITE_BYTES,
    normalizePattern, parseWebsites, originForPattern, matchesUrl, matchesAny,
    normalizeSettings, readSettings
  });
})();
