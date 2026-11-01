---
name: Agent-Monitor app
description: Calm admin workspace for the agent inventory, ownership and AI risk, computed in the browser from live connectors or the anonymised sample.
colors:
  canvas: "#f5f6f8"
  surface: "#ffffff"
  surface-2: "#f8f9fb"
  ink: "#1b1d2b"
  ink-2: "#4a4d5e"
  ink-3: "#626575"
  line: "#e2e4ea"
  band: "#24224f"
  accent: "#4b47c2"
  accent-soft: "#f0f0fa"
  agent: "#2f7a72"
  risk-high: "#b0382c"
  risk-medium: "#a8682b"
  risk-low: "#a3a6dd"
typography:
  page-title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
  kpi-value:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    fontFeature: "tnum"
  panel-title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.45
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  gutter: "16px"
  page-x: "28px"
components:
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  data-mode-badge:
    rounded: "{rounded.pill}"
  drawer:
    backgroundColor: "{colors.surface}"
---

# Design

## Overview

The app shares its layout with the AI in One app, a pale canvas and white panels, but has its own muted indigo palette, close to the Copilot brand. The look is elegant and stripped back: a flat white header, deep indigo kept for the logo tile and the questions in the Ask panel, and colour spent only where it carries meaning. It is a working tool for admins, so it favours dense tables, plain labels and numbers that line up over decoration.

## Colors

