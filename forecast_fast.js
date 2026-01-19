/**
 * ULTRA-FAST FORECAST MODULE
 * 
 * Uses pre-aggregated data files for instant forecasting
 * Expected performance: < 50ms vs 5000ms+ with raw data
 */

const fs = require('fs');
const path = require('path');
const { fetchAggregatedMonthFromDb, fetchLatestAggregatedMonth } = require('./data_source');

/**
 * Load aggregated data for a specific month
 */
async function loadAggregatedMonth(year, month) {
  const filename = `aggregated_${year}_${String(month).padStart(2, '0')}.json`;
  const filePath = path.join(__dirname, filename);
  
  if (!fs.existsSync(filePath)) {
    return fetchAggregatedMonthFromDb(year, month);
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data;
}

/**
 * Find most recent aggregated data
 */
async function findMostRecentAggregatedData() {
  const files = fs.readdirSync(__dirname);
  const aggregatedFiles = files
    .filter(file => file.startsWith('aggregated_') && file.endsWith('.json'))
    .sort()
    .reverse();
  
  if (aggregatedFiles.length === 0) {
    return fetchLatestAggregatedMonth();
  }
  
  const latestFile = aggregatedFiles[0];
  const filePath = path.join(__dirname, latestFile);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
  return data;
}

/**
 * Ultra-fast forecast calculation
 */
function calculateFastForecast(aggregatedData, targetYear, targetMonth) {
  const startTime = Date.now();
  const daysInNextMonth = getDaysInMonth(targetYear, targetMonth);
  
  // Group by meter
  const meterData = {};
  
  aggregatedData.aggregates.forEach(entry => {
    const meterId = entry.meter_id;
    
    if (!meterData[meterId]) {
      meterData[meterId] = {
        dates: [],
        energies: [],
        total: 0
      };
    }
    
    meterData[meterId].dates.push(entry.date);
    meterData[meterId].energies.push(entry.total_kwh);
    meterData[meterId].total += entry.total_kwh;
  });
  
  // Calculate forecasts
  const forecasts = {};
  
  for (const meterId in meterData) {
    const data = meterData[meterId];
    const dayCount = data.energies.length;
    
    if (dayCount === 0) continue;
    
    // Simple average
    const avgDaily = data.total / dayCount;
    const simpleAvg = avgDaily * daysInNextMonth;
    
    // Recent trend (last 7 days)
    const recentDays = Math.min(7, dayCount);
    const recentEnergies = data.energies.slice(-recentDays);
    const recentTotal = recentEnergies.reduce((sum, val) => sum + val, 0);
    const recentAvg = recentTotal / recentDays;
    const recentForecast = recentAvg * daysInNextMonth;
    
    // Day-of-week pattern
    const dowPattern = Array(7).fill(0).map(() => ({ total: 0, count: 0 }));
    
    data.dates.forEach((date, idx) => {
      const [year, month, day] = date.split('-').map(Number);
      const dow = new Date(year, month - 1, day).getDay();
      dowPattern[dow].total += data.energies[idx];
      dowPattern[dow].count++;
    });
    
    const dowAvg = dowPattern.map(d => d.count > 0 ? d.total / d.count : avgDaily);
    
    let dowForecast = 0;
    for (let day = 1; day <= daysInNextMonth; day++) {
      const dow = new Date(targetYear, targetMonth - 1, day).getDay();
      dowForecast += dowAvg[dow];
    }
    
    // Weighted ensemble
    const forecast = simpleAvg * 0.3 + recentForecast * 0.4 + dowForecast * 0.3;
    
    forecasts[meterId] = {
      meter_id: meterId,
      forecast_kwh: forecast,
      avg_daily: avgDaily,
      recent_avg_daily: recentAvg,
      days_analyzed: dayCount,
      confidence: dayCount >= 20 ? 'high' : dayCount >= 10 ? 'medium' : 'low'
    };
  }
  
  const processingTime = Date.now() - startTime;
  
  return {
    forecasts: forecasts,
    processing_time_ms: processingTime,
    meter_count: Object.keys(forecasts).length
  };
}

/**
 * Get days in month
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Get month name
 */
function getMonthName(month) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1];
}

