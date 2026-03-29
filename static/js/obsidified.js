// ============ State ============
var _pageData = JSON.parse(document.getElementById('obsidified-page-data').textContent);
var noteId = _pageData.noteId;
var currentCategory = _pageData.currentCategory;
var autoSaveTimer = null;
var autoSaveEnabled = _pageData.autoSaveEnabled;
var editMode = _pageData.editMode;
var isDirty = false;
var isSaving = false;
var cmEditor = null;
var currentFontSize = _pageData.currentFontSize;
var searchTimer = null;
var searchSelectedIndex = -1;
var searchResults = [];
var pinnedNotes = JSON.parse(localStorage.getItem('obsidified-pinned') || '[]');
var isMobile = window.innerWidth <= 768;
var defaultTemplateContent = _pageData.defaultTemplateContent;
var defaultTemplateProps = _pageData.defaultTemplateProps;
var currentNoteIcon = _pageData.currentNoteIcon;
var currentNoteIconColor = _pageData.currentNoteIconColor;

function saveUiState(updates) {
    fetch('/api/save_ui_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
}

// On mobile, collapse sidebar and right panel unless sidebar was explicitly open (e.g. after drag-drop reload)
if (isMobile) {
    (function() {
        var sb = document.getElementById('sidebar');
        var rp = document.getElementById('right-panel');
        var bd = document.getElementById('sidebar-backdrop');
        var panelBtn = document.getElementById('panel-toggle');
        if (rp) rp.classList.add('collapsed');
        if (panelBtn) panelBtn.classList.remove('active');
        if (sb) {
            if (sessionStorage.getItem('obsidified-mobile-sidebar-open')) {
                sessionStorage.removeItem('obsidified-mobile-sidebar-open');
                sb.classList.remove('collapsed');
                if (bd) bd.classList.add('visible');
            } else {
                sb.classList.add('collapsed');
            }
        }
    })();
}

// ============ Sidebar ============

function toggleSidebar() {
    var sb = document.getElementById('sidebar');
    var bd = document.getElementById('sidebar-backdrop');
    if (sb.classList.contains('collapsed')) {
        sb.classList.remove('collapsed');
        if (isMobile) bd.classList.add('visible');
    } else {
        closeSidebar();
    }
    var toggleBtn = document.querySelector('.toggle-sidebar');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', !sb.classList.contains('collapsed'));
    if (!isMobile) saveUiState({ sidebar_collapsed: sb.classList.contains('collapsed') });
}

function closeSidebar() {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('sidebar-backdrop').classList.remove('visible');
}

function persistMobileSidebarState() {
    if (isMobile && !document.getElementById('sidebar').classList.contains('collapsed')) {
        sessionStorage.setItem('obsidified-mobile-sidebar-open', '1');
    }
}

function refreshSidebar(callback) {
    // Save expanded folder paths before replacing the tree
    var expandedPaths = [];
    document.querySelectorAll('#file-tree .folder:not(.collapsed)').forEach(function(f) {
        if (f.dataset.path) expandedPaths.push(f.dataset.path);
    });

    // Save search filter state
    var searchInput = document.getElementById('search-input');
    var searchQuery = searchInput ? searchInput.value : '';

    fetch('/api/sidebar_tree?note_id=' + noteId)
    .then(function(r) { return r.json(); })
    .then(async function(data) {
        if (!data.success) return;

        var fileTree = document.getElementById('file-tree');
        var rootDrop = document.getElementById('root-drop-zone');
        fileTree.innerHTML = '';
        fileTree.appendChild(rootDrop);

        if (data.encrypted && typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            // E2EE: build sidebar HTML client-side from decrypted data
            var cats = data.categories || [];
            var notes = data.notes || [];
            // Decrypt note titles
            for (var i = 0; i < notes.length; i++) {
                try { notes[i].title = await FlaskyE2EE.decryptField(notes[i].title); } catch(e) {}
            }
            // Decrypt category names
            for (var i = 0; i < cats.length; i++) {
                try { cats[i].name = await FlaskyE2EE.decryptField(cats[i].name); } catch(e) {}
            }
            // Group notes by category
            var catMap = {};
            cats.forEach(function(c) { catMap[c.id] = { cat: c, notes: [] }; });
            // Ensure a "Main" bucket for uncategorized
            var mainCat = cats.find(function(c) { return c.name === 'Main'; });
            if (!mainCat) { mainCat = { id: 0, name: 'Main' }; catMap[0] = { cat: mainCat, notes: [] }; }
            notes.forEach(function(n) {
                var cid = n.category_id || mainCat.id;
                if (!catMap[cid]) catMap[cid] = { cat: { id: cid, name: 'Unknown' }, notes: [] };
                catMap[cid].notes.push(n);
            });
            var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
            var jesc = function(s) { return (s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); };

            // Build nested tree from path-based category names (e.g. "Work/Projects")
            function buildCategoryTree(cats, notes, mainCat) {
                var tree = {};
                cats.sort(function(a, b) { return a.name.localeCompare(b.name); });
                cats.forEach(function(cat) {
                    var parts = cat.name.split('/');
                    var node = tree;
                    for (var i = 0; i < parts.length; i++) {
                        if (!node[parts[i]]) node[parts[i]] = { _children: {}, _category: null, _notes: [] };
                        if (i === parts.length - 1) node[parts[i]]._category = cat;
                        node = node[parts[i]]._children;
                    }
                });
                // Assign notes to their category leaf nodes
                notes.forEach(function(n) {
                    var cid = n.category_id || mainCat.id;
                    var cat = cats.find(function(c) { return c.id === cid; }) || mainCat;
                    var parts = cat.name.split('/');
                    var node = tree;
                    for (var i = 0; i < parts.length; i++) {
                        if (!node[parts[i]]) node[parts[i]] = { _children: {}, _category: cat, _notes: [] };
                        if (i === parts.length - 1) node[parts[i]]._notes.push(n);
                        node = node[parts[i]]._children;
                    }
                });
                return tree;
            }

            function renderFolderTree(tree, pathPrefix) {
                var html = '';
                var names = Object.keys(tree).sort();
                names.forEach(function(name) {
                    var data = tree[name];
                    var fullPath = pathPrefix ? pathPrefix + '/' + name : name;
                    var cat = data._category;
                    var folderNotes = data._notes.slice().sort(function(a, b) {
                        return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
                    });
                    var catId = cat ? cat.id : 'null';
                    var childHtml = renderFolderTree(data._children, fullPath);
                    var totalNotes = folderNotes.length;

                    html += '<div class="folder collapsed"' + (cat ? ' data-category-id="' + catId + '"' : '') + ' data-path="' + esc(fullPath) + '">';
                    html += '<div class="folder-header" data-action="toggle-folder"' + (cat ? ' draggable="true" data-drag-type="folder" data-drag-category-id="' + catId + '" data-drag-path="' + esc(jesc(fullPath)) + '"' : '') + ' data-drop-target="folder" data-drop-path="' + esc(jesc(fullPath)) + '" data-drop-category-id="' + catId + '">';
                    html += '<span class="folder-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>';
                    if (cat && cat.icon) {
                        var fColor = cat.icon_color ? ' data-icon-color="' + esc(cat.icon_color) + '" style="color:' + esc(cat.icon_color) + '"' : '';
                        html += '<span class="folder-icon"><span class="lucide-icon" data-icon="' + esc(cat.icon) + '"' + fColor + '></span></span>';
                    } else {
                        html += '<span class="folder-icon"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>';
                    }
                    html += '<span class="folder-name">' + esc(name) + '</span>';
                    html += '<span class="folder-count">' + totalNotes + '</span>';
                    if (cat) {
                        html += '<button class="icon-btn folder-newnote-btn" draggable="false" data-action="new-note-in-folder" data-category-id="' + catId + '" data-path="' + esc(jesc(fullPath)) + '" title="New note in ' + esc(name) + '"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>';
                    }
                    html += '<button class="icon-btn folder-add-btn" draggable="false" data-action="new-subfolder" data-path="' + esc(jesc(fullPath)) + '" title="New subfolder"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>';
                    html += '</div>';
                    html += '<div class="folder-items" data-drop-target="folder-items" data-drop-path="' + esc(jesc(fullPath)) + '" data-drop-category-id="' + catId + '">';
                    html += childHtml;
                    folderNotes.forEach(function(n) {
                        var isActive = n.id === noteId ? ' active' : '';
                        var title = n.title || 'Untitled';
                        html += '<div class="file-item' + isActive + '" data-note-id="' + n.id + '" data-action="open-note" draggable="true" data-drag-type="note" data-drag-id="' + n.id + '" data-drop-target="file-item" data-drop-path="' + esc(jesc(fullPath)) + '" data-drop-category-id="' + catId + '">';
                        var noteIcon = n.icon || (cat ? cat.default_note_icon : null);
                        var noteIconColor = n.icon ? n.icon_color : (cat ? cat.default_note_icon_color : null);
                        if (noteIcon) {
                            var nColor = noteIconColor ? ' data-icon-color="' + esc(noteIconColor) + '" style="color:' + esc(noteIconColor) + '"' : '';
                            html += '<span class="file-icon"><span class="lucide-icon" data-icon="' + esc(noteIcon) + '"' + nColor + '></span></span>';
                        } else {
                            html += '<span class="file-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
                        }
                        html += '<span class="file-name">' + esc(title) + '</span>';
                        html += '<button class="icon-btn delete-btn" draggable="false" data-action="delete-sidebar-note" data-note-id="' + n.id + '" data-note-title="' + esc(jesc(title)) + '" title="Delete note"><svg viewBox="0 0 24 24" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
                        html += '<button class="icon-btn pin-btn" draggable="false" data-note-id="' + n.id + '" data-action="toggle-pin" title="Pin note"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg></button>';
                        html += '</div>';
                    });
                    html += '</div></div>';
                });
                return html;
            }

            var categoryTree = buildCategoryTree(cats, notes, mainCat);
            var html = renderFolderTree(categoryTree, '');
            fileTree.insertAdjacentHTML('beforeend', html);
        } else {
            // Non-encrypted: use server-rendered HTML
            fileTree.insertAdjacentHTML('beforeend', data.tree_html);
        }

        // Restore expanded folders
        expandedPaths.forEach(function(path) {
            var folder = fileTree.querySelector('.folder[data-path="' + path + '"]');
            if (folder) folder.classList.remove('collapsed');
        });

        // Auto-expand the folder containing the active note
        var activeItem = fileTree.querySelector('.file-item.active');
        if (activeItem) {
            var parentFolder = activeItem.closest('.folder');
            if (parentFolder) parentFolder.classList.remove('collapsed');
        }

        // Update breadcrumb category dropdown
        var catSelect = document.getElementById('category-select');
        if (catSelect && data.categories) {
            var selectedCatId = catSelect.value;
            catSelect.innerHTML = '';
            data.categories.forEach(function(cat) {
                var opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                catSelect.appendChild(opt);
            });
            if (activeItem) {
                var noteFolder = activeItem.closest('.folder[data-category-id]');
                if (noteFolder) catSelect.value = noteFolder.dataset.categoryId;
            } else {
                catSelect.value = selectedCatId;
            }
            if (catSelect.selectedOptions.length > 0) {
                currentCategory = catSelect.selectedOptions[0].textContent;
            }
        }

        // Render Lucide icons in sidebar
        renderSidebarIcons();

        // Re-apply pinned notes and search filter
        renderPinnedNotes();
        updatePinButtons();
        if (searchQuery) filterNotes(searchQuery);

        if (callback) callback();
    });
}

function toggleFolder(folder) { folder.classList.toggle('collapsed'); }

// Auto-expand the folder containing the active note
(function() {
    var activeItem = document.querySelector('#file-tree .file-item.active');
    if (activeItem) {
        var folder = activeItem.closest('.folder');
        if (folder) folder.classList.remove('collapsed');
    }
})();

function loadNote(id, category, categoryId) {
    clearTimeout(autoSaveTimer);

    if (id === 0) {
        noteId = 0;
        hasBeenSavedOnce = false;
        isDirty = false;
        isSaving = false;
        currentNoteIcon = null;
        currentNoteIconColor = null;
        updateNoteIconPreview(null, null);
        document.getElementById('note-title').value = '';
        if (cmEditor) cmEditor.setValue('');
        else document.getElementById('note-content').value = '';
        // Clear properties
        var propsBody = document.getElementById('props-body');
        if (propsBody) {
            propsBody.querySelectorAll('.prop-row').forEach(function(r) { r.remove(); });
        }
        currentCategory = category || 'Main';
        // Update category select
        var catSelect = document.getElementById('category-select');
        if (catSelect) {
            if (categoryId) {
                catSelect.value = String(categoryId);
            } else {
                for (var i = 0; i < catSelect.options.length; i++) {
                    if (catSelect.options[i].textContent === currentCategory) {
                        catSelect.selectedIndex = i;
                        break;
                    }
                }
            }
        }
        history.pushState({ noteId: 0 }, '', '/note/0');
        document.querySelector('.breadcrumb-item.active').textContent = 'New note';
        document.getElementById('save-status').textContent = '';
        document.getElementById('save-status').style.color = '';
        updateMobileSaveBtn('saved');
        if (!editMode) renderPreview();
        refreshSidebar();
        document.getElementById('note-title').focus();
        // Refresh right panel
        var rp = document.getElementById('right-panel');
        if (rp && !rp.classList.contains('collapsed')) refreshAllVisibleWidgets();
        // Check for folder default template
        if (categoryId) {
            fetch('/api/folder_default_template/' + categoryId)
            .then(function(r) { return r.json(); })
            .then(async function(data) {
                if (data.success && data.template) {
                    var t = data.template;
                    // E2EE: decrypt template content/properties
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                        try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
                        if (t.properties && typeof t.properties === 'string') {
                            try { t.properties = JSON.parse(await FlaskyE2EE.decryptField(t.properties)); } catch(e) { t.properties = {}; }
                        }
                    }
                    populateFromTemplate(t);
                }
            })
            .catch(function() {});
        }
        return;
    }

    fetch('/api/note/' + id)
    .then(function(r) { return r.json(); })
    .then(async function(data) {
        if (!data.success) { window.location.href = '/note/' + id; return; }
        var n = data.note;

        // E2EE: decrypt fields
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            n.title = await FlaskyE2EE.decryptField(n.title);
            n.content = await FlaskyE2EE.decryptField(n.content);
            if (n.category) {
                try { n.category = await FlaskyE2EE.decryptField(n.category); } catch(e) {}
            }
            if (n.properties && typeof n.properties === 'string') {
                try {
                    var decProps = await FlaskyE2EE.decryptField(n.properties);
                    n.properties = JSON.parse(decProps);
                } catch(e) { n.properties = {}; }
            }
        }

        noteId = n.id;
        hasBeenSavedOnce = true;
        isDirty = false;
        isSaving = false;

        // Update title
        document.getElementById('note-title').value = n.title || '';

        // Update content
        if (cmEditor) cmEditor.setValue(n.content || '');
        else document.getElementById('note-content').value = n.content || '';

        // Update properties
        var propsBody = document.getElementById('props-body');
        if (propsBody) {
            propsBody.querySelectorAll('.prop-row').forEach(function(r) { r.remove(); });
            var addBtn = propsBody.querySelector('.prop-add-row');
            var props = n.properties || {};
            Object.keys(props).forEach(function(key) {
                var val = props[key];
                if (Array.isArray(val)) val = val.join(', ');
                var row = document.createElement('div');
                row.className = 'prop-row';
                row.setAttribute('data-prop-key', key);
                row.innerHTML = '<div class="prop-key"><input type="text" class="prop-value-input" value="" style="font-size:12px;font-weight:500;color:var(--text-muted)" data-action="prop-changed"></div>' +
                    '<div class="prop-value"><input type="text" class="prop-value-input" value="" data-action="prop-changed"></div>' +
                    '<button class="prop-remove-btn" data-action="remove-prop" title="Remove property"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
                row.querySelector('.prop-key .prop-value-input').value = key;
                row.querySelector('.prop-value .prop-value-input').value = val || '';
                propsBody.insertBefore(row, addBtn);
            });
        }

        // Update URL and breadcrumb
        history.pushState({ noteId: n.id }, '', '/note/' + n.id);
        document.querySelector('.breadcrumb-item.active').textContent = n.title || 'Untitled';

        // Update icon
        currentNoteIcon = n.icon || null;
        currentNoteIconColor = n.icon_color || null;
        updateNoteIconPreview(n.resolved_icon || n.icon, n.resolved_icon_color || n.icon_color);

        // Update category
        currentCategory = n.category || 'Main';
        var catSelect = document.getElementById('category-select');
        if (catSelect && n.category_id) catSelect.value = n.category_id;

        // Update status
        document.getElementById('save-status').textContent = '\u2713 Saved';
        document.getElementById('save-status').style.color = 'var(--green)';
        updateMobileSaveBtn('saved');

        // Re-render preview if in preview mode
        if (!editMode) renderPreview();

        // Refresh sidebar and right panel
        refreshSidebar();
        var rp = document.getElementById('right-panel');
        if (rp && !rp.classList.contains('collapsed')) refreshAllVisibleWidgets();
    });
}

