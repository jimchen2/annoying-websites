/* The page Chrome shows instead of a blocked address. It shows the address
   that was stopped and offers a way back, or a way to drop the rule. */
"use strict";
(() => {
  const Rules = globalThis.BlockRules;
  const $ = id => document.getElementById(id);
  let blockedUrl = "";
  let blockedRule = "";

  async function currentTabId() {
    const current = await chrome.tabs.getCurrent().catch(() => null);
    if (current?.id !== undefined) return current.id;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }

  /* Chrome redirects the tab here, so the address is not in the page. The
     service worker writes it aside when it sees the navigation. */
  async function findBlockedInfo() {
    const fromQuery = new URLSearchParams(location.search).get("u");
    if (fromQuery) return { url: fromQuery, rule: "" };
    const tabId = await currentTabId();
    if (tabId === undefined) return { url: "", rule: "" };
    const key = Rules.blockedInfoKey(tabId);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const stored = await chrome.storage.session.get(key).catch(() => ({}));
      if (stored[key]?.url) return stored[key];
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { url: "", rule: "" };
  }

  async function matchingRule(url) {
    const state = await Rules.readState();
    return state.rules.find(rule => Rules.matchesRule(rule, url)) || null;
  }

  async function removeRule(rule) {
    const state = await Rules.readState();
    const next = state.rules.filter(item => item.text !== rule.text).map(item => item.text);
    await Rules.saveRules(next);
    await chrome.runtime.sendMessage({ type: "AW_RECONCILE" }).catch(() => {});
    $("blocked-note").textContent = `${rule.text} was removed.`;
    $("allow-site").hidden = true;
    $("rule-choices").hidden = true;
    setTimeout(() => history.back(), 500);
  }

  /* Without the address there is no single rule to point at, so offer them
     all and let the user pick the one to drop. */
  async function showRuleChoices() {
    const state = await Rules.readState();
    const list = $("rule-choices");
    list.replaceChildren();
    for (const rule of state.rules) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rule-allow";
      button.textContent = `Allow ${rule.text}`;
      button.addEventListener("click", () => { removeRule(rule).catch(showError); });
      item.append(button);
      list.append(item);
    }
    list.hidden = state.rules.length === 0;
  }

  function showError(error) {
    $("blocked-note").textContent = error.message || String(error);
  }

  function show() {
    if (blockedUrl) {
      const url = $("blocked-url");
      url.textContent = blockedUrl;
      url.hidden = false;
    }
    if (blockedRule) {
      const rule = $("blocked-rule");
      rule.textContent = `Blocked by ${blockedRule}`;
      rule.hidden = false;
      $("allow-site").hidden = false;
      return;
    }
    if (blockedUrl) {
      $("allow-site").hidden = false;
      return;
    }
    $("blocked-note").textContent = "It matches one of the prefixes in your list.";
    showRuleChoices().catch(showError);
  }

  $("go-back").addEventListener("click", () => history.back());
  $("allow-site").addEventListener("click", () => {
    const rule = blockedRule ? { text: blockedRule } : null;
    const done = rule
      ? removeRule(rule)
      : matchingRule(blockedUrl).then(found => (found ? removeRule(found) : showRuleChoices()));
    done.catch(showError);
  });

  findBlockedInfo()
    .then(info => {
      blockedUrl = info.url || "";
      blockedRule = info.rule || "";
      if (!blockedRule && blockedUrl) {
        return matchingRule(blockedUrl).then(rule => { blockedRule = rule ? rule.text : ""; });
      }
      return null;
    })
    .catch(showError)
    .then(show);
})();
