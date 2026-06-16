This directory brings the pre-template facility prioritization code into the AppKit app.

Contents:
- `src/facility_prioritization/`: the original Python package structure
- `config/config.yaml`: the original pipeline configuration
- `requirements.txt`: Python dependencies for the prioritization pipeline

The current package mirrors the existing repo state: module boundaries, function contracts, and configuration are preserved here so the templated app can evolve around the same pipeline shape.

## App-facing recommendation output

The app reads precomputed shuttle-route recommendations from Lakebase table `app_data.shuttle_recommendations`.
The Python package now has a CLI entrypoint that preserves the original stage order and writes a serving-shaped artifact:

```bash
PYTHONPATH=python/src python -m facility_prioritization.pipeline \
  --facility-csv path/to/facilities.csv \
  --survey-csv path/to/survey.csv \
  --geo-csv path/to/geo.csv \
  --output-format both
```

If CSV paths are omitted, the CLI reads the Databricks tables configured in `config/config.yaml`.
By default it uses deterministic survey-column keyword mapping for treatment demand signals, so demos do not depend on an OpenAI API key.
Pass `--use-openai-mapping` to use the OpenAI path when `OPENAI_API_KEY` is available; it still falls back safely if the key is missing.

The app-facing output contains one row per `treatment + origin_region + destination_facility`, including:

- treatment and origin/destination fields
- demand score and estimated people affected
- current, recommended, and saved distance
- transportation burden reduction percentage
- priority score
- region/facility explanations
- top contributing survey signals
- `updated_at` snapshot timestamp