// Handle browser back/forward
window.addEventListener('popstate', function(e) {
    var id = 0;
    if (e.state && e.state.noteId !== undefined) {
        id = e.state.noteId;
    } else {
        var match = window.location.pathname.match(/\/note\/(\d+)/);
        if (match) id = parseInt(match[1]);
    }
    loadNote(id);
});

// Set initial history state
history.replaceState({ noteId: noteId }, '', window.location.href);

function openNote(id) {
    if (isMobile) closeSidebar();
    if (isDirty) {
        saveNote(function() { loadNote(id); });
    } else {
        loadNote(id);
    }
}

function createNewNote() {
    if (isMobile) closeSidebar();
    if (isDirty) {
        saveNote(function() { loadNote(0); });
    } else {
        loadNote(0);
    }
}

var preFilterFolderStates = null;

function filterNotes(query) {
    query = query.toLowerCase();

    if (query && !preFilterFolderStates) {
        // Save folder collapsed states before filtering
        preFilterFolderStates = {};
        document.querySelectorAll('#file-tree .folder[data-path]').forEach(function(f) {
            preFilterFolderStates[f.dataset.path] = f.classList.contains('collapsed');
        });
    }

    document.querySelectorAll('#file-tree .file-item').forEach(function(item) {
        var name = item.querySelector('.file-name').textContent.toLowerCase();
        item.style.display = name.includes(query) ? '' : 'none';
    });
    document.querySelectorAll('.folder').forEach(function(folder) {
        var visibleItems = folder.querySelectorAll('.file-item:not([style*="display: none"])');
        var count = folder.querySelector('.folder-count');
        folder.style.display = (query && visibleItems.length === 0) ? 'none' : '';
        if (query) {
            // Show match count and expand matching folders
            if (count) count.textContent = visibleItems.length;
            if (visibleItems.length > 0) folder.classList.remove('collapsed');
        } else {
            // Restore pre-filter folder states
            if (preFilterFolderStates && folder.dataset.path) {
                if (preFilterFolderStates[folder.dataset.path]) {
                    folder.classList.add('collapsed');
                } else {
                    folder.classList.remove('collapsed');
                }
            }
            // Restore original count
            if (count) {
                var allItems = folder.querySelectorAll(':scope > .folder-items > .file-item');
                count.textContent = allItems.length;
            }
        }
    });

    if (!query) preFilterFolderStates = null;
}

// ============ Pinned Notes ============

function togglePin(id) {
    var idx = pinnedNotes.indexOf(id);
    if (idx > -1) pinnedNotes.splice(idx, 1);
    else pinnedNotes.push(id);
    localStorage.setItem('obsidified-pinned', JSON.stringify(pinnedNotes));
    renderPinnedNotes();
    updatePinButtons();
}

var _lastPinnedKey = null;

function renderPinnedNotes() {
    var section = document.getElementById('pinned-section');
    var list = document.getElementById('pinned-list');
    // Check if pinned list actually changed
    var newKey = pinnedNotes.join(',') + ':' + noteId;
    if (newKey === _lastPinnedKey) return;
    _lastPinnedKey = newKey;
    list.innerHTML = '';
    if (pinnedNotes.length === 0) { section.classList.remove('has-pins'); return; }
    section.classList.add('has-pins');
    pinnedNotes.forEach(function(id) {
        var fileItem = document.querySelector('#file-tree .file-item[data-note-id="' + id + '"]');
        if (fileItem) {
            var name = fileItem.querySelector('.file-name').textContent;
            var div = document.createElement('div');
            div.className = 'file-item' + (id === noteId ? ' active' : '');
            div.style.paddingLeft = '8px';
            div.onclick = function() { openNote(id); };
            div.innerHTML = '<span class="file-icon"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" fill="currentColor" stroke="none"/></svg></span><span class="file-name">' + escapeHtml(name) + '</span>';
            list.appendChild(div);
        }
    });
}

function updatePinButtons() {
    document.querySelectorAll('#file-tree .pin-btn').forEach(function(btn) {
        var id = parseInt(btn.getAttribute('data-note-id'));
        btn.classList.toggle('pinned', pinnedNotes.indexOf(id) > -1);
    });
}

// ============ CodeMirror Editor ============

function initCodeMirror() {
    var textarea = document.getElementById('note-content');
    var wrapper = document.getElementById('cm-wrapper');
    if (!wrapper || cmEditor) return;

    cmEditor = ObsidifiedEditor.create(wrapper, {
        initialContent: textarea ? textarea.value : '',
        onChange: function() { markDirty(); },
        onInputRead: function(cm) {
            showWikiAutocomplete(cm);
            showSlashCommands(cm);
        },
        onCursorActivity: function(cm) {
            if (isSlashCommandVisible()) {
                var cursor = cm.getCursor();
                var line = cm.getLine(cursor.line);
                var before = line.substring(0, cursor.ch);
                if (!before.match(/(^|\s)\/([\w\s]*)$/)) {
                    hideSlashCommands();
                }
            }
            if (isWikiAutocompleteVisible()) {
                var cursor = cm.getCursor();
                var line = cm.getLine(cursor.line);
                var before = line.substring(0, cursor.ch);
                var openIdx = before.lastIndexOf('[[');
                if (openIdx === -1 || before.substring(openIdx + 2).indexOf(']]') > -1) {
                    hideWikiAutocomplete();
                }
            }
        },
        onKeydown: function(cm, e) {
            if (isSlashCommandVisible()) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (slashSelectedIndex < slashFilteredCommands.length - 1) { slashSelectedIndex++; renderSlashCommands(); }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (slashSelectedIndex > 0) { slashSelectedIndex--; renderSlashCommands(); }
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    acceptSlashCommand(slashSelectedIndex);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    hideSlashCommands();
                }
                return;
            }
            if (!isWikiAutocompleteVisible()) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (wikiSelectedIndex < wikiFilteredNotes.length - 1) { wikiSelectedIndex++; renderWikiAutocomplete(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (wikiSelectedIndex > 0) { wikiSelectedIndex--; renderWikiAutocomplete(); }
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                acceptWikiAutocomplete(wikiSelectedIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideWikiAutocomplete();
            }
        },
        keybindings: {
            'Mod-s': function() { saveNote(); },
            'Mod-b': function() { wrapSelection('**'); },
            'Mod-i': function() { wrapSelection('*'); },
            'Mod-d': function() { wrapSelection('~~'); },
            'Escape': function() { enterPreviewMode(); }
        }
    });

    // Hide the textarea since CM6 renders directly into the wrapper
    if (textarea) textarea.style.display = 'none';
}

function wrapSelection(wrapper) {
    if (!cmEditor) return;
    var sel = cmEditor.getSelection();
    if (sel) {
        cmEditor.replaceSelection(wrapper + sel + wrapper);
    } else {
        var cursor = cmEditor.getCursor();
        cmEditor.replaceRange(wrapper + wrapper, cursor);
        cmEditor.setCursor({ line: cursor.line, ch: cursor.ch + wrapper.length });
    }
}

function getEditorContent() {
    if (cmEditor) return cmEditor.getValue();
    var ta = document.getElementById('note-content');
    return ta ? ta.value : '';
}

// ============ File Upload (E2EE-aware) ============

async function uploadFileToNote(file) {
    if (!file || !noteId) return;
    var formData = new FormData();
    var filename = file.name;

    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        // Encrypt file data
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
            // Insert embed into editor
            var embedText = '![[' + filename + ']]';
            if (cmEditor) {
                var cursor = cmEditor.getCursor();
                cmEditor.replaceRange(embedText + '\n', cursor);
            }
            if (window._invalidateNoteMap) window._invalidateNoteMap();
        }
    } catch(e) {
        console.error('Upload failed:', e);
    }
}

// Wire paste/drop on editor wrapper
(function() {
    var wrapper = document.getElementById('cm-wrapper');
    if (!wrapper) return;
    wrapper.addEventListener('paste', function(e) {
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
    wrapper.addEventListener('dragover', function(e) { e.preventDefault(); });
    wrapper.addEventListener('drop', function(e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            e.preventDefault();
            for (var i = 0; i < files.length; i++) {
                uploadFileToNote(files[i]);
            }
        }
    });
})();

// ============ Edit / Preview ============

function renderPreview() {
    var preview = document.getElementById('note-preview');
    if (!preview) return;
    if (!window._wikiLinksReady) {
        document.addEventListener('wikiLinksReady', function() { renderPreview(); }, { once: true });
        return;
    }
    var content = getEditorContent();
    if (content && content.trim()) {
        var renderedHtml = marked(content);
        preview.innerHTML = sanitizeMarkdown(processCallouts(renderedHtml));
        preview.querySelectorAll('pre code').forEach(function(block) { hljs.highlightElement(block); });
        if (window._decryptAttachments) window._decryptAttachments(preview);
    } else {
        preview.innerHTML = '';
    }
    updateOutline();
}

function toggleMode() {
    if (editMode) {
        enterPreviewMode();
    } else {
        enterEditMode();
    }
}

function enterEditMode() {
    if (editMode) return;
    editMode = true;

    var wrapper = document.getElementById('cm-wrapper');
    var preview = document.getElementById('note-preview');
    if (!wrapper || !preview) return;

    preview.classList.remove('active');
    wrapper.classList.add('active');

    if (!cmEditor) initCodeMirror();
    setTimeout(function() { if (cmEditor) { cmEditor.refresh(); cmEditor.focus(); } }, 10);

    var toggleBtn = document.getElementById('mode-toggle');
    var toggleIcon = document.getElementById('mode-toggle-icon');
    var modeIndicator = document.getElementById('mode-indicator');
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (toggleIcon) toggleIcon.innerHTML = '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
    if (modeIndicator) { modeIndicator.textContent = 'Editing'; modeIndicator.className = 'status-item mode-indicator editing'; }
    saveUiState({ preview_mode: false });
    syncQuickSettingsState();
}

function enterPreviewMode() {
    if (!editMode) return;
    editMode = false;

    var wrapper = document.getElementById('cm-wrapper');
    var preview = document.getElementById('note-preview');
    if (!wrapper || !preview) return;

    renderPreview();
    wrapper.classList.remove('active');
    preview.classList.add('active');

    var toggleBtn = document.getElementById('mode-toggle');
    var toggleIcon = document.getElementById('mode-toggle-icon');
    var modeIndicator = document.getElementById('mode-indicator');
    if (toggleBtn) toggleBtn.classList.add('active');
    if (toggleIcon) toggleIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    if (modeIndicator) { modeIndicator.textContent = 'Preview'; modeIndicator.className = 'status-item mode-indicator preview'; }
    saveUiState({ preview_mode: true });
    syncQuickSettingsState();
}

// ============ Save ============

var outboundLinksTimer = null;
var outlineUpdateTimer = null;

var hasBeenSavedOnce = _pageData.hasNote;

function updateMobileSaveBtn(state) {
    var btn = document.getElementById('mobile-save-btn');
    if (!btn) return;
    btn.classList.remove('saved', 'unsaved');
    if (state === 'unsaved') btn.classList.add('unsaved');
    else if (state === 'saved') btn.classList.add('saved');
}

function markDirty() {
    isDirty = true;
    var s = document.getElementById('save-status');
    if (s) { s.textContent = '\u25CF Unsaved'; s.style.color = 'var(--yellow)'; }
    updateMobileSaveBtn('unsaved');
    updateCounts();
    clearTimeout(autoSaveTimer);
    // Only autosave if enabled and this note has been saved at least once (not a brand new note)
    if (autoSaveEnabled && hasBeenSavedOnce) {
        autoSaveTimer = setTimeout(function() { saveNote(); }, 3000);
    }

    // Update outline and outbound links in right panel (debounced)
    var panel = document.getElementById('right-panel');
    if (panel && !panel.classList.contains('collapsed')) {
        clearTimeout(outboundLinksTimer);
        outboundLinksTimer = setTimeout(updateOutboundLinksFromContent, 500);
        clearTimeout(outlineUpdateTimer);
        outlineUpdateTimer = setTimeout(updateOutline, 500);
    }
}

async function updateOutboundLinksFromContent() {
    var content = getEditorContent();
    var list = document.getElementById('outbound-links-list');
    if (!list || !content) { if (list) list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; return; }

    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        try {
            var data = await FlaskySearch.computeOutboundLinks(content);
            if (data.length === 0) { list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; return; }
            var html = '';
            data.forEach(function(n) {
                html += '<li><a href="/note/' + n.id + '" data-action="open-note-link" data-note-id="' + n.id + '">' + escapeHtml(n.title || 'Untitled') + '</a></li>';
            });
            list.innerHTML = html;
        } catch(e) { list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; }
        return;
    }

    var re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    var match;
    var seen = {};
    var links = [];
    while ((match = re.exec(content)) !== null) {
        var title = match[1].trim();
        var key = title.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        links.push(title);
    }

    if (links.length === 0) { list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; return; }

    loadWikiNoteList(function() {
        var html = '';
        links.forEach(function(title) {
            var key = title.toLowerCase();
            var found = wikiNoteList.find(function(n) { return n.title.toLowerCase() === key; });
            if (found) {
                html += '<li><a href="/note/' + found.id + '" data-action="open-note-link" data-note-id="' + found.id + '">' + escapeHtml(found.title || 'Untitled') + '</a></li>';
            } else {
                html += '<li><span class="backlinks-empty outbound-missing">' + escapeHtml(title) + '</span></li>';
            }
        });
        list.innerHTML = html;
    });
}

function saveNote(callback) {
    var title = document.getElementById('note-title');
    if (!title) { if (callback) callback(); return; }
    if (isSaving) { if (callback) callback(); return; }
    isSaving = true;
    clearTimeout(autoSaveTimer);
    var content = getEditorContent();
    var props = collectProperties();

    // Only prepend frontmatter for non-encrypted saves
    if (!(typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted())) {
        var fm = buildFrontmatter(props);
        if (fm) content = fm + content;
    }

    document.getElementById('save-status').textContent = 'Saving...';
    document.getElementById('save-status').style.color = 'var(--text-muted)';

    _doSaveNote(title.value, content, props, callback);
}

