/**
 * Database-backed data access layer for predictions/forecasts.
 * Replaces CSV reads with PostgreSQL queries using the provided config.
 */

require('dotenv').config();
const { Pool } = require('pg');

const dbConfig = {
  host: process.env.PGHOST || '192.168.0.137',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'ksr_meter',
  user: process.env.PGUSER || 'cubeai',
  password: process.env.PGPASSWORD || '123456'
};

const tableName = process.env.PG_TABLE || 'ksr-energy_meter';

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

const tableIdent = quoteIdent(tableName);

// Single shared pool
const pool = new Pool({
  ...dbConfig,
  max: 10,
  idleTimeoutMillis: 30_000
});

// Basic connectivity probe used at server startup
async function testDbConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

function formatTimestamp(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getMonthRange(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  // Use date strings to avoid timezone shifts when the DB casts parameters
  const start = `${year}-${pad(month)}-01`;
  const end = `${nextYear}-${pad(nextMonth)}-01`;
  return { start, end };
}

function getPreviousMonthRange(referenceDate = new Date()) {
  const ref = new Date(referenceDate);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  const prevMonth = month === 0 ? 12 : month;
  const targetYear = month === 0 ? year - 1 : year;
  return getMonthRange(targetYear, prevMonth);
}

function normalizeDateParam(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return value;
}

function extractYearMonth(startDate) {
  if (!startDate) return {};
  const d = new Date(`${startDate}T00:00:00Z`);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1
  };
}

async function fetchReadingsInRange(startDate, endDate, meterId) {
  const tsExpr = '"date" + "time"';
  const dateExpr = `DATE(${tsExpr})`;
  const conditions = [];
  const params = [];

  const startParam = normalizeDateParam(startDate);
  const endParam = normalizeDateParam(endDate);

  const { year, month } = extractYearMonth(startParam);
  if (year && month) {
    params.push(year, month);
    conditions.push(`EXTRACT(YEAR FROM ${dateExpr}) = $${params.length - 1}`);
    conditions.push(`EXTRACT(MONTH FROM ${dateExpr}) = $${params.length}`);
  }

  if (startParam) {
    params.push(startParam);
    conditions.push(`${dateExpr} >= $${params.length}`);
  }

  if (endParam) {
    params.push(endParam);
    conditions.push(`${dateExpr} < $${params.length}`);
  }

  if (meterId) {
    params.push(meterId);
    conditions.push(`meter_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT meter_id, ${tsExpr} AS ts, energy_consumed_kwh FROM ${tableIdent} ${where} ORDER BY ts ASC`;
  const { rows } = await pool.query(query, params);

  return rows.map((row) => ({
    meter_id: row.meter_id,
    timestamp: formatTimestamp(row.ts),
    energy_consumed_kwh: Number(row.energy_consumed_kwh)
  }));
}

async function fetchAllReadings() {
  return fetchReadingsInRange();
}

async function fetchDailyAggregates(startDate, endDate) {
  const startParam = normalizeDateParam(startDate);
  const endParam = normalizeDateParam(endDate);
  const { year, month } = extractYearMonth(startParam);

  const { rows } = await pool.query(
    `SELECT meter_id, DATE("date") AS date, SUM(energy_consumed_kwh) AS total_kwh, COUNT(*) AS record_count
     FROM ${tableIdent}
     WHERE (DATE(${quoteIdent('date')}) >= $1 AND DATE(${quoteIdent('date')}) < $2)
       ${year && month ? 'AND EXTRACT(YEAR FROM "date") = $3 AND EXTRACT(MONTH FROM "date") = $4' : ''}
     GROUP BY meter_id, DATE("date")
     ORDER BY meter_id, DATE("date") ASC`,
    year && month ? [startParam, endParam, year, month] : [startParam, endParam]
  );

  return rows.map((row) => ({
    meter_id: row.meter_id,
    date: row.date.toISOString().slice(0, 10),
    total_kwh: Number(row.total_kwh),
    record_count: Number(row.record_count)
  }));
}

async function fetchAggregatedMonthFromDb(year, month) {
  const { start, end } = getMonthRange(year, month);
  const aggregates = await fetchDailyAggregates(start, end);
  const metadata = {
    aggregated_entries: aggregates.length,
    files_processed: 0,
    processing_time_ms: 0,
    created_at: new Date().toISOString()
  };

  return { year, month, aggregates, metadata };
}

async function fetchLatestAggregatedMonth() {
  const { rows } = await pool.query(
    `SELECT date_trunc('month', MAX(${quoteIdent('date')})) AS month_start FROM ${tableIdent}`
  );

  if (!rows[0] || !rows[0].month_start) {
    throw new Error('No data found in database');
  }

  const monthStart = new Date(rows[0].month_start);
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth() + 1;
  const aggregated = await fetchAggregatedMonthFromDb(year, month);
  return aggregated;
}

async function fetchAvailableMonths() {
  const { rows } = await pool.query(
    `SELECT EXTRACT(YEAR FROM ${quoteIdent('date')}) AS year,
            EXTRACT(MONTH FROM ${quoteIdent('date')}) AS month,
            COUNT(*) AS record_count
     FROM ${tableIdent}
     GROUP BY 1, 2
     ORDER BY year DESC, month DESC`
  );

  return rows.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    records: Number(row.record_count)
  }));
}

async function fetchLatestMonthRange() {
  const { rows } = await pool.query(
    `SELECT MAX(${quoteIdent('date')}) AS latest_date FROM ${tableIdent}`
  );

  if (!rows[0] || !rows[0].latest_date) {
    throw new Error('No data found in database');
  }

  const latest = new Date(rows[0].latest_date);
  const year = latest.getUTCFullYear();
  const month = latest.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end, year, month: month + 1 };
}

module.exports = {
  dbConfig,
  tableName,
  pool,
  testDbConnection,
  fetchReadingsInRange,
  fetchAllReadings,
  fetchDailyAggregates,
  fetchAggregatedMonthFromDb,
  fetchLatestAggregatedMonth,
  fetchAvailableMonths,
  fetchLatestMonthRange,
  getMonthRange,
  getPreviousMonthRange,
  formatTimestamp
};
