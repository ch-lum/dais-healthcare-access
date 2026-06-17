import type { Application } from 'express';
import { z } from 'zod';

interface QueryResultRow {
  [key: string]: unknown;
}

interface AppKitWithLakebaseAndServer {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const APP_SCHEMA = 'app_data';
const RECOMMENDATIONS_TABLE = `${APP_SCHEMA}.shuttle_recommendations`;

const CREATE_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS ${APP_SCHEMA}`;

const CREATE_RECOMMENDATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${RECOMMENDATIONS_TABLE} (
    id TEXT PRIMARY KEY,
    treatment TEXT NOT NULL,
    origin_region TEXT NOT NULL,
    origin_state TEXT,
    origin_latitude DOUBLE PRECISION,
    origin_longitude DOUBLE PRECISION,
    destination_facility_id TEXT,
    destination_facility_name TEXT NOT NULL,
    destination_city TEXT,
    destination_state TEXT,
    destination_country TEXT,
    destination_latitude DOUBLE PRECISION,
    destination_longitude DOUBLE PRECISION,
    demand_score DOUBLE PRECISION NOT NULL,
    estimated_people_affected INTEGER NOT NULL,
    current_distance_km DOUBLE PRECISION NOT NULL,
    recommended_distance_km DOUBLE PRECISION NOT NULL,
    distance_saved_km DOUBLE PRECISION NOT NULL,
    transportation_burden_reduction_pct DOUBLE PRECISION NOT NULL,
    priority_score DOUBLE PRECISION NOT NULL,
    why_region TEXT NOT NULL,
    why_facility TEXT NOT NULL,
    top_contributing_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    snapshot_mode TEXT NOT NULL DEFAULT 'demo_seed',
    source_pipeline_version TEXT NOT NULL DEFAULT 'python.facility_prioritization.v1',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CREATE_RECOMMENDATIONS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_shuttle_recommendations_treatment
    ON ${RECOMMENDATIONS_TABLE} (treatment);
  CREATE INDEX IF NOT EXISTS idx_shuttle_recommendations_priority
    ON ${RECOMMENDATIONS_TABLE} (priority_score DESC);
  CREATE INDEX IF NOT EXISTS idx_shuttle_recommendations_updated_at
    ON ${RECOMMENDATIONS_TABLE} (updated_at DESC);
`;

const ALTER_RECOMMENDATIONS_COORDINATES_SQL = `
  ALTER TABLE ${RECOMMENDATIONS_TABLE}
    ADD COLUMN IF NOT EXISTS origin_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS origin_longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS destination_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS destination_longitude DOUBLE PRECISION;
`;

const RecommendationQuery = z.object({
  treatment: z.string().trim().max(120).default('all'),
  limit: z.coerce.number().int().min(1).max(24).default(12),
  maxDistanceSavedKm: z.coerce.number().min(0).max(5000).optional(),
});

const demoRecommendations = [
  {
    id: 'oncology-gaya-patna',
    treatment: 'Oncology',
    originRegion: 'Gaya',
    originState: 'Bihar',
    destinationFacilityId: 'demo-patna-oncology',
    destinationFacilityName: 'Patna Regional Cancer Centre',
    destinationCity: 'Patna',
    destinationState: 'Bihar',
    destinationCountry: 'India',
    demandScore: 91.4,
    estimatedPeopleAffected: 18400,
    currentDistanceKm: 306,
    recommendedDistanceKm: 101,
    priorityScore: 97.2,
    whyRegion:
      'High modeled oncology demand combines with sparse local specialty coverage and long-distance referral patterns.',
    whyFacility:
      'This destination is the nearest high-confidence oncology match with coordinates, urban transport access, and specialty evidence in the facility profile.',
    topContributingSignals: [
      { signal: 'Cancer screening gap', weight: 0.34 },
      { signal: 'Late-stage care proxy', weight: 0.26 },
      { signal: 'Specialist scarcity', weight: 0.21 },
    ],
  },
  {
    id: 'dialysis-bahraich-lucknow',
    treatment: 'Dialysis',
    originRegion: 'Bahraich',
    originState: 'Uttar Pradesh',
    destinationFacilityId: 'demo-lucknow-renal',
    destinationFacilityName: 'Lucknow Renal Care Institute',
    destinationCity: 'Lucknow',
    destinationState: 'Uttar Pradesh',
    destinationCountry: 'India',
    demandScore: 88.9,
    estimatedPeopleAffected: 12100,
    currentDistanceKm: 254,
    recommendedDistanceKm: 128,
    priorityScore: 91.8,
    whyRegion:
      'Survey indicators point to elevated chronic disease burden while facility text suggests limited local renal-care supply.',
    whyFacility:
      'The facility offers renal-care signals and is close enough for repeat shuttle scheduling instead of one-off long-haul transport.',
    topContributingSignals: [
      { signal: 'Diabetes prevalence proxy', weight: 0.31 },
      { signal: 'Hypertension prevalence proxy', weight: 0.27 },
      { signal: 'Repeat-treatment burden', weight: 0.24 },
    ],
  },
  {
    id: 'maternity-kalahandi-bhubaneswar',
    treatment: 'High-risk maternity',
    originRegion: 'Kalahandi',
    originState: 'Odisha',
    destinationFacilityId: 'demo-bhubaneswar-women',
    destinationFacilityName: 'Bhubaneswar Women and Child Hospital',
    destinationCity: 'Bhubaneswar',
    destinationState: 'Odisha',
    destinationCountry: 'India',
    demandScore: 86.6,
    estimatedPeopleAffected: 15600,
    currentDistanceKm: 421,
    recommendedDistanceKm: 321,
    priorityScore: 84.5,
    whyRegion:
      'Maternal-health survey signals and low nearby procedural supply make this region a strong candidate for scheduled referral transport.',
    whyFacility:
      'The destination profile contains obstetric and emergency-care signals and sits on a more practical state-capital referral route.',
    topContributingSignals: [
      { signal: 'Antenatal care gap', weight: 0.29 },
      { signal: 'Institutional delivery gap', weight: 0.25 },
      { signal: 'Emergency obstetric supply gap', weight: 0.23 },
    ],
  },
  {
    id: 'cardiology-bastar-raipur',
    treatment: 'Cardiology',
    originRegion: 'Bastar',
    originState: 'Chhattisgarh',
    destinationFacilityId: 'demo-raipur-heart',
    destinationFacilityName: 'Raipur Heart and Vascular Centre',
    destinationCity: 'Raipur',
    destinationState: 'Chhattisgarh',
    destinationCountry: 'India',
    demandScore: 84.8,
    estimatedPeopleAffected: 9900,
    currentDistanceKm: 318,
    recommendedDistanceKm: 286,
    priorityScore: 78.9,
    whyRegion:
      'The model flags cardiovascular risk proxies plus weak local specialty evidence, so transport can improve access to planned care.',
    whyFacility:
      'The facility has cardiology-related signals and is the most realistic destination among nearby matched providers.',
    topContributingSignals: [
      { signal: 'Hypertension prevalence proxy', weight: 0.35 },
      { signal: 'Cardiac specialist scarcity', weight: 0.24 },
      { signal: 'Travel-time penalty', weight: 0.18 },
    ],
  },
  {
    id: 'oncology-jalpaiguri-kolkata',
    treatment: 'Oncology',
    originRegion: 'Jalpaiguri',
    originState: 'West Bengal',
    destinationFacilityId: 'demo-kolkata-cancer',
    destinationFacilityName: 'Kolkata Comprehensive Cancer Hospital',
    destinationCity: 'Kolkata',
    destinationState: 'West Bengal',
    destinationCountry: 'India',
    demandScore: 82.7,
    estimatedPeopleAffected: 11200,
    currentDistanceKm: 614,
    recommendedDistanceKm: 575,
    priorityScore: 76.4,
    whyRegion:
      'High need signals remain after distance decay, and the region has few credible local oncology supply matches.',
    whyFacility:
      'The destination is a high-confidence specialty match with enough scale for coordinated inter-district shuttle routing.',
    topContributingSignals: [
      { signal: 'Screening gap', weight: 0.32 },
      { signal: 'Referral distance', weight: 0.25 },
      { signal: 'Treatment supply deficit', weight: 0.22 },
    ],
  },
  {
    id: 'dialysis-bellary-bengaluru',
    treatment: 'Dialysis',
    originRegion: 'Ballari',
    originState: 'Karnataka',
    destinationFacilityId: 'demo-bengaluru-renal',
    destinationFacilityName: 'Bengaluru Nephrology and Dialysis Centre',
    destinationCity: 'Bengaluru',
    destinationState: 'Karnataka',
    destinationCountry: 'India',
    demandScore: 80.1,
    estimatedPeopleAffected: 8700,
    currentDistanceKm: 312,
    recommendedDistanceKm: 280,
    priorityScore: 73.6,
    whyRegion:
      'Chronic-care indicators suggest repeat treatment need, while local supply is thin enough to justify a predictable shuttle cadence.',
    whyFacility:
      'This facility is a strong renal-care match and can anchor a repeat-route pattern for dialysis patients.',
    topContributingSignals: [
      { signal: 'Chronic disease proxy', weight: 0.3 },
      { signal: 'Repeat visits', weight: 0.29 },
      { signal: 'Local supply gap', weight: 0.2 },
    ],
  },
];

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

function normalizeTreatment(value: string) {
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

function toInsertValues(updatedAt: string) {
  const values: unknown[] = [];
  const tuples = demoRecommendations.map((row, index) => {
    const base = index * 22;
    const distanceSavedKm = Math.max(row.currentDistanceKm - row.recommendedDistanceKm, 0);
    const burdenReduction =
      row.currentDistanceKm > 0 ? Math.round((distanceSavedKm / row.currentDistanceKm) * 1000) / 10 : 0;

    values.push(
      row.id,
      row.treatment,
      row.originRegion,
      row.originState,
      row.destinationFacilityId,
      row.destinationFacilityName,
      row.destinationCity,
      row.destinationState,
      row.destinationCountry,
      row.demandScore,
      row.estimatedPeopleAffected,
      row.currentDistanceKm,
      row.recommendedDistanceKm,
      distanceSavedKm,
      burdenReduction,
      row.priorityScore,
      row.whyRegion,
      row.whyFacility,
      JSON.stringify(row.topContributingSignals),
      'demo_seed',
      'python.facility_prioritization.v1',
      updatedAt,
    );

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}::jsonb, $${base + 20}, $${base + 21}, $${base + 22})`;
  });

  return { tuples, values };
}

async function seedDemoRecommendations(appkit: AppKitWithLakebaseAndServer, replaceExisting: boolean) {
  const updatedAt = new Date().toISOString();
  const { tuples, values } = toInsertValues(updatedAt);

  if (replaceExisting) {
    await appkit.lakebase.query(`DELETE FROM ${RECOMMENDATIONS_TABLE} WHERE snapshot_mode = 'demo_seed'`);
  }

  await appkit.lakebase.query(
    `
      INSERT INTO ${RECOMMENDATIONS_TABLE} (
        id,
        treatment,
        origin_region,
        origin_state,
        destination_facility_id,
        destination_facility_name,
        destination_city,
        destination_state,
        destination_country,
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
        destination_facility_id = EXCLUDED.destination_facility_id,
        destination_facility_name = EXCLUDED.destination_facility_name,
        destination_city = EXCLUDED.destination_city,
        destination_state = EXCLUDED.destination_state,
        destination_country = EXCLUDED.destination_country,
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
  );

  return { loadedRows: demoRecommendations.length, updatedAt };
}

async function ensureRecommendationsSchema(appkit: AppKitWithLakebaseAndServer) {
  if (process.env.ENABLE_LAKEBASE_BOOTSTRAP === '0') {
    console.log('[lakebase] Skipping prioritization schema bootstrap because ENABLE_LAKEBASE_BOOTSTRAP=0');
    return;
  }

  await appkit.lakebase.query(CREATE_SCHEMA_SQL);
  await appkit.lakebase.query(CREATE_RECOMMENDATIONS_TABLE_SQL);
  await appkit.lakebase.query(ALTER_RECOMMENDATIONS_COORDINATES_SQL);
  await appkit.lakebase.query(CREATE_RECOMMENDATIONS_INDEXES_SQL);

  const existing = await appkit.lakebase.query(`
    SELECT COUNT(*)::int AS count
    FROM ${RECOMMENDATIONS_TABLE}
  `);

  if (asNumber(existing.rows[0]?.count) === 0) {
    await seedDemoRecommendations(appkit, false);
  }

  console.log('[lakebase] Shuttle recommendation schema ready');
}

async function getRecommendationSummary(appkit: AppKitWithLakebaseAndServer) {
  const result = await appkit.lakebase.query(`
    SELECT
      COUNT(*)::int AS total_recommendations,
      COUNT(DISTINCT treatment)::int AS treatments,
      COALESCE(SUM(estimated_people_affected), 0)::int AS estimated_people_affected,
      COALESCE(ROUND(AVG(transportation_burden_reduction_pct)::numeric, 1), 0)::float AS average_burden_reduction_pct,
      MAX(updated_at) AS latest_updated_at
    FROM ${RECOMMENDATIONS_TABLE}
  `);

  const topResult = await appkit.lakebase.query(`
    SELECT
      treatment,
      origin_region,
      origin_state,
      destination_facility_name,
      priority_score
    FROM ${RECOMMENDATIONS_TABLE}
    ORDER BY priority_score DESC
    LIMIT 1
  `);

  const summary = result.rows[0] ?? {};
  const top = topResult.rows[0] ?? null;

  return {
    totalRecommendations: asNumber(summary.total_recommendations),
    treatments: asNumber(summary.treatments),
    estimatedPeopleAffected: asNumber(summary.estimated_people_affected),
    averageBurdenReductionPct: asNumber(summary.average_burden_reduction_pct),
    latestUpdatedAt: summary.latest_updated_at ?? null,
    topRecommendation: top,
  };
}

async function getTreatmentOptions(appkit: AppKitWithLakebaseAndServer) {
  const result = await appkit.lakebase.query(`
    SELECT
      treatment AS value,
      COUNT(*)::int AS count,
      COALESCE(ROUND(AVG(priority_score)::numeric, 1), 0)::float AS average_priority_score,
      COALESCE(SUM(estimated_people_affected), 0)::int AS estimated_people_affected
    FROM ${RECOMMENDATIONS_TABLE}
    GROUP BY treatment
    ORDER BY average_priority_score DESC, value ASC
  `);

  return {
    treatments: result.rows.map((row) => ({
      value: asString(row.value),
      count: asNumber(row.count),
      averagePriorityScore: asNumber(row.average_priority_score),
      estimatedPeopleAffected: asNumber(row.estimated_people_affected),
    })),
  };
}

async function listRecommendations(appkit: AppKitWithLakebaseAndServer, rawQuery: unknown) {
  const query = isRecord(rawQuery) ? rawQuery : {};
  const parsed = RecommendationQuery.parse({
    treatment: getSingleValue(query.treatment),
    limit: getSingleValue(query.limit ?? '12'),
    maxDistanceSavedKm:
      query.maxDistanceSavedKm === undefined ? undefined : getSingleValue(query.maxDistanceSavedKm),
  });

  const treatment = normalizeTreatment(parsed.treatment);
  const params: unknown[] = [];
  const whereParts: string[] = [];

  if (treatment) {
    params.push(treatment);
    whereParts.push(`treatment = $${params.length}`);
  }

  if (typeof parsed.maxDistanceSavedKm === 'number') {
    params.push(parsed.maxDistanceSavedKm);
    whereParts.push(`distance_saved_km <= $${params.length}`);
  }

  params.push(parsed.limit);
  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const result = await appkit.lakebase.query(
    `
      SELECT
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
        top_contributing_signals::text AS top_contributing_signals,
        snapshot_mode,
        source_pipeline_version,
        updated_at
      FROM ${RECOMMENDATIONS_TABLE}
      ${whereSql}
      ORDER BY priority_score DESC, distance_saved_km DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return {
    treatment: parsed.treatment,
    recommendations: result.rows,
  };
}

function handlePrioritizationError(
  res: { status(code: number): { json(payload: unknown): void } },
  error: unknown,
) {
  if (isMissingTableError(error)) {
    res.status(503).json({
      error: 'Shuttle recommendations are not loaded yet.',
      guidance: 'Deploy the app once so the service principal can initialize the Lakebase schema.',
    });
    return;
  }

  console.error('[lakebase] Prioritization route error:', error);
  res.status(500).json({ error: 'Failed to query shuttle recommendations.' });
}

export async function setupPrioritizationRoutes(appkit: AppKitWithLakebaseAndServer) {
  try {
    await ensureRecommendationsSchema(appkit);
  } catch (error) {
    console.warn('[lakebase] Prioritization schema setup failed:', error);
  }

  appkit.server.extend((app) => {
    app.get('/api/prioritization/summary', async (_req, res) => {
      try {
        res.json(await getRecommendationSummary(appkit));
      } catch (error) {
        handlePrioritizationError(res, error);
      }
    });

    app.get('/api/prioritization/treatments', async (_req, res) => {
      try {
        res.json(await getTreatmentOptions(appkit));
      } catch (error) {
        handlePrioritizationError(res, error);
      }
    });

    app.get('/api/prioritization/recommendations', async (req, res) => {
      try {
        res.json(await listRecommendations(appkit, req.query as Record<string, unknown>));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ error: 'Invalid recommendation query parameters.' });
          return;
        }
        handlePrioritizationError(res, error);
      }
    });

    app.post('/api/prioritization/refresh-demo', async (_req, res) => {
      try {
        res.json(await seedDemoRecommendations(appkit, true));
      } catch (error) {
        handlePrioritizationError(res, error);
      }
    });
  });
}
