/**
 * Flasky Notes — E2EE Client-Side Search
 *
 * For encrypted users, search cannot happen server-side.
 * This module fetches all notes, decrypts titles+content, and provides
 * a client-side search index.
 */
(function () {
    'use strict';

    var _index = null; // Array of { id, title, content }
    var _building = false;

    /**
     * Build the search index by fetching and decrypting all notes.
     */
    async function buildIndex() {
        if (_building) return _index;
        if (_index) return _index;
        _building = true;

        try {
            var resp = await fetch('/api/get_all_notes');
            var notes = await resp.json();
            if (!Array.isArray(notes)) {
                _building = false;
                return [];
            }

            _index = [];
            // Decrypt in batches to avoid blocking
            for (var i = 0; i < notes.length; i++) {
                var n = notes[i];
                var title = n.title || '';
                var content = n.content || '';
                try {
                    title = await FlaskyE2EE.decryptField(title);
                } catch (e) {}
                try {
                    content = await FlaskyE2EE.decryptField(content);
                } catch (e) {}
                _index.push({
                    id: n.id,
                    title: title || '',
                    content: content || '',
                    category: n.category || '',
                    date_last_changed: n.date_last_changed
                });
            }
        } catch (e) {
            console.error('E2EE search: failed to build index', e);
            _index = [];
        }

        _building = false;
        return _index;
    }

    /**
     * Search the decrypted index for a query string.
     * Returns array of { id, title, content, snippet }.
     */
    async function search(query) {
        if (!_index) await buildIndex();
        if (!query || !_index) return [];

        var q = query.toLowerCase();
        var results = [];
        for (var i = 0; i < _index.length; i++) {
            var n = _index[i];
            var titleMatch = (n.title || '').toLowerCase().indexOf(q) !== -1;
            var contentMatch = (n.content || '').toLowerCase().indexOf(q) !== -1;
            if (titleMatch || contentMatch) {
                var snippet = '';
                if (contentMatch) {
                    var idx = n.content.toLowerCase().indexOf(q);
                    var start = Math.max(0, idx - 40);
                    var end = Math.min(n.content.length, idx + query.length + 40);
                    snippet = (start > 0 ? '...' : '') + n.content.substring(start, end) + (end < n.content.length ? '...' : '');
                }
                results.push({
                    id: n.id,
                    title: n.title,
                    content: n.content,
                    snippet: snippet,
                    titleMatch: titleMatch,
                    contentMatch: contentMatch
                });
            }
        }
        return results;
    }

    /**
     * Invalidate the index (call after save/delete).
     */
    function invalidate() {
        _index = null;
    }

    /**
     * Get the current index (null if not built yet).
     */
    function getIndex() {
        return _index;
    }

    /**
     * Compute backlinks: notes whose content contains [[noteTitle]].
     */
    async function computeBacklinks(noteTitle) {
        if (!_index) await buildIndex();
        if (!noteTitle || !_index) return [];
        var pattern = '[[' + noteTitle + ']]';
        var patternLower = pattern.toLowerCase();
        var results = [];
        for (var i = 0; i < _index.length; i++) {
            var n = _index[i];
            if (n.content && n.content.toLowerCase().indexOf(patternLower) !== -1) {
                results.push({ id: n.id, title: n.title });
            }
        }
        return results;
    }

    /**
     * Compute outbound links from note content.
     */
    async function computeOutboundLinks(content) {
        if (!_index) await buildIndex();
        if (!content || !_index) return [];
        var matches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
        var results = [];
        var seen = {};
        for (var i = 0; i < matches.length; i++) {
            var m = matches[i];
            var title = m.replace(/\[\[/, '').replace(/(\|[^\]]+)?\]\]/, '');
            var key = title.toLowerCase();
            if (seen[key]) continue;
            seen[key] = true;
            var note = _index.find(function(n) { return n.title.toLowerCase() === key; });
            if (note) results.push({ id: note.id, title: note.title });
        }
        return results;
    }

    window.FlaskySearch = {
        buildIndex: buildIndex,
        search: search,
        invalidate: invalidate,
        getIndex: getIndex,
        computeBacklinks: computeBacklinks,
        computeOutboundLinks: computeOutboundLinks
    };
})();
