import pandas as pd


def clean_survey_data(raw_survey_df, config=None, **kwargs):
    warnings = []
    df = raw_survey_df.copy()

    preserve_cols = kwargs.get(
        "preserve_columns",
        config.get("survey", {}).get("preserve_columns", ["district_name", "state_ut"])
        if config
        else ["district_name", "state_ut"],
    )

    numeric_cols = [col for col in df.columns if col not in preserve_cols]
    for col in numeric_cols:
        if df[col].dtype == "object":
            df[col] = pd.to_numeric(df[col], errors="coerce")

    all_nan = df[numeric_cols].isna().all()
    if all_nan.any():
        dropped_cols = all_nan[all_nan].index.tolist()
        warnings.append(f"Dropped {len(dropped_cols)} columns with all NaN values: {dropped_cols[:5]}...")
        df = df.drop(columns=dropped_cols)

    warnings.append(f"Survey cleaning: {len(raw_survey_df.columns)} -> {len(df.columns)} columns")
    warnings.append(f"Numeric columns: {len([c for c in df.columns if c not in preserve_cols])}")
    return df, warnings
