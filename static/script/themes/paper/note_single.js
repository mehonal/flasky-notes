// Paper Theme — Modernized JS

// DOM refs
var contentEl = document.getElementById('post-content');
var previewEl = document.getElementById('markdown-preview');
var titleInput = document.getElementById('note-title');
var categoryInput = document.getElementById('note-category');
var saveStatusEl = document.getElementById('saveStatus');
var markdownVisible = false;

// Auto-resize textarea
function textAreaAdjust(element) {
    var maxHeight = document.body.scrollHeight;
    maxHeight = document.body.scrollWidth < 600 ? maxHeight / 3 : maxHeight / 1.7;
    element.style.height = "1px";
    element.style.height = (element.scrollHeight < maxHeight ? (25 + element.scrollHeight) : maxHeight) + "px";
}

textAreaAdjust(contentEl);

function changeFontSize() {
    var fs = document.getElementById('custom_font_size').value;
    contentEl.style.fontSize = fs + "px";
    fetch('/api/save_font_size/' + fs).then(function(r) { return r.json(); });
}

// Toast notification
function paperToast(msg, type) {
    var el = document.getElementById('paperToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'paperToast';
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:8px;color:#fff;font-size:14px;z-index:10000;opacity:0;transition:opacity 0.3s;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'error' ? '#dc3545' : '#198754';
    el.style.opacity = '1';
    setTimeout(function() { el.style.opacity = '0'; }, 2500);
}

// Save status display
function showSaveStatus(status, text) {
    saveStatusEl.className = 'save-status ' + status;
    saveStatusEl.textContent = text;
    if (status === 'saved') {
        setTimeout(function() { saveStatusEl.textContent = ''; }, 3000);
    }
}

// AJAX save
function saveNote() {
    showSaveStatus('saving', 'Saving...');
    fetch('/api/save_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            noteId: noteId,
            title: titleInput.value,
            content: contentEl.value,
            category: categoryInput.value
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            showSaveStatus('saved', 'Saved');
            if (noteId === 0 && data.note && data.note.id) {
                noteId = data.note.id;
                window.history.replaceState(null, '', '/note/' + noteId);
            }
        } else {
            showSaveStatus('error', 'Error: ' + (data.reason || 'Save failed'));
        }
    })
    .catch(function() {
        showSaveStatus('error', 'Network error');
    });
}

// AJAX revert
function revertNote() {
    if (!window.confirm("Are you sure you want to revert to the previous version?")) return;
    fetch('/api/revert_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: noteId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.note) {
            contentEl.value = data.note.content || '';
            textAreaAdjust(contentEl);
            showSaveStatus('saved', 'Reverted');
            if (markdownVisible) renderMarkdown();
        } else {
            paperToast(data.reason || 'Revert failed', 'error');
        }
    })
    .catch(function() { paperToast('Network error during revert', 'error'); });
}

// AJAX delete
function deleteNote() {
    if (!window.confirm("Are you sure you want to delete this note?")) return;
    fetch('/api/delete_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: noteId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            window.location.href = '/notes';
        } else {
            paperToast(data.reason || 'Delete failed', 'error');
        }
    })
    .catch(function() { paperToast('Network error during delete', 'error'); });
}

// Markdown preview toggle
function renderMarkdown() {
    var html = marked(contentEl.value);
    html = FlaskyMarkdown.processCallouts(html);
    if (typeof resolveWikiLinks === 'function') html = resolveWikiLinks(html);
    previewEl.innerHTML = html;
    hljs.highlightAll();
}

function toggleMarkdown() {
    markdownVisible = !markdownVisible;
    var btn = document.getElementById('toggleMarkdownBtn');
    if (markdownVisible) {
        renderMarkdown();
        contentEl.style.display = 'none';
        previewEl.style.display = 'block';
        btn.textContent = 'Edit';
    } else {
        contentEl.style.display = 'block';
        previewEl.style.display = 'none';
        btn.textContent = 'Preview';
    }
}

// Dark mode toggle
function toggleDarkMode() {
    darkModeOn = !darkModeOn;
    document.body.classList.toggle('dark-mode', darkModeOn);
    document.getElementById('darkModeBtn').textContent = darkModeOn ? '☀️' : '🌙';
    fetch('/api/save_dark_mode/' + (darkModeOn ? 1 : 0)).then(function(r) { return r.json(); });
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNote();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        FlaskySearch.open();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        toggleMarkdown();
    }
});

// Check last updated periodically
function checkLastUpdated() {
    fetch('/api/note/check_last_edited/' + noteId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            document.getElementById('last-updated').innerHTML = data.last_updated;
        }
    });
}

setInterval(checkLastUpdated, 15000);
