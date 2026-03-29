var _pageData = JSON.parse(document.getElementById('cozy-page-data').textContent);
var noteId = _pageData.noteId;
var autoSaveInterval;
var currentCategory = _pageData.currentCategory;

// Folder tree functions
function toggleFolder(folderEl) {
    folderEl.classList.toggle('collapsed');
}

function createNewNoteInFolder(catId) {
    if (catId) {
        window.location.href = '/note/0?category_id=' + catId;
    } else {
        window.location.href = '/note/0';
    }
}

async function promptNewFolder(folderEl) {
    var parentPath = folderEl ? folderEl.dataset.path : '';
    var name = prompt(parentPath ? 'New subfolder in "' + parentPath + '":' : 'New folder name:');
    if (!name || !name.trim()) return;
    var fullPath = parentPath ? parentPath + '/' + name.trim() : name.trim();
    var catName = fullPath;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        catName = await FlaskyE2EE.encryptField(fullPath);
    }
    fetch('/api/add_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryName: catName })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) window.location.reload();
    })
    .catch(function() { alert('Failed to create folder.'); });
}

async function cozyMoveCategory(categoryId, oldPath, targetPath) {
    var payload;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        var leafName = oldPath.split('/').pop();
        var newPath = targetPath ? targetPath + '/' + leafName : leafName;
        var renames = [{ id: categoryId, name: await FlaskyE2EE.encryptField(newPath) }];
        document.querySelectorAll('.folder[data-path]').forEach(function(f) {
            var p = f.dataset.path;
            if (p.startsWith(oldPath + '/')) {
                var childNewPath = newPath + p.slice(oldPath.length);
                var childCatId = f.dataset.categoryId;
                if (childCatId) renames.push({ id: parseInt(childCatId), _newPath: childNewPath });
            }
        });
        for (var i = 1; i < renames.length; i++) {
            renames[i].name = await FlaskyE2EE.encryptField(renames[i]._newPath);
            delete renames[i]._newPath;
        }
        payload = { categoryId: categoryId, renames: renames };
    } else {
        payload = { categoryId: categoryId, targetPath: targetPath };
    }
    fetch('/api/move_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) window.location.reload();
        else if (data.reason) alert(data.reason);
    })
    .catch(function() { alert('Failed to move folder.'); });
}

function deleteFolder(catId, catName) {
    if (!confirm('Delete folder "' + catName + '"?')) return;
    fetch('/api/delete_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: catId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) window.location.reload();
    })
    .catch(function() { alert('Failed to delete folder.'); });
}

// Drag and drop
var dragType = null;
var dragNoteId = null;
var dragFolderId = null;
var dragFolderPath = null;

function onNoteDragStart(e, nid) {
    dragType = 'note';
    dragNoteId = nid;
    dragFolderId = null;
    dragFolderPath = null;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
    // hide root drop zone for notes
    document.getElementById('root-drop-zone').classList.remove('visible');
}

function onFolderDragStart(e, catId, path) {
    dragType = 'folder';
    dragFolderId = catId;
    dragFolderPath = path;
    dragNoteId = null;
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
    var folderEl = e.target.closest('.folder');
    if (folderEl) folderEl.classList.add('dragging');
    // show root drop zone for subfolders
    if (path.indexOf('/') !== -1) {
        document.getElementById('root-drop-zone').classList.add('visible');
    }
}

function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var target = e.target.closest('.folder-header, .root-drop-zone, a');
    if (target) target.classList.add('drag-over');
}

function onDragLeave(e) {
    var target = e.target.closest('.folder-header, .root-drop-zone, a');
    if (target) target.classList.remove('drag-over');
}

function clearDragState() {
    dragType = null;
    dragNoteId = null;
    dragFolderId = null;
    dragFolderPath = null;
    document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
    document.getElementById('root-drop-zone').classList.remove('visible');
}

function onDrop(e, targetPath, targetCatId) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragType) return;

    if (dragType === 'note' && targetCatId !== null) {
        var nid = dragNoteId;
        clearDragState();
        fetch('/api/edit_note_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId: nid, category: targetCatId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) window.location.reload();
        })
        .catch(function() { alert('Failed to move note.'); });
    } else if (dragType === 'folder') {
        if (targetPath === dragFolderPath) { clearDragState(); return; }
        if (targetPath.startsWith(dragFolderPath + '/')) { clearDragState(); return; }
        var fid = dragFolderId;
        var fpath = dragFolderPath;
        clearDragState();
        cozyMoveCategory(fid, fpath, targetPath);
    } else {
        clearDragState();
    }
}

