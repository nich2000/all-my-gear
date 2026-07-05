# Remarks Analysis

Source: Google Sheet `AMG_bug_fixes`, sheet `Лист1`, CSV export from the user-provided spreadsheet URL.

Date: 2026-07-03.

## Executive Summary

The remarks are not one homogeneous backlog. They fall into four groups:

1. Implemented or mostly implemented UI/product items around storages, checklist metadata, sharing, comments, favicons and loading optimization.
2. Items that need live regression testing on target browsers: Android Chrome, Safari, installed mobile web app and public production sharing links.
3. Backend/data-contract risks: migrations still need to cover all runtime objects/policies that these features rely on.
4. Future product ideas that should not be mixed into bugfix work: Google Calendar integration, automatic photo lookup, storage addresses/geolocation/maps and whole-gear sharing.

The highest-priority remaining work is not adding more UI. It is verifying the failure reports from the sheet against real browser/runtime behavior and closing the Supabase contract gaps that can make already-built UI fail in production.

## Status By Area

### Gear Item Cards

| Remark | Current status | Evidence / note |
| --- | --- | --- |
| Add storage indication on item card | Implemented | `storage_id` exists in SQL; item cards render `storage-badge`; add/edit forms include storage selection. |
| Add info about checklists containing item | Implemented | Item cards compute checklists containing the item and render checklist badges. |
| Add `add to checklist` from existing checklists | Implemented | Add gear modal and edit card flows include checklist checkboxes. |
| Photo added during card edit must not close edit window | Needs live regression test | Code has inline photo replacement, but the sheet reports a UX requirement; verify manually on desktop and mobile. |
| Save has no visible reaction | Partially mitigated / still risky | Some async flows show alerts or button text, but item creation is optimistic and server save happens in background. A successful save toast/state would reduce uncertainty. |
| Android Chrome does not save | Open bug, needs reproduction | Sheet explicitly says to test. Must verify with Android Chrome and console/network logs. |
| `Error creating item: TypeError: Load failed` | Open bug, likely network/Supabase/storage/CORS path | Needs live logs. Code catches `createGearItem` errors and rolls back optimistic UI. |
| If photo was not added initially, adding it later is unclear | Mostly implemented, UX still worth review | Edit forms include photo controls, but discoverability was called out. |
| Warning window layout | Implemented in parts / needs UI review | Alert/confirm styles exist, but exact warning window from remark should be visually checked. |
| Show comment presence in list | Implemented | Cards render a comment icon when `comment` exists and show full comment when expanded. |
| Cursor over list should be pointer | Mostly implemented | CSS uses pointer for cards/list controls; some drag-list styles still use grab where drag ordering exists. |

### Checklist

| Remark | Current status | Evidence / note |
| --- | --- | --- |
| Add search near gear items when creating checklist | Implemented | `checklistItemSearch` exists in checklist modal. |
| Fix new checklist modal layout | Partially implemented / needs visual review | Modal was redesigned, but sheet says layout review remains. |
| Show storage mark in gear list | Implemented | Storage badges are rendered on gear cards. |
| Warn when checklist has items from different storages | Implemented | Checklist render computes distinct storage ids and displays warning icon. |
| Sort/filter by storage | Implemented as filter | Gear toolbar has storage filter; checklist has per-checklist storage filter. This is filtering, not necessarily sort order. |
| Trip date | Implemented | Checklist modal has start/end date; checklist cards display dates. |
| Google Calendar integration | Future | Sheet says integration later; no code path found. |
| Suggest replacement from most popular storage | Future / needs product definition | The remark itself questions the definition of "popular". |
| Checked items move down | Needs verification | There is checklist sorting logic, but this exact behavior must be tested in UI. |
| Large storage on checklist cards | Implemented | Checklist item rendering has `storage-badge-large`. |
| Checklist sorting does not work in Safari | Open browser-specific bug | Requires Safari reproduction. Likely not provable from static code only. |
| Share checklist with messengers/social | Implemented, needs production test | Share checklist modal has WhatsApp, Telegram, Facebook and Email buttons. |
| Quick view checklist items like MyGear | Marked working in sheet | Treat as done unless new evidence appears. |
| Replace plus with pencil / remove extra add/delete functions | Mostly implemented | Edit checklist uses pencil icon; exact surface needs visual pass. |
| Right-side layout looks strange | Partially reworked, still needs review | Sheet says partially reworked and needs another look. |

### General Functionality

