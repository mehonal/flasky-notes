/**
 * Flasky Notes — Unified Search & Command Palette.
 *
 * One input, three modes inferred from leading characters:
 *   (empty)   Search notes (ranked: title-first, then content). Enter opens.
 *   >command  Run commands (editor slash-set + global actions). Enter runs.
 *   [[title   Insert a [[wikilink]] at the editor cursor, or navigate.
 *
 * Open:  FlaskySearchModal.open({ editor, aiEnabled, insertCallback })
 *   - editor:         CodeMirror instance (enables > commands + [[ insert)
 *   - aiEnabled:       bool — include AI commands in > mode
 *   - insertCallback:  function(title) — called when user picks a note in
 *                       [[ mode; if absent, [[ mode navigates instead.
 *
 * Keyboard: Up/Down navigate, Enter open/run/insert, Tab cycle mode,
 *           Esc close, Ctrl/Cmd+K opens globally.
 *
 * Depends on: sanitize.js (escapeHtml), e2ee-search.js (FlaskySearch),
 *             commands.js (FlaskyCommands).
 */
(function () {
    'use strict';

    var overlayId = 'flasky-search-overlay';
    var MODE_NOTES = 'notes';
    var MODE_COMMANDS = 'commands';
    var MODE_LINKS = 'links';

    var searchTimer = null;
    var items = [];
    var selectedIndex = -1;
    var currentMode = MODE_NOTES;
    var openCtx = {};
    var inputEl = null;
    var searchSeq = 0;

    var MODE_META = {};
    MODE_META[MODE_NOTES] = { sigil: '', placeholder: 'Search notes by title or content\u2026', hint: 'Notes' };
    MODE_META[MODE_COMMANDS] = { sigil: '>', placeholder: 'Run a command\u2026', hint: 'Commands' };
    MODE_META[MODE_LINKS] = { sigil: '[[', placeholder: 'Insert a wikilink or open a note\u2026', hint: 'Links' };

    function _buildDOM() {
        if (document.getElementById(overlayId)) return;

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = overlayId;
        overlay.style.zIndex = '2000';
        overlay.innerHTML =
            '<div class="flasky-palette" role="dialog" aria-label="Command palette">' +
              '<div class="flasky-palette-input-row">' +
                '<span class="flasky-palette-mode-badge" id="flasky-palette-mode">Notes</span>' +
                '<input type="text" id="flasky-palette-input" class="modal-input" autocomplete="off" spellcheck="false">' +
                '<button class="modal-close" data-palette-action="close" aria-label="Close">' +
                  '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button>' +
              '</div>' +
              '<div id="flasky-palette-results" class="flasky-palette-results"></div>' +
              '<div class="flasky-palette-footer">' +
                '<span class="flasky-palette-modes">' +
                  '<kbd>&gt;</kbd> commands' +
                  '<kbd>[[</kbd> links' +
                  '<kbd>Tab</kbd> switch' +
                '</span>' +
                '<span class="flasky-palette-keys">' +
                  '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> Navigate</span>' +
                  '<span><kbd>Enter</kbd> Open</span>' +
                  '<span><kbd>Esc</kbd> Close</span>' +
                '</span>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
            var closeBtn = e.target.closest('[data-palette-action="close"]');
            if (closeBtn) close();
            var item = e.target.closest('[data-palette-item-id]');
            if (item) { selectIndex(parseInt(item.dataset.paletteItemId)); trigger(); }
        });

        inputEl = document.getElementById('flasky-palette-input');
        inputEl.addEventListener('input', function () { onInput(); });

        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault(); e.stopPropagation();
                if (items.length) selectedIndex = (selectedIndex + 1) % items.length;
                renderResults();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault(); e.stopPropagation();
                if (items.length) selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                renderResults();
            } else if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                trigger();
            } else if (e.key === 'Tab') {
                e.preventDefault(); e.stopPropagation();
                cycleMode(e.shiftKey ? -1 : 1);
            }
        });
    }

    function _detectMode(value) {
        if (value.indexOf('>') === 0) return MODE_COMMANDS;
        if (value.indexOf('[[') === 0) return MODE_LINKS;
        return MODE_NOTES;
    }

    function _queryForMode(value, mode) {
        if (mode === MODE_COMMANDS) return value.substring(1).replace(/^\s+/, '');
        if (mode === MODE_LINKS) return value.substring(2).replace(/^\s+/, '');
        return value;
    }

    function onInput() {
        var value = inputEl.value;
        var newMode = _detectMode(value);
        if (newMode !== currentMode) {
            currentMode = newMode;
            var badge = document.getElementById('flasky-palette-mode');
            if (badge) badge.textContent = MODE_META[newMode].hint;
            inputEl.placeholder = MODE_META[newMode].placeholder;
        }
        var query = _queryForMode(value, currentMode);
        scheduleSearch(query);
    }

    function cycleMode(direction) {
        var order = [MODE_NOTES, MODE_COMMANDS, MODE_LINKS];
        var idx = order.indexOf(currentMode);
        var next = order[(idx + direction + order.length) % order.length];
        var query = _queryForMode(inputEl.value, currentMode);
        var sigil = MODE_META[next].sigil;
        inputEl.value = sigil ? sigil + (sigil === '[[' ? '' : ' ') + query : query;
        inputEl.focus();
        var vlen = inputEl.value.length;
        inputEl.setSelectionRange(vlen, vlen);
        onInput();
    }

    function scheduleSearch(query) {
        clearTimeout(searchTimer);
        if (currentMode === MODE_NOTES && !query) {
            items = []; selectedIndex = -1; renderEmptyState(); return;
        }
        if ((currentMode === MODE_COMMANDS || currentMode === MODE_LINKS) && !query) {
            runSearch('');
            return;
        }
        var resultsEl = document.getElementById('flasky-palette-results');
        if (currentMode === MODE_NOTES && resultsEl) {
            resultsEl.innerHTML = '<div class="flasky-palette-empty">Searching\u2026</div>';
        }
        searchTimer = setTimeout(function () { runSearch(query); }, 180);
    }

    async function runSearch(query) {
        var seq = ++searchSeq;
        try {
            var resultItems;
            if (currentMode === MODE_NOTES) {
                resultItems = await searchNotes(query);
            } else if (currentMode === MODE_COMMANDS) {
                resultItems = searchCommands(query);
            } else {
                resultItems = await searchLinks(query);
            }
            if (seq !== searchSeq) return;
            items = resultItems;
            selectedIndex = items.length > 0 ? 0 : -1;
            renderResults();
        } catch (e) {
            if (seq !== searchSeq) return;
            var resultsEl = document.getElementById('flasky-palette-results');
            if (resultsEl) resultsEl.innerHTML = '<div class="flasky-palette-empty">Search failed</div>';
        }
    }

    async function searchNotes(query) {
        if (typeof FlaskySearch === 'undefined') return [];
        var r = await FlaskySearch.search(query);
        return r.map(function (n) {
            return {
                kind: 'note',
                id: n.id,
                title: n.title || 'Untitled',
                category: n.category || '',
                snippet: n.snippet || '',
                matchedIn: n.matchedIn,
                relativeDate: n.relativeDate || ''
            };
        });
    }

    function searchCommands(query) {
        if (typeof FlaskyCommands === 'undefined') return [];
        var context = openCtx.editor ? 'editor' : 'other';
        var all = FlaskyCommands.getCommands(context, { aiEnabled: !!openCtx.aiEnabled });
        var filtered = FlaskyCommands.filter(all, query);
        return filtered.map(function (cmd) {
            return { kind: 'command', id: cmd.id, label: cmd.label, icon: cmd.icon, hint: cmd.hint, run: cmd.run };
        });
    }

    async function searchLinks(query) {
        if (typeof FlaskySearch === 'undefined') return [];
        if (!FlaskySearch.getIndex()) await FlaskySearch.buildIndex();
        var idx = FlaskySearch.getIndex() || [];
        var q = (query || '').toLowerCase();
        var matched = [];
        for (var i = 0; i < idx.length; i++) {
            var n = idx[i];
            if (!q || (n.title || '').toLowerCase().indexOf(q) !== -1) {
                matched.push({ kind: 'link', id: n.id, title: n.title || 'Untitled', category: n.category || '' });
            }
            if (matched.length >= 50) break;
        }
        matched.sort(function (a, b) {
            if (!q) return 0;
            var at = (a.title || '').toLowerCase().indexOf(q);
            var bt = (b.title || '').toLowerCase().indexOf(q);
            if (at !== bt) return at - bt;
            return (a.title || '').localeCompare(b.title || '');
        });
        return matched;
    }

    function selectIndex(i) {
        if (i < 0 || i >= items.length) return;
        selectedIndex = i;
        renderResults();
    }

    function trigger() {
        if (selectedIndex < 0 || !items[selectedIndex]) return;
        var item = items[selectedIndex];
        var ctx = { editor: openCtx.editor, page: openCtx.editor ? 'editor' : 'other', insertCallback: openCtx.insertCallback };
        if (item.kind === 'note') {
            close();
            window.location.href = '/note/' + item.id;
        } else if (item.kind === 'command') {
            close();
            if (typeof item.run === 'function') item.run(ctx);
        } else if (item.kind === 'link') {
            if (ctx.editor && typeof ctx.insertCallback === 'function') {
                close();
                ctx.insertCallback(item.title);
            } else {
                close();
                window.location.href = '/note/' + item.id;
            }
        }
    }

    function renderEmptyState() {
        var container = document.getElementById('flasky-palette-results');
        if (!container) return;
        container.innerHTML =
            '<div class="flasky-palette-hintbox">' +
              '<div class="flasky-palette-hintbox-title">Quick switcher &amp; command palette</div>' +
              '<div class="flasky-palette-hintbox-row"><kbd>&gt;</kbd> Run commands <span class="flasky-palette-hintbox-sub">e.g. <kbd>&gt;dark</kbd>, <kbd>&gt;new</kbd></span></div>' +
              '<div class="flasky-palette-hintbox-row"><kbd>[[</kbd> Insert a wikilink or open a note <span class="flasky-palette-hintbox-sub">e.g. <kbd>[[mee</kbd></span></div>' +
              '<div class="flasky-palette-hintbox-row"><kbd>Tab</kbd> Cycle modes &nbsp; <kbd>\u2191</kbd><kbd>\u2193</kbd> Navigate &nbsp; <kbd>Enter</kbd> Open</div>' +
              '<div class="flasky-palette-hintbox-sub-full">Just start typing to search notes by title and content.</div>' +
            '</div>';
    }

    function renderResults() {
        var container = document.getElementById('flasky-palette-results');
        if (!container) return;
        if (items.length === 0) {
            var empty = currentMode === MODE_NOTES ? 'No matching notes'
                       : currentMode === MODE_COMMANDS ? 'No matching commands'
                       : 'No matching notes';
            container.innerHTML = '<div class="flasky-palette-empty">' + empty + '</div>';
            return;
        }
        var html = '';
        items.forEach(function (item, i) {
            var sel = i === selectedIndex ? ' selected' : '';
            if (item.kind === 'note') {
                html += '<div class="flasky-palette-item note' + sel + '" data-palette-item-id="' + i + '">';
                html += '<div class="flasky-palette-item-main">';
                html += '<span class="flasky-palette-item-title">' + escapeHtml(item.title) + '</span>';
                if (item.matchedIn) html += '<span class="flasky-palette-badge badge-' + escapeHtml(item.matchedIn) + '">' + escapeHtml(item.matchedIn) + '</span>';
                html += '</div>';
                if (item.snippet) html += '<div class="flasky-palette-snippet">' + escapeHtml(item.snippet) + '</div>';
                html += '<div class="flasky-palette-meta">';
                html += '<span class="flasky-palette-cat">' + escapeHtml(item.category || 'Default') + '</span>';
                if (item.relativeDate) html += '<span class="flasky-palette-date">' + escapeHtml(item.relativeDate) + '</span>';
                html += '</div></div>';
            } else if (item.kind === 'command') {
                html += '<div class="flasky-palette-item command' + sel + '" data-palette-item-id="' + i + '">';
                html += '<span class="flasky-palette-icon">' + escapeHtml(item.icon || '\u25CF') + '</span>';
                html += '<span class="flasky-palette-item-title">' + escapeHtml(item.label) + '</span>';
                if (item.hint) html += '<span class="flasky-palette-hint">' + escapeHtml(item.hint) + '</span>';
                html += '</div>';
            } else {
                html += '<div class="flasky-palette-item link' + sel + '" data-palette-item-id="' + i + '">';
                html += '<span class="flasky-palette-icon">[[</span>';
                html += '<span class="flasky-palette-item-title">' + escapeHtml(item.title) + '</span>';
                if (item.category) html += '<span class="flasky-palette-cat">' + escapeHtml(item.category) + '</span>';
                html += '</div>';
            }
        });
        container.innerHTML = html;
        var selEl = container.children[selectedIndex];
        if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    }

    function open(opts) {
        _buildDOM();
        openCtx = opts || {};
        currentMode = MODE_NOTES;
        var overlay = document.getElementById(overlayId);
        overlay.classList.add('visible');
        var badge = document.getElementById('flasky-palette-mode');
        if (badge) badge.textContent = MODE_META[MODE_NOTES].hint;
        inputEl = document.getElementById('flasky-palette-input');
        inputEl.value = '';
        inputEl.placeholder = MODE_META[MODE_NOTES].placeholder;
        inputEl.focus();
        items = []; selectedIndex = -1;
        renderEmptyState();
    }

    function close() {
        searchSeq++;
        var overlay = document.getElementById(overlayId);
        if (overlay) overlay.classList.remove('visible');
        openCtx = {};
    }

    function isOpen() {
        var overlay = document.getElementById(overlayId);
        return overlay && overlay.classList.contains('visible');
    }

    window.FlaskySearchModal = {
        open: open,
        close: close,
        isOpen: isOpen
    };
})();