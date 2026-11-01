# `data\` — local CSV folder for the `pbip\` build

This folder is where the **`pbip\` (CSV) build** looks for its rows. It is **not committed**: a real
tenant extract carries agent names, owners, user principal names and knowledge-source URLs that
should not live in a repo.

The **`pbip-cloud\` build does not read this folder at all** — it queries Azure Resource Graph,
Dataverse and Defender advanced hunting directly.

## Where the files come from

`sample-data\ai-monitor-sample-data.zip` ships a complete, anonymised copy of every file below.
Unzip it and point the `pbip\` build's `DataFolder` parameter at the unzipped `data` folder — that
is the normal way to open the CSV build, and it needs no tenant access at all.

To report on your own tenant, use `pbip-cloud\AI-Monitor.pbip`, which reads the same sources live.

## What lands here

| File | Grain |
|---|---|
| `DimAgent.csv` | one row per agent per environment, all three platforms |
| `DimEnvironment.csv` | Power Platform environment |
| `DimUser.csv` | Entra principals resolved from Microsoft Graph |
| `DimSharePointAgent.csv` | observed SharePoint `.agent` inventory with current/deleted state and audit provenance |
| `DimDate.csv` | date dimension |
| `DimAzureAIResource.csv` | Azure AI / Foundry resources |
| `FactAgentConnector.csv` | agent × connector binding |
| `FactAgentFlow.csv` | agent flows / M365 agent flows |
| `FactAgentKnowledge.csv` | agent × knowledge source type, with a source count |
| `FactAgentKnowledgeSource.csv` | named knowledge sources from the lane D sweep |
| `FactRiskFactor.csv` | one row per agent per risk factor, with its points |
| `FactShadowAiSignal.csv` | Shadow AI detections per tool and layer, from Defender advanced hunting |
| `FactShadowAiDevice.csv` | Shadow AI detections per device |
| `agent-inventory.json` | raw ARG payload, kept for re-processing without re-querying |
| `collection-summary.json` | counts and timings from the last collection |