async function _doSaveNote(titleVal, content, props, callback) {
    try {
        var catValue = currentCategory;
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            // Use category ID for E2EE to avoid creating plaintext categories
            var catSelect = document.getElementById('category-select');
            if (catSelect) catValue = parseInt(catSelect.value);
        }
        var payload = { noteId: noteId, title: titleVal, content: content, category: catValue };
        if (currentNoteIcon) {
            payload.icon = currentNoteIcon;
            payload.iconColor = currentNoteIconColor;
        }
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            payload.title = await FlaskyE2EE.encryptField(titleVal);
            payload.content = await FlaskyE2EE.encryptField(content);
            // Encrypt properties as JSON string
            if (props && Object.keys(props).length > 0) {
                payload.properties = await FlaskyE2EE.encryptField(JSON.stringify(props));
            }
        }
    } catch(e) {
        isSaving = false;
        document.getElementById('save-status').textContent = '\u26A0 Encrypt failed';
        document.getElementById('save-status').style.color = 'var(--red)';
        if (callback) callback();
        return;
    }

    fetch('/api/save_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        isSaving = false;
        if (data.success) {
            isDirty = false;
            hasBeenSavedOnce = true;
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.invalidate();
            document.getElementById('save-status').textContent = '\u2713 Saved';
            document.getElementById('save-status').style.color = 'var(--green)';
            updateMobileSaveBtn('saved');
            // For E2EE, server returns encrypted title — use plaintext from DOM
            var displayTitle = (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted())
                ? (document.getElementById('note-title') ? document.getElementById('note-title').value : '')
                : (data.note ? data.note.title : '');
            var needsMapRefresh = false;
            if (noteId === 0 && data.note && data.note.id) {
                noteId = data.note.id;
                history.replaceState(null, '', '/note/' + noteId);
                refreshSidebar();
                var bc = document.querySelector('.breadcrumb-item.active');
                if (bc) bc.textContent = displayTitle || 'Untitled';
                needsMapRefresh = true;
            } else if (data.note) {
                updateSidebarNoteTitle(noteId, displayTitle);
            }
            if (needsMapRefresh && window._invalidateNoteMap) {
                window._invalidateNoteMap();
                if (!editMode) {
                    document.addEventListener('noteMapUpdated', function() { renderPreview(); }, { once: true });
                }
            } else {
                if (!editMode) renderPreview();
            }
        }
        if (callback) callback();
    })
    .catch(function() {
        isSaving = false;
        document.getElementById('save-status').textContent = '\u26A0 Save failed';
        document.getElementById('save-status').style.color = 'var(--red)';
        updateMobileSaveBtn('unsaved');
        if (callback) callback();
    });
}

function updateSidebarNoteTitle(id, title) {
    var item = document.querySelector('.file-item[data-note-id="' + id + '"] .file-name');
    if (item) item.textContent = title || 'Untitled';
    var bc = document.querySelector('.breadcrumb-item.active');
    if (bc) bc.textContent = title || 'Untitled';
}

function updateSidebarAfterSave(note) {
    var catName = note.category || 'Main';
    var targetFolder = null;
    document.querySelectorAll('.folder').forEach(function(f) {
        if (f.querySelector('.folder-name').textContent.trim() === catName) targetFolder = f;
    });
    if (targetFolder) {
        var items = targetFolder.querySelector('.folder-items');
        var div = document.createElement('div');
        div.className = 'file-item active';
        div.setAttribute('data-note-id', note.id);
        div.setAttribute('data-action', 'open-note');
        div.innerHTML = '<span class="file-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="file-name">' + escapeHtml(note.title || 'Untitled') + '</span>';
        items.appendChild(div);
        targetFolder.classList.remove('collapsed');
        var count = targetFolder.querySelector('.folder-count');
        if (count) count.textContent = items.querySelectorAll('.file-item').length;
    }
    var bc = document.querySelector('.breadcrumb-item.active');
    if (bc) bc.textContent = note.title || 'Untitled';
}

function deleteSidebarNote(id, title) {
    if (!confirm('Delete "' + (title || 'Untitled') + '"?')) return;
    var idx = pinnedNotes.indexOf(id);
    if (idx > -1) { pinnedNotes.splice(idx, 1); localStorage.setItem('obsidified-pinned', JSON.stringify(pinnedNotes)); }
    fetch('/api/delete_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: id }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (window._invalidateNoteMap) window._invalidateNoteMap();
            refreshSidebar();
            if (noteId === id) loadNote(0);
        }
    });
}

function deleteCurrentNote() {
    if (!noteId || noteId === 0) return;
    if (!confirm('Delete this note?')) return;
    var idx = pinnedNotes.indexOf(noteId);
    if (idx > -1) { pinnedNotes.splice(idx, 1); localStorage.setItem('obsidified-pinned', JSON.stringify(pinnedNotes)); }
    fetch('/api/delete_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: noteId }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (window._invalidateNoteMap) window._invalidateNoteMap();
            refreshSidebar();
            loadNote(0);
        }
    });
}

// ============ Category / Folder management ============

function changeNoteCategory(categoryId) {
    // For new notes, just update currentCategory so the first save uses it
    if (!noteId || noteId === 0) {
        var sel = document.getElementById('category-select');
        currentCategory = sel.options[sel.selectedIndex].text;
        return;
    }
    fetch('/api/edit_note_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: noteId, category: parseInt(categoryId) }) })
    .then(function(r) { return r.json(); })
    .then(function(data) { if (data.success) { refreshSidebar(); } });
}

function createNewNoteInFolder(catId, catName) {
    if (isDirty) {
        saveNote(function() { loadNote(0, catName, catId); });
    } else {
        loadNote(0, catName, catId);
    }
}

async function promptNewFolder(parentPath) {
    var name = prompt(parentPath ? 'New subfolder in "' + parentPath + '":' : 'New folder name:');
    if (!name || !name.trim()) return;
    var fullPath = parentPath ? parentPath + '/' + name.trim() : name.trim();
    var catName = fullPath;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        catName = await FlaskyE2EE.encryptField(fullPath);
    }
    fetch('/api/add_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryName: catName }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) { refreshSidebar(); }
    });
}

async function deleteFolder(catId, catName) {
    if (!confirm('Delete folder "' + catName + '"?')) return;
    // E2EE: server can't find children by path prefix, so delete them client-side
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        var folder = document.querySelector('.folder[data-category-id="' + catId + '"]');
        var folderPath = folder ? folder.dataset.path : '';
        // Collect child category IDs (deepest first so children are deleted before parents)
        var childIds = [];
        if (folderPath) {
            document.querySelectorAll('.folder[data-path]').forEach(function(f) {
                var p = f.dataset.path;
                if (p.startsWith(folderPath + '/') && f.dataset.categoryId) {
                    childIds.push(parseInt(f.dataset.categoryId));
                }
            });
            childIds.reverse();
        }
        // Delete children first, then the parent
        for (var i = 0; i < childIds.length; i++) {
            await fetch('/api/delete_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: childIds[i] }) });
        }
    }
    var resp = await fetch('/api/delete_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: catId }) });
    var data = await resp.json();
    if (data.success) { refreshSidebar(); }
}

// ============ Drag and drop notes & folders ============

var dragType = null;   // 'note' or 'folder'
var dragNoteId = null;
var dragFolderId = null;
var dragFolderPath = null;
var dragExpandTimer = null;

function onNoteDragStart(e, noteId) {
    e.stopPropagation();
    dragType = 'note';
    dragNoteId = noteId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'note:' + noteId);
    e.target.classList.add('dragging');
}

function onFolderDragStart(e, catId, path) {
    dragType = 'folder';
    dragFolderId = catId;
    dragFolderPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'folder:' + catId);
    e.target.closest('.folder').classList.add('dragging');
    // Show root drop zone when dragging a subfolder (has "/" in path)
    if (path.indexOf('/') !== -1) {
        document.getElementById('root-drop-zone').classList.add('visible');
    }
}

document.addEventListener('dragend', function() {
    dragType = null;
    dragNoteId = null;
    dragFolderId = null;
    dragFolderPath = null;
    clearTimeout(dragExpandTimer);
    document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
    document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    document.getElementById('root-drop-zone').classList.remove('visible');
});

function onItemDragOver(e) {
    if (!dragType) return;
    // Prevent dropping a folder onto itself or its children
    // Let the event propagate so a valid ancestor can handle it instead
    var folder = e.currentTarget.closest('.folder');
    if (dragType === 'folder') {
        var targetPath = folder.dataset.path;
        if (targetPath === dragFolderPath || targetPath.startsWith(dragFolderPath + '/')) return;
    }
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
    // Auto-expand collapsed folders after hovering for 600ms
    if (folder && folder.classList.contains('collapsed')) {
        clearTimeout(dragExpandTimer);
        dragExpandTimer = setTimeout(function() {
            folder.classList.remove('collapsed');
        }, 600);
    }
}

function onItemDragLeave(e) {
    e.stopPropagation();
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    e.currentTarget.classList.remove('drag-over');
    clearTimeout(dragExpandTimer);
}

async function moveCategoryRequest(categoryId, oldPath, targetPath) {
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        // E2EE: compute renames client-side, encrypt new paths
        var leafName = oldPath.split('/').pop();
        var newPath = targetPath ? targetPath + '/' + leafName : leafName;
        var renames = [{ id: categoryId, name: await FlaskyE2EE.encryptField(newPath) }];
        // Find and rename children
        document.querySelectorAll('.folder[data-path]').forEach(function(f) {
            var p = f.dataset.path;
            if (p.startsWith(oldPath + '/')) {
                var childNewPath = newPath + p.slice(oldPath.length);
                var childCatId = f.dataset.categoryId;
                if (childCatId) {
                    renames.push({ id: parseInt(childCatId), _newPath: childNewPath });
                }
            }
        });
        // Encrypt child paths
        for (var i = 1; i < renames.length; i++) {
            renames[i].name = await FlaskyE2EE.encryptField(renames[i]._newPath);
            delete renames[i]._newPath;
        }
        var resp = await fetch('/api/move_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId: categoryId, renames: renames })
        });
        return resp.json();
    } else {
        var resp = await fetch('/api/move_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId: categoryId, targetPath: targetPath })
        });
        return resp.json();
    }
}

function onItemDrop(e, targetPath, targetCatId) {
    var dropEl = e.target.closest ? e.target.closest('[data-drop-target]') : null;
    if (dropEl) dropEl.classList.remove('drag-over');
    if (!dragType) return;

    // Let self-drops propagate so a valid ancestor can handle them
    if (dragType === 'folder') {
        if (targetPath === dragFolderPath) return;
        if (targetPath.startsWith(dragFolderPath + '/')) return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (dragType === 'note') {
        if (targetCatId === null) return;
        var nid = dragNoteId;
        dragType = null;
        fetch('/api/edit_note_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId: nid, category: targetCatId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) { if (data.success) { refreshSidebar(); } });
    } else if (dragType === 'folder') {
        var fid = dragFolderId;
        var fpath = dragFolderPath;
        dragType = null;
        moveCategoryRequest(fid, fpath, targetPath)
        .then(function(data) {
            if (data.success) { refreshSidebar(); }
            else if (data.reason) alert(data.reason);
        });
    }
}

function onRootDragOver(e) {
    if (dragType !== 'folder') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onRootDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onRootDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (dragType !== 'folder') return;
    var fid = dragFolderId;
    var fpath = dragFolderPath;
    dragType = null;
    moveCategoryRequest(fid, fpath, '')
    .then(function(data) {
        if (data.success) { refreshSidebar(); }
        else if (data.reason) alert(data.reason);
    });
}

function promptMoveFolder(catId, currentPath) {
    var folders = [];
    document.querySelectorAll('.folder[data-path]').forEach(function(f) {
        var p = f.dataset.path;
        // Exclude self and children
        if (p !== currentPath && !p.startsWith(currentPath + '/')) {
            folders.push(p);
        }
    });
    var options = '0: (root)\n';
    folders.forEach(function(f, i) { options += (i + 1) + ': ' + f + '\n'; });
    var choice = prompt('Move "' + currentPath + '" to:\n\n' + options + '\nEnter number:');
    if (choice === null) return;
    choice = parseInt(choice);
    var targetPath = '';
    if (choice === 0) {
        targetPath = '';
    } else if (choice > 0 && choice <= folders.length) {
        targetPath = folders[choice - 1];
    } else {
        return;
    }
    moveCategoryRequest(catId, currentPath, targetPath)
    .then(function(data) {
        if (data.success) { refreshSidebar(); }
        else if (data.reason) alert(data.reason);
    });
}

// ============ Icon Picker Helpers ============

function updateNoteIconPreview(icon, color) {
    var btn = document.getElementById('note-icon-btn');
    if (!btn) return;
    if (!icon) {
        btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
        return;
    }
    if (typeof ensureLucideLoaded === 'function') {
        ensureLucideLoaded(function() {
            btn.innerHTML = renderLucideIcon(icon, color, 28);
        });
    }
}

function openNoteIconPicker() {
    if (noteId === 0) return;  // no note yet
    openIconPicker({
        icon: currentNoteIcon,
        color: currentNoteIconColor,
        onSelect: function(icon, color) {
            currentNoteIcon = icon;
            currentNoteIconColor = color;
            updateNoteIconPreview(icon, color);
            fetch('/api/set_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ noteId: noteId, icon: icon, iconColor: color })
            }).then(function() { refreshSidebar(); });
        },
        onRemove: function() {
            currentNoteIcon = null;
            currentNoteIconColor = null;
            updateNoteIconPreview(null, null);
            fetch('/api/set_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ noteId: noteId, icon: null, iconColor: null })
            }).then(function() { refreshSidebar(); });
        }
    });
}

function ctxSetNoteIcon() {
    if (!ctxTarget || !ctxTarget.id) return;
    var targetNoteId = ctxTarget.id;
    hideContextMenu();
    openIconPicker({
        icon: null,
        color: null,
        onSelect: function(icon, color) {
            fetch('/api/set_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ noteId: targetNoteId, icon: icon, iconColor: color })
            }).then(function() {
                refreshSidebar();
                if (targetNoteId === noteId) {
                    currentNoteIcon = icon;
                    currentNoteIconColor = color;
                    updateNoteIconPreview(icon, color);
                }
            });
        },
        onRemove: function() {
            fetch('/api/set_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ noteId: targetNoteId, icon: null, iconColor: null })
            }).then(function() {
                refreshSidebar();
                if (targetNoteId === noteId) {
                    currentNoteIcon = null;
                    currentNoteIconColor = null;
                    updateNoteIconPreview(null, null);
                }
            });
        }
    });
}

function ctxSetFolderIcon() {
    if (!ctxTarget || !ctxTarget.catId) return;
    var catId = ctxTarget.catId;
    hideContextMenu();
    openIconPicker({
        icon: null,
        color: null,
        onSelect: function(icon, color) {
            fetch('/api/set_folder_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId: catId, icon: icon, iconColor: color })
            }).then(function() { refreshSidebar(); });
        },
        onRemove: function() {
            fetch('/api/set_folder_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId: catId, icon: null, iconColor: null })
            }).then(function() { refreshSidebar(); });
        }
    });
}

function ctxSetDefaultNoteIcon() {
    if (!ctxTarget || !ctxTarget.catId) return;
    var catId = ctxTarget.catId;
    hideContextMenu();
    openIconPicker({
        icon: null,
        color: null,
        onSelect: function(icon, color) {
            fetch('/api/set_default_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId: catId, icon: icon, iconColor: color })
            }).then(function() { refreshSidebar(); });
        },
        onRemove: function() {
            fetch('/api/set_default_note_icon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId: catId, icon: null, iconColor: null })
            }).then(function() { refreshSidebar(); });
        }
    });
}

// Render lucide icons in sidebar after it loads
function renderSidebarIcons() {
    var els = document.querySelectorAll('.lucide-icon[data-icon]');
    if (els.length === 0) return;
    if (typeof ensureLucideLoaded === 'function') {
        ensureLucideLoaded(function() {
            els.forEach(function(el) {
                var icon = el.dataset.icon;
                var color = el.dataset.iconColor || null;
                el.innerHTML = renderLucideIcon(icon, color, 18);
            });
        });
    }
}

