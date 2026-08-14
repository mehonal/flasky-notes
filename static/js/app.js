// ============ State ============
var _pageData = JSON.parse(document.getElementById('app-page-data').textContent);
var noteId = _pageData.noteId;
var currentCategory = _pageData.currentCategory;
var currentCategoryId = _pageData.currentCategoryId || null;
var defaultCategoryId = _pageData.defaultCategoryId || 0;
var autoSaveTimer = null;
var autoSaveEnabled = _pageData.autoSaveEnabled;
var editMode = _pageData.editMode;
var isDirty = false;
var isSaving = false;
var _inPopState = false;
var _loadedNoteTitle = '';
var cmEditor = null;
var currentFontSize = _pageData.currentFontSize;
var pinnedNotes = JSON.parse(localStorage.getItem('flasky-pinned') || '[]');
var isMobile = window.innerWidth <= 768;
var defaultTemplateContent = _pageData.defaultTemplateContent;
var defaultTemplateProps = _pageData.defaultTemplateProps;
var currentNoteIcon = _pageData.currentNoteIcon;
var currentNoteIconColor = _pageData.currentNoteIconColor;
var _newNoteTemplatePromise = null;

// ============ Daily notes ============
var dailyNoteConfig = _pageData.dailyNote || { enabled: false, titleFormat: 'YYYY-MM-DD', templateId: 0, categoryId: 0, openOnStart: false };
var calendarPlacement = _pageData.calendarPlacement || 'left';
var userTimezone = _pageData.timezone || 'UTC';
if (typeof window._setEmbedMaxWidths === 'function') {
    window._setEmbedMaxWidths(_pageData.attachmentMaxWidth, _pageData.drawingMaxWidth);
}
if (typeof window._setEmbedBgSettings === 'function') {
    window._setEmbedBgSettings(_pageData.embedBgMode, _pageData.embedBgColor, _pageData.darkMode);
}
if (typeof window._setGhostNotesEnabled === 'function') {
    window._setGhostNotesEnabled(!!_pageData.autosuggestGhostNotes);
}

function formatDailyTitle(fmt, date) {
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return String(fmt || '')
        .replace(/YYYY/g, String(date.getFullYear()))
        .replace(/MM/g, pad(date.getMonth() + 1))
        .replace(/DD/g, pad(date.getDate()))
        .replace(/HH/g, pad(date.getHours()))
        .replace(/mm/g, pad(date.getMinutes()));
}

function nowInUserTz() {
    var now = new Date();
    if (userTimezone && typeof Intl !== 'undefined') {
        try {
            var parts = new Intl.DateTimeFormat('en-US', {
                timeZone: userTimezone, year: 'numeric', month: '2-digit',
                day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
            }).formatToParts(now);
            var map = {};
            parts.forEach(function(p) { map[p.type] = p.value; });
            if (map.hour === '24') map.hour = '00';
            return new Date(map.year, map.month - 1, map.day, map.hour, map.minute);
        } catch(e) {}
    }
    return now;
}

// Compose a wall-clock string from <input type="date">[+ <input type="time">]
// for transmission to the server. The server interprets these in the user's
// configured timezone, so no client-side UTC conversion is done.
// Returns '' when no date is selected so the backend clears the field.
function composeAgendaDateIso(date, time) {
    if (!date) return '';
    return time ? date + 'T' + time : date;
}

// Extract the wall-clock YYYY-MM-DD (in the user's configured tz) from a
// UTC ISO string returned by the server, for repopulating date inputs.
function extractAgendaDate(isoStr) {
    if (!isoStr) return '';
    try {
        var d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(d);
        var y = parts.find(function (p) { return p.type === 'year'; }).value;
        var mo = parts.find(function (p) { return p.type === 'month'; }).value;
        var da = parts.find(function (p) { return p.type === 'day'; }).value;
        return y + '-' + mo + '-' + da;
    } catch (e) { return ''; }
}

async function openDailyNote() { return openDailyNoteFor(nowInUserTz()); }

async function openDailyNoteFor(date) {
    if (!dailyNoteConfig.enabled) return;
    var title = formatDailyTitle(dailyNoteConfig.titleFormat, date);
    if (!title) return;
    // Ensure the decrypted note index is available (titles are E2EE ciphertext).
    var idx = await _getDailySearchIndex();
    // Find matching notes; pick the most recently changed on ties.
    var matches = [];
    for (var i = 0; i < idx.length; i++) {
        if (idx[i].title === title) matches.push(idx[i]);
    }
    if (matches.length > 0) {
        matches.sort(function(a, b) {
            var at = a.date_last_changed ? Date.parse(a.date_last_changed) : 0;
            var bt = b.date_last_changed ? Date.parse(b.date_last_changed) : 0;
            return bt - at;
        });
        openNote(matches[0].id);
        return;
    }
    // No existing daily note: create one in the configured folder, apply template.
    if (isMobile) closeSidebar();
    var catId = dailyNoteConfig.categoryId || 0;
    var catName = '';
    if (catId) {
        var folderEl = document.querySelector('.folder[data-category-id="' + catId + '"]');
        catName = folderEl ? folderEl.dataset.path : '';
    }
    // Fall back to the user's default folder when no daily category is set.
    if (!catId && defaultCategoryId) {
        catId = defaultCategoryId;
        var defEl = document.querySelector('.folder[data-category-id="' + catId + '"]');
        catName = defEl ? defEl.dataset.path : '';
    }
    var proceed = function() {
        loadNote(0, catName || 'Default', catId || undefined);
        // Set the title field after the editor resets.
        setTimeout(function() {
            var titleEl = document.getElementById('note-title');
            if (titleEl) { titleEl.value = title; markDirty(); }
            var bc = document.getElementById('breadcrumb-note-title');
            if (bc) bc.textContent = title;
            var doSave = function() {
                // Apply the configured daily template if any; otherwise the folder
                // default template (if any) is already applied by loadNote's flow.
                if (dailyNoteConfig.templateId) {
                    applyTemplate(dailyNoteConfig.templateId, function() {
                        saveNote();
                    });
                } else {
                    saveNote();
                }
            };
            if (_newNoteTemplatePromise) {
                _newNoteTemplatePromise.then(doSave).catch(doSave);
                _newNoteTemplatePromise = null;
            } else {
                doSave();
            }
        }, 60);
    };
    if (isDirty) { saveNote(proceed); } else { proceed(); }
}

async function _getDailySearchIndex() {
    if (typeof FlaskySearch === 'undefined') return [];
    var idx = [];
    try { idx = await FlaskySearch.buildIndex(); } catch(e) { idx = []; }
    if (!Array.isArray(idx)) idx = [];
    if (idx.length > 0) return idx;
    // Index may still be building during E2EE init — retry once before
    // deciding no daily note exists.
    await new Promise(function(resolve) { setTimeout(resolve, 800); });
    try { idx = await FlaskySearch.buildIndex(); } catch(e) { idx = []; }
    if (!Array.isArray(idx)) idx = [];
    return idx;
}

// ============ In-memory note store ============
// All notes decrypted once on page load; note switching reads from here
// instead of refetching/decrypting on every navigation.
var _noteStore = new Map();      // noteId -> { id, title, content, properties, category, category_id, icon, icon_color, date_last_changed }
var _noteStoreReady = null;     // Promise<void> resolved when store is warmed
var _categoriesStore = [];      // [{ id, name, icon, icon_color, default_note_icon, default_note_icon_color }]

function _warmNoteStore() {
    if (_noteStoreReady) return _noteStoreReady;
    _noteStoreReady = (async function() {
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) return;
        var resp = await fetch('/api/get_all_notes');
        var notes = await resp.json();
        if (!Array.isArray(notes)) return;
        await Promise.all([
            (async function() {
                await FlaskyE2EE.decryptObjects(notes, ['title', 'content', 'category']);
                for (var i = 0; i < notes.length; i++) {
                    var n = notes[i];
                    var props = null;
                    if (n.properties && typeof n.properties === 'string') {
                        try { props = JSON.parse(await FlaskyE2EE.decryptField(n.properties)); } catch(e) {}
                    }
                    n.properties = props || {};
                    _noteStore.set(n.id, n);
                }
            })(),
            (async function() {
                var r2 = await fetch('/api/sidebar_tree');
                var d2 = await r2.json();
                if (d2 && d2.success && Array.isArray(d2.categories)) {
                    await FlaskyE2EE.decryptObjects(d2.categories, ['name']);
                    _categoriesStore = d2.categories;
                }
            })()
        ]);
    })().catch(function(e) {
        console.warn('Note store warm failed:', e);
        _noteStoreReady = null;
    });
    return _noteStoreReady;
}

function _storeNote(note) {
    if (!note || !note.id) return;
    _noteStore.set(note.id, {
        id: note.id,
        title: note.title || '',
        content: note.content || '',
        properties: note.properties || {},
        category: note.category || '',
        category_id: note.category_id || null,
        icon: note.icon || null,
        icon_color: note.icon_color || null,
        resolved_icon: note.resolved_icon || null,
        resolved_icon_color: note.resolved_icon_color || null,
        date_last_changed: note.date_last_changed || null
    });
}

function _storeDeleteNote(id) {
    _noteStore.delete(id);
}

function _applyPropsToEditor(props) {
    var propsBody = document.getElementById('props-body');
    if (!propsBody) return;
    propsBody.querySelectorAll('.prop-row').forEach(function(r) { r.remove(); });
    var addBtn = propsBody.querySelector('.prop-add-row');
    Object.keys(props || {}).forEach(function(key) {
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

// Toggle the active highlight in the sidebar without refetching/rebuilding.
function setActiveSidebarItem(id) {
    var prev = document.querySelector('#file-tree .file-item.active');
    if (prev) prev.classList.remove('active');
    if (id === null || id === 0) return;
    var item = document.querySelector('.file-item[data-note-id="' + id + '"]');
    if (item) {
        item.classList.add('active');
        var parentFolder = item.closest('.folder');
        if (parentFolder) parentFolder.classList.remove('collapsed');
    }
}

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
            if (sessionStorage.getItem('flasky-mobile-sidebar-open')) {
                sessionStorage.removeItem('flasky-mobile-sidebar-open');
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
    var wasCollapsed = sb.classList.contains('collapsed');
    if (wasCollapsed) {
        sb.classList.remove('collapsed');
        if (isMobile) {
            bd.classList.add('visible');
            // On mobile, close the right panel so they don't overlap
            closeRightPanel();
        }
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
    var toggleBtn = document.querySelector('.toggle-sidebar');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    if (!isMobile) saveUiState({ sidebar_collapsed: true });
}

function closeRightPanel() {
    var panel = document.getElementById('right-panel');
    var btn = document.getElementById('panel-toggle');
    panel.classList.add('collapsed');
    panel.setAttribute('aria-hidden', 'true');
    if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
    }
    if (!isMobile) saveUiState({ right_panel_collapsed: true });
}

function persistMobileSidebarState() {
    if (isMobile && !document.getElementById('sidebar').classList.contains('collapsed')) {
        sessionStorage.setItem('flasky-mobile-sidebar-open', '1');
    }
}

var _sidebarPending = false;

function refreshSidebar(callback) {
    // If the editor is detached (e.g. an overlay view like /agenda is active),
    // defer the rebuild until the editor is reattached.
    var fileTreeNow = document.getElementById('file-tree');
    if (!fileTreeNow || !document.body.contains(fileTreeNow)) {
        _sidebarPending = true;
        if (callback) callback();
        return;
    }
    _sidebarPending = false;

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
            // Decrypt note titles + category names in parallel
            await FlaskyE2EE.decryptObjects(notes, ['title']);
            await FlaskyE2EE.decryptObjects(cats, ['name']);
            // Group notes by category
            var catMap = {};
            cats.forEach(function(c) { catMap[c.id] = { cat: c, notes: [] }; });
            // Notes whose category is missing/unknown fall into the user's
            // default folder, resolved by id.
            var defaultCat = cats.find(function(c) { return c.id === defaultCategoryId; });
            if (!defaultCat) {
                defaultCat = { id: 0, name: 'Default' };
            }
            notes.forEach(function(n) {
                var cid = n.category_id || defaultCat.id;
                if (!catMap[cid]) catMap[cid] = { cat: { id: cid, name: 'Unknown' }, notes: [] };
                catMap[cid].notes.push(n);
            });
            var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
            var jesc = function(s) { return (s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); };

            // Build nested tree from path-based category names (e.g. "Work/Projects")
            function buildCategoryTree(cats, notes, defaultCat) {
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
                    var cid = n.category_id || defaultCat.id;
                    var cat = cats.find(function(c) { return c.id === cid; }) || defaultCat;
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

            var categoryTree = buildCategoryTree(cats, notes, defaultCat);
            var html = renderFolderTree(categoryTree, '');
            fileTree.insertAdjacentHTML('beforeend', html);
        } else {
            // Non-encrypted: use server-rendered HTML
            fileTree.insertAdjacentHTML('beforeend', data.tree_html);
        }

        // Virtual "Attachments" folder (read-only, client-side only).
        if (typeof _pageData !== 'undefined' && _pageData.attachmentsFolderEnabled) {
            await renderAttachmentsFolder(fileTree);
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

        // Update breadcrumb category label if no note is open (keeps new-note folder in sync)
        var folderLabel = document.getElementById('folder-picker-label');
        if (folderLabel && data.categories) {
            var selectedCatId = folderLabel.dataset.categoryId;
            if (activeItem) {
                var noteFolder = activeItem.closest('.folder[data-category-id]');
                if (noteFolder) {
                    selectedCatId = noteFolder.dataset.categoryId;
                    updateBreadcrumbCategory(noteFolder.querySelector('.folder-name').textContent, selectedCatId);
                }
            }
            if (!selectedCatId && data.categories.length > 0) {
                var def = data.categories.find(function(c) { return c.id === defaultCategoryId; });
                if (!def) def = data.categories[0];
                updateBreadcrumbCategory(def.name, def.id);
            }
        }

        // Render Lucide icons in sidebar
        renderSidebarIcons();

        // Re-apply pinned notes and search filter (reset cache so titles refresh after E2EE decrypt)
        _lastPinnedKey = null;
        renderPinnedNotes();
        updatePinButtons();
        if (searchQuery) filterNotes(searchQuery);

        if (callback) callback();
    });
}

function toggleFolder(folder) { folder.classList.toggle('collapsed'); }

// ============ Virtual Attachments Folder ============

var ATTACHMENT_PATH = '__attachments__';
var ATTACHMENT_ICONS = {
    image: 'image', video: 'video', audio: 'music', drawing: 'palette',
    document: 'file-text', archive: 'archive', other: 'file'
};

function _esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function _jesc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

/**
 * Build and prepend the read-only virtual "Attachments" folder to the sidebar.
 * Uses the shared FlaskyAttachments index (hydrated by wikilinks.js from the
 * /api/note-map fetch, or fetched on demand). The folder has no category id,
 * no drop targets, and no drag handlers — it is a browser only.
 */
async function renderAttachmentsFolder(fileTree) {
    if (!window.FlaskyAttachments) return;
    var idx;
    try { idx = await window.FlaskyAttachments.loadAttachmentIndex(); }
    catch (e) { return; }
    if (!idx || idx.length === 0) return;

    var subcats = !!(typeof _pageData !== 'undefined' && _pageData.attachmentsFolderSubcategories);

    var html;
    if (subcats) {
        var buckets = { image: [], video: [], audio: [], drawing: [], document: [], archive: [], other: [] };
        idx.forEach(function (a) { buckets[window.FlaskyAttachments.classify(a.name)].push(a); });
        var subfolders = [
            { key: 'image',    label: 'Images'    },
            { key: 'video',    label: 'Videos'    },
            { key: 'audio',    label: 'Audio'     },
            { key: 'drawing',  label: 'Drawings'  },
            { key: 'document', label: 'Documents' },
            { key: 'archive',  label: 'Archives'  },
            { key: 'other',    label: 'Other'     },
        ];
        var subHtml = '';
        subfolders.forEach(function (sf) {
            var items = buckets[sf.key];
            if (!items || items.length === 0) return;
            items.sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
            var path = ATTACHMENT_PATH + '/' + sf.label;
            subHtml += '<div class="folder collapsed" data-virtual="attachments" data-subcategory="' + sf.key + '" data-path="' + _esc(path) + '">';
            subHtml += '<div class="folder-header" data-action="toggle-folder">';
            subHtml += '<span class="folder-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>';
            subHtml += '<span class="folder-icon"><span class="lucide-icon" data-icon="' + ATTACHMENT_ICONS[sf.key] + '"></span></span>';
            subHtml += '<span class="folder-name">' + _esc(sf.label) + '</span>';
            subHtml += '<span class="folder-count">' + items.length + '</span>';
            subHtml += '</div><div class="folder-items">';
            subHtml += items.map(function (a) { return _renderAttachmentItem(a); }).join('');
            subHtml += '</div></div>';
        });
        html = '<div class="folder collapsed" data-virtual="attachments" data-path="' + _esc(ATTACHMENT_PATH) + '">';
        html += '<div class="folder-header" data-action="toggle-folder">';
        html += '<span class="folder-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>';
        html += '<span class="folder-icon"><span class="lucide-icon" data-icon="paperclip"></span></span>';
        html += '<span class="folder-name">Attachments</span>';
        html += '<span class="folder-count">' + idx.length + '</span>';
        html += '</div><div class="folder-items">' + subHtml + '</div></div>';
    } else {
        var sorted = idx.slice().sort(function (a, b) {
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
        var itemsHtml = sorted.map(function (a) { return _renderAttachmentItem(a); }).join('');
        html = '<div class="folder collapsed" data-virtual="attachments" data-path="' + _esc(ATTACHMENT_PATH) + '">';
        html += '<div class="folder-header" data-action="toggle-folder">';
        html += '<span class="folder-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>';
        html += '<span class="folder-icon"><span class="lucide-icon" data-icon="paperclip"></span></span>';
        html += '<span class="folder-name">Attachments</span>';
        html += '<span class="folder-count">' + idx.length + '</span>';
        html += '</div><div class="folder-items">' + itemsHtml + '</div></div>';
    }

    var rootDrop = document.getElementById('root-drop-zone');
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) {
        if (rootDrop) fileTree.insertBefore(tmp.firstChild, rootDrop.nextSibling);
        else fileTree.appendChild(tmp.firstChild);
    }
}

function _renderAttachmentItem(att) {
    var cls = window.FlaskyAttachments.classify(att.name);
    var icon = ATTACHMENT_ICONS[cls] || 'file';
    return '<div class="attachment-item" data-attachment-id="' + att.id + '" data-attachment-name="' + _esc(att.name) + '" data-action="open-attachment">'
        + '<span class="file-icon"><span class="lucide-icon" data-icon="' + icon + '"></span></span>'
        + '<span class="file-name">' + _esc(att.name) + '</span>'
        + '</div>';
}

// ============ Attachment Preview Modal ============

var _previewObjectUrl = null;
var _previewAttachmentId = null;
var _previewAttachmentName = null;

function openAttachmentPreview(attId, name) {
    var overlay = document.getElementById('attachment-preview-overlay');
    var body = document.getElementById('attachment-preview-body');
    var titleEl = document.getElementById('attachment-preview-title');
    var findBtn = document.getElementById('attachment-preview-find-btn');
    var dlBtn = document.getElementById('attachment-preview-download-btn');
    var delBtn = document.getElementById('attachment-preview-delete-btn');
    var renBtn = document.getElementById('attachment-preview-rename-btn');
    if (!overlay || !body) return;
    _previewAttachmentId = attId;
    _previewAttachmentName = name || '';
    titleEl.textContent = name || 'Attachment';
    body.innerHTML = '<div class="attachment-preview-loading">Loading…</div>';
    if (findBtn) findBtn.disabled = true;
    if (dlBtn) dlBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
    if (renBtn) renBtn.disabled = true;
    overlay.classList.add('visible');

    var url = '/attachment/' + attId + '/' + encodeURIComponent(name);
    fetch(url).then(function (r) {
        if (!r.ok) throw new Error('fetch failed');
        return r.arrayBuffer();
    }).then(function (buf) {
        return FlaskyE2EE.decryptBlob(new Uint8Array(buf));
    }).then(function (decrypted) {
        if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
        var mime = window.FlaskyAttachments ? window.FlaskyAttachments.mimeForName(name) : 'application/octet-stream';
        var blob = new Blob([decrypted], { type: mime });
        _previewObjectUrl = URL.createObjectURL(blob);
        var cls = window.FlaskyAttachments ? window.FlaskyAttachments.classify(name) : 'other';
        body.innerHTML = '';
        if (cls === 'image') {
            var img = document.createElement('img');
            img.src = _previewObjectUrl; img.alt = name; img.className = 'attachment-preview-media';
            body.appendChild(img);
            // Apply transparent-image background.
            if (window._resolveAndApplyEmbedBg) {
                var previewImg = img;
                var bg0 = window.resolveEmbedBg ? window.resolveEmbedBg() : null;
                if (window._getEmbedBgMode && window._getEmbedBgMode() === 'dynamic') {
                    previewImg.style.backgroundColor = bg0 || (window._themeEmbedBg ? window._themeEmbedBg() : '');
                    var onDyn = function () {
                        var dyn = window._analyzeContrastBg ? window._analyzeContrastBg(previewImg) : null;
                        if (dyn) previewImg.style.backgroundColor = dyn;
                    };
                    if (previewImg.complete && previewImg.naturalWidth) onDyn();
                    else previewImg.addEventListener('load', onDyn, { once: true });
                } else {
                    previewImg.style.backgroundColor = bg0 || '';
                }
            }
        } else if (cls === 'video') {
            var vid = document.createElement('video');
            vid.src = _previewObjectUrl; vid.controls = true; vid.className = 'attachment-preview-media';
            body.appendChild(vid);
        } else if (cls === 'audio') {
            var aud = document.createElement('audio');
            aud.src = _previewObjectUrl; aud.controls = true; aud.className = 'attachment-preview-media';
            body.appendChild(aud);
        } else if (cls === 'drawing') {
            try {
                var text = new TextDecoder().decode(new Uint8Array(decrypted));
                var doc = window._parseFldraw ? window._parseFldraw(text) : JSON.parse(text);
                if (doc && doc.strokes) {
                    var canvas = document.createElement('canvas');
                    canvas.className = 'attachment-preview-canvas';
                    body.appendChild(canvas);
                    if (window._renderFldrawToCanvas) {
                        window._renderFldrawToCanvas(canvas, doc.strokes, doc.w || 0, doc.h || 0);
                    }
                    if (window._resolveAndApplyEmbedBg) {
                        window._resolveAndApplyEmbedBg(canvas);
                    }
                } else {
                    body.innerHTML = '<div class="attachment-preview-info">Empty drawing.</div>';
                }
            } catch (e) {
                body.innerHTML = '<div class="attachment-preview-info">Could not render drawing.</div>';
            }
        } else {
            var info = document.createElement('div');
            info.className = 'attachment-preview-info';
            info.textContent = name + ' (' + mime + ')';
            body.appendChild(info);
        }
        if (dlBtn) {
            dlBtn.disabled = false;
            dlBtn.onclick = function () {
                var a = document.createElement('a');
                a.href = _previewObjectUrl; a.download = name;
                document.body.appendChild(a); a.click(); a.remove();
            };
        }
        if (findBtn) {
            findBtn.disabled = false;
            findBtn.onclick = function () { _findAttachmentInNotes(name); };
        }
        if (delBtn) {
            delBtn.disabled = false;
            delBtn.onclick = function () { _deleteAttachmentFromPreview(); };
        }
        if (renBtn) {
            renBtn.disabled = false;
            renBtn.onclick = function () { ctxRenameAttachment(); };
        }
    }).catch(function (e) {
        body.innerHTML = '<div class="attachment-preview-info">Failed to load attachment.</div>';
    });
}

function closeAttachmentPreview() {
    var overlay = document.getElementById('attachment-preview-overlay');
    if (overlay) overlay.classList.remove('visible');
    if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
    _previewAttachmentId = null;
    _previewAttachmentName = null;
    var dlBtn = document.getElementById('attachment-preview-download-btn');
    if (dlBtn) dlBtn.onclick = null;
    var findBtn = document.getElementById('attachment-preview-find-btn');
    if (findBtn) findBtn.onclick = null;
    var delBtn = document.getElementById('attachment-preview-delete-btn');
    if (delBtn) delBtn.onclick = null;
    var renBtn = document.getElementById('attachment-preview-rename-btn');
    if (renBtn) renBtn.onclick = null;
}

async function _deleteAttachmentFromPreview() {
    var id = _previewAttachmentId, name = _previewAttachmentName;
    if (!id) return;
    var refCount = await _countAttachmentReferences(name);
    var msg = 'Delete "' + name + '"?';
    if (refCount > 0) msg += '\n\nIt is embedded in ' + refCount + ' note(s). Broken embeds will remain in those notes.';
    else msg += '\n\nIt is not embedded in any notes.';
    msg += '\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    closeAttachmentPreview();
    _deleteAttachmentById(id);
}

async function _findAttachmentInNotes(filename) {
    if (!filename) return;
    if (typeof FlaskySearch === 'undefined') { alert('Search is not available yet.'); return; }
    try {
        var results = await FlaskySearch.search('![[' + filename + ']]');
        if (results && results.length) {
            closeAttachmentPreview();
            openNote(results[0].id);
        } else {
            alert('No notes embed "' + filename + '".');
        }
    } catch (e) {
        alert('Search is not ready yet — try again in a moment.');
    }
}

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
    if (window.FlaskyTTS && FlaskyTTS.isSpeaking()) FlaskyTTS.stop();

    if (id === 0) {
        var setupNewNote = function() {
            noteId = 0;
            hasBeenSavedOnce = false;
            isDirty = false;
            isSaving = false;
            currentNoteIcon = null;
            currentNoteIconColor = null;
            _newNoteTemplatePromise = null;
            updateNoteIconPreview(null, null);
            document.getElementById('note-title').value = '';
            if (cmEditor) { cmEditor.setValue(''); cmEditor.refresh(); }
            else document.getElementById('note-content').value = '';
            _applyPropsToEditor({});
            if (!category && !categoryId && defaultCategoryId) {
                categoryId = defaultCategoryId;
                var defCat = _categoriesStore.find(function(c) { return c.id === defaultCategoryId; });
                if (defCat) {
                    category = defCat.name || null;
                } else {
                    var defEl = document.querySelector('.folder[data-category-id="' + defaultCategoryId + '"]');
                    if (defEl) category = defEl.dataset.path || null;
                }
            }
            currentCategory = category || 'Default';
            currentCategoryId = categoryId || null;
            // Update breadcrumb category
            updateBreadcrumbCategory(currentCategory, currentCategoryId);
            history.pushState({ flasky: { view: 'note', noteId: 0 } }, '', '/note/0');
            if (_inPopState) history.replaceState({ flasky: { view: 'note', noteId: 0 } }, '', '/note/0');
            _loadedNoteTitle = '';
            document.getElementById('breadcrumb-note-title').textContent = 'New note';
            document.getElementById('save-status').textContent = '';
            document.getElementById('save-status').style.color = '';
            updateMobileSaveBtn('saved');
            if (!editMode) renderPreview();
            setActiveSidebarItem(null);
            document.getElementById('note-title').focus();
            document.querySelectorAll('.note-action-item').forEach(function(el) { el.style.display = 'none'; });
            // Refresh right panel
            var rp = document.getElementById('right-panel');
            if (rp && !rp.classList.contains('collapsed')) refreshAllVisibleWidgets();
            refreshCalendarWidget();
            if (window.FlaskyRouter && typeof window.FlaskyRouter.finishBar === 'function') window.FlaskyRouter.finishBar();
            // Check for folder default template
            if (categoryId) {
                _newNoteTemplatePromise = fetch('/api/folder_default_template/' + categoryId)
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
            _inPopState = false;
        };
        if (!category && !categoryId && defaultCategoryId && _categoriesStore.length === 0 && _noteStoreReady) {
            _noteStoreReady.then(setupNewNote);
            return;
        }
        setupNewNote();
        return;
    }

    var onLoaded = function(n) {
        noteId = n.id;
        hasBeenSavedOnce = true;
        isSaving = false;
        _loadedNoteTitle = n.title || '';

        document.getElementById('note-title').value = n.title || '';
        if (cmEditor) { cmEditor.setValue(n.content || ''); cmEditor.refresh(); }
        else document.getElementById('note-content').value = n.content || '';
        isDirty = false;
        _applyPropsToEditor(n.properties || {});

        history.pushState({ flasky: { view: 'note', noteId: n.id } }, '', '/note/' + n.id);
        if (_inPopState) history.replaceState({ flasky: { view: 'note', noteId: n.id } }, '', '/note/' + n.id);
        document.getElementById('breadcrumb-note-title').textContent = n.title || 'Untitled';

        currentNoteIcon = n.icon || null;
        currentNoteIconColor = n.icon_color || null;
        updateNoteIconPreview(n.resolved_icon || n.icon, n.resolved_icon_color || n.icon_color);

        currentCategory = n.category || 'Default';
        currentCategoryId = n.category_id || null;
        updateBreadcrumbCategory(currentCategory, n.category_id);

        document.getElementById('save-status').textContent = '\u2713 Saved';
        document.getElementById('save-status').style.color = 'var(--green)';
        updateMobileSaveBtn('saved');

        if (!editMode) renderPreview();

        setActiveSidebarItem(n.id);
        document.querySelectorAll('.note-action-item').forEach(function(el) { el.style.display = ''; });
        var rp = document.getElementById('right-panel');
        if (rp && !rp.classList.contains('collapsed')) refreshAllVisibleWidgets();
        refreshCalendarWidget();
        _inPopState = false;
        if (window.FlaskyRouter && typeof window.FlaskyRouter.finishBar === 'function') window.FlaskyRouter.finishBar();
    };

    var cached = _noteStore.get(id);
    if (cached) {
        if (window.FlaskyRouter && typeof window.FlaskyRouter.showBar === 'function') window.FlaskyRouter.showBar();
        onLoaded(cached);
        return;
    }

    if (window.FlaskyRouter && typeof window.FlaskyRouter.showBar === 'function') window.FlaskyRouter.showBar();
    fetch('/api/note/' + id)
    .then(function(r) { return r.json(); })
    .then(async function(data) {
        if (!data.success) { _inPopState = false; if (window.FlaskyRouter && typeof window.FlaskyRouter.finishBar === 'function') window.FlaskyRouter.finishBar(); window.location.href = '/note/' + id; return; }
        var n = data.note;

        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            var decTitle, decContent, decCategory, decProps;
            await Promise.all([
                (async function() { try { decTitle = await FlaskyE2EE.decryptField(n.title); } catch(e) { decTitle = n.title; } })(),
                (async function() { try { decContent = await FlaskyE2EE.decryptField(n.content); } catch(e) { decContent = n.content; } })(),
                (async function() { try { decCategory = n.category ? await FlaskyE2EE.decryptField(n.category) : null; } catch(e) { decCategory = n.category; } })(),
                (async function() {
                    if (n.properties && typeof n.properties === 'string') {
                        try { decProps = JSON.parse(await FlaskyE2EE.decryptField(n.properties)); } catch(e) { decProps = {}; }
                    } else { decProps = n.properties || {}; }
                })()
            ]);
            n.title = decTitle; n.content = decContent; n.category = decCategory; n.properties = decProps;
        }
        _storeNote(n);
        onLoaded(n);
    })
    .catch(function() {
        if (window.FlaskyRouter && typeof window.FlaskyRouter.finishBar === 'function') window.FlaskyRouter.finishBar();
    });
}

// Handle browser back/forward
window.addEventListener('popstate', function(e) {
    _inPopState = true;

    // If E2EE is enabled but the key hasn't been loaded yet (unlock overlay
    // was showing), a full reload is the safest path: the server re-renders
    // the correct note's encrypted data and init() re-shows the unlock view.
    // Without this, loadNote would decrypt with a null key and show ciphertext.
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted() && !FlaskyE2EE.isReady()) {
        _inPopState = false;
        window.location.reload();
        return;
    }

    var st = e.state;
    var id = 0;
    if (st && st.flasky && st.flasky.view === 'note') {
        id = st.flasky.noteId;
    } else if (st && st.noteId !== undefined) {
        id = st.noteId;
    } else {
        var match = window.location.pathname.match(/\/note\/(\d+)/);
        if (match) id = parseInt(match[1]);
    }
    if (window.FlaskyRouter && window.FlaskyRouter.closeOverlay) {
        window.FlaskyRouter.closeOverlay();
    }
    loadNote(id);
});

// Set initial history state
history.replaceState({ flasky: { view: 'note', noteId: noteId } }, '', window.location.href);

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
    // loadNote(0) resolves the user's default folder from the category
    // store or sidebar DOM, so no need to pass it explicitly here.
    if (isDirty) {
        saveNote(function() { loadNote(0); });
    } else {
        loadNote(0);
    }
}

