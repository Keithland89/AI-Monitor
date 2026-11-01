# `data\` — local CSV folder for the `pbip\` build

This folder is where the **`pbip\` (CSV) build** looks for its rows. It is **not committed**: a real
tenant extract carries agent names, owners, user principal names and knowledge-source URLs that
should not live in a repo.

The **`pbip-cloud\` build does not read this folder at all** — it queries Azure Resource Graph,
Dataverse and Defender advanced hunting directly, or reads Analytics Hub's tables.

## Where the files come from

`sample-data\ai-monitor-sample-data.zip` ships a complete, anonymised copy of every file below.
Unzip it and point the `pbip\` build's `DataFolder` parameter at the unzipped `data` folder — that
is the normal way to open the CSV build, and it needs no tenant access at all.

To report on your own tenant, use `pbip-cloud\AI-Monitor.pbip`, which reads the same sources live.

## What lands here

With `SourceMode` = `Csv`, the `pbip\` build reads one CSV per [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard)
table, with exactly that table's columns, so the same model code runs in every mode. A missing file
loads as an empty table rather than failing the refresh.

| File | Grain |
|---|---|
| `arg_agent_config.csv` | one row per Copilot Studio and Agent Builder agent (Analytics Hub `arg_agent_config`) |
| `arg_agent_detail.csv` | AI-Monitor's own extra agent fields: last used, creator, counts, knowledge by type (keyed on `SnapshotDate` + `AgentResourceId`) |
| `arg_environments.csv` | Power Platform environment |
| `arg_agent_flows.csv` | agent flow |
| `arg_foundry_resources.csv` | Foundry account, project or Machine Learning workspace; projects become Foundry agents |
| `arg_status.csv` | one row per Resource Graph probe (kept for the contract; not loaded) |
| `defender_ai_watchlist.csv` | AI tool hunted for by Shadow AI |
| `defender_shadow_ai_daily.csv` | devices, users and events per tool per day, and over 7 and 30 days |
| `defender_ai_installed.csv` | devices with each watched tool installed |
| `defender_shadow_ai_device.csv` | Shadow AI detections per device (AI-Monitor's own; live only in the other modes) |
| `DimUser.csv` | Entra principals resolved from Microsoft Graph |
| `DimSharePointAgent.csv` | observed SharePoint `.agent` inventory with current/deleted state and audit provenance |
| `FactAgentKnowledgeSource.csv` | named knowledge sources from the lane D sweep |
| `DimDate.csv` | date dimension |

The sample also carries the earlier flat files (`DimAgent.csv`, `DimEnvironment.csv`,
`DimAzureAIResource.csv`, `FactAgentConnector.csv`, `FactAgentFlow.csv`, `FactAgentKnowledge.csv`,
`FactShadowAiSignal.csv`, `FactShadowAiDevice.csv`). The model no longer reads them; the web app's
sample generator does. Risk factors are worked out by the model, so `FactRiskFactor.csv` is gone.
