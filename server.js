// OXOKE File Downloader - Activation Server v1.0.0
// Deploy on Render: https://render.com (free tier)
// Repo: https://github.com/YOUR_USERNAME/oxoke-downloader-server

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const crypto  = require('crypto');

const app        = express();
const PORT       = process.env.PORT || 3000;
const DATA_FILE  = path.join(__dirname, 'data.json');
const TRIAL_FILE = path.join(__dirname, 'trials.json');
const ADMIN_KEY  = process.env.ADMIN_KEY || 'oxoke_dl_admin_2025';

app.use(cors());
app.use(express.json());

// ============================================================
// DATA HELPERS
// ============================================================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = path.join(__dirname, 'codes_seed.json');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, DATA_FILE);
    else fs.writeFileSync(DATA_FILE, JSON.stringify({ activation_codes: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(d)  { fs.writeFileSync(DATA_FILE,  JSON.stringify(d, null, 2)); }

function loadTrials() {
  if (!fs.existsSync(TRIAL_FILE))
    fs.writeFileSync(TRIAL_FILE, JSON.stringify({ used_pcs: {} }, null, 2));
  return JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf-8'));
}
function saveTrials(d) { fs.writeFileSync(TRIAL_FILE, JSON.stringify(d, null, 2)); }

function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
}

function msFuture(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function generateTrialKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (n) => Array.from({length:n},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `TRIAL-${seg(5)}-${seg(5)}`;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({ status: 'OXOKE File Downloader Server Running', version: '1.0.0', time: new Date().toISOString() });
});

// ============================================================
// POST /api/get-trial
// একটি PC তে একবার মাত্র 2-hour free trial
// ============================================================
app.post('/api/get-trial', (req, res) => {
  const { pc_fingerprint } = req.body;
  if (!pc_fingerprint)
    return res.status(400).json({ success: false, message: 'Missing pc_fingerprint' });

  const hashedPc = hashId(pc_fingerprint);
  const trials   = loadTrials();

  if (trials.used_pcs[hashedPc]) {
    const prev = trials.used_pcs[hashedPc];
    // Trial এখনও active?
    if (new Date(prev.expiry).getTime() > Date.now()) {
      return res.json({
        success: true, key: prev.key, expiry: prev.expiry,
        message: 'Trial reactivated (still active).'
      });
    }
    // Expired — আর দেওয়া হবে না
    return res.status(403).json({
      success: false,
      message: 'Free trial already used on this PC. Purchase a license: +880 1811-507607'
    });
  }

  // নতুন trial — 2 hours
  const trialKey = generateTrialKey();
  const expiry   = msFuture(2 * 60 * 60 * 1000);

  trials.used_pcs[hashedPc] = {
    key: trialKey, expiry, created: new Date().toISOString()
  };
  saveTrials(trials);

  return res.json({
    success: true, key: trialKey, expiry,
    type: 'trial', message: '✓ Trial activated! 2 hours of free downloading.'
  });
});

// ============================================================
// POST /api/activate
// Monthly key — PC-locked
// ============================================================
app.post('/api/activate', (req, res) => {
  const { code, pc_fingerprint } = req.body;
  if (!code || !pc_fingerprint)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  const nc       = code.toUpperCase().trim();
  const hashedPc = hashId(pc_fingerprint);
  const data     = loadData();
  const cd       = data.activation_codes[nc];

  if (!cd)       return res.status(404).json({ success: false, message: 'Invalid key. Contact: +880 1811-507607' });
  if (!cd.active) return res.status(403).json({ success: false, message: 'This key is disabled. Contact: +880 1811-507607' });

  if (cd.expiry && new Date(cd.expiry).getTime() < Date.now())
    return res.status(403).json({ success: false, message: 'This key has expired. Purchase a new one: +880 1811-507607' });

  if (!cd.locked_pc) {
    cd.locked_pc    = hashedPc;
    cd.activated_at = new Date().toISOString();
    if (!cd.expiry) {
      const ms = cd.expiry_ms || ((cd.expiry_days || 30) * 24 * 60 * 60 * 1000);
      cd.expiry = msFuture(ms);
    }
    saveData(data);
    return res.json({ success: true, type: 'monthly', expiry: cd.expiry, message: '✓ Activation successful!' });
  }

  if (cd.locked_pc === hashedPc)
    return res.json({ success: true, type: 'monthly', expiry: cd.expiry, message: 'License verified.' });

  return res.status(403).json({
    success: false, message: 'Key already activated on another PC. Contact: +880 1811-507607'
  });
});

// ============================================================
// POST /api/verify
// ============================================================
app.post('/api/verify', (req, res) => {
  const { code, pc_fingerprint } = req.body;
  if (!code || !pc_fingerprint) return res.json({ valid: false });

  const nc = code.toUpperCase().trim();

  if (nc.startsWith('TRIAL-')) {
    const hashedPc = hashId(pc_fingerprint);
    const trials   = loadTrials();
    const entry    = trials.used_pcs[hashedPc];
    if (!entry || entry.key !== nc) return res.json({ valid: false });
    const valid = new Date(entry.expiry).getTime() > Date.now();
    return res.json({ valid, expiry: entry.expiry, type: 'trial' });
  }

  const hashedPc = hashId(pc_fingerprint);
  const data     = loadData();
  const cd       = data.activation_codes[nc];
  if (!cd || !cd.active) return res.json({ valid: false });
  if (cd.locked_pc !== hashedPc) return res.json({ valid: false });
  const valid = !cd.expiry || new Date(cd.expiry).getTime() > Date.now();
  return res.json({ valid, expiry: cd.expiry, type: 'monthly' });
});

// ============================================================
// ADMIN — Key Management
// ============================================================
function checkAdmin(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// List all codes
app.get('/admin/codes', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const out  = {};
  for (const [code, info] of Object.entries(data.activation_codes)) {
    const expired = info.expiry && new Date(info.expiry).getTime() < Date.now();
    out[code] = {
      active:       info.active,
      locked:       info.locked_pc ? '✓ PC Locked' : '○ Available',
      expiry:       info.expiry || 'Not activated yet',
      expiry_label: info.expiry_label || '30 days',
      expired:      !!expired,
      created:      info.created,
      activated_at: info.activated_at || null
    };
  }
  res.json({ total: Object.keys(out).length, codes: out });
});

// List trials
app.get('/admin/trials', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const trials = loadTrials();
  const count  = Object.keys(trials.used_pcs).length;
  const active = Object.values(trials.used_pcs).filter(t => new Date(t.expiry).getTime() > Date.now()).length;
  res.json({ total_trials: count, active_trials: active, data: trials.used_pcs });
});

// Add new code
app.post('/admin/add-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { code, expiry_days, expiry_ms, expiry_label } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  const data = loadData();
  const nc   = code.toUpperCase().trim();
  if (data.activation_codes[nc]) return res.status(409).json({ error: 'Code already exists' });
  const ms = expiry_ms || ((expiry_days || 30) * 24 * 60 * 60 * 1000);
  data.activation_codes[nc] = {
    active: true, locked_pc: null, expiry: null,
    expiry_ms: ms,
    expiry_label: expiry_label || (Math.round(ms/86400000) + ' days'),
    created: new Date().toISOString().split('T')[0]
  };
  saveData(data);
  res.json({ success: true, code: nc, expiry_label: expiry_label || Math.round(ms/86400000) + ' days' });
});