function createGhostNoteFromLink(title) {
    if (!title) return;
    var doCreate = function() {
        loadNote(0);
        setTimeout(function() {
            var titleEl = document.getElementById('note-title');
            if (titleEl) titleEl.value = title;
            isDirty = true;
            var doSave = function() { saveNote(); };
            if (_newNoteTemplatePromise) {
                _newNoteTemplatePromise.then(doSave).catch(doSave);
                _newNoteTemplatePromise = null;
            } else {
                doSave();
            }
        }, 0);
    };
    if (isDirty) {
        saveNote(function() { doCreate(); });
    } else {
        doCreate();
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
    localStorage.setItem('flasky-pinned', JSON.stringify(pinnedNotes));
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

    cmEditor = FlaskyEditor.create(wrapper, {
        initialContent: textarea ? textarea.value : '',
        renderEmbeds: !!_pageData.renderEmbedsInEditMode,
        livePreview: !!_pageData.livePreview,
        onLinkClick: function(type, target) {
            if (type === 'note') openNote(parseInt(target, 10));
            else if (type === 'ghost') {
                if (_ghostEnabled()) createGhostNoteFromLink(target);
                else window.location.href = '/note/0';
            }
            else window.open(target, '_blank', 'noopener');
        },
        onChange: function() { markDirty(); },
        onInputRead: function(cm) {
            showWikiAutocomplete(cm);
            showSlashCommands(cm);
            showAutosuggest(cm);
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
                var cursor2 = cm.getCursor();
                var line2 = cm.getLine(cursor2.line);
                var before2 = line2.substring(0, cursor2.ch);
                var openIdx2 = before2.lastIndexOf('[[');
                var closed2 = openIdx2 === -1 || before2.substring(openIdx2 + 2).indexOf(']]') > -1;
                var lostBang = wikiEmbedMode && (openIdx2 === -1 || before2.charAt(openIdx2 - 1) !== '!');
                if (closed2 || lostBang) hideWikiAutocomplete();
            }
            if (isAutosuggestVisible()) {
                var ctx = computeAutosuggestQuery(cm);
                var sameWord = ctx && autosuggContext
                    && ctx.from.ch === autosuggContext.from.ch
                    && ctx.from.line === autosuggContext.from.line;
                if (!sameWord) hideAutosuggest();
            }
            // Clear the per-word dismissal sentinel whenever the cursor
            // leaves the dismissed word (different word or new boundary),
            // so suggestions re-arm for the next word the user types.
            if (_autosuggDismissedWord) {
                var dctx = computeAutosuggestQuery(cm);
                if (!dctx || dctx.query !== _autosuggDismissedWord) {
                    _autosuggDismissedWord = null;
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
            if (isAutosuggestVisible()) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (autosuggSelectedIndex < autosuggFilteredNotes.length - 1) { autosuggSelectedIndex++; renderLinksDropdown(autosuggestDropdown, autosuggFilteredNotes, _linksShowCategory(), autosuggSelectedIndex); }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (autosuggSelectedIndex > 0) { autosuggSelectedIndex--; renderLinksDropdown(autosuggestDropdown, autosuggFilteredNotes, _linksShowCategory(), autosuggSelectedIndex); }
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    acceptAutosuggest(autosuggSelectedIndex);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    _autosuggDismissedWord = autosuggContext ? autosuggContext.query : null;
                    hideAutosuggest();
                }
                return;
            }
            if (!isWikiAutocompleteVisible()) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (wikiSelectedIndex < wikiFilteredNotes.length - 1) { wikiSelectedIndex++; renderLinksDropdown(wikiAutocomplete, wikiFilteredNotes, _linksShowCategory(), wikiSelectedIndex); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (wikiSelectedIndex > 0) { wikiSelectedIndex--; renderLinksDropdown(wikiAutocomplete, wikiFilteredNotes, _linksShowCategory(), wikiSelectedIndex); }
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
    if (!file) return;
    if (noteId === 0) {
        var ok = await _ensureNoteSaved();
        if (!ok) return;
    }
    var formData = new FormData();
    var filename = file.name || ('upload-' + Date.now());

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

// ============ Drawing (.fldraw) ============

function openDrawingForNew() {
    if (typeof window.openDrawingModal !== 'function') return;
    var name = 'drawing-' + (Date.now().toString(36)) + '.fldraw';
    window.openDrawingModal({ attachmentId: null, filename: name, onSave: uploadFileToNote });
}

function openDrawingForEdit(el) {
    if (typeof window.openDrawingModal !== 'function') return;
    var attId = parseInt(el.dataset.attId, 10);
    var filename = el.dataset.attFilename || 'drawing.fldraw';
    if (!attId) return;
    window.openDrawingModal({
        attachmentId: attId,
        filename: filename,
        onSave: function (blob, fname) { updateExistingDrawing(attId, blob, fname); }
    });
}

async function updateExistingDrawing(attachmentId, blob, filename) {
    if (!attachmentId || typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isEncrypted()) return;
    var arrayBuf = await blob.arrayBuffer();
    var encryptedData = await FlaskyE2EE.encryptBlob(arrayBuf);
    var encFilename = await FlaskyE2EE.encryptField(filename);
    var formData = new FormData();
    formData.append('file', new Blob([encryptedData]), 'encrypted');
    formData.append('filename', encFilename);
    try {
        var resp = await fetch('/api/attachment/' + attachmentId, { method: 'PUT', body: formData });
        if (!resp.ok) { console.error('drawing update failed', resp.status); return; }
        if (window._invalidateNoteMap) window._invalidateNoteMap();
        if (typeof renderPreview === 'function') renderPreview();
    } catch (e) {
        console.error('drawing update failed:', e);
    }
}

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
var linkGraphTimer = null;

var hasBeenSavedOnce = _pageData.hasNote;
var _pendingEnsureSave = null;
var _savePromise = null;

function updateMobileSaveBtn(state) {
    var btns = document.querySelectorAll('[data-action="save-note"]');
    if (!btns.length) return;
    btns.forEach(function(btn) {
        btn.classList.remove('saved', 'unsaved', 'save-flash');
        if (state === 'unsaved') btn.classList.add('unsaved');
        else if (state === 'saved') {
            btn.classList.add('saved');
            if (btn.classList.contains('spotlight-ctrl-btn') || btn.classList.contains('save-btn')) {
                btn.classList.add('save-flash');
                setTimeout(function() { btn.classList.remove('save-flash'); }, 1000);
            }
        }
    });
}

function markDirty() {
    isDirty = true;
    var s = document.getElementById('save-status');
    if (s) { s.textContent = '\u25CF Unsaved'; s.style.color = 'var(--yellow)'; }
    updateMobileSaveBtn('unsaved');
    updateCounts();
    clearTimeout(autoSaveTimer);
    if (autoSaveEnabled && (hasBeenSavedOnce || noteId === 0)) {
        autoSaveTimer = setTimeout(function() { saveNote(); }, 3000);
    }

    // Update outline and outbound links in right panel (debounced)
    var panel = document.getElementById('right-panel');
    if (panel && !panel.classList.contains('collapsed')) {
        clearTimeout(outboundLinksTimer);
        outboundLinksTimer = setTimeout(updateOutboundLinksFromContent, 500);
        clearTimeout(outlineUpdateTimer);
        outlineUpdateTimer = setTimeout(updateOutline, 500);
        clearTimeout(linkGraphTimer);
        linkGraphTimer = setTimeout(loadLinkGraph, 500);
    }
}

async function updateOutboundLinksFromContent() {
    var content = getEditorContent();
    var list = document.getElementById('outbound-links-list');
    if (!list || !content) { if (list) list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; return; }
    try {
        if (typeof FlaskySearch !== 'undefined' && FlaskySearch.isBuilding()) {
            list.innerHTML = '<li class="backlinks-empty">Loading links...</li>';
        }
        var data = await FlaskySearch.computeOutboundLinks(content);
        data = data.filter(function(n) { return _ghostEnabled() || !n._ghost; });
        if (data.length === 0) { list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; return; }
        var html = '';
        data.forEach(function(n) {
            var escTitle = escapeHtml(n.title || 'Untitled');
            if (n._ghost) {
                html += '<li><span class="wikilink-missing" data-action="create-ghost-note" data-ghost-title="' + escTitle + '" title="Click to create this note">' + escTitle + '</span></li>';
            } else {
                html += '<li><a href="/note/' + n.id + '" data-action="open-note-link" data-note-id="' + n.id + '">' + escTitle + '</a></li>';
            }
        });
        list.innerHTML = html;
    } catch(e) { list.innerHTML = '<li class="backlinks-empty">No outbound links</li>'; }
}

function _ensureNoteSaved() {
    if (noteId !== 0) return Promise.resolve(true);
    if (_pendingEnsureSave) return _pendingEnsureSave;
    _pendingEnsureSave = new Promise(function(resolve) {
        var onDone = function() {
            _pendingEnsureSave = null;
            resolve(noteId !== 0);
        };
        if (_savePromise) {
            _savePromise.then(onDone);
        } else {
            var titleInput = document.getElementById('note-title');
            if (titleInput && !titleInput.value.trim()) titleInput.value = 'Untitled';
            saveNote(onDone);
        }
    });
    return _pendingEnsureSave;
}

function saveNote(callback) {
    var title = document.getElementById('note-title');
    if (!title) { if (callback) callback(); return; }
    if (isSaving) {
        if (_savePromise) {
            _savePromise.then(function() { if (callback) callback(); });
        } else if (callback) {
            callback();
        }
        return;
    }
    if (noteId === 0 && !title.value.trim()) {
        if (callback) callback();
        return;
    }
    isSaving = true;
    clearTimeout(autoSaveTimer);
    var content = getEditorContent();
    var props = collectProperties();

    document.getElementById('save-status').textContent = 'Saving...';
    document.getElementById('save-status').style.color = 'var(--text-muted)';

    var cb = callback;
    _savePromise = new Promise(function(resolve) {
        cb = function() {
            _savePromise = null;
            resolve();
            if (callback) callback();
        };
    });
    _doSaveNote(title.value, content, props, cb);
}

async function _doSaveNote(titleVal, content, props, callback) {
    try {
        var catValue = null;
        var folderLabel = document.getElementById('folder-picker-label');
        if (folderLabel) {
            var folderId = parseInt(folderLabel.dataset.categoryId);
            if (!isNaN(folderId) && folderId > 0) catValue = folderId;
        }
        var payload = { noteId: noteId, title: titleVal, content: content, category: catValue };
        if (currentNoteIcon) {
            payload.icon = currentNoteIcon;
            payload.iconColor = currentNoteIconColor;
        }
        var encTitle, encContent, encProps;
        await Promise.all([
            (async function() { encTitle = await FlaskyE2EE.encryptField(titleVal); })(),
            (async function() { encContent = await FlaskyE2EE.encryptField(content); })(),
            (async function() {
                if (props && Object.keys(props).length > 0) {
                    encProps = await FlaskyE2EE.encryptField(JSON.stringify(props));
                }
            })()
        ]);
        payload.title = encTitle;
        payload.content = encContent;
        if (encProps) payload.properties = encProps;
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
            var displayTitle = document.getElementById('note-title') ? document.getElementById('note-title').value : '';
            var wasNewNote = (noteId === 0 && data.note && data.note.id);
            var oldTitle = _loadedNoteTitle;
            var titleChanged = (oldTitle !== displayTitle);

            if (typeof FlaskySearch !== 'undefined' && data.note) {
                FlaskySearch.updateNote({
                    id: wasNewNote ? data.note.id : noteId,
                    title: displayTitle,
                    content: content,
                    category: currentCategory || '',
                    date_last_changed: data.note.date_last_changed
                });
            }

            if (wasNewNote) {
                noteId = data.note.id;
                _loadedNoteTitle = displayTitle;
                history.replaceState(null, '', '/note/' + noteId);
                _storeNote({
                    id: noteId,
                    title: displayTitle,
                    content: content,
                    properties: props || {},
                    category: currentCategory || '',
                    category_id: data.note.category_id || currentCategoryId || null,
                    icon: data.note.icon || currentNoteIcon,
                    icon_color: data.note.icon_color || currentNoteIconColor,
                    resolved_icon: data.note.resolved_icon || null,
                    resolved_icon_color: data.note.resolved_icon_color || null,
                    date_last_changed: data.note.date_last_changed
                });
                updateSidebarAfterSave({
                    id: noteId,
                    title: displayTitle,
                    category: currentCategory || 'Default',
                    category_id: data.note.category_id || currentCategoryId || null,
                    icon: currentNoteIcon || data.note.resolved_icon || null,
                    icon_color: currentNoteIconColor || data.note.resolved_icon_color || null
                });
                updateNoteIconPreview(data.note.resolved_icon || currentNoteIcon, data.note.resolved_icon_color || currentNoteIconColor);
                setActiveSidebarItem(noteId);
                var bc = document.getElementById('breadcrumb-note-title');
                if (bc) bc.textContent = displayTitle || 'Untitled';
                if (window._updateNoteMapEntry) {
                    window._updateNoteMapEntry(noteId, null, displayTitle);
                }
                _invalidateWikiNoteList();
            } else {
                _loadedNoteTitle = displayTitle;
                updateSidebarNoteTitle(noteId, displayTitle);
                if (data.note) {
                    _storeNote({
                        id: noteId,
                        title: displayTitle,
                        content: content,
                        properties: props || {},
                        category: currentCategory || '',
                        category_id: currentCategoryId || null,
                        icon: currentNoteIcon,
                        icon_color: currentNoteIconColor,
                        date_last_changed: data.note.date_last_changed
                    });
                }
                if (titleChanged && window._updateNoteMapEntry) {
                    window._updateNoteMapEntry(noteId, oldTitle, displayTitle);
                }
                if (titleChanged) _invalidateWikiNoteList();
            }

            document.getElementById('save-status').textContent = '\u2713 Saved';
            document.getElementById('save-status').style.color = 'var(--green)';
            updateMobileSaveBtn('saved');
            try { localStorage.setItem('flasky-notes-rev', Date.now().toString()); } catch (e) {}
            if (!editMode) renderPreview();
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
    var bc = document.getElementById('breadcrumb-note-title');
    if (bc) bc.textContent = title || 'Untitled';
}

function updateSidebarAfterSave(note) {
    var catName = note.category || 'Default';
    var targetFolder = null;
    if (note.category_id) {
        targetFolder = document.querySelector('.folder[data-category-id="' + note.category_id + '"]');
    }
    if (!targetFolder) {
        document.querySelectorAll('.folder').forEach(function(f) {
            if (f.querySelector('.folder-name').textContent.trim() === catName) targetFolder = f;
        });
    }
    if (targetFolder) {
        var items = targetFolder.querySelector('.folder-items');
        var existing = items.querySelector('.file-item[data-note-id="' + note.id + '"]');
        if (existing) {
            var nameEl = existing.querySelector('.file-name');
            if (nameEl) nameEl.textContent = note.title || 'Untitled';
        } else {
            var div = document.createElement('div');
            div.className = 'file-item active';
            div.setAttribute('data-note-id', note.id);
            div.setAttribute('data-action', 'open-note');
            div.setAttribute('draggable', 'true');
            div.setAttribute('data-drag-type', 'note');
            div.setAttribute('data-drag-id', note.id);
            div.setAttribute('data-drop-target', 'file-item');
            var iconHtml;
            if (note.icon) {
                var nColor = note.icon_color ? ' data-icon-color="' + escapeHtml(note.icon_color) + '" style="color:' + escapeHtml(note.icon_color) + '"' : '';
                iconHtml = '<span class="file-icon"><span class="lucide-icon" data-icon="' + escapeHtml(note.icon) + '"' + nColor + '></span></span>';
            } else {
                iconHtml = '<span class="file-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
            }
            div.innerHTML = iconHtml +
                '<span class="file-name">' + escapeHtml(note.title || 'Untitled') + '</span>' +
                '<button class="icon-btn delete-btn" draggable="false" data-action="delete-sidebar-note" data-note-id="' + note.id + '" data-note-title="' + escapeHtml(note.title || 'Untitled') + '" title="Delete note"><svg viewBox="0 0 24 24" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                '<button class="icon-btn pin-btn" draggable="false" data-note-id="' + note.id + '" data-action="toggle-pin" title="Pin note"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg></button>';
            items.appendChild(div);
            targetFolder.classList.remove('collapsed');
            if (typeof renderSidebarIcons === 'function') renderSidebarIcons();
        }
        var count = targetFolder.querySelector('.folder-count');
        if (count) count.textContent = items.querySelectorAll('.file-item').length;
    } else {
        refreshSidebar();
    }
    var bc = document.getElementById('breadcrumb-note-title');
    if (bc) bc.textContent = note.title || 'Untitled';
}

function deleteSidebarNote(id, title) {
    if (!confirm('Delete "' + (title || 'Untitled') + '"?')) return;
    var idx = pinnedNotes.indexOf(id);
    if (idx > -1) { pinnedNotes.splice(idx, 1); localStorage.setItem('flasky-pinned', JSON.stringify(pinnedNotes)); }
    fetch('/api/delete_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: id }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.deleteNote(id);
            if (window._deleteNoteMapEntry) window._deleteNoteMapEntry(id, title);
            _invalidateWikiNoteList();
            _storeDeleteNote(id);
            try { localStorage.setItem('flasky-notes-rev', Date.now().toString()); } catch (e) {}
            removeSidebarNoteItem(id);
            if (noteId === id) {
                if (isMobile) closeSidebar();
                loadNote(0);
            }
        }
    });
}

function deleteCurrentNote() {
    if (!noteId || noteId === 0) return;
    if (!confirm('Delete this note?')) return;
    var deletedId = noteId;
    var deletedTitle = _loadedNoteTitle;
    var idx = pinnedNotes.indexOf(deletedId);
    if (idx > -1) { pinnedNotes.splice(idx, 1); localStorage.setItem('flasky-pinned', JSON.stringify(pinnedNotes)); }
    fetch('/api/delete_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: deletedId }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.deleteNote(deletedId);
            if (window._deleteNoteMapEntry) window._deleteNoteMapEntry(deletedId, deletedTitle);
            _invalidateWikiNoteList();
            _storeDeleteNote(deletedId);
            try { localStorage.setItem('flasky-notes-rev', Date.now().toString()); } catch (e) {}
            removeSidebarNoteItem(deletedId);
            loadNote(0);
        }
    });
}

function removeSidebarNoteItem(id) {
    var item = document.querySelector('.file-item[data-note-id="' + id + '"]');
    if (!item) return;
    var folder = item.closest('.folder');
    var items = item.parentElement;
    item.remove();
    if (folder && items) {
        var count = folder.querySelector('.folder-count');
        if (count) count.textContent = items.querySelectorAll('.file-item').length;
    }
}

// ============ Category / Folder management ============

var _folderPickerData = [];
var _folderPickerOpen = false;

function getCurrentCategoryId() {
    var label = document.getElementById('folder-picker-label');
    var cid = label ? parseInt(label.dataset.categoryId) : NaN;
    if (!isNaN(cid)) return cid;
    // Fallback: try to find folder from current path in sidebar
    if (!currentCategory) return null;
    var folder = document.querySelector('.folder[data-path="' + currentCategory.replace(/"/g, '\\"') + '"]');
    return folder ? parseInt(folder.dataset.categoryId) : null;
}

function updateBreadcrumbCategory(name, id) {
    var label = document.getElementById('folder-picker-label');
    if (label) {
        label.textContent = name || 'Default';
        if (id !== undefined && id !== null) label.dataset.categoryId = id;
        else label.removeAttribute('data-category-id');
    }
}

function changeNoteCategory(categoryId) {
    categoryId = parseInt(categoryId);
    if (isNaN(categoryId)) return;
    // Find category name in current picker data or sidebar
    var cat = _folderPickerData.find(function(c) { return c.id === categoryId; });
    if (cat) updateBreadcrumbCategory(cat.name, cat.id);
    else {
        var folder = document.querySelector('.folder[data-category-id="' + categoryId + '"]');
        if (folder) updateBreadcrumbCategory(folder.querySelector('.folder-name').textContent, categoryId);
    }
    // For new notes, just update currentCategory so the first save uses it
    if (!noteId || noteId === 0) {
        currentCategory = document.getElementById('folder-picker-label').textContent;
        return;
    }
    fetch('/api/edit_note_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: noteId, category: categoryId }) })
    .then(function(r) { return r.json(); })
    .then(function(data) { if (data.success) { refreshSidebar(); } });
}

function openFolderPicker() {
    var trigger = document.getElementById('folder-picker-trigger');
    var popover = document.getElementById('folder-picker-popover');
    if (!trigger || !popover) return;
    if (popover.classList.contains('visible')) { closeFolderPicker(); return; }
    _folderPickerOpen = true;
    popover.classList.add('visible');
    positionFolderPicker();
    setTimeout(function() { document.getElementById('folder-picker-search').focus(); }, 10);
    document.addEventListener('click', closeFolderPickerOnOutsideClick, true);
    refreshFolderPicker();
}

function closeFolderPicker() {
    var popover = document.getElementById('folder-picker-popover');
    if (popover) popover.classList.remove('visible');
    _folderPickerOpen = false;
    document.removeEventListener('click', closeFolderPickerOnOutsideClick, true);
}

function closeFolderPickerOnOutsideClick(e) {
    var popover = document.getElementById('folder-picker-popover');
    var trigger = document.getElementById('folder-picker-trigger');
    if (!popover || popover.contains(e.target) || (trigger && trigger.contains(e.target))) return;
    closeFolderPicker();
}

function positionFolderPicker() {
    var trigger = document.getElementById('folder-picker-trigger');
    var popover = document.getElementById('folder-picker-popover');
    if (!trigger || !popover) return;
    var rect = trigger.getBoundingClientRect();
    // Always prefer opening below the trigger (stuck to top of page flow)
    popover.classList.remove('position-top');
    var popoverHeight = popover.offsetHeight || 380;
    var spaceBelow = window.innerHeight - rect.bottom - 8;
    if (spaceBelow < 180 && rect.top > popoverHeight + 8) {
        popover.classList.add('position-top');
    }
        // On mobile align popover to viewport edges
        if (window.innerWidth <= 768) {
            popover.style.left = '8px';
            popover.style.right = '8px';
            popover.style.width = 'auto';
            popover.style.top = (rect.bottom + 4) + 'px';
        } else {
            popover.style.left = '';
            popover.style.right = '';
            popover.style.width = '';
            popover.style.top = '';
        }
    }

function buildFolderPickerItems(filter) {
    var treeRoot = document.getElementById('file-tree');
    var items = [];
    // Use sidebar tree as source of truth (works for E2EE and non-E2EE)
    treeRoot.querySelectorAll('.folder[data-category-id]').forEach(function(f) {
        var id = parseInt(f.dataset.categoryId);
        var path = f.dataset.path || '';
        var parts = path.split('/');
        var depth = Math.max(0, parts.length - 1);
        var header = f.querySelector('.folder-header');
        var iconData = null;
        if (header) {
            var iconEl = header.querySelector('.lucide-icon[data-icon]');
            var svgEl = header.querySelector('.folder-icon > svg');
            if (iconEl) iconData = { icon: iconEl.dataset.icon, color: iconEl.dataset.iconColor || null };
            else if (svgEl) iconData = { svg: true };
        }
        items.push({ id: id, path: path, depth: depth, iconData: iconData });
    });
    // Sort by full path so parents appear before children (e.g. "Work"
    // before "Work/Projects"). Must happen before we overwrite path with
    // the leaf name for display.
    items.sort(function(a, b) { return a.path.toLowerCase().localeCompare(b.path.toLowerCase()); });
    // Replace full path with the decrypted leaf name for display.
    items.forEach(function(item) {
        var folderEl = document.querySelector('.folder[data-category-id="' + item.id + '"]');
        if (folderEl) {
            var nameEl = folderEl.querySelector('.folder-name');
            if (nameEl) item.path = nameEl.textContent.trim();
        }
    });
    if (filter) {
        var q = filter.toLowerCase();
        items = items.filter(function(item) { return item.path.toLowerCase().includes(q); });
    }
    return items;
}

function renderFolderPicker(filter) {
    var tree = document.getElementById('folder-picker-tree');
    if (!tree) return;
    var items = buildFolderPickerItems(filter);
    _folderPickerData = items;
    var currentId = getCurrentCategoryId();
    if (items.length === 0) {
        tree.innerHTML = '<div class="folder-picker-empty">No folders found</div>';
        return;
    }
    var isEncrypted = typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();
    var html = '';
    items.forEach(function(item) {
        var isCurrent = item.id === currentId;
        var indent = item.depth * 14;
        var iconHtml = '';
        if (item.iconData && item.iconData.icon) {
            var colorAttr = item.iconData.color ? ' data-icon-color="' + escapeHtml(item.iconData.color) + '" style="color:' + escapeHtml(item.iconData.color) + '"' : '';
            iconHtml = '<span class="lucide-icon folder-picker-item-icon" data-icon="' + escapeHtml(item.iconData.icon) + '"' + colorAttr + '></span>';
        } else {
            iconHtml = '<span class="folder-picker-item-icon"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>';
        }
        html += '<button type="button" class="folder-picker-item' + (isCurrent ? ' current' : '') + '" data-action="select-folder" data-category-id="' + item.id + '" style="padding-left:' + (8 + indent) + 'px">' +
            '<span class="folder-picker-indent" style="width:' + indent + 'px"></span>' +
            iconHtml +
            '<span class="folder-picker-item-name">' + escapeHtml(item.path) + '</span>' +
            (isCurrent ? '<span class="folder-picker-item-path">current</span>' : '') +
            '</button>';
    });
    tree.innerHTML = html;
    if (typeof ensureLucideLoaded === 'function') ensureLucideLoaded(function() {
        tree.querySelectorAll('.lucide-icon[data-icon]').forEach(function(el) {
            var icon = el.dataset.icon;
            var color = el.dataset.iconColor || null;
            el.innerHTML = renderLucideIcon(icon, color, 16);
        });
    });
}

function refreshFolderPicker() {
    var search = document.getElementById('folder-picker-search');
    renderFolderPicker(search ? search.value : '');
}

function selectFolderFromPicker(categoryId) {
    closeFolderPicker();
    changeNoteCategory(categoryId);
}

function newFolderFromPicker() {
    closeFolderPicker();
    promptNewFolder();
}

function createNewNoteInFolder(catId, catName) {
    if (isMobile) closeSidebar();
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
    else if (data.reason) { alert(data.reason); }
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
    if (target.type === 'attachment') {
        html += '<div class="context-menu-item" data-action="ctx-rename-attachment"><svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Rename</div>';
        html += '<div class="context-menu-item" data-action="ctx-find-attachment"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Find in notes</div>';
        html += '<div class="context-menu-item" data-action="ctx-download-attachment"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download</div>';
        html += '<div class="context-menu-sep"></div>';
        html += '<div class="context-menu-item danger" data-action="ctx-delete-attachment"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</div>';
    } else if (target.type === 'attachments-folder') {
        if (target.subcategory) {
            html += '<div class="context-menu-item danger" data-action="ctx-delete-attachment-category"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete all in ' + _esc(target.title) + '</div>';
        } else {
            html += '<div class="context-menu-item danger" data-action="ctx-delete-all-attachments"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete all attachments</div>';
        }
    } else if (target.type === 'note') {
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
    if (aiDropdown && aiDropdown.classList.contains('open')) { closeAIDropdown(); }
    if (exportDropdown && exportDropdown.classList.contains('open')) { closeExportDropdown(); }
});

// Extract context info from a sidebar element
function getContextTarget(el) {
    var attItem = el.closest('.attachment-item');
    if (attItem) {
        var aid = parseInt(attItem.dataset.attachmentId);
        var aname = attItem.dataset.attachmentName || '';
        return { type: 'attachment', id: aid, name: aname };
    }
    var folderHeader = el.closest('.folder-header');
    if (folderHeader) {
        var folder = folderHeader.parentElement;
        if (folder.dataset.virtual === 'attachments') {
            var subcat = folder.dataset.subcategory || null;
            var vname = folder.querySelector('.folder-name').textContent;
            return { type: 'attachments-folder', subcategory: subcat, title: vname, path: folder.dataset.path || '' };
        }
        var catId = folder.dataset.categoryId ? parseInt(folder.dataset.categoryId) : null;
        var path = folder.dataset.path || '';
        var name = folder.querySelector('.folder-name').textContent;
        return { type: 'folder', id: catId, title: name, catId: catId, path: path };
    }
    var fileItem = el.closest('.file-item');
    if (fileItem) {
        var nid = parseInt(fileItem.dataset.noteId);
        var title = fileItem.querySelector('.file-name').textContent;
        var folder2 = fileItem.closest('.folder');
        return { type: 'note', id: nid, title: title, catId: folder2 ? parseInt(folder2.dataset.categoryId) : null, path: folder2 ? folder2.dataset.path : '' };
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
            var oldTitle = t.title;
            var newTitleTrimmed = newTitle.trim();
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.updateNote({ id: t.id, title: newTitleTrimmed });
            if (window._updateNoteMapEntry) window._updateNoteMapEntry(t.id, oldTitle, newTitleTrimmed);
            _invalidateWikiNoteList();
            try { localStorage.setItem('flasky-notes-rev', Date.now().toString()); } catch (e) {}
            refreshSidebar();
            // If this is the currently open note, update the title in the editor
            if (noteId === t.id) {
                _loadedNoteTitle = newTitleTrimmed;
                var titleEl = document.querySelector('.editor-title');
                if (titleEl) titleEl.value = newTitleTrimmed;
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
        fetch('/api/rename_category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: t.id, renames: renames }) })
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

// ============ Attachment context-menu handlers ============

function ctxFindAttachment() {
    if (!ctxTarget || ctxTarget.type !== 'attachment') return;
    var name = ctxTarget.name;
    hideContextMenu();
    _findAttachmentInNotes(name);
}

function ctxDownloadAttachment() {
    if (!ctxTarget || ctxTarget.type !== 'attachment') return;
    var id = ctxTarget.id, name = ctxTarget.name;
    hideContextMenu();
    _downloadAttachment(id, name);
}

async function ctxDeleteAttachment() {
    if (!ctxTarget || ctxTarget.type !== 'attachment') return;
    var id = ctxTarget.id, name = ctxTarget.name;
    hideContextMenu();
    var refCount = await _countAttachmentReferences(name);
    var msg = 'Delete "' + name + '"?';
    if (refCount > 0) msg += '\n\nIt is embedded in ' + refCount + ' note(s). Broken embeds will remain in those notes.';
    else msg += '\n\nIt is not embedded in any notes.';
    msg += '\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    _deleteAttachmentById(id);
}

async function ctxRenameAttachment() {
    var id, oldName;
    if (ctxTarget && ctxTarget.type === 'attachment') {
        id = ctxTarget.id; oldName = ctxTarget.name;
        hideContextMenu();
    } else if (_previewAttachmentId) {
        id = _previewAttachmentId; oldName = _previewAttachmentName || '';
    } else {
        return;
    }
    if (!id || !oldName) return;
    var newName = prompt('Rename attachment:', oldName);
    if (!newName) return;
    newName = newName.trim();
    if (!newName || newName === oldName) return;

    if (window.FlaskyAttachments) {
        var attMap = window.FlaskyAttachments.getAttachmentMap();
        if (attMap) {
            var existing = attMap[newName.toLowerCase()];
            if (existing && existing.id !== id) {
                alert('An attachment with that name already exists.');
                return;
            }
        }
    }

    var isE2EE = typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();
    if (!isE2EE) { alert('Rename requires an unlocked session.'); return; }

    if (typeof FlaskySearch !== 'undefined' && !FlaskySearch.getIndex()) {
        try { await FlaskySearch.buildIndex(); } catch (e) {}
    }

    var oldToken = '![[' + oldName + ']]';
    var newToken = '![[' + newName + ']]';
    var index = FlaskySearch.getIndex() || [];
    var noteUpdates = [];
    for (var i = 0; i < index.length; i++) {
        var entry = index[i];
        if (!entry.content || entry.content.indexOf(oldToken) === -1) continue;
        var newContent = entry.content.split(oldToken).join(newToken);
        if (newContent === entry.content) continue;
        noteUpdates.push({ noteId: entry.id, plainContent: newContent });
    }

    var encNotes = [];
    for (var k = 0; k < noteUpdates.length; k++) {
        try {
            var enc = await FlaskyE2EE.encryptField(noteUpdates[k].plainContent);
            encNotes.push({ noteId: noteUpdates[k].noteId, content: enc });
        } catch (e) {
            alert('Failed to encrypt note content for rename.');
            return;
        }
    }

    var encFilename;
    try {
        encFilename = await FlaskyE2EE.encryptField(newName);
    } catch (e) {
        alert('Failed to encrypt attachment name.');
        return;
    }

    var payload = { attachmentId: id, newFilename: encFilename, notes: encNotes };
    try {
        var resp = await fetch('/api/attachment/' + id + '/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = await resp.json();
        if (!resp.ok) {
            alert(data.error || 'Rename failed.');
            return;
        }
    } catch (e) {
        alert('Rename failed.');
        return;
    }

    for (var m = 0; m < noteUpdates.length; m++) {
        var nu = noteUpdates[m];
        var cached = _noteStore.get(nu.noteId);
        if (cached) {
            cached.content = nu.plainContent;
            _storeNote(cached);
        }
        if (typeof FlaskySearch !== 'undefined') {
            FlaskySearch.updateNote({ id: nu.noteId, content: nu.plainContent });
        }
        if (noteId === nu.noteId && cmEditor) {
            cmEditor.setValue(nu.plainContent);
            cmEditor.refresh();
            isDirty = false;
            if (!editMode) renderPreview();
        }
    }

    if (window.FlaskyAttachments) window.FlaskyAttachments.invalidateAttachmentIndex();
    if (window._invalidateNoteMap) window._invalidateNoteMap();
    refreshSidebar();

    if (_previewAttachmentId === id) {
        _previewAttachmentName = newName;
        var titleEl = document.getElementById('attachment-preview-title');
        if (titleEl) titleEl.textContent = newName;
        var dlBtn = document.getElementById('attachment-preview-download-btn');
        if (dlBtn && dlBtn.onclick) {
            (function (nm) { dlBtn.onclick = function () {
                var a = document.createElement('a');
                if (_previewObjectUrl) { a.href = _previewObjectUrl; a.download = nm; }
                document.body.appendChild(a); a.click(); a.remove();
            }; })(newName);
        }
        var findBtn = document.getElementById('attachment-preview-find-btn');
        if (findBtn && findBtn.onclick) {
            (function (nm) { findBtn.onclick = function () { _findAttachmentInNotes(nm); }; })(newName);
        }
    }
    try { localStorage.setItem('flasky-notes-rev', Date.now().toString()); } catch (e) {}
}

async function ctxDeleteAllAttachments() {
    if (!ctxTarget || ctxTarget.type !== 'attachments-folder') return;
    hideContextMenu();
    if (!window.FlaskyAttachments) return;
    var idx = window.FlaskyAttachments.getAttachmentIndex();
    if (!idx || idx.length === 0) { alert('No attachments to delete.'); return; }
    var msg = 'Delete all ' + idx.length + ' attachment(s)?\n\nSome may be embedded in notes. Broken embeds will remain.\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    var ids = idx.map(function (a) { return a.id; });
    _deleteAttachmentsBatch(ids);
}

async function ctxDeleteAttachmentCategory() {
    if (!ctxTarget || ctxTarget.type !== 'attachments-folder' || !ctxTarget.subcategory) return;
    var subcat = ctxTarget.subcategory, label = ctxTarget.title;
    hideContextMenu();
    if (!window.FlaskyAttachments) return;
    var ids = window.FlaskyAttachments.getIdsByCategory(subcat);
    if (!ids || ids.length === 0) { alert('No attachments in ' + label + '.'); return; }
    var msg = 'Delete all ' + ids.length + ' attachment(s) in ' + label + '?\n\nSome may be embedded in notes. Broken embeds will remain.\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    _deleteAttachmentsBatch(ids);
}

async function _countAttachmentReferences(filename) {
    if (!filename || typeof FlaskySearch === 'undefined') return 0;
    try {
        var results = await FlaskySearch.search('![[' + filename + ']]');
        return results ? results.length : 0;
    } catch (e) { return 0; }
}

function _downloadAttachment(attId, name) {
    var url = '/attachment/' + attId + '/' + encodeURIComponent(name);
    fetch(url).then(function (r) {
        if (!r.ok) throw new Error('fetch failed');
        return r.arrayBuffer();
    }).then(function (buf) {
        return FlaskyE2EE.decryptBlob(new Uint8Array(buf));
    }).then(function (decrypted) {
        var mime = window.FlaskyAttachments ? window.FlaskyAttachments.mimeForName(name) : 'application/octet-stream';
        var blob = new Blob([decrypted], { type: mime });
        var objUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = objUrl; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(objUrl);
    }).catch(function () {
        alert('Failed to download attachment.');
    });
}

function _deleteAttachmentById(attId) {
    fetch('/api/attachment/' + attId, { method: 'DELETE' })
        .then(function (r) {
            if (!r.ok) throw new Error('delete failed');
            if (window.FlaskyAttachments) window.FlaskyAttachments.invalidateAttachmentIndex();
            _invalidateNoteMap();
            refreshSidebar();
        }).catch(function () {
            alert('Failed to delete attachment.');
        });
}

function _deleteAttachmentsBatch(ids) {
    fetch('/api/attachments/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids })
    }).then(function (r) {
        if (!r.ok) throw new Error('batch delete failed');
        if (window.FlaskyAttachments) window.FlaskyAttachments.invalidateAttachmentIndex();
        _invalidateNoteMap();
        refreshSidebar();
    }).catch(function () {
        alert('Failed to delete attachments.');
    });
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
    // The calendar widget can render in the left sidebar (placement="left") or
    // the right-panel stack (placement="right"). For left placement it moves
    // into a dedicated slot in the sidebar template; for right placement it
    // behaves like any other panel widget. Visibility/reorder config still
    // applies either way.
    var sidebarSlot = document.getElementById('sidebar-calendar-slot');
    panelWidgets.forEach(function(w) {
        var el = document.getElementById('widget-' + w.id);
        if (!el) return;
        if (w.id === 'calendar' && calendarPlacement === 'left') {
            if (sidebarSlot) sidebarSlot.appendChild(el);
        } else {
            container.appendChild(el); // reorder
        }
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
    if (panel.classList.contains('visible')) {
        renderWidgetConfigList();
        renderTopbarConfigList();
    }
}

// Drag-drop reorder of right-panel widgets by grabbing their section headers.
// Mirrors the widget-config-list reorder pattern but operates directly on the
// rendered widgets. Order is persisted via the same panel_widgets setting.
function initWidgetHeaderDrag() {
    if (isMobile) return;
    var container = document.getElementById('right-panel-widgets');
    if (!container) return;
    panelWidgets.forEach(function(w) {
        if (!w.visible) return;
        if (w.id === 'calendar' && calendarPlacement === 'left') return; // lives in sidebar slot
        var widgetEl = document.getElementById('widget-' + w.id);
        if (!widgetEl) return;
        var header = widgetEl.querySelector('.widget-header');
        if (!header) return;

        // Buttons inside the header must not initiate a drag so their click
        // handlers (add-todo/add-event) still fire normally.
        var addBtn = header.querySelector('.widget-add-btn');
        if (addBtn) addBtn.setAttribute('draggable', 'false');

        if (header.dataset.dragBound === '1') return;  // avoid double-binding on re-init
        header.dataset.dragBound = '1';
        header.setAttribute('draggable', 'true');

        header.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', 'widget:' + w.id);
            e.dataTransfer.effectAllowed = 'move';
            widgetEl.classList.add('dragging');
            e.stopPropagation();   // keep separate from sidebar note/folder drag system
        });
        header.addEventListener('dragend', function() {
            widgetEl.classList.remove('dragging');
            container.querySelectorAll('.panel-widget').forEach(function(el) {
                el.classList.remove('drag-over');
            });
        });
        // Drop zone is the whole widget so hovering the body works too. Guard
        // against sidebar note/folder drags via the module-level dragType flag.
        widgetEl.addEventListener('dragover', function(e) {
            if (dragType) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            widgetEl.classList.add('drag-over');
            e.stopPropagation();
        });
        widgetEl.addEventListener('dragleave', function(e) {
            if (e.relatedTarget && widgetEl.contains(e.relatedTarget)) return;
            widgetEl.classList.remove('drag-over');
        });
        widgetEl.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            widgetEl.classList.remove('drag-over');
            if (dragType) return;
            var raw = e.dataTransfer.getData('text/plain') || '';
            if (raw.indexOf('widget:') !== 0) return;
            var fromId = raw.slice(7);
            var toId = w.id;
            if (fromId === toId) return;
            var fromIdx = -1, toIdx = -1;
            for (var i = 0; i < panelWidgets.length; i++) {
                if (panelWidgets[i].id === fromId) fromIdx = i;
                if (panelWidgets[i].id === toId) toIdx = i;
            }
            if (fromIdx === -1 || toIdx === -1) return;
            var moved = panelWidgets.splice(fromIdx, 1)[0];
            panelWidgets.splice(toIdx, 0, moved);
            applyWidgetLayout();   // appendChild moves nodes — listeners survive, no re-init needed
            saveWidgetConfig();
        });
    });
}

function renderWidgetConfigList() {
    var list = document.getElementById('widget-config-list');
    if (!list) return;
    list.innerHTML = '';
    panelWidgets.forEach(function(w, idx) {
        var item = document.createElement('div');
        item.className = 'config-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-widget-idx', idx);
        item.innerHTML =
            '<span class="config-drag-handle"><svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="12" x2="8" y2="12.01"/><line x1="16" y1="12" x2="16" y2="12.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="16" y1="18" x2="16" y2="18.01"/></svg></span>' +
            '<span class="config-label">' + escapeHtml(w.label) + '</span>' +
            '<label class="config-toggle"><input type="checkbox" ' + (w.visible ? 'checked' : '') + ' data-action="toggle-widget-visibility" data-widget-idx="' + idx + '"><span class="config-slider"></span></label>';

        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', 'wcfg:' + idx);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function() {
            item.classList.remove('dragging');
            list.querySelectorAll('.config-item').forEach(function(el) { el.classList.remove('drag-over'); });
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
            var raw = e.dataTransfer.getData('text/plain') || '';
            if (raw.indexOf('wcfg:') !== 0) return;
            var fromIdx = parseInt(raw.slice(4), 10);
            var toIdx = idx;
            if (isNaN(fromIdx) || fromIdx === toIdx) return;
            var moved = panelWidgets.splice(fromIdx, 1)[0];
            panelWidgets.splice(toIdx, 0, moved);
            applyWidgetLayout();
            renderWidgetConfigList();
            saveWidgetConfig();
        });

        list.appendChild(item);
    });

    if (isMobile) addMobileMoveButtons(list);
}

function addMobileMoveButtons(list) {
    list.querySelectorAll('.config-item').forEach(function(item, idx) {
        var handle = item.querySelector('.config-drag-handle');
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
    if (visible) {
        refreshWidget(panelWidgets[idx].id);
        initWidgetHeaderDrag();
    }
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
    else if (widgetId === 'link_graph') loadLinkGraph();
    else if (widgetId === 'properties') updateRightPanelProps();
    else if (widgetId === 'todos') loadTodosWidget();
    else if (widgetId === 'events') loadEventsWidget();
    else if (widgetId === 'quick_settings') syncQuickSettingsState();
    else if (widgetId === 'calendar') renderSidebarCalendar();
}

function refreshAllVisibleWidgets() {
    panelWidgets.forEach(function(w) {
        if (w.visible) refreshWidget(w.id);
    });
}

// The calendar widget can live in the left sidebar (independent of the right
// panel open/closed state), so refresh it on save regardless of right-panel
// visibility. No-op if the widget is hidden or daily notes are disabled.
function refreshCalendarWidget() {
    var w = panelWidgets.find(function(x) { return x.id === 'calendar'; });
    if (w && w.visible) renderSidebarCalendar();
}

// ============ Topbar items ============
// Mirrors the panel_widgets engine: a JSON list of {id,label,visible} items
// (loaded from _pageData.topbarItems) drives the order + visibility of the
// right-side .toolbar-actions cluster. Reorder via drag in the config popover.
// save and panel_toggle are non-disablable: the server forces visible=true and
// the config list renders them without a toggle.

var topbarItems = _pageData.topbarItems || [];
var topbarDragId = null;
var NON_DISABLABLE_TOPBAR_IDS = {"save": true, "panel_toggle": true};

function applyTopbarLayout() {
    var container = document.getElementById('toolbar-actions');
    if (!container) return;
    topbarItems.forEach(function(it) {
        var el = document.getElementById('topbar-btn-' + it.id);
        if (!el) return; // feature-gated item not in DOM
        container.appendChild(el);
        if (it.visible) {
            el.classList.remove('hidden-topbar-item');
        } else {
            el.classList.add('hidden-topbar-item');
        }
    });
}

function renderTopbarConfigList() {
    var list = document.getElementById('topbar-config-list');
    if (!list) return;
    list.innerHTML = '';
    topbarItems.forEach(function(it, idx) {
        var item = document.createElement('div');
        item.className = 'config-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-topbar-idx', idx);
        var toggleHtml;
        if (NON_DISABLABLE_TOPBAR_IDS[it.id]) {
            toggleHtml = '<span class="config-locked">Always on</span>';
        } else {
            toggleHtml = '<label class="config-toggle"><input type="checkbox" ' + (it.visible ? 'checked' : '') + ' data-action="toggle-topbar-visibility" data-topbar-idx="' + idx + '"><span class="config-slider"></span></label>';
        }
        item.innerHTML =
            '<span class="config-drag-handle"><svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="12" x2="8" y2="12.01"/><line x1="16" y1="12" x2="16" y2="12.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="16" y1="18" x2="16" y2="18.01"/></svg></span>' +
            '<span class="config-label">' + escapeHtml(it.label) + '</span>' +
            toggleHtml;

        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', 'topbar:' + idx);
            topbarDragId = idx;
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function() {
            item.classList.remove('dragging');
            topbarDragId = null;
            list.querySelectorAll('.config-item').forEach(function(el) { el.classList.remove('drag-over'); });
        });
        item.addEventListener('dragover', function(e) {
            if (topbarDragId === null) return;
            e.preventDefault();
            item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', function() {
            item.classList.remove('drag-over');
        });
        item.addEventListener('drop', function(e) {
            e.preventDefault();
            item.classList.remove('drag-over');
            var raw = e.dataTransfer.getData('text/plain') || '';
            if (raw.indexOf('topbar:') !== 0) return;
            var fromIdx = parseInt(raw.slice(7), 10);
            var toIdx = idx;
            if (isNaN(fromIdx) || fromIdx === toIdx) return;
            var moved = topbarItems.splice(fromIdx, 1)[0];
            topbarItems.splice(toIdx, 0, moved);
            applyTopbarLayout();
            renderTopbarConfigList();
            saveTopbarConfig();
        });

        list.appendChild(item);
    });

    if (isMobile) addTopbarMobileMoveButtons(list);
}

function addTopbarMobileMoveButtons(list) {
    list.querySelectorAll('.config-item').forEach(function(item, idx) {
        var handle = item.querySelector('.config-drag-handle');
        handle.innerHTML = '';
        if (idx > 0) {
            var upBtn = document.createElement('button');
            upBtn.className = 'icon-btn';
            upBtn.style.cssText = 'padding:2px;';
            upBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg>';
            upBtn.onclick = function(e) {
                e.stopPropagation();
                var moved = topbarItems.splice(idx, 1)[0];
                topbarItems.splice(idx - 1, 0, moved);
                applyTopbarLayout();
                renderTopbarConfigList();
                saveTopbarConfig();
            };
            handle.appendChild(upBtn);
        }
        if (idx < topbarItems.length - 1) {
            var downBtn = document.createElement('button');
            downBtn.className = 'icon-btn';
            downBtn.style.cssText = 'padding:2px;';
            downBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>';
            downBtn.onclick = function(e) {
                e.stopPropagation();
                var moved = topbarItems.splice(idx, 1)[0];
                topbarItems.splice(idx + 1, 0, moved);
                applyTopbarLayout();
                renderTopbarConfigList();
                saveTopbarConfig();
            };
            handle.appendChild(downBtn);
        }
        item.setAttribute('draggable', 'false');
    });
}

function toggleTopbarItemVisibility(idx, visible) {
    topbarItems[idx].visible = visible;
    applyTopbarLayout();
    saveTopbarConfig();
}

function saveTopbarConfig() {
    saveUiState({ topbar_items: topbarItems });
}

// ============ Sidebar calendar widget ============
// Renders a month grid in the left sidebar. Days that have a daily note are
// marked with a dot; clicking a day opens (or creates) that day's daily note.
// Marking is computed client-side from the decrypted note index because note
// titles are E2EE ciphertext the server cannot read.
var sidebarCalendarState = { year: null, month: null };
var CALENDAR_WEEK_START = 1; // 0 = Sunday, 1 = Monday

function _ensureCalendarState() {
    var today = nowInUserTz();
    if (sidebarCalendarState.year === null) {
        sidebarCalendarState.year = today.getFullYear();
        sidebarCalendarState.month = today.getMonth();
    }
}

function _monthLabel(year, month) {
    var names = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
    return names[month] + ' ' + year;
}

async function _buildDailyNoteMarkSet(year, month) {
    // Returns a Set of day-numbers (1-31) that have a daily note in the given
    // month. Matching is against the user's daily-note title format, computed
    // client-side from the decrypted note index (titles are E2EE ciphertext).
    var fmt = dailyNoteConfig.titleFormat || 'YYYY-MM-DD';
    var idx = [];
    if (typeof FlaskySearch !== 'undefined') {
        try { idx = await FlaskySearch.buildIndex(); } catch(e) { idx = []; }
    }
    if (!Array.isArray(idx)) idx = [];
    var titleSet = {};
    for (var i = 0; i < idx.length; i++) {
        if (idx[i] && idx[i].title) titleSet[idx[i].title] = true;
    }
    var marked = new Set();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
        var title = formatDailyTitle(fmt, new Date(year, month, d));
        if (titleSet[title]) marked.add(d);
    }
    return marked;
}

async function renderSidebarCalendar() {
    var grid = document.getElementById('sidebar-calendar-grid');
    var titleEl = document.getElementById('sidebar-calendar-title');
    if (!grid || !titleEl) return;
    var widget = document.getElementById('widget-calendar');
    if (widget && widget.classList.contains('hidden-widget')) return;
    if (!dailyNoteConfig.enabled) return;
    _ensureCalendarState();
    var year = sidebarCalendarState.year;
    var month = sidebarCalendarState.month;
    titleEl.textContent = _monthLabel(year, month);

    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var firstWeekday = new Date(year, month, 1).getDay();
    // Shift for week start (0=Sun, 1=Mon).
    var leadOffset = (firstWeekday - CALENDAR_WEEK_START + 7) % 7;
    var today = nowInUserTz();
    var weekdayLabels = CALENDAR_WEEK_START === 1
        ? ['M','T','W','T','F','S','S']
        : ['S','M','T','W','T','F','S'];
    var html = '<div class="sidebar-cal-weekdays">';
    for (var w = 0; w < 7; w++) html += '<span class="sidebar-cal-wd">' + weekdayLabels[w] + '</span>';
    html += '</div><div class="sidebar-cal-days">';
    for (var c = 0; c < leadOffset; c++) html += '<span class="sidebar-cal-empty"></span>';
    for (var d = 1; d <= daysInMonth; d++) {
        var classes = 'sidebar-cal-day';
        if (year === today.getFullYear() && month === today.getMonth() && d === today.getDate()) classes += ' is-today';
        html += '<span class="' + classes + '" data-cal-day="' + d + '" data-action="cal-open-day">' + d + '</span>';
    }
    html += '</div>';
    grid.innerHTML = html;

    // Mark days that have a daily note (client-side, E2EE-aware).
    _buildDailyNoteMarkSet(year, month).then(function(marked) {
        marked.forEach(function(d) {
            var el = grid.querySelector('.sidebar-cal-day[data-cal-day="' + d + '"]');
            if (el) el.classList.add('has-daily-note');
        });
    });
}

function sidebarCalendarPrev() {
    _ensureCalendarState();
    sidebarCalendarState.month -= 1;
    if (sidebarCalendarState.month < 0) {
        sidebarCalendarState.month = 11;
        sidebarCalendarState.year -= 1;
    }
    renderSidebarCalendar();
}

function sidebarCalendarNext() {
    _ensureCalendarState();
    sidebarCalendarState.month += 1;
    if (sidebarCalendarState.month > 11) {
        sidebarCalendarState.month = 0;
        sidebarCalendarState.year += 1;
    }
    renderSidebarCalendar();
}

function sidebarCalendarOpenDay(dayNum) {
    _ensureCalendarState();
    var date = new Date(sidebarCalendarState.year, sidebarCalendarState.month, dayNum);
    openDailyNoteFor(date);
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
            document.getElementById('todo-modal-input-date').value = t.date_due ? extractAgendaDate(t.date_due) : '';
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
    var dateDue = composeAgendaDateIso(date, '');

    var encTitle = title, encContent = content;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        encTitle = await FlaskyE2EE.encryptField(title);
        encContent = await FlaskyE2EE.encryptField(content);
    }

    if (currentModalTodoId) {
        fetch('/api/edit_todo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toDoId: currentModalTodoId, title: encTitle, content: encContent, dateDue: dateDue })
        }).then(function(r) { return r.json(); })
        .then(function() { closeTodoDetailModal(); loadTodosWidget(); });
    } else {
        fetch('/api/add_todo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: encTitle, content: encContent, dateDue: dateDue })
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
            document.getElementById('event-modal-input-date').value = e.date_of_event ? extractAgendaDate(e.date_of_event) : '';
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
    var dateOfEvent = composeAgendaDateIso(date, '');

    var encTitle = title, encContent = content;
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
        encTitle = await FlaskyE2EE.encryptField(title);
        encContent = await FlaskyE2EE.encryptField(content);
    }

    if (currentModalEventId) {
        fetch('/api/edit_event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: currentModalEventId, title: encTitle, content: encContent, dateOfEvent: dateOfEvent })
        }).then(function(r) { return r.json(); })
        .then(function() { closeEventDetailModal(); loadEventsWidget(); });
    } else {
        fetch('/api/add_event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: encTitle, content: encContent, dateOfEvent: dateOfEvent })
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
    var compactEl = document.getElementById('qs-compact-mode');
    var spotlightEl = document.getElementById('qs-spotlight-mode');
    var renderEmbedsEl = document.getElementById('qs-render-embeds');
    var livePreviewEl = document.getElementById('qs-live-preview');
    if (darkEl) darkEl.checked = document.documentElement.getAttribute('data-theme') === 'dark';
    if (previewEl) previewEl.checked = !editMode;
    if (hideTitleEl) {
        var titleWrap = document.getElementById('editor-title-wrap');
        hideTitleEl.checked = titleWrap && titleWrap.classList.contains('hidden');
    }
    if (propsEl) propsEl.checked = document.getElementById('props-container') && document.getElementById('props-container').classList.contains('collapsed');
    if (autoSaveEl) autoSaveEl.checked = autoSaveEnabled;
    if (compactEl) compactEl.checked = document.documentElement.getAttribute('data-compact') === 'true';
    if (spotlightEl) spotlightEl.checked = document.documentElement.getAttribute('data-spotlight') === 'true';
    if (renderEmbedsEl) renderEmbedsEl.checked = !!_pageData.renderEmbedsInEditMode;
    if (livePreviewEl) livePreviewEl.checked = !!_pageData.livePreview;
}

function toggleRenderEmbeds() {
    var enabled = !_pageData.renderEmbedsInEditMode;
    _pageData.renderEmbedsInEditMode = enabled;
    if (cmEditor && cmEditor.setRenderEmbeds) cmEditor.setRenderEmbeds(enabled);
    saveUiState({ render_embeds_in_edit_mode: enabled ? 1 : 0 });
}

function toggleLivePreview() {
    var enabled = !_pageData.livePreview;
    _pageData.livePreview = enabled;
    if (cmEditor && cmEditor.setLivePreview) cmEditor.setLivePreview(enabled);
    saveUiState({ live_preview: enabled ? 1 : 0 });
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
    var wrapEl = document.getElementById('editor-title-wrap');
    if (!wrapEl) return;
    var hidden = wrapEl.classList.contains('hidden');
    wrapEl.classList.toggle('hidden');
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
    if (typeof window._setEmbedBgSettings === 'function') {
        window._setEmbedBgSettings(_pageData.embedBgMode, _pageData.embedBgColor, !isDark);
    }
    if (!editMode) renderPreview();
    fetch('/api/save_dark_mode/' + (isDark ? 0 : 1));
    syncQuickSettingsState();
}

function toggleCompactMode() {
    var html = document.documentElement;
    var isCompact = html.getAttribute('data-compact') === 'true';
    if (isCompact) html.removeAttribute('data-compact');
    else html.setAttribute('data-compact', 'true');
    if (cmEditor) cmEditor.refresh();
    fetch('/api/save_compact_mode/' + (isCompact ? 0 : 1));
    syncQuickSettingsState();
}

function toggleSpotlightMode() {
    var html = document.documentElement;
    var isSpotlight = html.getAttribute('data-spotlight') === 'true';
    if (isSpotlight) html.removeAttribute('data-spotlight');
    else html.setAttribute('data-spotlight', 'true');
    if (cmEditor) cmEditor.refresh();
    fetch('/api/save_spotlight_mode/' + (isSpotlight ? 0 : 1));
    syncQuickSettingsState();
}

// ============ Outline + Backlinks ============

function toggleRightPanel() {
    var panel = document.getElementById('right-panel');
    var btn = document.getElementById('panel-toggle');
    var wasCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    var expanded = !panel.classList.contains('collapsed');
    if (expanded) {
        if (btn) btn.classList.add('active');
        refreshAllVisibleWidgets();
        // On mobile, close the sidebar so they don't overlap
        if (isMobile) closeSidebar();
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
    if (!list) return;
    try {
        var title = document.getElementById('note-title');
        var noteTitle = title ? title.value : '';
        if (!noteTitle) { list.innerHTML = '<li class="backlinks-empty">No backlinks</li>'; return; }
        if (typeof FlaskySearch !== 'undefined' && FlaskySearch.isBuilding()) {
            list.innerHTML = '<li class="backlinks-empty">Loading backlinks...</li>';
        }
        var data = await FlaskySearch.computeBacklinks(noteTitle);
        if (data.length === 0) { list.innerHTML = '<li class="backlinks-empty">No backlinks</li>'; return; }
        var html = '';
        data.forEach(function(n) { html += '<li><a href="/note/' + n.id + '" data-action="open-note-link" data-note-id="' + n.id + '">' + escapeHtml(n.title || 'Untitled') + '</a></li>'; });
        list.innerHTML = html;
    } catch(e) { list.innerHTML = '<li class="backlinks-empty">Failed to load</li>'; }
}

function loadOutboundLinks() {
    updateOutboundLinksFromContent();
}

// ============ Link Graph ============

function _isWidgetVisible(widgetId) {
    var widget = document.getElementById('widget-' + widgetId);
    if (!widget) return false;
    if (widget.classList.contains('hidden-widget')) return false;
    return true;
}

var LINK_GRAPH_W = 220, LINK_GRAPH_H = 240;

async function loadLinkGraph() {
    if (!noteId || noteId === 0) return;
    var svg = document.getElementById('link-graph-svg');
    var emptyMsg = document.getElementById('link-graph-empty');
    if (!svg || !emptyMsg) return;
    if (!_isWidgetVisible('link_graph')) return;

    var title = document.getElementById('note-title');
    var noteTitle = title ? title.value : '';
    var content = getEditorContent();
    var displayTitle = noteTitle || 'Untitled';

    try {
        if (typeof FlaskySearch !== 'undefined' && FlaskySearch.isBuilding()) {
            svg.style.display = 'none';
            emptyMsg.style.display = '';
            emptyMsg.textContent = 'Loading graph...';
            // Retry once index is built
            FlaskySearch.buildIndex().then(function() { loadLinkGraph(); });
            return;
        }
        var backlinks = noteTitle ? await FlaskySearch.computeBacklinks(noteTitle) : [];
        var outbound = await FlaskySearch.computeOutboundLinks(content || '');
        outbound = outbound.filter(function(n) { return _ghostEnabled() || !n._ghost; });

        // Build node map: center + neighbors. A note may appear in both lists.
        var nodes = {};
        nodes[noteId] = { id: noteId, title: displayTitle, type: 'center' };
        backlinks.forEach(function(n) {
            if (!nodes[n.id]) nodes[n.id] = { id: n.id, title: n.title || 'Untitled', type: 'in' };
        });
        outbound.forEach(function(n) {
            var nodeId = n._ghost ? 'ghost:' + (n.title || '').toLowerCase() : n.id;
            if (!nodes[nodeId]) {
                nodes[nodeId] = { id: nodeId, title: n.title || 'Untitled', type: 'out', _ghost: !!n._ghost };
            } else if (nodes[nodeId].type === 'in') {
                nodes[nodeId].type = 'both';
            }
        });

        var edges = [];
        backlinks.forEach(function(n) { edges.push({ from: n.id, to: noteId }); });
        outbound.forEach(function(n) {
            var nodeId = n._ghost ? 'ghost:' + (n.title || '').toLowerCase() : n.id;
            edges.push({ from: noteId, to: nodeId });
        });

        var nodeArr = Object.values(nodes);
        if (edges.length === 0) {
            svg.style.display = 'none';
            emptyMsg.style.display = '';
            emptyMsg.textContent = 'No links';
            return;
        }

        emptyMsg.style.display = 'none';
        svg.style.display = '';

        _layoutAndRenderGraph(svg, nodeArr, edges);
    } catch(e) {
        svg.style.display = 'none';
        emptyMsg.style.display = '';
        emptyMsg.textContent = 'Failed to load graph';
    }
}

function _layoutAndRenderGraph(svg, nodes, edges) {
    var cx = LINK_GRAPH_W / 2, cy = LINK_GRAPH_H / 2;
    // Initialize positions: center node in middle, others on a circle
    var n = nodes.length;
    nodes.forEach(function(node, i) {
        if (node.type === 'center') {
            node.x = cx; node.y = cy;
        } else {
            var angle = (i / (n - 1)) * Math.PI * 2;
            node.x = cx + Math.cos(angle) * 70;
            node.y = cy + Math.sin(angle) * 70;
        }
        node.vx = 0; node.vy = 0;
    });

    // Simple force simulation: repulsion + edge attraction + centering
    var repulsion = 600;
    var edgeLen = 60;
    var attraction = 0.05;
    var centering = 0.01;
    var damping = 0.85;
    for (var tick = 0; tick < 60; tick++) {
        // Repulsion between all pairs
        for (var i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
                var dx = nodes[i].x - nodes[j].x;
                var dy = nodes[i].y - nodes[j].y;
                var dist2 = dx * dx + dy * dy;
                if (dist2 < 1) dist2 = 1;
                var force = repulsion / dist2;
                var dist = Math.sqrt(dist2);
                var fx = (dx / dist) * force;
                var fy = (dy / dist) * force;
                nodes[i].vx += fx; nodes[i].vy += fy;
                nodes[j].vx -= fx; nodes[j].vy -= fy;
            }
        }
        // Edge attraction (Hooke)
        edges.forEach(function(e) {
            var a = null, b = null;
            for (var k = 0; k < n; k++) {
                if (nodes[k].id === e.from) a = nodes[k];
                if (nodes[k].id === e.to) b = nodes[k];
            }
            if (!a || !b) return;
            var dx = b.x - a.x, dy = b.y - a.y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            var force = (dist - edgeLen) * attraction;
            var fx = (dx / dist) * force, fy = (dy / dist) * force;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
        });
        // Centering + integrate
        nodes.forEach(function(node) {
            if (node.type !== 'center') {
                node.vx += (cx - node.x) * centering;
                node.vy += (cy - node.y) * centering;
            }
            node.vx *= damping; node.vy *= damping;
            if (node.type === 'center') { node.x = cx; node.y = cy; return; }
            node.x += node.vx; node.y += node.vy;
            // Keep inside bounds with padding
            var pad = 18;
            node.x = Math.max(pad, Math.min(LINK_GRAPH_W - pad, node.x));
            node.y = Math.max(pad, Math.min(LINK_GRAPH_H - pad, node.y));
        });
    }

    // Render SVG
    var ns = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Arrow marker definition
    var defs = document.createElementNS(ns, 'defs');
    var marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', 'lg-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto');
    var arrowPath = document.createElementNS(ns, 'path');
    arrowPath.setAttribute('d', 'M0,0 L10,5 L0,10 Z');
    arrowPath.setAttribute('class', 'lg-arrowhead');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var nodeById = {};
    nodes.forEach(function(node) { nodeById[node.id] = node; });

    // Edges
    edges.forEach(function(e) {
        var a = nodeById[e.from], b = nodeById[e.to];
        if (!a || !b) return;
        // Shorten line so it ends at circle edge, not center
        var dx = b.x - a.x, dy = b.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var r = 8;
        var x1 = a.x + (dx / dist) * r;
        var y1 = a.y + (dy / dist) * r;
        var x2 = b.x - (dx / dist) * r;
        var y2 = b.y - (dy / dist) * r;
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('class', 'link-graph-edge');
        line.setAttribute('marker-end', 'url(#lg-arrow)');
        svg.appendChild(line);
    });

    // Nodes
    nodes.forEach(function(node) {
        var a = document.createElementNS(ns, 'a');
        a.setAttribute('class', 'link-graph-node link-graph-' + node.type + (node._ghost ? ' link-graph-ghost' : ''));
        if (node._ghost) {
            a.setAttribute('data-action', 'create-ghost-note');
            a.setAttribute('data-ghost-title', node.title || '');
        } else {
            a.setAttribute('href', '/note/' + node.id);
            a.setAttribute('data-action', 'open-note-link');
            a.setAttribute('data-note-id', node.id);
        }

        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', node.x);
        circle.setAttribute('cy', node.y);
        circle.setAttribute('r', node.type === 'center' ? 8 : 6);
        a.appendChild(circle);

        var text = document.createElementNS(ns, 'text');
        text.setAttribute('x', node.x);
        text.setAttribute('y', node.y - (node.type === 'center' ? 12 : 10));
        text.setAttribute('text-anchor', 'middle');
        text.textContent = _truncate(node.title, 18);
        a.appendChild(text);

        // Transparent hit area so the whole node is clickable, not just the stroke
        var hit = document.createElementNS(ns, 'rect');
        hit.setAttribute('x', node.x - 12);
        hit.setAttribute('y', node.y - 12);
        hit.setAttribute('width', 24);
        hit.setAttribute('height', 24);
        hit.setAttribute('fill', 'transparent');
        a.appendChild(hit);

        svg.appendChild(a);
    });
}

function _truncate(s, len) {
    if (!s) return '';
    return s.length > len ? s.slice(0, len - 1) + '\u2026' : s;
}

// ============ Shortcuts Modal ============

function openPalette() {
    if (typeof FlaskySearchModal === 'undefined') return;
    FlaskySearchModal.open({
        editor: cmEditor,
        aiEnabled: !!(typeof _pageData !== 'undefined' && _pageData.aiEnabled),
        drawingEnabled: !!(typeof _pageData !== 'undefined' && _pageData.drawingEnabled),
        audioEnabled: !!(typeof _pageData !== 'undefined' && _pageData.audioRecordingEnabled),
        ghostNotesEnabled: !!(typeof _pageData !== 'undefined' && _pageData.autosuggestGhostNotes),
        ghostCreateEnabled: !!(typeof _pageData !== 'undefined' && _pageData.autosuggestGhostCreate),
        onOpenNote: function (id) { openNote(id); },
        insertCallback: function (title) {
            if (!cmEditor) return;
            var cursor = cmEditor.getCursor();
            var text = '[[' + title + ']]';
            cmEditor.replaceRange(text, cursor);
            cmEditor.setCursor({ line: cursor.line, ch: cursor.ch + text.length });
            cmEditor.focus();
        }
    });
}

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

// ============ Keyboard shortcuts ============

document.addEventListener('keydown', function(e) {
    // Command palette
    if (typeof FlaskySearchModal !== 'undefined' && FlaskySearchModal.isOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); FlaskySearchModal.close(); }
        return;
    }
    // Shortcuts modal
    if (document.getElementById('shortcuts-overlay').classList.contains('visible')) {
        if (e.key === 'Escape') { e.preventDefault(); closeShortcutsModal(); return; }
        return;
    }
    // Drawing takeover
    var drawingEl = document.querySelector('.drawing-takeover.visible');
    if (drawingEl) {
        if (e.key === 'Escape') { e.preventDefault(); if (window.closeDrawingModal) window.closeDrawingModal(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); var ub = drawingEl.querySelector('.drawing-undo-btn'); if (ub) ub.click(); return; }
        return;
    }
    // Audio recording: Esc discards the in-progress recording. We don't bind
    // a "save" hotkey because any unmodified letter (e.g. plain "s") must
    // remain available for typing while a recording runs in the background.
    // Stop+save is triggered by clicking the toolbar mic button or the
    // floating recorder pill.
    if (window.isAudioRecording && window.isAudioRecording() && e.key === 'Escape') {
        e.preventDefault();
        if (window._audioDiscard) window._audioDiscard();
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
    if (ctrl && e.key === 'k') { e.preventDefault(); if (!FlaskySearchModal.isOpen()) openPalette(); }
    if (ctrl && e.key === 'p' && !editMode) {
        e.preventDefault();
        var sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('collapsed')) toggleSidebar();
        var si = document.getElementById('search-input');
        si.focus(); si.select();
    }
    if (ctrl && e.shiftKey && e.key === 'O') { e.preventDefault(); toggleRightPanel(); }
    if (ctrl && e.shiftKey && e.key === 'A') { e.preventDefault(); toggleAIPanel(); }
    if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); toggleSpotlightMode(); }
    if (ctrl && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        if (dailyNoteConfig.enabled) { e.preventDefault(); openDailyNote(); }
    }
    if (ctrl && e.key === '/') { e.preventDefault(); toggleShortcutsModal(); }
    if (ctrl && e.key === 'b' && !editMode) { e.preventDefault(); toggleSidebar(); }
    if (e.key === 'Escape' && aiPanel && !aiPanel.classList.contains('collapsed')) { e.preventDefault(); closeAIPanel(); closeAIDropdown(); }
    // Esc exits spotlight mode when not in edit mode (edit-mode Esc goes to preview first)
    if (e.key === 'Escape' && !editMode && document.documentElement.getAttribute('data-spotlight') === 'true') { e.preventDefault(); toggleSpotlightMode(); }
});

