/* ============================================================
   github.js — GitHub API Integration
   ============================================================
   Reads/writes to a PRIVATE GitHub repo.
   Each subject gets its own Markdown file:
     upsc-notes/
       notes/Polity.md
       notes/Modern-History.md
       notes/Geography.md
       ...etc

   Exports:
     connectGitHub()        — called by Setup tab Connect button
     disconnectGitHub()     — called by Setup tab Disconnect button
     syncAllNotes()         — called by Force Sync button
     loadAllNotesFromGitHub() — called on app open if connected
     pushSubjectNotes(subj) — called after each note save/delete
   ============================================================ */

/* ── GITHUB API HEADERS ── */
function ghHeaders() {
  return {
    'Authorization': 'token ' + window.cfg.token,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
}

/* ── GET FILE SHA (needed for updates) ── */
async function getFileSHA(path) {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${window.cfg.username}/${window.cfg.notesRepo}/contents/${path}`,
      { headers: ghHeaders() }
    );
    if (!r.ok) return null;
    return (await r.json()).sha || null;
  } catch (e) { return null; }
}

/* ── PUSH A FILE TO GITHUB ── */
async function pushFile(path, content, commitMsg) {
  const sha  = await getFileSHA(path);
  const body = {
    message: commitMsg,
    content: btoa(unescape(encodeURIComponent(content)))
  };
  if (sha) body.sha = sha;

  const r = await fetch(
    `https://api.github.com/repos/${window.cfg.username}/${window.cfg.notesRepo}/contents/${path}`,
    { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) }
  );
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.message || 'HTTP ' + r.status);
  }
  return r.json();
}

/* ── NOTES → MARKDOWN ── */
function notesToMarkdown(subject, subjectNotes) {
  const name = subject.replace(/-/g, ' ');
  let md = `# ${name} — UPSC Notes\n\n`;
  md += `> Auto-synced from UPSC Command Centre · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n---\n\n`;

  if (!subjectNotes.length) return md + '_No notes yet for this subject._\n';

  subjectNotes.forEach((n, i) => {
    md += `## ${i + 1}. ${n.title}\n\n`;
    md += `**Date:** ${n.date}\n\n`;
    md += `${n.body}\n\n---\n\n`;
  });
  return md;
}

/* ── MARKDOWN → NOTES (parse on load) ── */
function parseMarkdownNotes(md, subject) {
  const out = [];
  const sections = md.split(/^## /m).slice(1);

  for (const sec of sections) {
    const lines     = sec.trim().split('\n');
    const title     = lines[0].replace(/^\d+\.\s*/, '').trim();
    const dateLine  = lines.find(l => l.startsWith('**Date:**')) || '';
    const date      = dateLine.replace('**Date:**', '').trim();
    const bodyStart = lines.findIndex(l => l.startsWith('**Date:**')) + 1;
    const bodyEnd   = lines.findIndex((l, i) => i >= bodyStart && l.trim() === '---');
    const body      = lines.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined).join('\n').trim();

    if (title && body) {
      out.push({
        id: Date.now() + Math.random(),
        subject, title, body,
        date: date || new Date().toLocaleDateString('en-IN')
      });
    }
  }
  return out;
}

/* ── PUSH ONE SUBJECT ── */
async function pushSubjectNotes(subject) {
  const sn  = window.notes.filter(n => n.subject === subject);
  const md  = notesToMarkdown(subject, sn);
  const msg = `[UPSC] Update ${subject.replace(/-/g, ' ')} (${sn.length} notes)`;
  await pushFile(`notes/${subject}.md`, md, msg);
}

