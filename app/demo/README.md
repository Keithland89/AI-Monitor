# Agent Monitor demo source

This folder contains the independent HTML entry point for the shareable, static demo. The UI is shared with the app, but the demo entry uses `DemoDataProvider` and a deterministic generator in `src/data/demo.ts`; it does not load the production data provider, sample CSVs, host SDK, connectors, Ask/Cowork bridge, or admin actions. Demo-specific coverage, risk, and watchlist metadata comes from `src/data/demoStatic.ts`; the Setup & coverage section uses demo-only views rather than the app's static API or telemetry findings.

The generated bundle is written to the repository-root `demo/agent-monitor/` directory. It contains `index.html`, locally bundled assets, and generated provenance. It is intended to be mounted at `/demo/agent-monitor/`.

From `app/`, build it with:

```powershell
npm ci
npm run build:demo
```

The app's existing supported runtime is Node.js 24.11 or later. The build runs the TypeScript project check before Vite and requires no sign-in, cloud resources, or paid services. The generator is deterministic and requires no network data.

The repository does not include a repository-level license file. Do not treat the demo source or generated bundle as having an open-source redistribution license; third-party dependencies remain subject to their own upstream licenses.
