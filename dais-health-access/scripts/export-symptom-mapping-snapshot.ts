import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';

const PROFILE = process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
const ENDPOINT = process.env.LAKEBASE_ENDPOINT;
const HOST = process.env.PGHOST;
const DATABASE = process.env.PGDATABASE;
const PORT = Number(process.env.PGPORT || '5432');
const APP_TABLE = 'app_data.symptom_mappings';
const OUTPUT_FILE = process.argv[2] || process.env.SYMPTOM_MAPPING_FILE || 'outputs/symptom_mapping.csv';

interface CurrentUserResponse {
  userName: string;
}

interface TokenResponse {
  token: string;
}

interface SymptomMappingRecord {
  treatment: string;
  justification: string;
  selected_signal_count: number;
  mapping_source: string;
  model: string | null;
  updated_at: string;
  signal_mapping: Record<string, number>;
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

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  const text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeOutputs(records: SymptomMappingRecord[]) {
  if (records.length === 0) {
    throw new Error(`No rows found in ${APP_TABLE}.`);
  }

  const signalColumns = Array.from(
    new Set(records.flatMap((record) => Object.keys(record.signal_mapping))),
  ).sort();
  const rows = records.map((record) => ({
    treatment: record.treatment,
    reasoning: record.justification,
    justification: record.justification,
    selected_signal_count: record.selected_signal_count,
    mapping_source: record.mapping_source,
    model: record.model,
    updated_at: record.updated_at,
    ...Object.fromEntries(signalColumns.map((column) => [column, Number(record.signal_mapping[column] || 0)])),
  }));

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });

  if (OUTPUT_FILE.endsWith('.json')) {
    writeFileSync(OUTPUT_FILE, `${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  const columns = [
    'treatment',
    'reasoning',
    'justification',
    'selected_signal_count',
    'mapping_source',
    'model',
    'updated_at',
    ...signalColumns,
  ];
  const csv = [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column as keyof typeof row])).join(',')),
  ].join('\n');

  writeFileSync(OUTPUT_FILE, `${csv}\n`);
}

async function main() {
  const pool = getConnectionPool();

  try {
    const result = await pool.query<SymptomMappingRecord>(`
      SELECT
        treatment,
        justification,
        selected_signal_count,
        mapping_source,
        model,
        updated_at::text,
        signal_mapping
      FROM ${APP_TABLE}
      ORDER BY treatment
    `);
    writeOutputs(result.rows);
    console.log(`Exported ${result.rows.length} symptom mappings from ${APP_TABLE} to ${OUTPUT_FILE}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
