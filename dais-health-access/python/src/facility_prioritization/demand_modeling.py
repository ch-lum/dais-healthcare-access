import json
import os

import openai
import pandas as pd
from sklearn.preprocessing import StandardScaler


FALLBACK_SIGNAL_KEYWORDS = {
    "oncology": ["cancer", "tumor", "screen", "screening", "breast", "cervical", "chemo"],
    "cancer": ["cancer", "tumor", "screen", "screening", "breast", "cervical", "chemo"],
    "dialysis": ["dialysis", "renal", "kidney", "diabetes", "hypertension", "chronic"],
    "renal": ["dialysis", "renal", "kidney", "diabetes", "hypertension", "chronic"],
    "cardiology": ["heart", "cardiac", "cardio", "hypertension", "blood pressure", "stroke"],
    "cardiac": ["heart", "cardiac", "cardio", "hypertension", "blood pressure", "stroke"],
    "maternity": ["maternal", "pregnancy", "delivery", "antenatal", "birth", "obstetric"],
    "obstetric": ["maternal", "pregnancy", "delivery", "antenatal", "birth", "obstetric"],
    "pediatric": ["child", "children", "infant", "immunization", "birth", "neonatal"],
}


def _normalize_column_name(column):
    return str(column).lower().replace("_", " ").replace("-", " ")


def _keywords_for_treatment(treatment):
    normalized_treatment = _normalize_column_name(treatment)
    keywords = set(normalized_treatment.split())

    for key, values in FALLBACK_SIGNAL_KEYWORDS.items():
        if key in normalized_treatment:
            keywords.update(values)

    keywords.update(["hospital", "illness", "treatment", "unmet", "access"])
    return {keyword for keyword in keywords if len(keyword) > 2}


def generate_fallback_symptom_mapping(treatment_list, survey_columns, config=None, **kwargs):
    """Create deterministic treatment-to-survey mappings when LLM mapping is unavailable."""
    warnings = []
    preserve_cols = (
        config.get("survey", {}).get("preserve_columns", ["district_name", "state_ut"])
        if config
        else ["district_name", "state_ut"]
    )
    data_columns = [col for col in survey_columns if col not in preserve_cols]
    max_columns = kwargs.get("max_columns", 12)
    mapping_data = []

    for treatment in treatment_list:
        keywords = _keywords_for_treatment(treatment)
        selected_columns = [
            col
            for col in data_columns
            if any(keyword in _normalize_column_name(col) for keyword in keywords)
        ][:max_columns]

        if not selected_columns:
            selected_columns = data_columns[: min(max_columns, len(data_columns))]
            warnings.append(
                f"Fallback mapping for treatment '{treatment}' used broad survey signals because no keyword match was found"
            )

        row = {
            "treatment": treatment,
            "reasoning": "Deterministic keyword fallback used for fast app-serving recommendation generation.",
        }
        row.update({col: 1 if col in selected_columns else 0 for col in data_columns})
        mapping_data.append(row)

    mapping_df = pd.DataFrame(mapping_data).set_index("treatment").fillna(0)
    warnings.append(f"Generated fallback symptom mapping for {len(treatment_list)} treatments")
    return mapping_df, warnings


