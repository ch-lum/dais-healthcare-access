import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Pool } from 'pg';

const PROFILE = process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
const ENDPOINT = process.env.LAKEBASE_ENDPOINT;
const HOST = process.env.PGHOST;
const DATABASE = process.env.PGDATABASE;
const PORT = Number(process.env.PGPORT || '5432');
const APP_TABLE = 'app_data.symptom_mappings';
const INPUT_FILE = process.argv[2] || process.env.SYMPTOM_MAPPING_FILE || 'outputs/symptom_mapping.json';

interface CurrentUserResponse {
  userName: string;
}

interface TokenResponse {
  token: string;
}

interface SymptomMappingRow {
  treatment: string;
  reasoning?: string | null;
  justification?: string | null;
  selected_signal_count?: number | string | null;
  survey_signal?: string | null;
  weight?: number | string | null;
  direction?: number | string | null;
  confidence?: number | string | null;
  rationale?: string | null;
  mapping_source?: string | null;
  model?: string | null;
  updated_at?: string | null;
  [signal: string]: unknown;
}

interface SymptomMappingRecord {
  treatment: string;
  justification: string;
  selectedSignalCount: number;
  mappingSource: string;
  model: string | null;
  updatedAt: string;
  signalMapping: Record<string, unknown>;
}

const METADATA_COLUMNS = new Set([
  'treatment',
  'reasoning',
  'justification',
  'selected_signal_count',
  'survey_signal',
  'weight',
  'direction',
  'confidence',
  'rationale',
  'mapping_source',
  'model',
  'updated_at',
  'weighted_direction',
]);

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
      'Missing Lakebase connection settings. Run this command from the app directory after the scaffolded .env file exists.'
    );
  }
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

function readMappingRows() {
  const payload = JSON.parse(readFileSync(INPUT_FILE, 'utf8')) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error(`Expected ${INPUT_FILE} to contain a JSON array of symptom mapping rows.`);
  }

  return payload as SymptomMappingRow[];
}

function toInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric === 1 ? 1 : 0;
}

function toNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toDirection(value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['lower', 'low', 'negative', '-1', 'inverse'].includes(normalized)) {
      return -1;
    }
    if (['higher', 'high', 'positive', '1', 'direct'].includes(normalized)) {
      return 1;
    }
  }

  return toNumber(value, 1) < 0 ? -1 : 1;
}

function isContinuousMappingRows(rows: SymptomMappingRow[]) {
  return rows.some((row) => row.survey_signal && row.weight !== undefined);
}

function extractSignalMapping(row: SymptomMappingRow) {
  const signalMapping: Record<string, number> = {};

  for (const [key, value] of Object.entries(row)) {
    if (METADATA_COLUMNS.has(key)) {
      continue;
    }
    signalMapping[key] = toInteger(value);
  }

  return signalMapping;
}

function buildBinaryRecords(rows: SymptomMappingRow[]) {
  return rows.map((row) => {
    const signalMapping = extractSignalMapping(row);
    return {
      treatment: row.treatment,
      justification: row.justification || row.reasoning || 'No mapping justification provided.',
      selectedSignalCount: Number(
        row.selected_signal_count ?? Object.values(signalMapping).filter((value) => value === 1).length
      ),
      mappingSource: row.mapping_source || 'openai',
      model: row.model || null,
      updatedAt: row.updated_at || new Date().toISOString(),
      signalMapping,
    };
  });
}

function buildContinuousRecords(rows: SymptomMappingRow[]) {
  const records = new Map<string, SymptomMappingRecord>();

  for (const row of rows) {
    const treatment = String(row.treatment || '').trim();
    const signal = String(row.survey_signal || '').trim();
    if (!treatment || !signal) {
      continue;
    }

    const record = records.get(treatment) || {
      treatment,
      justification: row.justification || row.reasoning || 'Continuous weighted symptom mapping.',
      selectedSignalCount: 0,
      mappingSource: row.mapping_source || 'openai_continuous',
      model: row.model || null,
      updatedAt: row.updated_at || new Date().toISOString(),
      signalMapping: {},
    };

    record.signalMapping[signal] = {
      weight: Math.min(Math.max(toNumber(row.weight, 0), 0), 1),
      direction: toDirection(row.direction),
      confidence: Math.min(Math.max(toNumber(row.confidence, 0.5), 0), 1),
      rationale: row.rationale || row.justification || '',
    };
    record.selectedSignalCount = Object.keys(record.signalMapping).length;
    records.set(treatment, record);
  }

  return Array.from(records.values());
}

async function ensureAppTableExists(pool: Pool) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS app_data');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${APP_TABLE} (
      treatment TEXT PRIMARY KEY,
      justification TEXT NOT NULL,
      selected_signal_count INTEGER NOT NULL,
      mapping_source TEXT NOT NULL,
      model TEXT,
      updated_at TIMESTAMPTZ NOT NULL,
      signal_mapping JSONB NOT NULL
    )
  `);
}

function buildInsertStatement(records: SymptomMappingRecord[]) {
  const values: unknown[] = [];
  const tuples = records.map((record, index) => {
    const base = index * 7;

    values.push(
      record.treatment,
      record.justification,
      record.selectedSignalCount,
      record.mappingSource,
      record.model,
      record.updatedAt,
      JSON.stringify(record.signalMapping)
    );

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb)`;
  });

  return {
    text: `
      INSERT INTO ${APP_TABLE} (
        treatment,
        justification,
        selected_signal_count,
        mapping_source,
        model,
        updated_at,
        signal_mapping
      ) VALUES
      ${tuples.join(',\n')}
      ON CONFLICT (treatment) DO UPDATE SET
        justification = EXCLUDED.justification,
        selected_signal_count = EXCLUDED.selected_signal_count,
        mapping_source = EXCLUDED.mapping_source,
        model = EXCLUDED.model,
        updated_at = EXCLUDED.updated_at,
        signal_mapping = EXCLUDED.signal_mapping
    `,
    values,
  };
}

async function main() {
  const rows = readMappingRows();
  if (rows.length === 0) {
    throw new Error(`No symptom mapping rows found in ${INPUT_FILE}.`);
  }
  const records = isContinuousMappingRows(rows) ? buildContinuousRecords(rows) : buildBinaryRecords(rows);
  if (records.length === 0) {
    throw new Error(`No valid symptom mapping records could be built from ${INPUT_FILE}.`);
  }

  console.log(`Loading ${records.length} symptom mappings from ${INPUT_FILE} using profile ${PROFILE}...`);
  const pool = getConnectionPool();
  let transactionStarted = false;

  try {
    await ensureAppTableExists(pool);
    const statement = buildInsertStatement(records);
    await pool.query('BEGIN');
    transactionStarted = true;
    await pool.query(`TRUNCATE TABLE ${APP_TABLE}`);
    await pool.query(statement.text, statement.values);
    await pool.query('COMMIT');
    transactionStarted = false;
    console.log(`Symptom mapping snapshot loaded into ${APP_TABLE}.`);
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
  console.error(error);
  process.exit(1);
});
