import json
import os
import re
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


CONTINUOUS_MAPPING_COLUMNS = [
    "treatment",
    "survey_signal",
    "weight",
    "direction",
    "confidence",
    "rationale",
    "mapping_source",
    "model",
    "updated_at",
]


NEGATIVE_NEED_KEYWORDS = [
    "improved",
    "insurance",
    "insured",
    "covered",
    "schooled",
    "literate",
    "schooling",
    "hygiene",
    "contraceptive",
    "any_method",
    "modern_method",
    "talked_to",
    "told_about",
    "anc_visit",
    "anc_visits",
    "protected",
    "consumed_ifa",
    "received",
    "registered",
    "institutional_birth",
    "public_facility",
    "skilled",
    "attended",
    "vaccinated",
    "bcg",
    "vaccine",
    "vit_a",
    "adequate_diet",
    "breastfed",
    "screen",
    "exam",
]


POSITIVE_NEED_KEYWORDS = [
    "unmet",
    "anaemic",
    "anemic",
    "stunted",
    "wasted",
    "underweight",
    "overweight",
    "obese",
    "high_risk",
    "high_bp",
    "blood_pressure",
    "blood_sugar",
    "diabetes",
    "hypertension",
    "tobacco",
    "alcohol",
    "diarrhoea",
    "diarrhea",
    "ari",
    "fever",
    "csection",
    "out_of_pocket",
    "married_before",
    "pregnant_at",
    "below_age_15",
    "deaths",
]


def _normalize_column_name(column):
    camel_spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(column))
    normalized = re.sub(r"[^a-zA-Z0-9]+", " ", camel_spaced).lower()
    return re.sub(r"\s+", " ", normalized).strip()


def _coerce_direction(value, column=None):
    if isinstance(value, str):
        normalized = _normalize_column_name(value)
        if normalized in {"lower", "low", "negative", "minus", "inverse", "decrease", "decreases"}:
            return -1
        if normalized in {"higher", "high", "positive", "plus", "direct", "increase", "increases"}:
            return 1

    number = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    if pd.notna(number):
        return -1 if number < 0 else 1

    if column is not None:
        return _infer_signal_direction(column)

    return 1


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


def _infer_signal_direction(column):
    normalized = _normalize_column_name(column)
    if any(_normalize_column_name(keyword) in normalized for keyword in POSITIVE_NEED_KEYWORDS):
        return 1
    if any(_normalize_column_name(keyword) in normalized for keyword in NEGATIVE_NEED_KEYWORDS):
        return -1
    if normalized.endswith(" pct") or " pct" in normalized:
        return 1
    return 1


def _keyword_match_strength(column, treatment):
    normalized_column = _normalize_column_name(column)
    treatment_keywords = _keywords_for_treatment(treatment)
    matched_keywords = [keyword for keyword in treatment_keywords if keyword in normalized_column]
    if not matched_keywords:
        return 0.0

    token_matches = len(set(_normalize_column_name(treatment).split()).intersection(matched_keywords))
    generic_matches = len(set(["hospital", "illness", "treatment", "unmet", "access"]).intersection(matched_keywords))
    domain_matches = max(len(matched_keywords) - token_matches - generic_matches, 0)
    return min(0.25 + token_matches * 0.25 + domain_matches * 0.18 + generic_matches * 0.08, 1.0)


