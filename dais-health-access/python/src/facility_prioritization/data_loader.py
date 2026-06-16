import json
import os
import subprocess

import pandas as pd

try:
    from pyspark.sql import SparkSession
except ImportError:  # pragma: no cover - local/off-cluster runs do not require Spark.
    SparkSession = None


def _load_with_databricks_cli(table_name, profile=None, limit=None, sql=None):
    query = sql or f"SELECT * FROM {table_name}"
    if limit is not None and limit > 0 and " limit " not in query.lower():
        query = f"{query} LIMIT {int(limit)}"

    args = [
        "databricks",
        "experimental",
        "aitools",
        "tools",
        "query",
        query,
        "-o",
        "json",
    ]

    if profile:
        args.extend(["--profile", profile])

    completed = subprocess.run(
        args,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        details = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f"Databricks CLI query failed for {table_name}: {details}"
        )

    rows = json.loads(completed.stdout)
    return pd.DataFrame(rows)


def load_from_databricks(table_name, spark=None, profile=None, limit=None, sql=None):
    """
    Load a Unity Catalog table into pandas.

    Uses Spark when running inside Databricks. For local/off-cluster demo runs,
    falls back to the Databricks CLI query helper with an authenticated profile.

    Args:
        table_name (str): Fully qualified table name.
        spark (SparkSession, optional): Existing Spark session.
        profile (str, optional): Databricks CLI profile for local runs.
        limit (int, optional): Row limit for local/demo reads.
        sql (str, optional): Explicit SQL query to run instead of SELECT *.

    Returns:
        pd.DataFrame: Table/query result as pandas DataFrame.
    """
    if spark is not None:
        sdf = spark.sql(sql) if sql else spark.table(table_name)
        if limit is not None and limit > 0:
            sdf = sdf.limit(int(limit))
        return sdf.toPandas()

    if SparkSession is not None and os.getenv("DATABRICKS_RUNTIME_VERSION"):
        spark = SparkSession.builder.getOrCreate()
        sdf = spark.sql(sql) if sql else spark.table(table_name)
        if limit is not None and limit > 0:
            sdf = sdf.limit(int(limit))
        return sdf.toPandas()

    cli_profile = profile or os.getenv("DATABRICKS_CONFIG_PROFILE")
    return _load_with_databricks_cli(table_name, profile=cli_profile, limit=limit, sql=sql)
