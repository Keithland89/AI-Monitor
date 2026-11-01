# Deployment guide

Step-by-step setup for all five collection lanes (A, B, D, E and F). The [README](../README.md) explains *why* the architecture looks like this; this file is the *how*.

> **Prefer a guided setup?** The [installer](../installer/README.md) automates every step on this page and deploys [the app](../app/README.md). It shows a plan, and changes nothing until you approve it. Deploy the app to the same environment as the landing tables: its Dataverse connector reads only the environment the app runs in.

Lanes A, B and F need nothing installed. Lanes D and E use scheduled collectors. **Skip a collector and every other page still works** — you lose only that lane's data.

Agent-Monitor covers agent inventory and risk. Per-conversation usage, people, Copilot Chat and Cowork, Microsoft 365 work patterns and cost are in [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard). Neither needs an Agent 365 licence or export. Upgrading an install that ran the retired lanes C and G? See [Upgrading from an earlier version](#upgrading-from-an-earlier-version).

---

## Prerequisites

| | Requirement | Needed for |
|---|---|---|
| Identity | **Power Platform Administrator** (or Global Reader, or AI Administrator) | Lane A — agent inventory |
| Identity | **Reader** on every Azure subscription in scope | Lane A — Azure AI Foundry |
| Identity | A Dataverse security role that can read `systemuser` | Lane B — owner and creator names |
| Identity | **Global Administrator** — to consent to the audit app registration | Lane E |
| Identity | **Power Platform Administrator** — to run the lane D grant | Lane D |
| Identity | **Security Reader** (or any role granting advanced hunting), and Defender for Endpoint with devices onboarded | Lane F — shadow AI |
| Licence | **Power BI Pro** (or PPU / Fabric capacity) and a workspace you can publish to | Publishing |
| Tenant | **Unified audit logging switched on** in Purview | Lane E |
| Tooling | Power BI Desktop (free), Node.js 18+, Azure CLI, .NET 8 SDK (only to rebuild the PBIP) | Building locally |

**Not required:** an Agent 365 licence, Copilot Studio licences, Fabric capacity, Power BI Premium, or an on-premises data gateway.

---

## Power Platform solutions — install map

There are **two app registrations in total**, not one per solution:

| App registration | Used by | Permission and tenant setup |
|---|---|---|
| **Audit collector app** | `SharePointAgentLogging` (lane E) only | Microsoft Graph application permission `AuditLogsQuery.Read.All`, granted by a Global Administrator; unified audit logging enabled in Purview. Used only to build the SharePoint agent inventory |
| **Knowledge sweep app** | `AgentAppUserProvisioning` and `AgentKnowledgeSourceSweep` (lane D) | No Graph API permission or admin consent; register it as a Power Platform admin management application. `Agents` scope also needs Reader at the tenant root management group |

Defender does **not** add a third app registration. Lane F uses the signed-in Power BI Organizational-account credential for `https://api.security.microsoft.com`.

Install the solutions in this order:

| Order | Solution or action | App registration | Environment variables | Dataverse connection reference | Finish |
|---|---|---|---|---|---|
| 1 | `SharePointAgentLogging_managed.zip` | Audit collector | `poc_SP_*` | `poc_sharedcommondataserviceforapps_spagent` | Turn on both flows; run the manual flow once |
| 2 | Provision the four shared lane D tables in [lane D step 2](#2-provision-the-tables) | Knowledge sweep | None yet | None | Confirm the four tables exist |
| 3 | `AgentAppUserProvisioning_managed.zip` | Knowledge sweep | `poc_AU_*` | `poc_sharedcommondataserviceforapps_appusr` | Run first with `poc_AU_WhatIf=true`, then grant and populate the environment manifest |
| 4 | `AgentKnowledgeSourceSweep_managed.zip` | Knowledge sweep | `poc_KS_*` | `poc_sharedcommondataserviceforapps_ksweep` | Turn on the daily flow after the manifest contains environments |

Use the unmanaged ZIP with the same base name only when you intend to edit the flows. For a clean deployment, use the managed ZIPs shown above.

For every imported solution:

1. Select or create the Dataverse connection when the import asks for its connection reference.
2. Enter the environment-variable values when prompted. To change them later, open **Power Apps → Solutions → the imported solution → Environment variables**, edit the **Current value**, and save.
3. Replace every exported tenant, app-id, reviewer and secret value with your own; keep the packaged authority, audience, page-size and polling defaults unless your cloud or scale requires a change.
4. To remap a connection later, open **Power Apps → Solutions → the imported solution → Connection references** and select the Dataverse connection named in the table above.
5. Use either the secret environment variable or its Key Vault counterpart — not both.
6. Turn the imported flows off and on after changing environment-variable values so the new values are bound.
7. Check the run-history table before treating the lane as complete.

---

## Lanes A and B — inventory and identity

Nothing to install. Open `pbip-cloud\Agent-Monitor.pbip`, set the parameters, publish, then set credentials in the workspace.

| Parameter | Value |
|---|---|
| `DataverseUrl` | The environment holding the landing tables, e.g. `https://contoso.crm.dynamics.com` |
| `DateStart` | The first day of the `Date` table |
| `SourceMode` | `Live` (default) to read Azure Resource Graph and Defender directly, or `AnalyticsHub` to read Analytics Hub's tables (see below) |
| `SqlServer`, `SqlDatabase` | Analytics Hub's SQL endpoint and database. Used only when `SourceMode` is `AnalyticsHub`; leave the placeholders otherwise |

After publishing, set **all three** data source credentials — Azure Resource Graph, Dataverse and the Defender advanced hunting host — to **Organizational account** with privacy level **Organizational**. If any is left *Private*, the Data Privacy Firewall blocks the model from combining them and the refresh fails with a message that does not mention privacy levels. If the dataset settings also list the SQL placeholder as a data source in `Live` mode, it is never queried in that mode; if the service still asks for a credential for it, set one and tick **Skip test connection**.

### Reading from Analytics Hub instead

If you already run [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard) on Fabric or Azure SQL, set `SourceMode` to `AnalyticsHub` and point `SqlServer` and `SqlDatabase` at its store. The model then reads Analytics Hub's `arg_*` and `defender_*` tables instead of calling Resource Graph and Defender itself. Set the SQL credential to **Organizational account**.

What changes in this mode:

- **Last used, creator and knowledge by type** come from `arg_agent_detail`, which is Agent-Monitor's own table. Until Analytics Hub writes it, these are blank and no agent is judged on use (see [the risk rubric](risk-rubric.md)).
- **Per-device Shadow AI** is empty, because Analytics Hub stores daily totals per tool.
- **Lanes D and E** (named knowledge sources and SharePoint agents) still read Dataverse, so keep `DataverseUrl` set.

---

## Lane D — named knowledge sources

Lane D reads `botcomponents` (`componenttype eq 16`) in **every environment's own Dataverse**, because that is the only place the real SharePoint sites, indexes and connector names exist — Resource Graph carries counts only.

### 1. Register the app

An app registration with a client secret. **No API permissions and no admin consent.** What it needs instead is presence in each environment, which the next step creates.

### 2. Provision the tables

```powershell
node solution\knowledge-sweep\Publish-KnowledgeSources.js --provision --dry-run
node solution\knowledge-sweep\Publish-KnowledgeSources.js --provision
```

This creates everything the sweep flow, the provisioning flow and the manual sweep depend on, and is safe to re-run — anything already present is left alone:

| Table | Holds |
|---|---|
| `poc_agentknowledgesource` | The landing table Power BI reads |
| `poc_sweepenvironment` | The environment manifest — written by step 3, iterated by the daily flow |
| `poc_knowledgesweeprun` | One row per flow run, with counts and status |
| `poc_knowledgesweeperror` | Per-environment and per-record failures |

It also adds the **`poc_uniquekey`** column and the alternate key on it that identifies a knowledge source across runs, backfilling existing rows.

> **Why not `poc_sourceid`?** `botcomponentid` is *not* unique tenant-wide — importing the same solution into many environments preserves its component GUIDs. Measured on a real tenant: 197 ids repeated across 4,251 rows, one of them 13 times. Keying the upsert on it would collapse those rows into one and rewrite it once per environment every night. `poc_uniquekey` is `environmentid_componentid`, which is unique.

> **Why the flow does not address rows *by* that key.** The Dataverse connector's `UpdateRecord` only accepts a primary-key GUID. Passing alternate-key syntax such as `poc_uniquekey='…'` is rejected by the connector gateway with an IIS *File or directory not found* page — verified in testing, where the identical URL called directly against the Web API returns `200`/`204` in every encoding form. So the flow reads a `poc_uniquekey` → GUID index once at the start of the run and updates by real GUID. The alternate key still earns its place: it is what stops a duplicate row ever being created.

These tables are deliberately **not** shipped inside the solution zip. A flow can reference tables outside its own solution, and creating them through the Web API is a path this repo has exercised end to end, whereas hand-authored entity XML cannot be verified short of an import.

### 3. Add the service principal to every environment

This is the part people are most surprised by.

**Dataverse has no tenant-wide service principal.** A service principal can read an environment only where an *application user* record exists in that environment, and being a Power Platform Administrator does not change that — the identity must be provisioned into each environment individually. With 500+ environments that is not a manual job, so it ships as a solution: **`solution\AgentAppUserProvisioning.zip`**.

Import it, then:

1. **Register the app registration as a Power Platform admin management application.** Without this a service principal cannot call `addAppUser` at all — it is not a Dataverse permission and it is not granted by any admin role. A Power Platform Administrator does this once, tenant-wide:

   ```
   PUT https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/adminApplications/{clientId}?api-version=2020-10-01
   ```

   (`New-PowerAppManagementApp -ApplicationId {clientId}` is the same call.)

2. **Set the environment variables.**

   | Variable | Value |
   |---|---|
   | `poc_AU_AppRegID` | The sweep app registration's client id |
   | `poc_AU_Tenant` | Your directory (tenant) id |
   | `poc_AU_Secret` | The app registration's client secret — the same one lane D uses |
   | `poc_AU_UsingAKVtruefalse` | `false`, or `true` to read the secret from Key Vault |
   | `poc_AU_KeyVaultSecret` | The Key Vault secret reference, when the above is `true` |
   | `poc_AU_Authority` | `https://login.microsoftonline.com` — change only for a sovereign cloud |
   | `poc_AU_ScopeMode` | `Agents` to grant only where agents live, `Dataverse` to grant wherever Dataverse exists |
   | `poc_AU_WhatIf` | `true` for the first run — reports what it would grant and grants nothing |
   | `poc_AU_MaxGrants` | `25` — caps a real run |
   | `poc_AU_ReassertAll` | `true` re-asserts every environment; set `false` to work through a backlog under the cap |

   `Agents` scope mode additionally needs the app registration to hold **Reader at the tenant root management group** — Azure Resource Graph's `PowerPlatformResources` rows are tenant-scoped and carry an empty `subscriptionId`, so a subscription-level assignment will not work. `Dataverse` scope mode needs no Azure role.

   > **Turn the flow off and on after changing any variable.** Power Automate binds environment-variable values when the flow is enabled, not per run, so an edited value is otherwise ignored.

3. **Map the one connection reference.**

   | Connection reference | Connector | Parameters |
   |---|---|---|
   | `poc_sharedcommondataserviceforapps_appusr` | Microsoft Dataverse | Any connection to this environment |

   There is deliberately no HTTP connection. The flow calls `api.bap.microsoft.com` and `management.azure.com` with Power Automate's native `Http` action using the client secret above, because the *HTTP with Microsoft Entra ID* connector is **blocked from those first-party resources** by Entra preauthorization and fails with `AADSTS65002` no matter what a tenant admin consents to.

4. **Run it with `poc_AU_WhatIf` still `true`** and read the run row in `poc_knowledgesweeprun`: `rowsfound` is the number of environments in scope, `rowsupdated` the number missing a grant. Nothing has been changed at this point.
5. **Set `poc_AU_WhatIf` to `false` and run it for real.** It grants up to `poc_AU_MaxGrants` environments per run and records each one in `poc_sweepenvironment`; re-run until `rowsupdated` reaches zero, raising the cap once you are satisfied. Anything it could not complete lands in `poc_knowledgesweeperror`.

What the flow does:

1. **Lists the environments in scope** — from Azure Resource Graph in `Agents` mode, so the grant follows the agents rather than blanketing the tenant, or every Dataverse environment in `Dataverse` mode.
2. **Resolves each environment's Dataverse URL** from the Power Platform admin API.
3. **Subtracts the environments already in `poc_sweepenvironment`**, leaving only the ones actually missing a grant.
4. **Creates an application user** in each via the BAP admin endpoint, which the service principal may call once it is a registered admin management application:

   ```http
   POST https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/
        scopes/admin/environments/{environmentId}/addAppUser?api-version=2020-10-01
   { "servicePrincipalAppId": "<clientId>" }
   ```

   The call is **idempotent** — re-granting an environment that already has the user succeeds — which is what makes the flow safe to re-run whenever a new environment appears.
5. **Verifies the grant** by signing in to that environment as the service principal and calling `WhoAmI`. `addAppUser` answers `200` optimistically, so this is the only trustworthy signal; anything that cannot be verified is written to `poc_knowledgesweeperror` instead of being recorded as a success.
6. **Writes the manifest** into `poc_sweepenvironment`, which is the list the daily sweep iterates. It reads the manifest rather than calling global discovery because **discovery under-reports badly for an app-only identity** — with 25 application users granted it still returned one environment.

> **Note the privilege, and decide deliberately.** `addAppUser` creates the application user as **System Administrator** — the endpoint offers no lower-privilege option. The collector only ever issues `GET`s, but the grant itself is broad and is applied to hundreds of environments. Mitigations: the flow scopes itself to agent-bearing environments, defaults to what-if, caps a real run, and keeps `poc_sweepenvironment` as your revocation list. Remember that **deleting the app registration revokes access everywhere at once**.

**Why bother:** sweeping as an interactive admin failed in **92 of 525** environments with *"the user has not been assigned any role"* — the admin is present but unprivileged. As an application user, failures went to **0**.

### 4. Import the solution and turn the flow on

Import `solution\AgentKnowledgeSourceSweep.zip` (Power Platform → Solutions → Import), then:

1. **Set the environment variables** — the import prompts for them, or edit them afterwards under the solution.

   | Variable | Value |
   |---|---|
   | `poc_KS_Tenant` | Your tenant GUID |
   | `poc_KS_AppRegID` | The sweep app registration's client id |
   | `poc_KS_Secret` | Its client secret — leave blank if using Key Vault |
   | `poc_KS_UsingAKVtruefalse` | `true` to read the secret from Key Vault instead |
   | `poc_KS_KeyVaultSecret` | Key Vault secret reference, when the above is `true` |
   | `poc_KS_Authority` | `https://login.microsoftonline.com` — change for a sovereign cloud |
   | `poc_KS_PageSize` | Dataverse page size, default `5000` |

2. **Fix the connection reference** — map `poc_sharedcommondataserviceforapps_ksweep` to a Dataverse connection in the landing environment. The flow cannot be turned on until this is set.
3. **Turn the flow on.** It imports switched off. Check the run history after the first run, then confirm the counts in `poc_knowledgesweeprun`.

The flow does the same work as the manual sweep below: it reads `botcomponents` where `componenttype eq 16` in each manifest environment (20 environments at a time, 8 rows at a time), upserts into the landing table, and tombstones anything it did not restamp.

### 5. The manual / backfill sweep

The Node path remains the way to bootstrap, backfill after an outage, or run without importing anything:

```powershell
node solution\knowledge-sweep\Collect-KnowledgeSources.js --concurrency 8
node solution\knowledge-sweep\Publish-KnowledgeSources.js --publish
```

`Collect-KnowledgeSources.js` is read-only: it writes a cache under `data\` and nothing to the tenant. `--publish` replaces the landing table's rows from that cache. Add `--dry-run` to rehearse either.

| Variable | Purpose |
|---|---|
| `KS_TENANT_ID` | Tenant GUID — set all three to run unattended |
| `KS_CLIENT_ID` | The sweep app registration |
| `KS_CLIENT_SECRET` | Its client secret |
| `KS_DATAVERSE_URL` | Target environment for the landing table |

Without the `KS_*` variables the sweep falls back to your signed-in Azure CLI identity, which is fine for a one-off run but hits the 92-environment gap above.

### 6. Verify

Open the **Risk · Knowledge reach** page and check that named sources appear. The `Knowledge Source Freshness` measure reads `2026-09-03 (today)`, `(3d ago)`, `(33d ago - STALE)` past a week, or `Never collected`.

> **Two ways to keep it fresh.** The shipped flow runs daily once you turn it on in step 4; the Node collector below is the manual alternative for a bootstrap or a backfill. If you only ever run the manual path, the published rows are a point-in-time snapshot — the freshness measure is what makes that visible.

Agent Builder agents are not covered by this lane at all — they are never stored in Dataverse, so their grounding is visible at *type* level only, from Resource Graph.

---

## Lane E — SharePoint agent inventory

### 1. Register the audit app

The SharePoint inventory collector reads the Purview unified audit log through Microsoft Graph. This app registration is used only for the SharePoint agent inventory.

1. Register an application in Entra ID. No redirect URI is needed.
2. **API permissions** → *Microsoft Graph* → **Application permissions** → `AuditLogsQuery.Read.All`.
3. **Grant admin consent.** Without it every call returns `401` and the flow reports success while writing nothing.
4. Create a **client secret** and record it. Note the expiry.

| Requirement | Value |
|---|---|
| API permission | `AuditLogsQuery.Read.All` (Application) |
| Consent | Global Administrator consent |
| Tenant setting | Unified audit logging switched on in Purview |
| Extra SharePoint permissions | None — do not add `Sites.Read.All` or `Files.Read.All` |

> `AuditLog.Read.All` is *not* sufficient. `/security/auditLog/queries` is governed by its own `AuditLogsQuery` permission family.

### 2. Import the solution

Import `solution\SharePointAgentLogging.zip` or `solution\SharePointAgentLogging_managed.zip`. It contains:

| Component | Purpose |
|---|---|
| `poc_SharePointAgent` | One row per observed `.agent` file, keyed by `ListItemUniqueId` |
| `poc_SharePointAgentLoggingRun` | Query, inventory and Dataverse write counts per run |
| `poc_SharePointAgentLoggingError` | Query, paging and row-write errors |
| *Daily SharePoint Agent Inventory to Dataverse* | Scheduled full-retention snapshot |
| *Manual — SharePoint Agent Inventory to Dataverse* | Same logic, on demand |

> Raw flow exports are **deliberately not committed** — the flow API resolves secret-typed environment variables in plaintext and would embed the live client secret. **A solution export does not mask them either**: if the variable holds a current value, that value leaves the tenant inside the zip. The zips here were exported with the value cleared to the placeholder `insertsecrethere`. Clear the value before you export, and check the export before you share it.

### 3. Set the environment variables

| Variable | Value |
|---|---|
| `poc_SP_Tenant` | Your tenant GUID |
| `poc_SP_AppRegID` | The audit app registration's client id |
| `poc_SP_Secret` | Client secret when Key Vault mode is off |
| `poc_SP_UsingAKVtruefalse` | `true` to use `poc_SP_KeyVaultSecret`; otherwise `false` |
| `poc_SP_KeyVaultSecret` | Key Vault-backed secret value when enabled |
| `poc_SP_Authority` | `https://login.microsoftonline.com` for the public cloud |
| `poc_SP_Audience` | `https://graph.microsoft.com` |
| `poc_SP_LookbackDays` | Complete snapshot window; default `180` |
| `poc_SP_PollSeconds` | Delay between asynchronous query checks; default `20` |

Map `poc_sharedcommondataserviceforapps_spagent` to a Dataverse connection in the landing environment, then turn on both flows.

### 4. Run and verify

Run the manual flow once. It starts a Purview `sharePointFileOperation` query filtered by keyword `.agent`, waits for completion, fetches every page, groups by lowercase `ListItemUniqueId`, and writes the latest state of each item. The daily flow then repeats the same complete snapshot.

Check the latest `poc_SharePointAgentLoggingRun` row:

- `poc_status` should be `Completed`
- `poc_recordsretrieved`, `poc_agentrecords` and `poc_agentsfound` should be non-zero
- `poc_currentagents + poc_deletedagents` should equal `poc_agentsfound`
- `poc_rowerrors` should be zero

The acceptance run in the source tenant returned **4,991 records, 723 `.agent` events, 64 distinct items, 61 current and 3 deleted/recycled**, with zero errors.

The table is deliberately an **observed-retention inventory**. A `.agent` file with no file operation inside the lookback window cannot be inferred from the audit log and will not appear.

---

## Lane F — shadow AI on endpoints

Lane F finds unsanctioned AI desktop tooling — Claude Code, GitHub Copilot CLI, Ollama, Cursor — on managed devices. **There is nothing to install and nothing to schedule:** the semantic model queries Defender advanced hunting directly at refresh time, exactly like lanes A and B.

### 1. Check the prerequisites

| | Requirement |
|---|---|
| Licence | **Defender for Endpoint** (P1/P2 or Defender for Business), with devices onboarded |
| Identity | **Security Reader**, or any Entra role that grants advanced hunting |

Only onboarded devices are visible. Unmanaged and BYO devices are invisible to this lane by definition — worth stating explicitly when presenting the numbers.

### 2. Set the credential

The Defender host is the third data source in the model. In the workspace, set **`https://api.security.microsoft.com`** to **Organizational account** with privacy level **Organizational** — the same as the other two.

**Tick "Skip test connection" before signing in.** Power BI validates a Web source by issuing a plain `GET` against the registered host, and the advanced hunting API serves no document at its root, so the test always comes back:

> Failed to update data source credentials: Web.Contents failed to get contents from `'https://api.security.microsoft.com/'` (404): Not Found

That 404 is the API behaving normally, not a bad credential — the host is registered bare precisely because the query travels in `RelativePath` and `Query`, which is what keeps the source *static* and refreshable without a gateway. Skipping the test stores the token and refresh then calls `api/advancedqueries` correctly. The other two sources do not need this.

### 3. Verify

Open the **Shadow AI** page. Three layers are queried separately, because they answer different questions:

| Layer | Table | Proves | Blind to |
|---|---|---|---|
| **Installed** | `DeviceTvmSoftwareInventory` | a packaged AI app is present | portable binaries, per-user installs |
| **Executed** | `DeviceProcessEvents` (30 days) | the tool actually ran, and by which user | tools installed but not launched in the window |
| **Network** | `DeviceNetworkEvents` (30 days) | the device reached an AI service | nothing — the broadest layer, and the only one that sees pure browser use |

A tool that appears in *Network* but not in *Installed* is the normal shape for browser-based use, not an inconsistency. The **Executed** layer is the one that catches CLI tooling such as Claude Code and GitHub Copilot CLI, which never appears in software inventory because it installs per user without an installer.

---

## Credential lifecycle

| Secret | Used by | Watch for |
|---|---|---|
| Lane E audit app registration | The SharePoint agent inventory flows | The collector stops advancing and records a failed run in `poc_SharePointAgentLoggingRun` |
| Lane D app registration | `Collect-KnowledgeSources.js`, the *Provision Sweep App Users* flow | Fails **silently** — `poc_collectedat` simply stops advancing |

**An expiring secret is the most likely way this report goes stale.** Set a calendar reminder against the audit and knowledge-sweep app expiry dates. Lane D is the dangerous one, which is exactly why the freshness measure exists.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Agent counts far lower than expected | The signed-in identity lacks a tenant-wide role. ARG returns only what you can see, silently. |
| Foundry projects missing | Missing **Reader** on those subscriptions. Absent subscriptions do not error. |
| Refresh fails mentioning data combination | A credential is set to *Private*. All three must be **Organizational**. |
| No named knowledge sources, refresh green | Lane D has never run. `FnDataverseOptional` degrades a missing table to an empty one by design. |
| SharePoint agents page empty, refresh green | Lane E has never completed or no `.agent` operation exists inside the lookback window. Check `poc_SharePointAgentLoggingRun` and `poc_SharePointAgentLoggingError`. |
| Sweep returns 403 for many environments | Running interactively rather than as the application user, or those environments have no grant yet. Run the *Provision Sweep App Users* flow first. |

---

## Upgrading from an earlier version

**Renamed from AI-Monitor.** Installs made under the AI-Monitor, Agent Inventory or Copilot Inventory names carry over. The installer reads the old install record and app work folder, accepts the old `AI_MONITOR_*` environment variables, and adopts and renames the existing app registrations rather than creating new ones. Key Vault secret names are unchanged. Republish the report from the renamed `Agent-Monitor` PBIP or template; the old report keeps refreshing until you do.

Earlier versions also collected Copilot interaction telemetry (lane C) and Microsoft 365 work patterns (lane G), and the app had Chat & Cowork, Work patterns and Cost & consumption views. Those now belong to [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard), and the current model and app no longer read them. Lanes A, B, D, E and F are unchanged, so nothing else needs reinstalling.

To remove the retired pieces from an existing environment:

1. **Republish the report and the app** from this version first, so nothing still reads the retired tables when you remove them.
2. **Turn off the retired flows.** In **Power Automate**, turn off *Sync Audit Logs to Dataverse* and *Manual — Sync Audit Logs to Dataverse* (lane C), and the daily flow in the `M365UsageReports` solution (lane G).
3. **Delete their solutions.** In **Power Apps → Solutions**, delete `CopilotInteractionLogging` and `M365UsageReports`.
   - If you imported the **managed** zips (`CopilotInteractionLogging_managed.zip`, `M365UsageReports_managed.zip`), deleting the solution also removes its flows, environment variables, connection references and tables — including their data.
   - If you imported the **unmanaged** zips, deleting the solution leaves its components behind. Delete the two lane C flows and the lane G flow, the `poc_Audit_*`, `poc_KeyVaultSecret` and `poc_WP_*` environment variables, and the `poc_sharedcommondataserviceforapps_2dd46` and `poc_sharedcommondataserviceforapps_m365use` connection references yourself.
4. **Optionally drop the tables.** Under **Power Apps → Tables**, delete `poc_CopilotInteraction` (entity set `poc_copilotinteractions`), `poc_CopilotInteractionFlowRuns` and `poc_CopilotInteractionFlowRunErrors` if they survived step 3, and `poc_M365UsageReport` (entity set `poc_m365usagereports`). `poc_M365UsageReport` was created outside the solution, so deleting the solution never removes it. Export the data first if you want to keep it.
5. **Trim the app registration.** On the audit collector app, remove the `Reports.Read.All` application permission. Keep `AuditLogsQuery.Read.All` if you run lane E; if you don't, the app registration can go.
6. **Remove the Cost Management Reader assignment** if it was granted only for the app's former Cost & consumption tab. Nothing in Agent-Monitor needs it now.
