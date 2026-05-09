/* ============================================================
   notes.js — Notes CRUD + Render
   ============================================================
   Depends on: github.js (pushSubjectNotes, setSyncStatus)
   Exports:
     addNote()       — called by Save button
     deleteNote(id)  — called by Delete button per note
     clearNoteForm() — called by Clear button
     filterNotes(f, btn) — called by filter buttons
     renderNotes()   — called whenever notes change
   ============================================================ */

let currentFilter = 'all';

/* ── ADD NOTE ── */
async function addNote() {
  const subject = document.getElementById('noteSubject').value;
  const title   = document.getElementById('noteTitle').value.trim();
  const body    = document.getElementById('noteBody').value.trim();

  if (!subject) { alert('Select a subject.'); return; }
  if (!title)   { alert('Enter a note title.'); return; }
  if (!body)    { alert('Write your note content.'); return; }

  const note = {
    id: Date.now(),
    subject, title, body,
    date: new Date().toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    })
  };

  window.notes.unshift(note);
  clearNoteForm();
  renderNotes();
  localStorage.setItem('upsc_nc', JSON.stringify(window.notes));

  if (window.cfg.token && window.cfg.username) {
    setSyncStatus('syncing', '<span class="spinner"></span>Saving to GitHub...');
    try {
      await pushSubjectNotes(subject);
      setSyncStatus('synced',
        `&#11044; Saved &mdash; ${title} &rarr; ${subject.replace(/-/g, ' ')}.md &mdash; ${new Date().toLocaleTimeString()}`
      );
    } catch (e) {
      setSyncStatus('error', '&#10007; Sync failed: ' + e.message + ' (saved locally)');
    }
  }
}

/* ── DELETE NOTE ── */
async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  const note = window.notes.find(n => n.id === id);
  window.notes = window.notes.filter(n => n.id !== id);
  renderNotes();
  localStorage.setItem('upsc_nc', JSON.stringify(window.notes));

  if (window.cfg.token && window.cfg.username && note) {
    setSyncStatus('syncing', '<span class="spinner"></span>Updating GitHub...');
    try {
      await pushSubjectNotes(note.subject);
      setSyncStatus('synced', `&#11044; Note deleted and synced &mdash; ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setSyncStatus('error', '&#10007; Sync failed: ' + e.message);
    }
  }
}

/* ── CLEAR FORM ── */
function clearNoteForm() {
  document.getElementById('noteSubject').value = '';
  document.getElementById('noteTitle').value   = '';
  document.getElementById('noteBody').value    = '';
}

/* ── FILTER ── */
function filterNotes(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNotes();
}

/* ── ESCAPE HTML ── */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── RENDER NOTES ── */
function renderNotes() {
  const list = document.getElementById('notesList');
  if (!list) return;

  const filtered = currentFilter === 'all'
    ? window.notes
    : window.notes.filter(n => n.subject === currentFilter);

  updateNoteCount();

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        No notes here yet.<br><br>
        Start with: <em>"Indian Polity — Chapter 1: Historical Background of the Constitution"</em><br><br>
        Every note syncs to a .md file in your private GitHub repo with full version history.
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(n => `
    <div class="note-item">
      <div class="note-header">
        <div>
          <div class="note-subject">${esc(n.subject.replace(/-/g, ' '))}</div>
          <div class="note-date">${esc(n.date)}</div>
        </div>
        <button class="btn btn-danger" onclick="deleteNote(${n.id})">Delete</button>
      </div>
      <div class="note-title-text">${esc(n.title)}</div>
      <div class="note-body">${esc(n.body)}</div>
    </div>`
  ).join('');
}

/* ── UPDATE NOTE COUNT ── */
function updateNoteCount() {
  const stat = document.getElementById('noteCountStat');
  if (stat) stat.textContent = window.notes.length;

  const countEl = document.getElementById('notesCount');
  if (!countEl) return;

  const filtered = currentFilter === 'all'
    ? window.notes
    : window.notes.filter(n => n.subject === currentFilter);

  countEl.textContent =
    filtered.length + ' note' + (filtered.length !== 1 ? 's' : '') +
    (currentFilter !== 'all' ? ' in ' + currentFilter.replace(/-/g, ' ') : ' total');
}
