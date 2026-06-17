import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Pool } from 'pg';

const PROFILE = process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
const ENDPOINT = process.env.LAKEBASE_ENDPOINT;
const HOST = process.env.PGHOST;
const DATABASE = process.env.PGDATABASE;
const PORT = Number(process.env.PGPORT || '5432');
const APP_TABLE = 'app_data.shuttle_recommendations';
const INPUT_FILE = process.argv[2] || process.env.RECOMMENDATIONS_FILE || 'outputs/app_recommendations.json';

interface CurrentUserResponse {
  userName: string;
}

interface TokenResponse {
  token: string;
}

interface RecommendationRow {
  id: string;
  treatment: string;
  origin_region: string;
  origin_state?: string | null;
  origin_latitude?: number | string | null;
  origin_longitude?: number | string | null;
  destination_facility_id?: string | null;
  destination_facility_name: string;
  destination_city?: string | null;
  destination_state?: string | null;
  destination_country?: string | null;
  destination_latitude?: number | string | null;
  destination_longitude?: number | string | null;
  demand_score: number | string;
  estimated_people_affected: number | string;
  current_distance_km: number | string;
  recommended_distance_km: number | string;
  distance_saved_km: number | string;
  transportation_burden_reduction_pct: number | string;
  priority_score: number | string;
  why_region: string;
  why_facility: string;
  top_contributing_signals: string | unknown[];
  snapshot_mode?: string;
  source_pipeline_version?: string;
  updated_at?: string;
}

