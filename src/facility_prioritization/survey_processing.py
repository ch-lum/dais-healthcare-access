def clean_survey_data(raw_survey_df, config=None, **kwargs):
    """
    Clean and standardize survey data.
    
    Args:
        raw_survey_df (pd.DataFrame): Raw survey data
        config (dict, optional): Configuration dictionary
        **kwargs: Override config parameters
            - numeric_conversion (bool): Convert columns to numeric
            - drop_non_numeric (bool): Drop non-numeric columns
    
    Returns:
        tuple: (cleaned_survey_df, warnings_list)
            - cleaned_survey_df (pd.DataFrame): Cleaned survey with:
                - Numeric columns only (except district_name, state_ut)
                - NaN handling
                - Standard scaling ready
            - warnings_list (list): Data quality warnings
    
    Processing:
        1. Convert all data columns to numeric (coerce errors)
        2. Handle missing values
        3. Preserve district_name and state_ut as identifiers
        4. Report columns that couldn't be converted
    """
