<!-- impeccable:product-schema 1 -->
# Product

## Platform

A Copilot Managed App: a client-side React, Vite and TypeScript single-page app that runs inside the Managed Apps player. It reads data through four connectors, and outside the player it runs on the bundled anonymised sample.

## Users

Power Platform, Microsoft 365 and security admins who need to know which agents exist, who owns them, what they can reach and which to fix first.

## Purpose

To bring the AI-Monitor Power BI report into an app that needs no Power BI workspace, gateway or refresh schedule. AI-Monitor is an agent inventory. Usage, value and cost belong to the sibling product, [Analytics Hub](https://github.com/microsoft/AnalyticsHub-Dashboard). Neither needs Agent 365.

The app answers these questions with live data on open:

- What agents exist across Copilot Studio, SharePoint, agent flows and Azure AI Foundry?
- Who owns them, and how widely are they shared?
- Which were built by people, which did the platform provision, and which have no known creator?
- Which are idle, dormant or never used, going by the Power Platform last-used date?
- Which carry risk, and why?
- What knowledge do agents reach, and how much of it is outside the tenant?
- Which agents are ready to retire, and which need a review?
- What unsanctioned AI tools run on managed devices (Shadow AI)?
- What can't we see yet, and what has to be set up to see it?

## Data

- **Live:** Power Platform inventory and usage records (Azure Resource Graph), Azure Resource Manager for Foundry, Defender advanced hunting, and the Dataverse landing tables in the environment the app is deployed to.
- **Sample:** the repo's anonymised sample (`sample-data/ai-monitor-sample-data.zip`), trimmed to about 1,500 agents.

All computation happens in the browser. Every lane fails on its own and says why.

## Constraints

- Public repo: no tenant, environment, app or subscription ids, org URLs or account names in code, docs or sample.
- Each user sees only what their own permissions return.
- The app must be deployed to the landing environment, because the Dataverse connector reads the current environment.
- Logic must match the report's DAX and Power Query, and the tests must prove it against the sample.

## Brand and tone

Plain, factual and quiet. Use short labels and say what a number means. Call it "the app".

## Anti-goals

- Not a write tool in v1: no quarantine, owner changes or sharing changes yet.
- Not a replacement for the Power BI report's historical snapshots; the app shows the current state.
- No extra connectors beyond the four, and no external services.
- No usage, adoption or cost figures: those are Analytics Hub's job.
- No dependency on Agent 365. Where the app compares itself with Agent 365, it says the comparison is optional.
- No heavy compute: new views reuse loaded data with simple, documented rules, not extra queries, notebooks or AI grading.
