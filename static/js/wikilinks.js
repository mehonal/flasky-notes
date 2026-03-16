/**
 * Flasky Obsidian Sync — wiki-link support for marked.js
 *
 * Resolves [[note-title]] to note links and ![[file.png]] to embedded attachments.
 * Requires a preloaded noteMap from /api/note-map.
 */

(function () {
    var noteMap = null;
    var attachmentMap = null;
    var _originalMarked = window.marked;

    function loadNoteMap(callback) {
        if (noteMap !== null) {
            callback();
            return;
        }
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/note-map');
        xhr.onload = function () {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                noteMap = data.notes || {};
                attachmentMap = data.attachments || {};
            } else {
                noteMap = {};
                attachmentMap = {};
            }
            callback();
        };
        xhr.onerror = function () {
            noteMap = {};
            attachmentMap = {};
            callback();
        };
        xhr.send();
    }

    function resolveWikiLinks(html) {
        if (!noteMap) return html;

        // ![[filename]] → embedded attachment
        html = html.replace(/!\[\[([^\]]+)\]\]/g, function (match, name) {
            var key = name.toLowerCase().trim();
            var att = attachmentMap[key];
            if (att) {
                var url = '/attachment/' + att.id + '/' + encodeURIComponent(att.filename);
                if (att.filename.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i)) {
                    return '<img src="' + url + '" alt="' + name + '" style="max-width:100%">';
                } else if (att.filename.match(/\.(mp4|webm|ogg)$/i)) {
                    return '<video controls src="' + url + '" style="max-width:100%"></video>';
                } else if (att.filename.match(/\.(mp3|wav|flac|m4a)$/i)) {
                    return '<audio controls src="' + url + '"></audio>';
                } else if (att.filename.match(/\.pdf$/i)) {
                    return '<a href="' + url + '" target="_blank">' + name + '</a>';
                }
                return '<a href="' + url + '">' + name + '</a>';
            }
            return match;
        });

        // [[title]] or [[title|display]] → note link
        html = html.replace(/\[\[([^\]]+)\]\]/g, function (match, inner) {
            var parts = inner.split('|');
            var title = parts[0].trim();
            var display = parts.length > 1 ? parts[1].trim() : title;
            var key = title.toLowerCase();
            var note = noteMap[key];
            if (note) {
                return '<a href="/note/' + note.id + '">' + display + '</a>';
            }
            return '<span class="wikilink-missing" title="Note not found">' + display + '</span>';
        });

        return html;
    }

    // Wrap the global marked() function
    window.markedWithWikiLinks = function (text) {
        var html = _originalMarked(text);
        return resolveWikiLinks(html);
    };

    // Replace global marked once note map is loaded
    loadNoteMap(function () {
        var orig = window.marked;
        window.marked = function (text) {
            var html = orig(text);
            return resolveWikiLinks(html);
        };
        window._wikiLinksReady = true;
        document.dispatchEvent(new Event('wikiLinksReady'));
    });
})();
