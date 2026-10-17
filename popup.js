"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Config = globalThis.AnnoyConfig;
  const addForm = document.getElementById("addForm");
  const websiteInput = document.getElementById("websiteInput");
  const websiteList = document.getElementById("websiteList");
  const errorBox = document.getElementById("errorBox");
  const permissionNotice = document.getElementById("permissionNotice");
  const grantBtn = document.getElementById("grantBtn");

  let websites = [];
  let missingWebsites = [];

  function showError(message) {
    if (!message) {
      errorBox.style.display = "none";
      errorBox.textContent = "";
      return;
    }
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }

  function render() {
    permissionNotice.style.display = missingWebsites.length ? "flex" : "none";
    websiteList.replaceChildren();

    if (!websites.length) {
      const empty = document.createElement("div");
      empty.className = "empty-text";
      empty.textContent = "No blocked websites.";
      websiteList.appendChild(empty);
      return;
    }

    websites.forEach(pattern => {
      const row = document.createElement("div");
      row.className = "website-item";

      const text = document.createElement("span");
      text.className = "website-pattern";
      text.textContent = pattern;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeWebsite(pattern));

      row.appendChild(text);
      row.appendChild(removeBtn);
      websiteList.appendChild(row);
    });
  }

  async function load() {
    const response = await chrome.runtime.sendMessage({ type: "AW_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "Could not load websites.");
    websites = response.settings.websites;
    missingWebsites = response.missingWebsites || [];
    render();
  }

  async function removeWebsite(patternToRemove) {
    showError("");
    const updated = websites.filter(pattern => pattern !== patternToRemove);
    try {
      await chrome.storage.sync.set({ websites: updated });
      const response = await chrome.runtime.sendMessage({ type: "AW_RECONCILE" });
      if (response?.ok) {
        websites = response.settings.websites;
        missingWebsites = response.missingWebsites || [];
        render();
      } else {
        await load();
      }
    } catch (error) {
      showError(error.message || String(error));
    }
  }

  addForm.addEventListener("submit", async event => {
    event.preventDefault();
    showError("");

    let pattern;
    try {
      pattern = Config.normalizePattern(websiteInput.value);
    } catch (error) {
      showError(error.message || String(error));
      return;
    }

    const updated = websites.includes(pattern) ? [...websites] : [...websites, pattern];
    try {
      Config.parseWebsites(updated);
    } catch (error) {
      showError(error.message || String(error));
      return;
    }

    // Request host permission directly inside the submit user gesture, and save
    // immediately so the website persists even if Chrome's prompt closes the popup.
    let permPromise;
    try {
      permPromise = chrome.permissions.request({ origins: [Config.originForPattern(pattern)] });
    } catch (error) {
      showError(error.message || String(error));
      return;
    }

    try {
      await chrome.storage.sync.set({ websites: updated });
      websiteInput.value = "";
      await permPromise.catch(() => false);
      const response = await chrome.runtime.sendMessage({ type: "AW_RECONCILE" });
      if (response?.ok) {
        websites = response.settings.websites;
        missingWebsites = response.missingWebsites || [];
        render();
      } else {
        await load();
      }
    } catch (error) {
      showError(error.message || String(error));
    }
  });

  grantBtn.addEventListener("click", async () => {
    showError("");
    const origins = [...new Set(missingWebsites.map(Config.originForPattern))];
    if (!origins.length) return;
    let permPromise;
    try {
      permPromise = chrome.permissions.request({ origins });
    } catch (error) {
      showError(error.message || String(error));
      return;
    }
    try {
      await permPromise;
      const response = await chrome.runtime.sendMessage({ type: "AW_RECONCILE" });
      if (response?.ok) {
        websites = response.settings.websites;
        missingWebsites = response.missingWebsites || [];
        render();
      }
    } catch (error) {
      showError(error.message || String(error));
    }
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") load().catch(error => showError(error.message));
  });

  load().catch(error => showError(error.message || String(error)));
});