/**
 * Main forecast function
 */
async function generateFastForecast(options = {}) {
  console.log('Starting ultra-fast forecast...');
  const overallStart = Date.now();
  
  try {
    // Load most recent aggregated data
    const aggregatedData = options.year && options.month
      ? await loadAggregatedMonth(options.year, options.month)
      : await findMostRecentAggregatedData();
    
    if (!aggregatedData) {
      throw new Error('No aggregated data found. Run: node aggregate_data.js');
    }
    
    console.log(`Using data from: ${aggregatedData.year}-${String(aggregatedData.month).padStart(2, '0')}`);
    console.log(`Aggregated entries: ${aggregatedData.metadata.aggregated_entries}`);
    
    // Calculate next month based on the aggregated data period (not today's date)
    const sourceYear = aggregatedData.year;
    const sourceMonth = aggregatedData.month;
    const nextMonthRaw = sourceMonth + 1;
    const targetYear = nextMonthRaw > 12 ? sourceYear + 1 : sourceYear;
    const adjustedMonth = nextMonthRaw > 12 ? 1 : nextMonthRaw;
    
    // Generate forecast
    const result = calculateFastForecast(aggregatedData, targetYear, adjustedMonth);
    
    // Calculate total
    const totalForecast = Object.values(result.forecasts).reduce((sum, f) => sum + f.forecast_kwh, 0);
    
    const finalResult = {
      forecast_period: {
        year: targetYear,
        month: adjustedMonth,
        month_name: getMonthName(adjustedMonth),
        days_in_month: getDaysInMonth(targetYear, adjustedMonth)
      },
      total_forecast_kwh: totalForecast,
      meter_count: result.meter_count,
      per_meter_forecasts: result.forecasts,
      generation_info: {
        timestamp: new Date().toISOString(),
        processing_time_ms: Date.now() - overallStart,
        data_loading_time_ms: result.processing_time_ms,
        source_data: {
          year: aggregatedData.year,
          month: aggregatedData.month,
          records_analyzed: aggregatedData.metadata.aggregated_entries
        },
        optimization: 'ultra-fast (aggregated data)'
      }
    };
    
    console.log(`✓ Forecast completed in ${finalResult.generation_info.processing_time_ms}ms`);
    
    return finalResult;
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  generateFastForecast,
  loadAggregatedMonth,
  findMostRecentAggregatedData
};

// CLI execution
if (require.main === module) {
  console.log('========================================');
  console.log('ULTRA-FAST FORECAST (Aggregated Data)');
  console.log('========================================\n');
  
  (async () => {
    const forecast = await generateFastForecast();
    
    console.log('\n========================================');
    console.log('FORECAST SUMMARY');
    console.log('========================================');
    console.log(`Target: ${forecast.forecast_period.month_name} ${forecast.forecast_period.year}`);
    console.log(`Total Forecast: ${forecast.total_forecast_kwh.toFixed(2)} kWh`);
    console.log(`Meters: ${forecast.meter_count}`);
    console.log(`Processing Time: ${forecast.generation_info.processing_time_ms}ms ⚡`);
    console.log('========================================\n');
    
    const sorted = Object.values(forecast.per_meter_forecasts)
      .sort((a, b) => b.forecast_kwh - a.forecast_kwh)
      .slice(0, 5);
    
    console.log('Top 5 Predicted Consumers:');
    sorted.forEach((meter, idx) => {
      console.log(`${idx + 1}. Meter ${meter.meter_id}: ${meter.forecast_kwh.toFixed(2)} kWh (${meter.confidence})`);
    });
  })().catch(error => {
    console.error('\n❌ ERROR:', error.message);
    if (error.message.includes('No aggregated data')) {
      console.log('\n💡 Solution: Run data aggregation first:');
      console.log('   node aggregate_data.js');
    }
    process.exit(1);
  });
}