// ============ Links Suggestion Engine (shared by [[ autocomplete + no-[[ autosuggest) ============

var wikiAutocomplete = null;
var wikiNoteList = null;          // cached snapshot of [{ id, title, category, date_last_changed }]
var wikiSelectedIndex = -1;
var wikiFilteredNotes = [];
var _wikiReqId = 0;               // monotonic token to drop stale async results
var wikiEmbedMode = false;        // true while the [[ dropdown is showing attachment results (![[ context)

var _noteMapPromise = null;

function _invalidateWikiNoteList() {
    wikiNoteList = null;
}

function loadWikiNoteList(callback) {
    if (wikiNoteList !== null) { if (callback) callback(); return; }
    if (!_noteMapPromise) {
        _noteMapPromise = _buildLinksNoteList();
    }
    _noteMapPromise.then(function() { _noteMapPromise = null; if (callback) callback(); });
}

function _buildLinksNoteList() {
    return new Promise(function(resolve) {
        function fromSearchIndex() {
            var idx = (typeof FlaskySearch !== 'undefined') ? FlaskySearch.getIndex() : null;
            if (idx && idx.length > 0) {
                wikiNoteList = idx.map(function(n) {
                    return { id: n.id, title: n.title || '', category: n.category || '', date_last_changed: n.date_last_changed || null };
                });
            } else {
                wikiNoteList = [];
            }
            wikiNoteList.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
            resolve();
        }
        function fromNoteMap() {
            var map = window._getNoteMap ? window._getNoteMap() : null;
            if (map) {
                wikiNoteList = [];
                for (var key in map) {
                    if (map[key]) wikiNoteList.push({ id: map[key].id, title: map[key].title, category: '', date_last_changed: null });
                }
                wikiNoteList.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
            } else {
                wikiNoteList = [];
            }
            resolve();
        }
        // Prefer the search index (richer: has category + recency). If it
        // isn't built yet, build it, then fall back to the note map if still
        // empty. The note map path also covers the rare case where
        // FlaskySearch is unavailable.
        if (typeof FlaskySearch !== 'undefined') {
            if (FlaskySearch.isBuilding()) {
                _buildSearchThenMap();
            } else if (FlaskySearch.getIndex() && FlaskySearch.getIndex().length > 0) {
                fromSearchIndex();
            } else {
                _buildSearchThenMap();
            }
        } else {
            fromNoteMap();
        }
        function _buildSearchThenMap() {
            FlaskySearch.buildIndex().then(function() {
                if (FlaskySearch.getIndex() && FlaskySearch.getIndex().length > 0) {
                    fromSearchIndex();
                } else {
                    fromNoteMap();
                }
            }).catch(function() { fromNoteMap(); });
        }
    });
}

