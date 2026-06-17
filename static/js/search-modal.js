/**
 * Flasky Notes — Reusable Search Modal
 *
 * Provides a self-contained search modal that works on any page.
 * Depends on: sanitize.js (escapeHtml), optionally e2ee-search.js (FlaskySearch) for E2EE users.
 *
 * Usage:
 *   <script src="search-modal.js"></script>
 *   FlaskySearchModal.open();           // open the modal
 *   FlaskySearchModal.close();          // close the modal
 *   FlaskySearchModal.isOpen();         // check if open
 *
 * The modal injects its own DOM on first open, so no HTML boilerplate needed.
 * Results navigate to /note/<id> on click.
 */
(function () {
    'use strict';

    var overlayId = 'flasky-search-overlay';
    var searchTimer = null;
    var searchResults = [];
    var selectedIndex = -1;

    function _buildDOM() {
        if (document.getElementById(overlayId)) return;

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = overlayId;
        overlay.style.zIndex = '2000';
        overlay.innerHTML =
            '<div class="modal-box" style="max-width:520px;width:90%;">' +
              '<div class="modal-header">' +
                '<span class="modal-title">Search Notes</span>' +
                '<button class="modal-close" data-sm-action="close">' +
                  '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button>' +
              '</div>' +
              '<div class="modal-body" style="padding:0;">' +
                '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">' +
                  '<input type="text" id="flasky-search-input" class="modal-input" placeholder="Type to search notes..." autocomplete="off">' +
                '</div>' +
                '<div id="flasky-search-results" style="max-height:400px;overflow-y:auto;"></div>' +
                '<div style="padding:8px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-secondary);display:flex;gap:16px;">' +
                  '<span>Up/Down Navigate</span>' +
                  '<span>Enter Open</span>' +
                  '<span>Esc Close</span>' +
                '</div>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });

        // Input listener
        var input = document.getElementById('flasky-search-input');
        input.addEventListener('input', function () { performSearch(input.value); });

        // Keyboard navigation
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (selectedIndex < searchResults.length - 1) selectedIndex++;
                renderResults();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (selectedIndex > 0) selectedIndex--;
                renderResults();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIndex >= 0 && searchResults[selectedIndex]) {
                    openNote(searchResults[selectedIndex].id);
                }
            }
        });

        // Delegated click on results
        overlay.addEventListener('click', function (e) {
            var item = e.target.closest('[data-sm-note-id]');
            if (item) openNote(parseInt(item.dataset.smNoteId));
            var closeBtn = e.target.closest('[data-sm-action="close"]');
            if (closeBtn) close();
        });
    }

    function openNote(id) {
        close();
        window.location.href = '/note/' + id;
    }

    function performSearch(query) {
        clearTimeout(searchTimer);
        var resultsEl = document.getElementById('flasky-search-results');
        if (!query || query.length < 2) {
            if (resultsEl) resultsEl.innerHTML = '';
            searchResults = [];
            selectedIndex = -1;
            return;
        }
        if (resultsEl) resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px">Searching...</div>';
        searchTimer = setTimeout(async function () {
            try {
                var results;
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted() && typeof FlaskySearch !== 'undefined') {
                    var r = await FlaskySearch.search(query);
                    results = r.map(function (n) { return { id: n.id, title: n.title, category: '' }; });
                } else {
                    var resp = await fetch('/api/search_notes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: query })
                    });
                    results = await resp.json();
                    if (results && results.client_side) results = [];
                }
                searchResults = results || [];
                selectedIndex = searchResults.length > 0 ? 0 : -1;
                renderResults();
            } catch (e) {
                if (resultsEl) resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px">Search failed</div>';
            }
        }, 200);
    }

    function renderResults() {
        var container = document.getElementById('flasky-search-results');
        if (!container) return;
        if (searchResults.length === 0) {
            container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px">No results</div>';
            return;
        }
        var html = '';
        searchResults.forEach(function (note, i) {
            var sel = i === selectedIndex ? ' background: var(--bg-hover);' : '';
            html += '<div data-sm-note-id="' + note.id + '" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);' + sel + '">';
            html += '<div style="font-size:13px;font-weight:500;color:var(--text-primary);">' + escapeHtml(note.title || 'Untitled') + '</div>';
            if (note.category) html += '<div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(note.category) + '</div>';
            html += '</div>';
        });
        container.innerHTML = html;

        // Scroll selected into view
        var selEl = container.children[selectedIndex];
        if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    }

    function open() {
        _buildDOM();
        var overlay = document.getElementById(overlayId);
        overlay.classList.add('visible');
        var input = document.getElementById('flasky-search-input');
        input.value = '';
        input.focus();
        document.getElementById('flasky-search-results').innerHTML = '';
        searchResults = [];
        selectedIndex = -1;
    }

    function close() {
        var overlay = document.getElementById(overlayId);
        if (overlay) overlay.classList.remove('visible');
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