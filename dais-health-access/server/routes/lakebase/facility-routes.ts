import type { Application } from 'express';
import { z } from 'zod';

interface QueryResultRow {
  [key: string]: unknown;
}

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const APP_SCHEMA = 'app_data';
const FACILITIES_TABLE = `${APP_SCHEMA}.facilities_snapshot`;
const SNAPSHOT_RUNS_TABLE = `${APP_SCHEMA}.snapshot_runs`;
const SOURCE_TABLE =
  'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities';

const CREATE_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS ${APP_SCHEMA}`;

const CREATE_FACILITIES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${FACILITIES_TABLE} (
    unique_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_type TEXT,
    official_phone TEXT,
    official_website TEXT,
    email TEXT,
    address_city TEXT,
    address_state_or_region TEXT,
    address_country TEXT,
    facility_type_id TEXT,
    specialties TEXT,
    description TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source TEXT,
    source_urls TEXT,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CREATE_FACILITIES_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_facilities_snapshot_country_city
    ON ${FACILITIES_TABLE} (address_country, address_city);
  CREATE INDEX IF NOT EXISTS idx_facilities_snapshot_organization_type
    ON ${FACILITIES_TABLE} (organization_type);
  CREATE INDEX IF NOT EXISTS idx_facilities_snapshot_name
    ON ${FACILITIES_TABLE} (name);
`;

const CREATE_SNAPSHOT_RUNS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SNAPSHOT_RUNS_TABLE} (
    id BIGSERIAL PRIMARY KEY,
    mode TEXT NOT NULL,
    source_table TEXT NOT NULL,
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    run_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_completed_at TIMESTAMPTZ
  )