// Recency bonus in days. Returns 50 for <7d, 20 for <30d, else 0.
function _recencyBonus(dateLastChanged) {
    if (!dateLastChanged) return 0;
    var then = new Date(dateLastChanged);
    if (isNaN(then.getTime())) return 0;
    var days = (Date.now() - then.getTime()) / 86400000;
    if (days < 7) return 50;
    if (days < 30) return 20;
    return 0;
}

function _isExactTitleMatch(query) {
    var q = (query || '').toLowerCase();
    if (!q) return false;
    var list = wikiNoteList || [];
    for (var i = 0; i < list.length; i++) {
        if ((list[i].title || '').toLowerCase() === q) return true;
    }
    return false;
}

function _ghostEnabled() { return !!_pageData.autosuggestGhostNotes; }
function _ghostCreateEnabled() { return !!_pageData.autosuggestGhostCreate; }

var _unresolvedGhostsCache = null;
var _unresolvedGhostsCacheKey = null;

function _getUnresolvedGhosts() {
    if (typeof FlaskySearch === 'undefined' || !FlaskySearch.getUnresolvedLinks) return [];
    var v = FlaskySearch.getVersion ? FlaskySearch.getVersion() : 0;
    if (_unresolvedGhostsCacheKey === v && _unresolvedGhostsCache) {
        return _unresolvedGhostsCache;
    }
    _unresolvedGhostsCache = FlaskySearch.getUnresolvedLinks();
    _unresolvedGhostsCacheKey = v;
    return _unresolvedGhostsCache;
}

