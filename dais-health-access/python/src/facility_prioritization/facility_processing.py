import ast
from collections import Counter

import pandas as pd


TREATMENT_COLUMN_ALIASES = {
    "procedures": ["procedures", "procedure"],
    "procedure": ["procedure", "procedures"],
}


def _parse_treatment_value(value):
    if pd.isna(value) or value == "null":
        return []
    if isinstance(value, list):
        return [item for item in value if str(item).strip() and str(item).strip().lower() != "null"]
    if isinstance(value, str):
        stripped_value = value.strip()
        if not stripped_value or stripped_value.lower() == "null":
            return []
        if value.startswith("["):
            try:
                parsed = ast.literal_eval(value)
                if isinstance(parsed, list):
                    return [
                        item
                        for item in parsed
                        if str(item).strip() and str(item).strip().lower() != "null"
                    ]
            except (SyntaxError, ValueError):
                return [value]
        return [stripped_value]
    return []


def _resolve_treatment_columns(df, treatment_columns):
    resolved_columns = []
    warnings = []

    for column in treatment_columns:
        candidates = TREATMENT_COLUMN_ALIASES.get(column, [column])
        resolved = next((candidate for candidate in candidates if candidate in df.columns), None)
        if resolved is None:
            warnings.append(f"Column '{column}' not found in facility data")
            continue
        if resolved != column:
            warnings.append(f"Using facility column '{resolved}' as alias for configured column '{column}'")
        if resolved not in resolved_columns:
            resolved_columns.append(resolved)

    return resolved_columns, warnings


def _configured_treatment_columns(config):
    if config:
        return config.get("facility", {}).get(
            "treatment_columns", ["specialties", "procedures", "equipment", "description"]
        )
    return ["specialties", "procedures", "equipment", "description"]


def clean_facility_data(raw_df, config=None, **kwargs):
    warnings = []
    df = raw_df.copy()
    initial_count = len(df)

    for coordinate_col in ["latitude", "longitude"]:
        if coordinate_col in df.columns:
            df[coordinate_col] = pd.to_numeric(df[coordinate_col], errors="coerce")

    drop_null_coords = kwargs.get(
        "drop_null_coords",
        config.get("facility", {}).get("drop_null_coords", True) if config else True,
    )
    drop_null_treatments = kwargs.get(
        "drop_null_treatments",
        config.get("facility", {}).get("drop_null_treatments", True) if config else True,
    )

    if drop_null_coords:
        before = len(df)
        df = df.dropna(subset=["latitude", "longitude"])
        dropped = before - len(df)
        if dropped > 0:
            warnings.append(f"Dropped {dropped} facilities with missing coordinates")

    if drop_null_treatments:
        before = len(df)
        treatment_columns, column_warnings = _resolve_treatment_columns(
            df,
            _configured_treatment_columns(config),
        )
        warnings.extend(column_warnings)
        required_columns = [column for column in treatment_columns if column != "description"]

        if required_columns:
            empty_treatment_mask = df[required_columns].apply(
                lambda row: all(
                    pd.isna(value)
                    or str(value).strip() == ""
                    or str(value).strip().lower() == "null"
                    for value in row
                ),
                axis=1,
            )
            df = df[~empty_treatment_mask]

        if "all_treatments" in df.columns:
            df = df[df["all_treatments"].apply(lambda x: len(x) > 0 if isinstance(x, list) else False)]
        dropped = before - len(df)
        if dropped > 0:
            warnings.append(f"Dropped {dropped} facilities with null/empty treatment data")

    warnings.append(f"Facility cleaning: {initial_count} -> {len(df)} facilities")
    return df, warnings


def extract_top_treatments(cleaned_facility_df, n_treatments=5, treatment_columns=None, config=None, **kwargs):
    warnings = []

    if treatment_columns is None:
        treatment_columns = _configured_treatment_columns(config)

    treatment_columns, column_warnings = _resolve_treatment_columns(cleaned_facility_df, treatment_columns)
    warnings.extend(column_warnings)

    if "top_n_treatments" in kwargs:
        n_treatments = kwargs["top_n_treatments"]
    elif config:
        n_treatments = config.get("facility", {}).get("top_n_treatments", n_treatments)

    if "all_treatments" in cleaned_facility_df.columns:
        all_treatments_flat = [
            treatment
            for treatments in cleaned_facility_df["all_treatments"]
            if isinstance(treatments, list)
            for treatment in treatments
        ]
    else:
        all_treatments_flat = []
        for col in treatment_columns:
            for value in cleaned_facility_df[col]:
                all_treatments_flat.extend(_parse_treatment_value(value))

    treatment_counts = Counter(all_treatments_flat)
    top_treatments = [treatment for treatment, _count in treatment_counts.most_common(n_treatments)]
    warnings.append(
        f"Extracted top {len(top_treatments)} treatments from {len(treatment_counts)} unique treatments"
    )
    return top_treatments, warnings


def create_supply_table(cleaned_facility_df, treatment_list, treatment_columns=None, config=None, **kwargs):
    warnings = []
    supply_df = cleaned_facility_df.copy()

    if treatment_columns is None:
        treatment_columns = _configured_treatment_columns(config)

    treatment_columns, column_warnings = _resolve_treatment_columns(supply_df, treatment_columns)
    warnings.extend(column_warnings)

    if "all_treatments" not in supply_df.columns:
        def parse_treatments(row):
            treatments = []
            for col in treatment_columns:
                if col not in row.index:
                    continue
                treatments.extend(_parse_treatment_value(row[col]))
            return treatments

        supply_df["all_treatments"] = supply_df.apply(parse_treatments, axis=1)
        warnings.append("Created 'all_treatments' column by parsing treatment fields")

    treatment_set = set(treatment_list)

    def get_offered_treatments(facility_treatments):
        if not isinstance(facility_treatments, list):
            return []
        return list(set(facility_treatments).intersection(treatment_set))

    supply_df["top_treatments_offered"] = supply_df["all_treatments"].apply(get_offered_treatments)
    supply_df["num_top_treatments"] = supply_df["top_treatments_offered"].apply(len)

    warnings.append(f"Matched facilities against {len(treatment_list)} top treatments")
    warnings.append(
        f"Facilities offering at least 1 treatment: {(supply_df['num_top_treatments'] > 0).sum()}"
    )
    return supply_df, warnings
