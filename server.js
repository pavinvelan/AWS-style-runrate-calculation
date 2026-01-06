/**
 * SIMPLE HTTP SERVER FOR ENERGY PREDICTION DASHBOARD
 * 
 * Serves the HTML dashboard and provides API endpoint for predictions
 * No external dependencies - uses only Node.js built-in modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Import prediction logic from index.js
const ROLLING_WINDOW_HOURS = 6;
const MIN_HOURS_REQUIRED = 3;
const MIN_DAYS_REQUIRED = 3;

// ============================================
// PREDICTION FUNCTIONS (from index.js)
// ============================================

/**
 * Get all CSV files from the directory
 */
function getAllCSVFiles() {
  const files = fs.readdirSync(__dirname);
  return files.filter(file => 
    file.endsWith('.csv') && 
    file.match(/^\d{4}-\d{2}-\d{2}\.csv$/) // Match YYYY-MM-DD.csv format
  ).sort(); // Sort to process in date order
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function readCSV(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim() !== '');
  
  const headers = lines[0].split(',').map(h => h.trim());
  
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
  
  console.log(`Found ${csvFiles.length} CSV file(s): ${csvFiles.join(', ')}`);
  
  let allData = [];
  
  csvFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    const fileData = readCSV(filePath);
    allData = allData.concat(fileData);
  });
  
  console.log(`Total records loaded: ${allData.length}`);
  return allData;
}

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

function parseTimestamp(timestamp) {
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
    
    const energyConsumed = parseFloat(row.energy_consumed_kwh) || 0;
    hourlyData[hourKey].energyKwh += energyConsumed;
    hourlyData[hourKey].count++;
  });
  
  return Object.values(hourlyData).sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );
}

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
  
  return Object.values(dailyData).sort((a, b) => 
    a.date.localeCompare(b.date)
  );
}

function predictToday(hourlyData) {
  if (hourlyData.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of data. Currently have ${hourlyData.length} hour(s).`
    };
  }
  
  const todayDate = hourlyData[hourlyData.length - 1].date;
  const todayHours = hourlyData.filter(h => h.date === todayDate);
  
  if (todayHours.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of today's data. Currently have ${todayHours.length} hour(s).`
    };
  }
  
  const totalEnergyToday = todayHours.reduce((sum, h) => sum + h.energyKwh, 0);
  const hoursPassedToday = todayHours.length;
  
  const basicPrediction = (totalEnergyToday / hoursPassedToday) * 24;
  
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

function predictMonth(dailyData) {
  if (dailyData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of data. Currently have ${dailyData.length} day(s).`
    };
  }
  
  const latestDate = dailyData[dailyData.length - 1].date;
  const [year, month, day] = latestDate.split('-').map(Number);
  
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthData = dailyData.filter(d => d.date.startsWith(currentMonthPrefix));
  
  if (monthData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of current month's data. Currently have ${monthData.length} day(s).`
    };
  }
  
  const totalEnergyMonth = monthData.reduce((sum, d) => sum + d.energyKwh, 0);
  const daysPassedMonth = monthData.length;
  const daysInCurrentMonth = getDaysInMonth(year, month);
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

function getPredictions() {
  const data = readAllCSVFiles();
  const meterGroups = groupByMeter(data);
  const meterIds = Object.keys(meterGroups);
  
  const results = {
    totalRecords: data.length,
    meters: []
  };
  
  meterIds.forEach(meterId => {
    const meterData = meterGroups[meterId];
    const hourlyData = calculateHourlyTotals(meterData);
    const dailyData = calculateDailyTotals(hourlyData);
    
    const todayResult = predictToday(hourlyData);
    const monthResult = predictMonth(dailyData);
    
    results.meters.push({
      meterId: meterId,
      hoursProcessed: hourlyData.length,
      today: todayResult,
      month: monthResult
    });
  });
  
  return results;
}

// ============================================
// HTTP SERVER
// ============================================

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Handle API endpoint
  if (req.url === '/api/predict') {
    try {
      const predictions = getPredictions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(predictions));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Serve HTML dashboard
  if (req.url === '/' || req.url === '/dashboard.html') {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    fs.readFile(htmlPath, 'utf-8', (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }
  
  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('\n==============================================');
  console.log('  ⚡ ENERGY PREDICTION DASHBOARD SERVER');
  console.log('==============================================\n');
  console.log(`  🌐 Server running at: http://localhost:${PORT}`);
  console.log(`  📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  🔌 API Endpoint: http://localhost:${PORT}/api/predict`);
  console.log('\n  Press Ctrl+C to stop the server\n');
  console.log('==============================================\n');
});
