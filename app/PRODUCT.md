<!-- impeccable:product-schema 1 -->
# Product

## Platform

A Copilot Managed App: a client-side React, Vite and TypeScript single-page app that runs inside the Managed Apps player. It reads data through four connectors, and outside the player it runs on the bundled anonymised sample.

## Users

Power Platform, Microsoft 365 and security admins who need to know which agents exist, who built them, who uses them and which ones carry risk. They also want to see how Copilot Chat and Cowork are adopted.

## Purpose

To bring the AI-Monitor Power BI report into an app that needs no Power BI workspace, gateway or refresh schedule. The app answers the report's questions with live data on open:

- What agents exist across Copilot Studio, SharePoint, agent flows and Azure AI Foundry?
- Who owns them, and how widely are they shared?
- Which are used, idle or dormant?
- Which carry risk, and why?
- How do people use Copilot Chat, in-app Copilot and Cowork, and is it becoming a habit?
- Which agents are growing, declining or ready to retire, and which need a review?
- What do agents cost in Copilot Credits, against how much they're used, and what does Azure AI cost?
- What can't we see yet, and what has to be set up to see it?

## Data

- **Live:** Power Platform inventory and licensing, Azure Resource Manager and Cost Management, Defender advanced hunting, and the Dataverse landing tables in the environment the app is deployed to.
- **Sample:** the repo's anonymised sample, trimmed to about 1,500 agents. Its cost rows are synthetic, because the source has no cost data.

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
- No heavy compute: new views reuse loaded data with simple, documented rules, not extra queries, notebooks or AI grading.
