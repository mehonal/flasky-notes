/**
 * Flasky Notes — AI Research mode module.
 *
 * Client-driven research loop: the browser issues one bounded
 * POST /ai/api/research/round request per round, maintains the full
 * transcript locally, and renders streamed chunks/tool activity live.
 * The server persists nothing. The user can stop the current round,
 * redirect the research between rounds, or force a final answer.
 */
(function () {
    'use strict';

    var _root = null;
    var _bound = [];
    var _currentAbortController = null;

    function bind(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); _bound.push([el, ev, fn]); }
    function unbindAll() { _bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); }); _bound = []; }

    // Session state: idle | running | paused | done
    var state = 'idle';
    var transcript = [];
    var roundCount = 0;
    var maxRounds = 10;
    var topic = '';

    function getCSRFToken() {
        var cookie = document.cookie.split('; ').find(function (c) { return c.startsWith('X-CSRF-Token='); });
        return cookie ? cookie.split('=')[1] : '';
    }

    function escapeHtml(text) { var d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

    var SANITIZE_CONFIG = { ALLOWED_TAGS: ['p','br','strong','em','a','code','pre','ul','ol','li','h1','h2','h3','h4','h5','h6','blockquote','table','thead','tbody','tr','th','td','hr','img','del','s','sup','sub'], ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'], ALLOW_DATA_ATTR: false };
    function renderMarkdown(text) { try { return DOMPurify.sanitize(marked(text), SANITIZE_CONFIG); } catch (e) { return escapeHtml(text); } }

    var COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var EXPORT_ICON = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

    var modal, startSection, sessionSection, topicInput, startBtn, topicDisplay,
        statusEl, feedEl, stopBtn, finishBtn, redirectBtn, redirectRow,
        redirectInput, redirectSendBtn, closeBtn, chip;

    function $(id) { return document.getElementById(id); }

    function init(container) {
        _root = container.querySelector('#ai-root');
        if (!_root) return;
        var dataEl = container.querySelector('#ai-view-data');
        if (!dataEl) return;
        var data = JSON.parse(dataEl.textContent);
        if (!data.aiResearchAllowed) return;
        maxRounds = data.aiResearchMaxRounds || 10;

        modal = $('ai-research-modal');
        startSection = $('ai-research-start');
        sessionSection = $('ai-research-session');
        topicInput = $('ai-research-topic');
        startBtn = $('ai-research-start-btn');
        topicDisplay = $('ai-research-topic-display');
        statusEl = $('ai-research-status');
        feedEl = $('ai-research-feed');
        stopBtn = $('ai-research-stop-btn');
        finishBtn = $('ai-research-finish-btn');
        redirectBtn = $('ai-research-redirect-btn');
        redirectRow = $('ai-research-redirect-row');
        redirectInput = $('ai-research-redirect-input');
        redirectSendBtn = $('ai-research-redirect-send-btn');
        closeBtn = $('ai-research-close-btn');
        chip = $('ai-research-chip');
        if (!modal || !chip) return;

        bind(chip, 'click', openModal);
        bind(closeBtn, 'click', closeModal);
        bind(startBtn, 'click', startResearch);
        bind(topicInput, 'keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startResearch(); }
        });
        bind(stopBtn, 'click', stopRound);
        bind(finishBtn, 'click', finishNow);
        bind(redirectBtn, 'click', toggleRedirectRow);
        bind(redirectSendBtn, 'click', applyRedirect);
        bind(redirectInput, 'keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); applyRedirect(); }
        });
    }

    function openModal() { modal.style.display = 'flex'; if (state === 'idle') topicInput.focus(); }

    function closeModal() {
        if (state === 'running') {
            if (!confirm('Research is still running. Close the panel? (The current round will be stopped.)')) return;
            stopRound();
        }
        modal.style.display = 'none';
        redirectRow.style.display = 'none';
    }

    function showStart() {
        startSection.style.display = '';
        sessionSection.style.display = 'none';
    }

    function showSession() {
        startSection.style.display = 'none';
        sessionSection.style.display = '';
    }

    function addFeedEntry(className, text) {
        var div = document.createElement('div');
        div.className = className;
        div.textContent = text;
        feedEl.appendChild(div);
        feedEl.scrollTop = feedEl.scrollHeight;
        return div;
    }

    function setStatus(kind, text) {
        statusEl.className = 'ai-research-status ' + (kind ? 'ai-research-status-' + kind : '');
        statusEl.textContent = text;
    }

    function updateControls() {
        var busy = state === 'running';
        stopBtn.style.display = busy ? '' : 'none';
        finishBtn.style.display = (state === 'paused' || busy) ? '' : 'none';
        redirectBtn.style.display = state === 'paused' ? '' : 'none';
        if (state !== 'paused') redirectRow.style.display = 'none';
    }

    function startResearch() {
        if (state === 'running') return;
        var t = topicInput.value.trim();
        if (!t) { topicInput.focus(); return; }
        topic = t;
        transcript = [{ role: 'user', content: 'Research this topic thoroughly: ' + t }];
        roundCount = 0;
        feedEl.innerHTML = '';
        topicDisplay.textContent = t;
        showSession();
        runRound(false);
    }

    function stopRound() {
        if (_currentAbortController) { _currentAbortController.abort(); _currentAbortController = null; }
        if (state === 'running') {
            state = 'paused';
            setStatus('paused', 'Stopped. You can redirect, finish, or close.');
            addFeedEntry('ai-research-feed-note', '— Stopped by user —');
            updateControls();
        }
    }

    function finishNow() {
        if (state !== 'paused') return;
        runRound(true);
    }

    function toggleRedirectRow() {
        redirectRow.style.display = redirectRow.style.display === 'none' ? 'flex' : 'none';
        if (redirectRow.style.display !== 'none') redirectInput.focus();
    }

    function applyRedirect() {
        if (state !== 'paused') return;
        var instruction = redirectInput.value.trim();
        if (!instruction) { redirectInput.focus(); return; }
        redirectInput.value = '';
        redirectRow.style.display = 'none';
        transcript.push({ role: 'user', content: 'Redirect instruction: ' + instruction + '\n\nContinue the research accordingly. If you already have enough information, give your final answer without calling tools.' });
        addFeedEntry('ai-research-feed-redirect', 'Redirect: ' + instruction);
        setStatus('running-text', 'Researching...');
        state = 'running';
        updateControls();
        runRound(false);
    }

    function runRound(finish) {
        state = 'running';
        roundCount += 1;
        updateControls();
        setStatus('running-text', 'Round ' + roundCount + ' — researching...');
        var abortController = new AbortController();
        _currentAbortController = abortController;

        var roundContent = '';
        var toolLinesEl = null;

        fetch('/ai/api/research/round', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify({ messages: transcript, finish: finish }),
            signal: abortController.signal
        }).then(function (response) {
            if (!response.ok) {
                response.text().then(function (t) {
                    var errorMsg = 'Something went wrong. Please try again.';
                    try { var errData = JSON.parse(t); errorMsg = errData.error || errorMsg; } catch (e) {}
                    roundFailed(errorMsg);
                });
                return;
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var roundFinished = false;

            function read() {
                reader.read().then(function (result) {
                    if (result.done) { if (!roundFinished) { roundFinished = true; roundFailed('Connection lost.'); } return; }
                    var chunk = decoder.decode(result.value, { stream: true });
                    chunk.split('\n').forEach(function (line) {
                        if (line.startsWith('data: ')) {
                            try {
                                var data = JSON.parse(line.substring(6));
                                if (data.tool) {
                                    var label = data.tool === 'web_fetch' ? ('Fetching: ' + (data.url || '')) : ('Searching: ' + (data.query || ''));
                                    if (!toolLinesEl) {
                                        toolLinesEl = document.createElement('div');
                                        toolLinesEl.className = 'ai-research-feed-tools';
                                        feedEl.appendChild(toolLinesEl);
                                    }
                                    var lineEl = document.createElement('div');
                                    lineEl.className = 'ai-research-feed-tool';
                                    lineEl.textContent = label;
                                    toolLinesEl.appendChild(lineEl);
                                    feedEl.scrollTop = feedEl.scrollHeight;
                                    setStatus('running-text', 'Round ' + roundCount + ' — ' + label.toLowerCase() + '...');
                                }
                                else if (data.chunk) {
                                    roundContent += data.chunk;
                                    setStatus('running-text', 'Round ' + roundCount + ' — thinking...');
                                }
                                else if (data.error) {
                                    roundFinished = true;
                                    roundFailed(data.error);
                                }
                                else if (data.round_done) {
                                    roundFinished = true;
                                    roundComplete(data.content, data.final, finish);
                                }
                            } catch (e) {}
                        }
                    });
                    read();
                }).catch(function (err) {
                    if (err.name === 'AbortError' && !roundFinished) { roundFinished = true; reader.cancel(); roundAborted(); }
                });
            }
            read();
        }).catch(function (err) {
            if (err.name === 'AbortError') return;
            roundFailed('Connection error. Please try again.');
        });
    }

    function roundAborted() {
        if (state !== 'running') return;
        state = 'paused';
        setStatus('paused', 'Round stopped. You can redirect, finish, or close.');
        addFeedEntry('ai-research-feed-note', '— Round stopped —');
        updateControls();
    }

    function roundFailed(errorMsg) {
        state = 'paused';
        setStatus('error', errorMsg);
        addFeedEntry('ai-research-feed-error', errorMsg);
        updateControls();
    }

    function roundComplete(content, final, wasFinish) {
        _currentAbortController = null;
        if (content && content.trim()) {
            addFeedEntry('ai-research-feed-round', 'Round ' + roundCount + ' findings:');
            var entry = document.createElement('div');
            entry.className = 'ai-research-feed-content';
            entry.innerHTML = renderMarkdown(content);
            feedEl.appendChild(entry);
            entry.querySelectorAll('pre code').forEach(function (b) { if (window.hljs) hljs.highlightElement(b); });
            feedEl.scrollTop = feedEl.scrollHeight;
        }
        transcript.push({ role: 'assistant', content: content || '' });

        if (final || wasFinish || roundCount >= maxRounds) {
            researchDone(content || '');
        } else {
            transcript.push({ role: 'user', content: 'Continue researching based on your findings so far. If you have enough information, give your final answer without calling tools.' });
            state = 'running';
            runRound(false);
        }
    }

    function researchDone(finalText) {
        state = 'done';
        _currentAbortController = null;
        setStatus('done', 'Research complete.');
        updateControls();
        feedEl.appendChild(buildResultBlock(finalText));
        feedEl.scrollTop = feedEl.scrollHeight;
    }

    function buildResultBlock(text) {
        var wrap = document.createElement('div');
        wrap.className = 'ai-research-result';
        var label = document.createElement('div');
        label.className = 'ai-research-result-label';
        label.textContent = 'Final result';
        wrap.appendChild(label);
        var body = document.createElement('div');
        body.className = 'ai-research-result-body';
        if (text) {
            body.innerHTML = renderMarkdown(text);
            body.querySelectorAll('pre code').forEach(function (b) { if (window.hljs) hljs.highlightElement(b); });
        } else {
            body.textContent = '(no result was produced)';
        }
        wrap.appendChild(body);
        var actions = document.createElement('div');
        actions.className = 'ai-research-result-actions';
        if (text) {
            var copyBtn = document.createElement('button');
            copyBtn.className = 'ai-message-action-btn'; copyBtn.title = 'Copy result'; copyBtn.innerHTML = COPY_ICON;
            copyBtn.addEventListener('click', function () {
                navigator.clipboard.writeText(text).then(function () {
                    copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
                    setTimeout(function () { copyBtn.innerHTML = COPY_ICON; }, 2000);
                });
            });
            actions.appendChild(copyBtn);
            var exportBtn = document.createElement('button');
            exportBtn.className = 'ai-message-action-btn'; exportBtn.title = 'Export result to a note'; exportBtn.innerHTML = EXPORT_ICON;
            exportBtn.addEventListener('click', function () { exportToNote(text); });
            actions.appendChild(exportBtn);
        }
        var newBtn = document.createElement('button');
        newBtn.className = 'ai-research-new-btn'; newBtn.textContent = 'New research';
        newBtn.addEventListener('click', resetSession);
        actions.appendChild(newBtn);
        wrap.appendChild(actions);
        return wrap;
    }

    function exportToNote(text) {
        var title = (topic || 'AI Research').substring(0, 100);
        var payload = { source: 'custom', title: title, content: text };
        if (window.FlaskyE2EE && FlaskyE2EE.isEncrypted()) {
            FlaskyE2EE.encryptField(title).then(function (encTitle) {
                return FlaskyE2EE.encryptField(text).then(function (encContent) {
                    payload.title = encTitle; payload.content = encContent;
                    sendNote(payload, title);
                });
            }).catch(function () { alert('Failed to encrypt note content.'); });
        } else {
            sendNote(payload, title);
        }
    }

    function sendNote(payload, title) {
        fetch('/ai/api/create_note', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify(payload) })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    var toast = document.createElement('div'); toast.className = 'ai-toast';
                    var link = document.createElement('a'); link.href = '/note/' + encodeURIComponent(data.note_id); link.target = '_blank'; link.textContent = title || 'Untitled';
                    toast.textContent = 'Note created: '; toast.appendChild(link);
                    document.body.appendChild(toast);
                    setTimeout(function () { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function () { toast.remove(); }, 300); }, 5000);
                } else { alert(data.error || 'Failed to create note.'); }
            }).catch(function () { alert('Failed to create note.'); });
    }

    function resetSession() {
        state = 'idle';
        transcript = [];
        roundCount = 0;
        topic = '';
        topicInput.value = '';
        feedEl.innerHTML = '';
        setStatus('', '');
        showStart();
        topicInput.focus();
    }

    function destroy() {
        if (_currentAbortController) { try { _currentAbortController.abort(); } catch (e) {} _currentAbortController = null; }
        unbindAll();
        _root = null;
    }

    window.FlaskyResearch = { init: init, destroy: destroy };
})();