/**
 * Flasky Notes — Drawing modal.
 *
 * Full-screen takeover canvas. Single color + single size for now, but the
 * stroke data model carries per-stroke color/size so the format is
 * forward-compatible. Drawings are saved as .fldraw (vector JSON):
 *
 *   {"v":1,"w":<int>,"h":<int>,"strokes":[{"color":"#hex","size":<num>,"pts":[[x,y],...]}]}
 *
 * Usage:
 *   window.openDrawingModal({
 *     attachmentId: null|<int>,   // if set, loads existing drawing for editing
 *     filename: "name.fldraw",     // plaintext name for new saves
 *     onSave: function(blob, filename),  // called on Save (new or updated)
 *     onCancel: function()        // optional
 *   });
 *
 *   window._renderFldrawToCanvas(canvasEl, strokes, width, height)
 *     — renders a .fldraw document onto a canvas (used by embed renderer).
 */
(function () {
    'use strict';

    var overlay = null;
    var canvas = null;
    var ctx = null;
    var bar = null;

    // Drawing state
    var strokes = [];
    var currentStroke = null;
    var drawing = false;
    var dirty = false;

    // Fixed defaults (single color + single size for now).
    // The data model is per-stroke so these can become UI-driven later.
    var STROKE_COLOR = '#000000';
    var STROKE_SIZE = 3;
    var CANVAS_W = 1200;
    var CANVAS_H = 800;

    // Callbacks for the current open session
    var currentOpts = null;

    function createOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'drawing-takeover';
        overlay.innerHTML =
            '<div class="drawing-bar">' +
                '<div class="drawing-bar-left">' +
                    '<button class="icon-btn drawing-close-btn" title="Close (Esc)" aria-label="Close">&times;</button>' +
                    '<span class="drawing-title">Drawing</span>' +
                '</div>' +
                '<div class="drawing-bar-right">' +
                    '<button class="icon-btn drawing-clear-btn" title="Clear canvas">Clear</button>' +
                    '<button class="icon-btn drawing-undo-btn" title="Undo (Ctrl+Z)">Undo</button>' +
                    '<button class="icon-btn drawing-export-png-btn" title="Export as PNG">PNG</button>' +
                    '<button class="icon-btn drawing-export-jpg-btn" title="Export as JPG">JPG</button>' +
                    '<button class="icon-btn drawing-save-btn primary" title="Save and embed">Save</button>' +
                '</div>' +
            '</div>' +
            '<div class="drawing-canvas-wrap">' +
                '<canvas class="drawing-canvas" width="' + CANVAS_W + '" height="' + CANVAS_H + '"></canvas>' +
            '</div>';
        document.body.appendChild(overlay);

        canvas = overlay.querySelector('.drawing-canvas');
        ctx = canvas.getContext('2d');
        bar = overlay.querySelector('.drawing-bar');

        // Size the canvas to fill the viewport below the bar.
        _resizeCanvas();

        // Pointer drawing (unified mouse + touch)
        canvas.addEventListener('pointerdown', _onPointerDown);
        canvas.addEventListener('pointermove', _onPointerMove);
        canvas.addEventListener('pointerup', _onPointerUp);
        canvas.addEventListener('pointerleave', _onPointerUp);
        canvas.addEventListener('pointercancel', _onPointerUp);
        // Prevent touch scrolling/gestures over the canvas
        canvas.style.touchAction = 'none';

        // Buttons
        overlay.querySelector('.drawing-close-btn').addEventListener('click', _close);
        overlay.querySelector('.drawing-clear-btn').addEventListener('click', function () {
            if (!strokes.length && !currentStroke) return;
            strokes = [];
            currentStroke = null;
            dirty = true;
            _redraw();
        });
        overlay.querySelector('.drawing-undo-btn').addEventListener('click', _undo);
        overlay.querySelector('.drawing-export-png-btn').addEventListener('click', function () {
            _exportImage('image/png', (currentOpts && currentOpts.filename ? currentOpts.filename.replace(/\.fldraw$/i, '') : 'drawing') + '.png');
        });
        overlay.querySelector('.drawing-export-jpg-btn').addEventListener('click', function () {
            _exportImage('image/jpeg', (currentOpts && currentOpts.filename ? currentOpts.filename.replace(/\.fldraw$/i, '') : 'drawing') + '.jpg');
        });
        overlay.querySelector('.drawing-save-btn').addEventListener('click', _save);

        // Click on backdrop (the wrap, not the canvas/bar) closes
        overlay.querySelector('.drawing-canvas-wrap').addEventListener('click', function (e) {
            if (e.target === this) _close();
        });

        // Esc handled centrally in app.js; also handle locally as fallback
        overlay.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); _close(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _undo(); }
        });
    }

    function _resizeCanvas() {
        var barH = bar ? bar.offsetHeight : 48;
        var w = window.innerWidth;
        var h = window.innerHeight - barH;
        // Use a fixed internal resolution but display at viewport size.
        // Keep it simple: set canvas resolution to viewport so coords map 1:1.
        CANVAS_W = w;
        CANVAS_H = h;
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        _redraw();
        _applyModalBg();
    }

    // Resolve the transparent-background setting and apply it to the live
    // canvas. Called once on modal open (and on resize). For dynamic mode the
    // canvas is already drawn with strokes, so _analyzeContrastBg can sample
    // synchronously. Re-analyzing on every stroke would flicker the bg, so we
    // only resolve on open/resize.
    function _applyModalBg() {
        if (!canvas) return;
        var bg = null;
        if (window.resolveEmbedBg) bg = window.resolveEmbedBg();
        if (window._getEmbedBgMode && window._getEmbedBgMode() === 'dynamic') {
            var dyn = window._analyzeContrastBg ? window._analyzeContrastBg(canvas) : null;
            if (dyn) bg = dyn;
            else bg = window._themeEmbedBg ? window._themeEmbedBg() : '#ffffff';
        }
        if (bg) canvas.style.backgroundColor = bg;
    }

    function _getPos(e) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: Math.round(e.clientX - rect.left),
            y: Math.round(e.clientY - rect.top)
        };
    }

    function _onPointerDown(e) {
        e.preventDefault();
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        drawing = true;
        var p = _getPos(e);
        currentStroke = { color: STROKE_COLOR, size: STROKE_SIZE, pts: [[p.x, p.y]] };
        // Draw the starting dot
        ctx.fillStyle = STROKE_COLOR;
        ctx.beginPath();
        ctx.arc(p.x, p.y, STROKE_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function _onPointerMove(e) {
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        var p = _getPos(e);
        var pts = currentStroke.pts;
        var prev = pts[pts.length - 1];
        pts.push([p.x, p.y]);
        ctx.strokeStyle = currentStroke.color;
        ctx.lineWidth = currentStroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }

    function _onPointerUp(e) {
        if (!drawing) return;
        drawing = false;
        if (currentStroke && currentStroke.pts.length > 0) {
            strokes.push(currentStroke);
            dirty = true;
        }
        currentStroke = null;
    }

    function _redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _renderStrokes(ctx, strokes, canvas.width, canvas.height);
    }

    function _undo() {
        if (!strokes.length) return;
        strokes.pop();
        dirty = true;
        _redraw();
    }

    /**
     * Render an array of strokes onto a 2d context. Shared by the live canvas,
     * the embed renderer, and export.
     */
    function _renderStrokes(c, strokeList, w, h) {
        if (w) c.clearRect && c.clearRect(0, 0, w, h);
        for (var i = 0; i < strokeList.length; i++) {
            var s = strokeList[i];
            var pts = s.pts;
            if (!pts || !pts.length) continue;
            c.strokeStyle = s.color || STROKE_COLOR;
            c.fillStyle = s.color || STROKE_COLOR;
            c.lineWidth = s.size || STROKE_SIZE;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            // Start dot
            c.beginPath();
            c.arc(pts[0][0], pts[0][1], (s.size || STROKE_SIZE) / 2, 0, Math.PI * 2);
            c.fill();
            if (pts.length > 1) {
                c.beginPath();
                c.moveTo(pts[0][0], pts[0][1]);
                for (var j = 1; j < pts.length; j++) {
                    c.lineTo(pts[j][0], pts[j][1]);
                }
                c.stroke();
            }
        }
    }

    function _serialize() {
        return {
            v: 1,
            w: canvas.width,
            h: canvas.height,
            strokes: strokes
        };
    }

    function _save() {
        if (!currentOpts || typeof currentOpts.onSave !== 'function') return;
        var doc = _serialize();
        var json = JSON.stringify(doc);
        var blob = new Blob([json], { type: 'application/x-fldraw' });
        var filename = (currentOpts.filename || 'drawing.fldraw');
        if (!/\.fldraw$/i.test(filename)) filename += '.fldraw';
        blob.name = filename;
        dirty = false;
        currentOpts.onSave(blob, filename);
        _close();
    }

    function _exportImage(mime, filename) {
        // For JPG, fill the resolved background first (JPEG has no alpha).
        // Use the canvas's current background color so the export matches what
        // the user sees in the editor. Browsers serialize backgroundColor as
        // "rgb(r, g, b)" (or rgba), so parse both rgb() and #hex forms.
        var r = 255, g = 255, b = 255;
        var bgCss = (canvas.style.backgroundColor || '').trim();
        var mHex = bgCss.match(/#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
        var mRgb = bgCss.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (mHex) {
            r = parseInt(mHex[1], 16); g = parseInt(mHex[2], 16); b = parseInt(mHex[3], 16);
        } else if (mRgb) {
            r = parseInt(mRgb[1], 10); g = parseInt(mRgb[2], 10); b = parseInt(mRgb[3], 10);
        }
        if (mime === 'image/jpeg') {
            var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (var i = 0; i < imgData.data.length; i += 4) {
                if (imgData.data[i + 3] === 0) {
                    imgData.data[i] = r;
                    imgData.data[i + 1] = g;
                    imgData.data[i + 2] = b;
                    imgData.data[i + 3] = 255;
                }
            }
            ctx.putImageData(imgData, 0, 0);
        }
        canvas.toBlob(function (blob) {
            if (!blob) return;
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            // Restore transparency after JPG export
            if (mime === 'image/jpeg') _redraw();
        }, mime, 0.92);
    }

    function _close() {
        if (!overlay) return;
        if (dirty && strokes.length > 0) {
            if (!confirm('Discard your drawing?')) return;
        }
        overlay.classList.remove('visible');
        dirty = false;
        if (currentOpts && typeof currentOpts.onCancel === 'function') {
            try { currentOpts.onCancel(); } catch (e) {}
        }
        currentOpts = null;
        window.removeEventListener('resize', _resizeCanvas);
    }

    function _loadExisting(attId, filename, cb) {
        if (!attId) { cb(); return; }
        var url = '/attachment/' + attId + '/' + encodeURIComponent(filename || '');
        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('fetch failed');
            return r.arrayBuffer();
        }).then(function (buf) {
            if (typeof FlaskyE2EE === 'undefined' || !FlaskyE2EE.isReady()) {
                throw new Error('E2EE not ready');
            }
            return FlaskyE2EE.decryptBlob(new Uint8Array(buf));
        }).then(function (decrypted) {
            return new TextDecoder().decode(new Uint8Array(decrypted));
        }).then(function (text) {
            var doc;
            try { doc = JSON.parse(text); } catch (e) { doc = null; }
            if (doc && doc.strokes) {
                strokes = doc.strokes;
                if (doc.w && doc.h) {
                    CANVAS_W = doc.w;
                    CANVAS_H = doc.h;
                    canvas.width = doc.w;
                    canvas.height = doc.h;
                    canvas.style.width = doc.w + 'px';
                    canvas.style.height = doc.h + 'px';
                }
            }
            dirty = false;
            _redraw();
            cb();
        }).catch(function (e) {
            console.warn('drawing: failed to load existing', e);
            cb();
        });
    }

    window.openDrawingModal = function (opts) {
        opts = opts || {};
        createOverlay();
        currentOpts = opts;
        strokes = [];
        currentStroke = null;
        drawing = false;
        dirty = false;
        // Reset to viewport size before loading (existing may override)
        _resizeCanvas();
        window.removeEventListener('resize', _resizeCanvas);
        window.addEventListener('resize', _resizeCanvas);

        var filename = opts.filename || 'drawing.fldraw';
        if (opts.attachmentId) {
            _loadExisting(opts.attachmentId, filename, function () {
                _applyModalBg();
                overlay.classList.add('visible');
            });
        } else {
            _redraw();
            _applyModalBg();
            overlay.classList.add('visible');
        }
    };

    window.closeDrawingModal = _close;

    /**
     * Render a .fldraw document (already-parsed {w,h,strokes}) onto a canvas
     * element. Used by the embed renderer in wikilinks.js.
     */
    window._renderFldrawToCanvas = function (canvasEl, strokeList, width, height) {
        var c = canvasEl.getContext('2d');
        if (width) canvasEl.width = width;
        if (height) canvasEl.height = height;
        _renderStrokes(c, strokeList, canvasEl.width, canvasEl.height);
    };

    // Expose a helper to parse raw .fldraw bytes (already decrypted) into a doc.
    window._parseFldraw = function (text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    };
})();