| Remark | Current status | Evidence / note |
| --- | --- | --- |
| Remove drag-and-drop and replace with simpler logic | Mostly implemented | Current UI still has ordering modals and `drag-handle` CSS in category/checklist order areas; verify intended scope. |
| Fix search | Partially implemented / still risky | Search exists and preserves input across render, but sheet has multiple search-related bugs. |
| Add Fishing & Hunting, Climbing & Rope, Winter & Snow | Implemented | Categories are present in `allPossibleCategories`. |
| Redesign add gear modal | Implemented | Add gear modal is structured into sections with photo/storage/checklist controls. |
| Add favicon and browser icons | Implemented | `index.html` links favicon, Apple touch icon and manifest. |
| Optimize data load after login | Implemented in part | Gear loads first, photo URL cache exists, checklists lazy-load on first tab access. |
| Adapt data transfer to mobile browsers | Open testing item | Needs mobile browser pass; not a static code question. |
| Insecure connection/security warning in mobile web app | Open ops/browser issue | Needs production HTTPS/CSP/PWA verification. |
| Safari login persistence/sharing behavior | Open browser/session issue | Sheet notes Chrome is OK; Safari auth/session persistence must be reproduced. |
| Chrome login text appears in search and hides gear list | Open bug | Likely browser autofill/session text leaking into search input; needs live reproduction. |
| Alphabetize categories in dropdown | Not confirmed | Current category order is saved/user-driven, not simply alphabetical. Decide product rule before changing. |
| Share all gear | Future | No current implementation found. |
| Mobile web app security warning | Open ops/PWA issue | Check HTTPS, manifest, service worker/PWA install context and mixed content. |

### Storages

| Remark | Current status | Evidence / note |
| --- | --- | --- |
| Add storage inside add gear window | Implemented | Add gear modal has storage select and inline create storage form. |
| Add storage inside card edit | Implemented | Edit card has storage select and inline storage creation. |
| Replace plus with Add / Add new in dropdown | Partially implemented / UX improvement | Add forms exist, but dropdown itself does not expose an `Add new` option. |
| Future storage section with addresses, geolocation and maps | Future | Explicitly marked non-urgent in sheet. |

## High-Priority Backlog

### P0: Browser/runtime defects to reproduce

1. Android Chrome save failure and `TypeError: Load failed`.
2. Safari checklist sorting failure.
3. Safari login persistence when opening share links.
4. Chrome search box receiving login text after refresh.
5. Mobile web app security warning.

These require live browser checks with console and network logs. Static code inspection is not enough.

### P1: Supabase contract and production safety

1. Resolve the remaining `gear_catalog` / `search_gear_catalog` contract with migrations, compatibility objects or frontend cleanup.
2. Verify RLS policies for all user-owned tables after applying `supabase/migrations` to the live project.
3. Verify public-share read policy behavior for `shared_items` by `share_code` and expiry semantics.
4. Provision the `gear-photos` bucket and verify existing Storage policies against the client upload path `<gear_item_id>/image.jpg`, including whether shared items can expose signed URLs without login.

### P2: UX polish

1. Add explicit success feedback after Save for gear item create/edit flows.
2. Make photo editing more discoverable when an item has no photo.
3. Review right-side checklist layout.
4. Convert storage creation to `Add new` inside dropdown if desired.
5. Decide whether category dropdown must be alphabetic or user-order-preserving.

### P3: Future scope

1. Google Calendar integration.
2. Automatic photo lookup by brand/model.
3. Replacement suggestions by popular storage.
4. Share all gear.
5. Storages with addresses/geolocation/maps.

## Recommended Test Matrix

| Scenario | Desktop Chrome | Android Chrome | Safari macOS | Safari iOS / PWA |
| --- | --- | --- | --- | --- |
| Login persistence after refresh | Required | Required | Required | Required |
| Create item without photo | Required | Required | Required | Required |
| Create item with photo | Required | Required | Required | Required |
| Add photo while editing existing item | Required | Required | Required | Required |
| Search with normal query and wrong keyboard layout | Required | Required | Required | Required |
| Create checklist and search gear inside modal | Required | Required | Required | Required |
| Checklist sorting and checked-items-down behavior | Required | Required | Required | Required |
| Share item link as logged-in user | Required | Optional | Required | Required |
| Share item link as anonymous user | Required | Optional | Required | Required |
| Share checklist link and messenger buttons | Required | Optional | Required | Required |

## Proposed Execution Order

1. Run live browser reproduction for P0 issues and capture exact console/network errors.
2. Fix only reproduced P0 defects.
3. Add/verify Supabase migrations and policies before expanding sharing/storage behavior.
4. Do the P2 UX pass after save/search/share flows are stable.
5. Keep P3 items out of the bugfix sprint unless explicitly reprioritized.
