# Agent risk rubric

Agent-Monitor gives every agent a risk score, a band and the reasons behind it. The Power BI model (the `Agent` and `RiskDetail` tables) and the app (`app/src/data/transforms.ts`) both apply this rubric, and tests in both hold them to it.

The rubric reads only inventory columns. It needs no usage data, no Agent 365 export and no Agent 365 licence.

## Factors

| Factor | Points | Fires when | Contract columns |
| --- | ---: | --- | --- |
| No authentication configured | 3 | Authentication is blank, `None` or `No authentication` | `arg_agent_config.Authentication` |
| Agent is quarantined | 3 | The agent is quarantined | `arg_agent_config.IsQuarantined` |
| Shared with the entire tenant | 2 | Shared with everyone in the tenant | `arg_agent_config.SharedEntireTenant` |
| Shared tenant-wide and never used | 1 | Shared tenant-wide, has no last-used date, and its platform records one (see below) | `arg_agent_config.SharedEntireTenant`, `arg_agent_detail.LastUsedAt`, `arg_agent_config.CreatedIn` |
| Web search enabled on knowledge | 1 | Web search is on for the agent's knowledge | `arg_agent_config.WebSearchEnabled` |
| Uses one or more connectors | 1 | One or more Power Platform connectors | `arg_agent_config.ConnectorCount` |
| Connected to other agents | 1 | One or more connected agents | `arg_agent_config.ConnectedAgentCount` |

The score is the sum of the points that fire, from 0 to 12. The reasons list each factor that fired, with its points, for example `Shared with the entire tenant (+2); Uses one or more connectors (+1)`. An agent with no factors shows `No risk factors detected`.

## Bands

| Band | Score |
| --- | --- |
| High | 5 or more |
| Medium | 3 or 4 |
| Low | 0 to 2 |

## Platforms with no usage signal

Last use comes from Power Platform usage records in Azure Resource Graph. Agent Builder agents (`CreatedIn` = `Copilot Studio Lite`) and Azure AI Foundry projects never get a last-used date, so a blank date on them means "unknown", not "never used".

For these two platforms:

- "Shared tenant-wide and never used" does not fire.
- They are left out of the Never used, Idle and Dormant counts, and out of the "Shared tenant-wide but never used" attention check.
- Their lifecycle stage is "No usage signal". Their verdict is Review if they are high risk or have no owner, and Keep otherwise.

## Where the columns come from

The column names above are Analytics Hub's table layout, so the rubric gives the same answer however Agent-Monitor is fed:

- **Live**: Power Query reads Azure Resource Graph and shapes the rows into these tables.
- **Analytics Hub**: the model reads the same tables from an Analytics Hub store. Until that store has `arg_agent_detail`, there are no last-used dates, so the model treats every agent as having no usage signal: "Shared tenant-wide and never used" does not fire and nothing counts as never used.
- **Sample**: the CSV build reads the same tables as CSV files.

## Changing the rubric

Change the model and the app together:

- Power BI: the `HasUsageSignal`, `RiskFactorList` and `RiskScore` steps in the `Agent` partition, the `RiskDetail` partition, the `RiskFactor` table, and the `Orphan Risk Agents` and `Agents Never Used` measures, in both `pbip-cloud` and `pbip`.
- App: `RISK_RULES` and `riskBand` in `app/src/data/transforms.ts`, and `NO_USAGE_SIGNAL_PLATFORMS` in `app/src/metrics/lifecycle.ts`.
- Then update this page and the tests in `app/src/data/transforms.test.ts` and `app/src/metrics/measures.test.ts`.
