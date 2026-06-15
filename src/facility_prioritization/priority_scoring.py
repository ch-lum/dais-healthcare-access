def create_priority_table(demand_df, supply_df, geo_reference_df, 
                         config=None, **kwargs):
    """
    Create final priority table with distance-decayed scoring.
    
    Args:
        demand_df (pd.DataFrame): Unified demand table
        supply_df (pd.DataFrame): Supply table with facility locations
        geo_reference_df (pd.DataFrame): Postal code -> district lat/lon
        config (dict, optional): Configuration dictionary
        **kwargs: Override config parameters
            - decay_function (str): 'piecewise' (default)
            - decay_zones (dict): Distance zone boundaries and weights
    
    Returns:
        tuple: (priority_df, warnings_list)
            - priority_df (pd.DataFrame): Columns:
                - district_name, state_ut, treatment, treatment_score,
                  distance_to_nearest_facility_km, effective_distance,
                  priority_score, nearest_facility_name
            - warnings_list (list): Distance calculation warnings
    
    Processing:
        1. Aggregate geo_reference to district level (median lat/lon)
        2. Join demand_df with district coordinates
        3. For each (district, treatment):
            a. Find nearest facility offering that treatment
            b. Calculate haversine distance
        4. Apply piecewise distance decay
        5. Calculate priority_score = treatment_score × effective_distance
        6. Sort by priority_score descending
    """