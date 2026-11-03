# AI-Monitor: the app

A Copilot Managed App version of the AI-Monitor Power BI report. It runs entirely in the browser inside the Managed Apps player, reads the same sources as the report through four connectors, and computes every column and measure in TypeScript. Nothing is sent anywhere else.

It covers all 16 report pages in ten tabs with sub-views. It adds a **Chat & Cowork** view built from the same audit-log lane, a **Cost & consumption** tab that the report doesn't have, three computed views (**Lifecycle & review**, **Habit stages**, cost against use) that reuse data the app already loads, and a **Work patterns** view built from the Microsoft 365 usage reports (lane G).

| Tab | Sub-views | Report pages |
|---|---|---|
| Overview | | Overview |
| Inventory | All agents · Agent inventory · Creators & ownership · SharePoint agents | All Agents, Agent Inventory, Creators, SharePoint Agents |
| Usage | Agent analytics · Usage & popularity · Adoption & activity · **Lifecycle & review** (new) | Agent Analytics, Usage & Popularity, Adoption |
| Copilot activity | Interactions · **Chat & Cowork** (new) · **Habit stages** (new) · **Work patterns** (new) | Copilot Interactions |
| Governance & risk | | Governance & Risk |
| Integrations | Tools · Knowledge & grounding · Knowledge sources | Tools, Knowledge & Grounding, Knowledge Sources |
| Azure AI Foundry | | Azure AI Foundry |
| **Cost & consumption** (new) | Copilot Credits · Azure AI spend | none |
| Shadow AI | | Shadow AI |
| Setup & coverage | Data sources & gaps · Live lane status | Data Sources & Gaps |

Slicers (Environment, Platform, Risk band, Agent origin) appear on the tabs whose report pages have them. Selecting an agent anywhere opens the agent drawer from the All agents page. SharePoint agents moved from their own tab to a view under Inventory; old `#/sharepoint` links still open it.

The tabs sit in a side navigation grouped by job (Agents, Copilot, Spend & platforms, Security), which becomes a Menu drawer below 1000px. Headline numbers link to the list behind them: **To retire** opens `#/usage/lifecycle?verdict=Retire`, **High risk** opens `#/governance?band=High`. Lifecycle hides Keep by default and sorts by severity; Governance's review list defaults to High and Medium. A figure whose lane didn't load shows a dash and the reason, never a 0.

## Data modes

- **Live** is the default inside the player. Each lane loads independently and fails soft: a lane that is denied, not set up or broken shows its state and leaves the rest of the app working.
- **Sample** is the anonymised sample in `public/sample` (about 4.5 MB: 1,488 agents, 48,474 interactions and their related rows, plus 30 days of synthetic cost data, because the source has none). It loads automatically when the app runs outside the player (for example under `npm run dev`). In the player you can switch to it from the data-source dialog at any time.
- The header always shows which mode is active. The **Setup & coverage → Live lane status** view lists every lane with its state, row count, load time and the last run recorded in each landing table's run log.
- `?mode=sample` or `?mode=live` forces a mode. The choice is remembered for the browser session.

## Data sources and permissions

The app registers four connector data sources by name. Every user signs in to them (SSO) the first time they open the app, and sees only what their own permissions allow.

| Data source | Connector | Lanes | What the signed-in user needs |
|---|---|---|---|
| `powerplatformadminv2` | Power Platform for Admins V2 | A: agents, environments, usage records, agent flows · Copilot Credits per agent and the tenant credit pool | Power Platform Administrator (or another role that can query Power Platform inventory and licensing) |
| `arm` | Azure Resource Manager | Azure AI Foundry accounts, projects and hubs · Azure AI spend from Cost Management | Reader on the subscriptions to include, and Cost Management Reader (or Reader) for spend. Subscriptions that return 403 are skipped. |
| `wdatp` | Microsoft Defender ATP | F: Shadow AI (advanced hunting) | Security Reader with the `AdvancedQuery.Read` permission |
| `commondataserviceforapps` | Microsoft Dataverse (current environment) | C: Copilot interactions · D: named knowledge sources · E: SharePoint agents · G: Microsoft 365 usage reports · run logs · user names | Read on the landing tables and on `systemusers` in the landing environment |

