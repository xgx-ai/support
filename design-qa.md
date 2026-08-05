# Support workflow design QA

## Evidence

- Source visual truth:
  - `/Users/lukekent/Desktop/Screenshot 2026-08-05 at 12.01.18.png` — Auno support list, 1917 × 928 px.
  - `/Users/lukekent/Desktop/Screenshot 2026-08-05 at 12.01.24.png` — Auno request detail, 1920 × 926 px.
- Browser-rendered implementation:
  - `/Users/lukekent/.codex/visualizations/2026/08/05/019fd0b2-5899-7a32-9372-3c7f7a16d0ee/support-auno-redesign-list.png` — applications list, 1280 × 720 px.
  - `/Users/lukekent/.codex/visualizations/2026/08/05/019fd0b2-5899-7a32-9372-3c7f7a16d0ee/support-auno-redesign-ticket.png` — ticket review, 1265 × 712 px.
- Normalized comparison:
  - `/Users/lukekent/.codex/visualizations/2026/08/05/019fd0b2-5899-7a32-9372-3c7f7a16d0ee/support-auno-ticket-comparison.png` — focused Auno source on the left and implementation on the right, normalized into two 900 × 860 px panels.
- CSS viewport: approximately 1280 × 720 at device scale factor 1. The ticket capture excludes the browser scrollbar edge, producing 1265 × 712 pixels.
- State: light theme; applications list; AMA “For review” list; ticket #4819 awaiting plan approval with disclosures collapsed.

## Full-view comparison

- The applications and request screens now use the source hierarchy: quiet page heading, one flat table surface, compact search/filter toolbar, horizontal row dividers, and status as the only strong row badge.
- The ticket is centered at a readable document width. One white card contains title, status/meta, customer report, recommendation, and decision buttons. Agent evidence and workflow metadata are kept in a secondary disclosure card.
- The large competing cards, tabs, repeated badges, and always-visible technical grids from the earlier implementation are gone.

## Focused comparison

The combined comparison keeps the main content regions readable at the same displayed height. It confirms matching visual intent across the important surfaces: centered request document, restrained border/shadow, 20 px title hierarchy, compact metadata, neutral review inset, coral primary action, and a separate lower discussion/evidence surface. No additional crop was needed because the title, body, status, recommendation, and actions are legible in the combined evidence.

## Required fidelity surfaces

- Fonts and typography: both use an Inter/system sans stack, semibold 18–20 px page titles, 13–14 px body copy, 12 px metadata, and compact uppercase table headings. Wrapping remains deliberate and no content is truncated.
- Spacing and layout rhythm: the list is fluid and the ticket is centered and narrow. The 8/12/16/20/24 px rhythm, subtle radii, borders, and low elevation match the source’s density.
- Colors and tokens: the implementation uses a cool grey page, white surfaces, dark neutral text, muted metadata, pale amber review status, and coral primary buttons. Contrast remains clear without returning to the earlier black-and-white treatment.
- Image quality and assets: the demo ticket has no attachments, so no placeholder or copied customer imagery was introduced. The screenshots visible in the Auno source are request-specific content, not structural decoration.
- Copy and content: labels are task-led and brief: “For review”, “Agent review”, “Approve plan”, “Request changes”, “Agent activity”, and “Workflow details”. Private/customer visibility is stated once where it matters.
- Icons and controls: the back and search icons use the existing `@xgx/ui` icon family. Status, disclosure, filter, search, and action controls retain their library focus and hover behavior.
- Responsiveness: the supplied source is desktop-only. The implementation uses shrinking page widths, wrapping actions/toolbars, responsive grids, and horizontally scrollable semantic tables for narrower screens; no desktop overflow or clipping was found.
- Accessibility: one `h1` per route, native table semantics, explicit status text, keyboard-activatable application rows, pressed-state filters, named search inputs, and native disclosure state are present.

## Interaction checks

- Opened an application and a ticket from the tables.
- Filtered AMA requests between “For review” and “Active”.
- Searched for “Priority” and confirmed unrelated requests were removed.
- Opened proposal details and private agent activity.
- Confirmed keyboard Enter activates an application row.
- Kept approval/rejection mutations untouched during visual QA.

## Comparison history

- Earlier P1: the ticket presented several peer cards, repeated metadata, and separate tabs, making the approval task hard to find.
  - Fix: replaced the dashboard shape with one request document and one compact review inset; moved evidence and technical metadata into two disclosures.
  - Post-fix evidence: `support-auno-redesign-ticket.png` and `support-auno-ticket-comparison.png`.
- Earlier P1: application and ticket navigation used icon-heavy lists with long compound subtitles instead of a scannable support queue.
  - Fix: introduced flat semantic tables with dedicated status, reporter, priority, repository, count, and date columns.
  - Post-fix evidence: `support-auno-redesign-list.png` and the verified AMA request table state.
- Earlier P2: the palette was visually stark and the dark primary action dominated the page.
  - Fix: mapped the demo tokens to the reference’s light grey, white, muted coral, pale amber, and soft-border palette.
  - Post-fix evidence: all final browser captures.

## Findings

No actionable P0, P1, or P2 differences remain for the requested goal of matching Auno’s simple, readable support hierarchy. Dynamic ticket copy and the absence of attachment images are expected product-data differences.

## Follow-up polish

- P3: a future `@xgx/ui` table-row interactive variant could provide a pointer cursor and stronger focus treatment without local class overrides.
- P3: capture a separate mobile reference if pixel-level mobile fidelity becomes a requirement.

final result: passed
