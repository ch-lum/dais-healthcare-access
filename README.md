# DAIS Healthcare Access

HospiShuttle, a healthcare access and shuttle-coordination demo for a Databricks/AppKit hackathon.

The production app lives in [`dais-health-access/`](dais-health-access/). Treat that directory as the single source of truth for application code, Databricks bundle config, Lakebase routes, frontend UI, and the Python prioritization pipeline.

## Current Status

The app currently has a working vertical slice:

- Databricks AppKit app with React, TypeScript, Tailwind CSS, and AppKit UI components.
- Single-page HospiShuttle website focused on Lakebase-backed shuttle recommendations.
- Python prioritization package that preserves the original notebook/pipeline stages.
- App-facing recommendation output model, one row per `treatment + origin_region + destination_facility`.
- Demo seed data for recommendations so the prioritization page can render before a full pipeline refresh.
- Scripts for loading facility snapshots and recommendation snapshots into Lakebase.
- Databricks Asset Bundle config pointed at the authenticated workspace.
- Live Lakebase project for this app: `projects/dais-health-access-db`.
- Live deployed app URL: `https://dais-health-access-7474644434979404.aws.databricksapps.com`.
- Current recommendation serving table has 250 `openai_continuous_symptom_mapping` pipeline rows across 25 treatments using the continuous OpenAI symptom mapping, corrected distance baseline, population-weighted priority scoring, and origin/destination coordinates.
- The production Lakebase symptom mapping now uses the OpenAI-generated continuous, direction-aware regime with one row per `treatment + survey_signal`.

Recent verification:

- `npm run build` passes under Node 24.
- `npm run typecheck` passes.
- `npm run lint` passes.
- Python package compile check passes for `facility_prioritization`.
- Continuous fallback symptom mapping synthetic smoke check passes without OpenAI.
- No OpenAI model call was run for the continuous-regime implementation; model execution remains approval-gated behind `--use-openai-mapping`.
- Approved OpenAI continuous symptom mapping run succeeded for the top 25 treatments, producing 202 treatment-signal rows with 5 to 11 signals per treatment.
- Lakebase `app_data.symptom_mappings` was refreshed from that continuous mapping and round-trip exported back to 202 long-form signal rows.
- Lakebase `app_data.shuttle_recommendations` was refreshed with 250 `openai_continuous_symptom_mapping` recommendation rows.
- Databricks bundle validation passes with profile `dais-health`.
- HospiShuttle frontend build, typecheck, and lint pass after simplifying the website to the prioritization page only. Playwright smoke was updated for `/`, `/prioritization`, and retired-path redirect behavior, but the local smoke command stalled during Chromium setup in this environment.
- Databricks App deploy/run succeeded after removing a macOS-only Rolldown native package from direct dependencies.
- Bounded Databricks-backed Python pipeline run succeeded with 3,000 facility rows, all 706 survey rows, and 50,000 pincode rows.
- Full Databricks-backed Python pipeline run succeeded for top 25 treatments, strict OpenAI symptom mapping, 17,650 priority rows, and 250 app-serving recommendation rows.
- Distance-fix refresh reused `app_data.symptom_mappings`, generated 250 recommendation rows, and loaded Lakebase with 178 distinct transportation burden reduction percentages.
- Population-weighted refresh reused `app_data.symptom_mappings`, generated 250 recommendation rows, and loaded Lakebase with 179 distinct people-affected estimates ranging from 2,100 to 140,600.
- Map-view refresh regenerated 250 coordinate-complete recommendation rows, deployed the app-owned Lakebase schema migration, and loaded all rows with route coordinates.

## Demo Story

