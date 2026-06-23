/**
 * Client-side search index.
 * Fetches all notes, decrypts titles+content, provides search/backlinks/outbound links.
 */

(function () {
    'use strict';

    var _index = null;
    var _buildPromise = null;

    function buildIndex() {
        if (_index) return Promise.resolve(_index);
        if (_buildPromise) return _buildPromise;
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
            return Promise.resolve([]);
        }
        _buildPromise = _doBuild();
        return _buildPromise;
    }

    async function _doBuild() {
        try {
            var resp = await fetch('/api/get_all_notes');
            var notes = await resp.json();
            if (!Array.isArray(notes)) {
                _buildPromise = null;
                return [];
            }

            _index = [];
            for (var i = 0; i < notes.length; i++) {
                var n = notes[i];
                var title = '';
                var content = '';
                try {
                    title = await FlaskyE2EE.decryptField(n.title || '');
                } catch (e) { title = ''; }
                try {
                    content = await FlaskyE2EE.decryptField(n.content || '');
                } catch (e) { content = ''; }
                if (!title && !content && (n.title || n.content)) continue;
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
            _index = null;
        }

        _buildPromise = null;
        return _index;
    }

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

    function invalidate() {
        _index = null;
        _buildPromise = null;
    }

    function getIndex() {
        return _index;
    }

    function isBuilding() {
        return _buildPromise !== null;
    }

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
        isBuilding: isBuilding,
        computeBacklinks: computeBacklinks,
        computeOutboundLinks: computeOutboundLinks
    };
})();
