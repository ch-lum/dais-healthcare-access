def clean_facility_data(raw_df, config=None, **kwargs):
    """
    Clean raw facility data by removing invalid entries.
    
    Args:
        raw_df (pd.DataFrame): Raw facility data from Databricks
        config (dict, optional): Configuration dictionary
        **kwargs: Override config parameters
            - drop_null_coords (bool): Drop facilities without lat/lon
            - drop_null_treatments (bool): Drop facilities with empty treatment lists
    
    Returns:
        tuple: (cleaned_df, warnings_list)
            - cleaned_df (pd.DataFrame): Cleaned facility data
            - warnings_list (list): List of warning messages
    
    Processing:
        1. Drop rows where latitude or longitude is NaN
        2. Drop rows where treatment-related columns are 'null' strings or empty lists
        3. Standardize column names and data types
        4. Collect warnings about dropped rows
    """

def extract_top_treatments(cleaned_facility_df, n_treatments=5, 
                          treatment_columns=None, config=None, **kwargs):
    """
    Extract top N treatments from facility data.
    
    Args:
        cleaned_facility_df (pd.DataFrame): Cleaned facility data
        n_treatments (int): Number of top treatments to extract
        treatment_columns (list): Columns to parse for treatments
        config (dict, optional): Configuration dictionary
        **kwargs: Override config parameters
    
    Returns:
        tuple: (top_treatments_list, warnings_list)
            - top_treatments_list (list): List of top N treatment names
            - warnings_list (list): Warnings about parsing issues
    
    Processing:
        1. Parse treatment_columns (specialties, procedures, equipment, description)
        2. Combine all treatments into single list per facility
        3. Count value frequencies across all facilities
        4. Return top N by count
    """

def create_supply_table(cleaned_facility_df, treatment_list, 
                       treatment_columns=None, config=None, **kwargs):
    """
    Create supply table with treatment support indicators.
    
    Args:
        cleaned_facility_df (pd.DataFrame): Cleaned facility data
        treatment_list (list): List of treatments to match
        treatment_columns (list): Columns containing treatment info
        config (dict, optional): Configuration dictionary
        **kwargs: Override config parameters
    
    Returns:
        tuple: (supply_df, warnings_list)
            - supply_df (pd.DataFrame): Original data + new columns:
                - 'all_treatments': Combined list of all treatments
                - 'top_treatments_offered': Subset matching treatment_list
                - 'num_top_treatments': Count of matched treatments
            - warnings_list (list): Parsing/matching warnings
    
    Processing:
        1. Parse and combine treatment columns into 'all_treatments'
        2. Match against treatment_list -> 'top_treatments_offered'
        3. Count matches -> 'num_top_treatments'
    """