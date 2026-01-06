/**
 * ENERGY CONSUMPTION PREDICTION SYSTEM
 * 
 * Uses AWS-style run-rate formulas to predict:
 * 1. Today's total energy from hourly data
 * 2. This month's total energy from daily data
 * 
 * NO Machine Learning - Pure mathematical projection
 */

const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const ROLLING_WINDOW_HOURS = 6; // Use last 6 hours for rolling average
const MIN_HOURS_REQUIRED = 3; // Minimum hours needed for day prediction
const MIN_DAYS_REQUIRED = 3; // Minimum days needed for month prediction

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all CSV files from the directory matching date pattern
 */
function getAllCSVFiles() {
  const files = fs.readdirSync(__dirname);
  return files.filter(file => 
    file.endsWith('.csv') && 
    file.match(/^\d{4}-\d{2}-\d{2}\.csv$/) // Match YYYY-MM-DD.csv format
  ).sort(); // Sort to process in date order
}

/**
 * Get number of days in a given month
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Parse CSV file manually (no external dependencies)
 * Returns array of parsed rows
 */
function readCSV(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim() !== '');
  
  // Parse header
  const headers = lines[0].split(',').map(h => h.trim());
  
  // Parse data rows
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ? values[index].trim() : '';
    });
    data.push(row);
  }
  
  return data;
}

/**
 * Read all CSV files and combine data
 */
function readAllCSVFiles() {
  const csvFiles = getAllCSVFiles();
  
  if (csvFiles.length === 0) {
    throw new Error('No CSV files found in YYYY-MM-DD.csv format');
  }
  
  console.log(`   Found ${csvFiles.length} CSV file(s): ${csvFiles.join(', ')}`);
  
  let allData = [];
  
  csvFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    const fileData = readCSV(filePath);
    allData = allData.concat(fileData);
  });
  
  return allData;
}

/**
 * Group data by meter_id
 */
function groupByMeter(data) {
  const grouped = {};
  data.forEach(row => {
    const meterId = row.meter_id;
    if (!grouped[meterId]) {
      grouped[meterId] = [];
    }
    grouped[meterId].push(row);
  });
  return grouped;
}

/**
 * Parse timestamp and extract hour
 */
function parseTimestamp(timestamp) {
  // Format: "YYYY-MM-DD HH:mm:ss"
  const parts = timestamp.split(' ');
  const datePart = parts[0];
  const timePart = parts[1];
  
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: datePart,
    time: timePart,
    fullDate: new Date(year, month - 1, day, hour, minute, second)
  };
}

// ============================================
// CORE PREDICTION FUNCTIONS
// ============================================

/**
 * Calculate hourly energy consumption from minute-level data
 * Groups by hour and sums the energy_consumed_kwh
 */
function calculateHourlyTotals(meterData) {
  const hourlyData = {};
  
  meterData.forEach(row => {
    const timestamp = parseTimestamp(row.timestamp);
    const hourKey = `${timestamp.date} ${String(timestamp.hour).padStart(2, '0')}:00`;
    
    if (!hourlyData[hourKey]) {
      hourlyData[hourKey] = {
        timestamp: hourKey,
        hour: timestamp.hour,
        date: timestamp.date,
        energyKwh: 0,
        count: 0
      };
    }
    
    // Sum the energy consumed (each minute's consumption)
    const energyConsumed = parseFloat(row.energy_consumed_kwh) || 0;
    hourlyData[hourKey].energyKwh += energyConsumed;
    hourlyData[hourKey].count++;
  });
  
  // Convert to array and sort by timestamp
  return Object.values(hourlyData).sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );
}

/**
 * Calculate daily totals from hourly data
 */
function calculateDailyTotals(hourlyData) {
  const dailyData = {};
  
  hourlyData.forEach(hour => {
    const date = hour.date;
    
    if (!dailyData[date]) {
      dailyData[date] = {
        date: date,
        energyKwh: 0,
        hoursCount: 0
      };
    }
    
    dailyData[date].energyKwh += hour.energyKwh;
    dailyData[date].hoursCount++;
  });
  
  // Convert to array and sort by date
  return Object.values(dailyData).sort((a, b) => 
    a.date.localeCompare(b.date)
  );
}

/**
 * HOUR → DAY PREDICTION
 * 
 * AWS-Style Formula:
 * predicted_today_kwh = (sum_energy_so_far / hours_passed) * 24
 * 
 * With rolling average enhancement to reduce spike impact
 */