function onRootDrop(e) {
    e.preventDefault();
    if (dragType !== 'folder') { clearDragState(); return; }
    var fid = dragFolderId;
    var fpath = dragFolderPath;
    clearDragState();
    cozyMoveCategory(fid, fpath, '');
}

// Clean up drag state if drop happens outside
document.addEventListener('dragend', clearDragState);

function changeNoteCategory(categoryId) {
    var sel = document.getElementById('category-select');
    currentCategory = sel.options[sel.selectedIndex].dataset.name;
    if (!noteId || noteId === 0) return;
    fetch('/api/edit_note_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: noteId, category: parseInt(categoryId) })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) window.location.reload();
    })
    .catch(function() { alert('Failed to change category.'); });
}

// Expand folder containing active note
(function() {
    var active = document.querySelector('.note-item.active');
    if (active) {
        var folder = active.closest('.folder');
        while (folder) {
            folder.classList.remove('collapsed');
            folder = folder.parentElement.closest('.folder');
        }
    }
})();

// Load Theme Settings
if (_pageData.darkMode) {
    document.body.classList.add('dark-mode');
}
if (_pageData.hideTitle) {
    document.getElementById('note-title').style.display = 'none';
}
var isDirty = false;
var originalTitle = document.title;

function markDirty() {
    if (!isDirty) {
        isDirty = true;
        document.title = '* ' + originalTitle;
        document.getElementById('save-note').style.outline = '2px solid #e76f51';
    }
}

function markClean() {
    isDirty = false;
    document.title = originalTitle;
    document.getElementById('save-note').style.outline = '';
}

// Track changes
document.getElementById('note-content').addEventListener('input', markDirty);
document.getElementById('note-title').addEventListener('input', markDirty);

var autoSaveTimer = null;
var autoSaveHandler = null;
function setupAutoSaveDebounce() {
    var textarea = document.getElementById('note-content');
    var titleInput = document.getElementById('note-title');
    autoSaveHandler = function() {
        if (noteId === 0) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(function() {
            document.getElementById('save-note').click();
        }, 3000);
    };
    textarea.addEventListener('input', autoSaveHandler);
    titleInput.addEventListener('input', autoSaveHandler);
}
if (_pageData.autoSave) {
    document.getElementById('auto-save').classList.add('active');
    setupAutoSaveDebounce();
    document.getElementById('autosave-icon').innerHTML = '🔄';
}


// if on mobile, mobile font size
var isMobile = window.innerWidth < 480;
if (isMobile) {
    document.getElementById('note-content').style.fontSize = _pageData.mobileFontSize + 'px';
    // Always start collapsed on mobile
    document.querySelector('.sidebar').classList.remove('expanded');
    document.querySelector('.main-content').classList.remove('expanded');
    document.querySelector('.sidebar-actions').classList.remove('expanded');
}
else {
    document.getElementById('note-content').style.fontSize = _pageData.desktopFontSize + 'px';
}

// Toggle sidebar
document.getElementById('toggle-sidebar').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('expanded');
    document.querySelector('.main-content').classList.toggle('expanded');
    document.querySelector('.sidebar-actions').classList.toggle('expanded');
    var isExpanded = document.querySelector('.sidebar').classList.contains('expanded');
    // Only persist on desktop
    if (!isMobile) {
        fetch('/api/save_ui_state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sidebar_collapsed: !isExpanded })
        });
    }
});

// Add new note
document.getElementById('new-note').addEventListener('click', () => {
    var autoSaveActive = document.getElementById('auto-save').classList.contains('active');
    if (autoSaveActive && noteId !== 0) {
        document.getElementById('save-note').click();
        setTimeout(function() { window.location.href = '/note/0'; }, 500);
    } else if (confirm('Are you sure you want to create a new note? Your changes will not be saved.')) {
        window.location.href = '/note/0';
    }
});