// ============ Context Menu (right-click / long-press) ============

var ctxMenu = document.getElementById('context-menu');
var ctxTarget = null;  // { type: 'note'|'folder', id, title, path, catId }
var longPressTimer = null;
var longPressTriggered = false;

function showContextMenu(x, y, target) {
    ctxTarget = target;
    var html = '';
    if (target.type === 'note') {
        html += '<div class="context-menu-item" data-action="ctx-rename-note"><svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Rename</div>';
        html += '<div class="context-menu-item" data-action="ctx-move-note"><svg viewBox="0 0 24 24"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg>Move to folder</div>';
        html += '<div class="context-menu-item" data-action="ctx-pin-note"><svg viewBox="0 0 24 24"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>' + (pinnedNotes.indexOf(target.id) > -1 ? 'Unpin' : 'Pin') + '</div>';
        html += '<div class="context-menu-item" data-action="ctx-set-note-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Set icon</div>';
        html += '<div class="context-menu-item" data-action="ctx-save-as-template"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>Save as template</div>';
        html += '<div class="context-menu-sep"></div>';
        html += '<div class="context-menu-item danger" data-action="ctx-delete-note"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</div>';
    } else {
        html += '<div class="context-menu-item" data-action="ctx-rename-folder"><svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Rename</div>';
        html += '<div class="context-menu-item" data-action="ctx-move-folder"><svg viewBox="0 0 24 24"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg>Move</div>';
        html += '<div class="context-menu-item" data-action="ctx-new-note-in-folder"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>New note here</div>';
        html += '<div class="context-menu-item" data-action="ctx-new-subfolder"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>New subfolder</div>';
        html += '<div class="context-menu-sep"></div>';
        html += '<div class="context-menu-item" data-action="ctx-new-from-template"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>New from template</div>';
        html += '<div class="context-menu-item" data-action="ctx-set-default-template"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>Set default template</div>';
        html += '<div class="context-menu-item" data-action="ctx-set-folder-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Set folder icon</div>';
        html += '<div class="context-menu-item" data-action="ctx-set-default-note-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="2"/></svg>Set default note icon</div>';
        html += '<div class="context-menu-sep"></div>';
        html += '<div class="context-menu-item danger" data-action="ctx-delete-folder"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</div>';
    }
    ctxMenu.innerHTML = html;
    ctxMenu.classList.add('visible');
    // Position: ensure it stays within viewport
    var menuW = ctxMenu.offsetWidth, menuH = ctxMenu.offsetHeight;
    var winW = window.innerWidth, winH = window.innerHeight;
    if (x + menuW > winW) x = winW - menuW - 4;
    if (y + menuH > winH) y = winH - menuH - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
}

function hideContextMenu() {
    ctxMenu.classList.remove('visible');
    ctxTarget = null;
}

// Close on click outside or Escape
document.addEventListener('click', function(e) {
    if (!ctxMenu.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideContextMenu();
});

// Extract context info from a sidebar element
function getContextTarget(el) {
    var fileItem = el.closest('.file-item');
    if (fileItem) {
        var nid = parseInt(fileItem.dataset.noteId);
        var title = fileItem.querySelector('.file-name').textContent;
        var folder = fileItem.closest('.folder');
        return { type: 'note', id: nid, title: title, catId: folder ? parseInt(folder.dataset.categoryId) : null, path: folder ? folder.dataset.path : '' };
    }
    var folderHeader = el.closest('.folder-header');
    if (folderHeader) {
        var folder = folderHeader.parentElement;
        var catId = folder.dataset.categoryId ? parseInt(folder.dataset.categoryId) : null;
        var path = folder.dataset.path || '';
        var name = folder.querySelector('.folder-name').textContent;
        return { type: 'folder', id: catId, title: name, catId: catId, path: path };
    }
    return null;
}

// Desktop: right-click
document.getElementById('file-tree').addEventListener('contextmenu', function(e) {
    var target = getContextTarget(e.target);
    if (target) {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, target);
    }
});

// Mobile: long-press (touchstart/touchend)
document.getElementById('file-tree').addEventListener('touchstart', function(e) {
    var target = getContextTarget(e.target);
    if (!target) return;
    longPressTriggered = false;
    longPressTimer = setTimeout(function() {
        longPressTriggered = true;
        var touch = e.touches[0];
        showContextMenu(touch.clientX, touch.clientY, target);
    }, 500);
}, { passive: true });

document.getElementById('file-tree').addEventListener('touchend', function(e) {
    clearTimeout(longPressTimer);
    if (longPressTriggered) {
        e.preventDefault();  // Prevent click from firing after long-press
        longPressTriggered = false;
    }
});

document.getElementById('file-tree').addEventListener('touchmove', function() {
    clearTimeout(longPressTimer);
}, { passive: true });

// ---- Context menu actions ----

async function ctxRenameNote() {
    if (!ctxTarget) return;
    var t = ctxTarget;
    hideContextMenu();
    var newTitle = prompt('Rename note:', t.title);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === t.title) return;
    var body = { noteId: t.id, title: newTitle.trim() };
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        body.title = await FlaskyE2EE.encryptField(newTitle.trim());
    }
    fetch('/api/rename_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (window._invalidateNoteMap) window._invalidateNoteMap();
            refreshSidebar();
            // If this is the currently open note, update the title in the editor
            if (noteId === t.id) {
                var titleEl = document.querySelector('.editor-title');
                if (titleEl) titleEl.value = newTitle.trim();
            }
        } else if (data.reason) alert(data.reason);
    });
}

function ctxMoveNote() {
    if (!ctxTarget) return;
    var t = ctxTarget;
    hideContextMenu();
    var folders = [];
    document.querySelectorAll('.folder[data-category-id]').forEach(function(f) {
        folders.push({ id: parseInt(f.dataset.categoryId), path: f.dataset.path });
    });
    var options = '';
    folders.forEach(function(f, i) { options += (i + 1) + ': ' + f.path + '\n'; });
    var choice = prompt('Move "' + t.title + '" to:\n\n' + options + '\nEnter number:');
    if (choice === null) return;
    choice = parseInt(choice);
    if (choice < 1 || choice > folders.length) return;
    var targetCatId = folders[choice - 1].id;
    fetch('/api/edit_note_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: t.id, category: targetCatId }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) refreshSidebar();
        else if (data.reason) alert(data.reason);
    });
}

function ctxPinNote() {
    if (!ctxTarget) return;
    var id = ctxTarget.id;
    hideContextMenu();
    togglePin(id);
}

function ctxDeleteNote() {
    if (!ctxTarget) return;
    var id = ctxTarget.id, title = ctxTarget.title;
    hideContextMenu();
    deleteSidebarNote(id, title);
}

async function ctxRenameFolder() {
    if (!ctxTarget || !ctxTarget.id) return;
    var t = ctxTarget;
    hideContextMenu();
    var newName = prompt('Rename folder:', t.title);
    if (!newName || !newName.trim() || newName.trim() === t.title) return;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        // E2EE: compute new encrypted path and children renames
        var oldPath = t.path;
        var parts = oldPath.split('/');
        parts[parts.length - 1] = newName.trim();
        var newPath = parts.join('/');
        var renames = [{ id: t.id, name: await FlaskyE2EE.encryptField(newPath) }];
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
        fetch('/api/move_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: t.id, renames: renames }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) refreshSidebar();
            else if (data.reason) alert(data.reason);
        });
    } else {
        fetch('/api/rename_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: t.id, name: newName.trim() }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) refreshSidebar();
            else if (data.reason) alert(data.reason);
        });
    }
}

function ctxMoveFolder() {
    if (!ctxTarget || !ctxTarget.id) return;
    var id = ctxTarget.id, path = ctxTarget.path;
    hideContextMenu();
    promptMoveFolder(id, path);
}

function ctxNewNoteInFolder() {
    if (!ctxTarget || !ctxTarget.id) return;
    var id = ctxTarget.id, path = ctxTarget.path;
    hideContextMenu();
    createNewNoteInFolder(id, path);
}

function ctxNewSubfolder() {
    if (!ctxTarget) return;
    var path = ctxTarget.path;
    hideContextMenu();
    promptNewFolder(path);
}

function ctxDeleteFolder() {
    if (!ctxTarget || !ctxTarget.id) return;
    var id = ctxTarget.id, path = ctxTarget.path;
    hideContextMenu();
    deleteFolder(id, path);
}

async function ctxSaveAsTemplate() {
    if (!ctxTarget) return;
    var t = ctxTarget;
    hideContextMenu();
    var name = prompt('Template name:', t.title);
    if (!name || !name.trim()) return;
    var isE2EE = typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();

    if (t.id === noteId && cmEditor) {
        // Current note: read plaintext from DOM, encrypt if needed
        var content = getEditorContent();
        var props = collectProperties();
        var payload = {
            name: name.trim(),
            content: content,
            properties: Object.keys(props).length > 0 ? props : null,
            icon: currentNoteIcon,
            iconColor: currentNoteIconColor
        };
        if (isE2EE) {
            payload.name = await FlaskyE2EE.encryptField(payload.name);
            payload.content = await FlaskyE2EE.encryptField(payload.content);
            if (payload.properties) {
                payload.properties = await FlaskyE2EE.encryptField(JSON.stringify(payload.properties));
            }
        }
        fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) { cachedTemplates = null; }
            else { alert(data.reason || 'Failed to save template.'); }
        });
    } else {
        // Other note: fetch from server (already encrypted if E2EE), pass through
        fetch('/api/note/' + t.id)
        .then(function(r) { return r.json(); })
        .then(async function(data) {
            var n = data.note;
            var content = n.content || '';
            var props = n.properties || null;
            // For non-E2EE: clean up empty props
            if (!isE2EE && props && typeof props === 'object' && Object.keys(props).length === 0) props = null;
            var encName = name.trim();
            if (isE2EE) {
                encName = await FlaskyE2EE.encryptField(encName);
                // content and props are already encrypted from the server
            }
            return fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: encName, content: content, properties: props, icon: n.icon, iconColor: n.icon_color })
            });
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) { cachedTemplates = null; }
            else { alert(data.reason || 'Failed to save template.'); }
        });
    }
}

var templatePickerFolderId = null;

function ctxNewFromTemplate() {
    if (!ctxTarget || !ctxTarget.id) return;
    var catId = ctxTarget.id;
    hideContextMenu();
    // Open template picker; on selection, create a new note in this folder from the template
    templatePickerMode = 'new_in_folder';
    templatePickerFolderId = catId;
    var title = document.getElementById('template-modal-title');
    if (title) title.textContent = 'New Note from Template';
    document.getElementById('template-overlay').classList.add('visible');
    loadTemplateList();
}

function ctxSetDefaultTemplate() {
    if (!ctxTarget || !ctxTarget.id) return;
    var catId = ctxTarget.id;
    var folderName = ctxTarget.title;
    hideContextMenu();
    // Fetch templates and let user pick one
    fetch('/api/templates')
    .then(function(r) { return r.json(); })
    .then(async function(templates) {
        // E2EE: decrypt template names for display
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            for (var i = 0; i < templates.length; i++) {
                try { templates[i].name = await FlaskyE2EE.decryptField(templates[i].name); } catch(e) {}
            }
        }
        if (templates.length === 0) { alert('No templates yet. Save a note as a template first.'); return; }
        var options = '0: (none — clear default)\n';
        templates.forEach(function(t, i) { options += (i + 1) + ': ' + t.name + '\n'; });
        var choice = prompt('Set default template for "' + folderName + '":\n\n' + options + '\nEnter number:');
        if (choice === null) return;
        choice = parseInt(choice);
        var templateId = choice === 0 ? null : (choice > 0 && choice <= templates.length ? templates[choice - 1].id : undefined);
        if (templateId === undefined) return;
        fetch('/api/set_folder_template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId: catId, templateId: templateId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                refreshSidebar();
            } else {
                alert(data.reason || 'Failed to set default template.');
            }
        });
    });
}

// ============ Panel Widgets ============

var panelWidgets = _pageData.panelWidgets;

function applyWidgetLayout() {
    var container = document.getElementById('right-panel-widgets');
    if (!container) return;
    panelWidgets.forEach(function(w) {
        var el = document.getElementById('widget-' + w.id);
        if (!el) return;
        container.appendChild(el); // reorder
        if (w.visible) {
            el.classList.remove('hidden-widget');
        } else {
            el.classList.add('hidden-widget');
        }
    });
}

function toggleWidgetConfig() {
    var panel = document.getElementById('widget-config-panel');
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) renderWidgetConfigList();
}

function renderWidgetConfigList() {
    var list = document.getElementById('widget-config-list');
    list.innerHTML = '';
    panelWidgets.forEach(function(w, idx) {
        var item = document.createElement('div');
        item.className = 'widget-config-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-widget-idx', idx);
        item.innerHTML =
            '<span class="widget-config-drag-handle"><svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="12" x2="8" y2="12.01"/><line x1="16" y1="12" x2="16" y2="12.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="16" y1="18" x2="16" y2="18.01"/></svg></span>' +
            '<span class="widget-config-label">' + escapeHtml(w.label) + '</span>' +
            '<label class="widget-config-toggle"><input type="checkbox" ' + (w.visible ? 'checked' : '') + ' data-action="toggle-widget-visibility" data-widget-idx="' + idx + '"><span class="wc-slider"></span></label>';

        // Drag events
        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', idx);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function() {
            item.classList.remove('dragging');
            list.querySelectorAll('.widget-config-item').forEach(function(el) { el.classList.remove('drag-over'); });
        });
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', function() {
            item.classList.remove('drag-over');
        });
        item.addEventListener('drop', function(e) {
            e.preventDefault();
            item.classList.remove('drag-over');
            var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            var toIdx = idx;
            if (fromIdx === toIdx) return;
            var moved = panelWidgets.splice(fromIdx, 1)[0];
            panelWidgets.splice(toIdx, 0, moved);
            applyWidgetLayout();
            renderWidgetConfigList();
            saveWidgetConfig();
        });

        // Touch reorder: move up/down on tap-hold (simple approach: up/down buttons for mobile)
        list.appendChild(item);
    });

    // Add mobile move buttons
    if (isMobile) addMobileMoveButtons(list);
}

function addMobileMoveButtons(list) {
    list.querySelectorAll('.widget-config-item').forEach(function(item, idx) {
        var handle = item.querySelector('.widget-config-drag-handle');
        handle.innerHTML = '';
        if (idx > 0) {
            var upBtn = document.createElement('button');
            upBtn.className = 'icon-btn';
            upBtn.style.cssText = 'padding:2px;';
            upBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg>';
            upBtn.onclick = function(e) {
                e.stopPropagation();
                var moved = panelWidgets.splice(idx, 1)[0];
                panelWidgets.splice(idx - 1, 0, moved);
                applyWidgetLayout();
                renderWidgetConfigList();
                saveWidgetConfig();
            };
            handle.appendChild(upBtn);
        }
        if (idx < panelWidgets.length - 1) {
            var downBtn = document.createElement('button');
            downBtn.className = 'icon-btn';
            downBtn.style.cssText = 'padding:2px;';
            downBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>';
            downBtn.onclick = function(e) {
                e.stopPropagation();
                var moved = panelWidgets.splice(idx, 1)[0];
                panelWidgets.splice(idx + 1, 0, moved);
                applyWidgetLayout();
                renderWidgetConfigList();
                saveWidgetConfig();
            };
            handle.appendChild(downBtn);
        }
        item.setAttribute('draggable', 'false');
    });
}

function toggleWidgetVisibility(idx, visible) {
    panelWidgets[idx].visible = visible;
    applyWidgetLayout();
    saveWidgetConfig();
    // Load data for newly visible widgets
    if (visible) refreshWidget(panelWidgets[idx].id);
}

function toggleWidgetCollapse(widgetId) {
    var el = document.getElementById('widget-' + widgetId);
    if (el) el.classList.toggle('collapsed-widget');
}

