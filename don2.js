const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
const port = 3025;

app.use(cors({
 origin: (origin, callback) => {
   const allowedOrigins = ['https://infinnity.capital', 'https://mint.infinnity.capital', 'https://infinnity-capital.netlify.app/', 'http://localhost:3000'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(cors());

// PostgreSQL connection
const pool = new Pool({
  user: 'funds_user',
  host: 'localhost',
  database: 'funds_db',
  password: 'ProjRusd@191514',
  port: 5432,
});

// API configuration
const API_URL = 'https://api.infinnity.capital/api/db.com/funds/getData?transaction_code=DEUT997856743216&details=true';

// Store initial data for comparison
let initialData = null;
let lastPolledTimestamp = null;
let initialDtcAmountBalance = null;

// Database setup
async function setupDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS current_funds (
        id SERIAL PRIMARY KEY,
        server_data JSONB NOT NULL,
        farm_name VARCHAR(50),
        transfer_type VARCHAR(50),
        header JSONB NOT NULL,
        fund_currency VARCHAR(10),
        benficiary JSONB NOT NULL,
        transaction_hash JSONB NOT NULL,
        last_accessed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS historical_funds (
        id SERIAL PRIMARY KEY,
        server_data JSONB NOT NULL,
        farm_name VARCHAR(50),
        transfer_type VARCHAR(50),
        header JSONB NOT NULL,
        fund_currency VARCHAR(10),
        benficiary JSONB NOT NULL,
        transaction_hash JSONB NOT NULL,
        last_accessed_at TIMESTAMP,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error setting up database:', error);
  }
}

// Fetch data from API
async function fetchApiData() {
  try {
    const response = await axios.get(API_URL);
    console.log('API Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error fetching API data:', error);
    return null;
  }
}

// Store data in current table
async function storeCurrentData(data) {
  try {
    const query = `
      INSERT INTO current_funds (
        server_data, farm_name, transfer_type, header, 
        fund_currency, benficiary, transaction_hash, last_accessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) 
      DO UPDATE SET 
        server_data = $1,
        farm_name = $2,
        transfer_type = $3,
        header = $4,
        fund_currency = $5,
        benficiary = $6,
        transaction_hash = $7,
        last_accessed_at = $8
    `;
    
    await pool.query(query, [
      data.server,
      data.farm_name,
      data.transfer_type,
      data.header,
      data.fund_currency,
      data.benficiary,
      data.transaction_hash,
      data.last_accessed_at
    ]);
  } catch (error) {
    console.error('Error storing current data:', error);
  }
}

// Store historical data
async function storeHistoricalData() {
  try {
    const currentData = await pool.query('SELECT * FROM current_funds LIMIT 1');
    if (currentData.rows.length > 0) {
      const data = currentData.rows[0];
      await pool.query(`
        INSERT INTO historical_funds (
          server_data, farm_name, transfer_type, header,
          fund_currency, benficiary, transaction_hash, last_accessed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        data.server_data,
        data.farm_name,
        data.transfer_type,
        data.header,
        data.fund_currency,
        data.benficiary,
        data.transaction_hash,
        data.last_accessed_at
      ]);
    }
  } catch (error) {
    console.error('Error storing historical data:', error);
  }
}

// Compare data excluding last_accessed_at
function compareData(initial, current) {
  const initialCopy = { ...initial };
  const currentCopy = { ...current };
  
  delete initialCopy.last_accessed_at;
  delete currentCopy.last_accessed_at;
  
  return JSON.stringify(initialCopy) === JSON.stringify(currentCopy);
}

// Main polling function
async function pollApi() {
  const data = await fetchApiData();
  if (!data) return;

  await storeCurrentData(data);

  if (!initialData) {
    initialData = { ...data };
    initialDtcAmountBalance = data.benficiary.dtc_amount_balance;
  }
  lastPolledTimestamp = new Date();
  console.log('Data polled and stored:', new Date());
}

// API endpoint to check data consistency
app.get('/don-1/mint-icusd', async (req, res) => {
  const currentData = await fetchApiData();
  if (!currentData || !initialData) {
    res.json({ 
       status: false, 
       message: 'No data available',
       lastPolledTimestamp: lastPolledTimestamp ? lastPolledTimestamp.toISOString() : null
 });
    return;
  }
  
  const isSame = compareData(initialData, currentData);
  res.json({ 
      status: isSame,
      lastPolledTimestamp: lastPolledTimestamp ? lastPolledTimestamp.toISOString() : null
 });
});

// API endpoint to check Euro Cash Reserves
app.get('/don-4/euro-cash-reserves', async (req, res) => {
  const currentData = await fetchApiData();
  if (!currentData || !currentData.benficiary || !initialDtcAmountBalance) {
    res.json({
      "fund_currency": null,
      "euro-cash-reserve": null,
      "locked-till": "",
      "transaction_date": null,
      "transaction_time": null,
      "transaction_code": null,
      "transfer_code": null,
      "reference_code": null,
      "dtc_amount_balance": null,
      "bank_name": null,
      "bank_address": null,
      "bank_swift_code": null,
      "company_name": null,
      "account_number": null,
      "iban_number": null,
      "account_name": null,
      "lastPolledTimestamp": lastPolledTimestamp ? lastPolledTimestamp.toISOString() : null
    });
    return;
  }

  // Fetch current dtc_amount_balance
  const currentDtcAmountBalance = currentData.benficiary.dtc_amount_balance;

  // Calculate locked-till date (30 years from transaction_date and transaction_time)
  const transactionDateTime = new Date(`${currentData.header.transaction_date}T${currentData.header.transaction_time}Z`);
  const lockedTillDate = new Date(transactionDateTime);
  lockedTillDate.setFullYear(transactionDateTime.getFullYear() + 30);

  // Return response with all requested parameters
  res.json({
    "fund_currency": currentData.fund_currency,
    "euro-cash-reserve": currentDtcAmountBalance.toString(), 
    "locked-till": lockedTillDate.toISOString().replace('T', ' ').substring(0, 19), // Format as "YYYY-MM-DD HH:MM:SS"
    "transaction_date": currentData.header.transaction_date,
    "transaction_time": currentData.header.transaction_time, 
    "transaction_code": currentData.header.transaction_code, 
    "transfer_code": currentData.header.transfer_code,
    "reference_code": currentData.header.reference_code, 
    "dtc_amount_balance": currentDtcAmountBalance, 
    "bank_name": currentData.benficiary.bank_name, 
    "bank_address": currentData.benficiary.bank_address, 
    "bank_swift_code": currentData.benficiary.bank_swift_code, 
    "company_name": currentData.benficiary.company_name, 
    "account_number": currentData.benficiary.account_number, 
    "iban_number": currentData.benficiary.iban_number, 
    "account_name": currentData.benficiary.account_name, 
    "lastPolledTimestamp": lastPolledTimestamp ? lastPolledTimestamp.toISOString() : null 
  });
});

// Initialize and start
async function start() {
  await setupDatabase();
  
  // Initial fetch
  await pollApi();
  
  // Poll every 15 seconds
  setInterval(pollApi, 15000);
  
  // Store historical data every 12 hours
  cron.schedule('0 */12 * * *', storeHistoricalData);
  
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

start().catch(console.error);