function _filterUnresolvedGhosts(query) {
    if (!_ghostEnabled()) return [];
    var q = (query || '').toLowerCase();
    if (!q) return [];
    var ghosts = _getUnresolvedGhosts();
    var matched = [];
    for (var i = 0; i < ghosts.length; i++) {
        var t = (ghosts[i].title || '').toLowerCase();
        if (t.indexOf(q) !== -1) {
            matched.push({ id: 0, title: ghosts[i].title, category: '', date_last_changed: null, _score: 50, _ghost: true });
        }
    }
    matched.sort(function (a, b) {
        var at = (a.title || '').toLowerCase().indexOf(q);
        var bt = (b.title || '').toLowerCase().indexOf(q);
        if (at !== bt) return at - bt;
        return (a.title || '').localeCompare(b.title || '');
    });
    return matched;
}

function _makeGhostNote(query) {
    return { id: 0, title: query, category: '', date_last_changed: null, _score: 0, _ghost: true };
}

function _mergeGhosts(results, query, rawQuery) {
    var cap = _linksResultCap();
    if (_ghostEnabled() && results.length < cap) {
        var ghosts = _filterUnresolvedGhosts(query);
        for (var gi = 0; gi < ghosts.length && results.length < cap; gi++) {
            if (!_isExactTitleMatch(ghosts[gi].title.toLowerCase())) {
                results.push(ghosts[gi]);
            }
        }
    }
    if (results.length === 0 && _ghostCreateEnabled() && query && !_isExactTitleMatch(query)) {
        results = [_makeGhostNote(rawQuery)];
    }
    return results;
}

// Unified filter+rank. query is lowercased. algo is one of
// title_prefix | title_substring | full_search. Returns a Promise<Array>.
function filterAndRankLinks(query, cap, algo) {
    return new Promise(function(resolve) {
        var q = (query || '').toLowerCase();
        if (!q) { resolve([]); return; }
        loadWikiNoteList(function() {
            var list = wikiNoteList || [];
            var results;
            if (algo === 'full_search' && typeof FlaskySearch !== 'undefined' && FlaskySearch.search) {
                // Reuse the full search engine — title + content scoring.
                FlaskySearch.search(q).then(function(hits) {
                    results = (hits || []).map(function(h) {
                        return { id: h.id, title: h.title, category: h.category || '', date_last_changed: h.date_last_changed || null, _score: h.score || 0 };
                    });
                    results.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
                    resolve(results.slice(0, cap));
                });
                return;
            }
            if (algo === 'title_substring') {
                results = [];
                for (var i = 0; i < list.length; i++) {
                    var n = list[i];
                    var t = (n.title || '').toLowerCase();
                    var idx = t.indexOf(q);
                    if (idx === -1) continue;
                    var score = 200 - idx;   // earlier match = higher
                    score += _recencyBonus(n.date_last_changed);
                    results.push({ id: n.id, title: n.title, category: n.category || '', date_last_changed: n.date_last_changed, _score: score });
                }
            } else {
                // title_prefix (default)
                results = [];
                for (var j = 0; j < list.length; j++) {
                    var m = list[j];
                    var tt = (m.title || '').toLowerCase();
                    var score = 0;
                    if (tt.indexOf(q) === 0) score += 1000;
                    else {
                        var words = tt.split(/[\s\-_,.;:!?()/]+/);
                        for (var w = 0; w < words.length; w++) {
                            if (words[w].indexOf(q) === 0) { score += 400; break; }
                        }
                    }
                    if (score === 0) continue;
                    score += _recencyBonus(m.date_last_changed);
                    results.push({ id: m.id, title: m.title, category: m.category || '', date_last_changed: m.date_last_changed, _score: score });
                }
            }
            results.sort(function(a, b) {
                if (b._score !== a._score) return b._score - a._score;
                return (a.title || '').localeCompare(b.title || '');
            });
            resolve(results.slice(0, cap));
        });
    });
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Shared renderer. `container` is the dropdown element. `items` is the
// filtered list. `showCategory` toggles the folder badge. `selectedIndex`
// highlights the active row.
function renderLinksDropdown(container, items, showCategory, selectedIndex) {
    if (!container) return;
    var html = '';
    items.forEach(function(n, i) {
        if (n._ghost) {
            html += '<div class="wikilink-autocomplete-item ghost' + (i === selectedIndex ? ' selected' : '') + '" data-index="' + i + '">' +
                '<span class="link-suggest-title ghost-title">' + _escHtml(n.title || '') + '</span>' +
                '<span class="link-suggest-cat ghost-badge">New note</span></div>';
            return;
        }
        var esc = _escHtml(n.title || '');
        var cat = '';
        if (showCategory && n.category) {
            cat = '<span class="link-suggest-cat">' + _escHtml(n.category) + '</span>';
        }
        html += '<div class="wikilink-autocomplete-item' + (i === selectedIndex ? ' selected' : '') + '" data-index="' + i + '">' +
            '<span class="link-suggest-title">' + esc + '</span>' + cat + '</div>';
    });
    container.innerHTML = html;
    var sel = container.querySelector('.wikilink-autocomplete-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function _linksResultCap() {
    var c = parseInt(_pageData.autosuggestResultCap, 10);
    return (isNaN(c) || c < 1) ? 5 : c;
}
function _linksShowCategory() { return !!_pageData.autosuggestShowCategory; }
function _linksAlgo() {
    var a = _pageData.autosuggestAlgorithm;
    return (a === 'title_substring' || a === 'full_search') ? a : 'title_prefix';
}

// Clamp a dropdown's left coordinate so its right edge never extends past
// the editor's content box (and is also bounded by the viewport). Anchoring
// to #cm-wrapper keeps the popup visually aligned with the text column
// rather than letting it drift out over the right-panel gutter.
function _clampPopupLeft(cursorLeft, popupWidth) {
    var maxRight = window.innerWidth - 4;
    var editorEl = document.getElementById('cm-wrapper');
    if (editorEl) {
        var r = editorEl.getBoundingClientRect();
        if (r.right > 0 && r.right < maxRight) maxRight = r.right;
    }
    var left = cursorLeft;
    if (left + popupWidth > maxRight) {
        left = maxRight - popupWidth;
    }
    if (left < 4) left = 4;
    return left;
}

// ============ [[ Wikilink Autocomplete ============

function showWikiAutocomplete(cm) {
    var cursor = cm.getCursor();
    var line = cm.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);

    var openIdx = before.lastIndexOf('[[');
    if (openIdx === -1) { hideWikiAutocomplete(); return; }
    var afterOpen = before.substring(openIdx + 2);
    if (afterOpen.indexOf(']]') > -1) { hideWikiAutocomplete(); return; }

    var rawQuery = afterOpen;
    var pipeIdx = rawQuery.indexOf('|');
    if (pipeIdx > -1) rawQuery = rawQuery.substring(0, pipeIdx);
    rawQuery = rawQuery.trim();
    var query = rawQuery.toLowerCase();
    // Token to guard against stale async results rendering for an old query.
    var myReq = ++_wikiReqId;

    if (before.charAt(openIdx - 1) === '!') {
        _showAttachmentSuggestions(cm, query);
        return;
    }

    filterAndRankLinks(query, _linksResultCap(), _linksAlgo()).then(function(results) {
        if (myReq !== _wikiReqId) return;  // a newer keystroke superseded us
        wikiFilteredNotes = _mergeGhosts(results, query, rawQuery);
        if (wikiFilteredNotes.length === 0) { hideWikiAutocomplete(); return; }

        // The [[ dropdown takes priority over the no-[[ autosuggest.
        hideAutosuggest();
        wikiSelectedIndex = 0;

        _ensureWikiDropdown();
        renderLinksDropdown(wikiAutocomplete, wikiFilteredNotes, _linksShowCategory(), wikiSelectedIndex);

        var coords = cm.cursorCoords(true, 'page');
        var popupLeft = _clampPopupLeft(coords.left, wikiAutocomplete.offsetWidth || 200);
        wikiAutocomplete.style.left = popupLeft + 'px';
        wikiAutocomplete.style.top = (coords.bottom + 4) + 'px';
        wikiAutocomplete.style.display = 'block';
    });
}

// Map a FlaskyAttachments.classify() result to a short badge label for the
// attachment suggestion dropdown.
function _attTypeLabel(cls) {
    if (cls === 'image') return 'Image';
    if (cls === 'video') return 'Video';
    if (cls === 'audio') return 'Audio';
    if (cls === 'drawing') return 'Drawing';
    if (cls === 'document') return 'Document';
    if (cls === 'archive') return 'Archive';
    return 'File';
}

// Sync attachment index lookup. Mirrors the passive pattern used by the note
// autocomplete (which reads window._getNoteMap()): never forces a fetch. The
// /api/note-map fetch is owned by wikilinks.js, which hydrates both
// FlaskyAttachments (via hydrate()) and the map returned by
// window._getAttachmentMap() once it resolves. Until then, returns null and
// the dropdown stays hidden — the same cold-start behavior as [[ note
// suggestions.
function _attachmentIndexSync() {
    if (window.FlaskyAttachments && typeof window.FlaskyAttachments.getAttachmentIndex === 'function') {
        var idx = window.FlaskyAttachments.getAttachmentIndex();
        if (idx) return idx;
    }
    var map = window._getAttachmentMap ? window._getAttachmentMap() : null;
    if (map && map.attachments) {
        var out = [];
        for (var k in map.attachments) {
            if (map.attachments[k]) out.push({ id: map.attachments[k].id, name: map.attachments[k].filename });
        }
        return out;
    }
    return null;
}

// Lazily build the shared wikilink autocomplete dropdown (used by both the
// [[ note path and the ![[ attachment path). Wired once to acceptWikiAutocomplete.
function _ensureWikiDropdown() {
    if (wikiAutocomplete) return;
    wikiAutocomplete = document.createElement('div');
    wikiAutocomplete.className = 'wikilink-autocomplete';
    document.body.appendChild(wikiAutocomplete);
    wikiAutocomplete.addEventListener('mousedown', function(e) {
        var item = e.target.closest('.wikilink-autocomplete-item');
        if (item) { e.preventDefault(); acceptWikiAutocomplete(parseInt(item.getAttribute('data-index'))); }
    });
    wikiAutocomplete.addEventListener('mouseover', function(e) {
        var item = e.target.closest('.wikilink-autocomplete-item');
        if (item) {
            var newIdx = parseInt(item.getAttribute('data-index'));
            if (newIdx !== wikiSelectedIndex) {
                var prev = wikiAutocomplete.querySelector('.wikilink-autocomplete-item.selected');
                if (prev) prev.classList.remove('selected');
                wikiSelectedIndex = newIdx;
                item.classList.add('selected');
            }
        }
    });
}

// Render attachment suggestions for the ![[ context. Reuses the shared
// wikiAutocomplete dropdown (already wired to acceptWikiAutocomplete) and the
// shared renderLinksDropdown by mapping attachment results to the same
// {id, title, category, _score} shape used for notes.
function _showAttachmentSuggestions(cm, query) {
    var idx = _attachmentIndexSync();
    if (idx === null) { hideWikiAutocomplete(); return; }

    var algo = _linksAlgo();
    var results = [];
    for (var i = 0; i < idx.length; i++) {
        var a = idx[i];
        var name = a.name || '';
        var lname = name.toLowerCase();
        var score = 0;
        if (algo === 'title_substring' || algo === 'full_search') {
            // Attachments have no searchable content (server is ciphertext-only),
            // so full_search degrades to filename substring matching here.
            var pos = lname.indexOf(query);
            if (pos === -1) continue;
            score = 200 - pos;
        } else {  // title_prefix (default)
            if (lname.indexOf(query) === 0) score = 1000;
            else {
                var words = lname.split(/[\s\-_,.;:!?()/]+/);
                for (var w = 0; w < words.length; w++) {
                    if (words[w].indexOf(query) === 0) { score = 400; break; }
                }
            }
            if (score === 0) continue;
        }
        var typeLabel = window.FlaskyAttachments ? _attTypeLabel(window.FlaskyAttachments.classify(name)) : 'File';
        results.push({ id: a.id, title: name, category: typeLabel, _score: score });
    }
    results.sort(function (x, y) {
        if (y._score !== x._score) return y._score - x._score;
        return (x.title || '').localeCompare(y.title || '');
    });
    results = results.slice(0, _linksResultCap());

    if (results.length === 0) { hideWikiAutocomplete(); return; }

    // The [[ dropdown takes priority over the no-[[ autosuggest.
    hideAutosuggest();
    wikiEmbedMode = true;
    wikiFilteredNotes = results;
    wikiSelectedIndex = 0;

    _ensureWikiDropdown();
    renderLinksDropdown(wikiAutocomplete, wikiFilteredNotes, _linksShowCategory(), wikiSelectedIndex);

    var coords = cm.cursorCoords(true, 'page');
    var popupLeft = _clampPopupLeft(coords.left, wikiAutocomplete.offsetWidth || 200);
    wikiAutocomplete.style.left = popupLeft + 'px';
    wikiAutocomplete.style.top = (coords.bottom + 4) + 'px';
    wikiAutocomplete.style.display = 'block';
}

function hideWikiAutocomplete() {
    if (wikiAutocomplete) wikiAutocomplete.style.display = 'none';
    wikiFilteredNotes = [];
    wikiSelectedIndex = -1;
    wikiEmbedMode = false;
    _wikiReqId++;  // invalidate any in-flight ranking
}

function acceptWikiAutocomplete(index) {
    if (!cmEditor || index < 0 || index >= wikiFilteredNotes.length) return;
    var selected = wikiFilteredNotes[index];
    var cursor = cmEditor.getCursor();
    var line = cmEditor.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);
    var openIdx = wikiEmbedMode ? before.lastIndexOf('![[') : before.lastIndexOf('[[');
    if (openIdx === -1) return;

    var after = line.substring(cursor.ch);
    var extraClose = 0;
    if (after.indexOf(']]') === 0) extraClose = 2;
    else if (after.indexOf(']') === 0) extraClose = 1;

    var from = { line: cursor.line, ch: openIdx };
    var to = { line: cursor.line, ch: cursor.ch + extraClose };
    var insertText = wikiEmbedMode ? ('![[' + selected.title + ']]') : ('[[' + selected.title + ']]');
    cmEditor.replaceRange(insertText, from, to);
    cmEditor.setCursor({ line: cursor.line, ch: openIdx + insertText.length });
    hideWikiAutocomplete();
    cmEditor.focus();
    _refreshOutboundLinks();
}

