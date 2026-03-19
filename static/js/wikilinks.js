/**
 * Flasky Obsidian Sync — wiki-link support for marked.js
 *
 * Resolves [[note-title]] to note links and ![[file.png]] to embedded attachments.
 * Requires a preloaded noteMap from /api/note-map.
 * E2EE-aware: for encrypted users, decrypts titles to build the map client-side.
 */

(function () {
    var noteMap = null;
    var attachmentMap = null;
    var _originalMarked = window.marked;
    var _isEncrypted = false;

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
                if (data.encrypted) {
                    // E2EE: data.notes is an array of {id, title(encrypted)}
                    // We need to decrypt titles and build the map client-side
                    _isEncrypted = true;
                    _buildEncryptedNoteMap(data.notes || [], data.attachments || [], callback);
                    return;
                }
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

    async function _buildEncryptedNoteMap(notesList, attList, callback) {
        noteMap = {};
        attachmentMap = {};

        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isEncrypted()) {
            // Can't decrypt — build map with encrypted titles (won't resolve)
            callback();
            return;
        }

        // Decrypt note titles
        for (var i = 0; i < notesList.length; i++) {
            try {
                var decTitle = await FlaskyE2EE.decryptField(notesList[i].title);
                if (decTitle) {
                    noteMap[decTitle.toLowerCase()] = { id: notesList[i].id, title: decTitle };
                }
            } catch (e) {}
        }

        // Decrypt attachment filenames
        for (var j = 0; j < attList.length; j++) {
            try {
                var decFilename = await FlaskyE2EE.decryptField(attList[j].filename);
                if (decFilename) {
                    attachmentMap[decFilename.toLowerCase()] = { id: attList[j].id, filename: decFilename };
                }
            } catch (e) {}
        }

        callback();
    }

    function resolveWikiLinks(html) {
        if (!noteMap) return html;

        // ![[filename]] → embedded attachment
        html = html.replace(/!\[\[([^\]]+)\]\]/g, function (match, name) {
            var key = name.toLowerCase().trim();
            var att = attachmentMap[key];
            if (att) {
                var url = '/attachment/' + att.id + '/' + encodeURIComponent(att.filename);
                if (_isEncrypted && att.filename.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i)) {
                    // E2EE: use a placeholder that will be decrypted post-render
                    return '<img data-encrypted-src="' + url + '" data-att-filename="' + att.filename + '" alt="' + name + '" style="max-width:100%" class="e2ee-attachment">';
                } else if (att.filename.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i)) {
                    return '<img src="' + url + '" alt="' + name + '" style="max-width:100%">';
                } else if (att.filename.match(/\.(mp4|webm|ogg)$/i)) {
                    if (_isEncrypted) {
                        return '<video controls data-encrypted-src="' + url + '" class="e2ee-attachment" style="max-width:100%"></video>';
                    }
                    return '<video controls src="' + url + '" style="max-width:100%"></video>';
                } else if (att.filename.match(/\.(mp3|wav|flac|m4a)$/i)) {
                    if (_isEncrypted) {
                        return '<audio controls data-encrypted-src="' + url + '" class="e2ee-attachment"></audio>';
                    }
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

    /**
     * Decrypt and display any E2EE attachment elements in the given container.
     * Call after inserting HTML containing .e2ee-attachment elements.
     */
    async function decryptAttachmentElements(container) {
        if (!_isEncrypted || typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isEncrypted()) return;
        var els = (container || document).querySelectorAll('.e2ee-attachment[data-encrypted-src]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var url = el.getAttribute('data-encrypted-src');
            if (!url) continue;
            el.removeAttribute('data-encrypted-src');
            try {
                var resp = await fetch(url);
                var encryptedData = await resp.arrayBuffer();
                var decrypted = await FlaskyE2EE.decryptBlob(new Uint8Array(encryptedData));
                // Guess MIME type from filename attribute
                var filename = el.getAttribute('data-att-filename') || '';
                var mime = 'application/octet-stream';
                if (filename.match(/\.(png)$/i)) mime = 'image/png';
                else if (filename.match(/\.(jpg|jpeg)$/i)) mime = 'image/jpeg';
                else if (filename.match(/\.(gif)$/i)) mime = 'image/gif';
                else if (filename.match(/\.(svg)$/i)) mime = 'image/svg+xml';
                else if (filename.match(/\.(webp)$/i)) mime = 'image/webp';
                else if (filename.match(/\.(mp4)$/i)) mime = 'video/mp4';
                else if (filename.match(/\.(webm)$/i)) mime = 'video/webm';
                else if (filename.match(/\.(mp3)$/i)) mime = 'audio/mpeg';
                else if (filename.match(/\.(wav)$/i)) mime = 'audio/wav';
                var blob = new Blob([decrypted], { type: mime });
                el.src = URL.createObjectURL(blob);
            } catch (e) {
                console.warn('E2EE: failed to decrypt attachment', url, e);
            }
        }
    }

    // Wrap the global marked() function
    window.markedWithWikiLinks = function (text) {
        var html = _originalMarked(text);
        return resolveWikiLinks(html);
    };

    window._decryptAttachments = decryptAttachmentElements;

    // Allow external code to invalidate and re-fetch the note map
    window._invalidateNoteMap = function() {
        noteMap = null;
        attachmentMap = null;
        window._wikiLinksReady = false;
        loadNoteMap(function() {
            window._wikiLinksReady = true;
            document.dispatchEvent(new Event('wikiLinksReady'));
            document.dispatchEvent(new Event('noteMapUpdated'));
        });
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
