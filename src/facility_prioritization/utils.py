def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate great circle distance between two points.
    Returns distance in kilometers.
    """

def piecewise_distance_decay(distance_km):
    """
    Apply piecewise linear distance decay.
    
    Zones:
        0-50km: 1.0x weight
        50-100km: 0.8x weight
        100-200km: 0.5x weight
        200-400km: 0.3x weight
        400+km: 0.15x weight
    
    Returns effective distance.
    """

def match_district_names(name1, name2):
    """
    Simple string matching: strip, title case.
    Future: Add fuzzy matching if needed.
    """
