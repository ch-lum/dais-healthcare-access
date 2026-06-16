# DAIS Healthcare Access

Healthcare access and shuttle-coordination demo for a Databricks/AppKit hackathon.

The production app lives in [`dais-health-access/`](dais-health-access/). Treat that directory as the single source of truth for application code, Databricks bundle config, Lakebase routes, frontend UI, and the Python prioritization pipeline.

## Current Status

The app currently has a working vertical slice:

- Databricks AppKit app with React, TypeScript, Tailwind CSS, and AppKit UI components.
- Lakebase-backed facilities explorer.
- Lakebase-backed shuttle recommendation experience on the prioritization page.
- Python prioritization package that preserves the original notebook/pipeline stages.
- App-facing recommendation output model, one row per `treatment + origin_region + destination_facility`.
- Demo seed data for recommendations so the prioritization page can render before a full pipeline refresh.
- Scripts for loading facility snapshots and recommendation snapshots into Lakebase.
- Databricks Asset Bundle config pointed at the authenticated workspace.

Recent verification:

- `npm run build` passes under Node 24.
- `npm run typecheck` passes.
- `npm run lint` passes.
- Databricks bundle validation passes with profile `dais-health`.
- Production frontend preview smoke check passed in local Google Chrome for `/`, `/explorer`, and `/prioritization`.

## Demo Story

This is a healthcare-access app for planning shuttle routes to specialty care.

The target user should be able to select a treatment and see the best shuttle-stop recommendations:

- origin region and state
- destination facility, city, state, and country
- why the origin region likely has high unmet need
- why the destination facility is a good target
- estimated people affected
- current travel burden versus recommended travel distance
- distance saved and transportation burden reduction
- priority score
- top contributing demand signals
- snapshot freshness

The app does not recompute heavy prioritization logic on page load. The intended architecture is:

1. Python pipeline computes recommendations.
2. Pipeline writes a clean serving-shaped output artifact.
3. Loader writes that output into Lakebase.
4. App reads Lakebase serving tables through AppKit server routes.

## Repository Layout

```text
.
+-- README.md
+-- notebooks/
|   +-- 01_facility_cleaning.ipynb
|   +-- 02_treatment_extraction.ipynb
|   +-- 03_survey_cleaning.ipynb
|   +-- 04_demand_modeling.ipynb
|   +-- 05_priority_scoring.ipynb
|   +-- 99_full_pipeline.ipynb
+-- dais-health-access/
    +-- app.yaml
    +-- databricks.yml
    +-- package.json
    +-- client/
    |   +-- src/App.tsx
    |   +-- src/pages/HomePage.tsx
    |   +-- src/pages/FacilitiesPage.tsx
    |   +-- src/pages/PrioritizationPage.tsx
    |   +-- src/index.css
    +-- server/
    |   +-- server.ts
    |   +-- routes/
    |       +-- lakebase/facility-routes.ts
    |       +-- prioritization/pipeline-routes.ts
    +-- scripts/
    |   +-- load-facilities-snapshot.ts
    |   +-- load-recommendations-snapshot.ts
    +-- tests/smoke.spec.ts
    +-- python/
        +-- config/config.yaml
        +-- requirements.txt
        +-- src/facility_prioritization/
            +-- config.py
            +-- data_loader.py
            +-- facility_processing.py
            +-- survey_processing.py
            +-- demand_modeling.py
            +-- priority_scoring.py
            +-- recommendation_model.py
            +-- pipeline.py
            +-- utils.py
```

## App Architecture

### Frontend

The frontend is in [`dais-health-access/client/src`](dais-health-access/client/src).

Pages:

- [`HomePage.tsx`](dais-health-access/client/src/pages/HomePage.tsx): overview shell for the hackathon demo.
- [`FacilitiesPage.tsx`](dais-health-access/client/src/pages/FacilitiesPage.tsx): Lakebase-backed facility search, filters, result list, and details.
- [`PrioritizationPage.tsx`](dais-health-access/client/src/pages/PrioritizationPage.tsx): shuttle recommendation experience with treatment selector, recommendation cards, route table, travel-saved metrics, signal explanations, and demo refresh action.

