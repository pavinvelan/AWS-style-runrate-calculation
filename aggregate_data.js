/**
 * DATA AGGREGATION SCRIPT
 * 
 * Pre-processes raw CSV files into monthly summary files
 * Run this once per month to create aggregated data
 * 
 * Benefits:
 * - Reduces 89,000+ records to ~100-1000 aggregated records
 * - 50-100x faster forecast calculations
 * - Only needs to run once when new month's data is complete
 */

const fs = require('fs');
const path = require('path');

/**
 * Get all CSV files for a specific month
 */
function getCSVFilesForMonth(year, month) {
  const monthStr = String(month).padStart(2, '0');
  const pattern = `${year}-${monthStr}`;
  
  const files = fs.readdirSync(__dirname);
  return files.filter(file => 
    file.endsWith('.csv') && 
    file.startsWith(pattern)
  ).sort();
}

/**
 * Read CSV file
 */
function readCSVOptimized(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const meterIdIdx = headers.indexOf('meter_id');
  const timestampIdx = headers.indexOf('timestamp');
  const energyIdx = headers.indexOf('energy_consumed_kwh');
  
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',');
    if (values.length <= Math.max(meterIdIdx, timestampIdx, energyIdx)) continue;
    
    data.push({
      meter_id: values[meterIdIdx].trim(),
      timestamp: values[timestampIdx].trim(),
      energy: parseFloat(values[energyIdx]) || 0
    });
  }
  
  return data;
}

/**
 * Aggregate data by meter and date
 */
function aggregateMonthData(year, month) {
  console.log(`Aggregating data for ${year}-${String(month).padStart(2, '0')}...`);
  const startTime = Date.now();
  
  const files = getCSVFilesForMonth(year, month);
  
  if (files.length === 0) {
    throw new Error(`No CSV files found for ${year}-${month}`);
  }
  
  console.log(`Found ${files.length} files`);
  
  const aggregates = {};
  let totalRecords = 0;
  
  files.forEach((file, idx) => {
    console.log(`Processing ${file} (${idx + 1}/${files.length})...`);
    const filePath = path.join(__dirname, file);
    const data = readCSVOptimized(filePath);
    
    totalRecords += data.length;
    
    data.forEach(row => {
      const date = row.timestamp.split(' ')[0];
      const meterId = row.meter_id;
      
      const key = `${meterId}|${date}`;
      
      if (!aggregates[key]) {
        aggregates[key] = {
          meter_id: meterId,
          date: date,
          total_kwh: 0,
          record_count: 0
        };
      }
      
      aggregates[key].total_kwh += row.energy;
      aggregates[key].record_count++;
    });
  });
  
  const processingTime = Date.now() - startTime;
  
  console.log(`\nAggregation complete:`);
  console.log(`- Processed ${totalRecords} records`);
  console.log(`- Created ${Object.keys(aggregates).length} aggregated entries`);
  console.log(`- Reduction: ${((1 - Object.keys(aggregates).length / totalRecords) * 100).toFixed(1)}%`);
  console.log(`- Processing time: ${processingTime}ms`);
  
  return {
    year: year,
    month: month,
    aggregates: Object.values(aggregates),
    metadata: {
      total_records_processed: totalRecords,
      aggregated_entries: Object.keys(aggregates).length,
      files_processed: files.length,
      processing_time_ms: processingTime,
      created_at: new Date().toISOString()
    }
  };
}

/**
 * Save aggregated data
 */
function saveAggregatedData(data) {
  const filename = `aggregated_${data.year}_${String(data.month).padStart(2, '0')}.json`;
  const filePath = path.join(__dirname, filename);
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`\nSaved to: ${filename}`);
  
  return filename;
}

/**
 * Aggregate all available months
 */
function aggregateAllMonths() {
  const files = fs.readdirSync(__dirname);
  const csvFiles = files.filter(file => 
    file.endsWith('.csv') && 
    file.match(/^\d{4}-\d{2}-\d{2}\.csv$/)
  );
  
  if (csvFiles.length === 0) {
    throw new Error('No CSV files found');
  }
  
  // Extract unique year-month combinations
  const months = new Set();
  csvFiles.forEach(file => {
    const [year, month] = file.split('-').slice(0, 2);
    months.add(`${year}-${month}`);
  });
  
  console.log(`Found data for ${months.size} month(s)\n`);
  
  const results = [];
  
  Array.from(months).sort().forEach(monthKey => {
    const [year, month] = monthKey.split('-').map(Number);
    
    try {
      const aggregated = aggregateMonthData(year, month);
      const filename = saveAggregatedData(aggregated);
      results.push({ monthKey, filename, success: true });
      console.log('─'.repeat(50));
    } catch (error) {
      console.error(`Error processing ${monthKey}:`, error.message);
      results.push({ monthKey, success: false, error: error.message });
    }
  });
  
  return results;
}

// ============================================
// CLI EXECUTION
// ============================================

if (require.main === module) {
  console.log('========================================');
  console.log('DATA AGGREGATION TOOL');
  console.log('========================================\n');
  
  const args = process.argv.slice(2);
  
  if (args.length === 2) {
    // Aggregate specific month
    const year = parseInt(args[0]);
    const month = parseInt(args[1]);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      console.error('Usage: node aggregate_data.js [year month] or no args for all months');
      console.error('Example: node aggregate_data.js 2025 1');
      process.exit(1);
    }
    
    try {
      const data = aggregateMonthData(year, month);
      saveAggregatedData(data);
    } catch (error) {
      console.error('ERROR:', error.message);
      process.exit(1);
    }
  } else {
    // Aggregate all months
    try {
      const results = aggregateAllMonths();
      
      console.log('\n========================================');
      console.log('AGGREGATION SUMMARY');
      console.log('========================================');
      
      const successful = results.filter(r => r.success).length;
      console.log(`Total: ${results.length} month(s)`);
      console.log(`Success: ${successful}`);
      console.log(`Failed: ${results.length - successful}`);
      
      console.log('\n✓ Aggregated files ready for fast forecasting!');
      
    } catch (error) {
      console.error('ERROR:', error.message);
      process.exit(1);
    }
  }
}

module.exports = {
  aggregateMonthData,
  aggregateAllMonths,
  saveAggregatedData
};
