// Landa auth (main process). Owns the Supabase client, the encrypted session
// store, and the entitlement reads. The renderer never touches Supabase or any
// token — it talks to this module only over IPC (see preload.js / main.js).
//
// Login = magic link via a `landa://auth-callback` deep link (PKCE). The same
// deep-link handler will later back Google / Microsoft OAuth.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { safeStorage } = require('electron');
// supabase-js eagerly constructs its realtime client, which needs a global
// WebSocket. Electron's Node-20 main process has none, so polyfill with `ws`
// (we only use auth + REST — realtime is never opened). Must run before createClient.
if (!globalThis.WebSocket) globalThis.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Anon key is public by design (ships in every Supabase client; RLS is the
// security boundary). The service_role key is NOT here and never ships in the app.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lvxucmpfxdgozetqytto.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2eHVjbXBmeGRnb3pldHF5dHRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjcwMTAsImV4cCI6MjA5NTIwMzAxMH0.9HwBTZo9etxDaY2WCoWpGOcPPg5Nw100S0QHePkNtKc';

const REDIRECT_URL = 'landa://auth-callback';
const FREE_WORD_LIMIT = 2000; // strategy: Free = 2,000 words (reset cadence TBD; monthly for now)
const ENTITLEMENT_KEY = 'landa-entitlement-cache'; // offline cache, stored alongside the session

const STORE_PATH = path.join(os.homedir(), '.landa', 'auth.json');

// --- Encrypted key/value store backing supabase-js session persistence ---------
// supabase-js calls getItem/setItem/removeItem with string values. We keep them in
// memory and mirror to ~/.landa/auth.json, encrypted with the OS keychain via
// Electron safeStorage when available (falls back to a 0600 plaintext file otherwise).
function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (raw.enc) {
      if (!safeStorage.isEncryptionAvailable()) return {}; // can't decrypt → treat as signed out
      const json = safeStorage.decryptString(Buffer.from(raw.data, 'base64'));
      return JSON.parse(json);
    }
    return raw.data || {};
  } catch (e) {
    console.warn('[Landa] auth store load failed:', e.message);
    return {};
  }
}

function makeStore() {
  const mem = loadStore();
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      let envelope;
      if (safeStorage.isEncryptionAvailable()) {
        const buf = safeStorage.encryptString(JSON.stringify(mem));
        envelope = { enc: true, data: buf.toString('base64') };
      } else {
        envelope = { enc: false, data: mem };
      }
      fs.writeFileSync(STORE_PATH, JSON.stringify(envelope), { mode: 0o600 });
    } catch (e) {
      console.warn('[Landa] auth store persist failed:', e.message);
    }
  };
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = v; persist(); },
    removeItem: (k) => { delete mem[k]; persist(); },
  };
}

let client = null;
let store = null;
const listeners = new Set();

function notify(event, session) {
  for (const cb of listeners) {
    try { cb(event, session); } catch (e) { console.warn('[Landa] auth listener error:', e.message); }
  }
}

function init() {
  if (client) return client;
  store = makeStore();
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: store,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // no browser; we handle the deep-link callback ourselves
      flowType: 'pkce',
    },
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') store.removeItem(ENTITLEMENT_KEY);
    notify(event, session);
  });
  return client;
}

// --- Auth actions --------------------------------------------------------------
async function requestMagicLink(email) {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: REDIRECT_URL, shouldCreateUser: true },
  });
  return { ok: !error, error: error ? error.message : null };
}

// Called by main.js when the `landa://auth-callback?code=…` deep link arrives.
async function completeFromUrl(url) {
  let code;
  try { code = new URL(url).searchParams.get('code'); }
  catch { return { ok: false, error: 'malformed callback url' }; }
  if (!code) return { ok: false, error: 'no auth code in callback' };
  const { error } = await client.auth.exchangeCodeForSession(code);
  return { ok: !error, error: error ? error.message : null };
}

async function signOut() {
  const { error } = await client.auth.signOut();
  return { ok: !error, error: error ? error.message : null };
}

async function getSession() {
  const { data } = await client.auth.getSession();
  return data.session || null;
}

async function isSignedIn() {
  return (await getSession()) !== null;
}

// "Is this user Pro?" — reads public.profiles (RLS-protected). Caches the result so
// it survives offline; transcription is local, so a returning user is never blocked
// on network. The proxy enforces limits server-side next session; this read is UX.
async function getEntitlement() {
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await client
      .from('profiles').select('plan, team_id').eq('id', session.user.id).single();
    if (error) throw error;
    const ent = { plan: data.plan || 'free', teamId: data.team_id || null };
    store.setItem(ENTITLEMENT_KEY, JSON.stringify(ent));
    return ent;
  } catch (e) {
    const cached = store.getItem(ENTITLEMENT_KEY);
    if (cached) return JSON.parse(cached);
    return { plan: 'free', teamId: null }; // safe default if never fetched
  }
}

// Read-only word usage for the current period. The proxy is the authoritative
// WRITER (service role, next session) — the app only reads.
async function getUsage() {
  const session = await getSession();
  if (!session) return null;
  const now = new Date();
  const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  let wordsUsed = 0;
  try {
    const { data } = await client
      .from('usage').select('words_used')
      .eq('user_id', session.user.id).eq('period_start', periodStart).maybeSingle();
    wordsUsed = data ? data.words_used : 0;
  } catch (e) {
    console.warn('[Landa] usage read failed:', e.message);
  }
  return { wordsUsed, limit: FREE_WORD_LIMIT, periodStart };
}

// --- Payment seam (STUB) -------------------------------------------------------
// Live checkout is gated on forming the legal entity. When ready, this becomes a
// real Lemon Squeezy checkout URL (merchant of record) and a webhook flips
// profiles.plan = 'pro' — getEntitlement() then just works. Build right up to here.
async function startUpgrade() {
  return { status: 'not_available', reason: 'checkout_pending_legal_entity' };
}

function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

module.exports = {
  init, requestMagicLink, completeFromUrl, signOut,
  getSession, isSignedIn, getEntitlement, getUsage, startUpgrade, onChange,
  FREE_WORD_LIMIT,
};
