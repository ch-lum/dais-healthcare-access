import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { Pool } from 'pg';

const PROFILE = process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
const SOURCE_TABLE =
  'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities';
const ENDPOINT = process.env.LAKEBASE_ENDPOINT;
const HOST = process.env.PGHOST;
const DATABASE = process.env.PGDATABASE;
const PORT = Number(process.env.PGPORT || '5432');
const BATCH_SIZE = 500;
const APP_TABLE = 'app_data.facilities_snapshot';
const RUNS_TABLE = 'app_data.snapshot_runs';

interface CurrentUserResponse {
  userName: string;
}

interface FacilityRow {
  unique_id: string | null;
  name: string | null;
  organization_type: string | null;
  official_phone: string | null;
  official_website: string | null;
  email: string | null;
  address_city: string | null;
  address_state_or_region: string | null;
  address_country: string | null;
  facility_type_id: string | null;
  specialties: string | null;
  description: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  source: string | null;
  source_urls: string | null;
}

interface CountRow {
  count: string | number;
}

interface TokenResponse {
  token: string;
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

function toNullableNumber(value: string | number | null) {
  if (value === null || value === '') {
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

async function ensureAppTablesExist(pool: Pool) {
  const result = await pool.query<{
    facilities_table: string | null;
    snapshot_runs_table: string | null;
  }>(`
    SELECT
      to_regclass('${APP_TABLE}')::text AS facilities_table,
      to_regclass('${RUNS_TABLE}')::text AS snapshot_runs_table
  `);

  const row = result.rows[0];
  if (!row?.facilities_table || !row.snapshot_runs_table) {
    throw new Error(
      'The app schema has not been initialized yet. Deploy the app once so the service principal can create the Lakebase schema, then rerun this loader.',
    );
  }
}

function getSourceCount() {
  const rows = runDatabricksJson<CountRow[]>([
    'experimental',
    'aitools',
    'tools',
    'query',
    `SELECT COUNT(*) AS count FROM ${SOURCE_TABLE} WHERE unique_id IS NOT NULL`,
    '--profile',
    PROFILE,
    '-o',
    'json',
  ]);

  return Number(rows[0]?.count ?? 0);
}

function getBatch(offset: number) {
  return runDatabricksJson<FacilityRow[]>([
    'experimental',
    'aitools',
    'tools',
    'query',
    `
      SELECT
        unique_id,
        name,
        organization_type,
        officialPhone AS official_phone,
        officialWebsite AS official_website,
        email,
        address_city,
        address_stateOrRegion AS address_state_or_region,
        address_country,
        facilityTypeId AS facility_type_id,
        specialties,
        description,
        latitude,
        longitude,
        source,
        source_urls
      FROM ${SOURCE_TABLE}
      WHERE unique_id IS NOT NULL
      ORDER BY unique_id
      LIMIT ${BATCH_SIZE}
      OFFSET ${offset}
    `,
    '--profile',
    PROFILE,
    '-o',
    'json',
  ]);
}

function buildInsertStatement(rows: FacilityRow[], loadedAt: string) {
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 17;
    values.push(
      row.unique_id,
      row.name || 'Unnamed facility',
      row.organization_type,
      row.official_phone,
      row.official_website,
      row.email,
      row.address_city,
      row.address_state_or_region,
      row.address_country,
      row.facility_type_id,
      row.specialties,
      row.description,
      toNullableNumber(row.latitude),
      toNullableNumber(row.longitude),
      row.source,
      row.source_urls,
      loadedAt,
    );

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17})`;
  });

  return {
    text: `
      INSERT INTO ${APP_TABLE} (
        unique_id,
        name,
        organization_type,
        official_phone,
        official_website,
        email,
        address_city,
        address_state_or_region,
        address_country,
        facility_type_id,
        specialties,
        description,
        latitude,
        longitude,
        source,
        source_urls,
        loaded_at
      ) VALUES
      ${tuples.join(',\n')}
    `,
    values,
  };
}

async function main() {
  console.log(`Loading ${SOURCE_TABLE} into Lakebase using profile ${PROFILE}...`);
  const pool = getConnectionPool();

  try {
    await ensureAppTablesExist(pool);

    const sourceCount = getSourceCount();
    const runStart = await pool.query<{ id: number }>(
      `
        INSERT INTO ${RUNS_TABLE} (mode, source_table, status, notes)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['demo_snapshot', SOURCE_TABLE, 'running', 'One-time facilities import for the hackathon demo path'],
    );

    const runId = runStart.rows[0].id;
    const loadedAt = new Date().toISOString();
    let inserted = 0;

    try {
      await pool.query('BEGIN');
      await pool.query(`TRUNCATE TABLE ${APP_TABLE}`);

      for (let offset = 0; offset < sourceCount; offset += BATCH_SIZE) {
        const batch = getBatch(offset);
        if (batch.length === 0) {
          continue;
        }

        const statement = buildInsertStatement(batch, loadedAt);
        await pool.query(statement.text, statement.values);
        inserted += batch.length;
        console.log(`Imported ${inserted}/${sourceCount} facilities...`);
      }

      await pool.query('COMMIT');
      await pool.query(
        `
          UPDATE ${RUNS_TABLE}
          SET status = 'completed',
              row_count = $2,
              run_completed_at = NOW()
          WHERE id = $1
        `,
        [runId, inserted],
      );

      console.log(`Snapshot import complete: ${inserted} facilities loaded into ${APP_TABLE}.`);
    } catch (error) {
      await pool.query('ROLLBACK');
      await pool.query(
        `
          UPDATE ${RUNS_TABLE}
          SET status = 'failed',
              row_count = $2,
              notes = $3,
              run_completed_at = NOW()
          WHERE id = $1
        `,
        [runId, inserted, error instanceof Error ? error.message : 'Unknown import failure'],
      );
      throw error;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
