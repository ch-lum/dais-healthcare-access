from math import asin, cos, radians, sin, sqrt

import numpy as np
import pandas as pd


def haversine_distance(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return c * 6371


def piecewise_distance_decay(distance_km, zones=None):
    if zones is None:
        zones = [
            {"max": 50, "weight": 1.0, "base": 0},
            {"max": 100, "weight": 0.8, "base": 50},
            {"max": 200, "weight": 0.5, "base": 90},
            {"max": 400, "weight": 0.3, "base": 140},
            {"max": np.inf, "weight": 0.15, "base": 200},
        ]

    d = np.asarray(distance_km)
    result = np.where(
        d <= 50,
        d,
        np.where(
            d <= 100,
            50 + (d - 50) * 0.8,
            np.where(
                d <= 200,
                90 + (d - 100) * 0.5,
                np.where(d <= 400, 140 + (d - 200) * 0.3, 200 + (d - 400) * 0.15),
            ),
        ),
    )
    return result if isinstance(distance_km, np.ndarray) else float(result)


def clean_district_name(name):
    if pd.isna(name):
        return name
    return str(name).strip().title()


def match_district_names(name1, name2):
    return clean_district_name(name1) == clean_district_name(name2)