// Disable code
app.post('/admin/disable-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc   = (req.body.code || '').toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].active = false;
  saveData(data);
  res.json({ success: true });
});

// Enable code
app.post('/admin/enable-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc   = (req.body.code || '').toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].active = true;
  saveData(data);
  res.json({ success: true });
});

// Reset code (PC unlock করো, নতুন PC তে activate করা যাবে)
app.post('/admin/reset-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc   = (req.body.code || '').toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  data.activation_codes[nc].locked_pc    = null;
  data.activation_codes[nc].expiry       = null;
  data.activation_codes[nc].activated_at = null;
  saveData(data);
  res.json({ success: true, message: `${nc} reset. Can be activated on a new PC.` });
});

// Delete code
app.post('/admin/delete-code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const data = loadData();
  const nc   = (req.body.code || '').toUpperCase().trim();
  if (!data.activation_codes[nc]) return res.status(404).json({ error: 'Not found' });
  delete data.activation_codes[nc];
  saveData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OXOKE Downloader Server v1.0.0 running on port ${PORT}`);
  console.log(`✅ Admin key: ${ADMIN_KEY}`);
  console.log(`✅ Endpoints: /api/get-trial, /api/activate, /api/verify`);
  console.log(`✅ Admin: /admin/codes, /admin/add-code, /admin/reset-code`);
});
