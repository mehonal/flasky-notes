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
    var _loadPromise = null;
    var _loadResolve = null;
    var _loadXhr = null;

    // Cache decrypted blob URLs by attachment id so re-renders (CM6 live
    // preview widgets being torn down and rebuilt as the cursor moves on/off
    // their line) don't re-fetch + re-decrypt the same bytes. Each entry is a
    // blob: URL that stays valid for the page lifetime.
    var _blobUrlCache = {};

    function _mimeForFilename(filename) {
        if (filename.match(/\.(png)$/i)) return 'image/png';
        if (filename.match(/\.(jpg|jpeg)$/i)) return 'image/jpeg';
        if (filename.match(/\.(gif)$/i)) return 'image/gif';
        if (filename.match(/\.(svg)$/i)) return 'image/svg+xml';
        if (filename.match(/\.(webp)$/i)) return 'image/webp';
        if (filename.match(/\.(mp4)$/i)) return 'video/mp4';
        if (filename.match(/\.(webm)$/i)) return 'video/webm';
        if (filename.match(/\.(mp3)$/i)) return 'audio/mpeg';
        if (filename.match(/\.(wav)$/i)) return 'audio/wav';
        if (filename.match(/\.(flac)$/i)) return 'audio/flac';
        if (filename.match(/\.(m4a)$/i)) return 'audio/mp4';
        if (filename.match(/\.(weba|opus)$/i)) return 'audio/webm';
        if (filename.match(/\.(ogg)$/i)) return 'audio/ogg';
        return 'application/octet-stream';
    }

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
        if (_loadPromise) {
            _loadPromise.then(callback);
            return _loadPromise;
        }
        var myPromise = new Promise(function(resolve) {
            _loadResolve = resolve;
            var xhr = new XMLHttpRequest();
            _loadXhr = xhr;
            xhr.open('GET', '/api/note-map');
            xhr.onload = function () {
                if (_loadXhr !== xhr) return;
                if (xhr.status === 200) {
                    var data = JSON.parse(xhr.responseText);
                    _buildEncryptedNoteMap(data.notes || [], data.attachments || [], function() {
                        if (_loadPromise === myPromise) { _loadPromise = null; _loadResolve = null; }
                        if (_loadXhr === xhr) _loadXhr = null;
                        resolve();
                        callback();
                    });
                } else {
                    noteMap = {};
                    attachmentMap = {};
                    if (_loadPromise === myPromise) { _loadPromise = null; _loadResolve = null; }
                    if (_loadXhr === xhr) _loadXhr = null;
                    resolve();
                    callback();
                }
            };
            xhr.onerror = function () {
                if (_loadXhr !== xhr) return;
                noteMap = {};
                attachmentMap = {};
                if (_loadPromise === myPromise) { _loadPromise = null; _loadResolve = null; }
                if (_loadXhr === xhr) _loadXhr = null;
                resolve();
                callback();
            };
            xhr.send();
        });
        _loadPromise = myPromise;
        return _loadPromise;
    }

    async function _buildEncryptedNoteMap(notesList, attList, callback) {
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
            _pendingBuild = { notes: notesList, atts: attList, callback: callback, resolve: _loadResolve, promise: _loadPromise };
            _loadResolve = null;
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

        // Hydrate the shared attachment index so the sidebar virtual folder
        // (and any other consumer) can reuse this decrypted data without a
        // second /api/note-map fetch.
        if (window.FlaskyAttachments && typeof window.FlaskyAttachments.hydrate === 'function') {
            var attIdx = [];
            for (var k in attachmentMap) {
                if (attachmentMap[k]) attIdx.push({ id: attachmentMap[k].id, name: attachmentMap[k].filename });
            }
            window.FlaskyAttachments.hydrate(attIdx);
        }

        callback();
    }

    function _flushPending() {
        if (!_pendingBuild) return;
        var p = _pendingBuild;
        var pendingResolve = p.resolve;
        var pendingPromise = p.promise;
        _pendingBuild = null;
        _buildEncryptedNoteMap(p.notes, p.atts, function() {
            if (pendingResolve) pendingResolve();
            if (_loadPromise === pendingPromise) { _loadPromise = null; _loadResolve = null; }
            p.callback();
        });
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
                } else if (att.filename.match(/\.(mp4|webm)$/i)) {
                    return '<video controls data-encrypted-src="' + url + '" class="e2ee-attachment" style="max-width:' + (_attachmentMaxWidth || '100%') + '"></video>';
                } else if (att.filename.match(/\.(mp3|wav|flac|m4a|weba|opus|ogg)$/i)) {
                    return window.FlaskyAudioPlayer ? window.FlaskyAudioPlayer.html(att) : '<audio controls data-encrypted-src="' + url + '" class="e2ee-attachment"></audio>';
                } else if (att.filename.match(/\.pdf$/i)) {
                    return '<a href="' + url + '" target="_blank">' + name + '</a>';
                } else if (att.filename.match(/\.fldraw$/i)) {
                    return '<div class="fldraw-render" data-encrypted-src="' + url + '" data-att-id="' + att.id + '" data-att-filename="' + att.filename + '" data-action="edit-fldraw" style="max-width:' + (_drawingMaxWidth || '100%') + '"></div>';
                }
                return '<a href="' + url + '" target="_blank">' + name + '</a>';
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
            // Derive attachment id from the URL (/attachment/<id>/...) so we
            // can cache the decrypted blob URL and reuse it across re-renders
            // (CM6 live-preview widgets are destroyed/recreated when the
            // cursor enters/leaves their line — without caching each re-render
            // would re-fetch + re-decrypt the same bytes).
            var attId = null;
            var m = url.match(/\/attachment\/(\d+)\//);
            if (m) attId = m[1];
            try {
                var blobUrl = attId ? _blobUrlCache[attId] : null;
                if (!blobUrl) {
                    var resp = await fetch(url);
                    var encryptedData = await resp.arrayBuffer();
                    var decrypted = await FlaskyE2EE.decryptBlob(new Uint8Array(encryptedData));
                    var filename = el.getAttribute('data-att-filename') || '';
                    var mime = _mimeForFilename(filename);
                    var blob = new Blob([decrypted], { type: mime });
                    blobUrl = URL.createObjectURL(blob);
                    if (attId) _blobUrlCache[attId] = blobUrl;
                }
                el.src = blobUrl;
            } catch (e) {
                console.warn('E2EE: failed to decrypt attachment', url, e);
            }
        }
        if (window.FlaskyAudioPlayer) window.FlaskyAudioPlayer.init(container);
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

    // Look up a cached blob URL for an attachment id (or null if not yet
    // decrypted). Used by the CM6 audio widget to restore playback position
    // synchronously on re-render without waiting for the async decrypt pass.
    window._getCachedBlobUrl = function (attId) {
        return attId != null ? _blobUrlCache[String(attId)] || null : null;
    };
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
        if (_loadXhr) { try { _loadXhr.abort(); } catch(e) {} _loadXhr = null; }
        if (_loadResolve) { _loadResolve(); _loadResolve = null; }
        _loadPromise = null;
        // Revoke cached blob URLs so they don't outlive the attachments they
        // point to (attachments can be deleted / replaced between notes).
        Object.keys(_blobUrlCache).forEach(function (k) {
            try { URL.revokeObjectURL(_blobUrlCache[k]); } catch (e) {}
        });
        _blobUrlCache = {};
        // Also clear the cached audio players (their blob srcs are about to
        // be revoked by the loop above, so any playing audio should stop and
        // the player elements be discarded).
        if (window.FlaskyAudioPlayer) window.FlaskyAudioPlayer.clearCache();
        if (window.FlaskyAttachments && typeof window.FlaskyAttachments.invalidateAttachmentIndex === 'function') {
            window.FlaskyAttachments.invalidateAttachmentIndex();
        }
        window._wikiLinksReady = false;
        loadNoteMap(function() {
            window._wikiLinksReady = true;
            document.dispatchEvent(new Event('wikiLinksReady'));
            document.dispatchEvent(new Event('noteMapUpdated'));
        });
    };

    window._updateNoteMapEntry = function(id, oldTitle, newTitle) {
        if (!noteMap) return;
        if (oldTitle) delete noteMap[oldTitle.toLowerCase()];
        if (newTitle) noteMap[newTitle.toLowerCase()] = { id: id, title: newTitle };
    };

    window._deleteNoteMapEntry = function(id, title) {
        if (!noteMap) return;
        if (title) delete noteMap[title.toLowerCase()];
        else {
            for (var k in noteMap) {
                if (noteMap[k] && noteMap[k].id === id) { delete noteMap[k]; return; }
            }
        }
    };

    window._getNoteMap = function() {
        return noteMap;
    };

    loadNoteMap(function () {
        var orig = window.marked;
        var origParse = (typeof orig.parse === 'function') ? orig.parse : orig;
        var wrapper = function (text) {
            return resolveWikiLinks(origParse(text));
        };
        // Preserve the original API so marked.parse(...) / marked.setOptions(...) callers keep working after the swap.
        Object.keys(orig).forEach(function (k) {
            if (!(k in wrapper)) wrapper[k] = orig[k];
        });
        wrapper.parse = function (text) { return resolveWikiLinks(origParse(text)); };
        window.marked = wrapper;
        window._wikiLinksReady = true;
        document.dispatchEvent(new Event('wikiLinksReady'));
    });
})();
