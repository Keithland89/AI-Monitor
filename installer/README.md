# Agent Monitor installer

The installer switches Agent Monitor on in a tenant. It covers every lane: the audit collectors, the knowledge sweep with its app user grants, the run checks and the app. Everything goes into one Dataverse environment, the **landing environment**.

It signs you in, checks your roles and tenant settings, and then shows a plan. It changes nothing until you approve that plan. Then it works through the plan one step at a time. You can run it again at any time: it picks up where it stopped, repairs what drifted, and upgrades to a newer release.

It automates the manual setup in [docs/deployment.md](../docs/deployment.md). Read that page for what each lane collects and why.

## Quick start

**One line in PowerShell** (Windows PowerShell 5.1 or PowerShell 7, with Node.js 22.13 or later on the PATH):

```powershell
irm https://github.com/Keithland89/agent-inventory/releases/download/installer-v<version>/install.ps1 | iex
```

Replace `<version>` with the version on the [releases page](https://github.com/Keithland89/agent-inventory/releases?q=installer-v). The repo's "Latest" release may not be an installer release, so the command names the version.

The launcher does the following:
- downloads `agent-inventory-installer.zip` from that release and checks its SHA-256;
- unpacks it under `%LOCALAPPDATA%\AgentInventory\installer`;
- runs `npm ci` for the installer;
- opens the installer in your browser.

It needs no admin rights and doesn't change your execution policy. If your policy doesn't allow it, use a clone of the repo instead (below), or ask your IT team. Don't work around the policy.

Launcher options (in a saved `install.ps1`), or the environment variables to use with `irm | iex`:

| Option | Environment variable | What it does |
| --- | --- | --- |
| `-ZipPath <file>` | `AGENT_INVENTORY_ZIP` | Uses a zip you downloaded yourself, for example when a proxy blocks GitHub's download host. It must be from the same release. |
| `-Proxy <url>` | `AGENT_INVENTORY_PROXY` | Downloads through a proxy, signed in as you. |
| `-Uninstall` | | Removes the unpacked installer only. Your tenant and your install record are left alone. |

Anything else is passed to the installer, for example `.\install.ps1 status` or `.\install.ps1 install --device-code`. The launcher also writes `%LOCALAPPDATA%\AgentInventory\agent-inventory-install.cmd`, which runs the same version again later.

**From a clone** (any OS with Node.js 22.13 or later; deploying the app needs 24.11 or later):

```powershell
cd installer
npm ci
npm ci --prefix managed-cli   # the pinned managed apps CLI; only needed to deploy the app
node bin/agent-inventory-install.js --ui    # in the browser
node bin/agent-inventory-install.js         # in the terminal (same as: npm start)
node bin/agent-inventory-install.js preview --save-plan plan.md   # the plan, without signing in
```

From a clone, the installer reads the solutions from `../solution` and the app's build from `../app/dist`. If there's no build, it builds the app first with `npm ci` and `npm run build` in `app/`.

## Commands

| Command | What it does | Signs in | Changes things |
| --- | --- | --- | --- |
| `install` (default) | Checks the prerequisites, shows the plan, and on approval sets up every lane. Run it again to carry on or repair. | yes | after approval |
| `update` | `install` for an existing install record, for example to pick up a new release. | yes | after approval |
| `status` | What the install record says was installed. | no | no |
| `check` | Reads the environment: the solutions, the flows, and the newest row in each lane's run table. | yes | no |
| `deploy-app` | Builds the app if needed and deploys it again. Use it after a Managed Apps setting is turned on. It deploys only when the build changed. | yes | yes |
| `access <who>...` | Shares the app (play access) with people or groups, by email or object ID. | yes | yes |
| `rotate-secret` | New client secrets for the app registrations, written where the flows read them. `--app audit\|sweep` does one only; `--remove-old` deletes the secret it replaced. | yes | yes |
| `uninstall` | Removes what the install record says the installer made, after a confirmation. See [Uninstall](#uninstall). | yes | after confirmation |
| `prereqs` | Only the prerequisite checks. | yes | no |
| `preview` | Prints the plan from the install record, offline. | no | no |

Run `node bin/agent-inventory-install.js --help` for every option. These are the options you're most likely to need:

- `--environment <id|url>`: the landing environment.
- `--scope-mode Agents|Dataverse`: the knowledge sweep's scope mode.
- `--key-vault <name>`: keep the client secrets in Key Vault.
- `--viewer-group <id>`: share the app with an Entra group.
- `--reviewer-email <address>`: who gets the knowledge sweep's summary.
- `--max-grants <n>`: the most app users the grant flow adds in one run.
- `--skip-app`: leave out the app.
- `--save-plan <file.md>`: also save the plan as Markdown.
- `--config <file>`: use another install record.
- Sign-in: `--device-code`, `--use-az` and `--client-id`.

## The plan

The installer shows this plan after the prerequisite checks. Steps that are already done say so, and are skipped.

| # | Step | What it creates or changes | Role it needs |
| --- | --- | --- | --- |
| 1 | Sign in | Nothing. One browser sign-in gets tokens for Microsoft Graph, Azure, Power Platform and Dataverse. | Any user |
| 2 | Check prerequisites | Nothing. See [Prerequisites](#prerequisites). | Any user |
| 3 | Confirm the landing environment | Nothing. The tables, the flows and the app all go into this one environment, because the app reads the tables through the current-environment Dataverse connector. | System Administrator there |
| 4 | App registration: Agent Monitor - audit collector | A single-tenant app registration with its service principal. It gets the Microsoft Graph application permissions `AuditLogsQuery.Read.All` (lanes C and E) and `Reports.Read.All` (lane G), admin consent, and a client secret. | Can register apps. The consent needs Global Administrator or Privileged Role Administrator. |
| 5 | App registration: Agent Monitor - knowledge sweep | A single-tenant app registration with no API permissions and a client secret. It's registered as a Power Platform admin management application. | Can register apps. The admin registration needs Power Platform Administrator. |
| 6 | Reader at the tenant root management group *(asks again)* | Azure Reader for the knowledge sweep app at the tenant root, so Agents scope mode can find the environments with agents. Only used in Agents mode. | Owner or User Access Administrator at the root |
| 7 | Dataverse connection for the flows | Reuses your working Dataverse connection in the landing environment, or creates one in your name. The flows' connection references are bound to it. | Environment Maker |
| 8 | Lane C: import CopilotInteractionLogging | The managed solution, and its environment variables: tenant, app ID and secret. | System Administrator |
| 9 | Lane E: import SharePointAgentLogging | The managed solution, and its environment variables. | System Administrator |
| 10 | Lane G: create the work patterns table | `poc_M365UsageReport`: one row for each Microsoft 365 usage report, holding its latest 30 days as JSON. A table that is already there is left alone. | System Administrator |
| 11 | Lane G: import M365UsageReports | The managed solution and its environment variables. Its daily flow copies five Microsoft Graph usage report counts (Microsoft 365 services, apps, email, Teams and Microsoft 365 Copilot), 30 days at a time, into that table, signing in as the audit collector. | System Administrator |
| 12 | Lane D: create the knowledge source tables | `poc_AgentKnowledgeSource` and the flow tables, with their keys. This is what `Publish-KnowledgeSources.js --provision` does. Tables that are already there are left alone. | System Administrator |
| 13 | Lane D: import AgentAppUserProvisioning | The managed solution, with ScopeMode, `MaxGrants` 25 and `WhatIf` true, so its first run only reports. | System Administrator |
| 14 | Lane D: grant the knowledge sweep in each environment *(asks again)* | Runs the grant flow in what-if mode and shows the result. Only if you approve does it set `WhatIf` to false and run it again. The knowledge sweep becomes an application user with **System Administrator** in each environment in scope (at most `MaxGrants` a run), and stays so through the weekly runs. | Power Platform Administrator |
| 15 | Lane D: import AgentKnowledgeSourceSweep | The managed solution and its environment variables. | System Administrator |
| 16 | Turn the flows on | Turns the seven flows on. Flows whose variables changed are turned off and on again so they read the new values. Each daily flow runs once now. | Owner of the flows (you) |
| 17 | Check the run tables | Nothing. Reads the newest row of each lane's run table. "First run pending" isn't a failure. | System Administrator |
| 18 | Deploy the app | Runs `ms app init` into the landing environment, then `ms app add data-source` for `arm`, `powerplatformadminv2`, `wdatp` and `commondataserviceforapps`, then `ms app deploy`. It shares the app with the viewer group if you gave one. It prints the play URL. | Environment Maker, with the Managed Apps settings on |
| 19 | Lane F: Defender (check only) | Nothing to install. Reports whether Defender for Endpoint and Security Reader are there. | Security Reader |
| 20 | Cost & consumption (check only) | Nothing to install. Reports whether you can read Copilot Credits (Power Platform Administrator) and Azure Cost Management (one test query on up to three subscriptions). | Power Platform Administrator, Cost Management Reader |

### Approval

- **The plan**: you approve it as a whole before anything changes. With `--yes`, the installer takes the defaults without asking.
- **The two broad grants** (steps 6 and 14) are asked about again, on their own, when the installer gets to them. `--yes` doesn't approve them. Pass `--approve-root-reader` or `--approve-grants` to approve them in advance. If you decline:
  - Reader at the root: the installer switches to Dataverse scope mode instead.
  - The app user grants: the grant flow stays in what-if mode, and you can run `install` again later to approve it.
- **Admin hand-offs**: you may not have a role a step needs, such as admin consent, the admin management application, or Reader at the root. In that case the installer doesn't fail. It writes down a link or command for an admin to run, carries on, and lists the hand-offs at the end. They're kept in the install record, and the next run checks whether they were done.

### Prerequisites

`prereqs`, and the start of `install`, report the following:

- **Roles**:
  - Power Platform Administrator, or Global Reader or AI Administrator, for lane A;
  - Global Administrator or Privileged Role Administrator for admin consent (`AuditLogsQuery.Read.All` and `Reports.Read.All`);
  - Security Reader for lane F;
  - Reader on the Azure subscriptions for Foundry;
  - Cost Management Reader (or Reader) on the subscriptions with Azure AI resources, for the Cost & consumption tab's Azure AI spend. The check runs one small Cost Management query.
  - Roles you can activate in PIM are shown as such.
- **Unified audit logging** is on. If it can't be checked, the report says so.
- **Managed Apps tenant settings**: "Allow app creation with the Copilot Managed Runtime CLI" and "External artifacts in managed apps". If either is off, the app step stops with what to turn on, and the rest of the install still finishes. Run `deploy-app` once they're on.
- **Licences**: Power Apps Premium or Copilot Credits, for the people who use the app.
- **Node.js** 24.11 or later, to deploy the app.

A missing role doesn't stop the install. The step that needs it becomes a hand-off.

## Secrets and the install record

The install record is `Documents\Agent Monitor\agent-inventory-install.json`, or the file you pass with `--config`. It holds what the installer made: the tenant, the landing environment, the app registrations' IDs and secret expiry dates, the solution versions, the flows, the app, and the open hand-offs. It never holds a secret or a token. The installer refuses to save one.

The client secrets go into the flows' environment variables (the default). With `--key-vault <name>`, they go into that Key Vault instead, and the variables hold Key Vault references (`UsingAKV`). Only a secret made in the current run is ever written. A re-run doesn't need it again, and `rotate-secret` makes a new one.

## Uninstall

```powershell
node bin/agent-inventory-install.js uninstall
```

It lists what it will do, from the install record, and asks first. It will:
- delete the app;
- turn the flows off;
- delete the solutions that hold no data (newest first);
- remove the knowledge sweep's Reader role at the root;
- unregister the admin management application;
- delete the two app registrations, if it created them;
- delete the Dataverse connection, if it made one.

It never removes what it didn't make. Some things stay unless you add `--delete-data`: the solutions whose tables hold collected data (lanes C and E), the lane D tables, the work patterns table (lane G), and their rows. Secrets in Key Vault stay too. The application users the grant flow added in other environments also stay, but deleting the knowledge sweep app registration ends their access. To remove the unpacked installer itself, run `install.ps1 -Uninstall`.

## Troubleshooting

- **"The Managed Apps settings are off"**: a Power Platform administrator turns on both settings in the Power Platform admin center. Then run `deploy-app`.
- **The app step says Node.js is too old**: install Node.js 24 LTS, then run `deploy-app`. The rest of the install works on 22.13.
- **Sign-in can't get a token for every API**: register a public client app with delegated permissions for Microsoft Graph, Azure Service Management, Power Platform, PowerApps Service, Flow Service and Dataverse. Then pass `--client-id <its app ID>`. You can also use `--use-az` with an Azure CLI sign-in.
- **No browser on this machine**: use `--device-code`.
- **The Dataverse connection couldn't be made**: create a Microsoft Dataverse connection in the landing environment yourself (Power Apps > Connections). Then run `install` again, or pass `--connection-id <its name>`.
- **An import failed**: the error is the solution import's own message. Fix the cause, then run `install` again. Imports that already finished are skipped.
- **A lane says "first run pending"**: the flow is on but hasn't finished a run yet. Run `check` later.
- **A proxy blocks the download**: download `agent-inventory-installer.zip` from the release page and pass `-ZipPath`. Or pass `-Proxy`. If `npm ci` is blocked, set npm's proxy or registry.
- **Execution policy blocks `install.ps1`**: don't bypass it. Run the installer from a clone, or ask your IT team.
- **More detail on an error**: add `--verbose`.

## Development

```powershell
npm ci
npm test            # node --test, all offline: the tenant APIs, the managed apps CLI and npm are mocked
npm run typecheck   # tsc over the JSDoc types
```

`packaging/build-release.js` builds a release into `release/`:
- `agent-inventory-installer.zip`, which holds `installer/`, the five managed solutions in `solution/`, and `app/dist/`;
- `install.ps1`, with the version and the zip's SHA-256 filled in;
- `SHA256SUMS`.

Build the app first, then upload the three files to a release tagged `installer-v<version>`.
