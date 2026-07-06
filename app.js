const express = require('express');
const app = express();

// Transaction data
const transactionData = {
    "server": {
        "inetnum": "193.150.166.0/24 193.150.166.0/243",
        "netname": "DEUTDESS604",
        "served_by": "DEUTSCHE BANK AG - TAUNUSANLAGE 12, 60325 FRANKFURT AM MAIN, GERMANY",
        "global_server_ip": "193.150.166.0/24",
        "server_type": "S2S UPLOAD FORMAT - SWIFT CRYPTOHOST M1 FIN - CEF ENCODING UTF-8",
        "logon_server": "27C DB FR DE 17BEH",
        "internet_server_id": "db.com2=ebankingdb2;db.com=ebbankingdb=SRV1"
    },
    "farm_name": "FARM 42",
    "transfer_type": "S2S - FIN MT 103 - M1 FUNDS",
    "header": {
        "transaction_date": "2025-06-02",
        "transaction_time": "10:01:23",
        "transaction_code": "144A:S:G4639DVY8",
        "transfer_code": "DE4403840938483950495",
        "reference_code": "DEUT56323524814238",
        "unique_transaction": "DEUT997856743216"
    },
    "fund_currency": "EURO",
    "benficiary": {
        "dtc_amount_balance": 5993828116,
        "bank_name": "DEUTSCHE BANK AG",
        "bank_address": "TAUNUSANLAGE 12, 60325 FRANKFURT AM MAIN, GERMANY",
        "bank_swift_code": "DEUTDEDBXXX",
        "company_name": "KRONENTHAL GMBH",
        "company_address": "SCHORNDORFERSTR. 78, D-71638 LUDWIGSBURG, GERMANY",
        "company_reg_no": "HRB 753776",
        "account_number": "0065434300",
        "iban_number": "DE96604700820065434300",
        "account_name": "KRONENTHAL GMBH",
        "account_type": "EURO",
        "common_account_number": "947259564",
        "created_at": "2025-06-02T10:01:23+01:00"
    },
    "transaction_hash": {
        "sha-256": "2a316db32007ac56cc46ba677c5fc4cf11f3662da4ea75d97cc949ff76282327"
    }
};

// ── Health check (no whitelist) ───────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ── Main API endpoint ─────────────────────────────────────────────────────────

app.get('/api/db.com/funds/getData', (req, res) => {
    const transactionCode = req.query.transaction_code;
    const details = String(req.query.details || '').toLowerCase();
    const wantsDetails = ['1', 'true', 'yes', 'on'].includes(details);

    if (transactionCode !== 'DEUT997856743216') {
        return res.status(404).json({
            error: 'Not Found',
            message: 'Transaction not found'
        });
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    console.log(`[SUCCESS] IP: ${clientIp} | Transaction: ${transactionCode} | Origin: ${req.headers.origin || 'none'}`);

    // Inject freshness timestamp on every request
    const response = wantsDetails
        ? { ...transactionData, last_accessed_at: new Date().toISOString() }
        : { header: transactionData.header, fund_currency: transactionData.fund_currency, last_accessed_at: new Date().toISOString() };

    return res.json(response);
});

// ── DON-1 mint-icusd status ───────────────────────────────────────────────────

app.get('/don-1/mint-icusd', (req, res) => {
    res.json({
        status: true,
        lastPolledTimestamp: new Date().toISOString()
    });
});

// ── DON-4 euro-cash-reserves ──────────────────────────────────────────────────

app.get('/don-4/euro-cash-reserves', (req, res) => {
    const benficiary = transactionData.benficiary;
    const header = transactionData.header;

    const transactionDateTime = new Date(`${header.transaction_date}T${header.transaction_time}Z`);
    const lockedTillDate = new Date(transactionDateTime);
    lockedTillDate.setFullYear(transactionDateTime.getFullYear() + 30);

    res.json({
        "fund_currency": transactionData.fund_currency,
        "euro-cash-reserve": benficiary.dtc_amount_balance.toString(),
        "locked-till": lockedTillDate.toISOString().replace('T', ' ').substring(0, 19),
        "transaction_date": header.transaction_date,
        "transaction_time": header.transaction_time,
        "transaction_code": header.transaction_code,
        "transfer_code": header.transfer_code,
        "reference_code": header.reference_code,
        "dtc_amount_balance": benficiary.dtc_amount_balance,
        "bank_name": benficiary.bank_name,
        "bank_address": benficiary.bank_address,
        "bank_swift_code": benficiary.bank_swift_code,
        "company_name": benficiary.company_name,
        "account_number": benficiary.account_number,
        "iban_number": benficiary.iban_number,
        "account_name": benficiary.account_name,
        "lastPolledTimestamp": new Date().toISOString()
    });
});

// ── DON-3 PM2 logs (mock endpoint for dashboard) ──────────────────────────────

app.get('/api/don3/logs', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (token !== '886296c2-df0a-41a5-891b-fdc6ed984175') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    res.json({
        logs: [
            { source: 'don2.js', level: 'info', message: 'API polling cycle complete — data verified' },
            { source: 'PM2', level: 'info', message: 'App [don2] online — pid 28471, uptime 4d 12h' },
            { source: 'don2.js', level: 'success', message: 'DON-4 sync check passed — minting enabled' },
        ]
    });
});

// ── 404 & error handlers ──────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT}`);
});
