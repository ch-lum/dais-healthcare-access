import numpy as np
import pandas as pd

from .utils import clean_district_name, piecewise_distance_decay


def _haversine_distances(lat, lon, facility_lats, facility_lons):
    lat1 = np.radians(lat)
    lon1 = np.radians(lon)
    lat2 = np.radians(facility_lats)
    lon2 = np.radians(facility_lons)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    c = 2 * np.arcsin(np.sqrt(a))
    return c * 6371


def _transport_config(config):
    recommendations_config = config.get("recommendations", {}) if config else {}
    return {
        "baseline_min_saved_km": recommendations_config.get("baseline_min_saved_km", 25),
        "baseline_multiplier_floor": recommendations_config.get("baseline_multiplier_floor", 1.15),
    }


def _select_current_referral_baseline(distances, names, recommended_index, config):
    recommended_distance = float(distances[recommended_index])
    settings = _transport_config(config)
    threshold = max(
        recommended_distance + settings["baseline_min_saved_km"],
        recommended_distance * settings["baseline_multiplier_floor"],
    )

    eligible_indices = np.flatnonzero(distances >= threshold)
    if eligible_indices.size > 0:
        baseline_index = int(eligible_indices[np.nanargmin(distances[eligible_indices])])
        return float(distances[baseline_index]), names[baseline_index]

    farther_indices = np.flatnonzero(distances > recommended_distance)
    if farther_indices.size > 0:
        baseline_index = int(farther_indices[np.nanargmax(distances[farther_indices])])
        return float(distances[baseline_index]), names[baseline_index]

    return recommended_distance, names[recommended_index]


def create_priority_table(demand_df, supply_df, geo_reference_df, config=None, **kwargs):
    warnings = []

    geo_df = geo_reference_df.copy()
    geo_df["district_clean"] = geo_df["district"].apply(clean_district_name)
    geo_df["latitude_num"] = pd.to_numeric(geo_df["latitude"], errors="coerce")
    geo_df["longitude_num"] = pd.to_numeric(geo_df["longitude"], errors="coerce")

    district_coords = (
        geo_df.groupby("district_clean")
        .agg({"latitude_num": "median", "longitude_num": "median", "statename": "first"})
        .reset_index()
    )
    district_coords.columns = ["district_name", "district_lat", "district_lon", "district_state"]
    warnings.append(f"Aggregated geo reference to {len(district_coords)} unique districts")

    demand_with_coords = demand_df.copy()
    demand_with_coords["district_name_clean"] = demand_with_coords["district_name"].apply(clean_district_name)
    demand_with_coords = demand_with_coords.merge(
        district_coords,
        left_on="district_name_clean",
        right_on="district_name",
        how="left",
        suffixes=("", "_coord"),
    )

    matched = demand_with_coords["district_lat"].notna().sum()
    total = len(demand_with_coords)
    warnings.append(f"District coordinate matching: {matched}/{total} ({100 * matched / total:.1f}%)")

    supply_with_coords = supply_df.copy()
    supply_with_coords["latitude_num"] = pd.to_numeric(supply_with_coords["latitude"], errors="coerce")
    supply_with_coords["longitude_num"] = pd.to_numeric(supply_with_coords["longitude"], errors="coerce")
    supply_with_coords = supply_with_coords.dropna(subset=["latitude_num", "longitude_num"])

    facilities_by_treatment = {}
    for treatment in demand_with_coords["treatment"].dropna().unique():
        facilities = supply_with_coords[
            supply_with_coords["top_treatments_offered"].apply(lambda x: treatment in x if isinstance(x, list) else False)
        ]
        if facilities.empty:
            continue

        facilities_by_treatment[treatment] = {
            "names": facilities["name"].astype(str).to_numpy(),
            "latitudes": facilities["latitude_num"].to_numpy(dtype=float),
            "longitudes": facilities["longitude_num"].to_numpy(dtype=float),
        }

    def find_facility_distances(row):
        district_lat = row["district_lat"]
        district_lon = row["district_lon"]
        treatment = row["treatment"]

        if pd.isna(district_lat) or pd.isna(district_lon):
            return np.nan, None, np.nan, None

        facilities = facilities_by_treatment.get(treatment)
        if not facilities:
            return np.nan, None, np.nan, None

        distances = _haversine_distances(
            district_lat,
            district_lon,
            facilities["latitudes"],
            facilities["longitudes"],
        )
        if distances.size == 0 or np.all(np.isnan(distances)):
            return np.nan, None, np.nan, None

        nearest_index = int(np.nanargmin(distances))
        current_distance, current_facility_name = _select_current_referral_baseline(
            distances,
            facilities["names"],
            nearest_index,
            config,
        )
        return (
            float(distances[nearest_index]),
            facilities["names"][nearest_index],
            current_distance,
            current_facility_name,
        )

    results = demand_with_coords.apply(find_facility_distances, axis=1)
    demand_with_coords["distance_to_nearest_facility_km"] = results.apply(lambda x: x[0])
    demand_with_coords["nearest_facility_name"] = results.apply(lambda x: x[1])
    demand_with_coords["current_referral_distance_km"] = results.apply(lambda x: x[2])
    demand_with_coords["current_referral_facility_name"] = results.apply(lambda x: x[3])

    distance_calculated = demand_with_coords["distance_to_nearest_facility_km"].notna().sum()
    warnings.append(f"Distance calculated for {distance_calculated}/{total} district-treatment pairs")

    demand_with_coords["distance_saved_km"] = (
        demand_with_coords["current_referral_distance_km"]
        - demand_with_coords["distance_to_nearest_facility_km"]
    ).clip(lower=0)
    demand_with_coords["transportation_burden_reduction_pct"] = np.where(
        demand_with_coords["current_referral_distance_km"] > 0,
        (
            demand_with_coords["distance_saved_km"]
            / demand_with_coords["current_referral_distance_km"]
        )
        * 100,
        0,
    )
    demand_with_coords["effective_distance"] = piecewise_distance_decay(
        demand_with_coords["current_referral_distance_km"].fillna(0).values
    )
    demand_with_coords["priority_score"] = (
        demand_with_coords["treatment_score"]
        * demand_with_coords["effective_distance"]
        * (1 + demand_with_coords["transportation_burden_reduction_pct"].fillna(0) / 100)
    )

    priority_df = demand_with_coords[
        [
            "district_name",
            "state_ut",
            "treatment",
            "treatment_score",
            "current_referral_distance_km",
            "current_referral_facility_name",
            "distance_to_nearest_facility_km",
            "distance_saved_km",
            "transportation_burden_reduction_pct",
            "effective_distance",
            "priority_score",
            "nearest_facility_name",
        ]
    ].sort_values("priority_score", ascending=False).reset_index(drop=True)

    warnings.append(f"Created priority table with {len(priority_df)} rows")
    warnings.append(
        f"Priority score range: {priority_df['priority_score'].min():.2f} to {priority_df['priority_score'].max():.2f}"
    )
    return priority_df, warnings
