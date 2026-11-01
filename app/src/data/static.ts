// Static reference tables, adapted from the semantic model (tables/*.tmdl and expressions.tmdl) for the inventory-only app.
// Agent 365 is an optional comparison: nothing here is needed to run Agent-Monitor.

export interface AgentGap { sortOrder: number; status: 'Open' | 'Closed'; capability: string; whyMissing: string; howToClose: string }
export interface ApiCoverageRow { sortOrder: number; source: string; endpoint: string; result: string; verdict: string; whatItGives: string }
export interface TelemetryCoverageRow { sortOrder: number; platform: string; inventory: string; configuration: string; sharing: string; usageSignal: string; whyNot: string }
export interface RiskFactorRow { sortOrder: number; factor: string; score: number; rationale: string }
export interface WatchItem { category: string; vendor: string; appName: string; posture: string; softwareMatch: string; vendorMatch: string; processName: string; domain: string }

export const AGENT_GAPS: AgentGap[] = [
  {
    "sortOrder": 1,
    "status": "Open",
    "capability": "Agent identity / Entra Agent ID",
    "whyMissing": "Agent 365 surfaces agent identities as first-class directory objects.",
    "howToClose": "Partly covered: entraAppId is captured per agent, and creator/owner GUIDs are already resolved to real names via Graph directoryObjects/getByIds. Join to Entra service principals for sign-in logs."
  },
  {
    "sortOrder": 2,
    "status": "Open",
    "capability": "DLP policy violations",
    "whyMissing": "Agent 365 flags policy breaches.",
    "howToClose": "Power Platform DLP policies via the BAP API, joined to the connector fact table already in this model."
  },
  {
    "sortOrder": 3,
    "status": "Open",
    "capability": "Foundry agent-level inventory",
    "whyMissing": "Individual agents inside a Foundry project.",
    "howToClose": "Foundry data-plane /assistants API per project endpoint; needs per-project RBAC and the real project endpoint."
  },
  {
    "sortOrder": 4,
    "status": "Open",
    "capability": "Teams / M365 publication state",
    "whyMissing": "Whether an agent is published to the Teams app catalog.",
    "howToClose": "Graph /appCatalogs/teamsApps with AppCatalog.Read.All via an app registration."
  },
  {
    "sortOrder": 5,
    "status": "Open",
    "capability": "Lifecycle enforcement",
    "whyMissing": "Agent 365 can block, quarantine and retire agents.",
    "howToClose": "Not closable read-only. Power Platform admin PowerShell can disable agents, but there is no equivalent governance surface."
  },
  {
    "sortOrder": 6,
    "status": "Closed",
    "capability": "SharePoint agent inventory",
    "whyMissing": "SharePoint agents are .agent files in document libraries, not Power Platform resources, so Azure Resource Graph cannot enumerate them.",
    "howToClose": "Closed by SharePointAgentLogging. A daily Purview sharePointFileOperation query for .agent reconstructs the latest observed state per ListItemUniqueId and lands it in Dataverse. This is an observed-retention inventory: a file with no operation inside the configured audit window remains invisible."
  },
  {
    "sortOrder": 7,
    "status": "Closed",
    "capability": "Named knowledge sources",
    "whyMissing": "Resource Graph carries knowledge counts by type only - no URL appears anywhere in an agent properties.",
    "howToClose": "Closed for Copilot Studio by the knowledge sweep: botcomponents (componenttype 16) read from every environment Dataverse and republished into the one environment the model reads. 4,324 named sources across 515 environments, naming 3,097 agents, swept from all 742 environments the sweep identity can reach. Agent Builder stays uncovered because those agents are never stored in Dataverse. The page carries the sweep date and flags it STALE past a week - a dataset refresh proves the table was read, not that the names are current."
  }
]