function saveWidgetConfig() {
    saveUiState({ panel_widgets: panelWidgets });
}

function refreshWidget(widgetId) {
    if (widgetId === 'outline') updateOutline();
    else if (widgetId === 'backlinks') loadBacklinks();
    else if (widgetId === 'outbound_links') loadOutboundLinks();
    else if (widgetId === 'properties') updateRightPanelProps();
    else if (widgetId === 'todos') loadTodosWidget();
    else if (widgetId === 'events') loadEventsWidget();
    else if (widgetId === 'quick_settings') syncQuickSettingsState();
}

function refreshAllVisibleWidgets() {
    panelWidgets.forEach(function(w) {
        if (w.visible) refreshWidget(w.id);
    });
}

// Todos widget
var currentTodoFilter = 'remaining';
var cachedTodos = [];

function setTodoFilter(filter) {
    currentTodoFilter = filter;
    document.querySelectorAll('#todos-filter .agenda-filter-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
    renderTodos();
}

async function loadTodosWidget() {
    var container = document.getElementById('todos-widget-content');
    if (!container) return;
    var widget = document.getElementById('widget-todos');
    if (widget && widget.classList.contains('hidden-widget')) return;

    fetch('/api/get_todos').then(function(r) { return r.json(); })
    .then(async function(todos) {
        cachedTodos = Array.isArray(todos) ? todos : [];
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            for (var i = 0; i < cachedTodos.length; i++) {
                try { cachedTodos[i].title = await FlaskyE2EE.decryptField(cachedTodos[i].title); } catch(e) {}
            }
        }
        renderTodos();
    }).catch(function() {
        container.innerHTML = '<div class="outline-empty">Failed to load</div>';
    });
}

function renderTodos() {
    var container = document.getElementById('todos-widget-content');
    if (!container) return;
    var filtered;
    if (currentTodoFilter === 'remaining') {
        filtered = cachedTodos.filter(function(t) { return !t.completed && !t.archived; });
    } else if (currentTodoFilter === 'completed') {
        filtered = cachedTodos.filter(function(t) { return t.completed; });
    } else {
        filtered = cachedTodos.filter(function(t) { return !t.archived; });
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="outline-empty">No ' + currentTodoFilter + ' to-dos</div>';
        return;
    }

    var html = '';
    filtered.slice(0, 20).forEach(function(t) {
        var checkedClass = t.completed ? ' checked' : '';
        var itemClass = t.completed ? ' completed' : '';
        var dateStr = t.time_until_due || '';
        html += '<div class="agenda-widget-item' + itemClass + '" data-action="open-todo-detail" data-todo-id="' + t.id + '">' +
            '<button class="agenda-todo-check' + checkedClass + '" data-action="complete-todo-widget" data-todo-id="' + t.id + '" title="' + (t.completed ? 'Completed' : 'Complete') + '">' +
            '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></button>' +
            '<span class="agenda-item-title">' + escapeHtml(t.title || 'Untitled') + '</span>' +
            '<span class="agenda-item-date">' + escapeHtml(dateStr) + '</span></div>';
    });
    container.innerHTML = html;
}

function completeTodoWidget(todoId) {
    var todo = cachedTodos.find(function(t) { return t.id === todoId; });
    var newStatus = todo && todo.completed ? '0' : '1';
    fetch('/api/toggle_todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toDoId: todoId, status: newStatus })
    }).then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            cachedTodos.forEach(function(t) {
                if (t.id === todoId) t.completed = (newStatus === '1');
            });
            renderTodos();
        }
    });
}

// Events widget
var cachedEvents = [];

async function loadEventsWidget() {
    var container = document.getElementById('events-widget-content');
    if (!container) return;
    var widget = document.getElementById('widget-events');
    if (widget && widget.classList.contains('hidden-widget')) return;

    fetch('/api/get_events').then(function(r) { return r.json(); })
    .then(async function(events) {
        cachedEvents = Array.isArray(events) ? events : [];
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            for (var i = 0; i < cachedEvents.length; i++) {
                try { cachedEvents[i].title = await FlaskyE2EE.decryptField(cachedEvents[i].title); } catch(e) {}
            }
        }
        renderEvents();
    }).catch(function() {
        container.innerHTML = '<div class="outline-empty">Failed to load</div>';
    });
}

function renderEvents() {
    var container = document.getElementById('events-widget-content');
    if (!container) return;
    if (cachedEvents.length === 0) {
        container.innerHTML = '<div class="outline-empty">No events</div>';
        return;
    }
    var html = '';
    cachedEvents.forEach(function(e) {
        html += '<div class="agenda-widget-item" data-action="open-event-detail" data-event-id="' + e.id + '">' +
            '<span class="agenda-dot event-dot"></span>' +
            '<span class="agenda-item-title">' + escapeHtml(e.title || 'Untitled') + '</span>' +
            '<span class="agenda-item-date">' + escapeHtml(e.time_until_event || '') + '</span></div>';
    });
    container.innerHTML = html;
}

// ============ Todo/Event Modals ============

var currentModalTodoId = null;
var currentModalEventId = null;

function openAgendaModal(id) {
    document.getElementById(id).classList.add('visible');
}
function closeAgendaModal(id) {
    document.getElementById(id).classList.remove('visible');
}

// --- Todo detail ---
function openTodoDetail(todoId) {
    currentModalTodoId = todoId;
    document.getElementById('todo-modal-title').textContent = 'Edit To-do';
    document.getElementById('todo-modal-delete-btn').style.display = '';
    fetch('/api/get_todo/' + todoId).then(function(r) { return r.json(); })
    .then(async function(data) {
        if (data.success) {
            var t = data.todo;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                try { t.title = await FlaskyE2EE.decryptField(t.title); } catch(e) {}
                try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
            }
            document.getElementById('todo-modal-input-title').value = t.title || '';
            document.getElementById('todo-modal-input-date').value = t.date_due ? t.date_due.split('T')[0].split(' ')[0] : '';
            document.getElementById('todo-modal-input-content').value = t.content || '';
            openAgendaModal('todo-detail-overlay');
        }
    });
}

function openAddTodoModal() {
    currentModalTodoId = null;
    document.getElementById('todo-modal-title').textContent = 'New To-do';
    document.getElementById('todo-modal-delete-btn').style.display = 'none';
    document.getElementById('todo-modal-input-title').value = '';
    document.getElementById('todo-modal-input-date').value = '';
    document.getElementById('todo-modal-input-content').value = '';
    openAgendaModal('todo-detail-overlay');
}

function closeTodoDetailModal() {
    closeAgendaModal('todo-detail-overlay');
    currentModalTodoId = null;
}

async function saveFromTodoModal() {
    var title = document.getElementById('todo-modal-input-title').value;
    var date = document.getElementById('todo-modal-input-date').value;
    var content = document.getElementById('todo-modal-input-content').value;
    if (!title || title.trim().length < 1) return;

    var encTitle = title, encContent = content;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        encTitle = await FlaskyE2EE.encryptField(title);
        encContent = await FlaskyE2EE.encryptField(content);
    }

    if (currentModalTodoId) {
        fetch('/api/edit_todo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toDoId: currentModalTodoId, title: encTitle, content: encContent, dateDue: date })
        }).then(function(r) { return r.json(); })
        .then(function() { closeTodoDetailModal(); loadTodosWidget(); });
    } else {
        fetch('/api/add_todo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: encTitle, content: encContent, dateDue: date })
        }).then(function(r) { return r.json(); })
        .then(function() { closeTodoDetailModal(); loadTodosWidget(); });
    }
}

function deleteFromTodoModal() {
    if (!currentModalTodoId) return;
    if (!confirm('Delete this to-do?')) return;
    fetch('/api/delete_todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toDoId: currentModalTodoId })
    }).then(function() {
        cachedTodos = cachedTodos.filter(function(t) { return t.id !== currentModalTodoId; });
        renderTodos();
        closeTodoDetailModal();
    });
}

// --- Event detail ---
function openEventDetail(eventId) {
    currentModalEventId = eventId;
    document.getElementById('event-modal-title').textContent = 'Edit Event';
    document.getElementById('event-modal-delete-btn').style.display = '';
    fetch('/api/get_event/' + eventId).then(function(r) { return r.json(); })
    .then(async function(data) {
        if (data.success) {
            var e = data.event;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                try { e.title = await FlaskyE2EE.decryptField(e.title); } catch(ex) {}
                try { e.content = await FlaskyE2EE.decryptField(e.content); } catch(ex) {}
            }
            document.getElementById('event-modal-input-title').value = e.title || '';
            document.getElementById('event-modal-input-date').value = e.date_of_event ? e.date_of_event.split('T')[0].split(' ')[0] : '';
            document.getElementById('event-modal-input-content').value = e.content || '';
            openAgendaModal('event-detail-overlay');
        }
    });
}

function openAddEventModal() {
    currentModalEventId = null;
    document.getElementById('event-modal-title').textContent = 'New Event';
    document.getElementById('event-modal-delete-btn').style.display = 'none';
    document.getElementById('event-modal-input-title').value = '';
    document.getElementById('event-modal-input-date').value = '';
    document.getElementById('event-modal-input-content').value = '';
    openAgendaModal('event-detail-overlay');
}

function closeEventDetailModal() {
    closeAgendaModal('event-detail-overlay');
    currentModalEventId = null;
}

async function saveFromEventModal() {
    var title = document.getElementById('event-modal-input-title').value;
    var date = document.getElementById('event-modal-input-date').value;
    var content = document.getElementById('event-modal-input-content').value;
    if (!title || title.trim().length < 1) return;

    var encTitle = title, encContent = content;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        encTitle = await FlaskyE2EE.encryptField(title);
        encContent = await FlaskyE2EE.encryptField(content);
    }

    if (currentModalEventId) {
        fetch('/api/edit_event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: currentModalEventId, title: encTitle, content: encContent, dateOfEvent: date })
        }).then(function(r) { return r.json(); })
        .then(function() { closeEventDetailModal(); loadEventsWidget(); });
    } else {
        fetch('/api/add_event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: encTitle, content: encContent, dateOfEvent: date })
        }).then(function(r) { return r.json(); })
        .then(function() { closeEventDetailModal(); loadEventsWidget(); });
    }
}

function deleteFromEventModal() {
    if (!currentModalEventId) return;
    if (!confirm('Delete this event?')) return;
    fetch('/api/delete_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: currentModalEventId })
    }).then(function() {
        cachedEvents = cachedEvents.filter(function(e) { return e.id !== currentModalEventId; });
        renderEvents();
        closeEventDetailModal();
    });
}

// Quick settings sync
function syncQuickSettingsState() {
    var darkEl = document.getElementById('qs-dark-mode');
    var previewEl = document.getElementById('qs-preview-mode');
    var hideTitleEl = document.getElementById('qs-hide-title');
    var propsEl = document.getElementById('qs-props-collapsed');
    var autoSaveEl = document.getElementById('qs-auto-save');
    if (darkEl) darkEl.checked = document.documentElement.getAttribute('data-theme') === 'dark';
    if (previewEl) previewEl.checked = !editMode;
    if (hideTitleEl) hideTitleEl.checked = document.getElementById('note-title') && document.getElementById('note-title').style.display === 'none';
    if (propsEl) propsEl.checked = document.getElementById('props-container') && document.getElementById('props-container').classList.contains('collapsed');
    if (autoSaveEl) autoSaveEl.checked = autoSaveEnabled;
}

function toggleAutoSave() {
    autoSaveEnabled = !autoSaveEnabled;
    if (!autoSaveEnabled) clearTimeout(autoSaveTimer);
    fetch('/api/save_auto_save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSave: autoSaveEnabled ? 1 : 0 })
    });
}

function toggleHideTitle() {
    var titleEl = document.getElementById('note-title');
    if (!titleEl) return;
    var hidden = titleEl.style.display === 'none';
    titleEl.style.display = hidden ? '' : 'none';
    fetch('/api/save_hide_title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideTitle: hidden ? 0 : 1 })
    });
}

// ============ Font size ============

function changeFontSize(delta) {
    currentFontSize = Math.max(10, Math.min(24, currentFontSize + delta));
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
    document.getElementById('font-size-label').textContent = currentFontSize;
    if (cmEditor) cmEditor.refresh();
    fetch('/api/save_font_size/' + currentFontSize);
}

// ============ Theme ============