Navigation lives in [`App.tsx`](dais-health-access/client/src/App.tsx). Styling lives in [`index.css`](dais-health-access/client/src/index.css), with AppKit UI styles imported first.

### Server

The AppKit server entrypoint is [`dais-health-access/server/server.ts`](dais-health-access/server/server.ts). It enables:

- `lakebase()`
- `server()`

Routes:

- [`facility-routes.ts`](dais-health-access/server/routes/lakebase/facility-routes.ts)
  - creates `app_data.facilities_snapshot`
  - creates `app_data.snapshot_runs`
  - exposes facility summary, filters, list, and detail endpoints
- [`pipeline-routes.ts`](dais-health-access/server/routes/prioritization/pipeline-routes.ts)
  - creates `app_data.shuttle_recommendations`
  - seeds demo recommendations when empty
  - exposes recommendation summary, treatment options, recommendation list, and demo refresh endpoints

### Lakebase Serving Tables

Current Lakebase schema: `app_data`

Tables:

- `app_data.facilities_snapshot`
  - loaded by `scripts/load-facilities-snapshot.ts`
  - powers the facilities explorer
- `app_data.snapshot_runs`
  - records facility snapshot import runs
- `app_data.shuttle_recommendations`
  - loaded by `scripts/load-recommendations-snapshot.ts`
  - powers the prioritization page
  - seeded by the server for demo safety if empty

## Recommendation Data Model

The app-facing recommendation table is one row per `treatment + origin_region + destination_facility`.

Fields include:

- `id`
- `treatment`
- `origin_region`
- `origin_state`
- `destination_facility_id`
- `destination_facility_name`
- `destination_city`
- `destination_state`
- `destination_country`
- `demand_score`
- `estimated_people_affected`
- `current_distance_km`
- `recommended_distance_km`
- `distance_saved_km`
- `transportation_burden_reduction_pct`
- `priority_score`
- `why_region`
- `why_facility`
- `top_contributing_signals`
- `snapshot_mode`
- `source_pipeline_version`
- `updated_at`

## Python Pipeline

The Python package lives in [`dais-health-access/python/src/facility_prioritization`](dais-health-access/python/src/facility_prioritization).

Pipeline stages:

1. Facility processing
   - `clean_facility_data`
   - `extract_top_treatments`
   - `create_supply_table`
2. Survey processing
   - `clean_survey_data`
3. Demand modeling
   - `generate_symptom_mapping`
   - `generate_fallback_symptom_mapping`
   - `calculate_treatment_scores`
   - `create_demand_table`
4. Priority scoring
   - `create_priority_table`
5. App recommendation shaping
   - `create_app_recommendations`
6. CLI entrypoint
   - `python -m facility_prioritization.pipeline`

Config lives in [`dais-health-access/python/config/config.yaml`](dais-health-access/python/config/config.yaml).

The OpenAI-based survey-signal mapping path still exists, but the default demo-safe path can use deterministic keyword fallback when an API key is unavailable.

## Notebooks

The notebooks under [`notebooks/`](notebooks/) document and demo the intended pipeline stages:

- `01_facility_cleaning.ipynb`
- `02_treatment_extraction.ipynb`
- `03_survey_cleaning.ipynb`
- `04_demand_modeling.ipynb`
- `05_priority_scoring.ipynb`
- `99_full_pipeline.ipynb`

They are demos/reference material. The production app logic should stay in `dais-health-access/`.

## Prerequisites

- Node.js 24 recommended.
- npm 11 recommended.
- Databricks CLI.
- OAuth-authenticated Databricks profile.
- Access to the configured Databricks workspace.
- Lakebase project/database configured through the bundle.

Current bundle target host:

```text
https://dbc-2d7a6b3b-9ab6.cloud.databricks.com
```

Validated profile used during development:

```text
dais-health
```

## Setup

Install dependencies:

```bash
cd dais-health-access
npm install
```

Authenticate Databricks CLI:

```bash
databricks auth login \
  --host https://dbc-2d7a6b3b-9ab6.cloud.databricks.com \
  --profile dais-health
```