def generate_symptom_mapping(treatment_list, survey_columns, api_key=None, config=None, **kwargs):
    warnings = []

    if api_key is None:
        if config:
            api_key_env = config.get("openai", {}).get("api_key_env_var", "OPENAI_API_KEY")
            api_key = os.getenv(api_key_env)
        else:
            api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        fallback_enabled = kwargs.get(
            "fallback_on_missing_key",
            config.get("openai", {}).get("fallback_on_missing_key", True) if config else True,
        )
        if fallback_enabled:
            mapping_df, fallback_warnings = generate_fallback_symptom_mapping(
                treatment_list,
                survey_columns,
                config=config,
                **kwargs,
            )
            warnings.append("OpenAI API key not provided; used deterministic fallback symptom mapping")
            warnings.extend(fallback_warnings)
            return mapping_df, warnings

        raise ValueError("OpenAI API key not provided. Set OPENAI_API_KEY environment variable.")

    model = kwargs.get("model", config.get("openai", {}).get("model", "gpt-4o-mini") if config else "gpt-4o-mini")
    max_tokens = kwargs.get(
        "max_tokens",
        config.get("openai", {}).get("max_tokens", 4000) if config else 4000,
    )
    temperature = kwargs.get(
        "temperature",
        config.get("openai", {}).get("temperature", 0.3) if config else 0.3,
    )

    client = openai.OpenAI(api_key=api_key)
    data_columns = [col for col in survey_columns if col not in ["district_name", "state_ut"]]
    mapping_data = []

    for treatment in treatment_list:
        try:
            prompt = f"""You are a healthcare data analyst. Given a treatment and a list of survey columns, identify which columns indicate regional need for that treatment.

Treatment: {treatment}

Survey columns:
{', '.join(data_columns[:100])}  # Limit to first 100 columns

For each column, return 1 if it indicates need for this treatment, 0 otherwise.

Respond ONLY with valid JSON in this exact format:
{{
  "column_mapping": {{
    "column_name_1": 0,
    "column_name_2": 1,
    ...
  }},
  "reasoning": "Brief explanation of why certain columns were selected"
}}

Do NOT include any text before or after the JSON."""

            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            content = response.choices[0].message.content.strip()

            try:
                result = json.loads(content)
                row = {"treatment": treatment, "reasoning": result.get("reasoning", "")}
                row.update(result.get("column_mapping", {}))
                mapping_data.append(row)
            except json.JSONDecodeError as exc:
                warnings.append(f"Failed to parse JSON for treatment '{treatment}': {exc}")
                mapping_data.append({"treatment": treatment, "reasoning": "PARSE_ERROR"})

        except Exception as exc:  # noqa: BLE001
            warnings.append(f"API call failed for treatment '{treatment}': {exc}")
            mapping_data.append({"treatment": treatment, "reasoning": "API_ERROR"})

    mapping_df = pd.DataFrame(mapping_data).set_index("treatment").fillna(0)
    warnings.append(f"Generated symptom mapping for {len(treatment_list)} treatments")
    return mapping_df, warnings


def calculate_treatment_scores(cleaned_survey_df, symptom_mapping_df, config=None, **kwargs):
    warnings = []
    use_scaling = kwargs.get(
        "use_scaling",
        config.get("survey", {}).get("use_scaling", True) if config else True,
    )

    preserve_cols = ["district_name", "state_ut"]
    identifiers = cleaned_survey_df[preserve_cols].copy()
    data_cols = [col for col in cleaned_survey_df.columns if col not in preserve_cols]
    data = cleaned_survey_df[data_cols]

    if use_scaling:
        scaler = StandardScaler()
        scaled_data = scaler.fit_transform(data)
        scaled_df = pd.DataFrame(scaled_data, columns=data_cols, index=data.index)
    else:
        scaled_df = data

    scores_dict = {}
    for treatment in symptom_mapping_df.index:
        relevance_cols = [col for col in symptom_mapping_df.columns if col != "reasoning"]
        relevance_vector = symptom_mapping_df.loc[treatment, relevance_cols]
        common_cols = list(set(scaled_df.columns).intersection(set(relevance_vector.index)))

        if len(common_cols) == 0:
            warnings.append(f"No common columns found for treatment '{treatment}'")
            continue

        scores = scaled_df[common_cols].dot(relevance_vector[common_cols])
        scores_df = identifiers.copy()
        scores_df["treatment_score"] = scores
        scores_df["rank"] = scores_df["treatment_score"].rank(ascending=False, method="min").astype(int)
        scores_df = scores_df.sort_values("treatment_score", ascending=False)
        scores_dict[treatment] = scores_df

    warnings.append(f"Calculated treatment scores for {len(scores_dict)} treatments")
    return scores_dict, warnings


def create_demand_table(scores_dict, config=None, **kwargs):
    warnings = []
    demand_df_list = []

    for treatment_name, scores_df in scores_dict.items():
        scores_df_copy = scores_df.copy()
        scores_df_copy["treatment"] = treatment_name
        demand_df_list.append(scores_df_copy)

    demand_df = pd.concat(demand_df_list, ignore_index=True)
    warnings.append(f"Created unified demand table: {len(demand_df)} rows")
    warnings.append(
        f"Granularity: {len(demand_df['district_name'].unique())} districts × {len(demand_df['treatment'].unique())} treatments"
    )
    return demand_df, warnings