function isWikiAutocompleteVisible() {
    return wikiAutocomplete && wikiAutocomplete.style.display === 'block';
}

// ============ No-[[ Autosuggest ============

var autosuggestDropdown = null;
var autosuggSelectedIndex = -1;
var autosuggFilteredNotes = [];
var autosuggContext = null;        // { from, to, query } for the current word
var _autosuggDismissedWord = null;
var _autosuggReqId = 0;            // monotonic token to drop stale async results

function _isInsideWikilinkContext(before) {
    var openIdx = before.lastIndexOf('[[');
    if (openIdx === -1) return false;
    return before.substring(openIdx + 2).indexOf(']]') === -1;
}

function computeAutosuggestQuery(cm) {
    if (!_pageData.autosuggestNoteLinks) return null;
    var cursor = cm.getCursor();
    var line = cm.getLine(cursor.line);
    var before = line.substring(0, cursor.ch);
    if (_isInsideWikilinkContext(before)) return null;

    // Walk back from cursor to the last word boundary. A boundary is the
    // start of the line, or any non-word character (\W == whitespace or
    // punctuation). The query starts immediately after the boundary.
    var i = cursor.ch;
    while (i > 0) {
        var prev = line.charAt(i - 1);
        if (/\W/.test(prev)) break;
        i--;
    }
    var query = line.slice(i, cursor.ch);
    if (query.length < _pageData.autosuggestMinChars) return null;
    if (_autosuggDismissedWord && _autosuggDismissedWord === query) return null;
    return { from: { line: cursor.line, ch: i }, to: { line: cursor.line, ch: cursor.ch }, query: query };
}

function showAutosuggest(cm) {
    if (isWikiAutocompleteVisible() || isSlashCommandVisible()) return;
    var ctx = computeAutosuggestQuery(cm);
    if (!ctx) { hideAutosuggest(); return; }

    var myReq = ++_autosuggReqId;
    filterAndRankLinks(ctx.query.toLowerCase(), _linksResultCap(), _linksAlgo()).then(function(results) {
        // Drop stale results: a newer keystroke or hideAutosuggest() bumped
        // the token while we were ranking.
        if (myReq !== _autosuggReqId) return;
        autosuggContext = ctx;
        autosuggFilteredNotes = _mergeGhosts(results, ctx.query.toLowerCase(), ctx.query);
        if (autosuggFilteredNotes.length === 0) { hideAutosuggest(); return; }

        autosuggSelectedIndex = 0;

        if (!autosuggestDropdown) {
            autosuggestDropdown = document.createElement('div');
            autosuggestDropdown.className = 'wikilink-autocomplete autosuggest-links';
            document.body.appendChild(autosuggestDropdown);
            autosuggestDropdown.addEventListener('mousedown', function(e) {
                var item = e.target.closest('.wikilink-autocomplete-item');
                if (item) { e.preventDefault(); acceptAutosuggest(parseInt(item.getAttribute('data-index'))); }
            });
            autosuggestDropdown.addEventListener('mouseover', function(e) {
                var item = e.target.closest('.wikilink-autocomplete-item');
                if (item) {
                    var newIdx = parseInt(item.getAttribute('data-index'));
                    if (newIdx !== autosuggSelectedIndex) {
                        var prev = autosuggestDropdown.querySelector('.wikilink-autocomplete-item.selected');
                        if (prev) prev.classList.remove('selected');
                        autosuggSelectedIndex = newIdx;
                        item.classList.add('selected');
                    }
                }
            });
        }

        renderLinksDropdown(autosuggestDropdown, autosuggFilteredNotes, _linksShowCategory(), autosuggSelectedIndex);

        var coords = cm.cursorCoords(true, 'page');
        var popupLeft = _clampPopupLeft(coords.left, autosuggestDropdown.offsetWidth || 200);
        autosuggestDropdown.style.left = popupLeft + 'px';
        autosuggestDropdown.style.top = (coords.bottom + 4) + 'px';
        autosuggestDropdown.style.display = 'block';
    });
}

function hideAutosuggest() {
    if (autosuggestDropdown) autosuggestDropdown.style.display = 'none';
    autosuggFilteredNotes = [];
    autosuggSelectedIndex = -1;
    autosuggContext = null;
    _autosuggReqId++;  // invalidate any in-flight ranking
}

function acceptAutosuggest(index) {
    if (!cmEditor || index < 0 || index >= autosuggFilteredNotes.length) return;
    var selected = autosuggFilteredNotes[index];
    if (!autosuggContext) return;
    var insertText = '[[' + selected.title + ']]';

    // The autosuggest query only captures the last word (stops at whitespace),
    // but note titles can contain spaces. Extend the replacement range
    // backwards to cover the longest suffix of the pre-cursor text that
    // appears anywhere in the selected title, so "one two" → [[one two three]]
    // and "two three" → [[one two three]] both replace the full typed text.
    // Only extend to word boundaries so we don't eat a space that separates
    // the typed text from an unrelated preceding word.
    var to = autosuggContext.to;
    var line = cmEditor.getLine(to.line);
    var beforeLower = line.slice(0, to.ch).toLowerCase();
    var titleLower = selected.title.toLowerCase();
    var queryLen = autosuggContext.query.length;
    var matchLen = queryLen;
    for (var len = Math.min(beforeLower.length, titleLower.length); len > queryLen; len--) {
        var suffix = beforeLower.slice(beforeLower.length - len);
        if (/\s/.test(suffix.charAt(0))) continue;
        var charBefore = beforeLower.length - len - 1;
        if (charBefore >= 0 && !/\W/.test(beforeLower.charAt(charBefore))) continue;
        if (titleLower.indexOf(suffix) !== -1) {
            matchLen = len;
            break;
        }
    }
    var fromCh = to.ch - matchLen;

    cmEditor.replaceRange(insertText, { line: to.line, ch: fromCh }, to);
    cmEditor.setCursor({ line: to.line, ch: fromCh + insertText.length });
    _autosuggDismissedWord = null;
    hideAutosuggest();
    cmEditor.focus();
    _refreshOutboundLinks();
}

function isAutosuggestVisible() {
    return autosuggestDropdown && autosuggestDropdown.style.display === 'block';
}

function _refreshOutboundLinks() {
    var panel = document.getElementById('right-panel');
    if (panel && !panel.classList.contains('collapsed')) {
        clearTimeout(outboundLinksTimer);
        updateOutboundLinksFromContent();
        clearTimeout(linkGraphTimer);
        loadLinkGraph();
    }
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

// Exposed for reuse by the CM6 live-preview callout widget so the icon set
// stays in one place.
window._getCalloutIcon = getCalloutIcon;

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
//
// Inline editor popup. Shares the command registry with the command palette
// (commands.js) so the two stay in sync. The slash popup shows only
// editor-context commands; the palette's `>` mode adds global commands too.

var slashPopup = null;
var slashSelectedIndex = -1;
var slashFilteredCommands = [];
var slashTriggerLine = -1;
var slashTriggerCh = -1;

function _slashAllCommands() {
    if (typeof FlaskyCommands === 'undefined') return [];
    var aiEnabled = !!(typeof _pageData !== 'undefined' && _pageData.aiEnabled);
    var drawingEnabled = !!(typeof _pageData !== 'undefined' && _pageData.drawingEnabled);
    var audioEnabled = !!(typeof _pageData !== 'undefined' && _pageData.audioRecordingEnabled);
    var all = FlaskyCommands.getCommands('editor', { aiEnabled: aiEnabled, drawingEnabled: drawingEnabled, audioEnabled: audioEnabled });
    return all.filter(function (cmd) { return cmd.editorOnly; });
}

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

    var all = _slashAllCommands();
    slashFilteredCommands = all.filter(function (cmd) {
        return cmd.label.toLowerCase().indexOf(query) > -1;
    });

    if (slashFilteredCommands.length === 0) { hideSlashCommands(); return; }
    slashSelectedIndex = 0;

    if (!slashPopup) {
        slashPopup = document.createElement('div');
        slashPopup.className = 'slash-command-popup';
        document.body.appendChild(slashPopup);
        slashPopup.addEventListener('mousedown', function(e) {
            var item = e.target.closest('.slash-command-item');
            if (item) { e.preventDefault(); acceptSlashCommand(parseInt(item.getAttribute('data-index'))); }
        });
        slashPopup.addEventListener('touchend', function(e) {
            var item = e.target.closest('.slash-command-item');
            if (item) { e.preventDefault(); acceptSlashCommand(parseInt(item.getAttribute('data-index'))); }
        });
        slashPopup.addEventListener('mouseover', function(e) {
            var item = e.target.closest('.slash-command-item');
            if (item) {
                var newIdx = parseInt(item.getAttribute('data-index'));
                if (newIdx !== slashSelectedIndex) {
                    var prev = slashPopup.querySelector('.slash-command-item.selected');
                    if (prev) prev.classList.remove('selected');
                    slashSelectedIndex = newIdx;
                    item.classList.add('selected');
                }
            }
        });
    }

    renderSlashCommands();
    var coords = cm.cursorCoords(true, 'page');
    var popupLeft = _clampPopupLeft(coords.left, slashPopup.offsetWidth || 220);
    slashPopup.style.left = popupLeft + 'px';
    slashPopup.style.top = (coords.bottom + 4) + 'px';
    slashPopup.style.display = 'block';
}