def _normalize_continuous_mapping(mapping_df):
    mapping_df = mapping_df.copy()
    if mapping_df.empty:
        return pd.DataFrame(columns=CONTINUOUS_MAPPING_COLUMNS)

    defaults = {
        "weight": 0,
        "direction": None,
        "confidence": 0.5,
        "rationale": "",
        "mapping_source": "continuous",
        "model": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    for column, default in defaults.items():
        if column not in mapping_df.columns:
            mapping_df[column] = default

    mapping_df["weight"] = pd.to_numeric(mapping_df["weight"], errors="coerce").fillna(0).clip(0, 1)
    mapping_df["direction"] = (
        mapping_df.apply(
            lambda row: _coerce_direction(row.get("direction"), row.get("survey_signal")),
            axis=1,
        )
    )
    mapping_df["confidence"] = (
        pd.to_numeric(mapping_df["confidence"], errors="coerce").fillna(0.5).clip(0, 1)
    )
    mapping_df["weighted_direction"] = (
        mapping_df["weight"] * mapping_df["direction"] * mapping_df["confidence"]
    )
    return mapping_df


def symptom_mapping_to_long(symptom_mapping_df, survey_columns=None, config=None):
    """Convert legacy wide mappings or continuous long mappings into the long scoring shape."""
    if symptom_mapping_df is None or symptom_mapping_df.empty:
        return pd.DataFrame(columns=CONTINUOUS_MAPPING_COLUMNS)

    if {"treatment", "survey_signal", "weight", "direction"}.issubset(symptom_mapping_df.columns):
        return _normalize_continuous_mapping(symptom_mapping_df)

    wide_df = symptom_mapping_df.copy()
    if "treatment" in wide_df.columns:
        wide_df = wide_df.set_index("treatment")

    data_columns = (
        _survey_data_columns(survey_columns, config=config)
        if survey_columns is not None
        else [col for col in wide_df.columns if col not in MAPPING_METADATA_COLUMNS]
    )
    updated_at = datetime.now(timezone.utc).isoformat()
    rows = []

    for treatment in wide_df.index:
        for column in data_columns:
            if column not in wide_df.columns:
                continue
            value = pd.to_numeric(pd.Series([wide_df.loc[treatment, column]]), errors="coerce").iloc[0]
            if pd.isna(value) or value <= 0:
                continue
            rows.append(
                {
                    "treatment": treatment,
                    "survey_signal": column,
                    "weight": min(float(value), 1.0),
                    "direction": _infer_signal_direction(column),
                    "confidence": 0.6,
                    "rationale": "Converted from legacy binary/wide symptom mapping.",
                    "mapping_source": wide_df.loc[treatment].get("mapping_source", "legacy_wide"),
                    "model": wide_df.loc[treatment].get("model", None),
                    "updated_at": wide_df.loc[treatment].get("updated_at", updated_at),
                }
            )

    return _normalize_continuous_mapping(pd.DataFrame(rows, columns=CONTINUOUS_MAPPING_COLUMNS))


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


def generate_fallback_continuous_symptom_mapping(treatment_list, survey_columns, config=None, **kwargs):
    """Create deterministic continuous treatment-to-survey weights without calling an LLM."""
    warnings = []
    data_columns = _survey_data_columns(survey_columns, config=config)
    max_columns = kwargs.get("max_columns", 16)
    updated_at = datetime.now(timezone.utc).isoformat()
    rows = []

    for treatment in treatment_list:
        scored_columns = [
            (column, _keyword_match_strength(column, treatment))
            for column in data_columns
        ]
        selected_columns = [
            (column, score)
            for column, score in sorted(scored_columns, key=lambda item: item[1], reverse=True)
            if score > 0
        ][:max_columns]

        if not selected_columns:
            selected_columns = [(column, 0.2) for column in data_columns[: min(max_columns, len(data_columns))]]
            warnings.append(
                f"Continuous fallback mapping for treatment '{treatment}' used low-confidence broad survey signals"
            )

        for column, score in selected_columns:
            direction = _infer_signal_direction(column)
            rows.append(
                {
                    "treatment": treatment,
                    "survey_signal": column,
                    "weight": round(max(score, 0.15), 3),
                    "direction": direction,
                    "confidence": 0.55 if score >= 0.4 else 0.35,
                    "rationale": (
                        "Deterministic keyword fallback selected this survey signal and inferred "
                        f"{'higher' if direction > 0 else 'lower'} values as indicating more unmet need."
                    ),
                    "mapping_source": "fallback_continuous_keyword",
                    "model": None,
                    "updated_at": updated_at,
                }
            )

    mapping_df = _normalize_continuous_mapping(pd.DataFrame(rows, columns=CONTINUOUS_MAPPING_COLUMNS))
    warnings.append(f"Generated continuous fallback symptom mapping for {len(treatment_list)} treatments")
    return mapping_df, warnings


def _parse_json_object(content):
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```").strip()
        stripped = stripped.removesuffix("```").strip()
    return json.loads(stripped)


def _chat_completion_params(model, max_tokens, temperature):
    normalized_model = str(model).lower()
    uses_max_completion_tokens = normalized_model.startswith(("gpt-5", "o1", "o3", "o4"))
    supports_temperature = not normalized_model.startswith(("gpt-5", "o1", "o3", "o4"))

    params = {
        "model": model,
        "response_format": {"type": "json_object"},
    }
    if uses_max_completion_tokens:
        params["max_completion_tokens"] = max_tokens
    else:
        params["max_tokens"] = max_tokens
    if supports_temperature:
        params["temperature"] = temperature

    return params


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


def _coerce_openai_continuous_mapping_result(result, treatment, data_columns, model, updated_at):
    raw_signals = result.get("signals") or result.get("signal_weights") or []
    if not isinstance(raw_signals, list):
        raise ValueError("Expected 'signals' to be a JSON array")

    valid_columns = set(data_columns)
    rows = []
    unknown_columns = []
    seen_columns = set()

    for signal in raw_signals:
        if not isinstance(signal, dict):
            continue
        column = str(signal.get("survey_signal") or signal.get("column") or "").strip()
        if column not in valid_columns:
            if column:
                unknown_columns.append(column)
            continue
        if column in seen_columns:
            continue
        seen_columns.add(column)

        rows.append(
            {
                "treatment": treatment,
                "survey_signal": column,
                "weight": signal.get("weight", 0),
                "direction": signal.get("direction", _infer_signal_direction(column)),
                "confidence": signal.get("confidence", 0.5),
                "rationale": str(signal.get("rationale") or signal.get("justification") or "").strip(),
                "mapping_source": "openai_continuous",
                "model": model,
                "updated_at": updated_at,
            }
        )

    if not rows:
        raise ValueError("No valid continuous signal mappings returned")

    for row in rows:
        if not row["rationale"]:
            row["rationale"] = "OpenAI selected this signal as a treatment-specific unmet-need proxy."

    mapping_df = _normalize_continuous_mapping(pd.DataFrame(rows, columns=CONTINUOUS_MAPPING_COLUMNS))
    mapping_df["importance"] = mapping_df["weight"] * mapping_df["confidence"]
    mapping_df = mapping_df.sort_values("importance", ascending=False).drop(columns=["importance"])
    return mapping_df, unknown_columns


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
                messages=[{"role": "user", "content": prompt}],
                **_chat_completion_params(model, max_tokens, temperature),
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


def generate_continuous_symptom_mapping(treatment_list, survey_columns, api_key=None, config=None, **kwargs):
    """Generate continuous direction-aware treatment-to-survey mappings with OpenAI."""
    warnings = []
    api_key, key_warnings = _resolve_openai_api_key(api_key=api_key, config=config)
    warnings.extend(key_warnings)

    if not api_key:
        fallback_enabled = kwargs.get(
            "fallback_on_missing_key",
            config.get("openai", {}).get("fallback_on_missing_key", True) if config else True,
        )
        if fallback_enabled:
            mapping_df, fallback_warnings = generate_fallback_continuous_symptom_mapping(
                treatment_list,
                survey_columns,
                config=config,
                **kwargs,
            )
            warnings.append("OpenAI API key not provided; used deterministic continuous fallback mapping")
            warnings.extend(fallback_warnings)
            return mapping_df, warnings
        raise ValueError("OpenAI API key not provided. Set OPENAI_API_KEY environment variable.")

    if openai is None:
        fallback_enabled = kwargs.get(
            "fallback_on_missing_key",
            config.get("openai", {}).get("fallback_on_missing_key", True) if config else True,
        )
        if fallback_enabled:
            mapping_df, fallback_warnings = generate_fallback_continuous_symptom_mapping(
                treatment_list,
                survey_columns,
                config=config,
                **kwargs,
            )
            warnings.append("OpenAI package is not installed; used deterministic continuous fallback mapping")
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
        config.get("openai", {}).get("temperature", 0.2) if config else 0.2,
    )
    strict = kwargs.get("strict", False)
    max_columns = kwargs.get("max_columns", 12)

    client = openai.OpenAI(api_key=api_key)
    data_columns = _survey_data_columns(survey_columns, config=config)
    updated_at = datetime.now(timezone.utc).isoformat()
    mapping_frames = []

    for treatment in treatment_list:
        try:
            prompt = f"""You are creating a production treatment-to-survey-signal mapping table for a healthcare access and shuttle coordination app.

Treatment:
{treatment}

Survey signal columns, as a JSON array:
{json.dumps(data_columns, ensure_ascii=True)}

Task:
Choose the survey signals that are direct or strong proxy indicators of regional unmet need for this treatment. For each selected signal, assign:
- weight: continuous relevance from 0.0 to 1.0
- direction: 1 when higher values mean greater unmet need, -1 when lower values mean greater unmet need
- confidence: 0.0 to 1.0 confidence in the mapping
- rationale: concise treatment-specific explanation

Select 4 to {max_columns} high-quality signals when available. It is acceptable to return fewer than 4 if the survey columns do not contain enough relevant evidence. Do not select weakly related columns merely to fill the list.

Use direction carefully. Examples: high anemia, high blood pressure, high unmet family planning, high tobacco use, or high out-of-pocket cost usually direction 1. Higher vaccination, institutional birth, insurance coverage, screening, skilled attendance, or sanitation coverage usually direction -1 because lower values imply unmet need.

Return ONLY valid JSON in this exact shape:
{{
  "signals": [
    {{
      "survey_signal": "exact_column_name",
      "weight": 0.75,
      "direction": 1,
      "confidence": 0.8,
      "rationale": "Why this signal indicates likely unmet need for this treatment."
    }}
  ]
}}

Use exact column names from the provided array. Do not invent columns. Prefer fewer high-quality signals over many weak signals."""

            response = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                **_chat_completion_params(model, max_tokens, temperature),
            )
            content = response.choices[0].message.content.strip()

            try:
                result = _parse_json_object(content)
                mapping_df, unknown_columns = _coerce_openai_continuous_mapping_result(
                    result,
                    treatment,
                    data_columns,
                    model,
                    updated_at,
                )
                if unknown_columns:
                    warnings.append(
                        f"Ignored {len(unknown_columns)} unknown continuous survey columns for treatment '{treatment}'"
                    )
                mapping_df = mapping_df.head(max_columns)
                mapping_frames.append(mapping_df)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                if strict:
                    raise RuntimeError(
                        f"Failed to create validated continuous OpenAI symptom mapping for treatment '{treatment}'"
                    ) from exc
                warnings.append(f"Failed to parse continuous JSON for treatment '{treatment}': {exc}")

        except Exception:
            if strict:
                raise
            warnings.append(f"API call failed for continuous mapping treatment '{treatment}'")

    if not mapping_frames:
        raise ValueError("No continuous symptom mappings were generated")

    mapping_df = _normalize_continuous_mapping(pd.concat(mapping_frames, ignore_index=True))
    warnings.append(f"Generated continuous symptom mapping for {len(treatment_list)} treatments")
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

    continuous_mapping_df = symptom_mapping_to_long(
        symptom_mapping_df,
        survey_columns=cleaned_survey_df.columns,
        config=config,
    )

    scores_dict = {}
    for treatment, treatment_mapping in continuous_mapping_df.groupby("treatment"):
        treatment_mapping = treatment_mapping[
            treatment_mapping["survey_signal"].isin(scaled_df.columns)
            & (treatment_mapping["weight"] > 0)
            & (treatment_mapping["confidence"] > 0)
        ].copy()

        if treatment_mapping.empty:
            warnings.append(f"No common columns found for treatment '{treatment}'")
            continue

        signal_columns = treatment_mapping["survey_signal"].tolist()
        weights = treatment_mapping["weight"].to_numpy(dtype=float)
        directions = treatment_mapping["direction"].to_numpy(dtype=float)
        confidences = treatment_mapping["confidence"].to_numpy(dtype=float)
        signed_weights = weights * directions * confidences
        denominator = max(abs(signed_weights).sum(), 1e-9)
        scores = scaled_df[signal_columns].to_numpy(dtype=float).dot(signed_weights) / denominator

        scores_df = identifiers.copy()
        scores_df["treatment_score"] = scores
        scores_df["rank"] = scores_df["treatment_score"].rank(ascending=False, method="min").astype(int)
        scores_df = scores_df.sort_values("treatment_score", ascending=False)
        scores_dict[treatment] = scores_df

    warnings.append(f"Calculated treatment scores for {len(scores_dict)} treatments")
    warnings.append("Treatment scores used continuous direction-aware mapping weights")
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
