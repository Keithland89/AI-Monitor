# Agent Monitor demo provenance

- Canonical source repository: https://github.com/ai-datalab/Agent-Monitor (the configured repository redirects here).
- Source revision: `a3ef3f07a851cfc21f46b4440356d2cfa78b6e91`.
- Base revision: `0d3f94e0fd6fb5a4efece1b75de82217dce2aaea` (merge-base of `HEAD` and `origin/main`).
- Source directory: `app/`; source files changed from the base revision: `app/.gitignore`, `app/README.md`, `app/demo/README.md`, `app/demo/index.html`, `app/package.json`, `app/scripts/write-demo-notices.mjs`, `app/scripts/write-demo-provenance.mjs`, `app/src/App.tsx`, `app/src/DashboardFrame.tsx`, `app/src/DemoApp.tsx`, `app/src/data/DemoDataProvider.tsx`, `app/src/data/demo.test.ts`, `app/src/data/demo.ts`, `app/src/data/demoStatic.ts`, `app/src/demo-main.tsx`, `app/src/index.css`, `app/src/metrics/demoCoverage.ts`, `app/src/pages/DemoSetup.tsx`, `app/src/pages/LaneStatus.tsx`, `app/src/pages/Setup.tsx`, `app/vite.demo.config.ts`.
- Static bundle: repository-root `demo/agent-monitor/`; deploy at `/demo/agent-monitor/`.
- Build command (run from `app/`): `npm ci && npm run build:demo`.
- Build runtime: Node.js v26.13.0; npm 11.20.0.
- Data provenance: deterministic, generated synthetic fixtures in `app/src/data/demo.ts`; no bundled tenant extract is read.
- Runtime behavior: no sign-in, live source, API, telemetry, host bridge, collector, or admin action is used.
- Public distribution permission: an authorized source copyright holder granted permission on 2026-11-03 to copy, host, publicly display, and redistribute this demo bundle and its required source-derived assets at `/demo/agent-monitor/`; this does not license unrelated repository content.
- Working-tree provenance: the app source working tree was clean when this bundle was built; all demo source files are committed at the source revision above.
- Repository license: no repository-level LICENSE, COPYING, or NOTICE file was found; the repository provides no general open-source license.
- Third-party licenses: bundled npm dependency license texts and versions are listed in `THIRD-PARTY-NOTICES.md`; no third-party assets are vendored into the bundle.