function toggleDarkMode() {
    var html = document.documentElement;
    var isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('hljs-dark').disabled = isDark;
    document.getElementById('hljs-light').disabled = !isDark;
    var icon = document.getElementById('theme-icon');
    if (isDark) {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
    if (!editMode) renderPreview();
    fetch('/api/save_dark_mode/' + (isDark ? 0 : 1));
    syncQuickSettingsState();
}

// ============ Outline + Backlinks ============

function toggleRightPanel() {
    var panel = document.getElementById('right-panel');
    var btn = document.getElementById('panel-toggle');
    panel.classList.toggle('collapsed');
    var expanded = !panel.classList.contains('collapsed');
    if (expanded) {
        if (btn) btn.classList.add('active');
        refreshAllVisibleWidgets();
    } else {
        if (btn) btn.classList.remove('active');
    }
    if (btn) btn.setAttribute('aria-expanded', expanded);
    panel.setAttribute('aria-hidden', !expanded);
    if (!isMobile) saveUiState({ right_panel_collapsed: !expanded });
}

function updateRightPanelProps() {
    var container = document.getElementById('right-panel-props');
    if (!container) return;
    var props = collectProperties();
    var keys = Object.keys(props);
    if (keys.length === 0) {
        container.innerHTML = '<div class="outline-empty">No properties</div>';
        return;
    }
    var html = '';
    keys.forEach(function(key) {
        var val = props[key];
        if (Array.isArray(val)) val = val.join(', ');
        html += '<div class="right-panel-prop"><span class="right-panel-prop-key">' +
            escapeHtml(key) + '</span><span class="right-panel-prop-val">' +
            escapeHtml(String(val)) + '</span></div>';
    });
    container.innerHTML = html;
}

function updateOutline() {
    var list = document.getElementById('outline-list');
    if (!list) return;
    var content = getEditorContent();
    if (!content || !content.trim()) { list.innerHTML = '<li class="outline-empty">No headings</li>'; return; }

    var headings = [];
    content.split('\n').forEach(function(line) {
        var m = line.match(/^(#{1,6})\s+(.+)$/);
        if (m) headings.push({ level: m[1].length, text: m[2].trim() });
    });

    if (headings.length === 0) { list.innerHTML = '<li class="outline-empty">No headings</li>'; return; }

    var html = '';
    headings.forEach(function(h, i) {
        html += '<li class="h' + h.level + '"><a href="#" data-action="scroll-to-heading" data-heading-index="' + i + '">' + escapeHtml(h.text) + '</a></li>';
    });
    list.innerHTML = html;
}

function scrollToHeading(index) {
    var preview = document.getElementById('note-preview');
    if (preview && preview.classList.contains('active')) {
        var headings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings[index]) headings[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (cmEditor) {
        // Scroll in CodeMirror
        var content = cmEditor.getValue();
        var lines = content.split('\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
            if (/^#{1,6}\s+/.test(lines[i])) {
                if (count === index) { cmEditor.scrollIntoView({ line: i, ch: 0 }, 100); cmEditor.setCursor(i, 0); break; }
                count++;
            }
        }
    }
}

// Active heading tracking on scroll
(function() {
    var editorScroll = document.querySelector('.editor-scroll');
    if (!editorScroll) return;
    var scrollTrackTimer = null;
    editorScroll.addEventListener('scroll', function() {
        clearTimeout(scrollTrackTimer);
        scrollTrackTimer = setTimeout(function() {
            var outlineLinks = document.querySelectorAll('#outline-list a');
            if (outlineLinks.length === 0) return;
            var preview = document.getElementById('note-preview');
            if (!preview || !preview.classList.contains('active')) return;
            var headings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
            var activeIdx = -1;
            for (var i = 0; i < headings.length; i++) {
                var rect = headings[i].getBoundingClientRect();
                if (rect.top <= 120) activeIdx = i;
            }
            outlineLinks.forEach(function(a) { a.classList.remove('active'); });
            if (activeIdx >= 0 && outlineLinks[activeIdx]) outlineLinks[activeIdx].classList.add('active');
        }, 100);
    });
})();

async function loadBacklinks() {
    if (!noteId || noteId === 0) return;
    var list = document.getElementById('backlinks-list');
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        try {
            var title = document.getElementById('note-title');
            var noteTitle = title ? title.value : '';
            if (!noteTitle) { list.innerHTML = '<li class="backlinks-empty">No backlinks</li>'; return; }
            var data = await FlaskySearch.computeBacklinks(noteTitle);
            if (data.length === 0) { list.innerHTML = '<li class="backlinks-empty">No backlinks</li>'; return; }
            var html = '';
            data.forEach(function(n) { html += '<li><a href="/note/' + n.id + '" data-action="open-note-link" data-note-id="' + n.id + '">' + escapeHtml(n.title || 'Untitled') + '</a></li>'; });
            list.innerHTML = html;
        } catch(e) { list.innerHTML = '<li class="backlinks-empty">Failed to load</li>'; }
        return;
    }
    fetch('/api/backlinks/' + noteId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.length === 0) { list.innerHTML = '<li class="backlinks-empty">No backlinks</li>'; return; }
        var html = '';
        data.forEach(function(n) { html += '<li><a href="/note/' + n.id + '" data-action="open-note-link" data-note-id="' + n.id + '">' + escapeHtml(n.title || 'Untitled') + '</a></li>'; });
        list.innerHTML = html;
    })
    .catch(function() { list.innerHTML = '<li class="backlinks-empty">Failed to load</li>'; });
}

function loadOutboundLinks() {
    updateOutboundLinksFromContent();
}

// ============ Search Modal ============

function openSearchModal() {
    document.getElementById('search-overlay').classList.add('visible');
    var input = document.getElementById('search-modal-input');
    input.value = '';
    input.focus();
    document.getElementById('search-results').innerHTML = '';
    searchSelectedIndex = -1;
    searchResults = [];
}

function closeSearchModal() { document.getElementById('search-overlay').classList.remove('visible'); }

function performSearch(query) {
    clearTimeout(searchTimer);
    if (!query || query.length < 2) { document.getElementById('search-results').innerHTML = ''; searchResults = []; searchSelectedIndex = -1; return; }
    document.getElementById('search-results').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">Searching...</div>';
    searchTimer = setTimeout(async function() {
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            try {
                var results = await FlaskySearch.search(query);
                searchResults = results.map(function(r) {
                    return { id: r.id, title: r.title, category: '' };
                });
                searchSelectedIndex = searchResults.length > 0 ? 0 : -1;
                renderSearchResults();
            } catch(e) {
                document.getElementById('search-results').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">Search failed</div>';
            }
        } else {
            fetch('/api/search_notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query }) })
            .then(function(r) { return r.json(); })
            .then(function(data) { searchResults = data; searchSelectedIndex = data.length > 0 ? 0 : -1; renderSearchResults(); })
            .catch(function() { document.getElementById('search-results').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">Search failed</div>'; });
        }
    }, 200);
}

function renderSearchResults() {
    var container = document.getElementById('search-results');
    if (searchResults.length === 0) { container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">No results</div>'; return; }
    var html = '';
    searchResults.forEach(function(note, i) {
        html += '<div class="search-result-item' + (i === searchSelectedIndex ? ' selected' : '') + '" data-action="search-result-click" data-note-id="' + note.id + '" data-result-index="' + i + '">';
        html += '<div class="search-result-title">' + escapeHtml(note.title || 'Untitled') + '</div>';
        html += '<div class="search-result-category">' + escapeHtml(note.category || 'Main') + '</div></div>';
    });
    container.innerHTML = html;
}

// ============ Shortcuts Modal ============

function toggleShortcutsModal() {
    var o = document.getElementById('shortcuts-overlay');
    o.classList.toggle('visible');
}
function closeShortcutsModal() { document.getElementById('shortcuts-overlay').classList.remove('visible'); }

// ============ Counts ============

function updateCounts() {
    var content = getEditorContent();
    var charEl = document.getElementById('char-count');
    var wordEl = document.getElementById('word-count');
    if (charEl) charEl.textContent = (content || '').length + ' chars';
    if (wordEl) { var w = (content || '').trim() ? (content || '').trim().split(/\s+/).length : 0; wordEl.textContent = w + ' words'; }
}

// ============ Frontmatter Properties ============

function togglePropsPanel() {
    var c = document.getElementById('props-container');
    if (c) {
        c.classList.toggle('collapsed');
        saveUiState({ properties_collapsed: c.classList.contains('collapsed') });
    }
}

function addPropRow() {
    var body = document.getElementById('props-body');
    var addBtn = body.querySelector('.prop-add-row');
    var row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = '<div class="prop-key"><input type="text" class="prop-value-input" placeholder="key" style="font-size:12px;font-weight:500;color:var(--text-muted)" data-action="prop-changed"></div>' +
        '<div class="prop-value"><input type="text" class="prop-value-input" placeholder="value" data-action="prop-changed"></div>' +
        '<button class="prop-remove-btn" data-action="remove-prop" title="Remove property"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    body.insertBefore(row, addBtn);

    // Expand the container if collapsed
    var container = document.getElementById('props-container');
    container.classList.remove('collapsed');

    // Focus the key input
    row.querySelector('input').focus();
    onPropChanged();
}

function removeProp(btn) {
    var row = btn.closest('.prop-row');
    row.remove();
    onPropChanged();
}

function collectProperties() {
    var props = {};
    document.querySelectorAll('#props-body .prop-row').forEach(function(row) {
        var keyEl = row.querySelector('.prop-key');
        var valInput = row.querySelector('.prop-value .prop-value-input');
        if (!valInput) return;

        // Key might be a plain div (server-rendered) or an input (newly added)
        var keyInput = keyEl.querySelector('input');
        var key = keyInput ? keyInput.value.trim() : keyEl.textContent.trim();
        var val = valInput.value.trim();

        if (key) {
            // Try to parse comma-separated as array
            if (val.indexOf(',') > -1) {
                props[key] = val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            } else {
                props[key] = val;
            }
        }
    });
    return props;
}

function onPropChanged() {
    markDirty();
    // Update right panel if open
    var panel = document.getElementById('right-panel');
    if (panel && !panel.classList.contains('collapsed')) updateRightPanelProps();
}

function buildFrontmatter(props) {
    if (!props || Object.keys(props).length === 0) return '';
    var lines = ['---'];
    Object.keys(props).forEach(function(key) {
        var val = props[key];
        if (Array.isArray(val)) {
            lines.push(key + ':');
            val.forEach(function(item) { lines.push('  - ' + item); });
        } else {
            lines.push(key + ': ' + val);
        }
    });
    lines.push('---');
    return lines.join('\n') + '\n';
}

// ============ Keyboard shortcuts ============

document.addEventListener('keydown', function(e) {
    // Search modal
    if (document.getElementById('search-overlay').classList.contains('visible')) {
        if (e.key === 'Escape') { e.preventDefault(); closeSearchModal(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); searchSelectedIndex = (searchSelectedIndex + 1) % searchResults.length; renderSearchResults(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); searchSelectedIndex = (searchSelectedIndex - 1 + searchResults.length) % searchResults.length; renderSearchResults(); return; }
        if (e.key === 'Enter' && searchSelectedIndex >= 0) { e.preventDefault(); closeSearchModal(); openNote(searchResults[searchSelectedIndex].id); return; }
        return;
    }
    // Shortcuts modal
    if (document.getElementById('shortcuts-overlay').classList.contains('visible')) {
        if (e.key === 'Escape') { e.preventDefault(); closeShortcutsModal(); return; }
        return;
    }
    // Template modals
    if (document.getElementById('template-overlay').classList.contains('visible')) {
        if (e.key === 'Escape') { e.preventDefault(); closeTemplatePicker(); return; }
        return;
    }
    if (document.getElementById('manage-templates-overlay').classList.contains('visible')) {
        if (e.key === 'Escape') { e.preventDefault(); closeManageTemplates(); return; }
        return;
    }

    var ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 's') { e.preventDefault(); saveNote(); }
    if (ctrl && e.key === 'n') { e.preventDefault(); createNewNote(); }
    if (ctrl && e.key === 'e') { e.preventDefault(); if (editMode) enterPreviewMode(); else enterEditMode(); }
    if (e.key === 'Escape' && editMode && !document.activeElement.closest('.cm-editor')) { enterPreviewMode(); }
    if (ctrl && e.key === 'k') { e.preventDefault(); openSearchModal(); }
    if (ctrl && e.key === 'p' && !editMode) {
        e.preventDefault();
        var sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('collapsed')) toggleSidebar();
        var si = document.getElementById('search-input');
        si.focus(); si.select();
    }
    if (ctrl && e.shiftKey && e.key === 'O') { e.preventDefault(); toggleRightPanel(); }
    if (ctrl && e.key === '/') { e.preventDefault(); toggleShortcutsModal(); }
    if (ctrl && e.key === 'b' && !editMode) { e.preventDefault(); toggleSidebar(); }
});

// ============ Wikilink Autocomplete ============

var wikiAutocomplete = null;
var wikiNoteList = null;
var wikiSelectedIndex = -1;
var wikiFilteredNotes = [];

var _noteMapPromise = null;

function loadWikiNoteList(callback) {
    if (wikiNoteList !== null) { if (callback) callback(); return; }
    if (!_noteMapPromise) {
        _noteMapPromise = fetch('/api/note-map')
        .then(function(r) { return r.json(); })
        .then(async function(data) {
            wikiNoteList = [];
            if (data.encrypted && typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                // E2EE: decrypt note titles
                var notesList = data.notes || [];
                for (var i = 0; i < notesList.length; i++) {
                    try {
                        var decTitle = await FlaskyE2EE.decryptField(notesList[i].title);
                        if (decTitle) {
                            wikiNoteList.push({ title: decTitle, id: notesList[i].id });
                        }
                    } catch (e) {}
                }
            } else {
                var notes = data.notes || {};
                Object.keys(notes).forEach(function(key) {
                    wikiNoteList.push({ title: notes[key].title || key, id: notes[key].id });
                });
            }
            wikiNoteList.sort(function(a, b) { return a.title.localeCompare(b.title); });
            _noteMapPromise = null;
        })
        .catch(function() { wikiNoteList = []; _noteMapPromise = null; });
    }
    _noteMapPromise.then(function() { if (callback) callback(); });
}

function showWikiAutocomplete(cm) {
    var cursor = cm.getCursor();
    var line = cm.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);

    // Find [[ before cursor that isn't closed yet
    var openIdx = before.lastIndexOf('[[');
    if (openIdx === -1) { hideWikiAutocomplete(); return; }
    var afterOpen = before.substring(openIdx + 2);
    if (afterOpen.indexOf(']]') > -1) { hideWikiAutocomplete(); return; }

    var query = afterOpen.toLowerCase();

    loadWikiNoteList(function() {
        wikiFilteredNotes = wikiNoteList.filter(function(n) {
            return n.title.toLowerCase().indexOf(query) > -1;
        }).slice(0, 20);

        if (wikiFilteredNotes.length === 0) { hideWikiAutocomplete(); return; }

        wikiSelectedIndex = 0;

        if (!wikiAutocomplete) {
            wikiAutocomplete = document.createElement('div');
            wikiAutocomplete.className = 'wikilink-autocomplete';
            document.body.appendChild(wikiAutocomplete);
            // Delegated event handlers
            wikiAutocomplete.addEventListener('mousedown', function(e) {
                var item = e.target.closest('.wikilink-autocomplete-item');
                if (item) { e.preventDefault(); acceptWikiAutocomplete(parseInt(item.getAttribute('data-index'))); }
            });
            wikiAutocomplete.addEventListener('mouseover', function(e) {
                var item = e.target.closest('.wikilink-autocomplete-item');
                if (item) { wikiSelectedIndex = parseInt(item.getAttribute('data-index')); renderWikiAutocomplete(); }
            });
        }

        renderWikiAutocomplete();

        // Position dropdown near cursor
        var coords = cm.cursorCoords(true, 'page');
        wikiAutocomplete.style.left = coords.left + 'px';
        wikiAutocomplete.style.top = (coords.bottom + 4) + 'px';
        wikiAutocomplete.style.display = 'block';
    });
}

function renderWikiAutocomplete() {
    if (!wikiAutocomplete) return;
    var html = '';
    wikiFilteredNotes.forEach(function(n, i) {
        html += '<div class="wikilink-autocomplete-item' + (i === wikiSelectedIndex ? ' selected' : '') + '" data-index="' + i + '">' +
            n.title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
    });
    wikiAutocomplete.innerHTML = html;

    var sel = wikiAutocomplete.querySelector('.wikilink-autocomplete-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function hideWikiAutocomplete() {
    if (wikiAutocomplete) wikiAutocomplete.style.display = 'none';
    wikiFilteredNotes = [];
    wikiSelectedIndex = -1;
}

function acceptWikiAutocomplete(index) {
    if (!cmEditor || index < 0 || index >= wikiFilteredNotes.length) return;
    var selected = wikiFilteredNotes[index];
    var cursor = cmEditor.getCursor();
    var line = cmEditor.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);
    var openIdx = before.lastIndexOf('[[');
    if (openIdx === -1) return;

    // autoCloseBrackets inserts ]] after the cursor, so we need to consume them
    var after = line.substring(cursor.ch);
    var extraClose = 0;
    // Count how many ] characters follow the cursor that were auto-inserted
    if (after.indexOf(']]') === 0) extraClose = 2;
    else if (after.indexOf(']') === 0) extraClose = 1;

    var from = { line: cursor.line, ch: openIdx };
    var to = { line: cursor.line, ch: cursor.ch + extraClose };
    var insertText = '[[' + selected.title + ']]';
    cmEditor.replaceRange(insertText, from, to);
    cmEditor.setCursor({ line: cursor.line, ch: openIdx + insertText.length });
    hideWikiAutocomplete();
    cmEditor.focus();

    // Immediately update outbound links
    var panel = document.getElementById('right-panel');
    if (panel && !panel.classList.contains('collapsed')) {
        clearTimeout(outboundLinksTimer);
        updateOutboundLinksFromContent();
    }
}

function isWikiAutocompleteVisible() {
    return wikiAutocomplete && wikiAutocomplete.style.display === 'block';
}

// ============ Callout support for preview ============

var calloutIcons = {
    note: 'pencil', info: 'info', tip: 'flame', hint: 'flame',
    warning: 'alert-triangle', caution: 'alert-triangle', attention: 'alert-triangle',
    danger: 'zap', error: 'x-circle', failure: 'x-circle', fail: 'x-circle', missing: 'x-circle',
    success: 'check-circle', check: 'check-circle', done: 'check-circle',
    question: 'help-circle', help: 'help-circle', faq: 'help-circle',
    example: 'list', quote: 'quote', cite: 'quote',
    abstract: 'clipboard', summary: 'clipboard', tldr: 'clipboard',
    bug: 'bug', todo: 'check-square'
};

function getCalloutIcon(type) {
    var iconName = calloutIcons[type] || 'info';
    var icons = {
        'pencil': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        'info': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        'flame': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 1.5 3z"/></svg>',
        'alert-triangle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        'zap': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        'x-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        'check-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        'help-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        'list': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        'quote': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>',
        'clipboard': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
        'bug': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 10h2"/><path d="M3 10h2"/><path d="M19 14h2"/><path d="M3 14h2"/><path d="M19 18h2"/><path d="M3 18h2"/><path d="M9 2l1.5 3"/><path d="M15 2l-1.5 3"/></svg>',
        'check-square': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    };
    return '<span class="callout-title-icon">' + (icons[iconName] || icons['info']) + '</span>';
}

function processCallouts(html) {
    // Transform blockquotes with [!TYPE] into callout divs
    // marked.js renders > lines as <blockquote><p>content</p></blockquote>
    var div = document.createElement('div');
    div.innerHTML = html;

    div.querySelectorAll('blockquote').forEach(function(bq) {
        var firstP = bq.querySelector('p');
        if (!firstP) return;
        var text = firstP.innerHTML;
        // Match [!TYPE] possibly followed by title text
        var match = text.match(/^\[!(\w+)\]\s*(.*)/);
        if (!match) return;

        var calloutType = match[1].toLowerCase();
        var titleText = match[2] || calloutType.charAt(0).toUpperCase() + calloutType.slice(1);

        // Build callout
        var callout = document.createElement('div');
        callout.className = 'callout';
        callout.setAttribute('data-callout', calloutType);

        var titleDiv = document.createElement('div');
        titleDiv.className = 'callout-title';
        titleDiv.innerHTML = getCalloutIcon(calloutType) + '<span>' + escapeHtml(titleText) + '</span>';
        callout.appendChild(titleDiv);

        // Remaining content: everything after the first line in the first <p>, plus other children
        var contentDiv = document.createElement('div');
        contentDiv.className = 'callout-content';

        // Check if there's content after the title in the same <p>
        // The first <p> might contain <br> separated lines
        var afterTitle = text.substring(match[0].length);
        if (afterTitle.trim()) {
            var p = document.createElement('p');
            p.innerHTML = afterTitle.replace(/^<br\s*\/?>/, '');
            if (p.innerHTML.trim()) contentDiv.appendChild(p);
        }

        // Add remaining elements from the blockquote
        var children = Array.from(bq.children);
        for (var i = 0; i < children.length; i++) {
            if (children[i] === firstP) continue;
            contentDiv.appendChild(children[i].cloneNode(true));
        }

        if (contentDiv.innerHTML.trim()) {
            callout.appendChild(contentDiv);
        }

        bq.parentNode.replaceChild(callout, bq);
    });

    return div.innerHTML;
}

// ============ Slash Commands ============

var slashPopup = null;
var slashSelectedIndex = -1;
var slashFilteredCommands = [];
var slashTriggerLine = -1;
var slashTriggerCh = -1;

var slashCommands = [
    { label: 'Heading 1', icon: 'H1', insert: '# ' },
    { label: 'Heading 2', icon: 'H2', insert: '## ' },
    { label: 'Heading 3', icon: 'H3', insert: '### ' },
    { label: 'Callout', icon: '!', insert: '> [!note] \n> ' },
    { label: 'Code block', icon: '{}', insert: '```\n\n```', cursorBack: 4 },
    { label: 'Divider', icon: '--', insert: '---\n' },
    { label: 'Table', icon: '||', insert: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n' },
    { label: 'Checkbox list', icon: '[]', insert: '- [ ] ' },
    { label: 'Bullet list', icon: '-', insert: '- ' },
    { label: 'Numbered list', icon: '1.', insert: '1. ' },
    { label: 'Date (today)', icon: 'D', insert: '__DATE__' },
    { label: 'Insert template', icon: 'T', action: 'template' },
    { label: 'Save as template', icon: 'S', action: 'save_template' },
    { label: 'New from template', icon: 'N', action: 'new_from_template' },
    { label: 'Manage templates', icon: 'M', action: 'manage_templates' },
];

function showSlashCommands(cm) {
    if (isWikiAutocompleteVisible()) return;
    var cursor = cm.getCursor();
    var line = cm.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);

    // Find / at start of line or after whitespace
    var slashMatch = before.match(/(^|\s)\/([\w\s]*)$/);
    if (!slashMatch) { hideSlashCommands(); return; }

    var query = slashMatch[2].toLowerCase();
    slashTriggerLine = cursor.line;
    slashTriggerCh = cursor.ch - slashMatch[0].length + (slashMatch[1] ? 1 : 0);

    slashFilteredCommands = slashCommands.filter(function(cmd) {
        return cmd.label.toLowerCase().indexOf(query) > -1;
    });

    if (slashFilteredCommands.length === 0) { hideSlashCommands(); return; }
    slashSelectedIndex = 0;

    if (!slashPopup) {
        slashPopup = document.createElement('div');
        slashPopup.className = 'slash-command-popup';
        document.body.appendChild(slashPopup);
    }

    renderSlashCommands();
    var coords = cm.cursorCoords(true, 'page');
    var popupLeft = coords.left;
    var popupWidth = slashPopup.offsetWidth || 220;
    if (popupLeft + popupWidth > window.innerWidth) {
        popupLeft = Math.max(4, window.innerWidth - popupWidth - 4);
    }
    slashPopup.style.left = popupLeft + 'px';
    slashPopup.style.top = (coords.bottom + 4) + 'px';
    slashPopup.style.display = 'block';
}

function renderSlashCommands() {
    if (!slashPopup) return;
    var html = '';
    slashFilteredCommands.forEach(function(cmd, i) {
        html += '<div class="slash-command-item' + (i === slashSelectedIndex ? ' selected' : '') + '" data-index="' + i + '">';
        html += '<span class="slash-command-icon">' + cmd.icon + '</span>';
        html += '<span>' + cmd.label + '</span>';
        html += '</div>';
    });
    slashPopup.innerHTML = html;
    slashPopup.querySelectorAll('.slash-command-item').forEach(function(item) {
        item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            acceptSlashCommand(parseInt(item.getAttribute('data-index')));
        });
        item.addEventListener('touchend', function(e) {
            e.preventDefault();
            acceptSlashCommand(parseInt(item.getAttribute('data-index')));
        });
        item.addEventListener('mouseenter', function() {
            slashSelectedIndex = parseInt(item.getAttribute('data-index'));
            renderSlashCommands();
        });
    });
    var sel = slashPopup.querySelector('.slash-command-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function hideSlashCommands() {
    if (slashPopup) slashPopup.style.display = 'none';
    slashFilteredCommands = [];
    slashSelectedIndex = -1;
}

