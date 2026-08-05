/**
 * Flasky Notes — Audio recorder.
 *
 * Inline toolbar recorder: click the mic button → recording starts and the
 * button shows a live MM:SS timer. Click again (or press Esc to discard /
 * S to save) → recording stops. On save the resulting Blob is wrapped in a
 * File and handed to uploadFileToNote() from app.js, which encrypts it
 * client-side and uploads via the standard /api/upload_attachment E2EE
 * pipeline — the server never sees plaintext audio. The embed
 * `![[audio-<ts>.<ext>]]` is inserted into the editor.
 *
 * Codec selection: MediaRecorder support is browser-dependent. We probe
 * isTypeSupported() in order of preference and pick the first match:
 *   - "webm-opus" → audio/webm;codecs=opus → .weba (audio-only WebM)
 *   - "mp4-aac"   → audio/mp4              → .m4a
 *   - "auto"      → try webm-opus, then mp4-aac, else browser default
 *
 * Settings are read from window._pageData (injected by note_single.html):
 *   audioDeviceId, audioMaxDurationMin, audioMimePreference,
 *   audioEchoCancellation, audioNoiseSuppression, audioAutoGainControl.
 *
 * Exposed on window:
 *   window.toggleAudioRecord()  — start/stop from toolbar / slash command
 *   window.stopAudioRecord(opts){save:true|false}
 *   window.isAudioRecording()   — boolean
 *
 * Usage from app.js action dispatcher:
 *   case 'toggle-audio-record': if (window.toggleAudioRecord) window.toggleAudioRecord(); break;
 */