// Toggle markdown
document.getElementById('toggle-markdown').addEventListener('click', () => {
    noteContent = document.getElementById('note-content');
    markdownContent = document.getElementById('markdown-note-content');
    markdownContent.style.display = markdownContent.style.display === 'none' ? 'block' : 'none';
    noteContent.style.display = noteContent.style.display === 'none' ? 'block' : 'none';
    if (markdownContent.style.display === 'block') {
        markdownContent.innerHTML = sanitizeMarkdown(FlaskyMarkdown.processCallouts(marked(noteContent.value)));
        hljs.highlightAll();
        if (window._decryptAttachments) window._decryptAttachments(markdownContent);
    }
});

// Go to search
document.getElementById('search-notes').addEventListener('click', () => {
    openSearchPopup();
});

// Go to settings
document.getElementById('settings').addEventListener('click', () => {
    var autoSaveActive = document.getElementById('auto-save').classList.contains('active');
    if (autoSaveActive && noteId !== 0) {
        document.getElementById('save-note').click();
        setTimeout(function() { window.location.href = '/settings'; }, 500);
    } else if (confirm('Are you sure you want to go to settings? Your changes will not be saved.')) {
        window.location.href = '/settings';
    }
});

// Go to agenda
document.getElementById('agenda').addEventListener('click', () => {
    var autoSaveActive = document.getElementById('auto-save').classList.contains('active');
    if (autoSaveActive && noteId !== 0) {
        document.getElementById('save-note').click();
        setTimeout(function() { window.location.href = '/agenda'; }, 500);
    } else if (confirm('Are you sure you want to go to agenda? Your changes will not be saved.')) {
        window.location.href = '/agenda';
    }
});

// Hide title
document.getElementById('hide-title').addEventListener('click', () => {
    const title = document.getElementById('note-title');
    title.style.display = title.style.display === 'none' ? 'block' : 'none';
    if (title.style.display === 'none') {
        hideTitle = 1;
    }
    else {
        hideTitle = 0;
    }
    fetch('/api/save_hide_title', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hideTitle: hideTitle })
    });
});

// Delete note
document.getElementById('delete-note').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this note?')) {
        if (noteId === 0) {
            window.location.href = '/note/0';
            return;
        }
        fetch('/api/delete_note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ noteId: noteId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Note deleted successfully!');
                window.location.href = '/note/0';
            } else {
                alert('An error occurred. Please try again.');
            }
        });
    }
});

// Toggle dark mode
document.getElementById('toggle-dark-mode').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        fetch('/api/save_dark_mode/1').catch(function(){});
    } else {
        fetch('/api/save_dark_mode/0').catch(function(){});
    }
});

// Toggle auto save
document.getElementById('auto-save').addEventListener('click', () => {
    if (document.getElementById('auto-save').classList.contains('active')) {
        document.getElementById('auto-save').classList.remove('active');
        clearTimeout(autoSaveTimer);
        var textarea = document.getElementById('note-content');
        var titleInput = document.getElementById('note-title');
        if (autoSaveHandler) {
            textarea.removeEventListener('input', autoSaveHandler);
            titleInput.removeEventListener('input', autoSaveHandler);
            autoSaveHandler = null;
        }
    } else {
        document.getElementById('auto-save').classList.add('active');
        setupAutoSaveDebounce();
    }
    if (document.getElementById('auto-save').classList.contains('active')) {
        document.getElementById('autosave-icon').innerHTML = '🔄';
        fetch('/api/save_auto_save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ autoSave: 1 })
        });
    } else {
        document.getElementById('autosave-icon').innerHTML = '⏸️';
        fetch('/api/save_auto_save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ autoSave: 0 })
        });
    }
});


// Increase font size
document.getElementById('increase-font').addEventListener('click', () => {
    const textarea = document.getElementById('note-content');
    let fontSize = parseInt(window.getComputedStyle(textarea).fontSize);
    let newFontSize = fontSize + 2;
    textarea.style.fontSize = newFontSize + 'px';
    if (window.innerWidth < 480) {
        fetch('/api/save_mobile_font_size/' + newFontSize)
    }
    else {
        fetch('/api/save_font_size/' + newFontSize)
    }
});