HospiShuttle is a healthcare-access app for planning shuttle routes to specialty care.

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
    |   +-- src/pages/PrioritizationPage.tsx
    |   +-- src/index.css
    +-- server/
    |   +-- server.ts
    |   +-- routes/
    |       +-- lakebase/facility-routes.ts
    |       +-- prioritization/pipeline-routes.ts
    +-- scripts/
    |   +-- export-symptom-mapping-snapshot.ts
    |   +-- load-facilities-snapshot.ts
    |   +-- load-recommendations-snapshot.ts
    |   +-- load-symptom-mapping-snapshot.ts
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

The visible website is a single HospiShuttle page:

- [`App.tsx`](dais-health-access/client/src/App.tsx): light-mode single-page shell titled HospiShuttle. `/` and `/prioritization` render the same prioritization experience; retired paths redirect to `/`.
- [`PrioritizationPage.tsx`](dais-health-access/client/src/pages/PrioritizationPage.tsx): Leaflet/OpenStreetMap shuttle recommendation map with drag/zoom interaction, treatment selector, max saved-distance filter, highlighted district origins, route lines to destination facilities, route cards, route table, travel-saved metrics, and signal explanations.

Styling lives in [`index.css`](dais-health-access/client/src/index.css), with AppKit UI styles imported first.

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
  - retained for data exploration and possible future admin workflows
- `app_data.snapshot_runs`
  - records facility snapshot import runs
- `app_data.shuttle_recommendations`
  - loaded by `scripts/load-recommendations-snapshot.ts`
  - powers HospiShuttle
  - seeded by the server for demo safety if empty
  - currently loaded with 250 `openai_continuous_symptom_mapping` recommendation rows from the Python pipeline
- `app_data.symptom_mappings`
  - loaded by `scripts/load-symptom-mapping-snapshot.ts`
  - stores one row per treatment with a JSONB map of continuous signal weights, directions, confidence values, and rationales
  - currently loaded with 25 OpenAI-generated continuous treatment mappings

## Upstream Databricks Tables

The Python pipeline config now points at the real DAIS Unity Catalog tables:

```yaml
databricks:
  facility_table: "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities"
  survey_table: "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators"
  geo_reference_table: "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory"
```

Verified row counts:

- `facilities`: 10,088 rows
- `nfhs_5_district_health_indicators`: 706 rows
- `india_post_pincode_directory`: 165,627 rows

For the first OpenAI-mapped production symptom run, the pipeline used:

- facilities: 9,964 India facilities with valid coordinate bounds and narrowed text projection
- survey: all 706 district survey rows, cleaned to 107 numeric signal columns plus identifiers
- pincode/geography: full valid India coordinate projection aggregated to 750 unique districts
- recommendations: top 25 treatments, 10 recommendation rows per treatment

## Recommendation Data Model

The app-facing recommendation table is one row per `treatment + origin_region + destination_facility`.

Fields include:

- `id`
- `treatment`
- `origin_region`
- `origin_state`
- `origin_latitude`
- `origin_longitude`
- `destination_facility_id`
- `destination_facility_name`
- `destination_city`
- `destination_state`
- `destination_country`
- `destination_latitude`
- `destination_longitude`
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
   - `generate_continuous_symptom_mapping`
   - `generate_fallback_continuous_symptom_mapping`
   - `symptom_mapping_to_long`
   - `calculate_treatment_scores`
   - `create_demand_table`
4. Priority scoring
   - `create_priority_table`
5. App recommendation shaping
   - `create_app_recommendations`
6. CLI entrypoint
   - `python -m facility_prioritization.pipeline`

Config lives in [`dais-health-access/python/config/config.yaml`](dais-health-access/python/config/config.yaml).

The default symptom mapping regime is continuous and direction-aware:

- one row per `treatment + survey_signal`
- continuous `weight` from `0.0` to `1.0`
- `direction` of `1` when higher survey values indicate more unmet need, or `-1` when lower values indicate more unmet need
- `confidence` from `0.0` to `1.0`
- per-signal `rationale`
- mapping source, model, and update timestamp