- Indigo is the brand and the default series colour. It is a muted indigo (#4b47c2), not electric violet, because wide-gamut screens oversaturate the brighter one. Teal always means agents.
- Neutral ranked lists (creators, owners, regions, environments) all use the one indigo data hue. Don't switch hue from panel to panel for decoration.
- Coloured dots beside a KPI label mark a population (licensed, unlicensed, agents) only; plain KPIs have no dot.
- Risk uses red (High), amber (Medium) and soft indigo (Low) everywhere, including badges, bars and drawer chips.
- Activity status uses an indigo ramp from dark (most active) to pale (least active). Grey means no signal.
- Lifecycle stages and verdicts have fixed colours too (`LIFECYCLE_COLOR` and `VERDICT_COLOR` in theme.ts).

## Typography

Segoe UI Variable throughout. KPI values use tabular numerals so columns of figures align.

## Layout

- The header band holds the title, the Ask button, the data-mode badge (Live or Sample), the as-of time and the data-source button.
- A white side navigation sits left of the content and runs the full page height, with sections grouped by job: Overview; Agents (Inventory, Governance & risk, Integrations, Azure AI Foundry); Security (Shadow AI); Setup & coverage. Group labels are plain sentence case, not eyebrows. Each section shows a line icon, its name and a one-line description (`blurb` in routes.ts). The current section has the soft-indigo fill, and its views are listed beneath it on a thin rule, the current view in indigo with an accent stroke. A small amber dot marks a section whose data lane failed or isn't in the sample.
- Panels in a row stretch to the same height. Pair panels whose content is roughly as tall: cap a list with `limit`, or put two short panels in one cell with `Stack` beside a tall neighbour, rather than leave a blank panel bottom. A trend chart beside a tall list takes a taller `height` to fill its panel. A lone donut, funnel or gauge centres in its panel.
- Below 1000px (the player's canvas width) the side navigation becomes a drawer opened from a Menu button in the band, which names the current section. It closes on navigation, Escape or a click on the scrim.
- Tabs with several report pages show sub-view pills in the toolbar. On phones they wrap rather than scroll sideways, so every view stays visible.
- The page head holds the title and one intro line. A view with its own intro (`PageIntro`) replaces the tab intro in the head rather than adding a second paragraph in the content.
- Slicers sit in one row above the content and apply to every view on the tab. Under them, one line says "Showing N of M agents", and each slicer that's set shows as a removable pill, with "Clear all" when two or more are set. Below 1000px the slicers fold behind a Filters button, with a count of those set, so the figures start higher; the pills still show what's applied.
- The slicers and the showing line sit in a dock that stays pinned under the band while the page scrolls (a page's own filters join it through `PageFilters`). It stays one compact row: no divider, the showing line pushed right. On phones the dock scrolls away with the page.
- Content flows as KPI cards, then charts, then tables, matching the order of the report page.
- Overview is a briefing on inventory and risk, not a summary of every page: a headline sentence, the estate card split by origin, KPIs for exposure (shared tenant-wide, with no sign-in), owner gaps, knowledge reach, idle or dormant agents, high risk and Shadow AI, then the growth chart and the attention list. It ends with one quiet line pointing to Analytics Hub for usage, value and cost. Any other view shows three or four KPIs; a figure that doesn't change a decision belongs in the drawer or the table, not a card.
- Keep scrolling short: two views of the same series share one panel with a segmented toggle (Overview's growth chart switches between Running total and Per month), and a panel that repeats a KPI card is dropped.
- Filters that a number links to live in the URL query (`#/governance/lifecycle?verdict=Retire`, `#/governance/risk?band=High`), so a filtered list can be bookmarked or shared.

## Elevation & Depth

Flat panels with a 1px line border and a barely-there shadow. No gradients on the header band or KPI cards. Only the agent drawer and dialogs cast a real shadow.

## Shapes

10px panel corners, 8px controls, pill badges.

## Components

- **KPI card:** label, then the figure (value plus an optional change pill), an optional 4px meter for a part of a whole, and one line of context. The change pill compares the last 7 days with the 7 before: green for a good change, red for a bad one, grey for flat, with an arrow so colour isn't the only cue. A value that opens its list is a link: the whole card is the hit area, and hover underlines the value. A value whose lane didn't arrive shows a dash and the reason instead of a zero. A card may end with a sparkline of real data (the last 12 weeks, or 12 months for a running total), bottom-aligned across the row and labelled for screen readers with its first and last values.
- **Agent estate card:** the first card on Overview, twice the width of the others. It shows every agent with the new-in-7-days count, then a bar, name, count and share for each origin: built by people, provisioned by the platform, or creator unknown. On narrow screens it takes the full row.
- **Greeting:** a time-of-day greeting and the as-of date above Overview. It never uses a name.
- **Briefing headline:** one computed sentence under the greeting that states the estate by origin and the two headline risks. It's built from the same measures as the cards, so it never disagrees with them.
- **Attention list:** Overview's `What needs attention` panel, in two groups: "Fix first" for security exposure (high risk with no owner, shared tenant-wide with no authentication), its heading and counts in `--bad`, then "Tidy up" for housekeeping. One row per check, in severity order: the count in tabular numerals, a plain label, and an arrow to the filtered list (Inventory › All agents `?focus=<check>`, Governance › Lifecycle review `?verdict=Retire`). Checks with a zero count are hidden, and a check whose lane didn't arrive is never shown as zero. Rows are divided by `--line` rules, with no tints or badges.
- **Stat list:** a label on the left and a right-aligned tabular figure on the right, one row per line. When the rows are parts of one total, a thin accent bar under each row shows the share.
- **Lane notice:** above a page's figures when a lane it depends on failed, isn't in the sample or returned no rows. It names the lane, says why and links to Live lane status. Failed is a soft red tint; the others are neutral. Overview shows the same as one coverage line for the whole app.
- **Charts:** hand-written SVG with no chart library. Hover shows the exact value. Single-series columns have rounded tops; month axes label every second or third month ("Jan 26") so the labels never overlap. Pick the type by the question, and draw only from data already loaded:
  - BarList for ranked lists; a stacked Distribution bar for status mixes read left to right.
  - Donut for parts of one whole with six or fewer parts (the rest fold into "Other"); shares under 1% read "<1%".
  - Treemap for breakdowns with many parts; slivers under 1.5% join the "n more" tile.
- **DataTable:** sortable and searchable, with compact 34px rows and single-line headers (a long header ends in an ellipsis and shows in full on hover). A footer reads "12 of 1,088" with "Show N more" and "Show fewer". Agent rows open the drawer. A column that is blank, a dash or zero in every row is hidden, and the footer names it ("No data in these rows for …"); pass `keep` for a column whose zeros are the point. Numbers, dates and verdicts never truncate; the minimum width is 96px a column, and below it the table scrolls sideways. Its empty state says whether the search or the filters emptied it.
- **Agent drawer:** identity, origin, risk breakdown by factor, lifecycle stage and verdict, last used, sharing, tools and knowledge for one agent.
- **Lane status:** one row per lane with its state, row count, time and last run.
- **Ask panel:** a side sheet opened from the outlined Ask button in the header. It opens with starter questions for the current section, all about inventory, ownership and risk. Questions sit right-aligned in indigo bubbles; answers are plain text in the panel, never in a card. The handoff block (copy, open Copilot Chat, "What gets sent") is the only boxed element. The panel always states what it will send and where.

## Do's and Don'ts

- Do say why a panel is empty: lane not set up, access denied or no matching rows.
- Don't show 0 for a figure whose lane didn't load; show a dash and the reason.
- Do link a count to the list it counts.
- Do keep the data-mode badge visible at all times.
- Don't invent colours for risk, lifecycle stages or verdicts; use the fixed ones.
- Don't show names that weren't resolved; show the id or "Unresolved".
- Don't rank a blank creator or owner in a top list; leave it out and say how many have none in the panel note.
- Do show Azure regions by name ("East US 2", not "eastus2") with `regionLabel`, connectors with `connectorLabel` ("Dataverse", not "shared_commondataserviceforapps") and knowledge types with `knowledgeLabel` ("Public websites", not "publicSites").
- Do use the `*_TEXT` tones in theme.ts when a risk, stage or verdict colour is used for text; the fill colours are too light to read as text.