function isSlashCommandVisible() {
    return slashPopup && slashPopup.style.display === 'block';
}

function acceptSlashCommand(index) {
    if (!cmEditor || index < 0 || index >= slashFilteredCommands.length) return;
    var cmd = slashFilteredCommands[index];
    var cursor = cmEditor.getCursor();
    var line = cmEditor.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);

    // Find the / trigger position
    var slashMatch = before.match(/(^|\s)\/([\w\s]*)$/);
    if (!slashMatch) { hideSlashCommands(); return; }
    var slashStart = cursor.ch - slashMatch[0].length + (slashMatch[1].length);

    hideSlashCommands();

    if (cmd.action === 'template') {
        cmEditor.replaceRange('', { line: cursor.line, ch: slashStart }, cursor);
        openTemplatePicker('insert');
        return;
    }
    if (cmd.action === 'save_template') {
        cmEditor.replaceRange('', { line: cursor.line, ch: slashStart }, cursor);
        saveCurrentAsTemplate();
        return;
    }
    if (cmd.action === 'new_from_template') {
        cmEditor.replaceRange('', { line: cursor.line, ch: slashStart }, cursor);
        openTemplatePicker('new');
        return;
    }
    if (cmd.action === 'manage_templates') {
        cmEditor.replaceRange('', { line: cursor.line, ch: slashStart }, cursor);
        openManageTemplates();
        return;
    }

    var text = cmd.insert;
    if (text === '__DATE__') {
        text = new Date().toISOString().split('T')[0];
    }

    cmEditor.replaceRange(text, { line: cursor.line, ch: slashStart }, cursor);

    if (cmd.cursorBack) {
        var newCursor = cmEditor.getCursor();
        cmEditor.setCursor({ line: newCursor.line, ch: newCursor.ch - cmd.cursorBack });
    }

    cmEditor.focus();
}

// ============ Template Picker ============

var templatePickerMode = 'insert'; // 'insert' or 'new'
var cachedTemplates = null;

function openTemplatePicker(mode) {
    templatePickerMode = mode || 'insert';
    var title = document.getElementById('template-modal-title');
    if (title) title.textContent = mode === 'new' ? 'New Note from Template' : 'Insert Template';
    document.getElementById('template-overlay').classList.add('visible');
    loadTemplateList();
}

function closeTemplatePicker() {
    document.getElementById('template-overlay').classList.remove('visible');
}

function loadTemplateList() {
    var container = document.getElementById('template-list');
    container.innerHTML = '<div class="template-empty">Loading...</div>';
    fetch('/api/templates')
    .then(function(r) { return r.json(); })
    .then(async function(data) {
        // E2EE: decrypt template names
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            for (var i = 0; i < data.length; i++) {
                try { data[i].name = await FlaskyE2EE.decryptField(data[i].name); } catch(e) {}
            }
        }
        cachedTemplates = data;
        if (data.length === 0) {
            container.innerHTML = '<div class="template-empty">No templates yet. Save a note as a template to get started.</div>';
            return;
        }
        var html = '';
        data.forEach(function(t, i) {
            html += '<div class="template-item" data-action="apply-template" data-template-id="' + t.id + '">';
            html += '<span class="template-item-name">' + t.name.replace(/</g, '&lt;') + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    })
    .catch(function() {
        container.innerHTML = '<div class="template-empty">Failed to load templates.</div>';
    });
}

function applyTemplate(templateId) {
    fetch('/api/templates/' + templateId)
    .then(function(r) { return r.json(); })
    .then(async function(t) {
        // E2EE: decrypt template fields
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
            if (t.properties && typeof t.properties === 'string') {
                try { t.properties = JSON.parse(await FlaskyE2EE.decryptField(t.properties)); } catch(e) { t.properties = {}; }
            }
        }
        if (templatePickerMode === 'insert') {
            // Insert at cursor position
            if (cmEditor) {
                var content = t.content || '';
                cmEditor.replaceRange(content, cmEditor.getCursor());
                cmEditor.focus();
            }
        } else if (templatePickerMode === 'new_in_folder' && templatePickerFolderId) {
            // Create a new note in the target folder, then populate from template
            var catId = templatePickerFolderId;
            var folderEl = document.querySelector('.folder[data-category-id="' + catId + '"]');
            var catName = folderEl ? folderEl.dataset.path : '';
            templatePickerFolderId = null;
            var pendingTemplate = t;
            if (isDirty) {
                saveNote(function() {
                    loadNote(0, catName, catId);
                    setTimeout(function() { populateFromTemplate(pendingTemplate); }, 100);
                });
            } else {
                loadNote(0, catName, catId);
                setTimeout(function() { populateFromTemplate(pendingTemplate); }, 100);
            }
        } else {
            // 'new' mode: populate the full note
            populateFromTemplate(t);
        }
        closeTemplatePicker();
    });
}

function populateFromTemplate(t) {
    // Set content
    if (cmEditor && t.content) {
        cmEditor.setValue(t.content);
    }
    // Set properties
    if (t.properties && Object.keys(t.properties).length > 0) {
        var body = document.getElementById('props-body');
        var addBtn = body.querySelector('.prop-add-row');
        // Remove existing prop rows
        body.querySelectorAll('.prop-row').forEach(function(row) { row.remove(); });
        Object.keys(t.properties).forEach(function(key) {
            var val = t.properties[key];
            if (Array.isArray(val)) val = val.join(', ');
            var row = document.createElement('div');
            row.className = 'prop-row';
            row.setAttribute('data-prop-key', key);
            row.innerHTML = '<div class="prop-key">' + key.replace(/</g, '&lt;') + '</div>' +
                '<div class="prop-value"><input type="text" class="prop-value-input" value="' + String(val).replace(/"/g, '&quot;') + '" data-action="prop-changed"></div>' +
                '<button class="prop-remove-btn" data-action="remove-prop" title="Remove property"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
            body.insertBefore(row, addBtn);
        });
        // Expand props panel
        var container = document.getElementById('props-container');
        if (container) container.classList.remove('collapsed');
    }
    // Apply template icon
    if (t.icon) {
        currentNoteIcon = t.icon;
        currentNoteIconColor = t.icon_color || null;
        updateNoteIconPreview(t.icon, t.icon_color);
    }
    markDirty();
}

async function saveCurrentAsTemplate() {
    var name = prompt('Template name:');
    if (!name || !name.trim()) return;
    var content = getEditorContent();
    var props = collectProperties();
    var payload = {
        name: name.trim(),
        content: content,
        properties: Object.keys(props).length > 0 ? props : null
    };
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        payload.name = await FlaskyE2EE.encryptField(payload.name);
        payload.content = await FlaskyE2EE.encryptField(payload.content);
        if (payload.properties) {
            payload.properties = await FlaskyE2EE.encryptField(JSON.stringify(payload.properties));
        }
    }
    fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            cachedTemplates = null;
            loadTemplateList();
        } else {
            alert(data.reason || 'Failed to save template.');
        }
    });
}

// ============ Manage Templates ============

function openManageTemplates() {
    closeTemplatePicker();
    document.getElementById('manage-templates-overlay').classList.add('visible');
    loadManageTemplateList();
}

function closeManageTemplates() {
    document.getElementById('manage-templates-overlay').classList.remove('visible');
}

function loadManageTemplateList() {
    var container = document.getElementById('manage-template-list');
    container.innerHTML = '<div class="template-empty">Loading...</div>';
    fetch('/api/templates')
    .then(function(r) { return r.json(); })
    .then(async function(data) {
        // E2EE: decrypt template names
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            for (var i = 0; i < data.length; i++) {
                try { data[i].name = await FlaskyE2EE.decryptField(data[i].name); } catch(e) {}
            }
        }
        if (data.length === 0) {
            container.innerHTML = '<div class="template-empty">No templates yet.</div>';
            return;
        }
        var html = '';
        data.forEach(function(t) {
            var safeName = t.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            html += '<div class="template-item" data-template-id="' + t.id + '" data-template-name="' + safeName + '">';
            html += '<span class="template-item-name">' + safeName + '</span>';
            html += '<div class="template-item-actions">';
            html += '<button class="icon-btn template-assign-btn" title="Set as folder default">';
            html += '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>';
            html += '<button class="icon-btn danger template-delete-btn" title="Delete template">';
            html += '<svg viewBox="0 0 24 24" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
            html += '</div></div>';
        });
        container.innerHTML = html;
        container.querySelectorAll('.template-assign-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var item = btn.closest('.template-item');
                assignTemplateToFolder(parseInt(item.dataset.templateId), item.dataset.templateName);
            });
        });
        container.querySelectorAll('.template-delete-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var item = btn.closest('.template-item');
                deleteTemplate(parseInt(item.dataset.templateId), item.dataset.templateName);
            });
        });
    });
}

function deleteTemplate(id, name) {
    if (!confirm('Delete template "' + name + '"?')) return;
    fetch('/api/templates/' + id, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            cachedTemplates = null;
            loadManageTemplateList();
        }
    });
}

function assignTemplateToFolder(templateId, templateName) {
    var folders = [];
    document.querySelectorAll('.folder[data-category-id]').forEach(function(f) {
        folders.push({ id: f.dataset.categoryId, path: f.dataset.path });
    });
    if (folders.length === 0) { alert('No folders available.'); return; }
    var options = '0: (none — clear default)\n';
    folders.forEach(function(f, i) { options += (i + 1) + ': ' + f.path + '\n'; });
    var choice = prompt('Assign "' + templateName + '" as default template for folder:\n\n' + options + '\nEnter number:');
    if (choice === null) return;
    choice = parseInt(choice);
    if (choice === 0) {
        // Clear all assignments for this template
        folders.forEach(function(f) {
            fetch('/api/set_folder_template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryId: parseInt(f.id), templateId: null })
            });
        });
        return;
    }
    if (choice > 0 && choice <= folders.length) {
        var folder = folders[choice - 1];
        fetch('/api/set_folder_template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoryId: parseInt(folder.id), templateId: templateId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) alert('Template assigned to "' + folder.path + '".');
        });
    }
}

