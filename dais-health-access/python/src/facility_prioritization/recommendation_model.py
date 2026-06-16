import json
import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .demand_modeling import symptom_mapping_to_long


APP_RECOMMENDATION_COLUMNS = [
    "id",
    "treatment",
    "origin_region",
    "origin_state",
    "origin_latitude",
    "origin_longitude",
    "destination_facility_id",
    "destination_facility_name",
    "destination_city",
    "destination_state",
    "destination_country",
    "destination_latitude",
    "destination_longitude",
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


MAPPING_METADATA_COLUMNS = {
    "reasoning",
    "justification",
    "selected_signal_count",
    "mapping_source",
    "model",
    "updated_at",
}


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
    if symptom_mapping_df is None or symptom_mapping_df.empty:
        return []

    long_mapping = symptom_mapping_to_long(symptom_mapping_df)
    treatment_mapping = long_mapping[long_mapping["treatment"].astype(str) == str(treatment)].copy()
    if treatment_mapping.empty:
        return []

    treatment_mapping["importance"] = (
        treatment_mapping["weight"].abs() * treatment_mapping["confidence"].fillna(0.5)
    )
    treatment_mapping = treatment_mapping.sort_values("importance", ascending=False).head(max_signals)
    signals = [
        {
            "signal": str(row["survey_signal"]).replace("_", " "),
            "weight": round(float(row["weight"]), 2),
            "direction": int(row["direction"]),
            "confidence": round(float(row["confidence"]), 2),
        }
        for _, row in treatment_mapping.iterrows()
    ]

    return signals


def _estimate_people(row, config=None):
    recommendations_config = config.get("recommendations", {}) if config else {}
    min_affected_pct = recommendations_config.get("min_affected_population_pct", 0.001)
    max_affected_pct = recommendations_config.get("max_affected_population_pct", 0.02)
    district_population = _safe_number(row.get("estimated_district_population"))
    demand_percentile = min(max(_safe_number(row.get("demand_percentile"), 0.5), 0), 1)

    if district_population <= 0:
        district_population = recommendations_config.get("fallback_district_population", 1_500_000)

    affected_pct = min_affected_pct + demand_percentile * (max_affected_pct - min_affected_pct)
    estimate = district_population * affected_pct
    return max(int(round(estimate / 100) * 100), 100)


def _build_region_reason(row):
    demand_score = _safe_number(row.get("treatment_score"))
    district_population = _safe_number(row.get("estimated_district_population"))
    current_distance = _safe_number(row.get("current_referral_distance_km"))
    recommended_distance = _safe_number(row.get("distance_to_nearest_facility_km"))
    distance_saved = _safe_number(row.get("distance_saved_km"))
    return (
        f"Modeled demand is elevated for this treatment (score {demand_score:.1f}) in a district with "
        f"an estimated population of {district_population:,.0f}, "
        f"and the coordinated route can reduce a likely referral trip from "
        f"{current_distance:.0f} km to {recommended_distance:.0f} km, saving about {distance_saved:.0f} km."
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

    rows = []

    for _, row in ranked.iterrows():
        treatment = row["treatment"]
        origin_region = row["district_name"]
        origin_state = row.get("state_ut") or row.get("district_state")
        destination_name = row.get("nearest_facility_name") or "Nearest matched facility"
        origin_latitude = _safe_number(row.get("district_lat"))
        origin_longitude = _safe_number(row.get("district_lon"))
        destination_latitude = _safe_number(row.get("nearest_facility_latitude"))
        destination_longitude = _safe_number(row.get("nearest_facility_longitude"))
        recommended_distance = _safe_number(row.get("distance_to_nearest_facility_km"))
        current_distance = _safe_number(row.get("current_referral_distance_km"))
        if current_distance <= recommended_distance:
            current_distance = max(
                recommended_distance + min_distance_saved_km,
                recommended_distance * current_distance_multiplier,
            )
        distance_saved = _safe_number(
            row.get("distance_saved_km"),
            max(current_distance - recommended_distance, 0),
        )
        burden_reduction = _safe_number(
            row.get("transportation_burden_reduction_pct"),
            (distance_saved / current_distance) * 100 if current_distance > 0 else 0,
        )
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
                "origin_latitude": round(origin_latitude, 6) if origin_latitude else None,
                "origin_longitude": round(origin_longitude, 6) if origin_longitude else None,
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
                "destination_latitude": round(destination_latitude, 6) if destination_latitude else None,
                "destination_longitude": round(destination_longitude, 6) if destination_longitude else None,
                "demand_score": round(_safe_number(row.get("treatment_score")), 3),
                "estimated_people_affected": _estimate_people(row, config=config),
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
        "Current-distance fields use the priority table's no-shuttle referral baseline when available"
    )
    return app_df, warnings