/* ── SYNC ALL ── */
async function syncAllNotes() {
  if (!window.cfg.token || !window.cfg.username) return;
  setSyncStatus('syncing', '<span class="spinner"></span>Syncing all notes to GitHub...');
  try {
    const subjects = [...new Set(window.notes.map(n => n.subject))];
    for (const s of subjects) await pushSubjectNotes(s);
    localStorage.setItem('upsc_nc', JSON.stringify(window.notes));
    setSyncStatus('synced', `&#11044; All notes synced &mdash; ${window.notes.length} notes &mdash; ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setSyncStatus('error', '&#10007; Sync failed: ' + e.message);
  }
}

/* ── LOAD ALL FROM GITHUB ── */
async function loadAllNotesFromGitHub() {
  if (!window.cfg.token || !window.cfg.username) return;
  setSyncStatus('syncing', '<span class="spinner"></span>Loading notes from GitHub...');
  try {
    const r = await fetch(
      `https://api.github.com/repos/${window.cfg.username}/${window.cfg.notesRepo}/contents/notes`,
      { headers: ghHeaders() }
    );

    if (r.status === 404) {
      setSyncStatus('synced', '&#11044; Connected &mdash; No notes yet. Start adding!');
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const files  = await r.json();
    const loaded = [];

    for (const f of files) {
      if (!f.name.endsWith('.md')) continue;
      const fr = await fetch(f.download_url);
      if (!fr.ok) continue;
      const text = await fr.text();
      loaded.push(...parseMarkdownNotes(text, f.name.replace('.md', '')));
    }

    if (loaded.length > 0 || window.notes.length === 0) {
      window.notes = loaded;
      localStorage.setItem('upsc_nc', JSON.stringify(window.notes));
    }

    renderNotes();
    setSyncStatus('synced', `&#11044; Synced &mdash; ${window.notes.length} notes loaded &mdash; ${new Date().toLocaleTimeString()}`);

  } catch (e) {
    setSyncStatus('error', '&#10007; Load failed: ' + e.message + ' (showing local cache)');
  }
}

/* ── CONNECT ── */
async function connectGitHub() {
  const username  = document.getElementById('inputUsername').value.trim();
  const token     = document.getElementById('inputToken').value.trim();
  const notesRepo = document.getElementById('inputNotesRepo').value.trim() || 'upsc-notes';

  if (!username) { setSetupStatus('error', 'Enter your GitHub username.'); return; }
  if (!token || token.includes('\u2022')) { setSetupStatus('error', 'Enter your GitHub token (ghp_...).'); return; }
  if (!sessionPwd) { setSetupStatus('error', 'No session password found. Lock and unlock again.'); return; }

  setSetupStatus('loading', '<span class="spinner"></span>Verifying with GitHub...');
  document.getElementById('connectBtn').disabled = true;

  try {
    // Verify token
    const ur = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!ur.ok) throw new Error('Invalid token or wrong permissions.');

    // Verify repo exists
    const rr = await fetch(`https://api.github.com/repos/${username}/${notesRepo}`, {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (rr.status === 404) throw new Error(`Repo "${username}/${notesRepo}" not found. Create it first on GitHub.`);
    if (!rr.ok) throw new Error('Cannot access repo. Ensure token scope includes "repo".');

    // Save encrypted config
    window.cfg = { token, username, notesRepo };
    const enc = await encrypt(JSON.stringify(window.cfg), sessionPwd);
    localStorage.setItem('upsc_cfg_enc', enc);

    // Push any existing local notes
    if (window.notes.length > 0) {
      setSetupStatus('loading', '<span class="spinner"></span>Pushing existing notes to GitHub...');
      await syncAllNotes();
    }

    updateUI();
    setSetupStatus('success',
      `&#10003; Connected as <strong>${username}</strong>.<br>` +
      `Token encrypted with your password (AES-256-GCM).<br>` +
      `Notes will sync to <strong>${username}/${notesRepo}</strong> as Markdown files.`
    );
    await loadAllNotesFromGitHub();

  } catch (e) {
    setSetupStatus('error', '&#10007; ' + e.message);
  }

  document.getElementById('connectBtn').disabled = false;
}

/* ── DISCONNECT ── */
function disconnectGitHub() {
  if (!confirm('Disconnect GitHub? Token will be cleared. Notes remain in local cache.')) return;
  window.cfg = { username: '', notesRepo: 'upsc-notes' };
  localStorage.removeItem('upsc_cfg_enc');
  document.getElementById('inputToken').value    = '';
  document.getElementById('inputUsername').value = '';
  document.getElementById('inputNotesRepo').value = 'upsc-notes';
  updateUI();
  const sb = document.getElementById('syncBar');
  if (sb) sb.style.display = 'none';
  setSetupStatus('', 'Disconnected. Notes still in local session cache.');
}

/* ── STATUS HELPERS ── */
function setSyncStatus(type, msg) {
  const bar = document.getElementById('syncBar');
  if (!bar) return;
  bar.className = type;
  bar.style.display = 'block';
  document.getElementById('syncMsg').innerHTML = msg;
}

function setSetupStatus(type, msg) {
  const el = document.getElementById('setupStatus');
  if (!el) return;
  const colors = { success: '#5a9a5a', error: '#c85a5a', loading: '#c8953a' };
  el.style.color = colors[type] || 'var(--muted)';
  el.innerHTML = msg;
}