export const API_COVERAGE: ApiCoverageRow[] = [
  {
    "sortOrder": 1,
    "source": "Azure Resource Graph",
    "endpoint": "PowerPlatformResources / microsoft.copilotstudio/agents",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Full agent inventory for Copilot Studio and Agent Builder, including topics, tools, knowledge, connectors, sharing, model and orchestration."
  },
  {
    "sortOrder": 2,
    "source": "Azure Resource Graph",
    "endpoint": "PowerPlatformResources / microsoft.powerplatformusage/usagerecords",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Per-resource lastUsed signal. It drives last-used dates and idle and dormant status."
  },
  {
    "sortOrder": 3,
    "source": "Azure Resource Graph",
    "endpoint": "PowerPlatformResources / microsoft.powerplatform/environments",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Environment names, types, regions and managed status."
  },
  {
    "sortOrder": 4,
    "source": "Azure Resource Graph",
    "endpoint": "PowerPlatformResources / agentflows + m365agentflows",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Autonomous agent flows and Microsoft 365 agent flows."
  },
  {
    "sortOrder": 5,
    "source": "Azure Resource Graph",
    "endpoint": "resources / cognitiveservices + machinelearningservices",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Azure AI Foundry accounts, hubs and projects."
  },
  {
    "sortOrder": 6,
    "source": "Microsoft Graph",
    "endpoint": "/copilot/admin/catalog/packages",
    "result": "Blocked (403)",
    "verdict": "Agent 365 only (optional)",
    "whatItGives": "The Copilot agent registry. Officially requires a Microsoft Agent 365 licence. Agent-Monitor does not need it: Resource Graph gives the same inventory."
  },
  {
    "sortOrder": 7,
    "source": "Microsoft Graph",
    "endpoint": "/beta/copilot/agents",
    "result": "Not available (404)",
    "verdict": "Agent 365 only (optional)",
    "whatItGives": "Endpoint does not exist in this tenant. Agent-Monitor does not need it."
  },
  {
    "sortOrder": 8,
    "source": "Microsoft Graph",
    "endpoint": "/appCatalogs/teamsApps",
    "result": "Blocked (403)",
    "verdict": "Needs consent",
    "whatItGives": "Needs AppCatalog.Read.All, which the Azure CLI token cannot issue. Reachable with a dedicated app registration."
  },
  {
    "sortOrder": 10,
    "source": "Microsoft Graph",
    "endpoint": "/v1.0/directoryObjects/getByIds",
    "result": "Working",
    "verdict": "Working",
    "whatItGives": "Resolves agent creator and owner GUIDs to real display names and UPNs. Works with the plain Azure CLI token - no app registration needed."
  },
  {
    "sortOrder": 11,
    "source": "Dataverse Web API",
    "endpoint": "botcomponents (componenttype 16)",
    "result": "Working, used",
    "verdict": "Working",
    "whatItGives": "The named knowledge sources - the actual SharePoint site, public website, Graph connector or Azure AI Search index each agent reads. Verified as the ONLY place these names exist: an agent's Resource Graph properties expose 67 distinct leaf paths and not one holds a URL. Swept out of band because it means one Dataverse endpoint per environment - 742 here - which Power Query treats as a dynamic data source and the service will not refresh without a gateway. The sweep runs as an application user granted per environment, which also reaches the 92 environments that refuse an interactive admin."
  },
  {
    "sortOrder": 12,
    "source": "Power Platform BAP / PPAPI",
    "endpoint": "environments",
    "result": "Working, superseded",
    "verdict": "Working",
    "whatItGives": "Returned the same environment list. Resource Graph gives the same data in one call."
  },
  {
    "sortOrder": 13,
    "source": "api.powerplatform.com",
    "endpoint": "resourcequery (inventory API)",
    "result": "Failed (400)",
    "verdict": "Failed",
    "whatItGives": "Documented Power Platform inventory endpoint rejected every api-version tried; Resource Graph is the working equivalent."
  },
  {
    "sortOrder": 17,
    "source": "Dataverse Web API",
    "endpoint": "bots (Agent Builder coverage)",
    "result": "Not available",
    "verdict": "Structural gap",
    "whatItGives": "Agent Builder agents are not stored in Dataverse at all. Verified: 0 of 171 matched by schemaName and only 4 by display name, so no named knowledge source can ever be retrieved for them by this route. Their grounding is visible at type level only, from Resource Graph."
  },
  {
    "sortOrder": 18,
    "source": "Microsoft Defender",
    "endpoint": "api.security.microsoft.com/api/advancedqueries",
    "result": "Working from Power BI",
    "verdict": "Working",
    "whatItGives": "Advanced hunting - the Shadow AI lane. Reads DeviceTvmSoftwareInventory, DeviceProcessEvents and DeviceNetworkEvents to find unsanctioned AI tooling on managed devices. The Web connector signs in with an organizational account, so the token is issued for the signed-in user and the lane works for anyone holding Security Reader - proven by live refreshes returning real device rows. A script token is a different matter: the Azure CLI first-party app carries no AdvancedQuery.Read consent and is refused with 403, so this lane cannot be driven from a script without its own app registration. In the service, tick Skip test connection when setting the credential - Power BI validates a Web source by fetching its registered host and advanced hunting returns 404 at the root. Wired up in FnHunt, which fails soft to an empty table so a refusal here cannot block the rest of the model."
  },
  {
    "sortOrder": 19,
    "source": "Microsoft Defender",
    "endpoint": "DeviceTvmSoftwareInventory (licensing)",
    "result": "Working - licensed and onboarded here",
    "verdict": "Working",
    "whatItGives": "The installed-software layer comes from Defender Vulnerability Management, so it needs Defender for Endpoint P2 or the standalone MDVM add-on. Both are present in this tenant and the layer returns live rows. The limit that remains is coverage, not licensing: only devices actually onboarded to Defender are visible, so unmanaged and BYOD devices are invisible to all three Shadow AI layers - precisely where shadow AI is most likely to live. Read the page as a floor, not a census. A tenant without Defender for Endpoint loses this layer only; the executed and network layers degrade independently and FnHunt returns an empty table rather than failing the refresh."
  },
  {
    "sortOrder": 20,
    "source": "Microsoft Defender",
    "endpoint": "DeviceTvmSoftwareInventory (matching)",
    "result": "Working, corrected",
    "verdict": "Working",
    "whatItGives": "Software inventory returns package-registry entries, not just installed applications. The first live refresh reported the Cursor editor on a build agent; the real rows were the npm packages node-cli-cursor and restore-cursor. KQL has_any is token-based, so 'cursor' matches inside 'node-cli-cursor'. The installed layer now asks the server for a name PREFIX and FnInstalledMatch refuses to map a row whose name does not lead with a watched term unless its vendor matches, which keeps 'Anysphere Cursor' while dropping the packages. The executed layer was never affected - it matches FileName with in~, which is exact."
  },
  {
    "sortOrder": 21,
    "source": "Azure Resource Graph",
    "endpoint": "PowerPlatformResources / createdIn (inventory completeness)",
    "result": "Working, verified",
    "verdict": "Working",
    "whatItGives": "Audited on 4 September 2026 to confirm the agent inventory really is tenant-wide. Three checks: only 1 of the 12 PowerPlatformResources types holds agents; createdIn returns exactly two values that sum to the total with nothing left over (20,499 Copilot Studio + 171 Copilot Studio Lite = 20,670, no blanks and no third authoring surface); and the lane is scoped by Power Platform Administrator rather than Azure RBAC, so there is no per-subscription blind spot. Agent Builder carries a titleId on exactly the 100 agents that are published, because the identifier is minted at publish. One caveat: paging this export with $skipToken is only stable when the query orders by a UNIQUE column. Ordering by titleId, which is empty on most rows, returned the right total but a wrong split of 20,512/158; ordering by id returned the correct 20,499/171."
  },
  {
    "sortOrder": 22,
    "source": "Azure AI Foundry data plane",
    "endpoint": "<project>.services.ai.azure.com/api/projects/*/assistants",
    "result": "Blocked (401) on 11 of 12 projects",
    "verdict": "Needs data-plane role",
    "whatItGives": "The only endpoint that can count Foundry AGENTS. Resource Graph returns one row per project, so the 94 Foundry rows in the Agent table are projects, not agents, and Agent Count therefore mixes two units. Measured, not assumed: the one project that did authorise returned 3 agents where the inventory counts 1. Enumerating the rest needs an Azure AI data-plane role on every project, which a tenant-wide inventory identity is unlikely to hold. Foundry is also the one lane governed by Azure RBAC rather than an Entra role, so ARG returns only the subscriptions the refresh identity can read - 7 here - and missing subscriptions are absent silently rather than erroring."
  },
  {
    "sortOrder": 24,
    "source": "Microsoft Graph Purview audit query",
    "endpoint": "/v1.0/security/auditLog/queries (sharePointFileOperation, keyword .agent)",
    "result": "Working, used",
    "verdict": "Working",
    "whatItGives": "The SharePointAgentLogging inventory lane. A 180-day live query returned 4,991 file-operation records, including 723 .agent events over 64 stable ListItemUniqueId values; latest state was 61 current and 3 deleted or recycled. It needs the AuditLogsQuery.Read.All application role and no Sites.Read.All. The limit is audit retention: a .agent file with no operation inside the lookback window is not observable."
  }
]