// ============ Responsive ============

window.addEventListener('resize', function() { isMobile = window.innerWidth <= 768; });

// ============ Init ============

(function() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.getElementById('hljs-dark').disabled = !isDark;
    document.getElementById('hljs-light').disabled = isDark;

    var titleInput = document.getElementById('note-title');
    if (titleInput) titleInput.addEventListener('input', markDirty);

    var ta = document.getElementById('note-content');
    if (ta) {
        if (editMode) {
            initCodeMirror();
            setTimeout(function() { if (cmEditor) cmEditor.refresh(); }, 20);
        } else {
            if (window._wikiLinksReady) {
                renderPreview();
            } else {
                document.addEventListener('wikiLinksReady', function() { renderPreview(); }, { once: true });
            }
        }

        // New note with default template → populate (decrypt if E2EE)
        if (noteId === 0 && defaultTemplateContent !== null) {
            setTimeout(async function() {
                var tContent = defaultTemplateContent;
                var tProps = defaultTemplateProps || {};
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                    try { tContent = await FlaskyE2EE.decryptField(tContent); } catch(e) {}
                    if (tProps && typeof tProps === 'string') {
                        try { tProps = JSON.parse(await FlaskyE2EE.decryptField(tProps)); } catch(e) { tProps = {}; }
                    }
                }
                populateFromTemplate({ content: tContent, properties: tProps });
            }, 50);
        }

        // New note → focus title
        if (noteId === 0 && titleInput) titleInput.focus();
    }

    // Intercept note links in preview to avoid full page refresh
    var previewEl = document.getElementById('note-preview');
    if (previewEl) {
        previewEl.addEventListener('click', function(e) {
            var a = e.target.closest('a[href]');
            if (!a) return;
            var match = a.getAttribute('href').match(/^\/note\/(\d+)$/);
            if (match) {
                e.preventDefault();
                openNote(parseInt(match[1], 10));
            }
        });
    }

    updateCounts();
    renderPinnedNotes();
    updatePinButtons();
    renderSidebarIcons();

    // Also render the note title icon if present
    if (currentNoteIcon && typeof renderLucideIcon === 'function') {
        updateNoteIconPreview(currentNoteIcon, currentNoteIconColor);
    }

    // Apply widget layout from saved config
    applyWidgetLayout();
    syncQuickSettingsState();

    // Populate right panel if open on load
    var rp = document.getElementById('right-panel');
    if (rp && !rp.classList.contains('collapsed')) {
        refreshAllVisibleWidgets();
    }

    // E2EE: init and decrypt page data
    if (typeof FlaskyE2EE !== 'undefined') {
        FlaskyE2EE.init().then(async function(ok) {
            if (!ok) return; // redirected to /unlock
            if (!FlaskyE2EE.isEncrypted()) return;
            var dataEl = document.getElementById('encrypted-note-data');
            if (dataEl) {
                try {
                    var enc = JSON.parse(dataEl.textContent);
                    var title = await FlaskyE2EE.decryptField(enc.title);
                    var content = await FlaskyE2EE.decryptField(enc.content);
                    var props = null;
                    if (enc.properties) {
                        try {
                            var decProps = await FlaskyE2EE.decryptField(enc.properties);
                            props = JSON.parse(decProps);
                        } catch(e) { props = {}; }
                    }
                    // Populate DOM
                    var titleEl = document.getElementById('note-title');
                    if (titleEl) titleEl.value = title || '';
                    if (cmEditor) cmEditor.setValue(content || '');
                    else {
                        var ta = document.getElementById('note-content');
                        if (ta) ta.value = content || '';
                    }
                    // Update breadcrumb and page title
                    var bc = document.querySelector('.breadcrumb-item.active');
                    if (bc) bc.textContent = title || 'Untitled';
                    document.title = (title || 'Untitled') + ' \u2014 Obsidified';
                    // Populate properties
                    if (props) {
                        var propsBody = document.getElementById('props-body');
                        if (propsBody) {
                            propsBody.querySelectorAll('.prop-row').forEach(function(r) { r.remove(); });
                            var addBtn = propsBody.querySelector('.prop-add-row');
                            Object.keys(props).forEach(function(key) {
                                var val = props[key];
                                if (Array.isArray(val)) val = val.join(', ');
                                var row = document.createElement('div');
                                row.className = 'prop-row';
                                row.setAttribute('data-prop-key', key);
                                row.innerHTML = '<div class="prop-key"><input type="text" class="prop-value-input" value="" style="font-size:12px;font-weight:500;color:var(--text-muted)" data-action="prop-changed"></div><div class="prop-value"><input type="text" class="prop-value-input" value="" data-action="prop-changed"></div><button class="prop-remove-btn" data-action="remove-prop" title="Remove property"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
                                row.querySelector('.prop-key .prop-value-input').value = key;
                                row.querySelector('.prop-value .prop-value-input').value = val || '';
                                if (addBtn) propsBody.insertBefore(row, addBtn);
                            });
                        }
                    }
                    // Render preview if in preview mode
                    if (!editMode && typeof renderPreview === 'function') renderPreview();
                } catch(e) {
                    console.error('E2EE page decrypt failed:', e);
                }
            }
            // Decrypt currentCategory variable and category select options
            try { currentCategory = await FlaskyE2EE.decryptField(currentCategory); } catch(e) {}
            var catSelect = document.getElementById('category-select');
            if (catSelect) {
                for (var i = 0; i < catSelect.options.length; i++) {
                    try { catSelect.options[i].textContent = await FlaskyE2EE.decryptField(catSelect.options[i].textContent.trim()); } catch(e) {}
                }
            }
            // Rebuild sidebar client-side (decrypts titles, builds subfolder tree, sorts alphabetically)
            refreshSidebar(function() {
                FlaskyE2EE.revealContent();
            });
        });
    }
})();

// ============ Event Delegation ============

function _findAction(el) {
    while (el && el !== document.body) {
        if (el.dataset && el.dataset.action) return el;
        el = el.parentElement;
    }
    return null;
}

// Click delegation
document.addEventListener('click', function(e) {
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;

    // Actions that need stopPropagation (sidebar buttons inside other clickable elements)
    var stopPropActions = {
        'new-note-in-folder':1,'move-folder':1,'new-subfolder':1,'delete-folder':1,
        'delete-sidebar-note':1,'toggle-pin':1,'open-add-todo':1,'open-add-event':1,
        'complete-todo-widget':1
    };
    if (stopPropActions[action]) e.stopPropagation();

    switch (action) {
        case 'close-sidebar': closeSidebar(); break;
        case 'new-folder': promptNewFolder(); break;
        case 'create-new-note': createNewNote(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
        case 'toggle-mode': toggleMode(); break;
        case 'open-search': openSearchModal(); break;
        case 'toggle-right-panel': toggleRightPanel(); break;
        case 'toggle-dark-mode': toggleDarkMode(); break;
        case 'toggle-shortcuts': toggleShortcutsModal(); break;
        case 'delete-current-note': deleteCurrentNote(); break;
        case 'open-note-icon-picker': openNoteIconPicker(); break;
        case 'toggle-props-panel': togglePropsPanel(); break;
        case 'add-prop-row': addPropRow(); break;
        case 'remove-prop': removeProp(el); break;
        case 'toggle-widget-config': toggleWidgetConfig(); break;
        case 'save-note': saveNote(); break;
        case 'change-font-size': changeFontSize(parseInt(el.dataset.delta)); break;
        case 'toggle-widget-collapse': toggleWidgetCollapse(el.dataset.widgetId); break;
        case 'open-add-todo': openAddTodoModal(); break;
        case 'open-add-event': openAddEventModal(); break;
        case 'set-todo-filter': setTodoFilter(el.dataset.filter); break;
        case 'toggle-folder':
            var folder = el.closest('.folder');
            if (folder) toggleFolder(folder);
            break;
        case 'open-note':
            var noteEl = el.closest('[data-note-id]');
            if (noteEl) openNote(parseInt(noteEl.dataset.noteId));
            break;
        case 'open-note-link':
            e.preventDefault();
            openNote(parseInt(el.dataset.noteId));
            break;
        case 'new-note-in-folder':
            createNewNoteInFolder(parseInt(el.dataset.categoryId), el.dataset.path);
            break;
        case 'move-folder':
            promptMoveFolder(parseInt(el.dataset.categoryId), el.dataset.path);
            break;
        case 'new-subfolder':
            promptNewFolder(el.dataset.path);
            break;
        case 'delete-folder':
            deleteFolder(parseInt(el.dataset.categoryId), el.dataset.path);
            break;
        case 'delete-sidebar-note':
            deleteSidebarNote(parseInt(el.dataset.noteId), el.dataset.noteTitle);
            break;
        case 'toggle-pin':
            togglePin(parseInt(el.dataset.noteId));
            break;
        case 'open-todo-detail':
            openTodoDetail(parseInt(el.dataset.todoId));
            break;
        case 'complete-todo-widget':
            completeTodoWidget(parseInt(el.dataset.todoId));
            break;
        case 'open-event-detail':
            openEventDetail(parseInt(el.dataset.eventId));
            break;
        case 'scroll-to-heading':
            e.preventDefault();
            scrollToHeading(parseInt(el.dataset.headingIndex));
            break;
        case 'search-result-click':
            closeSearchModal();
            openNote(parseInt(el.dataset.noteId));
            break;
        case 'apply-template':
            applyTemplate(parseInt(el.dataset.templateId));
            break;
        case 'close-template-picker': closeTemplatePicker(); break;
        case 'save-current-as-template': saveCurrentAsTemplate(); break;
        case 'open-manage-templates': openManageTemplates(); break;
        case 'close-manage-templates': closeManageTemplates(); break;
        case 'close-todo-modal': closeTodoDetailModal(); break;
        case 'delete-from-todo-modal': deleteFromTodoModal(); break;
        case 'save-from-todo-modal': saveFromTodoModal(); break;
        case 'close-event-modal': closeEventDetailModal(); break;
        case 'delete-from-event-modal': deleteFromEventModal(); break;
        case 'save-from-event-modal': saveFromEventModal(); break;
        case 'close-modal-self':
            if (e.target === el) {
                var closeFn = el.dataset.modalClose;
                if (closeFn && typeof window[closeFn] === 'function') window[closeFn]();
            }
            break;
        // Context menu actions
        case 'ctx-rename-note': ctxRenameNote(); break;
        case 'ctx-move-note': ctxMoveNote(); break;
        case 'ctx-pin-note': ctxPinNote(); break;
        case 'ctx-set-note-icon': ctxSetNoteIcon(); break;
        case 'ctx-save-as-template': ctxSaveAsTemplate(); break;
        case 'ctx-delete-note': ctxDeleteNote(); break;
        case 'ctx-rename-folder': ctxRenameFolder(); break;
        case 'ctx-move-folder': ctxMoveFolder(); break;
        case 'ctx-new-note-in-folder': ctxNewNoteInFolder(); break;
        case 'ctx-new-subfolder': ctxNewSubfolder(); break;
        case 'ctx-new-from-template': ctxNewFromTemplate(); break;
        case 'ctx-set-default-template': ctxSetDefaultTemplate(); break;
        case 'ctx-set-folder-icon': ctxSetFolderIcon(); break;
        case 'ctx-set-default-note-icon': ctxSetDefaultNoteIcon(); break;
        case 'ctx-delete-folder': ctxDeleteFolder(); break;
    }
});

// Change delegation
document.addEventListener('change', function(e) {
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;
    switch (action) {
        case 'change-category': changeNoteCategory(el.value); break;
        case 'prop-changed': onPropChanged(); break;
        case 'toggle-widget-visibility':
            toggleWidgetVisibility(parseInt(el.dataset.widgetIdx), el.checked);
            break;
        case 'qs-toggle-dark-mode': toggleDarkMode(); break;
        case 'qs-toggle-mode': toggleMode(); break;
        case 'qs-toggle-hide-title': toggleHideTitle(); break;
        case 'qs-toggle-props-collapsed': togglePropsPanel(); break;
        case 'qs-toggle-auto-save': toggleAutoSave(); break;
    }
});

// Input delegation
document.addEventListener('input', function(e) {
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;
    switch (action) {
        case 'filter-notes': filterNotes(el.value); break;
        case 'perform-search': performSearch(el.value); break;
    }
});

// Mouseenter delegation for search results (capture phase since mouseenter doesn't bubble)
document.addEventListener('mouseenter', function(e) {
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('[data-action="search-result-click"]');
    if (el) {
        searchSelectedIndex = parseInt(el.dataset.resultIndex);
        renderSearchResults();
    }
}, true);

// Drag event delegation
document.addEventListener('dragstart', function(e) {
    var el = e.target.closest('[data-drag-type]');
    if (!el) return;
    var type = el.dataset.dragType;
    if (type === 'note') {
        e.stopPropagation();
        dragType = 'note';
        dragNoteId = parseInt(el.dataset.dragId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'note:' + dragNoteId);
        el.closest('.file-item').classList.add('dragging');
    } else if (type === 'folder') {
        dragType = 'folder';
        dragFolderId = parseInt(el.dataset.dragCategoryId);
        dragFolderPath = el.dataset.dragPath;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'folder:' + dragFolderId);
        el.closest('.folder').classList.add('dragging');
        if (dragFolderPath.indexOf('/') !== -1) {
            document.getElementById('root-drop-zone').classList.add('visible');
        }
    }
});

document.addEventListener('dragover', function(e) {
    var el = e.target.closest('[data-drop-target]');
    if (!el || !dragType) return;
    var dropType = el.dataset.dropTarget;
    if (dropType === 'root') {
        if (dragType !== 'folder') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
        return;
    }
    // folder / folder-items / file-item
    var folder = el.closest('.folder');
    if (dragType === 'folder' && folder) {
        var targetPath = folder.dataset.path;
        if (targetPath === dragFolderPath || targetPath.startsWith(dragFolderPath + '/')) return;
    }
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
    if (folder && folder.classList.contains('collapsed')) {
        clearTimeout(dragExpandTimer);
        dragExpandTimer = setTimeout(function() { folder.classList.remove('collapsed'); }, 600);
    }
});

document.addEventListener('dragleave', function(e) {
    var el = e.target.closest('[data-drop-target]');
    if (!el) return;
    var dropType = el.dataset.dropTarget;
    if (dropType === 'root') {
        el.classList.remove('drag-over');
        return;
    }
    e.stopPropagation();
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove('drag-over');
    clearTimeout(dragExpandTimer);
});

document.addEventListener('drop', function(e) {
    var el = e.target.closest('[data-drop-target]');
    if (!el || !dragType) return;
    el.classList.remove('drag-over');
    var dropType = el.dataset.dropTarget;
    if (dropType === 'root') {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (dragType !== 'folder') return;
        var fid = dragFolderId;
        var fpath = dragFolderPath;
        dragType = null;
        moveCategoryRequest(fid, fpath, '').then(function(data) {
            if (data.success) refreshSidebar();
            else if (data.reason) alert(data.reason);
        });
        return;
    }
    var targetPath = el.dataset.dropPath;
    var targetCatId = el.dataset.dropCategoryId ? parseInt(el.dataset.dropCategoryId) : null;
    // Check self-drops for folders
    if (dragType === 'folder') {
        if (targetPath === dragFolderPath) return;
        if (targetPath.startsWith(dragFolderPath + '/')) return;
    }
    e.preventDefault();
    e.stopPropagation();
    onItemDrop(e, targetPath, targetCatId);
});
