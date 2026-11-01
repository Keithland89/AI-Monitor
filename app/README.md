# AI-Monitor: the app

A Copilot Managed App version of the AI-Monitor Power BI report. It runs entirely in the browser inside the Managed Apps player, reads the same sources as the report through four connectors, and computes every column and measure in TypeScript. Nothing is sent anywhere else.

AI-Monitor is an agent inventory: what agents exist, who owns them, what they can reach and which to fix first. It does not cover usage, value or cost. For those, see the sibling product, [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard). Neither product needs Agent 365.

The app covers the report's inventory, governance, integration, Foundry, Shadow AI and setup pages in seven tabs with sub-views. It adds a **Lifecycle review** under Governance, computed from the Power Platform last-used dates the app already loads.

| Tab | Sub-views | Report pages |
|---|---|---|
| Overview | | Overview |
| Inventory | All agents · Agent inventory · Creators & ownership · SharePoint agents | All Agents, Agent Inventory, Creators, SharePoint Agents |
| Governance & risk | Risk & review · **Lifecycle review** (new) | Governance & Risk |
| Integrations | Tools · Knowledge & grounding · Knowledge sources | Tools, Knowledge & Grounding, Knowledge Sources |
| Azure AI Foundry | | Azure AI Foundry |
| Shadow AI | | Shadow AI |
| Setup & coverage | Data sources & gaps · Live lane status | Data Sources & Gaps |

Slicers (Environment, Platform, Risk band, Agent origin) appear on the tabs whose report pages have them. Selecting an agent anywhere opens the agent drawer from the All agents page.

The tabs sit in a side navigation grouped by job (Agents, Security), which becomes a Menu drawer below 1000px. Headline numbers link to the list behind them: **To retire** opens `#/governance/lifecycle?verdict=Retire`, **High risk** opens `#/governance/risk?band=High`. Lifecycle review hides Keep by default and sorts by severity; the risk review list defaults to High and Medium. A figure whose lane didn't load shows a dash and the reason, never a 0.

Old links still work. `#/sharepoint` opens Inventory → SharePoint agents and `#/usage/lifecycle` opens Governance → Lifecycle review. Links to the removed Usage, Copilot activity and Cost views open the Overview.

## Data modes

- **Live** is the default inside the player. Each lane loads independently and fails soft: a lane that is denied, not set up or broken shows its state and leaves the rest of the app working.
- **Sample** is the anonymised sample in `public/sample` (about 1.6 MB: 1,490 agents and their related rows). It loads automatically when the app runs outside the player (for example under `npm run dev`). In the player you can switch to it from the data-source dialog at any time.- The header always shows which mode is active. The **Setup & coverage → Live lane status** view lists every lane with its state, row count, load time and the last run recorded in each landing table's run log.
- `?mode=sample` or `?mode=live` forces a mode. The choice is remembered for the browser session.

## Data sources and permissions

The app registers four connector data sources by name. Every user signs in to them (SSO) the first time they open the app, and sees only what their own permissions allow.

| Data source | Connector | Lanes | What the signed-in user needs |
|---|---|---|---|
| `powerplatformadminv2` | Power Platform for Admins V2 | A: agents, environments, usage records (last-used dates), agent flows | Power Platform Administrator (or another role that can query Power Platform inventory) |
| `arm` | Azure Resource Manager | Azure AI Foundry accounts, projects and hubs | Reader on the subscriptions to include. Subscriptions that return 403 are skipped. |
| `wdatp` | Microsoft Defender ATP | F: Shadow AI (advanced hunting) | Security Reader with the `AdvancedQuery.Read` permission |
| `commondataserviceforapps` | Microsoft Dataverse (current environment) | D: named knowledge sources · E: SharePoint agents · run logs · user names | Read on the landing tables and on `systemusers` in the landing environment |

