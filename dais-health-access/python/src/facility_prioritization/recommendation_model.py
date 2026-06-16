import json
import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd


APP_RECOMMENDATION_COLUMNS = [
    "id",
    "treatment",
    "origin_region",
    "origin_state",
    "destination_facility_id",
    "destination_facility_name",
    "destination_city",
    "destination_state",
    "destination_country",
    "demand_score",
    "estimated_people_affected",
    "current_distance_km",
    "recommended_distance_km",
    "distance_saved_km",
    "transportation_burden_reduction_pct",
    "priority_score",
    "why_region",
    "why_facility",
    "top_contributing_signals",
    "snapshot_mode",
    "source_pipeline_version",
    "updated_at",
]


def _slugify(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return normalized or "unknown"


def _safe_number(value, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if np.isfinite(number) else default


def _first_present(row, columns):
    for column in columns:
        if column not in row.index:
            continue
        value = row[column]
        if isinstance(value, (list, tuple, set)):
            return value if len(value) > 0 else None
        if pd.isna(value):
            continue
        if str(value).strip():
            return value
    return None


def _match_facility(supply_df, facility_name):
    if supply_df is None or supply_df.empty or not facility_name:
        return None

    if "name" not in supply_df.columns:
        return None

    matches = supply_df[supply_df["name"].astype(str) == str(facility_name)]
    if matches.empty:
        matches = supply_df[
            supply_df["name"].astype(str).str.lower() == str(facility_name).lower()
        ]

    if matches.empty:
        return None

    return matches.iloc[0]


def _signals_for_treatment(symptom_mapping_df, treatment, max_signals=3):
    if symptom_mapping_df is None or symptom_mapping_df.empty or treatment not in symptom_mapping_df.index:
        return []

    row = symptom_mapping_df.loc[treatment]
    signals = []
    for column, value in row.items():
        if column == "reasoning":
            continue
        weight = _safe_number(value)
        if weight > 0:
            signals.append({"signal": str(column).replace("_", " "), "weight": round(weight, 2)})

    return signals[:max_signals]


def _estimate_people(demand_score, treatment_rank, max_rank, config=None):
    base_population = (
        config.get("recommendations", {}).get("base_people_affected", 500)
        if config
        else 500
    )
    max_population = (
        config.get("recommendations", {}).get("max_people_affected", 20000)
        if config
        else 20000
    )
    rank_factor = 1 - ((max(treatment_rank, 1) - 1) / max(max_rank, 1))
    demand_factor = min(max(abs(demand_score) / 10, 0), 1)
    estimate = base_population + (max_population - base_population) * max(rank_factor, demand_factor)
    return int(round(estimate / 100) * 100)


def _build_region_reason(row):
    demand_score = _safe_number(row.get("treatment_score"))
    effective_distance = _safe_number(row.get("effective_distance"))
    return (
        f"Modeled demand is elevated for this treatment (score {demand_score:.1f}), "
        f"and distance-decay still leaves a transport burden signal of {effective_distance:.1f}."
    )


def _build_facility_reason(facility, treatment):
    if facility is None:
        return (
            "The destination is the nearest matched facility from the supply table for this treatment, "
            "with enough location data to support route planning."
        )

    offered = _first_present(facility, ["top_treatments_offered", "specialties", "procedures"])
    if offered is None:
        return (
            f"The facility is the nearest supply-side match for {treatment} with usable coordinates "
            "and a practical destination profile."
        )

    return (
        f"The facility profile contains treatment evidence for {treatment} and is the nearest realistic "
        f"destination match. Supply signal: {offered}."
    )


def create_app_recommendations(
    priority_df,
    supply_df=None,
    symptom_mapping_df=None,
    config=None,
    **kwargs,
):
    warnings = []
    if priority_df is None or priority_df.empty:
        warnings.append("No priority rows available for app recommendations")
        return pd.DataFrame(columns=APP_RECOMMENDATION_COLUMNS), warnings

    recommendations_config = config.get("recommendations", {}) if config else {}
    top_n_per_treatment = kwargs.get(
        "top_n_per_treatment",
        recommendations_config.get("top_n_per_treatment", 10),
    )
    current_distance_multiplier = kwargs.get(
        "current_distance_multiplier",
        recommendations_config.get("current_distance_multiplier", 1.8),
    )
    min_distance_saved_km = kwargs.get(
        "min_distance_saved_km",
        recommendations_config.get("min_distance_saved_km", 25),
    )
    snapshot_mode = kwargs.get("snapshot_mode", recommendations_config.get("snapshot_mode", "pipeline"))
    pipeline_version = kwargs.get(
        "source_pipeline_version",
        recommendations_config.get("source_pipeline_version", "python.facility_prioritization.v1"),
    )
    updated_at = kwargs.get("updated_at", datetime.now(timezone.utc).isoformat())

    sorted_priority = priority_df.sort_values("priority_score", ascending=False).copy()
    ranked = (
        sorted_priority.groupby("treatment", group_keys=False)
        .head(top_n_per_treatment)
        .reset_index(drop=True)
    )

    max_rank_by_treatment = ranked.groupby("treatment").size().to_dict()
    rows = []

    for _, row in ranked.iterrows():
        treatment = row["treatment"]
        origin_region = row["district_name"]
        origin_state = row.get("state_ut") or row.get("district_state")
        destination_name = row.get("nearest_facility_name") or "Nearest matched facility"
        recommended_distance = _safe_number(row.get("distance_to_nearest_facility_km"))
        current_distance = max(
            recommended_distance + min_distance_saved_km,
            recommended_distance * current_distance_multiplier,
        )
        distance_saved = max(current_distance - recommended_distance, 0)
        burden_reduction = (distance_saved / current_distance) * 100 if current_distance > 0 else 0
        treatment_rank = int(row.get("rank", 1)) if "rank" in row else 1
        max_rank = max_rank_by_treatment.get(treatment, top_n_per_treatment)
        facility = _match_facility(supply_df, destination_name)
        signals = _signals_for_treatment(symptom_mapping_df, treatment)

        if not signals:
            signals = [
                {"signal": "treatment demand score", "weight": 0.4},
                {"signal": "local supply gap", "weight": 0.35},
                {"signal": "distance burden", "weight": 0.25},
            ]

        row_id = "-".join(
            [
                _slugify(treatment),
                _slugify(origin_region),
                _slugify(origin_state or "state"),
                _slugify(destination_name),
            ]
        )

        rows.append(
            {
                "id": row_id,
                "treatment": treatment,
                "origin_region": origin_region,
                "origin_state": origin_state,
                "destination_facility_id": _first_present(
                    facility,
                    ["unique_id", "id", "facility_id"],
                )
                if facility is not None
                else None,
                "destination_facility_name": destination_name,
                "destination_city": _first_present(facility, ["address_city", "city"])
                if facility is not None
                else None,
                "destination_state": _first_present(
                    facility,
                    ["address_state_or_region", "state", "state_ut"],
                )
                if facility is not None
                else None,
                "destination_country": _first_present(facility, ["address_country", "country"])
                if facility is not None
                else None,
                "demand_score": round(_safe_number(row.get("treatment_score")), 3),
                "estimated_people_affected": _estimate_people(
                    _safe_number(row.get("treatment_score")),
                    treatment_rank,
                    max_rank,
                    config=config,
                ),
                "current_distance_km": round(current_distance, 1),
                "recommended_distance_km": round(recommended_distance, 1),
                "distance_saved_km": round(distance_saved, 1),
                "transportation_burden_reduction_pct": round(burden_reduction, 1),
                "priority_score": round(_safe_number(row.get("priority_score")), 3),
                "why_region": _build_region_reason(row),
                "why_facility": _build_facility_reason(facility, treatment),
                "top_contributing_signals": json.dumps(signals),
                "snapshot_mode": snapshot_mode,
                "source_pipeline_version": pipeline_version,
                "updated_at": updated_at,
            }
        )

    app_df = pd.DataFrame(rows, columns=APP_RECOMMENDATION_COLUMNS)
    warnings.append(f"Created {len(app_df)} app-facing shuttle recommendations")
    warnings.append(
        "Current-distance fields model the likely no-shuttle referral burden using configurable distance uplift"
    )
    return app_df, warnings
