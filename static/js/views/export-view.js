/**
 * Flasky Notes — Export view module (SPA).
 *
 * Rendered inside #app-view by the router after fetching _export_view.html.
 * Mirrors the logic that lived inline in templates/export.html. Depends on
 * FlaskyE2EE (loaded in the shell) and JSZip (loaded in the shell).
 */
(function () {
    'use strict';

    var _bound = [];
    var _abortController = null;

    function on(sel, ev, fn) {
        var el = document.querySelector(sel);
        if (!el) return;
        el.addEventListener(ev, fn);
        _bound.push([el, ev, fn]);
    }

    function unbindAll() {
        _bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        _bound = [];
    }

    function init(container) {
        on('#btn-export-decrypted', 'click', function () { startExport(true); });
        on('#btn-export-encrypted', 'click', function () { startExport(false); });
        var backBtn = container.querySelector('[data-action="router-back"]');
        if (backBtn) backBtn.addEventListener('click', function () {
            history.back();
        });
    }

    function destroy() {
        if (_abortController) { try { _abortController.abort(); } catch (e) {} _abortController = null; }
        unbindAll();
    }

    async function startExport(decrypt) {
        var buttons = document.querySelectorAll('#app-view .btn-export');
        var progress = document.querySelector('#app-view #export-progress');
        var status = document.querySelector('#app-view #export-status');
        var bar = document.querySelector('#app-view #export-bar');

        buttons.forEach(function (b) { b.disabled = true; });
        progress.style.display = 'block';
        status.textContent = 'Fetching notes...';
        bar.style.width = '10%';

        _abortController = new AbortController();

        try {
            if (decrypt) {
                var ready = await FlaskyE2EE.init();
                if (!ready) return;
            }

            var resp = await fetch('/api/export/notes', { signal: _abortController.signal });
            var data = await resp.json();
            if (data.error) throw new Error(data.error);

            var notes = data.notes;
            var attachments = data.attachments;
            bar.style.width = '30%';

            if (decrypt) {
                status.textContent = 'Decrypting notes...';
                for (var i = 0; i < notes.length; i++) {
                    var n = notes[i];
                    if (n.title) n.title = await FlaskyE2EE.decryptField(n.title);
                    if (n.content) n.content = await FlaskyE2EE.decryptField(n.content);
                    if (n.properties) n.properties = await FlaskyE2EE.decryptField(n.properties);
                    if (n.category) n.category = await FlaskyE2EE.decryptField(n.category);
                    bar.style.width = (30 + (i / notes.length) * 30) + '%';
                }
            }
            bar.style.width = '60%';
            status.textContent = 'Building zip...';

            var zip = new JSZip();

            for (var i = 0; i < notes.length; i++) {
                var n = notes[i];
                var cat = n.category || 'Uncategorized';
                var title = sanitizeFilename(n.title || 'Untitled');
                var content = buildFullContent(n.content, n.properties);
                zip.file(cat + '/' + title + '.md', content);
            }

            if (attachments.length > 0) {
                status.textContent = 'Fetching attachments...';
                for (var i = 0; i < attachments.length; i++) {
                    var att = attachments[i];
                    try {
                        var attResp = await fetch('/attachment/' + att.id + '/' + encodeURIComponent(att.filename), { signal: _abortController.signal });
                        if (attResp.ok) {
                            var blob = await attResp.arrayBuffer();
                            var fileData = blob;
                            if (decrypt) {
                                var isEnc = attResp.headers.get('X-Encrypted') === 'true';
                                if (isEnc) {
                                    fileData = await FlaskyE2EE.decryptBlob(new Uint8Array(blob));
                                }
                            }
                            var attFilename = att.filename;
                            if (decrypt) {
                                try { attFilename = await FlaskyE2EE.decryptField(att.filename); } catch (e) {}
                            }
                            zip.file('attachments/' + sanitizeFilename(attFilename), fileData);
                        }
                    } catch (e) {
                        console.warn('Failed to fetch attachment', att.id, e);
                    }
                    bar.style.width = (60 + (i / attachments.length) * 30) + '%';
                }
            }

            bar.style.width = '90%';
            status.textContent = 'Compressing...';

            var filename = decrypt ? 'flasky-notes-export.zip' : 'flasky-notes-export-encrypted.zip';
            var blob = await zip.generateAsync({ type: 'blob' });
            bar.style.width = '100%';
            status.textContent = 'Done!';

            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (e) {
            if (e.name === 'AbortError') { status.textContent = 'Export cancelled.'; return; }
            status.textContent = 'Export failed: ' + e.message;
            console.error('Export error:', e);
        } finally {
            _abortController = null;
            buttons.forEach(function (b) { b.disabled = false; });
        }
    }

    function sanitizeFilename(name) {
        return name.replace(/[<>:"|?*\\]/g, '_');
    }

    function buildFullContent(content, properties) {
        var fm = buildFrontmatter(properties);
        return fm + (content || '');
    }

    function buildFrontmatter(properties) {
        if (!properties) return '';
        var props;
        try {
            props = (typeof properties === 'string') ? JSON.parse(properties) : properties;
        } catch (e) {
            return '';
        }
        if (!props || typeof props !== 'object' || Object.keys(props).length === 0) return '';
        var lines = ['---'];
        for (var key in props) {
            if (!props.hasOwnProperty(key)) continue;
            var val = props[key];
            if (Array.isArray(val)) {
                lines.push(key + ':');
                for (var i = 0; i < val.length; i++) {
                    lines.push('  - ' + val[i]);
                }
            } else {
                lines.push(key + ': ' + val);
            }
        }
        lines.push('---');
        return lines.join('\n') + '\n';
    }

    window.FlaskyViews = window.FlaskyViews || {};
    window.FlaskyViews.export = { init: init, destroy: destroy };
})();