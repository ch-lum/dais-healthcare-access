import argparse
import json
from pathlib import Path

import pandas as pd

from .config import load_config
from .demand_modeling import (
    calculate_treatment_scores,
    create_demand_table,
    generate_fallback_symptom_mapping,
    generate_symptom_mapping,
)
from .facility_processing import (
    clean_facility_data,
    create_supply_table,
    extract_top_treatments,
)
from .priority_scoring import create_priority_table
from .recommendation_model import create_app_recommendations
from .survey_processing import clean_survey_data


def _load_csv(path):
    return pd.read_csv(path)


def _load_databricks_table(table_name, profile=None, limit=None, sql=None):
    from .data_loader import load_from_databricks

    return load_from_databricks(table_name, profile=profile, limit=limit, sql=sql)


def _limited_query(sql, limit):
    if limit is not None and limit > 0:
        return f"{sql} LIMIT {int(limit)}"
    return sql


def _load_inputs(config, args):
    databricks_config = config.get("databricks", {})

    if args.facility_csv:
        facility_df = _load_csv(args.facility_csv)
    else:
        facility_sql = _limited_query(
            f"""
            SELECT
              unique_id,
              name,
              organization_type,
              officialPhone,
              officialWebsite,
              address_city,
              address_stateOrRegion AS address_state_or_region,
              address_country,
              facilityTypeId AS facility_type_id,
              specialties,
              procedure,
              equipment,
              SUBSTRING(description, 1, 500) AS description,
              latitude,
              longitude,
              source
            FROM {databricks_config["facility_table"]}
            WHERE unique_id IS NOT NULL
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND address_country = 'India'
              AND latitude BETWEEN 6 AND 38
              AND longitude BETWEEN 68 AND 98
            """,
            args.facility_limit,
        )
        facility_df = _load_databricks_table(
            databricks_config["facility_table"],
            profile=args.databricks_profile,
            sql=facility_sql,
        )

    if args.survey_csv:
        survey_df = _load_csv(args.survey_csv)
    else:
        survey_df = _load_databricks_table(
            databricks_config["survey_table"],
            profile=args.databricks_profile,
            limit=args.survey_limit,
        )

    if args.geo_csv:
        geo_df = _load_csv(args.geo_csv)
    else:
        geo_sql = _limited_query(
            f"""
            SELECT
              district,
              statename,
              TRY_CAST(latitude AS DOUBLE) AS latitude,
              TRY_CAST(longitude AS DOUBLE) AS longitude
            FROM {databricks_config["geo_reference_table"]}
            WHERE district IS NOT NULL
              AND statename IS NOT NULL
              AND TRY_CAST(latitude AS DOUBLE) BETWEEN 6 AND 38
              AND TRY_CAST(longitude AS DOUBLE) BETWEEN 68 AND 98
            """,
            args.geo_limit,
        )
        geo_df = _load_databricks_table(
            databricks_config["geo_reference_table"],
            profile=args.databricks_profile,
            sql=geo_sql,
        )

    return facility_df, survey_df, geo_df


def _write_outputs(
    output_dir,
    output_base,
    app_recommendations_df,
    priority_df,
    symptom_mapping_df,
    output_format,
    symptom_mapping_base,
):
    output_dir.mkdir(parents=True, exist_ok=True)
    written = []

    if output_format in {"csv", "both"}:
        app_csv = output_dir / f"{output_base}.csv"
        priority_csv = output_dir / "priority_table.csv"
        symptom_mapping_csv = output_dir / f"{symptom_mapping_base}.csv"
        app_recommendations_df.to_csv(app_csv, index=False)
        priority_df.to_csv(priority_csv, index=False)
        symptom_mapping_df.reset_index().to_csv(symptom_mapping_csv, index=False)
        written.extend([str(app_csv), str(priority_csv), str(symptom_mapping_csv)])

    if output_format in {"json", "both"}:
        app_json = output_dir / f"{output_base}.json"
        symptom_mapping_json = output_dir / f"{symptom_mapping_base}.json"
        app_recommendations_df.to_json(app_json, orient="records", indent=2)
        symptom_mapping_df.reset_index().to_json(
            symptom_mapping_json,
            orient="records",
            indent=2,
        )
        written.extend([str(app_json), str(symptom_mapping_json)])

    return written


def _load_symptom_mapping(path):
    mapping_df = pd.read_csv(path)
    if "treatment" not in mapping_df.columns:
        raise ValueError("Symptom mapping CSV must include a 'treatment' column")
    return mapping_df.set_index("treatment")