function predictToday(hourlyData) {
  if (hourlyData.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of data. Currently have ${hourlyData.length} hour(s).`
    };
  }
  
  // Get today's date (from the latest hour)
  const todayDate = hourlyData[hourlyData.length - 1].date;
  
  // Filter only today's hours
  const todayHours = hourlyData.filter(h => h.date === todayDate);
  
  if (todayHours.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of today's data. Currently have ${todayHours.length} hour(s).`
    };
  }
  
  // Calculate total energy consumed so far today
  const totalEnergyToday = todayHours.reduce((sum, h) => sum + h.energyKwh, 0);
  const hoursPassedToday = todayHours.length;
  
  // BASIC AWS FORMULA: (total so far / hours passed) * 24
  const basicPrediction = (totalEnergyToday / hoursPassedToday) * 24;
  
  // ENHANCED: Use rolling average of last N hours to reduce spike impact
  const rollingWindowSize = Math.min(ROLLING_WINDOW_HOURS, todayHours.length);
  const recentHours = todayHours.slice(-rollingWindowSize);
  const recentAverage = recentHours.reduce((sum, h) => sum + h.energyKwh, 0) / recentHours.length;
  const rollingPrediction = recentAverage * 24;
  
  return {
    success: true,
    date: todayDate,
    hoursPassedToday: hoursPassedToday,
    totalEnergyToday: totalEnergyToday,
    basicPrediction: basicPrediction,
    rollingPrediction: rollingPrediction,
    rollingWindowUsed: rollingWindowSize,
    averageHourlyRate: totalEnergyToday / hoursPassedToday,
    recentHourlyRate: recentAverage
  };
}

/**
 * DAY → MONTH PREDICTION
 * 
 * AWS-Style Formula:
 * predicted_month_kwh = (sum_daily_energy_so_far / days_passed) * days_in_month
 */
function predictMonth(dailyData) {
  if (dailyData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of data. Currently have ${dailyData.length} day(s).`
    };
  }
  
  // Get current month and year from latest day
  const latestDate = dailyData[dailyData.length - 1].date;
  const [year, month, day] = latestDate.split('-').map(Number);
  
  // Filter only current month's data
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthData = dailyData.filter(d => d.date.startsWith(currentMonthPrefix));
  
  if (monthData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of current month's data. Currently have ${monthData.length} day(s).`
    };
  }
  
  // Calculate total energy consumed this month so far
  const totalEnergyMonth = monthData.reduce((sum, d) => sum + d.energyKwh, 0);
  const daysPassedMonth = monthData.length;
  
  // Get number of days in current month
  const daysInCurrentMonth = getDaysInMonth(year, month);
  
  // AWS FORMULA: (total so far / days passed) * days in month
  const predictedMonthKwh = (totalEnergyMonth / daysPassedMonth) * daysInCurrentMonth;
  const averageDailyRate = totalEnergyMonth / daysPassedMonth;
  
  return {
    success: true,
    year: year,
    month: month,
    daysPassedMonth: daysPassedMonth,
    daysInCurrentMonth: daysInCurrentMonth,
    totalEnergyMonth: totalEnergyMonth,
    predictedMonthKwh: predictedMonthKwh,
    averageDailyRate: averageDailyRate,
    percentMonthComplete: (daysPassedMonth / daysInCurrentMonth * 100).toFixed(1)
  };
}

// ============================================
// MAIN EXECUTION
// ============================================

