# Privacy Policy — Annoying Websites

**Last updated:** 17 October 2026
**Applies to:** the "Annoying Websites" browser extension (Manifest V3) for Google
Chrome and Chromium-based browsers.

---

## Summary

The extension does not collect, transmit, sell, or share any data. The list of
websites you choose to block never leaves your own browser profile.

---

## What the extension stores

| Data | Where it is stored | Who can see it |
|---|---|---|
| The list of website prefixes you block | `chrome.storage.sync` — your own browser profile, synced to **your own** Google account (or local storage only, if Chrome Sync is turned off) | You, and Google only as the infrastructure that runs your personal sync |
| Timer preferences (interval, wait time) | The same | You |

Nothing is sent to the extension author. There is no server component.

## What the extension does *not* do

- It does not collect browsing history, and it does not read or store the
  contents of pages.
- It does not collect personal information, device identifiers, or usage
  analytics.
- It does not include advertising, analytics, or tracking code of any kind.
- It does not transmit data anywhere over the network.
- It does not download or execute code at runtime. Every line of logic ships
  inside the extension package.
- It does not sell or share anything with third parties.

## Page access

The extension runs a small content script **only on the top-level page of a
website you have chosen to block**, and only after you grant it access to that
specific site. Chrome asks for that access when you add the site; you can
decline, and you can revoke it at any time from the extension's popup or from
`chrome://extensions` → site access.

On a blocked site, the content script:

- shows a countdown overlay,
- temporarily locks scrolling on that page,
- and sends no page content, form data, or cookies anywhere.

The content script is listed in the manifest's `host_permissions` only for the
default websites the extension ships with; every other site is requested
individually at runtime, and the permission prompt names the exact origin.

## Permissions, and why they are needed

| Permission | Why |
|---|---|
| `storage` | Saves your list of blocked websites and your timer preferences. |
| `scripting` | Injects the overlay into a page you have chosen to block. |
| Host access to the default sites | So the extension works out of the box on the default list before you add anything. |
| Optional host access to sites you add | So the extension can show the overlay on the sites you add yourself. Access is requested per origin, at the moment you add it. |

The extension does **not** request the `tabs` permission, and therefore does not
read your browsing history.

## Permissions you can change

- **Site access**: `chrome://extensions` → *Annoying Websites* → *Site access*.
- **Uninstall**: removing the extension deletes the locally stored list. If you
  used Chrome Sync, the list also stays in your Google account's sync data —
  remove it by clearing the extension's storage in `chrome://extensions` →
  *Details* → *Clear storage*, or by removing the extension from your sync
  settings.

## Children

The extension is a self-control tool and is not directed at children. It stores
no data about anyone, of any age.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL
and the "Last updated" date above will change.

## Contact

Jim Chen — see the extension's support email in the Chrome Web Store listing, or
the repository for this extension.
