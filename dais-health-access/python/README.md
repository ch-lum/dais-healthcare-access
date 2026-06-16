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
By default it uses the continuous deterministic survey-column mapper for treatment demand signals, so demos do not depend on an OpenAI API key.
Pass `--mapping-regime binary` to reproduce the legacy one-hot mapping path.
Pass `--use-openai-mapping` only after approving an OpenAI run; the default path does not call the model.

The continuous mapping artifact uses one row per `treatment + survey_signal` with:

- `weight`: continuous relevance from `0.0` to `1.0`
- `direction`: `1` when higher values imply higher unmet need, `-1` when lower values imply higher unmet need
- `confidence`: mapper confidence from `0.0` to `1.0`
- `rationale`: signal-level justification text
- mapping source, model, and `updated_at`

Existing binary symptom mapping snapshots remain compatible because scoring converts them into the continuous long shape internally.

The app-facing output contains one row per `treatment + origin_region + destination_facility`, including:

- treatment and origin/destination fields
- demand score and estimated people affected
- current, recommended, and saved distance
- transportation burden reduction percentage
- priority score
- region/facility explanations
- top contributing survey signals
- `updated_at` snapshot timestamp