Verify auth:

```bash
databricks current-user me --profile dais-health
```

## Common Commands

Run from [`dais-health-access/`](dais-health-access/).

```bash
npm run build
npm run typecheck
npm run lint
npm run format
```

Development server:

```bash
npm run dev
```

Production server after build:

```bash
npm start
```

Databricks bundle validation:

```bash
databricks bundle validate --profile dais-health
```

Deploy:

```bash
databricks bundle deploy --profile dais-health
```

Run deployed app:

```bash
databricks bundle run app --profile dais-health
```

## Refreshing Data

### Facility Snapshot

The facility loader imports the configured Unity Catalog source table into Lakebase:

```bash
cd dais-health-access
npm run load:facilities-snapshot
```

This requires deployed/initialized Lakebase schema and local Lakebase connection env vars.

### Recommendation Snapshot

Run the Python pipeline to create recommendation output:

```bash
cd dais-health-access
PYTHONPATH=python/src python -m facility_prioritization.pipeline \
  --output-format json \
  --output-dir outputs
```

For local CSV inputs:

```bash
PYTHONPATH=python/src python -m facility_prioritization.pipeline \
  --facility-csv path/to/facilities.csv \
  --survey-csv path/to/survey.csv \
  --geo-csv path/to/geo.csv \
  --output-format both
```

Load recommendations into Lakebase:

```bash
npm run load:recommendations-snapshot -- outputs/app_recommendations.json
```

The prioritization page also has a demo refresh button that reseeds built-in sample rows.

## Environment Files

The app includes [`dais-health-access/.env.example`](dais-health-access/.env.example).

For deployed Databricks Apps, Lakebase/Postgres env vars are injected by the platform through the bundle resource and `app.yaml`.

For local `npm run dev`, the AppKit Lakebase plugin expects local connection settings if you want API routes to work locally:

```env
DATABRICKS_HOST=https://dbc-2d7a6b3b-9ab6.cloud.databricks.com
DATABRICKS_APP_PORT=8000
DATABRICKS_APP_NAME=dais-health-access
PGDATABASE=...
LAKEBASE_ENDPOINT=...
PGHOST=...
PGPORT=5432
PGSSLMODE=require
```

Do not commit real `.env` secrets or generated local copies.

## Testing And Verification

Code checks:

```bash
cd dais-health-access
npm run build
npm run typecheck
npm run lint
```

Smoke test:

```bash
npm run test:smoke
```

Known caveat: in this development environment, Playwright's managed Chromium headless-shell install stalled after download. A production-preview smoke check was successfully run by serving the built frontend and launching local Google Chrome through Playwright.

Production-preview smoke path used:

```bash
npm run build
npx vite preview --config client/vite.config.ts --host localhost --port 8000
```

Then verify:

- `/`
- `/explorer`
- `/prioritization`

## Databricks Bundle

Bundle config lives in [`dais-health-access/databricks.yml`](dais-health-access/databricks.yml).

Current app resource:

- app name: `dais-health-access`
- workspace host: `https://dbc-2d7a6b3b-9ab6.cloud.databricks.com`
- Lakebase branch: `projects/dais-health-access-db/branches/production`
- Lakebase database: `projects/dais-health-access-db/branches/production/databases/databricks-postgres`

Bundle validation has passed with:

```bash
databricks bundle validate --profile dais-health
```

## Development Workflow Notes

- Keep `dais-health-access/` as the single source of truth.
- Do not recreate duplicate Python logic outside `dais-health-access/`.
- Preserve the intent of the original pipeline if compatibility changes are needed.
- Prefer precomputed serving data over heavy live computation.
- Keep hackathon architecture pragmatic and demo-reliable.
- Make small, logical commits after meaningful blocks of changes.
- Update this README as project structure, commands, deployment targets, data contracts, or verification status change.

## Recent Commits

Current recent project commits:

```text
5e04e4d Point bundle at authenticated workspace
593b804 Add recommendation snapshot refresh path
3431588 Add app-facing recommendation pipeline output
5a0044a Build shuttle recommendation UI
c7a2c1f Add Lakebase shuttle recommendation API
```