// Decrease font size
document.getElementById('decrease-font').addEventListener('click', () => {
    const textarea = document.getElementById('note-content');
    let fontSize = parseInt(window.getComputedStyle(textarea).fontSize);
    let newFontSize = fontSize - 2;
    if (fontSize > 8) {
        textarea.style.fontSize = newFontSize + 'px';
        if (window.innerWidth < 480) {
            fetch('/api/save_mobile_font_size/' + newFontSize)
        }
        else {
            fetch('/api/save_font_size/' + newFontSize)
        }
    }
});

// Save note
document.getElementById('save-note').addEventListener('click', async () => {
    const icon = document.getElementById('save-icon');
    var noteTitle = document.getElementById('note-title').value;
    var noteContent = document.getElementById('note-content').value;
    icon.innerHTML = '⌛';

    // E2EE: encrypt before sending, use category ID
    var catValue = currentCategory;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        var catSelect = document.getElementById('category-select');
        if (catSelect) catValue = parseInt(catSelect.value);
    }
    var payload = { noteId: noteId, title: noteTitle, content: noteContent, category: catValue };
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        try {
            payload.title = await FlaskyE2EE.encryptField(noteTitle);
            payload.content = await FlaskyE2EE.encryptField(noteContent);
        } catch(e) {
            icon.innerHTML = '❌';
            setTimeout(() => { icon.innerHTML = '💾'; }, 3000);
            return;
        }
    }

    fetch('/api/save_note', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            markClean();
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.invalidate();
            // checkmark
            icon.innerHTML = '✅';
            if (noteId === 0) {
                window.location.href = '/note/' + data.note.id;
            }
        } else {
            icon.innerHTML = '❌';
        }
        setTimeout(() => {
            icon.innerHTML = '💾';
        }, 3000);
    })
    .catch(function() {
        icon.innerHTML = '❌';
        setTimeout(() => { icon.innerHTML = '💾'; }, 3000);
    });
});


document.addEventListener('keydown', e =>{
    if (e.ctrlKey && e.key == "s") {
        e.preventDefault();
        document.getElementById('save-note').click();
    }
})


// Search functionality
let selectedIndex = -1;
const searchPopup = document.getElementById('search-popup');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchOverlay = document.getElementById('search-overlay');

// Search popup keyboard shortcut
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearchPopup();
    } else if (e.key === 'Escape' && searchPopup.style.display === 'block') {
        closeSearchPopup();
    } else if (searchPopup.style.display === 'block') {
        handleSearchNavigation(e);
    }
});

// Handle search navigation with keyboard
function handleSearchNavigation(e) {
    const results = searchResults.children;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
        updateSelectedResult();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelectedResult();
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        results[selectedIndex].click();
    }
}

// Update selected result highlighting
function updateSelectedResult() {
    const results = searchResults.children;
    for (let i = 0; i < results.length; i++) {
        if (i === selectedIndex) {
            results[i].style.backgroundColor = 'var(--button-bg)';
            results[i].style.color = 'var(--button-text)';
        } else {
            results[i].style.backgroundColor = '';
            results[i].style.color = 'var(--text-color)';
        }
    }
}

// Open search popup
function openSearchPopup() {
    searchPopup.style.display = 'block';
    searchOverlay.style.display = 'block';
    searchInput.value = '';
    searchInput.focus();
    selectedIndex = -1;
    searchResults.innerHTML = '';
}

// Close search popup
function closeSearchPopup() {
    searchPopup.style.display = 'none';
    searchOverlay.style.display = 'none';
    searchInput.value = '';
    searchResults.innerHTML = '';
    selectedIndex = -1;
}

// Click outside to close
searchOverlay.addEventListener('click', closeSearchPopup);

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Search input handler
searchInput.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (!query) {
        searchResults.innerHTML = '';
        return;
    }

    try {
        let notes;
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            notes = await FlaskySearch.search(query);
        } else {
            const response = await fetch('/api/search_notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            notes = await response.json();
        }

        searchResults.innerHTML = '';
        selectedIndex = -1;

        const fragment = document.createDocumentFragment();
        notes.forEach((note, index) => {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'search-result';
            resultDiv.textContent = note.title;

            resultDiv.addEventListener('mouseover', () => {
                selectedIndex = index;
                updateSelectedResult();
            });

            resultDiv.addEventListener('click', () => {
                window.location.href = `/note/${note.id}`;
            });

            fragment.appendChild(resultDiv);
        });
        searchResults.appendChild(fragment);

        if (notes.length === 0) {
            searchResults.innerHTML = '<div style="padding: 10px; color: var(--text-color);">No results found</div>';
        }
    } catch (error) {
        console.error('Error searching notes:', error);
        searchResults.innerHTML = '<div style="padding: 10px; color: var(--text-color);">Error searching notes</div>';
    }
}, 300));

