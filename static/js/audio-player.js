/**
 * FlaskyAudioPlayer — custom themed audio player for E2EE audio embeds.
 *
 * Replaces the browser-native <audio controls> with a Flasky-styled player
 * (play/pause, seek bar, time display, volume, playback speed). The actual
 * media is driven by a hidden native <audio> element that keeps the E2EE
 * decrypt pipeline (wikilinks.js decryptAttachmentElements) unchanged — it
 * still queries `.e2ee-attachment[data-encrypted-src]` and sets `el.src`.
 *
 * In CM6 live-preview the entire player wrapper is cached by attachment id
 * so playback position / state survive widget destroy/recreate cycles when
 * the cursor enters/leaves the embed's line.
 */
(function () {
    'use strict';

    var _playerCache = {};

    var PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
    var VOL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
    var MUTE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16 9l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

    function _escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _fmtTime(sec) {
        if (!sec || isNaN(sec) || sec === Infinity) return '0:00';
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function _wirePlayer(container) {
        var audio = container.querySelector('audio');
        var playBtn = container.querySelector('.audio-player-play');
        var seekBar = container.querySelector('.audio-player-seek');
        var seekFilled = container.querySelector('.audio-player-seek-filled');
        var curTime = container.querySelector('.audio-player-current');
        var durTime = container.querySelector('.audio-player-duration');
        var muteBtn = container.querySelector('.audio-player-mute');
        var volBar = container.querySelector('.audio-player-volume');
        var volFilled = container.querySelector('.audio-player-volume-filled');
        var speedSel = container.querySelector('.audio-player-speed');

        var state = container._audioState;
        if (!state) {
            state = { dragging: false, volDragging: false };
            container._audioState = state;
        }

        function updatePlayIcon() {
            playBtn.innerHTML = audio.paused ? PLAY_SVG : PAUSE_SVG;
            playBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
        }

        function updateTimes() {
            curTime.textContent = _fmtTime(audio.currentTime);
            var pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
            seekFilled.style.width = pct + '%';
            seekBar.style.setProperty('--thumb-pct', pct + '%');
        }

        function updateDuration() {
            durTime.textContent = _fmtTime(audio.duration);
            if (audio.duration) {
                container.classList.remove('audio-player-loading');
            }
        }

        function updateVolumeUI() {
            var vol = audio.muted ? 0 : audio.volume;
            volFilled.style.width = (vol * 100) + '%';
            volBar.style.setProperty('--thumb-pct', (vol * 100) + '%');
            muteBtn.innerHTML = (vol === 0 || audio.muted) ? MUTE_SVG : VOL_SVG;
            muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
        }

        playBtn.addEventListener('click', function () {
            if (audio.paused) { audio.play(); } else { audio.pause(); }
        });

        audio.addEventListener('play', updatePlayIcon);
        audio.addEventListener('pause', updatePlayIcon);
        audio.addEventListener('timeupdate', updateTimes);
        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('durationchange', updateDuration);
        audio.addEventListener('volumechange', updateVolumeUI);
        audio.addEventListener('ended', function () {
            updatePlayIcon();
            updateTimes();
        });
        audio.addEventListener('error', function () {
            container.classList.add('audio-player-error');
        });

        function seekFromEvent(e) {
            var rect = seekBar.getBoundingClientRect();
            var pct = _clamp((e.clientX - rect.left) / rect.width, 0, 1);
            if (audio.duration) audio.currentTime = pct * audio.duration;
            seekFilled.style.width = (pct * 100) + '%';
            seekBar.style.setProperty('--thumb-pct', (pct * 100) + '%');
        }

        seekBar.addEventListener('pointerdown', function (e) {
            state.dragging = true;
            seekBar.setPointerCapture(e.pointerId);
            seekFromEvent(e);
        });
        seekBar.addEventListener('pointermove', function (e) {
            if (state.dragging) seekFromEvent(e);
        });
        seekBar.addEventListener('pointerup', function (e) {
            state.dragging = false;
            try { seekBar.releasePointerCapture(e.pointerId); } catch (err) {}
        });

        function volFromEvent(e) {
            var rect = volBar.getBoundingClientRect();
            var pct = _clamp((e.clientX - rect.left) / rect.width, 0, 1);
            audio.volume = pct;
            audio.muted = (pct === 0);
            volFilled.style.width = (pct * 100) + '%';
            volBar.style.setProperty('--thumb-pct', (pct * 100) + '%');
        }

        volBar.addEventListener('pointerdown', function (e) {
            state.volDragging = true;
            volBar.setPointerCapture(e.pointerId);
            volFromEvent(e);
        });
        volBar.addEventListener('pointermove', function (e) {
            if (state.volDragging) volFromEvent(e);
        });
        volBar.addEventListener('pointerup', function (e) {
            state.volDragging = false;
            try { volBar.releasePointerCapture(e.pointerId); } catch (err) {}
        });

        muteBtn.addEventListener('click', function () {
            audio.muted = !audio.muted;
            if (!audio.muted && audio.volume === 0) audio.volume = 0.5;
        });

        if (speedSel) {
            speedSel.addEventListener('change', function () {
                audio.playbackRate = parseFloat(speedSel.value) || 1;
            });
        }

        container.addEventListener('keydown', function (e) {
            if (e.target === speedSel) return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    if (audio.paused) { audio.play(); } else { audio.pause(); }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    audio.currentTime = Math.max(0, audio.currentTime - 5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    audio.volume = _clamp(audio.volume + 0.1, 0, 1);
                    audio.muted = false;
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    audio.volume = _clamp(audio.volume - 0.1, 0, 1);
                    break;
                default:
                    break;
            }
        });

        if (audio.src) {
            if (audio.readyState >= 1) updateDuration();
            updatePlayIcon();
            updateTimes();
            updateVolumeUI();
        } else {
            updatePlayIcon();
            updateVolumeUI();
        }
    }

    function _buildPlayer(att) {
        var container = document.createElement('div');
        container.className = 'audio-player cm6-embed audio-player-loading';
        container.setAttribute('tabindex', '0');
        container.setAttribute('data-init', '1');
        container.setAttribute('data-att-id', String(att.id));
        container.setAttribute('data-att-filename', att.filename);

        var audio = document.createElement('audio');
        audio.className = 'e2ee-attachment';
        audio.setAttribute('data-encrypted-src', '/attachment/' + att.id + '/' + encodeURIComponent(att.filename));
        audio.setAttribute('data-att-filename', att.filename);
        container.appendChild(audio);

        var bar = document.createElement('div');
        bar.className = 'audio-player-bar';
        bar.innerHTML =
            '<button type="button" class="audio-player-btn audio-player-play" aria-label="Play">' + PLAY_SVG + '</button>' +
            '<span class="audio-player-time audio-player-current">0:00</span>' +
            '<div class="audio-player-seek" role="slider" aria-label="Seek" tabindex="-1">' +
                '<div class="audio-player-seek-filled"></div>' +
            '</div>' +
            '<span class="audio-player-time audio-player-duration">0:00</span>' +
            '<button type="button" class="audio-player-btn audio-player-mute" aria-label="Mute">' + VOL_SVG + '</button>' +
            '<div class="audio-player-volume" role="slider" aria-label="Volume" tabindex="-1">' +
                '<div class="audio-player-volume-filled"></div>' +
            '</div>' +
            '<select class="audio-player-speed" aria-label="Playback speed">' +
                '<option value="0.5">0.5\u00d7</option>' +
                '<option value="0.75">0.75\u00d7</option>' +
                '<option value="1" selected>1\u00d7</option>' +
                '<option value="1.25">1.25\u00d7</option>' +
                '<option value="1.5">1.5\u00d7</option>' +
                '<option value="2">2\u00d7</option>' +
            '</select>';
        container.appendChild(bar);

        _wirePlayer(container);
        return container;
    }

    function _buildPlayerHTML(att) {
        var url = '/attachment/' + att.id + '/' + encodeURIComponent(att.filename);
        var fnEsc = _escapeAttr(att.filename);
        return (
            '<div class="audio-player audio-player-loading" tabindex="0" data-att-id="' + att.id + '" data-att-filename="' + fnEsc + '">' +
                '<audio class="e2ee-attachment" data-encrypted-src="' + url + '" data-att-filename="' + fnEsc + '"></audio>' +
                '<div class="audio-player-bar">' +
                    '<button type="button" class="audio-player-btn audio-player-play" aria-label="Play">' + PLAY_SVG + '</button>' +
                    '<span class="audio-player-time audio-player-current">0:00</span>' +
                    '<div class="audio-player-seek" role="slider" aria-label="Seek" tabindex="-1">' +
                        '<div class="audio-player-seek-filled"></div>' +
                    '</div>' +
                    '<span class="audio-player-time audio-player-duration">0:00</span>' +
                    '<button type="button" class="audio-player-btn audio-player-mute" aria-label="Mute">' + VOL_SVG + '</button>' +
                    '<div class="audio-player-volume" role="slider" aria-label="Volume" tabindex="-1">' +
                        '<div class="audio-player-volume-filled"></div>' +
                    '</div>' +
                    '<select class="audio-player-speed" aria-label="Playback speed">' +
                        '<option value="0.5">0.5\u00d7</option>' +
                        '<option value="0.75">0.75\u00d7</option>' +
                        '<option value="1" selected>1\u00d7</option>' +
                        '<option value="1.25">1.25\u00d7</option>' +
                        '<option value="1.5">1.5\u00d7</option>' +
                        '<option value="2">2\u00d7</option>' +
                    '</select>' +
                '</div>' +
            '</div>'
        );
    }

    window.FlaskyAudioPlayer = {
        create: function (att) {
            var key = String(att.id);
            if (_playerCache[key]) return _playerCache[key];
            var el = _buildPlayer(att);
            _playerCache[key] = el;
            return el;
        },

        init: function (container) {
            var els = (container || document).querySelectorAll('.audio-player:not([data-init])');
            for (var i = 0; i < els.length; i++) {
                els[i].setAttribute('data-init', '1');
                var attId = els[i].getAttribute('data-att-id');
                if (attId) _playerCache[attId] = els[i];
                _wirePlayer(els[i]);
            }
        },

        html: function (att) {
            return _buildPlayerHTML(att);
        },

        clearCache: function () {
            Object.keys(_playerCache).forEach(function (k) {
                var el = _playerCache[k];
                var audio = el.querySelector('audio');
                try { if (audio) audio.pause(); } catch (e) {}
            });
            _playerCache = {};
        }
    };
})();