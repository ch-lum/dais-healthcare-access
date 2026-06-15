from pyspark.sql import SparkSession

def load_from_databricks(table_name, spark=None):
    """
    Load table from Databricks Unity Catalog.
    
    Args:
        table_name (str): Fully qualified table name 
                         (catalog.schema.table)
        spark (SparkSession, optional): Existing Spark session
    
    Returns:
        pd.DataFrame: Table as pandas DataFrame
    """
    if spark is None:
        spark = SparkSession.builder.getOrCreate()
    
    sdf = spark.table(table_name)
    pdf = sdf.toPandas()
    
    return pdf