// Word/character count
var wordCountTimer = null;
function updateWordCount() {
    var text = document.getElementById('note-content').value || '';
    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var bar = document.getElementById('word-count-bar');
    if (bar) bar.textContent = words + ' words, ' + chars + ' chars';
}
document.getElementById('note-content').addEventListener('input', function() {
    clearTimeout(wordCountTimer);
    wordCountTimer = setTimeout(updateWordCount, 300);
});
updateWordCount();

// File upload (E2EE-aware)
async function uploadFileToNote(file) {
    if (!file) return;
    var formData = new FormData();
    var filename = file.name;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        var arrayBuf = await file.arrayBuffer();
        var encryptedData = await FlaskyE2EE.encryptBlob(arrayBuf);
        var encFilename = await FlaskyE2EE.encryptField(filename);
        formData.append('file', new Blob([encryptedData]), 'encrypted');
        formData.append('filename', encFilename);
    } else {
        formData.append('file', file);
        formData.append('filename', filename);
    }
    try {
        var resp = await fetch('/api/upload_attachment', { method: 'POST', body: formData });
        var data = await resp.json();
        if (data.id) {
            var ta = document.getElementById('note-content');
            var embedText = '![[' + filename + ']]';
            ta.value = ta.value.substring(0, ta.selectionStart) + embedText + '\n' + ta.value.substring(ta.selectionEnd);
            markDirty();
        }
    } catch(e) { console.error('Upload failed:', e); }
}
(function() {
    var ta = document.getElementById('note-content');
    if (!ta) return;
    ta.addEventListener('paste', function(e) {
        var items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                var file = items[i].getAsFile();
                if (file) uploadFileToNote(file);
                return;
            }
        }
    });
    ta.addEventListener('dragover', function(e) { e.preventDefault(); });
    ta.addEventListener('drop', function(e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            e.preventDefault();
            for (var i = 0; i < files.length; i++) uploadFileToNote(files[i]);
        }
    });
})();

// Add keyboard shortcut hints to button tooltips
document.getElementById('save-note').title = 'Save Note (Ctrl+S)';
document.getElementById('search-notes').title = 'Search (Ctrl+K)';