(function () {
    'use strict';

    var mediaRecorder = null;
    var stream = null;
    var chunks = [];
    var timerInterval = null;
    var startTime = 0;
    var forcedStopTimer = null;
    var activeMime = '';
    var activeExt = '';
    var pill = null;
    var discarding = false;
    var finalizing = false;

    function pageData() {
        if (typeof _pageData === 'undefined') return {};
        return _pageData || {};
    }

    function config() {
        var d = pageData();
        return {
            deviceId: d.audioDeviceId || '',
            maxDuration: (d.audioMaxDurationMin || 5) * 60,
            mimePref: d.audioMimePreference || 'auto',
            echoCancellation: d.audioEchoCancellation !== false,
            noiseSuppression: d.audioNoiseSuppression !== false,
            autoGainControl: d.audioAutoGainControl !== false,
        };
    }

    function pickMimeAndExt(pref) {
        var candidates = {
            'webm-opus': { mime: 'audio/webm;codecs=opus', ext: 'weba' },
            'mp4-aac': { mime: 'audio/mp4', ext: 'm4a' },
        };
        var order;
        if (pref === 'webm-opus') order = ['webm-opus', 'mp4-aac'];
        else if (pref === 'mp4-aac') order = ['mp4-aac', 'webm-opus'];
        else order = ['webm-opus', 'mp4-aac'];

        for (var i = 0; i < order.length; i++) {
            var c = candidates[order[i]];
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
                return c;
            }
        }
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')) {
            return { mime: 'audio/webm', ext: 'weba' };
        }
        return { mime: '', ext: 'm4a' };
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function formatElapsed(ms) {
        var s = Math.floor(ms / 1000);
        return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
    }

    function timerEl() { return document.querySelector('#audio-record-btn .audio-record-timer'); }
    function btnEl() { return document.getElementById('audio-record-btn'); }

    // Floating pill appended to document.body — survives editor detach
    // (router.js detachEditor removes the .app shell from the DOM during
    // SPA navigation to /settings, /agenda, etc.). The pill is the only
    // visible affordance while the editor is detached; clicking it stops
    // and saves the recording. The toolbar mic button is a secondary
    // toggle that only works while the editor is in the DOM.
    function ensurePill() {
        if (pill) return pill;
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'audio-record-pill';
        pill.title = 'Stop and save recording';
        pill.setAttribute('aria-label', 'Stop and save recording');
        pill.innerHTML = '<span class="audio-record-pill-dot"></span>' +
            '<span class="audio-record-pill-timer">00:00</span>' +
            '<span class="audio-record-pill-hint">Click to stop</span>';
        pill.addEventListener('click', function () { stopInternal(true); });
        document.body.appendChild(pill);
        return pill;
    }

    function showPill() {
        var p = ensurePill();
        p.classList.add('visible');
    }

    function hidePill() {
        if (!pill) return;
        pill.classList.remove('visible');
    }

    function setPillTimer(ms) {
        if (!pill) return;
        var t = pill.querySelector('.audio-record-pill-timer');
        if (t) t.textContent = formatElapsed(ms);
    }

    function startTimer() {
        startTime = Date.now();
        var el = timerEl();
        if (el) { el.textContent = '00:00'; el.hidden = false; }
        showPill();
        timerInterval = setInterval(function () {
            var elapsed = Date.now() - startTime;
            var el2 = timerEl();
            if (el2) el2.textContent = formatElapsed(elapsed);
            setPillTimer(elapsed);
        }, 500);
    }

    function stopTimer() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (forcedStopTimer) { clearTimeout(forcedStopTimer); forcedStopTimer = null; }
        var el = timerEl();
        if (el) { el.hidden = true; el.textContent = ''; }
        hidePill();
    }

    function setRecordingClass(on) {
        var b = btnEl();
        if (b) b.classList.toggle('recording', on);
    }

    async function start() {
        if (mediaRecorder) return;
        var cfg = config();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            _toast('Audio recording not supported in this browser.');
            return;
        }
        if (typeof MediaRecorder === 'undefined') {
            _toast('MediaRecorder API unavailable.');
            return;
        }

        var constraints = {
            audio: {
                deviceId: cfg.deviceId ? { exact: cfg.deviceId } : undefined,
                echoCancellation: cfg.echoCancellation,
                noiseSuppression: cfg.noiseSuppression,
                autoGainControl: cfg.autoGainControl,
            },
        };

        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            if (e && e.name === 'NotAllowedError') _toast('Microphone permission denied.');
            else _toast('Could not access microphone: ' + (e && e.message ? e.message : e));
            return;
        }

        var picked = pickMimeAndExt(cfg.mimePref);
        activeMime = picked.mime;
        activeExt = picked.ext;
        chunks = [];

        try {
            mediaRecorder = activeMime ? new MediaRecorder(stream, { mimeType: activeMime }) : new MediaRecorder(stream);
        } catch (e) {
            _releaseStream();
            _toast('Could not start recorder: ' + (e && e.message ? e.message : e));
            return;
        }

        mediaRecorder.ondataavailable = function (e) {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onstop = function () {
            _finalize(!discarding);
            discarding = false;
        };

        mediaRecorder.start();
        startTimer();
        setRecordingClass(true);
        if (cfg.maxDuration > 0) {
            forcedStopTimer = setTimeout(function () {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    discarding = false;
                    stopInternal(true);
                }
            }, cfg.maxDuration * 1000);
        }
    }

    function stopInternal(save) {
        if (!mediaRecorder || finalizing) return;
        discarding = !save;
        if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        } else {
            // Already stopped but onstop hasn't fired (or recorder never
            // started) — finalize synchronously.
            _finalize(save);
        }
    }

    function _releaseStream() {
        if (stream) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            stream = null;
        }
    }

    function _finalize(save) {
        if (finalizing) return;
        finalizing = true;
        stopTimer();
        setRecordingClass(false);
        _releaseStream();
        mediaRecorder = null;

        if (!save || chunks.length === 0) { chunks = []; finalizing = false; return; }

        var blob = new Blob(chunks, { type: activeMime || 'audio/webm' });
        chunks = [];
        finalizing = false;
        if (blob.size === 0) { _toast('Recording was empty.'); return; }

        var ts = Date.now().toString(36);
        var filename = 'audio-' + ts + '.' + activeExt;
        var file = new File([blob], filename, { type: blob.type });

        if (typeof window.uploadFileToNote === 'function') {
            window.uploadFileToNote(file);
        } else {
            _toast('Upload helper not available.');
        }
    }

    function _toast(msg) {
        if (typeof window.showToast === 'function') window.showToast(msg);
        else console.warn('[audio]', msg);
    }

    window.toggleAudioRecord = function () {
        if (mediaRecorder) stopInternal(true);
        else start();
    };

    window.stopAudioRecord = function (opts) {
        opts = opts || {};
        if (!mediaRecorder) return;
        stopInternal(!!opts.save);
    };

    window.isAudioRecording = function () { return !!mediaRecorder; };

    // Allow app.js keyboard handler to discard on Esc during recording.
    window._audioDiscard = function () {
        if (mediaRecorder) stopInternal(false);
    };

    // When the editor shell is detached and re-attached during SPA
    // navigation (router.js openOverlay / closeOverlay), the toolbar mic
    // button is removed from the DOM and a fresh one is rendered on re-attach.
    // Restore the recording visual state on the new button so it matches the
    // pill (which lives on body and was never removed).
    document.addEventListener('flasky:editorReattached', function () {
        if (mediaRecorder) setRecordingClass(true);
    });
})();