import yaml
import os
from pathlib import Path

def load_config(config_path=None):
    """
    Load configuration from YAML file.
    
    Args:
        config_path (str): Path to config file. 
                          If None, use default: config/config.yaml
    
    Returns:
        dict: Configuration dictionary
    """
    if config_path is None:
        # Default to config/config.yaml
        config_path = Path(__file__).parent.parent.parent / "config" / "config.yaml"
    
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    return config

def merge_config(config, **kwargs):
    """
    Merge config with function-level overrides.
    
    Args:
        config (dict): Base configuration
        **kwargs: Override parameters
    
    Returns:
        dict: Merged configuration
    """
    merged = config.copy()
    for key, value in kwargs.items():
        if value is not None:
            merged[key] = value
    return merged