async function cozyRebuildSidebarE2EE() {
    var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
    try {
        var resp = await fetch('/api/sidebar_tree?note_id=' + noteId);
        var data = await resp.json();
        if (!data.success || !data.encrypted) return;

        var cats = data.categories || [];
        var notes = data.notes || [];
        // Decrypt
        for (var i = 0; i < cats.length; i++) {
            try { cats[i].decrypted = await FlaskyE2EE.decryptField(cats[i].name); } catch(e) { cats[i].decrypted = cats[i].name; }
        }
        for (var i = 0; i < notes.length; i++) {
            try { notes[i].decrypted = await FlaskyE2EE.decryptField(notes[i].title); } catch(e) { notes[i].decrypted = notes[i].title; }
        }

        // Build path-based tree from decrypted names
        cats.sort(function(a, b) { return (a.decrypted || '').localeCompare(b.decrypted || ''); });
        var tree = {};
        cats.forEach(function(cat) {
            var parts = cat.decrypted.split('/');
            var node = tree;
            for (var j = 0; j < parts.length; j++) {
                if (!node[parts[j]]) node[parts[j]] = { _children: {}, _category: null, _notes: [] };
                if (j === parts.length - 1) node[parts[j]]._category = cat;
                node = node[parts[j]]._children;
            }
        });
        // Assign notes to categories
        notes.forEach(function(n) {
            var cat = cats.find(function(c) { return c.id === n.category_id; });
            if (cat) {
                var parts = cat.decrypted.split('/');
                var node = tree;
                for (var j = 0; j < parts.length; j++) {
                    if (!node[parts[j]]) return;
                    if (j === parts.length - 1) node[parts[j]]._notes.push(n);
                    else node = node[parts[j]]._children;
                }
            }
        });

        // Render tree HTML
        function renderTree(node) {
            var html = '';
            var keys = Object.keys(node).sort();
            keys.forEach(function(name) {
                var d = node[name];
                var cat = d._category;
                var notesList = d._notes || [];
                var childHtml = renderTree(d._children);
                html += '<div class="folder collapsed"' + (cat ? ' data-category-id="' + cat.id + '"' : '') + ' data-path="' + esc(cat ? cat.decrypted : name) + '">';
                html += '<div class="folder-header" data-action="toggle-folder"';
                if (cat) html += ' draggable="true" data-action-dragstart="folder" data-drag-cat-id="' + cat.id + '"';
                html += ' data-drop-path="' + esc(cat ? cat.decrypted : name) + '" data-drop-cat-id="' + (cat ? cat.id : '') + '">';
                html += '<span class="folder-chevron">&#9660;</span>';
                html += '<span class="folder-icon">📂</span>';
                html += '<span class="folder-name">' + esc(name) + '</span>';
                html += '<span class="folder-count">' + notesList.length + '</span>';
                if (cat) html += '<span class="folder-action-btn" data-action="new-note-in-folder" data-cat-id="' + cat.id + '" title="New note">+</span>';
                html += '<span class="folder-action-btn" data-action="new-subfolder" title="New subfolder">&#43;&#128193;</span>';
                if (cat && notesList.length === 0 && Object.keys(d._children).length === 0) {
                    html += '<span class="folder-action-btn" data-action="delete-folder" data-cat-id="' + cat.id + '" title="Delete folder">&times;</span>';
                }
                html += '</div>';
                html += '<div class="folder-items">';
                html += childHtml;
                notesList.forEach(function(n) {
                    var active = n.id === noteId ? ' active' : '';
                    html += '<a href="/note/' + n.id + '" draggable="true" data-action-dragstart="note" data-drag-note-id="' + n.id + '"';
                    html += ' data-drop-path="' + esc(cat ? cat.decrypted : name) + '" data-drop-cat-id="' + (cat ? cat.id : '') + '">';
                    html += '<div class="note-item' + active + '">' + esc(n.decrypted || 'Untitled') + '</div></a>';
                });
                html += '</div></div>';
            });
            return html;
        }

        // Replace folder tree
        var noteList = document.querySelector('.note-list');
        if (noteList) {
            var label = noteList.querySelector('.sidebar-category-label');
            var rootDrop = document.getElementById('root-drop-zone');
            noteList.innerHTML = '';
            if (label) noteList.appendChild(label);
            var treeDiv = document.createElement('div');
            treeDiv.innerHTML = renderTree(tree);
            while (treeDiv.firstChild) noteList.appendChild(treeDiv.firstChild);
            if (rootDrop) noteList.appendChild(rootDrop);
        }

        // Rebuild category select
        var catSelect = document.getElementById('category-select');
        if (catSelect) {
            var selectedId = noteId ? null : null;
            // Find current note's category
            var currentNote = notes.find(function(n) { return n.id === noteId; });
            var currentCatId = currentNote ? currentNote.category_id : (cats.length > 0 ? cats[0].id : null);
            catSelect.innerHTML = '';
            cats.forEach(function(cat) {
                var opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.decrypted;
                opt.dataset.name = cat.decrypted;
                if (cat.id === currentCatId) opt.selected = true;
                catSelect.appendChild(opt);
            });
            currentCategory = catSelect.options[catSelect.selectedIndex] ? catSelect.options[catSelect.selectedIndex].dataset.name : '';
        }

        // Expand folder containing active note
        var activeItem = document.querySelector('.note-item.active');
        if (activeItem) {
            var folder = activeItem.closest('.folder');
            if (folder) folder.classList.remove('collapsed');
        }
    } catch(e) {
        console.error('E2EE sidebar rebuild failed:', e);
    }
}