function runDatabricksJson<T>(args: string[]) {
  const stdout = execFileSync('databricks', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  return JSON.parse(stdout) as T;
}

function ensureEnvironment() {
  if (!ENDPOINT || !HOST || !DATABASE) {
    throw new Error(
      'Missing Lakebase connection settings. Run this command from the app directory after the scaffolded .env file exists.',
    );
  }
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getConnectionPool() {
  ensureEnvironment();

  const currentUser = runDatabricksJson<CurrentUserResponse>([
    'current-user',
    'me',
    '--profile',
    PROFILE,
    '-o',
    'json',
  ]);
  const token = runDatabricksJson<TokenResponse>([
    'postgres',
    'generate-database-credential',
    ENDPOINT!,
    '--profile',
    PROFILE,
    '-o',
    'json',
  ]);

  return new Pool({
    host: HOST,
    port: PORT,
    database: DATABASE,
    user: currentUser.userName,
    password: token.token,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

function readRecommendations() {
  const payload = JSON.parse(readFileSync(INPUT_FILE, 'utf8')) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error(`Expected ${INPUT_FILE} to contain a JSON array of recommendation rows.`);
  }

  return payload as RecommendationRow[];
}

function toSignalsJson(value: RecommendationRow['top_contributing_signals']) {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

async function ensureAppTableExists(pool: Pool) {
  const result = await pool.query<{ recommendations_table: string | null }>(`
    SELECT to_regclass('${APP_TABLE}')::text AS recommendations_table
  `);

  if (!result.rows[0]?.recommendations_table) {
    throw new Error(
      'The recommendation table has not been initialized yet. Deploy or run the app once so the Lakebase schema exists, then rerun this loader.',
    );
  }

  const coordinateColumns = [
    'origin_latitude',
    'origin_longitude',
    'destination_latitude',
    'destination_longitude',
  ];
  const columns = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'app_data'
        AND table_name = 'shuttle_recommendations'
        AND column_name = ANY($1)
    `,
    [coordinateColumns],
  );
  const existingColumns = new Set(columns.rows.map((row) => row.column_name));
  const missingColumns = coordinateColumns.filter((column) => !existingColumns.has(column));

  if (missingColumns.length > 0) {
    await pool.query(`
      ALTER TABLE ${APP_TABLE}
        ADD COLUMN IF NOT EXISTS origin_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS origin_longitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS destination_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS destination_longitude DOUBLE PRECISION
    `);
  }
}

function buildInsertStatement(rows: RecommendationRow[]) {
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 26;
    values.push(
      row.id,
      row.treatment,
      row.origin_region,
      row.origin_state ?? null,
      toNullableNumber(row.origin_latitude),
      toNullableNumber(row.origin_longitude),
      row.destination_facility_id ?? null,
      row.destination_facility_name,
      row.destination_city ?? null,
      row.destination_state ?? null,
      row.destination_country ?? null,
      toNullableNumber(row.destination_latitude),
      toNullableNumber(row.destination_longitude),
      toNullableNumber(row.demand_score),
      toNullableNumber(row.estimated_people_affected),
      toNullableNumber(row.current_distance_km),
      toNullableNumber(row.recommended_distance_km),
      toNullableNumber(row.distance_saved_km),
      toNullableNumber(row.transportation_burden_reduction_pct),
      toNullableNumber(row.priority_score),
      row.why_region,
      row.why_facility,
      toSignalsJson(row.top_contributing_signals),
      row.snapshot_mode || 'pipeline',
      row.source_pipeline_version || 'python.facility_prioritization.v1',
      row.updated_at || new Date().toISOString(),
    );

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23}::jsonb, $${base + 24}, $${base + 25}, $${base + 26})`;
  });

  return {
    text: `
      INSERT INTO ${APP_TABLE} (
        id,
        treatment,
        origin_region,
        origin_state,
        origin_latitude,
        origin_longitude,
        destination_facility_id,
        destination_facility_name,
        destination_city,
        destination_state,
        destination_country,
        destination_latitude,
        destination_longitude,
        demand_score,
        estimated_people_affected,
        current_distance_km,
        recommended_distance_km,
        distance_saved_km,
        transportation_burden_reduction_pct,
        priority_score,
        why_region,
        why_facility,
        top_contributing_signals,
        snapshot_mode,
        source_pipeline_version,
        updated_at
      ) VALUES
      ${tuples.join(',\n')}
      ON CONFLICT (id) DO UPDATE SET
        treatment = EXCLUDED.treatment,
        origin_region = EXCLUDED.origin_region,
        origin_state = EXCLUDED.origin_state,
        origin_latitude = EXCLUDED.origin_latitude,
        origin_longitude = EXCLUDED.origin_longitude,
        destination_facility_id = EXCLUDED.destination_facility_id,
        destination_facility_name = EXCLUDED.destination_facility_name,
        destination_city = EXCLUDED.destination_city,
        destination_state = EXCLUDED.destination_state,
        destination_country = EXCLUDED.destination_country,
        destination_latitude = EXCLUDED.destination_latitude,
        destination_longitude = EXCLUDED.destination_longitude,
        demand_score = EXCLUDED.demand_score,
        estimated_people_affected = EXCLUDED.estimated_people_affected,
        current_distance_km = EXCLUDED.current_distance_km,
        recommended_distance_km = EXCLUDED.recommended_distance_km,
        distance_saved_km = EXCLUDED.distance_saved_km,
        transportation_burden_reduction_pct = EXCLUDED.transportation_burden_reduction_pct,
        priority_score = EXCLUDED.priority_score,
        why_region = EXCLUDED.why_region,
        why_facility = EXCLUDED.why_facility,
        top_contributing_signals = EXCLUDED.top_contributing_signals,
        snapshot_mode = EXCLUDED.snapshot_mode,
        source_pipeline_version = EXCLUDED.source_pipeline_version,
        updated_at = EXCLUDED.updated_at
    `,
    values,
  };
}

async function main() {
  const recommendations = readRecommendations();
  if (recommendations.length === 0) {
    throw new Error(`No recommendations found in ${INPUT_FILE}.`);
  }

  console.log(`Loading ${recommendations.length} recommendations from ${INPUT_FILE} using profile ${PROFILE}...`);
  const pool = getConnectionPool();
  let transactionStarted = false;

  try {
    await ensureAppTableExists(pool);
    const statement = buildInsertStatement(recommendations);
    await pool.query('BEGIN');
    transactionStarted = true;
    await pool.query(`TRUNCATE TABLE ${APP_TABLE}`);
    await pool.query(statement.text, statement.values);
    await pool.query('COMMIT');
    transactionStarted = false;
    console.log(`Recommendation snapshot loaded into ${APP_TABLE}.`);
  } catch (error) {
    if (transactionStarted) {
      await pool.query('ROLLBACK');
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