The default demo-safe path uses deterministic keyword fallback and does not call OpenAI. OpenAI only runs when `--use-openai-mapping` is passed. Generated symptom mapping artifacts are written to `outputs/symptom_mapping.csv` and `outputs/symptom_mapping.json`; conceptually this table should be generated once and reused until treatment/survey signal definitions change.

Legacy binary wide mappings are still supported. The scoring code converts binary/wide mappings into the continuous long shape internally so the existing persisted Lakebase table can be reused. The Lakebase serving copy stores either binary signal flags or continuous signal payloads in `app_data.symptom_mappings.signal_mapping` as JSONB, and the import/export scripts preserve both formats.

Distance outputs are computed in priority scoring. The recommended distance is the nearest treatment-capable facility; the current distance is a modeled no-shuttle referral baseline chosen from the next farther treatment-capable facility for the same origin and treatment. This keeps `distance_saved_km` and `transportation_burden_reduction_pct` route-specific rather than a fixed multiplier.

Population is estimated because the current source tables do not include census district population. The pipeline uses district pincode and post-office density from the pincode directory to allocate a national population estimate across districts, then applies a population weight to priority scoring. `estimated_people_affected` is derived from that estimated district population and the treatment demand percentile, so larger and higher-need districts rank higher without every row saturating at the same value.

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

This uses `--mapping-regime continuous` by default and the deterministic fallback mapper unless `--use-openai-mapping` is explicitly provided.

After approval to run OpenAI, generate the continuous top-25 production mapping and recommendation refresh:

```bash
PYTHONPATH=python/src python -m facility_prioritization.pipeline \
  --databricks-profile dais-health \
  --output-format both \
  --output-dir outputs \
  --top-n-treatments 25 \
  --top-n-per-treatment 10 \
  --snapshot-mode openai_continuous_symptom_mapping \
  --mapping-regime continuous \
  --use-openai-mapping \
  --strict-openai-mapping
```

Reuse an existing symptom mapping table instead of regenerating it:

```bash
export DATABRICKS_CONFIG_PROFILE=dais-health
export LAKEBASE_ENDPOINT=projects/dais-health-access-db/branches/production/endpoints/primary
export PGHOST=ep-odd-pine-d8wkh6fv.database.us-east-2.cloud.databricks.com
export PGDATABASE=databricks_postgres
export PGPORT=5432
export PGSSLMODE=require

npm run export:symptom-mapping-snapshot -- outputs/symptom_mapping_from_lakebase.csv

PYTHONPATH=python/src python -m facility_prioritization.pipeline \
  --databricks-profile dais-health \
  --symptom-mapping-csv outputs/symptom_mapping_from_lakebase.csv \
  --output-format both \
  --output-dir outputs \
  --top-n-treatments 25 \
  --top-n-per-treatment 10 \
  --snapshot-mode map_route_view
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

Load the generated symptom mapping into Lakebase:

```bash
npm run load:symptom-mapping-snapshot -- outputs/symptom_mapping.json
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
- `/prioritization`
- retired paths such as `/explorer` redirect to `/`

## Databricks Bundle

Bundle config lives in [`dais-health-access/databricks.yml`](dais-health-access/databricks.yml).

Current app resource:

- app name: `dais-health-access`
- workspace host: `https://dbc-2d7a6b3b-9ab6.cloud.databricks.com`
- Lakebase branch: `projects/dais-health-access-db/branches/production`
- Lakebase database: `projects/dais-health-access-db/branches/production/databases/databricks-postgres`
- Lakebase endpoint: `projects/dais-health-access-db/branches/production/endpoints/primary`
- app URL: `https://dais-health-access-7474644434979404.aws.databricksapps.com`

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
51d5963 Simplify app to HospiShuttle prioritization
352269b Generate continuous OpenAI symptom mapping
48d9a9c Add continuous symptom mapping regime
899802a Replace route sketch with interactive map
cbf86cc Add prioritization route map view
```