`;

const NormalizedFilters = z.object({
  q: z.string().trim().max(120).default(''),
  country: z.string().trim().max(120).default('all'),
  city: z.string().trim().max(120).default('all'),
  organizationType: z.string().trim().max(120).default('all'),
  limit: z.coerce.number().int().min(1).max(24).default(12),
  offset: z.coerce.number().int().min(0).default(0),
});

function getSingleValue(value: unknown) {
  const firstValue: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof firstValue === 'string') {
    return firstValue;
  }

  if (typeof firstValue === 'number' || typeof firstValue === 'boolean') {
    return String(firstValue);
  }

  return '';
}

function normalizeFilterValue(value: string) {
  return value === 'all' ? '' : value;
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code?: string }).code === '42P01'
  );
}

async function ensureFacilitiesSchema(appkit: AppKitWithLakebase) {
  if (process.env.ENABLE_LAKEBASE_BOOTSTRAP === '0') {
    console.log('[lakebase] Skipping schema bootstrap because ENABLE_LAKEBASE_BOOTSTRAP=0');
    return;
  }

  await appkit.lakebase.query(CREATE_SCHEMA_SQL);
  await appkit.lakebase.query(CREATE_FACILITIES_TABLE_SQL);
  await appkit.lakebase.query(CREATE_FACILITIES_INDEXES_SQL);
  await appkit.lakebase.query(CREATE_SNAPSHOT_RUNS_TABLE_SQL);
  console.log('[lakebase] Facilities schema ready');
}

async function getSnapshotSummary(appkit: AppKitWithLakebase) {
  const countResult = await appkit.lakebase.query(`
    SELECT
      COUNT(*)::int AS total_facilities,
      COUNT(DISTINCT NULLIF(address_country, ''))::int AS countries,
      COUNT(DISTINCT NULLIF(address_city, ''))::int AS cities,
      COUNT(DISTINCT NULLIF(organization_type, ''))::int AS organization_types
    FROM ${FACILITIES_TABLE}
  `);

  const snapshotResult = await appkit.lakebase.query(`
    SELECT
      mode,
      source_table,
      row_count,
      run_completed_at
    FROM ${SNAPSHOT_RUNS_TABLE}
    WHERE status = 'completed'
    ORDER BY run_completed_at DESC NULLS LAST
    LIMIT 1
  `);

  const summary = countResult.rows[0] ?? {};
  const latestSnapshot = snapshotResult.rows[0] ?? {};

  return {
    totalFacilities: asNumber(summary.total_facilities),
    countries: asNumber(summary.countries),
    cities: asNumber(summary.cities),
    organizationTypes: asNumber(summary.organization_types),
    latestSnapshotAt: latestSnapshot.run_completed_at ?? null,
    snapshotMode: asString(latestSnapshot.mode) || 'demo_snapshot',
    sourceTable: asString(latestSnapshot.source_table) || SOURCE_TABLE,
    snapshotRowCount: asNumber(latestSnapshot.row_count),
  };
}

async function getFilterOptions(appkit: AppKitWithLakebase) {
  const [countriesResult, citiesResult, organizationTypesResult] = await Promise.all([
    appkit.lakebase.query(`
      SELECT address_country AS value, COUNT(*)::int AS count
      FROM ${FACILITIES_TABLE}
      WHERE address_country IS NOT NULL AND address_country <> ''
      GROUP BY 1
      ORDER BY count DESC, value ASC
      LIMIT 12
    `),
    appkit.lakebase.query(`
      SELECT address_city AS value, COUNT(*)::int AS count
      FROM ${FACILITIES_TABLE}
      WHERE address_city IS NOT NULL AND address_city <> ''
      GROUP BY 1
      ORDER BY count DESC, value ASC
      LIMIT 12
    `),
    appkit.lakebase.query(`
      SELECT organization_type AS value, COUNT(*)::int AS count
      FROM ${FACILITIES_TABLE}
      WHERE organization_type IS NOT NULL AND organization_type <> ''
      GROUP BY 1
      ORDER BY count DESC, value ASC
      LIMIT 12
    `),
  ]);

  const toOptions = (rows: QueryResultRow[]) =>
    rows.map((row) => ({
      value: asString(row.value),
      count: asNumber(row.count),
    }));

  return {
    countries: toOptions(countriesResult.rows),
    cities: toOptions(citiesResult.rows),
    organizationTypes: toOptions(organizationTypesResult.rows),
  };
}

async function listFacilities(appkit: AppKitWithLakebase, rawQuery: unknown) {
  const query = isRecord(rawQuery) ? rawQuery : {};
  const parsed = NormalizedFilters.parse({
    q: getSingleValue(query.q),
    country: getSingleValue(query.country),
    city: getSingleValue(query.city),
    organizationType: getSingleValue(query.organizationType),
    limit: getSingleValue(query.limit ?? '12'),
    offset: getSingleValue(query.offset ?? '0'),
  });

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  const searchTerm = parsed.q.trim();
  const country = normalizeFilterValue(parsed.country);
  const city = normalizeFilterValue(parsed.city);
  const organizationType = normalizeFilterValue(parsed.organizationType);

  if (searchTerm) {
    params.push(`%${searchTerm}%`);
    const index = params.length;
    whereClauses.push(`
      (
        name ILIKE $${index}
        OR COALESCE(organization_type, '') ILIKE $${index}
        OR COALESCE(address_city, '') ILIKE $${index}
        OR COALESCE(description, '') ILIKE $${index}
        OR COALESCE(specialties, '') ILIKE $${index}
      )
    `);
  }

  if (country) {
    params.push(country);
    whereClauses.push(`address_country = $${params.length}`);
  }

  if (city) {
    params.push(city);
    whereClauses.push(`address_city = $${params.length}`);
  }

  if (organizationType) {
    params.push(organizationType);
    whereClauses.push(`organization_type = $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${FACILITIES_TABLE}
    ${whereSql}
  `;

  const countResult = await appkit.lakebase.query(countSql, params);
  const total = asNumber(countResult.rows[0]?.total);

  const listParams = [...params, parsed.limit, parsed.offset];
  const limitPosition = listParams.length - 1;
  const offsetPosition = listParams.length;

  const listSql = `
    SELECT
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
    FROM ${FACILITIES_TABLE}
    ${whereSql}
    ORDER BY
      COALESCE(address_country, '') ASC,
      COALESCE(address_city, '') ASC,
      name ASC
    LIMIT $${limitPosition}
    OFFSET $${offsetPosition}
  `;

  const rows = await appkit.lakebase.query(listSql, listParams);

  return {
    total,
    limit: parsed.limit,
    offset: parsed.offset,
    facilities: rows.rows,
  };
}

async function getFacilityById(appkit: AppKitWithLakebase, uniqueId: string) {
  const result = await appkit.lakebase.query(
    `
      SELECT
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
      FROM ${FACILITIES_TABLE}
      WHERE unique_id = $1
      LIMIT 1
    `,
    [uniqueId],
  );

  return result.rows[0] ?? null;
}

function handleFacilitiesError(res: { status(code: number): { json(payload: unknown): void } }, error: unknown) {
  if (isMissingTableError(error)) {
    res.status(503).json({
      error: 'Facilities snapshot is not loaded yet.',
      guidance:
        'Deploy the app once so the service principal can initialize the schema, then run npm run load:facilities-snapshot.',
    });
    return;
  }

  console.error('[lakebase] Facilities route error:', error);
  res.status(500).json({ error: 'Failed to query facilities snapshot.' });
}

export async function setupFacilityRoutes(appkit: AppKitWithLakebase) {
  try {
    await ensureFacilitiesSchema(appkit);
  } catch (error) {
    console.warn('[lakebase] Facilities schema setup failed:', error);
  }

  appkit.server.extend((app) => {
    app.get('/api/facilities/summary', async (_req, res) => {
      try {
        res.json(await getSnapshotSummary(appkit));
      } catch (error) {
        handleFacilitiesError(res, error);
      }
    });

    app.get('/api/facilities/options', async (_req, res) => {
      try {
        res.json(await getFilterOptions(appkit));
      } catch (error) {
        handleFacilitiesError(res, error);
      }
    });

    app.get('/api/facilities', async (req, res) => {
      try {
        res.json(await listFacilities(appkit, req.query as Record<string, unknown>));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ error: 'Invalid facility query parameters.' });
          return;
        }
        handleFacilitiesError(res, error);
      }
    });

    app.get('/api/facilities/:uniqueId', async (req, res) => {
      try {
        const facility = await getFacilityById(appkit, req.params.uniqueId);
        if (!facility) {
          res.status(404).json({ error: 'Facility not found.' });
          return;
        }
        res.json(facility);
      } catch (error) {
        handleFacilitiesError(res, error);
      }
    });
  });
}
