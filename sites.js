/* The list of blocked websites. Shared by the toolbar popup and the options
   page so both show exactly the same thing. Changes save right away. */
"use strict";
(() => {
  const Rules = globalThis.BlockRules;
  const $ = id => document.getElementById(id);
  const form = $("add-form");
  const input = $("rule-input");
  const list = $("rule-list");
  const message = $("message");
  const emptyNote = $("empty-note");
  const toggle = $("enabled");
  let rules = [];

  function say(text, kind = "") {
    if (!message) return;
    message.textContent = text;
    message.className = `message ${kind}`;
    message.hidden = !text;
  }

  function ruleItem(rule) {
    const item = document.createElement("li");
    item.className = "rule";

    const text = document.createElement("code");
    text.className = "rule-text";
    text.textContent = rule.text;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${rule.text}`);
    remove.addEventListener("click", () => { removeRule(rule); });

    item.append(text, remove);
    return item;
  }

  async function render() {
    if (!list) return;
    const access = await Promise.all(rules.map(rule => Rules.hasAccess(rule)));
    list.replaceChildren();
    rules.forEach((rule, index) => {
      const item = ruleItem(rule);
      if (!access[index]) {
        const allow = document.createElement("button");
        allow.type = "button";
        allow.className = "rule-allow";
        allow.textContent = "Needs access";
        allow.title = `Chrome needs access to ${rule.host} before it can block it.`;
        allow.addEventListener("click", () => { requestAccess(rule); });
        item.insertBefore(allow, item.lastChild);
      }
      list.append(item);
    });
    if (emptyNote) emptyNote.hidden = rules.length > 0;
  }

  async function refresh() {
    const state = await Rules.readState();
    rules = state.rules;
    if (toggle) toggle.checked = state.enabled;
    await render();
  }

  async function requestAccess(rule) {
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: Rules.originsForRule(rule) }); }
    catch (error) { say(error.message, "error"); return; }
    await render();
    say(granted ? `Chrome can now block ${rule.text}.` : `Chrome still needs access to ${rule.host}.`, granted ? "success" : "warn");
  }

  async function addRule() {
    let rule;
    try { rule = Rules.normalizeRule(input.value); }
    catch (error) { say(error.message, "error"); return; }
    if (rules.some(item => item.text === rule.text)) {
      say(`${rule.text} is already in the list.`, "error");
      return;
    }

    // Chrome only shows its access prompt during a click, so start it now and
    // do not wait for the answer: a prompt can close the popup, and the rule
    // should be in the list either way.
    let asked;
    try { asked = chrome.permissions.request({ origins: Rules.originsForRule(rule) }).then(granted => granted, () => null); }
    catch { asked = Promise.resolve(null); }

    try { await Rules.saveRules([...rules.map(item => item.text), rule.text]); }
    catch (error) { say(error.message, "error"); return; }

    input.value = "";
    await refresh();

    const granted = await asked;
    if (granted === null) {
      say(`Added ${rule.text}. Chrome still needs access to ${rule.host}.`, "warn");
      return;
    }
    say(granted
      ? `Blocking ${rule.text}.`
      : `Added ${rule.text}. Chrome still needs access to ${rule.host}.`, granted ? "success" : "warn");
  }

  async function removeRule(rule) {
    const next = rules.filter(item => item.text !== rule.text);
    try { await Rules.saveRules(next.map(item => item.text)); }
    catch (error) { say(error.message, "error"); return; }
    // Give the access back when no other rule needs it.
    if (!next.some(item => item.host === rule.host)) {
      chrome.permissions.remove({ origins: Rules.originsForRule(rule) }).catch(() => {});
    }
    await refresh();
    say(`Removed ${rule.text}.`, "success");
  }

  if (form) {
    form.addEventListener("submit", event => {
      event.preventDefault();
      addRule();
    });
  }
  if (toggle) {
    toggle.addEventListener("change", async () => {
      try { await Rules.saveEnabled(toggle.checked); }
      catch (error) { say(error.message, "error"); await refresh(); return; }
      say(toggle.checked ? "Blocking is on." : "Blocking is off.", "success");
    });
  }
  if (input) {
    input.addEventListener("input", () => { if (message && !message.classList.contains("error")) say(""); });
  }
  const openOptions = $("open-options");
  if (openOptions) {
    openOptions.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") refresh().catch(() => {});
  });

  refresh().catch(error => say(error.message, "error"));
})();