function main() {
  console.log('\n==============================================');
  console.log('  ENERGY CONSUMPTION PREDICTION SYSTEM');
  console.log('  AWS-Style Run-Rate Forecasting');
  console.log('==============================================\n');
  
  // Read all CSV files
  console.log(`📊 Reading data from all CSV files...\n`);
  
  let data;
  try {
    data = readAllCSVFiles();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return;
  }
  console.log(`   Total records: ${data.length}`);
  
  // Group by meter
  const meterGroups = groupByMeter(data);
  const meterIds = Object.keys(meterGroups);
  console.log(`   Meters found: ${meterIds.join(', ')}\n`);
  
  // Process each meter separately
  meterIds.forEach((meterId, index) => {
    console.log(`\n${'='.repeat(46)}`);
    console.log(`  METER: ${meterId}`);
    console.log(`${'='.repeat(46)}\n`);
    
    const meterData = meterGroups[meterId];
    
    // Step 1: Calculate hourly totals from minute-level data
    const hourlyData = calculateHourlyTotals(meterData);
    console.log(`✅ Processed ${hourlyData.length} hours of data\n`);
    
    // Step 2: HOUR → DAY PREDICTION
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📈 TODAY\'S PREDICTION (Hour → Day)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const todayResult = predictToday(hourlyData);
    
    if (todayResult.success) {
      console.log(`   Date: ${todayResult.date}`);
      console.log(`   Hours of data available: ${todayResult.hoursPassedToday} hours`);
      console.log(`   Energy consumed so far: ${todayResult.totalEnergyToday.toFixed(2)} kWh\n`);
      
      console.log(`   📊 FORMULA (Basic AWS Style):`);
      console.log(`   predicted_today = (${todayResult.totalEnergyToday.toFixed(2)} kWh / ${todayResult.hoursPassedToday} hours) × 24 hours`);
      console.log(`   predicted_today = ${todayResult.averageHourlyRate.toFixed(2)} kWh/hour × 24`);
      console.log(`   ➜ Basic Prediction: ${todayResult.basicPrediction.toFixed(2)} kWh\n`);
      
      console.log(`   📊 FORMULA (Rolling Average - Last ${todayResult.rollingWindowUsed} hours):`);
      console.log(`   predicted_today = ${todayResult.recentHourlyRate.toFixed(2)} kWh/hour × 24 hours`);
      console.log(`   ➜ Rolling Prediction: ${todayResult.rollingPrediction.toFixed(2)} kWh (Recommended)\n`);
      
      console.log(`   💡 Status: ESTIMATED`);
      console.log(`      (Accuracy improves as more hours pass)\n`);
    } else {
      console.log(`   ⚠️  ${todayResult.message}\n`);
    }
    
    // Step 3: Calculate daily totals
    const dailyData = calculateDailyTotals(hourlyData);
    
    // Step 4: DAY → MONTH PREDICTION
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📈 THIS MONTH\'S PREDICTION (Day → Month)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const monthResult = predictMonth(dailyData);
    
    if (monthResult.success) {
      const monthName = new Date(monthResult.year, monthResult.month - 1).toLocaleString('en-US', { month: 'long' });
      
      console.log(`   Month: ${monthName} ${monthResult.year}`);
      console.log(`   Days of data available: ${monthResult.daysPassedMonth} / ${monthResult.daysInCurrentMonth} days (${monthResult.percentMonthComplete}% complete)`);
      console.log(`   Energy consumed so far: ${monthResult.totalEnergyMonth.toFixed(2)} kWh\n`);
      
      console.log(`   📊 FORMULA (AWS Style):`);
      console.log(`   predicted_month = (${monthResult.totalEnergyMonth.toFixed(2)} kWh / ${monthResult.daysPassedMonth} days) × ${monthResult.daysInCurrentMonth} days`);
      console.log(`   predicted_month = ${monthResult.averageDailyRate.toFixed(2)} kWh/day × ${monthResult.daysInCurrentMonth}`);
      console.log(`   ➜ Predicted Month Total: ${monthResult.predictedMonthKwh.toFixed(2)} kWh\n`);
      
      console.log(`   💡 Status: ESTIMATED`);
      console.log(`      (Accuracy improves as more days pass)\n`);
    } else {
      console.log(`   ⚠️  ${monthResult.message}\n`);
    }
    
    // Summary for this meter
    if (todayResult.success && monthResult.success) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  📋 SUMMARY');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(`   ✓ Today's Projected Total: ${todayResult.rollingPrediction.toFixed(2)} kWh`);
      console.log(`   ✓ Month's Projected Total: ${monthResult.predictedMonthKwh.toFixed(2)} kWh\n`);
    }
  });
  
  // Final notes
  console.log('\n==============================================');
  console.log('  📝 ACCURACY NOTES');
  console.log('==============================================\n');
  console.log('  • Predictions use AWS-style run-rate formula');
  console.log('  • Rolling average (last 6 hours) reduces spike impact');
  console.log('  • Accuracy improves as more data becomes available');
  console.log('  • Early morning predictions may be less accurate');
  console.log('  • Monthly predictions stabilize after 5-7 days');
  console.log('  • No machine learning - pure mathematical projection\n');
  
  console.log('==============================================\n');
}

// Run the program
main();
