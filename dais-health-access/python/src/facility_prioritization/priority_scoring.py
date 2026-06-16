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


def _population_config(config):
    recommendations_config = config.get("recommendations", {}) if config else {}
    return {
        "national_population_estimate": recommendations_config.get(
            "national_population_estimate",
            1_210_000_000,
        ),
        "priority_population_exponent": recommendations_config.get(
            "priority_population_exponent",
            0.5,
        ),
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


def _estimate_district_populations(district_coords, config):
    settings = _population_config(config)
    proxy = (
        district_coords["pincode_count"].fillna(0)
        + district_coords["post_office_count"].fillna(0) * 0.25
    ).clip(lower=1)
    total_proxy = proxy.sum()

    district_coords = district_coords.copy()
    if total_proxy <= 0:
        district_coords["estimated_district_population"] = np.nan
        district_coords["population_weight"] = 1.0
        return district_coords

    district_coords["estimated_district_population"] = (
        proxy / total_proxy
    ) * settings["national_population_estimate"]
    median_population = district_coords["estimated_district_population"].median()
    if median_population <= 0 or pd.isna(median_population):
        district_coords["population_weight"] = 1.0
    else:
        district_coords["population_weight"] = (
            district_coords["estimated_district_population"] / median_population
        ).pow(settings["priority_population_exponent"])
    district_coords["population_proxy_source"] = "pincode_and_post_office_density"
    return district_coords


def create_priority_table(demand_df, supply_df, geo_reference_df, config=None, **kwargs):
    warnings = []

    geo_df = geo_reference_df.copy()
    if "pincode" not in geo_df.columns:
        geo_df["pincode"] = geo_df["district"]
    if "officename" not in geo_df.columns:
        geo_df["officename"] = geo_df["pincode"]
    geo_df["district_clean"] = geo_df["district"].apply(clean_district_name)
    geo_df["latitude_num"] = pd.to_numeric(geo_df["latitude"], errors="coerce")
    geo_df["longitude_num"] = pd.to_numeric(geo_df["longitude"], errors="coerce")

    district_coords = (
        geo_df.groupby("district_clean")
        .agg(
            {
                "latitude_num": "median",
                "longitude_num": "median",
                "statename": "first",
                "pincode": "nunique",
                "officename": "nunique",
            }
        )
        .reset_index()
    )
    district_coords.columns = [
        "district_name",
        "district_lat",
        "district_lon",
        "district_state",
        "pincode_count",
        "post_office_count",
    ]
    district_coords = _estimate_district_populations(district_coords, config)
    warnings.append(f"Aggregated geo reference to {len(district_coords)} unique districts")
    warnings.append(
        "Estimated district populations from pincode/post-office density because source tables do not include census population"
    )

    demand_with_coords = demand_df.copy()
    demand_with_coords["district_name_clean"] = demand_with_coords["district_name"].apply(clean_district_name)
    demand_with_coords = demand_with_coords.merge(
        district_coords,
        left_on="district_name_clean",
        right_on="district_name",
        how="left",
        suffixes=("", "_coord"),
    )
    if "rank" in demand_with_coords.columns:
        max_rank = demand_with_coords.groupby("treatment")["rank"].transform("max").clip(lower=1)
        demand_with_coords["demand_percentile"] = 1 - (
            (demand_with_coords["rank"].clip(lower=1) - 1) / max_rank
        )
    else:
        demand_with_coords["rank"] = demand_with_coords.groupby("treatment")[
            "treatment_score"
        ].rank(ascending=False, method="min")
        demand_with_coords["demand_percentile"] = demand_with_coords.groupby("treatment")[
            "treatment_score"
        ].rank(pct=True)

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
            return np.nan, None, np.nan, np.nan, np.nan, None

        facilities = facilities_by_treatment.get(treatment)
        if not facilities:
            return np.nan, None, np.nan, np.nan, np.nan, None

        distances = _haversine_distances(
            district_lat,
            district_lon,
            facilities["latitudes"],
            facilities["longitudes"],
        )
        if distances.size == 0 or np.all(np.isnan(distances)):
            return np.nan, None, np.nan, np.nan, np.nan, None

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
            float(facilities["latitudes"][nearest_index]),
            float(facilities["longitudes"][nearest_index]),
            current_distance,
            current_facility_name,
        )

    results = demand_with_coords.apply(find_facility_distances, axis=1)
    demand_with_coords["distance_to_nearest_facility_km"] = results.apply(lambda x: x[0])
    demand_with_coords["nearest_facility_name"] = results.apply(lambda x: x[1])
    demand_with_coords["nearest_facility_latitude"] = results.apply(lambda x: x[2])
    demand_with_coords["nearest_facility_longitude"] = results.apply(lambda x: x[3])
    demand_with_coords["current_referral_distance_km"] = results.apply(lambda x: x[4])
    demand_with_coords["current_referral_facility_name"] = results.apply(lambda x: x[5])

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
        * demand_with_coords["population_weight"].fillna(1)
    )

    priority_df = demand_with_coords[
        [
            "district_name",
            "state_ut",
            "treatment",
            "treatment_score",
            "rank",
            "demand_percentile",
            "estimated_district_population",
            "population_weight",
            "population_proxy_source",
            "district_lat",
            "district_lon",
            "current_referral_distance_km",
            "current_referral_facility_name",
            "distance_to_nearest_facility_km",
            "nearest_facility_latitude",
            "nearest_facility_longitude",
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