// E2EE: init and decrypt page data on load
if (typeof FlaskyE2EE !== 'undefined') {
    FlaskyE2EE.init().then(async function(ok) {
        if (!ok) return;
        if (!FlaskyE2EE.isEncrypted()) return;
        var dataEl = document.getElementById('encrypted-note-data');
        if (dataEl) {
            try {
                var enc = JSON.parse(dataEl.textContent);
                var title = await FlaskyE2EE.decryptField(enc.title);
                var content = await FlaskyE2EE.decryptField(enc.content);
                var titleEl = document.getElementById('note-title');
                if (titleEl) titleEl.value = title || '';
                var contentEl = document.getElementById('note-content');
                if (contentEl) contentEl.value = content || '';
                document.title = (title || 'Untitled') + ' — Cozy Notes';
                // Update markdown preview if visible
                var mdDiv = document.getElementById('markdown-note-content');
                if (mdDiv && mdDiv.style.display !== 'none' && typeof marked !== 'undefined') {
                    mdDiv.innerHTML = sanitizeMarkdown(marked(content || ''));
                }
                updateWordCount();
            } catch(e) {
                console.error('E2EE page decrypt failed:', e);
            }
        }
        // Rebuild sidebar and category select client-side from decrypted data
        await cozyRebuildSidebarE2EE();
        FlaskyE2EE.revealContent();
    });
}

// --- Event delegation ---
// Click delegation
document.addEventListener('click', function(e) {
    var target = e.target;

    // folder-header toggle
    var folderHeader = target.closest('[data-action="toggle-folder"]');
    if (folderHeader && !target.closest('.folder-action-btn')) {
        toggleFolder(folderHeader.parentElement);
        return;
    }

    // New note in folder
    var newNoteBtn = target.closest('[data-action="new-note-in-folder"]');
    if (newNoteBtn) {
        e.stopPropagation();
        createNewNoteInFolder(parseInt(newNoteBtn.dataset.catId));
        return;
    }

    // New subfolder
    var newSubfolderBtn = target.closest('[data-action="new-subfolder"]');
    if (newSubfolderBtn) {
        e.stopPropagation();
        promptNewFolder(newSubfolderBtn.closest('.folder'));
        return;
    }

    // Delete folder
    var deleteFolderBtn = target.closest('[data-action="delete-folder"]');
    if (deleteFolderBtn) {
        e.stopPropagation();
        var folderEl = deleteFolderBtn.closest('.folder');
        deleteFolder(parseInt(deleteFolderBtn.dataset.catId), folderEl ? folderEl.dataset.path : '');
        return;
    }
});

// Change delegation for category select
document.addEventListener('change', function(e) {
    var target = e.target;
    if (target.matches('[data-action="change-category"]')) {
        changeNoteCategory(target.value);
    }
});

// Drag-and-drop delegation
document.addEventListener('dragstart', function(e) {
    var target = e.target.closest ? e.target : e.target.parentElement;
    var el = target.closest ? target.closest('[data-action-dragstart]') : null;
    if (!el) return;
    var action = el.dataset.actionDragstart;
    if (action === 'note') {
        var nid = parseInt(el.dataset.dragNoteId);
        onNoteDragStart(e, nid);
    } else if (action === 'folder') {
        var catId = parseInt(el.dataset.dragCatId);
        var folderEl = el.closest('.folder');
        var path = folderEl ? folderEl.dataset.path : '';
        onFolderDragStart(e, catId, path);
    }
});

document.addEventListener('dragover', function(e) {
    var target = e.target.closest ? e.target.closest('[data-drop-path], .root-drop-zone') : null;
    if (target) {
        onDragOver(e);
    }
});

document.addEventListener('dragleave', function(e) {
    var target = e.target.closest ? e.target.closest('[data-drop-path], .root-drop-zone') : null;
    if (target) {
        onDragLeave(e);
    }
});

document.addEventListener('drop', function(e) {
    var rootDrop = e.target.closest ? e.target.closest('[data-action="root-drop"]') : null;
    if (rootDrop) {
        onRootDrop(e);
        return;
    }
    var dropTarget = e.target.closest ? e.target.closest('[data-drop-path]') : null;
    if (dropTarget) {
        var targetPath = dropTarget.dataset.dropPath;
        var targetCatIdStr = dropTarget.dataset.dropCatId;
        var targetCatId = targetCatIdStr ? parseInt(targetCatIdStr) : null;
        onDrop(e, targetPath, targetCatId);
    }
});