Lane A uses `QueryResources` against `PowerPlatformResources` with skip-token paging, ordered by id, and projects the full property bag in TypeScript (`src/data/transforms.ts` ports the report's KQL projections). Foundry lists subscriptions and then `Resources_List` per subscription. Lane F runs the report's advanced hunting queries (`src/data/shadow.ts`).

### Lifecycle review

Lifecycle review sits under **Governance & risk**. It adds no connector, flow, table or query. Each agent's stage comes from its Power Platform last-used date (`microsoft.powerplatformusage/usagerecords` in Azure Resource Graph), the same date that drives the activity status. The thresholds are heuristics, not Microsoft definitions.

- Stage: New (created under 30 days ago), Active (used in the last 30 days), Idle (last used 30 to 90 days ago), Dormant (no use for 90 days) or Never used.
- Verdict, checked in order: Retire (Dormant, or never used 60 days after creation), Review (high risk or no owner), Watch (New, Never used or Idle), otherwise Keep. The stage and verdict also show in the agent drawer.
- Review cadence: Retire now, Review this month, Watch every quarter, Keep twice a year.
- Agent Builder and Azure AI Foundry agents emit no Power Platform usage record. They show as **No usage signal**, as in the report's activity status, and are never counted as idle or dormant or marked for retirement. The `Shared tenant-wide and never used` risk reason still fires for them, so risk scores match the report.
### Ask

The **Ask** button in the header opens a side panel for questions about what the app has loaded. It adds no connector and no query.

- **Grounding.** When you send a question, the app builds a plain-text summary of about 5,000 characters, capped at 9,000. It is built from the data already in the browser: agent counts and origin, ownership gaps, risk, lifecycle verdicts, integrations and knowledge reach, Foundry and Shadow AI. It holds no usage or cost figures, so questions about those point to Analytics Hub. It also names the page you're on, the filters you've set, and any lanes without data, so the answer treats them as unknown rather than zero. Owner names are included only when they've been resolved.
- **In the player, with Cowork on.** The question and summary go to Microsoft 365 Copilot (Cowork) under your account, and the answer streams into the panel. You can stop it part-way. Follow-up questions include the last two answers. Cowork is a developer preview: the player only answers `cowork/*` methods when its `cowork` developer setting is on, and `@microsoft/managed-apps` 0.6 doesn't wrap them yet. `src/ask/cowork.ts` reuses the SDK's bridge channel (`tapBridge()` runs first in `main.tsx`). If Cowork doesn't start within 20 seconds, or rejects the call, the panel switches to handing off.
- **Everywhere else (sample mode, `npm run dev`, or Cowork off).** The panel offers the question with its summary to copy, plus a link to Copilot Chat. "What gets sent" shows the exact text. The app never makes up answers.

### Landing tables

The Dataverse connector reads the environment the app is deployed to. **Deploy the app to the same environment that holds the landing tables.** The app reads these entity sets:

| Lane | Entity set | Run log |
|---|---|---|
| D: Named knowledge sources | `poc_agentknowledgesources` | `poc_knowledgesweepruns` |
| E: SharePoint agents | `poc_sharepointagents` | `poc_sharepointagentloggingruns` |
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
npm test         # vitest: transforms, risk scoring, measures, lifecycle, routes, sample consistency
npm run lint
npm run build    # tsc -b, then vite build into dist/
```

To rebuild the sample from the repo's anonymised sample zip (or from a folder of `Dim*`/`Fact*` CSVs):

```powershell
npm run sample                      # defaults to ../sample-data/ai-monitor-sample-data.zip
npm run sample -- <folder-or-zip>
```

The script keeps about 1,500 agents and every row related to them. It writes these files, plus `manifest.json` with the row counts: `agents`, `environments`, `flows`, `ai-resources`, `sharepoint-agents`, `users`, `shadow-signals`, `shadow-devices`, `connectors`, `knowledge` and `knowledge-sources`.

### Layout

| Path | What it holds |
|---|---|
| `src/generated/` | Connector clients and models generated by the `ms` CLI. Tenant-free; excluded from lint. |
| `src/data/transforms.ts` | Lane A projections, joins, risk scoring, activity status and the other Agent table columns. |
| `src/data/live.ts` | Live loaders for every lane, paging and error classification. |
| `src/data/sample.ts` | Sample loader. |
| `src/data/build.ts` | Assembles the dataset both modes share. |
| `src/data/static.ts` | Static tables from the model: risk factors, agent gaps, API coverage, telemetry coverage, Shadow AI watchlist. |
| `src/metrics/` | Measures (`measures.ts`), the attention list, lane coverage and the lifecycle review (`lifecycle.ts`). |
| `src/ask/` | The Ask panel: grounding summary (`context.ts`), Cowork bridge client (`cowork.ts`) and the panel. |
| `src/pages/` | One file per tab. |
| `src/ui/` | Shared components: tables, charts, drawer, dialogs. |
| `scripts/prepare-sample.mjs` | Builds `public/sample`. |

## Faithfulness to the report

- **Risk score:** no authentication +3 (`None`, `No authentication` or an empty string; a missing value does not score), quarantined +3, shared with the entire tenant +2, shared tenant-wide and never used +1, web search on knowledge +1, uses connectors +1, connected to other agents +1. High is 5 or more, Medium 3 or more, otherwise Low. The tests recompute the score and band for every sample agent and compare them with the values the report shipped.
- **Active (30d)** counts agents whose activity status is Active (7d) or Active (30d).
- Environment ids are joined ignoring case, as the report's relationships do.

## Limitations

- **Names in live mode.** The report resolved owner and creator ids through Microsoft Graph. The app uses `systemusers` in the landing environment instead, which only knows users who exist in that environment. Where a name is not found, the id is shown. If `systemusers` cannot be read, every owner and creator shows as an id.
- Foundry `Resources_List` may omit `publicNetworkAccess` and `disableLocalAuth`, so those columns can be blank in live mode. ARM `nextLink` paging is not followed yet.
- Paging stops at 200 pages of Power Platform inventory and 250,000 rows per Dataverse table. The lane status says when a cap was reached.
- The Defender advanced hunting API is due to retire in February 2027. It is isolated behind one function in `src/data/live.ts`.

## Next

- **Admin actions** from the agent drawer: quarantine an agent (`Set Bot as Quarantined`) and reassign its owner (`Reassign the owner of the bot`), both in Power Platform for Admins V2.
- **Graph name resolution** for owners and creators through an Office 365 Users or Microsoft Graph connector, to match the report.
