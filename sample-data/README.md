# `sample-data\` — anonymised extract, so anyone can run the report

`ai-monitor-sample-data.zip` is a full, working copy of a real tenant extract with every
identifying value replaced. It exists so a colleague with no access to the tenant — and no
Azure or Power Platform permissions at all — can open the report and see exactly what it
looks like against real-shaped data.

**5.3 MB zipped, 36 MB unzipped, 85,444 rows across 22 CSVs.**

The files use [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard)'s table
layout: each `arg_*` and `defender_*` file has exactly the columns of the Analytics Hub table of
the same name, so the CSV build runs the same model code as the live and Analytics Hub modes.

| | |
|---|---|
| Agents | 20,765 across 3 platforms — 20,671 Copilot Studio and Agent Builder agents in `arg_agent_config.csv`, 94 Foundry projects in `arg_foundry_resources.csv` |
| Environments | 781 |
| SharePoint agents | 64 observed items — 61 current, 3 deleted/recycled |
| Grounding rollup rows | 8,097 (rebuilt from `arg_agent_detail.csv` and web search) |
| Named knowledge sources | 4,251 |
| Risk factor rows | worked out by the model from the agent rows; no longer shipped |
| Connector bindings | 6,254 |
| Agent flows | 559 |
| Azure AI Foundry resources | 295 |
| Shadow AI signals | 0 — see [Shadow AI](#shadow-ai-is-empty-on-purpose) |

### Files

| File | What it holds | Read by |
|---|---|---|
| `arg_agent_config.csv` | Analytics Hub `arg_agent_config`: one row per Copilot Studio and Agent Builder agent (`CreatedIn` = `Copilot Studio Lite` is Agent Builder) | model |
| `arg_agent_detail.csv` | AI-Monitor's own `arg_agent_detail`, keyed on `SnapshotDate` + `AgentResourceId`: last used, creator, component and knowledge-by-type counts | model |
| `arg_environments.csv` | Analytics Hub `arg_environments` | model |
| `arg_agent_flows.csv` | Analytics Hub `arg_agent_flows` (agent flows only) | model |
| `arg_foundry_resources.csv` | Analytics Hub `arg_foundry_resources`: Foundry accounts, projects and Machine Learning workspaces | model |
| `arg_status.csv` | Analytics Hub `arg_status`: one row per probe | contract only |
| `defender_ai_watchlist.csv` | Analytics Hub `defender_ai_watchlist`: the 22 tools hunted for | model |
| `defender_shadow_ai_daily.csv`, `defender_ai_installed.csv` | Analytics Hub's Shadow AI aggregates (headers only) | model |
| `defender_shadow_ai_device.csv` | AI-Monitor's own per-device Shadow AI rows (headers only) | model |
| `DimUser.csv`, `FactAgentKnowledgeSource.csv`, `DimSharePointAgent.csv` | the Dataverse lanes, unchanged | model |
| `DimDate.csv` | date dimension | model |
| `DimAgent.csv`, `DimEnvironment.csv`, `DimAzureAIResource.csv`, `FactAgentConnector.csv`, `FactAgentFlow.csv`, `FactAgentKnowledge.csv`, `FactShadowAiSignal.csv`, `FactShadowAiDevice.csv` | the earlier flat layout, kept for the web app's sample generator (`app\scripts\prepare-sample.mjs`) | app only |

`DimAgent.csv` carries the current risk rubric: "Shared tenant-wide and never used" is only
judged for platforms that record use, so 7 Agent Builder agents lost that point.

---

## Using it

Unzip `ai-monitor-sample-data.zip` anywhere, then open `pbip\AI-Monitor.pbip` in Power BI Desktop.

In Power BI Desktop: **Home → Transform data → Manage parameters**, set

| Parameter | Value |
|---|---|
| `DataFolder` | the `data` folder inside the unzipped copy (no trailing slash) |
| `SourceMode` | `Csv` — leave as-is |

then **Close & Apply**. No credentials are requested: CSV mode reads nothing but the folder.

> The `pbip\` build is no longer a cut-down copy. It now carries the same 20 tables, 137
> measures and 11 report pages as `pbip-cloud\` — the two differ only in where each table gets
> its rows, which is what the `SourceMode` parameter selects. Named knowledge sources work here
> too, and the SharePoint inventory page reads `DimSharePointAgent.csv`.
>
> Per-conversation usage is not part of AI-Monitor, so the sample carries no interaction data.
> Usage, value and cost are in [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard).

### Shadow AI is empty on purpose

`defender_shadow_ai_daily.csv`, `defender_ai_installed.csv` and `defender_shadow_ai_device.csv`
(and the app's `FactShadowAiSignal.csv` and `FactShadowAiDevice.csv`) ship with their headers and no rows.

That is not an oversight and it is not a build that failed halfway. Those files hold the
result of a Microsoft Defender advanced hunting sweep, and Defender refused the sweep's token
in the tenant this sample was taken from — the same 403 recorded against the Defender row of
the model's own `ApiCoverage` reference table. Every other lane collected normally, so the honest
thing is to ship the sweep's real result rather than invent detections.

The consequence is that the Shadow AI page renders its watchlist of 22 tools with nothing
detected against any of them. The headers are still shipped because they are the contract: in
a tenant where Defender *does* answer, those files fill in and the page lights up with no
change to the model.

Fabricated rows were deliberately rejected here. A sample security report showing invented
"unsanctioned AI tool" detections is worse than an empty one.

---

## What was changed, and what was not

The point of the sample is that it still *behaves* like the real tenant. Everything that
identifies someone is replaced; everything that drives a number or a chart is kept.

**Replaced** — agent names, Copilot Studio schema names, environment names and ids, user
display names and UPNs, owners and creators, Azure resource names, resource groups,
subscription and ARM resource ids, endpoints, custom connector ids, private and SharePoint
hosts, knowledge-source URLs and titles, flow names, Defender device names, and every GUID.

**Kept** — dates, regions, model names, risk scores and bands, platform, activity status,
channel lists, the knowledge-source kind enum, first-party connector ids (`shared_msnweather`),
and public documentation hosts (`learn.microsoft.com` alone is 592 of the 4,251 knowledge
sources). None of those is
tenant data — they are identical in every tenant, and blanking them would make the report
look wrong rather than make it safer.

### The properties that make it usable

- **The replacement is one-to-one.** Two real agents never collapse into one alias, so counts
  of distinct agents, owners, environments and schema names are unchanged.
- **It is consistent across files.** An agent key is the same alias in all five files that
  carry it, so every report relationship still resolves — including the rows that were already
  unmatched in the real extract, which stay unmatched at the same counts.
- **Every distribution and total is identical** to the real extract (before the reshape described below): agents by risk band,
  platform, region, model, environment and owner; knowledge sources by kind; connectors by id; and the sums behind the cards.
- **Replacement is per-column, never a global find-and-replace.** One real agent is called
  "Product", and replacing that string everywhere would have quietly rewritten
  `EnvironmentType="Production"`.

The generator is checked by a verifier covering structure, cardinality, referential
integrity, one-to-one-ness, cross-file consistency, a leak scan for every real identifier, and
the analytics above.

The verifier earns its keep. The `EntraAgentBlueprintId` column added in this revision holds a
single value shared by every agent, which looked like a Microsoft-published constant worth
keeping verbatim — the leak scan rejected it as a real GUID that had survived. Since the
mapping is deterministic, one real value still becomes exactly one alias and nothing the report
groups by changes, so there was no reason to keep the real one.

### Reshaped into Analytics Hub's layout

The `arg_*` and `defender_*` files were built from the anonymised flat files above, never from
tenant data, so they add no new identifiers. `AgentResourceId` is assembled from the anonymised
environment and agent ids. Running the model's own code over them, rather than loading
pre-computed columns, changes a few numbers:

- 7 Agent Builder agents shared tenant-wide lose the "never used" point (the rubric change);
  3 of them drop from Medium to Low.
- 71 Copilot Studio agents with a blank authentication now score "No authentication configured"
  (+3), as the rubric says; the earlier extract had not counted blanks. They move from Low to Medium.
- 141 connector rows with a blank connector id, 6 Microsoft 365 agent flows and 3 Machine
  Learning online endpoints are not in Analytics Hub's tables, so they are gone.
- 12 environments that agents named but the environment list lacked are now listed.
