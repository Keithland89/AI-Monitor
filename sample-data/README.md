# `sample-data\` — anonymised extract, so anyone can run the report

`agent365-sample-data.zip` is a full, working copy of a real tenant extract with every
identifying value replaced. It exists so a colleague with no access to the tenant — and no
Azure or Power Platform permissions at all — can open the report and see exactly what it
looks like against real-shaped data.

**5.8 MB zipped, 37 MB unzipped, 114,953 rows across 16 CSVs.**

| | |
|---|---|
| Agents | 20,765 across 3 platforms |
| Environments | 769 |
| Copilot interactions | 48,510 |
| SharePoint agents | 64 observed items — 61 current, 3 deleted/recycled |
| SharePoint agent usage | 2 agents, 3 interactions, both joined exactly to inventory |
| Grounding rollup rows | 8,097 |
| Named knowledge sources | 4,251 |
| Risk factor rows | 23,258 |
| Connector bindings | 6,395 |
| Agent flows | 565 |
| Azure AI Foundry resources | 298 |
| Shadow AI signals | 0 — see [Shadow AI](#shadow-ai-is-empty-on-purpose) |

---

## Using it

Unzip `agent365-sample-data.zip` anywhere, then open `pbip\AI-Monitor.pbip` in Power BI Desktop.

In Power BI Desktop: **Home → Transform data → Manage parameters**, set

| Parameter | Value |
|---|---|
| `DataFolder` | the `data` folder inside the unzipped copy (no trailing slash) |
| `SourceMode` | `Csv` — leave as-is |

then **Close & Apply**. No credentials are requested: CSV mode reads nothing but the folder.

> The `pbip\` build is no longer a cut-down copy. It now carries the same 21 tables, 166
> measures and 16 report pages as `pbip-cloud\` — the two differ only in where each table gets
> its rows, which is what the `SourceMode` parameter selects. The named-knowledge-source pages
> work here too, and the SharePoint inventory page reads `DimSharePointAgent.csv`.

### Shadow AI is empty on purpose

`FactShadowAiSignal.csv` and `FactShadowAiDevice.csv` ship with their headers and no rows.

That is not an oversight and it is not a build that failed halfway. Those two files hold the
result of a Microsoft Defender advanced hunting sweep, and Defender refused the sweep's token
in the tenant this sample was taken from — the same 403 recorded against the Defender row of
the report's own **API coverage** page. Every other lane collected normally, so the honest
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
hosts, knowledge-source URLs and titles, flow names, conversation thread ids, interaction
resource tokens, Defender device names, and all 58,549 GUIDs.

**Kept** — dates, regions, model names, risk scores and bands, platform, activity status,
channel lists, the knowledge-source kind enum, first-party connector ids (`shared_msnweather`),
public documentation hosts (`learn.microsoft.com` alone is 592 of the 4,251 knowledge sources),
and Microsoft's own surface names (`Idea Coach`, `M365 Copilot - Apps`). None of those is
tenant data — they are identical in every tenant, and blanking them would make the report
look wrong rather than make it safer.

### The properties that make it usable

- **The replacement is one-to-one.** Two real agents never collapse into one alias, so counts
  of distinct agents, owners, environments and schema names are unchanged.
- **It is consistent across files.** An agent key is the same alias in all seven files that
  carry it, so every report relationship still resolves — including the rows that were already
  unmatched in the real extract, which stay unmatched at the same counts.
- **Every distribution and total is identical** to the real extract: agents by risk band,
  platform, region, model, environment and owner; interactions by date and host; knowledge
  sources by kind; connectors by id; and the sums behind the cards.
- **Replacement is per-column, never a global find-and-replace.** One real agent is called
  "Product", and replacing that string everywhere would have quietly rewritten
  `EnvironmentType="Production"`.

The generator is checked by a 106-point verifier covering structure, cardinality, referential
integrity, one-to-one-ness, cross-file consistency, a leak scan for every real identifier, and
the analytics above. All 106 pass on the shipped zip.

The verifier earns its keep. The `EntraAgentBlueprintId` column added in this revision holds a
single value shared by every agent, which looked like a Microsoft-published constant worth
keeping verbatim — the leak scan rejected it as a real GUID that had survived. Since the
mapping is deterministic, one real value still becomes exactly one alias and nothing the report
groups by changes, so there was no reason to keep the real one.
