/**
 * Flasky Notes — Text-to-Speech module.
 *
 * Wraps the browser-native speechSynthesis API. Reads prefs (rate/volume/
 * voice) from a #tts-data JSON block injected into the page. Text is split
 * into ≤200-char chunks at sentence boundaries to avoid the Chrome cutoff
 * bug. A floating mini-player provides pause/resume/stop + progress.
 *
 * Server is never involved — plaintext is already decrypted in the browser.
 */
(function () {
    'use strict';

    var _prefs = { rate: 1.0, volume: 1.0, voiceURI: '', autoplayAI: false };
    var _voice = null;
    var _voices = [];
    var _queue = [];
    var _cursor = 0;
    var _speaking = false;
    var _paused = false;
    var _miniPlayer = null;
    var _onDone = null;
    var _title = '';
    // Incremented on every stop()/speak() so stale utterance callbacks are ignored.
    var _generation = 0;

    function _loadPrefs() {
        var el = document.getElementById('tts-data');
        if (!el) return;
        try {
            var data = JSON.parse(el.textContent);
            _prefs.rate = typeof data.rate === 'number' ? data.rate : 1.0;
            _prefs.volume = typeof data.volume === 'number' ? data.volume : 1.0;
            _prefs.voiceURI = data.voiceURI || '';
            _prefs.autoplayAI = !!data.autoplayAI;
        } catch (e) {}
    }

    function _warmVoices() {
        if (!('speechSynthesis' in window)) return;
        _voices = speechSynthesis.getVoices() || [];
        if (_prefs.voiceURI) {
            _voice = _voices.filter(function (v) { return v.voiceURI === _prefs.voiceURI; })[0] || null;
        }
        if (!_voice && _voices.length) {
            var lang = (navigator.language || 'en-US').toLowerCase();
            _voice = _voices.filter(function (v) {
                return (v.lang || '').toLowerCase().indexOf(lang) === 0;
            })[0] || _voices[0];
        }
    }

    var _voicesBound = false;
    function init() {
        _loadPrefs();
        if (!('speechSynthesis' in window)) return false;
        _warmVoices();
        if (!_voicesBound && typeof speechSynthesis.onvoiceschanged !== 'undefined') {
            speechSynthesis.addEventListener('voiceschanged', _warmVoices);
            _voicesBound = true;
        }
        return true;
    }

    function getVoices() {
        return _voices.length ? _voices.slice() : (speechSynthesis.getVoices() || []).slice();
    }

    function isSupported() { return 'speechSynthesis' in window; }
    function hasVoices() { return getVoices().length > 0; }

    function _chunk(text) {
        text = String(text || '').replace(/\s+/g, ' ').trim();
        if (!text) return [];
        var MAX = 200;
        if (text.length <= MAX) return [text];
        var chunks = [];
        var sentences = text.replace(/([.!?。！？])\s+/g, '$1\u0001').split('\u0001');
        var buf = '';
        for (var i = 0; i < sentences.length; i++) {
            var s = sentences[i];
            if (s.length > MAX) {
                if (buf) { chunks.push(buf); buf = ''; }
                var parts = s.replace(/([,;:，；])\s+/g, '$1\u0001').split('\u0001');
                var sub = '';
                for (var j = 0; j < parts.length; j++) {
                    if ((sub + ' ' + parts[j]).trim().length > MAX) {
                        if (sub) chunks.push(sub.trim());
                        if (parts[j].length > MAX) {
                            var k = 0;
                            while (k < parts[j].length) { chunks.push(parts[j].slice(k, k + MAX).trim()); k += MAX; }
                            sub = '';
                        } else { sub = parts[j]; }
                    } else { sub = (sub + ' ' + parts[j]).trim(); }
                }
                if (sub) chunks.push(sub);
            } else if ((buf + ' ' + s).trim().length > MAX) {
                if (buf) chunks.push(buf.trim());
                buf = s;
            } else { buf = (buf + ' ' + s).trim(); }
        }
        if (buf) chunks.push(buf.trim());
        return chunks;
    }

    function _updateProgress() {
        if (!_miniPlayer) return;
        var prog = _miniPlayer.querySelector('.tts-progress');
        if (prog) prog.textContent = 'Speaking' + (_paused ? ' (paused)' : '') + '… ' + (_cursor + 1) + ' of ' + _queue.length;
        var pauseBtn = _miniPlayer.querySelector('.tts-mini-pause');
        if (pauseBtn) {
            pauseBtn.innerHTML = _paused ? PLAY_SVG : PAUSE_SVG;
            pauseBtn.title = _paused ? 'Resume' : 'Pause';
        }
    }

    function _showMiniPlayer() {
        if (_miniPlayer) { _miniPlayer.style.display = ''; _updateProgress(); return; }
        var el = document.createElement('div');
        el.className = 'tts-mini-player';
        el.innerHTML =
            '<div class="tts-mini-icon">' + SPEAKER_SVG + '</div>' +
            '<div class="tts-mini-body">' +
                '<div class="tts-mini-title"></div>' +
                '<div class="tts-progress">Speaking…</div>' +
            '</div>' +
            '<button class="tts-mini-pause" title="Pause">' + PAUSE_SVG + '</button>' +
            '<button class="tts-mini-stop" title="Stop">' + STOP_SVG + '</button>';
        document.body.appendChild(el);
        _miniPlayer = el;
        var t = el.querySelector('.tts-mini-title');
        if (t) t.textContent = _title || 'Reading aloud';
        var pauseBtn = el.querySelector('.tts-mini-pause');
        if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
        var stopBtn = el.querySelector('.tts-mini-stop');
        if (stopBtn) stopBtn.addEventListener('click', stop);
        _updateProgress();
    }

    function _hideMiniPlayer() {
        if (!_miniPlayer) return;
        _miniPlayer.style.display = 'none';
    }

    function _speakChunk(gen, i) {
        if (gen !== _generation) return;
        if (i >= _queue.length) { _finish(); return; }
        _cursor = i;
        _updateProgress();
        var u = new SpeechSynthesisUtterance(_queue[i]);
        u.rate = _prefs.rate;
        u.volume = _prefs.volume;
        if (_voice) u.voice = _voice;
        u.onend = function () {
            if (gen !== _generation) return;
            if (i + 1 < _queue.length && _speaking && !_paused) _speakChunk(gen, i + 1);
            else if (i + 1 >= _queue.length) _finish();
        };
        u.onerror = function () {
            if (gen !== _generation) return;
            if (i + 1 < _queue.length) _speakChunk(gen, i + 1);
            else _finish();
        };
        try { speechSynthesis.speak(u); }
        catch (e) { _finish(); }
    }

    function _finish() {
        _speaking = false;
        _paused = false;
        _cursor = 0;
        _queue = [];
        _generation++;
        _hideMiniPlayer();
        var cb = _onDone; _onDone = null;
        if (cb) try { cb(); } catch (e) {}
    }

    function speak(text, opts) {
        opts = opts || {};
        if (!isSupported() || !text) return false;
        var wasSpeaking = _speaking;
        try { speechSynthesis.cancel(); } catch (e) {}
        _generation++;
        _speaking = false;
        _paused = false;
        _cursor = 0;
        _queue = [];
        var prevCb = _onDone; _onDone = null;
        if (prevCb) try { prevCb(); } catch (e) {}
        _queue = _chunk(text);
        if (!_queue.length) return false;
        _speaking = true;
        _title = opts.title || '';
        _onDone = opts.onDone || null;
        _showMiniPlayer();
        var gen = _generation;
        if (wasSpeaking) {
            setTimeout(function () { if (gen === _generation) _speakChunk(gen, 0); }, 0);
        } else {
            _speakChunk(gen, 0);
        }
        return true;
    }

    function togglePause() {
        if (!isSupported() || !_speaking) return;
        try {
            if (_paused) { speechSynthesis.resume(); _paused = false; }
            else { speechSynthesis.pause(); _paused = true; }
        } catch (e) {}
        _updateProgress();
    }

    function stop() {
        if (!isSupported()) return;
        try { speechSynthesis.cancel(); } catch (e) {}
        _finish();
    }

    function isSpeaking() { return _speaking; }
    function isPaused() { return _paused; }
    function shouldAutoplayAI() { return !!_prefs.autoplayAI; }

    function updatePrefs(prefs) {
        if (!prefs) return;
        if (typeof prefs.rate === 'number') _prefs.rate = prefs.rate;
        if (typeof prefs.volume === 'number') _prefs.volume = prefs.volume;
        if (typeof prefs.voiceURI === 'string') _prefs.voiceURI = prefs.voiceURI;
        if (typeof prefs.autoplayAI === 'boolean') _prefs.autoplayAI = prefs.autoplayAI;
        _warmVoices();
    }

    var SPEAKER_SVG = '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    var PAUSE_SVG = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    var PLAY_SVG = '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    var STOP_SVG = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';

    window.FlaskyTTS = {
        init: init,
        isSupported: isSupported,
        hasVoices: hasVoices,
        getVoices: getVoices,
        speak: speak,
        stop: stop,
        togglePause: togglePause,
        isSpeaking: isSpeaking,
        isPaused: isPaused,
        shouldAutoplayAI: shouldAutoplayAI,
        updatePrefs: updatePrefs,
        SPEAKER_SVG: SPEAKER_SVG,
    };
})();