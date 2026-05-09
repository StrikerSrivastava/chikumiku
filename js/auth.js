/* ============================================================
   auth.js — Password Gate + AES-256-GCM Encryption
   ============================================================
   Exports:
     unlock()          — called by lock screen button
     lockApp()         — called by Lock Now button
     changePassword()  — called by Setup tab
     encrypt(text, pwd)   → base64 ciphertext
     decrypt(b64, pwd)    → plaintext  (throws on wrong pwd)
     sessionPwd           — in-memory only, never persisted
   ============================================================ */

/* ── CRYPTO HELPERS ── */

async function deriveKey(pwd, salt) {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pwd),
    'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encrypt(plain, pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(pwd, salt);
  const enc  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plain)
  );
  const out = new Uint8Array(28 + enc.byteLength);
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(enc), 28);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(b64, pwd) {
  const d   = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await deriveKey(pwd, d.slice(0, 16));
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: d.slice(16, 28) },
    key, d.slice(28)
  );
  return new TextDecoder().decode(dec);
}

async function hashPwd(pwd) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode('upsc27' + pwd)
  );
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/* ── SESSION PASSWORD — in-memory only ── */
let sessionPwd = '';

/* ── UNLOCK ── */
async function unlock() {
  const pwd = document.getElementById('lockPassword').value;
  if (!pwd) { showLockError('Enter your password.'); return; }

  const btn = document.getElementById('lockBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const stored = localStorage.getItem('upsc_h');

    if (!stored) {
      // First ever unlock — any password becomes THE password
      localStorage.setItem('upsc_h', await hashPwd(pwd));
      sessionPwd = pwd;
      await openApp();
      return;
    }

    if (await hashPwd(pwd) !== stored) {
      document.querySelector('.lock-box').classList.add('shake');
      setTimeout(() => document.querySelector('.lock-box').classList.remove('shake'), 400);
      showLockError('Incorrect password. Try again.');
      btn.disabled = false;
      btn.textContent = 'Unlock';
      document.getElementById('lockPassword').value = '';
      document.getElementById('lockPassword').focus();
      return;
    }

    sessionPwd = pwd;
    await openApp();

  } catch (e) {
    showLockError('Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

/* ── OPEN APP ── */
async function openApp() {
  document.getElementById('lockScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Decrypt GitHub config
  try {
    const raw = localStorage.getItem('upsc_cfg_enc');
    if (raw) {
      const dec = await decrypt(raw, sessionPwd);
      Object.assign(window.cfg, JSON.parse(dec));
    }
  } catch (e) {
    window.cfg = { username: '', notesRepo: 'upsc-notes' };
  }

  // Load local notes cache
  try {
    const nc = localStorage.getItem('upsc_nc');
    if (nc) window.notes = JSON.parse(nc);
  } catch (e) {
    window.notes = [];
  }

  updateUI();
  renderNotes();

  if (window.cfg.token && window.cfg.username) {
    loadAllNotesFromGitHub();
  }
}

/* ── LOCK ── */
function lockApp() {
  sessionPwd = '';
  window.cfg = { username: '', notesRepo: 'upsc-notes' };
  window.notes = [];
  document.getElementById('app').style.display = 'none';
  document.getElementById('lockScreen').style.display = 'flex';
  document.getElementById('lockPassword').value = '';
  const sb = document.getElementById('syncBar');
  if (sb) sb.style.display = 'none';
}

/* ── CHANGE PASSWORD ── */
async function changePassword() {
  const cur  = document.getElementById('currentPwd').value;
  const nw   = document.getElementById('newPwd').value;
  const conf = document.getElementById('confirmPwd').value;

  if (nw !== conf) { setPwdStatus('error', 'Passwords do not match.'); return; }
  if (nw.length < 6) { setPwdStatus('error', 'Minimum 6 characters.'); return; }

  const stored = localStorage.getItem('upsc_h');
  if (stored && await hashPwd(cur) !== stored) {
    setPwdStatus('error', 'Current password is wrong.'); return;
  }

  setPwdStatus('loading', '<span class="spinner"></span>Re-encrypting...');

  try {
    if (window.cfg.token) {
      const enc = await encrypt(JSON.stringify(window.cfg), nw);
      localStorage.setItem('upsc_cfg_enc', enc);
    }
    localStorage.setItem('upsc_h', await hashPwd(nw));
    sessionPwd = nw;
    document.getElementById('currentPwd').value = '';
    document.getElementById('newPwd').value = '';
    document.getElementById('confirmPwd').value = '';
    setPwdStatus('success', '&#10003; Password updated successfully.');
  } catch (e) {
    setPwdStatus('error', e.message);
  }
}

/* ── UI HELPERS ── */
function showLockError(msg) {
  const el = document.getElementById('lockError');
  el.textContent = msg;
  el.style.display = 'block';
}

function setPwdStatus(type, msg) {
  const el = document.getElementById('pwdStatus');
  if (!el) return;
  const colors = { success: '#5a9a5a', error: '#c85a5a', loading: '#c8953a' };
  el.style.color = colors[type] || 'var(--muted)';
  el.innerHTML = msg;
}

/* ── KEYBOARD HANDLER ── */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('lockPassword');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') unlock();
      const err = document.getElementById('lockError');
      if (err) err.style.display = 'none';
    });
    input.focus();
  }
});
