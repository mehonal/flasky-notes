/**
 * Client-side search index.
 * Fetches all notes, decrypts titles+content, provides search/backlinks/outbound links.
 *
 * Ranking (descending priority):
 *   - Title starts-with query token    (+1000)
 *   - Title word-prefix match           (+400)
 *   - Title substring                    (+150)
 *   - Content match                       (+30)
 *   - "Both" bonus per token              (+10)
 * Recency tiebreaker: notes edited in last 7 days +50, last 30 days +20.
 * Multi-word queries use AND semantics across title+content combined.
 */

(function () {
    'use strict';

    var _index = null;
    var _buildPromise = null;

    var MAX_RESULTS = 50;
    var SNIPPET_RADIUS = 40;

    function buildIndex() {
        if (_index) return Promise.resolve(_index);
        if (_buildPromise) return _buildPromise;
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
            return Promise.resolve([]);
        }
        _buildPromise = _doBuild();
        _buildPromise.then(function() { _buildPromise = null; }, function() { _buildPromise = null; });
        return _buildPromise;
    }

    async function _doBuild() {
        try {
            // Prefer the in-memory note store warmed by app.js (decrypted once on load).
            if (window._noteStore && _noteStoreReady()) {
                _index = [];
                window._noteStore.forEach(function(n) {
                    if (n.title || n.content) {
                        _index.push({
                            id: n.id,
                            title: n.title || '',
                            content: n.content || '',
                            category: n.category || '',
                            date_last_changed: n.date_last_changed
                        });
                    }
                });
                return _index;
            }

            // Fallback: fetch + decrypt all notes in parallel.
            var resp = await fetch('/api/get_all_notes');
            var notes = await resp.json();
            if (!Array.isArray(notes)) {
                return [];
            }

            _index = [];
            await FlaskyE2EE.decryptObjects(notes, ['title', 'content', 'category']);
            for (var i = 0; i < notes.length; i++) {
                var n = notes[i];
                var title = n.title || '';
                var content = n.content || '';
                var category = n.category || '';
                if (!title && !content) continue;
                _index.push({
                    id: n.id,
                    title: title,
                    content: content,
                    category: category,
                    date_last_changed: n.date_last_changed
                });
            }
        } catch (e) {
            console.error('E2EE search: failed to build index', e);
            _index = null;
        }

        return _index;
    }

    function _noteStoreReady() {
        return window._noteStore && window._noteStore.size > 0;
    }

    function _tokenize(query) {
        return query.toLowerCase().split(/\s+/).filter(Boolean);
    }

    function _scoreToken(token, titleLower, contentLower) {
        var hit = { score: 0, inTitle: false, inContent: false, titlePos: -1, contentPos: -1 };

        var tp = titleLower.indexOf(token);
        if (tp !== -1) {
            hit.inTitle = true;
            hit.titlePos = tp;
            if (tp === 0) hit.score += 1000;
            else if (_isWordPrefix(titleLower, token, tp)) hit.score += 400;
            else hit.score += 150;
        }

        var cp = contentLower.indexOf(token);
        if (cp !== -1) {
            hit.inContent = true;
            hit.contentPos = cp;
            if (!hit.inTitle) hit.score += 30;
            else hit.score += 10;
        }
        return hit;
    }

    function _isWordPrefix(text, token, pos) {
        if (pos === 0) return true;
        var prev = text.charAt(pos - 1);
        return /\s|\p{P}/u.test(prev);
    }

    function _snippet(content, contentLower, tokens) {
        if (!content) return '';
        var bestPos = -1;
        for (var i = 0; i < tokens.length; i++) {
            var p = contentLower.indexOf(tokens[i]);
            if (p !== -1 && (bestPos === -1 || p < bestPos)) bestPos = p;
        }
        if (bestPos === -1) return '';
        var start = Math.max(0, bestPos - SNIPPET_RADIUS);
        var end = Math.min(content.length, bestPos + SNIPPET_RADIUS);
        var prefix = start > 0 ? '\u2026' : '';
        var suffix = end < content.length ? '\u2026' : '';
        var text = content.substring(start, end).replace(/\s+/g, ' ').trim();
        return prefix + text + suffix;
    }

    function _recencyBonus(dateLastChanged) {
        if (!dateLastChanged) return 0;
        var ts = Date.parse(dateLastChanged);
        if (isNaN(ts)) return 0;
        var days = (Date.now() - ts) / 86400000;
        if (days < 7) return 50;
        if (days < 30) return 20;
        return 0;
    }

    function _relativeDate(dateLastChanged) {
        if (!dateLastChanged) return '';
        var ts = Date.parse(dateLastChanged);
        if (isNaN(ts)) return '';
        var days = Math.floor((Date.now() - ts) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 7) return days + 'd ago';
        if (days < 30) return Math.floor(days / 7) + 'w ago';
        if (days < 365) return Math.floor(days / 30) + 'mo ago';
        return Math.floor(days / 365) + 'y ago';
    }

    async function search(query) {
        if (!_index) await buildIndex();
        if (!query || !_index) return [];

        var tokens = _tokenize(query);
        if (tokens.length === 0) return [];

        var scored = [];
        for (var i = 0; i < _index.length; i++) {
            var n = _index[i];
            var titleLower = (n.title || '').toLowerCase();
            var contentLower = (n.content || '').toLowerCase();

            var totalScore = 0;
            var matchedInTitle = false;
            var matchedInContent = false;
            var allTokensHit = true;

            for (var t = 0; t < tokens.length; t++) {
                var hit = _scoreToken(tokens[t], titleLower, contentLower);
                if (hit.score === 0) { allTokensHit = false; break; }
                totalScore += hit.score;
                if (hit.inTitle) matchedInTitle = true;
                if (hit.inContent) matchedInContent = true;
            }

            if (!allTokensHit) continue;

            totalScore += _recencyBonus(n.date_last_changed);

            var matchedIn = matchedInTitle && matchedInContent ? 'both'
                          : matchedInTitle ? 'title'
                          : 'content';

            scored.push({
                id: n.id,
                title: n.title || '',
                category: n.category || '',
                snippet: _snippet(n.content || '', contentLower, tokens),
                score: totalScore,
                matchedIn: matchedIn,
                date_last_changed: n.date_last_changed,
                relativeDate: _relativeDate(n.date_last_changed)
            });
        }

        scored.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
        });

        if (scored.length > MAX_RESULTS) scored.length = MAX_RESULTS;
        return scored;
    }

    function invalidate() {
        _index = null;
        _buildPromise = null;
    }

    function updateNote(note) {
        if (!_index) return;
        var id = note.id;
        for (var i = 0; i < _index.length; i++) {
            if (_index[i].id === id) {
                if (typeof note.title === 'string') _index[i].title = note.title;
                if (typeof note.content === 'string') _index[i].content = note.content;
                if (typeof note.category === 'string') _index[i].category = note.category;
                if (note.date_last_changed) _index[i].date_last_changed = note.date_last_changed;
                return;
            }
        }
        if (typeof note.title === 'string' && typeof note.content === 'string') {
            _index.push({
                id: id,
                title: note.title,
                content: note.content,
                category: note.category || '',
                date_last_changed: note.date_last_changed || null
            });
        }
    }

    function deleteNote(id) {
        if (!_index) return;
        for (var i = 0; i < _index.length; i++) {
            if (_index[i].id === id) { _index.splice(i, 1); return; }
        }
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
        updateNote: updateNote,
        deleteNote: deleteNote,
        getIndex: getIndex,
        isBuilding: isBuilding,
        computeBacklinks: computeBacklinks,
        computeOutboundLinks: computeOutboundLinks
    };
})();