export const TELEMETRY_COVERAGE: TelemetryCoverageRow[] = [
  {
    "sortOrder": 1,
    "platform": "Copilot Studio",
    "inventory": "Full",
    "configuration": "Full",
    "sharing": "Full",
    "usageSignal": "Yes - lastUsed timestamp",
    "whyNot": "Copilot Studio agents are Dataverse-backed Power Platform resources, so they emit microsoft.powerplatformusage/usagerecords. Verified: 1,648 of 20,354 have ever produced one. Message and user counts are out of scope here: see Analytics Hub."
  },
  {
    "sortOrder": 2,
    "platform": "M365 Copilot Agent Builder",
    "inventory": "Full",
    "configuration": "Full",
    "sharing": "Full",
    "usageSignal": "None (see Analytics Hub)",
    "whyNot": "Declarative agents run inside the Microsoft 365 Copilot host, not the Power Platform runtime, so they emit no Power Platform usage records at all - 0 of 166 matched. Agent-Monitor therefore shows them with no usage signal, so idle and dormant status does not apply to them. Their usage comes from the audit log, which Analytics Hub reads."
  },
  {
    "sortOrder": 3,
    "platform": "Azure AI Foundry",
    "inventory": "Projects only",
    "configuration": "Partial",
    "sharing": "N/A",
    "usageSignal": "None",
    "whyNot": "Resource Graph sees Foundry projects but not the agents inside them, and exposes no usage or activity timestamp for them at all - the Power Platform usage-record table only covers Power Platform resources. Verified: 0 of 93 Foundry projects carry any usage or last-activity property. Per-agent inventory needs the Foundry data-plane /assistants API on each project's own endpoint."
  },
  {
    "sortOrder": 4,
    "platform": "Agent flows",
    "inventory": "Full",
    "configuration": "Full",
    "sharing": "N/A",
    "usageSignal": "Yes - lastUsed timestamp",
    "whyNot": "Agent flows are Power Automate resources and do emit usage records, but verified only 11 of 564 have ever produced one."
  }
]