function renderSlashCommands() {
    if (!slashPopup) return;
    var html = '';
    slashFilteredCommands.forEach(function(cmd, i) {
        var isAi = cmd.label.indexOf('AI:') === 0;
        html += '<div class="slash-command-item' + (i === slashSelectedIndex ? ' selected' : '') + (isAi ? ' ai-command' : '') + '" data-index="' + i + '">';
        html += '<span class="slash-command-icon">' + cmd.icon + '</span>';
        html += '<span>' + cmd.label + '</span>';
        html += '</div>';
    });
    slashPopup.innerHTML = html;
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

    // Erase the `/query` trigger text, then run the command via the registry.
    cmEditor.replaceRange('', { line: cursor.line, ch: slashStart }, cursor);
    if (typeof cmd.run === 'function') {
        cmd.run({ editor: cmEditor, page: 'editor' });
    }
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

function applyTemplate(templateId, onApplied) {
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
            if (cmEditor) {
                var content = t.content || '';
                cmEditor.replaceRange(content, cmEditor.getCursor());
                cmEditor.focus();
            }
        } else if (templatePickerMode === 'new_in_folder' && templatePickerFolderId) {
            if (isMobile) closeSidebar();
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
            populateFromTemplate(t);
        }
        closeTemplatePicker();
        if (typeof onApplied === 'function') onApplied();
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
            // Refresh inline embeds once the attachment map is ready, so
            // ![[image]] widgets resolve after the first note load. Also
            // listen for noteMapUpdated (fires on subsequent note loads).
            if (cmEditor && cmEditor.refreshEmbeds) {
                var refreshFn = function() {
                    if (cmEditor && cmEditor.refreshEmbeds) cmEditor.refreshEmbeds();
                };
                if (window._wikiLinksReady) {
                    refreshFn();
                } else {
                    document.addEventListener('wikiLinksReady', refreshFn, { once: true });
                }
                document.addEventListener('noteMapUpdated', refreshFn);
            }
        } else {
            if (window._wikiLinksReady) {
                renderPreview();
            } else {
                document.addEventListener('wikiLinksReady', function() { renderPreview(); }, { once: true });
            }
        }

        if (noteId === 0 && defaultTemplateContent !== null) {
            setTimeout(async function() {
                var tContent = defaultTemplateContent;
                var tProps = defaultTemplateProps || {};
                try { tContent = await FlaskyE2EE.decryptField(tContent); } catch(e) {}
                if (tProps && typeof tProps === 'string') {
                    try { tProps = JSON.parse(await FlaskyE2EE.decryptField(tProps)); } catch(e) { tProps = {}; }
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
    initWidgetHeaderDrag();
    applyTopbarLayout();
    syncQuickSettingsState();

    async function _postE2EEInit(ok) {
        if (!ok) return;
        var dataEl = document.getElementById('encrypted-note-data');
        if (dataEl) {
            try {
                var enc = JSON.parse(dataEl.textContent);
                var decTitle = '', decContent = '', decProps = null;
                await Promise.all([
                    (async function() { try { decTitle = await FlaskyE2EE.decryptField(enc.title); } catch(e) {} })(),
                    (async function() { try { decContent = await FlaskyE2EE.decryptField(enc.content); } catch(e) {} })(),
                    (async function() {
                        if (enc.properties) {
                            try {
                                var p = await FlaskyE2EE.decryptField(enc.properties);
                                decProps = JSON.parse(p);
                            } catch(e) { decProps = {}; }
                        }
                    })()
                ]);
                var title = decTitle || '';
                var content = decContent || '';
                var props = decProps;
                var titleEl = document.getElementById('note-title');
                if (titleEl) titleEl.value = title;
                _loadedNoteTitle = title;
                if (cmEditor) { cmEditor.setValue(content); cmEditor.refresh(); }
                else {
                    var ta = document.getElementById('note-content');
                    if (ta) ta.value = content;
                }
                var bc = document.getElementById('breadcrumb-note-title');
                if (bc) bc.textContent = title || 'Untitled';
                document.title = (title || 'Untitled') + ' \u2014 Flasky Notes';
                if (props) _applyPropsToEditor(props);
                if (!editMode && typeof renderPreview === 'function') renderPreview();
            } catch(e) {
                console.error('E2EE page decrypt failed:', e);
            }
        }
        var folderLabel = document.getElementById('folder-picker-label');
        var folderCipher = folderLabel ? folderLabel.textContent.trim() : '';
        await Promise.all([
            (async function() { try { if (currentCategory) currentCategory = await FlaskyE2EE.decryptField(currentCategory); } catch(e) {} })(),
            (async function() {
                if (folderLabel) {
                    try { folderLabel.textContent = await FlaskyE2EE.decryptField(folderCipher); } catch(e) {}
                }
            })()
        ]);

        FlaskyE2EE.revealContent();

        _warmNoteStore().then(function() {
            refreshSidebar();
            if (window._flushPendingNoteMap) window._flushPendingNoteMap();
            if (window.FlaskyAttachments && typeof window.FlaskyAttachments.flushPending === 'function') {
                window.FlaskyAttachments.flushPending();
            }
            if (typeof FlaskySearch !== 'undefined') {
                FlaskySearch.buildIndex();
            }
        });

        // Daily notes: if the daily flag is set and the feature is enabled,
        // open (or create) today's daily note. The server sets daily=1 when
        // visiting /daily or /notes with open-on-start enabled.
        if (dailyNoteConfig.enabled && _pageData.daily && noteId === 0) {
            openDailyNote();
        }

        var rpLoad = document.getElementById('right-panel');
        if (rpLoad && !rpLoad.classList.contains('collapsed')) {
            refreshAllVisibleWidgets();
        }
        // The calendar widget may live in the left sidebar, so render it
        // independently of the right-panel open/closed state.
        refreshCalendarWidget();
    }

    FlaskyE2EE.init().then(_postE2EEInit);

    window.afterUnlockReinit = function() {
        wikiNoteList = null;
        _noteMapPromise = null;
        _noteStore.clear();
        _noteStoreReady = null;
        FlaskyE2EE.init().then(_postE2EEInit);
    };

    document.addEventListener('noteMapUpdated', function() {
        wikiNoteList = null;
        _noteMapPromise = null;
        // Refresh the sidebar so the virtual Attachments folder picks up
        // newly uploaded attachments without a full page reload.
        if (typeof _pageData !== 'undefined' && _pageData.attachmentsFolderEnabled) {
            refreshSidebar();
        }
    });

    // When the router reattaches the editor (closing an overlay view),
    // rebuild the sidebar if a refresh was deferred while detached, or if
    // we're returning to a new-note state that needs a current sidebar.
    document.addEventListener('flasky:editorReattached', function() {
        if (_sidebarPending || noteId === 0) refreshSidebar();
    });

    window.addEventListener('storage', function(e) {
        if (e.key === 'flasky-notes-rev') {
            if (typeof FlaskySearch !== 'undefined') FlaskySearch.invalidate();
            if (window._invalidateNoteMap) window._invalidateNoteMap();
            _invalidateWikiNoteList();
            _noteMapPromise = null;
        }
    });

    if (window.FlaskyTTS) { try { window.FlaskyTTS.init(); } catch (e) {} }
    window.addEventListener('pagehide', function() {
        if (window.FlaskyTTS && FlaskyTTS.isSpeaking()) FlaskyTTS.stop();
    });
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
    if (document.body.classList.contains('app-view-open')) return;
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;

    // Actions that need stopPropagation (sidebar buttons inside other clickable elements)
    var stopPropActions = {
        'new-note-in-folder':1,'move-folder':1,'new-subfolder':1,'delete-folder':1,
        'delete-sidebar-note':1,'toggle-pin':1,'open-add-todo':1,'open-add-event':1,
        'complete-todo-widget':1,'cal-prev-month':1,'cal-next-month':1,'cal-open-day':1
    };
    if (stopPropActions[action]) e.stopPropagation();

    switch (action) {
        case 'close-sidebar': closeSidebar(); break;
        case 'close-ai-panel': closeAIPanel(); break;
        case 'toggle-ai-note-context': toggleAINoteContext(); break;
        case 'ai-new-chat': aiNewChat(); break;
        case 'new-folder': promptNewFolder(); break;
        case 'create-new-note': createNewNote(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
        case 'toggle-mode': toggleMode(); break;
        case 'exit-spotlight': toggleSpotlightMode(); break;
        case 'open-search': openPalette(); break;
        case 'open-daily-note': openDailyNote(); break;
        case 'speak-note': speakCurrentNote(); break;
        case 'open-drawing': openDrawingForNew(); break;
        case 'toggle-audio-record':
            if (window.toggleAudioRecord) window.toggleAudioRecord();
            break;
        case 'cal-prev-month': sidebarCalendarPrev(); break;
        case 'cal-next-month': sidebarCalendarNext(); break;
        case 'cal-open-day': sidebarCalendarOpenDay(parseInt(el.dataset.calDay, 10)); break;
        case 'ask-ai':
            if (aiPanel && !aiPanel.classList.contains('collapsed')) {
                closeAIPanel();
            } else {
                toggleAIDropdown();
            }
            break;
        case 'ai-open-chat': aiNewChat(); openAIPanelWithPrompt(null, null); closeAIDropdown(); break;
        case 'ai-ask-note': openAIPanelWithPrompt(null, null, true); closeAIDropdown(); break;
        case 'ai-summarize': openAIPanelWithPrompt('Summarize this note', 'Summarize this note', true); closeAIDropdown(); break;
        case 'ai-rewrite': openAIPanelWithPrompt('Rewrite this note', 'Rewrite this note more clearly and concisely', true); closeAIDropdown(); break;
        case 'ai-expand': openAIPanelWithPrompt('Expand this note', 'Expand on this note with more detail', true); closeAIDropdown(); break;
        case 'ai-fix-grammar': openAIPanelWithPrompt('Fix grammar', 'Fix the grammar and spelling in this note', true); closeAIDropdown(); break;
        case 'ai-explain': openAIPanelWithPrompt('Explain', 'Explain this in simple terms', true); closeAIDropdown(); break;
        case 'ai-bullets': openAIPanelWithPrompt('Convert to bullets', 'Convert this into bullet points', true); closeAIDropdown(); break;
        case 'toggle-right-panel': toggleRightPanel(); break;
        case 'toggle-dark-mode': toggleDarkMode(); break;
        case 'toggle-shortcuts': toggleShortcutsModal(); break;
        case 'delete-current-note': deleteCurrentNote(); break;
        case 'export-current-note': toggleExportDropdown(); break;
        case 'export-note-md': closeExportDropdown(); exportCurrentNote('md'); break;
        case 'export-note-txt': closeExportDropdown(); exportCurrentNote('txt'); break;
        case 'export-note-pdf': closeExportDropdown(); exportCurrentNote('pdf'); break;
        case 'export-note-web': closeExportDropdown(); exportCurrentNote('web'); break;
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
        case 'open-folder-picker':
            e.stopPropagation();
            openFolderPicker();
            break;
        case 'new-folder-from-picker':
            e.stopPropagation();
            newFolderFromPicker();
            break;
        case 'select-folder':
            e.stopPropagation();
            selectFolderFromPicker(parseInt(el.dataset.categoryId));
            break;
        case 'open-note':
            var noteEl = el.closest('[data-note-id]');
            if (noteEl) openNote(parseInt(noteEl.dataset.noteId));
            break;
        case 'open-note-link':
            e.preventDefault();
            openNote(parseInt(el.dataset.noteId));
            break;
        case 'create-ghost-note':
            e.preventDefault();
            if (_ghostEnabled()) {
                createGhostNoteFromLink(el.getAttribute('data-ghost-title') || el.dataset.ghostTitle || '');
            }
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
        case 'open-attachment':
            var attEl = el.closest('[data-attachment-id]');
            if (attEl) openAttachmentPreview(parseInt(attEl.dataset.attachmentId, 10), attEl.dataset.attachmentName);
            break;
        case 'open-image-preview':
            var attId = parseInt(el.getAttribute('data-att-id'), 10);
            if (attId) {
                var attName = el.getAttribute('data-att-filename') || el.getAttribute('alt') || '';
                openAttachmentPreview(attId, attName);
            }
            break;
        case 'close-attachment-preview': closeAttachmentPreview(); break;
        case 'download-attachment-preview': break; // handled via onclick set in openAttachmentPreview
        case 'find-attachment-in-notes': break;    // handled via onclick set in openAttachmentPreview
        case 'delete-attachment-preview': break;   // handled via onclick set in openAttachmentPreview
        case 'rename-attachment-preview': break;   // handled via onclick set in openAttachmentPreview
        case 'close-modal-self':
            if (e.target === el) {
                var closeFn = el.dataset.modalClose;
                if (closeFn && typeof window[closeFn] === 'function') window[closeFn]();
            }
            break;
        case 'edit-fldraw': openDrawingForEdit(el); break;
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
        case 'ctx-find-attachment': ctxFindAttachment(); break;
        case 'ctx-download-attachment': ctxDownloadAttachment(); break;
        case 'ctx-delete-attachment': ctxDeleteAttachment(); break;
        case 'ctx-rename-attachment': ctxRenameAttachment(); break;
        case 'ctx-delete-all-attachments': ctxDeleteAllAttachments(); break;
        case 'ctx-delete-attachment-category': ctxDeleteAttachmentCategory(); break;
    }
});

// Change delegation
document.addEventListener('change', function(e) {
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;
    switch (action) {
        case 'prop-changed': onPropChanged(); break;
        case 'toggle-widget-visibility':
            toggleWidgetVisibility(parseInt(el.dataset.widgetIdx), el.checked);
            break;
        case 'toggle-topbar-visibility':
            toggleTopbarItemVisibility(parseInt(el.dataset.topbarIdx), el.checked);
            break;
        case 'qs-toggle-dark-mode': toggleDarkMode(); break;
        case 'qs-toggle-mode': toggleMode(); break;
        case 'qs-toggle-render-embeds': toggleRenderEmbeds(); break;
        case 'qs-toggle-live-preview': toggleLivePreview(); break;
        case 'qs-toggle-hide-title': toggleHideTitle(); break;
        case 'qs-toggle-props-collapsed': togglePropsPanel(); break;
        case 'qs-toggle-auto-save': toggleAutoSave(); break;
        case 'qs-toggle-compact-mode': toggleCompactMode(); break;
        case 'qs-toggle-spotlight-mode': toggleSpotlightMode(); break;
    }
});

// Input delegation
document.addEventListener('input', function(e) {
    var el = _findAction(e.target);
    if (!el) return;
    var action = el.dataset.action;
    switch (action) {
        case 'filter-notes': filterNotes(el.value); break;
        case 'folder-picker-search': refreshFolderPicker(); break;
    }
});

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

// ============ AI Chat Panel ============
var aiDropdown = document.getElementById('ai-dropdown');

function toggleAIDropdown() {
    if (!aiDropdown) return;
    if (aiDropdown.classList.contains('open')) {
        closeAIDropdown();
    } else {
        aiDropdown.classList.add('open');
        setTimeout(function() {
            document.addEventListener('click', closeAIDropdownOnOutsideClick, { capture: true });
        }, 0);
    }
}

function closeAIDropdown() {
    if (!aiDropdown) return;
    aiDropdown.classList.remove('open');
    document.removeEventListener('click', closeAIDropdownOnOutsideClick, { capture: true });
}

function closeAIDropdownOnOutsideClick(e) {
    if (aiDropdown && !aiDropdown.contains(e.target)) {
        closeAIDropdown();
    }
}

// ============ Note Export ============

var exportDropdown = document.getElementById('export-dropdown');

function toggleExportDropdown() {
    if (!exportDropdown) return;
    if (exportDropdown.classList.contains('open')) {
        closeExportDropdown();
    } else {
        exportDropdown.classList.add('open');
        setTimeout(function() {
            document.addEventListener('click', closeExportDropdownOnOutsideClick, { capture: true });
        }, 0);
    }
}

function closeExportDropdown() {
    if (!exportDropdown) return;
    exportDropdown.classList.remove('open');
    document.removeEventListener('click', closeExportDropdownOnOutsideClick, { capture: true });
}

function closeExportDropdownOnOutsideClick(e) {
    if (exportDropdown && !exportDropdown.contains(e.target)) {
        closeExportDropdown();
    }
}

function _getNoteTitle() {
    var titleEl = document.getElementById('note-title');
    return (titleEl && titleEl.value.trim()) ? titleEl.value.trim() : 'Untitled';
}

function _stripMarkdownForTTS(md) {
    if (!md) return '';
    var text = md
        .replace(/```[\s\S]*?```/g, ' ')  // code blocks
        .replace(/`([^`]*)`/g, '$1')       // inline code
        .replace(/!\[\[[^\]]*\]\]/g, ' ')   // embeds ![[...]]
        .replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, '$1')  // wikilinks
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')        // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links
        .replace(/^#{1,6}\s+/gm, '')      // headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/\*([^*]+)\*/g, '$1')     // italic
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')     // strikethrough
        .replace(/^>\s+/gm, '')             // blockquotes
        .replace(/^[-*+]\s+/gm, '')         // list markers
        .replace(/^\d+\.\s+/gm, '')         // numbered list
        .replace(/^---+$/gm, ' ')           // hr
        .replace(/<[^>]+>/g, ' ')           // html tags
        .replace(/\s+/g, ' ')
        .trim();
    return text;
}

function speakCurrentNote() {
    if (!window.FlaskyTTS || !FlaskyTTS.isSupported()) return;
    if (FlaskyTTS.isSpeaking()) { FlaskyTTS.stop(); return; }
    if (!FlaskyTTS.hasVoices()) {
        var s = document.getElementById('save-status');
        if (s) { s.textContent = '⚠ No TTS voices available in this browser'; s.style.color = 'var(--red)'; setTimeout(function () { s.textContent = ''; s.style.color = ''; }, 4000); }
        return;
    }
    var title = _getNoteTitle();
    var content = getEditorContent() || '';
    var clean = _stripMarkdownForTTS(content);
    var text = (title && title !== 'Untitled' ? title + '. ' : '') + (clean || '(empty note)');
    FlaskyTTS.speak(text, { title: title });
}

function _sanitizeFilename(name) {
    return name.replace(/[<>:"|?*\\\/]/g, '_').trim() || 'Untitled';
}

function _buildFrontmatter(properties) {
    if (!properties) return '';
    var props;
    try {
        props = (typeof properties === 'string') ? JSON.parse(properties) : properties;
    } catch (e) {
        return '';
    }
    if (!props || typeof props !== 'object' || Object.keys(props).length === 0) return '';
    var lines = ['---'];
    for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var val = props[key];
        if (Array.isArray(val)) {
            lines.push(key + ':');
            for (var i = 0; i < val.length; i++) lines.push('  - ' + val[i]);
        } else {
            lines.push(key + ': ' + val);
        }
    }
    lines.push('---');
    return lines.join('\n') + '\n';
}

function _renderNoteHtml(content) {
    var html = (typeof marked !== 'undefined') ? marked(content || '') : (content || '');
    if (typeof sanitizeMarkdown === 'function') html = sanitizeMarkdown(html);
    if (typeof processCallouts === 'function') html = processCallouts(html);
    return html;
}

function _buildStandaloneHtml(title, content, options) {
    var opts = options || {};
    var body = _renderNoteHtml(content);
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var hljsHref = isDark
        ? '/static/vendor/hljs/styles/github-dark.min.css'
        : '/static/vendor/hljs/styles/github.min.css';

    // CSS variables mirror flasky/static/css/app.css (Catppuccin Mocha / light)
    var vars = isDark
        ? ':root{'
            + '--bg-primary:#1e1e2e;--bg-secondary:#181825;--bg-hover:rgba(255,255,255,0.05);'
            + '--text-primary:#cdd6f4;--text-secondary:#bac2de;--text-muted:#585b70;'
            + '--accent:#b4befe;--accent-dim:rgba(180,190,254,0.1);'
            + '--border:rgba(255,255,255,0.06);--border-light:rgba(255,255,255,0.1);'
            + '--green:#a6e3a1;--red:#f38ba8;--yellow:#f9e2af;--blue:#89b4fa;'
            + '}'
        : ':root{'
            + '--bg-primary:#f8f9fc;--bg-secondary:#eff1f5;--bg-hover:rgba(0,0,0,0.06);'
            + '--text-primary:#1a1a2e;--text-secondary:#2d2d44;--text-muted:#555770;'
            + '--accent:#5a6fe0;--accent-dim:rgba(90,111,224,0.16);'
            + '--border:rgba(0,0,0,0.12);--border-light:rgba(0,0,0,0.18);'
            + '--green:#2d8a1a;--red:#c40d33;--yellow:#c47a10;--blue:#1556d4;'
            + '}';

    // Print-friendly typography + element styles (mirrors .editor-preview)
    var css = vars
        + 'html,body{background:var(--bg-primary);color:var(--text-primary);}'
        + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
        +   'max-width:780px;margin:0 auto;padding:2rem 1rem;line-height:1.7;font-size:16px;'
        +   '-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}'
        + 'article{overflow-wrap:break-word;word-wrap:break-word;}'
        + 'h1,h2,h3,h4,h5,h6{color:var(--text-primary);line-height:1.3;margin:1.4em 0 0.4em;font-weight:600;}'
        + 'h1:first-child,h2:first-child,h3:first-child{margin-top:0;}'
        + 'h1{font-size:1.8em;font-weight:700;border-bottom:1px solid var(--border-light);padding-bottom:0.3em;}'
        + 'h2{font-size:1.4em;}'
        + 'h3{font-size:1.15em;}'
        + 'h4,h5,h6{font-size:1em;}'
        + 'p{margin:0.7em 0;}'
        + 'a{color:var(--accent);text-decoration:none;}'
        + 'a:hover{text-decoration:underline;}'
        + 'strong{font-weight:600;}'
        + 'code{background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:0.88em;'
        +   'font-family:"JetBrains Mono","Fira Code","SF Mono",ui-monospace,Menlo,Consolas,monospace;}'
        + 'pre{background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;'
        +   'padding:14px 18px;overflow-x:auto;margin:1em 0;line-height:1.5;}'
        + 'pre code{background:none;padding:0;font-size:13px;color:inherit;}'
        + 'blockquote{border-left:3px solid var(--accent);padding-left:16px;color:var(--text-secondary);'
        +   'margin:0.8em 0;font-style:italic;}'
        + 'ul,ol{padding-left:1.6em;margin:0.5em 0;}'
        + 'li{margin:0.2em 0;}'
        + 'li>ul,li>ol{margin:0;}'
        + 'img{max-width:100%;border-radius:8px;margin:0.5em 0;}'
        + 'hr{border:none;border-top:1px solid var(--border-light);margin:1.8em 0;}'
        + 'table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px;}'
        + 'th,td{border:1px solid var(--border);padding:8px 12px;text-align:left;}'
        + 'th{background:var(--bg-secondary);font-weight:600;}'
        + 'tr:nth-child(even){background:var(--bg-hover);}'
        + 'input[type="checkbox"]{margin-right:6px;accent-color:var(--accent);}'
        + 'kbd{display:inline-block;padding:2px 6px;background:var(--bg-hover);border:1px solid var(--border-light);'
        +   'border-radius:4px;font-size:12px;font-family:inherit;color:var(--text-secondary);}'
        // Callouts (Obsidian-style)
        + '.callout{border-left:4px solid var(--accent);border-radius:6px;background:var(--accent-dim);'
        +   'padding:12px 16px;margin:0.8em 0;}'
        + '.callout-title{font-weight:600;font-size:0.95em;margin-bottom:4px;display:flex;align-items:center;gap:6px;}'
        + '.callout-title-icon{font-size:1.1em;}'
        + '.callout-content{color:var(--text-secondary);}'
        + '.callout-content p{margin:0.3em 0;}'
        + '.callout-content p:first-child{margin-top:0;}'
        + '.callout[data-callout="info"],.callout[data-callout="note"]{border-left-color:var(--blue);background:rgba(137,180,250,0.08);}'
        + '.callout[data-callout="tip"],.callout[data-callout="hint"]{border-left-color:#94e2d5;background:rgba(148,226,213,0.08);}'
        + '.callout[data-callout="warning"],.callout[data-callout="caution"],.callout[data-callout="attention"]{border-left-color:var(--yellow);background:rgba(249,226,175,0.08);}'
        + '.callout[data-callout="danger"],.callout[data-callout="error"],.callout[data-callout="failure"],.callout[data-callout="fail"],.callout[data-callout="missing"]{border-left-color:var(--red);background:rgba(243,139,168,0.08);}'
        + '.callout[data-callout="success"],.callout[data-callout="check"],.callout[data-callout="done"]{border-left-color:var(--green);background:rgba(166,227,161,0.08);}'
        + '.callout[data-callout="question"],.callout[data-callout="help"],.callout[data-callout="faq"]{border-left-color:#fab387;background:rgba(250,179,135,0.08);}'
        + '.callout[data-callout="example"]{border-left-color:#cba6f7;background:rgba(203,166,247,0.08);}'
        + '.callout[data-callout="quote"],.callout[data-callout="cite"]{border-left-color:var(--text-muted);background:var(--bg-hover);}'
        + '.callout[data-callout="abstract"],.callout[data-callout="summary"],.callout[data-callout="tldr"]{border-left-color:#74c7ec;background:rgba(116,199,236,0.08);}'
        + '.callout[data-callout="bug"]{border-left-color:#f38ba8;background:rgba(243,139,168,0.08);}'
        + '.callout[data-callout="todo"]{border-left-color:var(--accent);background:var(--accent-dim);}'
        // Print rules — zero @page margin (content padding handled by body),
        // preserve theme via print-color-adjust so dark backgrounds render.
        + '@page{margin:0;}'
        + 'html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
        + '@media print{'
        +   'body{max-width:none;margin:0;padding:1.5cm 2cm;}'
        +   'pre,blockquote,table,.callout,tr,img{page-break-inside:avoid;}'
        +   'h1,h2,h3,h4,h5,h6{page-break-after:avoid;}'
        +   'pre{white-space:pre-wrap;word-wrap:break-word;}'
        +   '.no-print{display:none!important;}'
        + '}';

    // Optional print hint banner (hidden in print) — only shown for PDF preview
    var printHint = '';
    var hljsScript = '';
    if (opts.forPrint) {
        printHint = '<div class="no-print" style="position:fixed;top:0;left:0;right:0;background:var(--accent);color:#fff;'
            +   'padding:8px 16px;font-size:13px;text-align:center;z-index:9999;">'
            +   'Use your browser\'s "Save as PDF" option in the print dialog to export this note.'
            +   '<button type="button" onclick="this.parentNode.remove()" style="float:right;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">\u00d7</button>'
            + '</div>';
        hljsScript = '<script src="/static/vendor/hljs/highlight.min.js"></' + 'script>';
    }

    return ''
        + '<!DOCTYPE html>\n<html lang="en" data-theme="' + (isDark ? 'dark' : 'light') + '">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        + '<title>' + escapeHtml(title) + ' — Flasky Notes</title>\n'
        + '<link rel="stylesheet" href="' + hljsHref + '">\n'
        + '<style>' + css + '</style>\n'
        + '</head>\n<body>\n'
        + printHint
        + '<h1>' + escapeHtml(title) + '</h1>\n'
        + '<article>\n' + body + '\n</article>\n'
        + hljsScript
        + '</body>\n</html>';
}

function _downloadBlob(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

function _downloadText(filename, text, mime) {
    _downloadBlob(filename, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
}

function exportCurrentNote(format) {
    var title = _getNoteTitle();
    var content = getEditorContent() || '';
    var props = collectProperties();
    var fileBase = _sanitizeFilename(title);

    if (format === 'md') {
        var fm = _buildFrontmatter(props);
        _downloadText(fileBase + '.md', fm + content, 'text/markdown;charset=utf-8');
        return;
    }

    if (format === 'txt') {
        _downloadText(fileBase + '.txt', content, 'text/plain;charset=utf-8');
        return;
    }

    if (format === 'web') {
        _downloadText(fileBase + '.html', _buildStandaloneHtml(title, content), 'text/html;charset=utf-8');
        return;
    }

    if (format === 'pdf') {
        var html = _buildStandaloneHtml(title, content, { forPrint: true });
        var printWin = window.open('', '_blank');
        if (!printWin) {
            alert('Pop-up blocked. Please allow pop-ups to export as PDF.');
            return;
        }
        // Highlight code blocks then trigger the print dialog once the
        // document (and its hljs <script>) has loaded. Attach onload before
        // writing so we don't miss the load event on fast/synchronous parses.
        printWin.onload = function() {
            try {
                if (printWin.hljs) {
                    printWin.document.querySelectorAll('pre code').forEach(function(block) {
                        printWin.hljs.highlightElement(block);
                    });
                }
            } catch (e) { /* hljs optional */ }
            printWin.setTimeout(function() { printWin.print(); }, 200);
        };
        printWin.document.open();
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        return;
    }
}

function openAIPanelWithPrompt(titleFallback, prompt, attachNote) {
    if (aiPanel && aiPanel.classList.contains('collapsed')) {
        toggleAIPanel();
    }
    setTimeout(function() {
        if (attachNote && aiNoteContext === null) {
            toggleAINoteContext();
        } else if (!attachNote && aiNoteContext === null) {
            // no note context needed
        }
        if (prompt && aiPanelInput) {
            aiPanelInput.value = prompt;
            aiPanelInput.focus();
            aiPanelInput.style.height = 'auto';
            aiPanelInput.style.height = Math.min(aiPanelInput.scrollHeight, 120) + 'px';
        } else if (aiPanelInput) {
            aiPanelInput.focus();
        }
    }, 100);
}

function aiOpenWithSelection(promptPrefix) {
    if (!cmEditor) return;
    var sel = cmEditor.getSelection();
    if (!sel) return;
    if (aiPanel && aiPanel.classList.contains('collapsed')) {
        toggleAIPanel();
    }
    setTimeout(function() {
        if (aiPanelInput) {
            aiPanelInput.value = promptPrefix + ':\n\n' + sel;
            aiPanelInput.focus();
            aiPanelInput.style.height = 'auto';
            aiPanelInput.style.height = Math.min(aiPanelInput.scrollHeight, 120) + 'px';
        }
    }, 100);
}

var aiPanel = document.getElementById('ai-panel');
var aiPanelMessages = document.getElementById('ai-panel-messages');
var aiPanelInput = document.getElementById('ai-panel-input');
var aiPanelSendBtn = document.getElementById('ai-panel-send-btn');
var aiPanelStopBtn = document.getElementById('ai-panel-stop-btn');
var aiPanelStatus = document.getElementById('ai-panel-status');
var aiPanelModel = document.getElementById('ai-panel-model');
var aiPanelEmpty = document.getElementById('ai-panel-empty');
var aiPanelContext = document.getElementById('ai-panel-context');
var aiPanelContextTitle = document.getElementById('ai-panel-context-title');
var aiPanelContextDismiss = document.getElementById('ai-panel-context-dismiss');
var aiConversationId = null;
var aiLocalMessages = [];
var aiIsStreaming = false;
var aiAbortController = null;
var aiNoteContext = null;

// Resizable AI panel
(function() {
    if (!aiPanel) return;
    var savedWidth = localStorage.getItem('flasky-ai-panel-width');
    if (savedWidth) { aiPanel.style.width = savedWidth + 'px'; aiPanel.style.minWidth = savedWidth + 'px'; }
    var handle = document.getElementById('ai-panel-resize-handle');
    if (!handle) return;
    var isResizing = false;
    handle.addEventListener('mousedown', function(e) {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!isResizing || aiPanel.classList.contains('collapsed')) return;
        var newWidth = aiPanel.parentElement.getBoundingClientRect().right - e.clientX;
        newWidth = Math.max(280, Math.min(600, newWidth));
        aiPanel.style.width = newWidth + 'px';
        aiPanel.style.minWidth = newWidth + 'px';
    });
    document.addEventListener('mouseup', function() {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('flasky-ai-panel-width', parseInt(aiPanel.style.width));
    });
})();

function toggleAIPanel() {
    if (!aiPanel) return;
    aiPanel.classList.toggle('collapsed');
    var expanded = !aiPanel.classList.contains('collapsed');
    var btn = document.querySelector('[data-action="ask-ai"]');
    if (btn) btn.classList.toggle('active', expanded);
    if (expanded) {
        var savedWidth = localStorage.getItem('flasky-ai-panel-width');
        if (savedWidth) { aiPanel.style.width = savedWidth + 'px'; aiPanel.style.minWidth = savedWidth + 'px'; }
        if (aiLocalMessages.length === 0 && aiPanelEmpty) {
            aiPanelInput.focus();
        }
        if (aiNoteContext && aiPanelContext) {
            aiPanelContext.style.display = '';
            aiPanelContextTitle.textContent = aiNoteContext.title;
        }
    } else {
        aiPanel.style.width = '';
        aiPanel.style.minWidth = '';
    }
}

function toggleAINoteContext() {
    var includeBtn = document.getElementById('ai-panel-include-note');
    if (aiNoteContext) {
        aiNoteContext = null;
        if (aiPanelContext) aiPanelContext.style.display = 'none';
        if (aiPanelContextTitle) aiPanelContextTitle.textContent = '';
        if (aiPanelInput) aiPanelInput.placeholder = 'Ask AI...';
        if (includeBtn) includeBtn.classList.remove('active');
    } else {
        var title = document.getElementById('note-title');
        var content = getEditorContent();
        var noteTitle = title ? title.value.trim() : '';
        if (!noteTitle && !content) {
            if (includeBtn) includeBtn.classList.remove('active');
            return;
        }
        aiNoteContext = { title: noteTitle || 'Untitled', content: content };
        if (aiPanelContext) {
            aiPanelContext.style.display = '';
            aiPanelContextTitle.textContent = aiNoteContext.title;
        }
        if (aiPanelInput) aiPanelInput.placeholder = 'Ask about this note...';
        if (includeBtn) includeBtn.classList.add('active');
    }
}

function closeAIPanel() {
    if (!aiPanel) return;
    aiPanel.classList.add('collapsed');
    aiPanel.style.width = '';
    aiPanel.style.minWidth = '';
    var btn = document.querySelector('[data-action="ask-ai"]');
    if (btn) btn.classList.remove('active');
}

if (aiPanelContextDismiss) {
    aiPanelContextDismiss.addEventListener('click', function() {
        aiNoteContext = null;
        if (aiPanelContext) aiPanelContext.style.display = 'none';
        if (aiPanelInput) aiPanelInput.placeholder = 'Ask AI...';
        var includeBtn = document.getElementById('ai-panel-include-note');
        if (includeBtn) includeBtn.classList.remove('active');
    });
}

function aiNewChat() {
    aiConversationId = null;
    aiLocalMessages = [];
    if (aiPanelMessages) {
        aiPanelMessages.innerHTML = '';
    }
    if (aiPanelEmpty) {
        aiPanelEmpty = document.createElement('div');
        aiPanelEmpty.className = 'ai-panel-empty';
        aiPanelEmpty.id = 'ai-panel-empty';
        aiPanelEmpty.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Ask me anything</span>';
        aiPanelMessages.appendChild(aiPanelEmpty);
    }
    aiNoteContext = null;
    if (aiPanelContext) aiPanelContext.style.display = 'none';
    if (aiPanelContextTitle) aiPanelContextTitle.textContent = '';
    if (aiPanelInput) aiPanelInput.placeholder = 'Ask AI...';
    var includeBtn = document.getElementById('ai-panel-include-note');
    if (includeBtn) includeBtn.classList.remove('active');
    aiPanelStatus.textContent = 'Ready';
    if (aiHistoryDropdown) aiHistoryDropdown.classList.remove('open');
    if (aiPanelInput) aiPanelInput.focus();
}

var aiHistoryDropdown = document.getElementById('ai-panel-history-dropdown');
var aiHistoryBtn = document.getElementById('ai-panel-history-btn');

function aiLoadConversations() {
    fetch('/ai/api/conversations', { headers: { 'X-CSRFToken': aiGetCSRF() } })
        .then(function(r) { return r.json(); })
        .then(function(convs) {
            aiRenderConversationList(convs);
        }).catch(function() {});
}

function aiRenderConversationList(convs) {
    if (!aiHistoryDropdown) return;
    aiHistoryDropdown.innerHTML = '';
    if (convs.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'ai-panel-history-empty';
        empty.textContent = 'No conversations yet';
        aiHistoryDropdown.appendChild(empty);
        return;
    }
    convs.forEach(function(c) {
        var item = document.createElement('div');
        item.className = 'ai-panel-history-item' + (c.id === aiConversationId ? ' active' : '');
        var titleSpan = document.createElement('span');
        titleSpan.className = 'ai-panel-history-title';
        var displayTitle = c.title || 'Untitled';
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            FlaskyE2EE.decryptField(displayTitle).then(function(dec) {
                titleSpan.textContent = dec;
            }).catch(function() { titleSpan.textContent = displayTitle; });
        } else {
            titleSpan.textContent = displayTitle;
        }
        item.appendChild(titleSpan);
        var del = document.createElement('button');
        del.className = 'ai-panel-history-delete';
        del.title = 'Delete';
        del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        del.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('Delete this conversation?')) {
                fetch('/ai/api/conversations/' + c.id, {
                    method: 'DELETE',
                    headers: { 'X-CSRFToken': aiGetCSRF() }
                }).then(function() {
                    if (aiConversationId === c.id) {
                        aiNewChat();
                    }
                    aiLoadConversations();
                });
            }
        });
        item.appendChild(del);
        item.addEventListener('click', function() {
            aiConversationId = c.id;
            aiLoadMessages(c.id);
            aiHistoryDropdown.classList.remove('open');
        });
        aiHistoryDropdown.appendChild(item);
    });
}

function aiLoadMessages(convId) {
    aiLocalMessages = [];
    fetch('/ai/api/conversations/' + convId + '/messages', {
        headers: { 'X-CSRFToken': aiGetCSRF() }
    }).then(function(r) { return r.json(); }).then(function(msgs) {
        aiPanelMessages.innerHTML = '';
        if (msgs.length === 0) {
            aiPanelEmpty = document.createElement('div');
            aiPanelEmpty.className = 'ai-panel-empty';
            aiPanelEmpty.id = 'ai-panel-empty';
            aiPanelEmpty.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Ask me anything</span>';
            aiPanelMessages.appendChild(aiPanelEmpty);
        } else {
            aiPanelEmpty = null;
            var decryptChain = Promise.resolve();
            msgs.forEach(function(m) {
                decryptChain = decryptChain.then(function() {
                    var content = m.content;
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                        return FlaskyE2EE.decryptField(content).then(function(dec) {
                            aiLocalMessages.push({ role: m.role, content: dec });
                            aiAddMessage(m.role, dec, true, m.id);
                        }).catch(function() {
                            aiLocalMessages.push({ role: m.role, content: content });
                            aiAddMessage(m.role, content, true, m.id);
                        });
                    } else {
                        aiLocalMessages.push({ role: m.role, content: content });
                        aiAddMessage(m.role, content, true, m.id);
                        return Promise.resolve();
                    }
                });
            });
        }
    });
}

if (aiHistoryBtn) {
    aiHistoryBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (aiHistoryDropdown) {
            aiHistoryDropdown.classList.toggle('open');
            if (aiHistoryDropdown.classList.contains('open')) {
                aiLoadConversations();
            }
        }
    });
}

document.addEventListener('click', function(e) {
    var wrap = document.getElementById('ai-panel-history-wrap');
    if (wrap && aiHistoryDropdown && !wrap.contains(e.target)) {
        aiHistoryDropdown.classList.remove('open');
    }
});

function aiGetCSRF() {
    var cookie = document.cookie.match(/X-CSRF-Token=([^;]+)/);
    return cookie ? cookie[1] : '';
}

function aiRenderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        return sanitizeMarkdown(marked(text));
    }
    return sanitizeMarkdown(text.replace(/</g, '&lt;').replace(/\n/g, '<br>'));
}

function aiAddCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(function(pre) {
        if (pre.querySelector('.ai-panel-code-copy-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'ai-panel-code-copy-btn';
        btn.title = 'Copy code';
        btn.setAttribute('aria-label', 'Copy code');
        btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            var code = pre.querySelector('code');
            var text = code ? code.textContent : pre.textContent;
            navigator.clipboard.writeText(text).then(function() {
                btn.classList.add('copied');
                btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
                setTimeout(function() {
                    btn.classList.remove('copied');
                    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                }, 2000);
            });
        });
        pre.appendChild(btn);
    });
}

var AI_COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var AI_INSERT_ICON = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';

function aiAddMessage(role, content, doRender, messageId) {
    if (aiPanelEmpty && aiPanelEmpty.parentNode) aiPanelEmpty.remove();
    var wrapper = document.createElement('div');
    wrapper.className = 'ai-panel-msg ai-panel-msg-' + role;
    if (messageId) wrapper.dataset.messageId = messageId;

    var avatar = document.createElement('div');
    avatar.className = 'ai-panel-msg-avatar';
    avatar.textContent = role === 'user' ? 'U' : 'AI';
    wrapper.appendChild(avatar);

    var contentDiv = document.createElement('div');
    contentDiv.className = 'ai-panel-msg-content';
    if (role === 'assistant' && doRender !== false) {
        contentDiv.innerHTML = aiRenderMarkdown(content);
        setTimeout(function() {
            contentDiv.querySelectorAll('pre code').forEach(function(block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            aiAddCodeCopyButtons(contentDiv);
        }, 0);
    } else {
        contentDiv.textContent = content;
    }
    wrapper.appendChild(contentDiv);

    if (content) {
        var actions = document.createElement('div');
        actions.className = 'ai-panel-msg-actions';

        var copyBtn = document.createElement('button');
        copyBtn.className = 'ai-panel-msg-action-btn';
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = AI_COPY_ICON;
        copyBtn.addEventListener('click', function() {
            navigator.clipboard.writeText(content).then(function() {
                copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
                setTimeout(function() { copyBtn.innerHTML = AI_COPY_ICON; }, 2000);
            });
        });
        actions.appendChild(copyBtn);

        if (role === 'assistant' && cmEditor) {
            var insertBtn = document.createElement('button');
            insertBtn.className = 'ai-panel-msg-action-btn';
            insertBtn.title = 'Insert into note';
            insertBtn.innerHTML = AI_INSERT_ICON;
            insertBtn.addEventListener('click', function() {
                if (!cmEditor) return;
                var cursor = cmEditor.getCursor();
                cmEditor.replaceRange('\n' + content + '\n', cursor);
                cmEditor.focus();
                aiShowToast('Inserted into note');
            });
            actions.appendChild(insertBtn);
        }

        if (role === 'assistant') {
            var noteBtn = document.createElement('button');
            noteBtn.className = 'ai-panel-msg-action-btn';
            noteBtn.title = 'Create note';
            noteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
            noteBtn.addEventListener('click', function() {
                aiCreateNoteFromMessage(content, messageId);
            });
            actions.appendChild(noteBtn);
        }

        wrapper.appendChild(actions);
    }

    aiPanelMessages.appendChild(wrapper);
    aiPanelMessages.scrollTop = aiPanelMessages.scrollHeight;
    return contentDiv;
}

async function aiCreateNoteFromMessage(content, messageId) {
    var title = content.split('\n')[0].substring(0, 100).replace(/^#+\s*/, '').trim() || 'AI Chat Note';
    var payload = { source: 'custom', title: title, content: content };
    var isE2EE = typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();
    if (isE2EE) {
        try {
            payload.title = await FlaskyE2EE.encryptField(title);
            payload.content = await FlaskyE2EE.encryptField(content);
        } catch(e) {
            alert('Failed to encrypt note content.');
            return;
        }
    }
    fetch('/ai/api/create_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': aiGetCSRF() },
        body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.success) {
            aiShowToast('Note created: ', data.note_id, title);
        } else {
            alert(data.error || 'Failed to create note.');
        }
    }).catch(function() { alert('Failed to create note.'); });
}

function aiShowToast(message, linkUrl, linkText) {
    var toast = document.createElement('div');
    toast.className = 'ai-toast';
    if (linkUrl && linkText) {
        var link = document.createElement('a');
        link.href = '/note/' + encodeURIComponent(linkUrl);
        link.target = '_blank';
        link.textContent = linkText;
        toast.appendChild(document.createTextNode(message));
        toast.appendChild(link);
    } else {
        toast.textContent = message;
    }
    document.body.appendChild(toast);
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function() { toast.remove(); }, 300);
    }, 5000);
}

async function aiSendPanelMessage() {
    var text = aiPanelInput.value.trim();
    if (!text || aiIsStreaming) return;
    aiPanelInput.value = '';
    aiPanelInput.style.height = 'auto';
    aiPanelInput.style.height = aiPanelInput.scrollHeight + 'px';

    aiAddMessage('user', text, false);

    var messageForModel = text;
    if (aiNoteContext) {
        messageForModel = 'The user has attached this note:\n---\n' + aiNoteContext.content + '\n---\n\n' + text;
    }
    aiLocalMessages.push({ role: 'user', content: messageForModel });
    aiPanelStatus.innerHTML = '<span class="streaming">Sending...</span>';

    var encryptedTitle = text.substring(0, 100);
    var encryptedMessage = messageForModel;

    var isE2EE = typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();
    if (isE2EE) {
        encryptedTitle = await FlaskyE2EE.encryptField(encryptedTitle);
        encryptedMessage = await FlaskyE2EE.encryptField(encryptedMessage);
    }

    function doStream() {
        aiIsStreaming = true;
        aiPanelSendBtn.style.display = 'none';
        aiPanelStopBtn.style.display = 'flex';
        aiPanelInput.disabled = true;
        aiPanelStatus.innerHTML = '<span class="streaming">Thinking...</span>';
        var assistantDiv = aiAddMessage('assistant', '', false);
        assistantDiv.classList.add('ai-cursor-blink');

        aiAbortController = new AbortController();
        var chatBody = { message: encryptedMessage };
        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
            chatBody.messages = aiLocalMessages;
        }

        fetch('/ai/api/conversations/' + aiConversationId + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': aiGetCSRF() },
            body: JSON.stringify(chatBody),
            signal: aiAbortController.signal
        }).then(function(response) {
            if (!response.ok) {
                response.text().then(function(t) {
                    try { var errData = JSON.parse(t); assistantDiv.textContent = errData.error || 'Error'; }
                    catch(e) { assistantDiv.textContent = 'Something went wrong.'; }
                    assistantDiv.classList.remove('ai-cursor-blink');
                    aiFinishStream();
                });
                return;
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var fullText = '';
            var streamFinished = false;

            function read() {
                reader.read().then(function(result) {
                    if (result.done) {
                        if (!streamFinished) aiFinishStream(assistantDiv, fullText, null, false);
                        return;
                    }
                    var chunk = decoder.decode(result.value, {stream: true});
                    chunk.split('\n').forEach(function(line) {
                        if (line.startsWith('data: ')) {
                            try {
                                var data = JSON.parse(line.substring(6));
                                if (data.chunk) {
                                    fullText += data.chunk;
                                    assistantDiv.textContent = fullText;
                                    aiPanelMessages.scrollTop = aiPanelMessages.scrollHeight;
                                    aiPanelStatus.innerHTML = '<span class="streaming">Streaming...</span>';
                                } else if (data.error) {
                                    streamFinished = true;
                                    var errWrapper = assistantDiv.closest('.ai-panel-msg');
                                    if (errWrapper) errWrapper.classList.add('ai-panel-msg-error');
                                    assistantDiv.textContent = data.error;
                                    assistantDiv.classList.remove('ai-cursor-blink');
                                    aiFinishStream();
                                } else if (data.done) {
                                    streamFinished = true;
                                    aiFinishStream(assistantDiv, fullText, data.message_id, true);
                                }
                            } catch(e) {}
                        }
                    });
                    read();
                }).catch(function(err) {
                    if (err.name === 'AbortError' && !streamFinished) {
                        streamFinished = true;
                        reader.cancel();
                        aiFinishStream(assistantDiv, fullText, null, false);
                    }
                });
            }
            read();
        }).catch(function(err) {
            if (err.name === 'AbortError') return;
            var errWrapper = assistantDiv.closest('.ai-panel-msg');
            if (errWrapper) errWrapper.classList.add('ai-panel-msg-error');
            assistantDiv.textContent = 'Connection error.';
            assistantDiv.classList.remove('ai-cursor-blink');
            aiFinishStream();
        });
    }

    if (!aiConversationId) {
        fetch('/ai/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': aiGetCSRF() },
            body: JSON.stringify({ title: encryptedTitle, model: aiPanelModel ? aiPanelModel.value : undefined })
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.error) { aiShowToast(data.error); aiPanelStatus.textContent = 'Error'; return; }
            aiConversationId = data.id;
            aiLoadConversations();
            doStream();
        });
    } else {
        doStream();
    }
}

function aiFinishStream(div, text, messageId, wasClean) {
    if (div) {
        div.classList.remove('ai-cursor-blink');
        if (text) {
            div.innerHTML = aiRenderMarkdown(text);
            div.querySelectorAll('pre code').forEach(function(block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            aiAddCodeCopyButtons(div);
            aiLocalMessages.push({ role: 'assistant', content: text });
            if (messageId) {
                var wrapper = div.closest('.ai-panel-msg');
                if (wrapper) {
                    wrapper.dataset.messageId = messageId;
                    var existingActions = wrapper.querySelector('.ai-panel-msg-actions');
                    if (existingActions) existingActions.remove();
                    var actions = document.createElement('div');
                    actions.className = 'ai-panel-msg-actions';

                    var copyBtn = document.createElement('button');
                    copyBtn.className = 'ai-panel-msg-action-btn';
                    copyBtn.title = 'Copy';
                    copyBtn.innerHTML = AI_COPY_ICON;
                    var capturedText = text;
                    copyBtn.addEventListener('click', function() {
                        navigator.clipboard.writeText(capturedText).then(function() {
                            copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
                            setTimeout(function() { copyBtn.innerHTML = AI_COPY_ICON; }, 2000);
                        });
                    });
                    actions.appendChild(copyBtn);

                    if (typeof cmEditor !== 'undefined' && cmEditor) {
                        var insertBtn = document.createElement('button');
                        insertBtn.className = 'ai-panel-msg-action-btn';
                        insertBtn.title = 'Insert into note';
                        insertBtn.innerHTML = AI_INSERT_ICON;
                        insertBtn.addEventListener('click', function() {
                            if (!cmEditor) return;
                            var cursor = cmEditor.getCursor();
                            cmEditor.replaceRange('\n' + capturedText + '\n', cursor);
                            cmEditor.focus();
                            aiShowToast('Inserted into note');
                        });
                        actions.appendChild(insertBtn);
                    }

                    var noteBtn = document.createElement('button');
                    noteBtn.className = 'ai-panel-msg-action-btn';
                    noteBtn.title = 'Create note';
                    noteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
                    noteBtn.addEventListener('click', function() {
                        aiCreateNoteFromMessage(capturedText, messageId);
                    });
                    actions.appendChild(noteBtn);

                    wrapper.appendChild(actions);
                }
            }
        }
    }
    aiIsStreaming = false;
    aiPanelSendBtn.style.display = 'flex';
    aiPanelStopBtn.style.display = 'none';
    aiPanelInput.disabled = false;
    aiPanelStatus.textContent = wasClean ? 'Ready' : 'Stopped';
    aiAbortController = null;
    aiPanelInput.focus();
    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted() && messageId && text) {
        FlaskyE2EE.encryptField(text).then(function(enc) {
            fetch('/ai/api/messages/' + messageId + '/encrypt', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': aiGetCSRF() },
                body: JSON.stringify({ content: enc })
            }).catch(function(err) { console.error('Failed to encrypt assistant message on server:', err); });
        }).catch(function(err) { console.error('Failed to encrypt assistant message locally:', err); });
    }
}

if (aiPanelSendBtn) {
    aiPanelSendBtn.addEventListener('click', aiSendPanelMessage);
}
if (aiPanelStopBtn) {
    aiPanelStopBtn.addEventListener('click', function() {
        if (aiAbortController) aiAbortController.abort();
    });
}
if (aiPanelInput) {
    aiPanelInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendPanelMessage(); }
    });
    aiPanelInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
}

// Load AI models
if (aiPanelModel && _pageData.aiEnabled) {
    fetch('/ai/api/models', { headers: { 'X-CSRFToken': aiGetCSRF() } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var models = data.models || [];
            aiPanelModel.innerHTML = '';
            models.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                if (m === _pageData.aiModel) opt.selected = true;
                aiPanelModel.appendChild(opt);
            });
        }).catch(function() {
            if (_pageData.aiModel) {
                var opt = document.createElement('option');
                opt.value = _pageData.aiModel;
                opt.textContent = _pageData.aiModel;
                aiPanelModel.appendChild(opt);
            }
        });
}

// Save AI model selection
if (aiPanelModel) {
    aiPanelModel.addEventListener('change', function() {
        fetch('/ai/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': aiGetCSRF() },
            body: JSON.stringify({ model: aiPanelModel.value })
        }).catch(function() {});
    });
}

// No auto-load of existing conversations; start fresh each time

// ============ Editor Selection AI Toolbar ============
(function() {
    if (!_pageData.aiEnabled) return;
    var selBar = document.createElement('div');
    selBar.className = 'ai-sel-bar';
    selBar.innerHTML =
        '<button class="ai-sel-btn" data-action="ai-sel-ask" title="Ask AI about selection">Ask AI</button>' +
        '<button class="ai-sel-btn" data-action="ai-sel-summarize" title="Summarize selection">Summarize</button>' +
        '<button class="ai-sel-btn" data-action="ai-sel-rewrite" title="Rewrite selection">Rewrite</button>' +
        '<button class="ai-sel-btn" data-action="ai-sel-explain" title="Explain selection">Explain</button>';
    selBar.style.display = 'none';
    document.body.appendChild(selBar);

    var selBarVisible = false;

    function hideSelBar() {
        if (selBarVisible) { selBar.style.display = 'none'; selBarVisible = false; }
    }

    function showSelBar() {
        if (!cmEditor || !_pageData.aiEnabled) return;
        var sel = cmEditor.getSelection();
        if (!sel || sel.length < 3) { hideSelBar(); return; }
        var coords = cmEditor.coordsAtPos(cmEditor.getCursor('start'));
        var rect = document.querySelector('.cm-editor').getBoundingClientRect();
        selBar.style.display = 'flex';
        selBarVisible = true;
        selBar.style.left = Math.max(8, Math.min(coords.left - 40, window.innerWidth - 220)) + 'px';
        selBar.style.top = Math.max(8, coords.top - 36 + rect.top + window.scrollY) + 'px';
    }

    if (cmEditor) {
        cmEditor.on('selectionChange', function() {
            setTimeout(function() {
                var sel = cmEditor.getSelection();
                if (sel && sel.length >= 3) showSelBar();
                else hideSelBar();
            }, 50);
        });
    }

    document.addEventListener('mousedown', function(e) {
        if (!selBar.contains(e.target)) {
            setTimeout(hideSelBar, 200);
        }
    });

    selBar.addEventListener('click', function(e) {
        var btn = e.target.closest('.ai-sel-btn');
        if (!btn) return;
        var action = btn.dataset.action;
        var sel = cmEditor ? cmEditor.getSelection() : '';
        if (!sel) return;
        hideSelBar();
        var prompts = {
            'ai-sel-ask': 'About this text:\n\n' + sel,
            'ai-sel-summarize': 'Summarize the following text:\n\n' + sel,
            'ai-sel-rewrite': 'Rewrite the following text more clearly:\n\n' + sel,
            'ai-sel-explain': 'Explain the following text in simple terms:\n\n' + sel
        };
        if (prompts[action]) {
            if (aiPanel && aiPanel.classList.contains('collapsed')) toggleAIPanel();
            setTimeout(function() {
                if (aiPanelInput) {
                    aiPanelInput.value = prompts[action];
                    aiPanelInput.focus();
                    aiPanelInput.style.height = 'auto';
                    aiPanelInput.style.height = Math.min(aiPanelInput.scrollHeight, 120) + 'px';
                }
            }, 100);
        }
    });
})();