def run_pipeline(args):
    config = load_config(args.config)
    warnings = []
    facility_df, survey_df, geo_df = _load_inputs(config, args)

    cleaned_facility_df, stage_warnings = clean_facility_data(facility_df, config=config)
    warnings.extend(stage_warnings)

    treatment_kwargs = {}
    if args.top_n_treatments is not None:
        treatment_kwargs["top_n_treatments"] = args.top_n_treatments

    top_treatments, stage_warnings = extract_top_treatments(
        cleaned_facility_df,
        config=config,
        **treatment_kwargs,
    )
    warnings.extend(stage_warnings)

    supply_df, stage_warnings = create_supply_table(cleaned_facility_df, top_treatments, config=config)
    warnings.extend(stage_warnings)

    cleaned_survey_df, stage_warnings = clean_survey_data(survey_df, config=config)
    warnings.extend(stage_warnings)

    if args.symptom_mapping_csv:
        symptom_mapping_df = _load_symptom_mapping(args.symptom_mapping_csv)
        stage_warnings = [f"Loaded existing symptom mapping from {args.symptom_mapping_csv}"]
    elif args.use_openai_mapping:
        symptom_mapping_df, stage_warnings = generate_symptom_mapping(
            top_treatments,
            cleaned_survey_df.columns,
            config=config,
            fallback_on_missing_key=not args.strict_openai_mapping,
            strict=args.strict_openai_mapping,
        )
    else:
        symptom_mapping_df, stage_warnings = generate_fallback_symptom_mapping(
            top_treatments,
            cleaned_survey_df.columns,
            config=config,
        )
    warnings.extend(stage_warnings)

    scores_dict, stage_warnings = calculate_treatment_scores(
        cleaned_survey_df,
        symptom_mapping_df,
        config=config,
    )
    warnings.extend(stage_warnings)

    demand_df, stage_warnings = create_demand_table(scores_dict, config=config)
    warnings.extend(stage_warnings)

    priority_df, stage_warnings = create_priority_table(demand_df, supply_df, geo_df, config=config)
    warnings.extend(stage_warnings)

    app_recommendations_df, stage_warnings = create_app_recommendations(
        priority_df,
        supply_df=supply_df,
        symptom_mapping_df=symptom_mapping_df,
        config=config,
        top_n_per_treatment=args.top_n_per_treatment,
        snapshot_mode=args.snapshot_mode,
    )
    warnings.extend(stage_warnings)

    output_config = config.get("output", {})
    output_dir = Path(args.output_dir or output_config.get("output_dir", "./outputs"))
    output_base = args.output_base or output_config.get(
        "app_recommendations_filename",
        "app_recommendations",
    ).removesuffix(".csv")
    symptom_mapping_base = args.symptom_mapping_output_base or "symptom_mapping"
    written = _write_outputs(
        output_dir,
        output_base,
        app_recommendations_df,
        priority_df,
        symptom_mapping_df,
        args.output_format,
        symptom_mapping_base,
    )

    return {
        "top_treatments": top_treatments,
        "recommendation_rows": len(app_recommendations_df),
        "written": written,
        "warnings": warnings,
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run the facility prioritization pipeline and write app-facing shuttle recommendations.",
    )
    parser.add_argument("--config", default=None, help="Path to config.yaml")
    parser.add_argument("--facility-csv", help="Local facility CSV for demo/local runs")
    parser.add_argument("--survey-csv", help="Local survey CSV for demo/local runs")
    parser.add_argument("--geo-csv", help="Local geography CSV for demo/local runs")
    parser.add_argument("--databricks-profile", help="Databricks CLI profile for local/off-cluster table reads")
    parser.add_argument("--facility-limit", type=int, default=None, help="Optional facility row limit for demo runs")
    parser.add_argument("--survey-limit", type=int, default=None, help="Optional survey row limit for demo runs")
    parser.add_argument("--geo-limit", type=int, default=None, help="Optional geography row limit for demo runs")
    parser.add_argument("--output-dir", help="Directory for recommendation outputs")
    parser.add_argument("--output-base", help="Base filename for app recommendation output")
    parser.add_argument(
        "--symptom-mapping-output-base",
        default="symptom_mapping",
        help="Base filename for the generated treatment-to-survey symptom mapping output",
    )
    parser.add_argument("--output-format", choices=["csv", "json", "both"], default="csv")
    parser.add_argument("--top-n-treatments", type=int, default=None)
    parser.add_argument("--top-n-per-treatment", type=int, default=10)
    parser.add_argument("--snapshot-mode", default="pipeline")
    parser.add_argument(
        "--symptom-mapping-csv",
        help="Reuse an existing symptom mapping CSV instead of generating a new one",
    )
    parser.add_argument(
        "--use-openai-mapping",
        action="store_true",
        help="Use OpenAI treatment-to-survey mapping when an API key is available; otherwise fallback is used.",
    )
    parser.add_argument(
        "--strict-openai-mapping",
        action="store_true",
        help="Fail the pipeline if OpenAI mapping generation returns malformed or incomplete output.",
    )
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    summary = run_pipeline(args)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