export const RISK_FACTORS: RiskFactorRow[] = [
  {
    "sortOrder": 1,
    "factor": "No authentication configured",
    "score": 3,
    "rationale": "The agent can be reached anonymously."
  },
  {
    "sortOrder": 2,
    "factor": "Agent is quarantined",
    "score": 3,
    "rationale": "Already flagged by the platform as unsafe."
  },
  {
    "sortOrder": 3,
    "factor": "Shared with the entire tenant",
    "score": 2,
    "rationale": "Every user in the tenant can see and run it."
  },
  {
    "sortOrder": 4,
    "factor": "Shared tenant-wide and never used",
    "score": 1,
    "rationale": "Broad exposure with no offsetting business value."
  },
  {
    "sortOrder": 5,
    "factor": "Web search enabled on knowledge",
    "score": 1,
    "rationale": "Can reach content outside the tenant boundary."
  },
  {
    "sortOrder": 6,
    "factor": "Uses one or more connectors",
    "score": 1,
    "rationale": "Has a path to external or line-of-business data."
  },
  {
    "sortOrder": 7,
    "factor": "Connected to other agents",
    "score": 1,
    "rationale": "Can delegate work, widening the blast radius."
  }
]

export const SHADOW_WATCHLIST: WatchItem[] = [
  {
    "category": "Assistant",
    "vendor": "Anthropic",
    "appName": "Claude Code",
    "posture": "Unsanctioned",
    "softwareMatch": "claude code",
    "vendorMatch": "",
    "processName": "claude.exe",
    "domain": ""
  },
  {
    "category": "Assistant",
    "vendor": "OpenAI",
    "appName": "ChatGPT",
    "posture": "Unsanctioned",
    "softwareMatch": "chatgpt",
    "vendorMatch": "openai",
    "processName": "chatgpt.exe",
    "domain": "chatgpt.com"
  },
  {
    "category": "Assistant",
    "vendor": "Anthropic",
    "appName": "Claude",
    "posture": "Unsanctioned",
    "softwareMatch": "claude",
    "vendorMatch": "anthropic",
    "processName": "",
    "domain": "claude.ai"
  },
  {
    "category": "Assistant",
    "vendor": "Google",
    "appName": "Gemini",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "gemini.google.com"
  },
  {
    "category": "Assistant",
    "vendor": "Perplexity",
    "appName": "Perplexity",
    "posture": "Unsanctioned",
    "softwareMatch": "perplexity",
    "vendorMatch": "perplexity",
    "processName": "perplexity.exe",
    "domain": "perplexity.ai"
  },
  {
    "category": "Assistant",
    "vendor": "xAI",
    "appName": "Grok",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "grok.com"
  },
  {
    "category": "Assistant",
    "vendor": "DeepSeek",
    "appName": "DeepSeek",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "deepseek.com"
  },
  {
    "category": "Assistant",
    "vendor": "Mistral AI",
    "appName": "Le Chat",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "chat.mistral.ai"
  },
  {
    "category": "Assistant",
    "vendor": "Microsoft",
    "appName": "Microsoft Copilot",
    "posture": "Sanctioned",
    "softwareMatch": "microsoft copilot",
    "vendorMatch": "",
    "processName": "",
    "domain": "copilot.microsoft.com"
  },
  {
    "category": "Coding",
    "vendor": "GitHub",
    "appName": "GitHub Copilot",
    "posture": "Sanctioned",
    "softwareMatch": "github copilot",
    "vendorMatch": "",
    "processName": "copilot.exe",
    "domain": "api.githubcopilot.com"
  },
  {
    "category": "Coding",
    "vendor": "Anysphere",
    "appName": "Cursor",
    "posture": "Unsanctioned",
    "softwareMatch": "cursor",
    "vendorMatch": "anysphere",
    "processName": "cursor.exe",
    "domain": "cursor.com"
  },
  {
    "category": "Coding",
    "vendor": "Codeium",
    "appName": "Windsurf",
    "posture": "Unsanctioned",
    "softwareMatch": "windsurf",
    "vendorMatch": "codeium",
    "processName": "windsurf.exe",
    "domain": "codeium.com"
  },
  {
    "category": "Coding",
    "vendor": "Tabnine",
    "appName": "Tabnine",
    "posture": "Unsanctioned",
    "softwareMatch": "tabnine",
    "vendorMatch": "tabnine",
    "processName": "tabnine.exe",
    "domain": "tabnine.com"
  },
  {
    "category": "Local model",
    "vendor": "Ollama",
    "appName": "Ollama",
    "posture": "Unsanctioned",
    "softwareMatch": "ollama",
    "vendorMatch": "ollama",
    "processName": "ollama.exe",
    "domain": "ollama.com"
  },
  {
    "category": "Local model",
    "vendor": "LM Studio",
    "appName": "LM Studio",
    "posture": "Unsanctioned",
    "softwareMatch": "lm studio",
    "vendorMatch": "lm studio",
    "processName": "lm studio.exe",
    "domain": "lmstudio.ai"
  },
  {
    "category": "Local model",
    "vendor": "Nomic AI",
    "appName": "GPT4All",
    "posture": "Unsanctioned",
    "softwareMatch": "gpt4all",
    "vendorMatch": "nomic",
    "processName": "gpt4all.exe",
    "domain": "gpt4all.io"
  },
  {
    "category": "Local model",
    "vendor": "Msty",
    "appName": "Msty",
    "posture": "Unsanctioned",
    "softwareMatch": "msty",
    "vendorMatch": "msty",
    "processName": "msty.exe",
    "domain": "msty.app"
  },
  {
    "category": "Local model",
    "vendor": "Mintplex Labs",
    "appName": "AnythingLLM",
    "posture": "Unsanctioned",
    "softwareMatch": "anythingllm",
    "vendorMatch": "mintplex",
    "processName": "anythingllm.exe",
    "domain": "anythingllm.com"
  },
  {
    "category": "API endpoint",
    "vendor": "OpenAI",
    "appName": "OpenAI API",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "api.openai.com"
  },
  {
    "category": "API endpoint",
    "vendor": "Anthropic",
    "appName": "Anthropic API",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "api.anthropic.com"
  },
  {
    "category": "API endpoint",
    "vendor": "Google",
    "appName": "Gemini API",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "generativelanguage.googleapis.com"
  },
  {
    "category": "API endpoint",
    "vendor": "Hugging Face",
    "appName": "Hugging Face",
    "posture": "Unsanctioned",
    "softwareMatch": "",
    "vendorMatch": "",
    "processName": "",
    "domain": "huggingface.co"
  }
]
