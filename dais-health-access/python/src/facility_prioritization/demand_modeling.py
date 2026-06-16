import json
import os
from datetime import datetime, timezone

import pandas as pd
from sklearn.preprocessing import StandardScaler

try:
    import openai
except ImportError:  # pragma: no cover - fallback mapping does not require OpenAI.
    openai = None


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


MAPPING_METADATA_COLUMNS = {
    "reasoning",
    "justification",
    "selected_signal_count",
    "mapping_source",
    "model",
    "updated_at",
}


def _normalize_column_name(column):
    return str(column).lower().replace("_", " ").replace("-", " ")


def _survey_data_columns(survey_columns, config=None):
    preserve_cols = (
        config.get("survey", {}).get("preserve_columns", ["district_name", "state_ut"])
        if config
        else ["district_name", "state_ut"]
    )
    return [col for col in survey_columns if col not in preserve_cols]


def _resolve_openai_api_key(api_key=None, config=None):
    warnings = []
    if api_key:
        return api_key, warnings

    openai_config = config.get("openai", {}) if config else {}
    configured_key = openai_config.get("api_key")
    if configured_key:
        return configured_key, warnings

    api_key_env = openai_config.get("api_key_env_var", "OPENAI_API_KEY")
    if api_key_env and str(api_key_env).startswith("sk-"):
        warnings.append(
            "OpenAI config value 'api_key_env_var' appears to contain a direct API key; "
            "prefer moving it to an environment variable before committing config."
        )
        return api_key_env, warnings

    env_key = os.getenv(api_key_env or "OPENAI_API_KEY")
    if env_key:
        return env_key, warnings

    return None, warnings


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
    data_columns = _survey_data_columns(survey_columns, config=config)
    max_columns = kwargs.get("max_columns", 12)
    mapping_data = []
    updated_at = datetime.now(timezone.utc).isoformat()

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
            "justification": "Deterministic keyword fallback matched survey columns whose names resemble the treatment or known access-demand proxies.",
            "selected_signal_count": len(selected_columns),
            "mapping_source": "fallback_keyword",
            "model": None,
            "updated_at": updated_at,
        }
        row.update({col: 1 if col in selected_columns else 0 for col in data_columns})
        mapping_data.append(row)

    mapping_df = pd.DataFrame(mapping_data).set_index("treatment").fillna(0)
    warnings.append(f"Generated fallback symptom mapping for {len(treatment_list)} treatments")
    return mapping_df, warnings


def _parse_json_object(content):
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```").strip()
        stripped = stripped.removesuffix("```").strip()
    return json.loads(stripped)


def _coerce_openai_mapping_result(result, treatment, data_columns, model, updated_at):
    selected = result.get("selected_signal_columns")
    if selected is None and "column_mapping" in result:
        selected = [
            column
            for column, value in result["column_mapping"].items()
            if int(value) == 1 and column in data_columns
        ]

    if not isinstance(selected, list):
        raise ValueError("Expected 'selected_signal_columns' to be a JSON array")

    valid_columns = set(data_columns)
    selected_columns = []
    unknown_columns = []
    for column in selected:
        column_name = str(column)
        if column_name in valid_columns and column_name not in selected_columns:
            selected_columns.append(column_name)
        elif column_name not in valid_columns:
            unknown_columns.append(column_name)

    justification = str(result.get("justification") or result.get("reasoning") or "").strip()
    if not justification:
        raise ValueError("Expected non-empty 'justification' text")

    row = {
        "treatment": treatment,
        "reasoning": justification,
        "justification": justification,
        "selected_signal_count": len(selected_columns),
        "mapping_source": "openai",
        "model": model,
        "updated_at": updated_at,
    }
    row.update({column: 1 if column in selected_columns else 0 for column in data_columns})
    return row, unknown_columns


def generate_symptom_mapping(treatment_list, survey_columns, api_key=None, config=None, **kwargs):
    warnings = []

    api_key, key_warnings = _resolve_openai_api_key(api_key=api_key, config=config)
    warnings.extend(key_warnings)

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

    if openai is None:
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
            warnings.append("OpenAI package is not installed; used deterministic fallback symptom mapping")
            warnings.extend(fallback_warnings)
            return mapping_df, warnings

        raise ImportError("OpenAI package is not installed. Install openai or enable fallback mapping.")

    model = kwargs.get("model", config.get("openai", {}).get("model", "gpt-4o-mini") if config else "gpt-4o-mini")
    max_tokens = kwargs.get(
        "max_tokens",
        config.get("openai", {}).get("max_tokens", 4000) if config else 4000,
    )
    temperature = kwargs.get(
        "temperature",
        config.get("openai", {}).get("temperature", 0.3) if config else 0.3,
    )
    strict = kwargs.get("strict", False)

    client = openai.OpenAI(api_key=api_key)
    data_columns = _survey_data_columns(survey_columns, config=config)
    mapping_data = []
    updated_at = datetime.now(timezone.utc).isoformat()

    for treatment in treatment_list:
        try:
            prompt = f"""You are creating a production treatment-to-survey-signal mapping table for a healthcare access and shuttle coordination app.

Treatment:
{treatment}

Survey signal columns, as a JSON array:
{json.dumps(data_columns, ensure_ascii=True)}

Task:
Choose the survey signal columns that are direct or strong proxy indicators of regional need for this treatment. Include prevalence, screening gaps, treatment/service utilization gaps, risk factors, maternal/child indicators, or access-barrier indicators when medically relevant. Exclude identifiers, geography-only fields, and unrelated health topics.

Return ONLY valid JSON in this exact shape:
{{
  "selected_signal_columns": ["exact_column_name"],
  "justification": "Two to four sentences explaining why these survey signals indicate likely unmet need for the treatment."
}}

Use exact column names from the provided array. Do not invent columns."""

            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content.strip()

            try:
                result = _parse_json_object(content)
                row, unknown_columns = _coerce_openai_mapping_result(
                    result,
                    treatment,
                    data_columns,
                    model,
                    updated_at,
                )
                if unknown_columns:
                    warnings.append(
                        f"Ignored {len(unknown_columns)} unknown survey columns for treatment '{treatment}'"
                    )
                mapping_data.append(row)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                if strict:
                    raise RuntimeError(
                        f"Failed to create validated OpenAI symptom mapping for treatment '{treatment}'"
                    ) from exc
                warnings.append(f"Failed to parse JSON for treatment '{treatment}': {exc}")
                mapping_data.append({"treatment": treatment, "reasoning": "PARSE_ERROR"})

        except Exception as exc:  # noqa: BLE001
            if strict:
                raise
            warnings.append(f"API call failed for treatment '{treatment}': {exc}")
            mapping_data.append({"treatment": treatment, "reasoning": "API_ERROR"})

    mapping_df = pd.DataFrame(mapping_data).set_index("treatment").fillna(0)
    for column in data_columns:
        if column not in mapping_df.columns:
            mapping_df[column] = 0
        mapping_df[column] = pd.to_numeric(mapping_df[column], errors="coerce").fillna(0).astype(int)
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
        relevance_cols = [
            col for col in symptom_mapping_df.columns if col not in MAPPING_METADATA_COLUMNS
        ]
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
