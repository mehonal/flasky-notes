/**
 * Shared, cached attachment index for the current user.
 *
 * The server stores attachment filenames as E2EE ciphertext and has no mime
 * info, so the decrypted filename + its extension are the only basis for
 * classification (Images / Videos / Drawings / Other). This module owns the
 * single /api/note-map fetch + decryption of the attachments array and
 * exposes a cached [{id, name}] list plus mime/extension helpers. Both
 * wikilinks.js (embed resolution) and app.js (virtual sidebar folder)
 * consume it so the work happens once per page load.
 *
 * Lifecycle: loadAttachmentIndex() returns a promise that resolves to the
 * cached list. invalidateAttachmentIndex() forces a re-fetch (e.g. after an
 * upload). The map keyed by lowercase name (attachmentMap) is also exposed
 * for wikilinks.js embed resolution.
 */
(function () {
    var _index = null;        // [{id, name}] (decrypted), or [] when loaded but empty
    var _map = null;          // { lowercaseName: {id, name} }
    var _promise = null;      // in-flight fetch promise

    var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'];
    var VIDEO_EXTS = ['mp4', 'webm', 'ogg'];
    var DRAWING_EXTS = ['fldraw'];

    function _ext(name) {
        if (!name) return '';
        var dot = name.lastIndexOf('.');
        return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    }

    function _classify(name) {
        var ext = _ext(name);
        if (IMAGE_EXTS.indexOf(ext) >= 0) return 'image';
        if (VIDEO_EXTS.indexOf(ext) >= 0) return 'video';
        if (DRAWING_EXTS.indexOf(ext) >= 0) return 'drawing';
        return 'other';
    }

    // Extension → MIME map (mirrors wikilinks.js decryptAttachmentElements).
    var MIME_BY_EXT = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg',
        mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
        m4a: 'audio/mp4', pdf: 'application/pdf',
    };

    function mimeForName(name) {
        return MIME_BY_EXT[_ext(name)] || 'application/octet-stream';
    }

    /**
     * Fetch /api/note-map, decrypt the attachments array, cache the result.
     * Returns a promise resolving to [{id, name}]. Safe to call repeatedly;
     * concurrent callers share the in-flight promise.
     */
    function loadAttachmentIndex() {
        if (_index !== null) return Promise.resolve(_index);
        if (_promise) return _promise;
        _promise = new Promise(function (resolve) {
            fetch('/api/note-map').then(function (r) {
                if (!r.ok) { _finish([]); resolve([]); return; }
                return r.json().then(function (data) {
                    var atts = (data && data.attachments) || [];
                    _build(atts, function () {
                        resolve(_index);
                    });
                });
            }).catch(function () {
                _finish([]);
                resolve([]);
            });
        });
        return _promise;
    }

    function _finish(list) {
        _index = list;
        _map = {};
        list.forEach(function (a) { _map[a.name.toLowerCase()] = a; });
        _promise = null;
    }

    function _build(atts, done) {
        if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
            // Not ready yet — defer until e2ee signals readiness.
            _pendingAtts = atts;
            _pendingDone = done;
            return;
        }
        var out = [];
        var remaining = atts.length;
        if (remaining === 0) { _finish(out); done(); return; }
        atts.forEach(function (a) {
            FlaskyE2EE.decryptField(a.filename).then(function (name) {
                if (name) out.push({ id: a.id, name: name });
            }).catch(function () {}).then(function () {
                remaining--;
                if (remaining === 0) { _finish(out); done(); }
            });
        });
    }

    var _pendingAtts = null;
    var _pendingDone = null;

    function flushPending() {
        if (!_pendingAtts) return;
        var atts = _pendingAtts;
        var done = _pendingDone;
        _pendingAtts = null;
        _pendingDone = null;
        _build(atts, done);
    }

    function invalidateAttachmentIndex() {
        _index = null;
        _map = null;
        _promise = null;
        _pendingAtts = null;
        _pendingDone = null;
    }

    function getAttachmentIndex() { return _index; }
    function getAttachmentMap() { return _map; }

    /**
     * Populate the cache from an already-decrypted list (e.g. wikilinks.js
     * decrypts attachments as part of its /api/note-map fetch and hands the
     * result here so the sidebar virtual folder doesn't trigger a second
     * fetch). `list` is [{id, name}] with plaintext names.
     */
    function hydrate(list) {
        _index = list ? list.slice() : [];
        _map = {};
        _index.forEach(function (a) { _map[a.name.toLowerCase()] = a; });
        _promise = null;
        _pendingAtts = null;
        _pendingDone = null;
    }

    window.FlaskyAttachments = {
        loadAttachmentIndex: loadAttachmentIndex,
        invalidateAttachmentIndex: invalidateAttachmentIndex,
        getAttachmentIndex: getAttachmentIndex,
        getAttachmentMap: getAttachmentMap,
        hydrate: hydrate,
        flushPending: flushPending,
        classify: _classify,
        mimeForName: mimeForName,
        ext: _ext,
        IMAGE_EXTS: IMAGE_EXTS,
        VIDEO_EXTS: VIDEO_EXTS,
        DRAWING_EXTS: DRAWING_EXTS,
    };
})();