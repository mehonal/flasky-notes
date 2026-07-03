/**
 * wiki-link support for marked.js.
 * Resolves [[note-title]] to note links and ![[file.png]] to embedded attachments.
 * Requires a preloaded noteMap from /api/note-map.
 */

(function () {
    var noteMap = null;
    var attachmentMap = null;
    var _originalMarked = window.marked;
    var _pendingBuild = null;

    // Max render widths for embedded attachments / drawings. Set from app.js
    // via _setEmbedMaxWidths() using values from the page-data block. Values
    // are normalized CSS strings ("300px", "50%") or null (= full width).
    var _attachmentMaxWidth = null;
    var _drawingMaxWidth = null;

    function _resolveWidth(val) {
        val = String(val || '').trim();
        if (!val || val === '0') return null;
        if (val.endsWith('%')) return val;
        if (val.endsWith('px')) return val;
        return val + 'px';
    }

    window._setEmbedMaxWidths = function (img, draw) {
        _attachmentMaxWidth = _resolveWidth(img);
        _drawingMaxWidth = _resolveWidth(draw);
    };
    window._getEmbedMaxWidths = function () {
        return { img: _attachmentMaxWidth, draw: _drawingMaxWidth };
    };

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
                _buildEncryptedNoteMap(data.notes || [], data.attachments || [], callback);
            } else {
                noteMap = {};
                attachmentMap = {};
                callback();
            }
        };
        xhr.onerror = function () {
            noteMap = {};
            attachmentMap = {};
            callback();
        };
        xhr.send();
    }

    async function _buildEncryptedNoteMap(notesList, attList, callback) {
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
            _pendingBuild = { notes: notesList, atts: attList, callback: callback };
            return;
        }

        noteMap = {};
        attachmentMap = {};

        for (var i = 0; i < notesList.length; i++) {
            try {
                var decTitle = await FlaskyE2EE.decryptField(notesList[i].title);
                if (decTitle) {
                    noteMap[decTitle.toLowerCase()] = { id: notesList[i].id, title: decTitle };
                }
            } catch (e) {}
        }

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

    function _flushPending() {
        if (!_pendingBuild) return;
        var p = _pendingBuild;
        _pendingBuild = null;
        _buildEncryptedNoteMap(p.notes, p.atts, p.callback);
    }

    function resolveWikiLinks(html) {
        if (!noteMap) return html;

        html = html.replace(/!\[\[([^\]]+)\]\]/g, function (match, name) {
            var key = name.toLowerCase().trim();
            var att = attachmentMap[key];
            if (att) {
                var url = '/attachment/' + att.id + '/' + encodeURIComponent(att.filename);
                if (att.filename.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i)) {
                    return '<img data-encrypted-src="' + url + '" data-att-filename="' + att.filename + '" alt="' + name + '" style="max-width:' + (_attachmentMaxWidth || '100%') + '" class="e2ee-attachment">';
                } else if (att.filename.match(/\.(mp4|webm|ogg)$/i)) {
                    return '<video controls data-encrypted-src="' + url + '" class="e2ee-attachment" style="max-width:' + (_attachmentMaxWidth || '100%') + '"></video>';
                } else if (att.filename.match(/\.(mp3|wav|flac|m4a)$/i)) {
                    return '<audio controls data-encrypted-src="' + url + '" class="e2ee-attachment"></audio>';
                } else if (att.filename.match(/\.pdf$/i)) {
                    return '<a href="' + url + '" target="_blank">' + name + '</a>';
                } else if (att.filename.match(/\.fldraw$/i)) {
                    return '<div class="fldraw-render" data-encrypted-src="' + url + '" data-att-id="' + att.id + '" data-att-filename="' + att.filename + '" data-action="edit-fldraw" style="max-width:' + (_drawingMaxWidth || '100%') + '"></div>';
                }
                return '<a href="' + url + '">' + name + '</a>';
            }
            return match;
        });

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

    async function decryptAttachmentElements(container) {
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) return;
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
        // .fldraw render elements — decrypt, parse JSON, draw to canvas.
        // The placeholder is a bare <div> (DOMPurify strips <canvas>); we
        // create the canvas here once the bytes are available.
        var fldraws = (container || document).querySelectorAll('.fldraw-render[data-encrypted-src]');
        for (var k = 0; k < fldraws.length; k++) {
            var fEl = fldraws[k];
            var fUrl = fEl.getAttribute('data-encrypted-src');
            if (!fUrl) continue;
            fEl.removeAttribute('data-encrypted-src');
            try {
                var fResp = await fetch(fUrl);
                var fEnc = await fResp.arrayBuffer();
                var fDec = await FlaskyE2EE.decryptBlob(new Uint8Array(fEnc));
                var fText = new TextDecoder().decode(new Uint8Array(fDec));
                var doc = window._parseFldraw ? window._parseFldraw(fText) : JSON.parse(fText);
                if (doc && doc.strokes) {
                    var cEl = document.createElement('canvas');
                    fEl.appendChild(cEl);
                    if (window._renderFldrawToCanvas) {
                        window._renderFldrawToCanvas(cEl, doc.strokes, doc.w || 0, doc.h || 0);
                    }
                }
            } catch (e) {
                console.warn('E2EE: failed to decrypt .fldraw', fUrl, e);
            }
        }
    }

    window.markedWithWikiLinks = function (text) {
        var html = _originalMarked(text);
        return resolveWikiLinks(html);
    };

    window._decryptAttachments = decryptAttachmentElements;
    window._flushPendingNoteMap = _flushPending;

    // Expose the resolved attachment/note maps so the CM6 edit-mode embed
    // widget can resolve ![[file]] to an attachment id+url without re-fetching
    // and re-decrypting the whole map. Returns null until the map is built.
    window._getAttachmentMap = function () {
        return attachmentMap ? { attachments: attachmentMap, notes: noteMap } : null;
    };

    window._invalidateNoteMap = function() {
        noteMap = null;
        attachmentMap = null;
        _pendingBuild = null;
        window._wikiLinksReady = false;
        loadNoteMap(function() {
            window._wikiLinksReady = true;
            document.dispatchEvent(new Event('wikiLinksReady'));
            document.dispatchEvent(new Event('noteMapUpdated'));
        });
    };

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