Lane A uses `QueryResources` against `PowerPlatformResources` with skip-token paging, ordered by id, and projects the full property bag in TypeScript (`src/data/transforms.ts` ports the report's KQL projections). Foundry lists subscriptions and then `Resources_List` per subscription. Lane F runs the report's advanced hunting queries (`src/data/shadow.ts`).

### Cost & consumption

Two views, each over the last 30 days. No connector, flow or table is added: both read through connectors the app already has, with each viewer's own sign-in.

- **Copilot Credits**: credits billed and not billed per agent, by feature and by environment, joined to the inventory by agent id (case-insensitive). Credits whose agent isn't in the inventory are counted as orphaned. Below them is the tenant capacity table from the credit pool: purchased, allocated and consumed per currency.
  - Per agent: `GetTenantResourcesAcrossEnvironments` with the `MCSMessages` entitlement, paged by continuation token.
  - Pool: `ListCurrencyReports`.
- **Azure AI spend**: daily spend, spend by resource type, top resources and top meters, for Azure OpenAI, AI Services and Foundry (`Microsoft.CognitiveServices/accounts`) and Azure Machine Learning workspaces (`Microsoft.MachineLearningServices/workspaces`).
  - Only subscriptions that hold an AI resource from the Foundry lane are queried, three at a time.
  - Each gets two Cost Management queries through `Provider_Resources_Invoke`: daily cost by resource, and the window total by resource and meter. Amounts are actual cost in the billing currency.

Caveats, not yet checked against a live tenant:

- `GetTenantResourcesAcrossEnvironments` is documented as deprecated. The `MCSMessages` entitlement id and the `nonBillableConsumed` metadata key are assumptions; if they're wrong, the lane loads but shows nothing or no non-billed credits.
- Cost Management data lags by about a day, and some offers (free trials, sponsorships) have none. A query that returns a `nextLink` is counted as truncated and the lane status says so.

The cost lanes are in **Setup & coverage → Live lane status** like every other lane: denied, not set up and empty each explain which role is missing.

### Lifecycle, habits and trends

These views add no connector, flow, table or query. They are computed in the browser from the audit-log interactions and agent inventory that are already loaded. Windows end on the last day with audited interactions, not on today, so a lagging audit feed doesn't look like a drop. The thresholds are heuristics, not Microsoft definitions.

- **Overview week on week**: active agents, active users and agent run-time in the last 7 days against the 7 days before. Total agents shows how many were created in the last 7 days.
- **Habit stages** (Copilot activity), in the style of ValueLens. A person's stage depends on how many different weeks they used Copilot in the last 8:
  - Habitual: 6 or more weeks. Regular: 3 to 5. Trying: 1 or 2.
  - New: first seen in the last 2 weeks. Lapsed: no use in the last 4 weeks but some in the last 90 days.
  - Stages by month are measured on each month's last day, once 8 weeks of history exist. "Moved up" compares each person's stage now with 4 weeks ago.
  - Habit cohorts on Chat & Cowork are different: they measure how many days a week people use Copilot in the weeks they are active.
- **Lifecycle & review** (Usage). Each agent gets a stage and a verdict, also shown in the agent drawer:
  - Stage: New (created under 30 days ago), Never used, Dormant (no use for 90 days), Growing or Declining (distinct users in the last 4 weeks changed by at least 2 and 25% against the 4 weeks before), otherwise Steady.
  - Verdict, checked in order: Retire (Dormant, or never used 60 days after creation), Review (high risk or no owner), Watch (New, Never used or Declining), Promote (Growing, low risk and not shared tenant-wide), otherwise Keep.
  - Return rate: of the people who used an agent in the last 8 weeks, the share who used it in 2 or more weeks, counted per agent and person.
- **Cost against use** (Copilot Credits): each inventory agent's credits beside its audited users and sessions over the same 30 days. An agent is flagged as high cost with few users when it is in the top quarter for credits (with 4 or more agents), has 2 or fewer users, and at most half its interactions are autonomous runs.

### Ask

The **Ask** button in the header opens a side panel for questions about what the app has loaded. It adds no connector and no query.

- **Grounding.** When you send a question, the app builds a plain-text summary of about 5,000 characters, capped at 9,000. It is built from the data already in the browser: agent counts, risk, lifecycle verdicts, 28-day Copilot activity, integrations, cost and Shadow AI. It also names the page you're on, the filters you've set, and any lanes without data, so the answer treats them as unknown rather than zero. Owner names are included only when they've been resolved.
- **In the player, with Cowork on.** The question and summary go to Microsoft 365 Copilot (Cowork) under your account, and the answer streams into the panel. You can stop it part-way. Follow-up questions include the last two answers. Cowork is a developer preview: the player only answers `cowork/*` methods when its `cowork` developer setting is on, and `@microsoft/managed-apps` 0.6 doesn't wrap them yet. `src/ask/cowork.ts` reuses the SDK's bridge channel (`tapBridge()` runs first in `main.tsx`). If Cowork doesn't start within 20 seconds, or rejects the call, the panel switches to handing off.
- **Everywhere else (sample mode, `npm run dev`, or Cowork off).** The panel offers the question with its summary to copy, plus a link to Copilot Chat. "What gets sent" shows the exact text. The app never makes up answers.

## Static shareable demo

The static browser demo is built from the same dashboard pages with a separate entry point and a deterministic, wholly synthetic dataset. It includes every section and sub-view, clickable navigation and filters, and does not import the production data provider, load the anonymized sample, detect the Managed Apps host, call connectors, send telemetry, use the Ask/Cowork bridge, or expose live-data actions.

From `app/`, run `npm ci` and `npm run build:demo`. This writes a self-contained bundle to the repository-root `demo/agent-monitor/` folder for deployment at `/demo/agent-monitor/`; the folder contains `index.html`, local assets, and generated `PROVENANCE.md`. Source and build notes are in [`demo/README.md`](demo/README.md). The bundle is intended for integration into a site, not deployment as the production Managed App.

### Landing tables

The Dataverse connector reads the environment the app is deployed to. **Deploy the app to the same environment that holds the landing tables.** The app reads these entity sets:

| Lane | Entity set | Run log |
|---|---|---|
| C: Copilot interactions | `poc_copilotinteractions` | `poc_copilotinteractionflowrunses` |
| D: Named knowledge sources | `poc_agentknowledgesources` | `poc_knowledgesweepruns` |
| E: SharePoint agents | `poc_sharepointagents` | `poc_sharepointagentloggingruns` |
| G: Microsoft 365 usage reports | `poc_m365usagereports` | none: each row holds its report's HTTP status and collection time |
| Names for owners and creators | `systemusers` | |

A table that does not exist shows as "not set up", never as an error. The tables can be created after the app is deployed; reload the app once they hold data.

## Deploy

Use the installer in [`../installer`](../installer). It builds or copies the app, deploys it to the landing environment and wires up the four data sources.

To deploy by hand with the `ms` CLI (`@microsoft/managed-apps-cli` 0.29.0, Node 24.11 or later):

```powershell
cd app
npm ci
npm run build
ms app init --repo none --display-name "AI-Monitor" --build-type none --build-path ./dist --environment-id <landing environment id>
foreach ($c in 'powerplatformadminv2', 'arm', 'wdatp', 'commondataserviceforapps') {
  ms app add data-source --connector $c --as action --use-sso --skip-codegen --non-interactive --json
}
ms app deploy
ms app share <group ids> --access play   # optional
```

`ms app init` writes `ms.config.json`, which holds your environment and app ids. It is gitignored; never commit it.

## Develop

```powershell
cd app
npm install
npm run dev      # sample mode, no player needed
npm test         # vitest: transforms, risk scoring, measures, Chat & Cowork grouping, sample consistency
npm run lint
npm run build    # tsc -b, then vite build into dist/
```

To rebuild the sample from the repo's anonymised sample zip (or from a folder of `Dim*`/`Fact*` CSVs):

```powershell
npm run sample                      # defaults to ../sample-data/agent365-sample-data.zip
npm run sample -- <folder-or-zip>
```

The script keeps about 1,500 agents and every row related to them, keeps all Copilot Chat and Cowork interactions, and stays under 6 MB.

### Layout

| Path | What it holds |
|---|---|
| `src/generated/` | Connector clients and models generated by the `ms` CLI. Tenant-free; excluded from lint. |
| `src/data/transforms.ts` | Lane A projections, joins, risk scoring, activity status and the other Agent table columns. |
| `src/data/surface.ts` | Copilot surface classification and SharePoint agent identity decoding (FnSurface, FnSpo). |
| `src/data/live.ts` | Live loaders for every lane, paging and error classification. |
| `src/data/sample.ts` | Sample loader. |
| `src/data/m365.ts` | Parses lane G's stored Microsoft 365 usage reports. |
| `src/data/build.ts` | Assembles the dataset both modes share. |
| `src/data/static.ts` | Static tables from the model: risk factors, agent gaps, API coverage, telemetry coverage, Shadow AI watchlist. |
| `src/metrics/` | Measures (`measures.ts`), Chat & Cowork metrics (`chat.ts`) and Work patterns (`patterns.ts`). |
| `src/ask/` | The Ask panel: grounding summary (`context.ts`), Cowork bridge client (`cowork.ts`) and the panel. |
| `src/pages/` | One file per tab. |
| `src/ui/` | Shared components: tables, charts, drawer, dialogs. |
| `scripts/prepare-sample.mjs` | Builds `public/sample`. |
| `scripts/sample-cost.mjs` | Adds the synthetic cost CSVs to `public/sample`, seeded so they're the same every run. `npm run sample` runs all three. |
| `scripts/sample-m365.mjs` | Writes a seeded, synthetic `public/sample/m365-usage.json` in the shape lane G stores, because the source sample has no usage reports. |
| `../solution/work-patterns/build.mjs` | Generates lane G's `M365UsageReports` solution zips (managed and unmanaged). Run `node solution/work-patterns/build.mjs` from the repo root after changing the flow. |

## Faithfulness to the report

- **Risk score:** no authentication +3 (`None`, `No authentication` or an empty string; a missing value does not score), quarantined +3, shared with the entire tenant +2, shared tenant-wide and never used +1, web search on knowledge +1, uses connectors +1, connected to other agents +1. High is 5 or more, Medium 3 or more, otherwise Low. The tests recompute the score and band for every sample agent and compare them with the values the report shipped.
- **Active (30d)** counts agents whose activity status is Active (7d) or Active (30d).
- **Run time** sums, over each thread and day, the time between the first and last interaction.
- Environment ids are joined ignoring case, as the report's relationships do.
- Known differences: the report's "telemetry uplift" measure always returns 0 because of its filter context. The app computes what the tile describes (agents the audit log saw that usage records missed).

## Limitations

- **Names in live mode.** The report resolved owner and creator ids through Microsoft Graph. The app uses `systemusers` in the landing environment instead, which only knows users who exist in that environment. Where a name is not found, the id is shown. If `systemusers` cannot be read, every owner and creator shows as an id.
- Foundry `Resources_List` may omit `publicNetworkAccess` and `disableLocalAuth`, so those columns can be blank in live mode. ARM `nextLink` paging is not followed yet.
- Paging stops at 200 pages of Power Platform inventory and 250,000 interaction rows. The lane status says when a cap was reached.
- The Defender advanced hunting API is due to retire in February 2027. It is isolated behind one function in `src/data/live.ts`.

## Next

- **Admin actions** from the agent drawer: quarantine an agent (`Set Bot as Quarantined`) and reassign its owner (`Reassign the owner of the bot`), both in Power Platform for Admins V2.
- **Graph name resolution** for owners and creators through an Office 365 Users or Microsoft Graph connector, to match the report.
