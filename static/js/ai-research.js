/**
 * Flasky Notes — AI Research mode module.
 *
 * Client-driven research loop: the browser issues one bounded
 * POST /ai/api/research/round request per round, maintains the full
 * transcript locally, and renders streamed chunks/tool activity live.
 * The server persists nothing. The user can stop the current round,
 * steer the research live (mid-round or between rounds), force a final
 * answer, or follow up on a finished result. Partial findings are
 * always preserved: on errors, connection loss, or user-initiated
 * aborts, whatever the model produced so far is salvaged into the
 * transcript and the user can resume without losing progress.
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
    // Round generation guard: incremented whenever a round is superseded
    // (aborted/reset). In-flight async handlers compare their captured gen
    // and no-op if stale, so an aborted round can never clobber the state
    // of the round that replaced it.
    var roundGen = 0;
    var _roundPartial = '';
    // Tool context for the in-flight round, one entry per tool iteration
    // (the server mirrors each assistant tool-call message): an assistant
    // message with tool_calls plus its tool results, reconstructed into the
    // transcript so later rounds reuse the raw sources instead of re-searching.
    var _roundToolContext = [];

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
        statusEl, feedEl, stopBtn, finishBtn, resumeBtn, redirectRow,
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
        resumeBtn = $('ai-research-resume-btn');
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
        bind(resumeBtn, 'click', resumeResearch);
        bind(redirectSendBtn, 'click', sendInstruction);
        bind(redirectInput, 'keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); sendInstruction(); }
        });
    }

    function openModal() { modal.style.display = 'flex'; if (state === 'idle') topicInput.focus(); else redirectInput.focus(); }

    function closeModal() {
        if (state === 'running') {
            if (!confirm('Research is still running. Close the panel? (The current round will be stopped; partial findings are preserved and you can resume.)')) return;
            stopRound();
        }
        modal.style.display = 'none';
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
        resumeBtn.style.display = state === 'paused' ? '' : 'none';
        // Instruct row: live steering while running, redirect while paused,
        // follow-up when done. Hidden only in idle.
        redirectRow.style.display = (state === 'running' || state === 'paused' || state === 'done') ? 'flex' : 'none';
        redirectSendBtn.textContent = busy ? 'Send' : (state === 'done' ? 'Follow up' : 'Apply');
        redirectInput.placeholder = busy
            ? 'Steer the research live (applied after current output is preserved)'
            : (state === 'done' ? 'Ask a follow-up question about the result' : 'e.g. Focus on pricing, skip the history');
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

    function abortCurrentRound() {
        if (_currentAbortController) {
            roundGen += 1;
            // Salvage synchronously: the reader's abort handler may or may
            // not have fired yet, so capture whatever partial content the
            // round produced right here before nulling the controller.
            _currentAbortController.abort();
            _currentAbortController = null;
            salvageRound(_roundPartial, _roundToolContext);
            _roundPartial = '';
            _roundToolContext = [];
        }
    }

    function stopRound() {
        if (state !== 'running') return;
        abortCurrentRound();
        state = 'paused';
        setStatus('paused', 'Stopped. Partial findings preserved. Redirect, resume, or finish.');
        addFeedEntry('ai-research-feed-note', '— Stopped by user —');
        updateControls();
    }

    function finishNow() {
        if (state !== 'paused' && state !== 'running') return;
        abortCurrentRound();
        runRound(true);
    }

    function resumeResearch() {
        if (state !== 'paused') return;
        transcript.push({ role: 'user', content: 'Continue researching based on your findings so far. If you have enough information, give your final answer without calling tools.' });
        runRound(false);
    }

    function sendInstruction() {
        var instruction = redirectInput.value.trim();
        if (!instruction) { redirectInput.focus(); return; }
        if (state === 'running') {
            redirectInput.value = '';
            abortCurrentRound();
            addFeedEntry('ai-research-feed-note', '— Round stopped —');
            applyInstruction(instruction);
        } else if (state === 'paused' || state === 'done') {
            redirectInput.value = '';
            applyInstruction(instruction);
        }
    }

    function applyInstruction(instruction) {
        transcript.push({ role: 'user', content: 'Redirect instruction: ' + instruction + '\n\nContinue the research accordingly. If you already have enough information, give your final answer without calling tools.' });
        addFeedEntry('ai-research-feed-redirect', (state === 'done' ? 'Follow-up: ' : 'Redirect: ') + instruction);
        runRound(false);
    }

    function runRound(finish) {
        state = 'running';
        roundCount += 1;
        updateControls();
        setStatus('running-text', 'Round ' + roundCount + ' — researching...');
        var abortController = new AbortController();
        _currentAbortController = abortController;
        var gen = roundGen;
        _roundPartial = '';
        _roundToolContext = [];

        var toolLinesEl = null;

        fetch('/ai/api/research/round', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify({ messages: transcript, finish: finish }),
            signal: abortController.signal
        }).then(function (response) {
            if (gen !== roundGen) return;
            if (!response.ok) {
                response.text().then(function (t) {
                    if (gen !== roundGen) return;
                    var errorMsg = 'Something went wrong. Please try again.';
                    try { var errData = JSON.parse(t); errorMsg = errData.error || errorMsg; } catch (e) {}
                    roundFailed(errorMsg, '');
                });
                return;
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var roundFinished = false;

            function read() {
                reader.read().then(function (result) {
                    if (gen !== roundGen) { reader.cancel(); return; }
                    if (result.done) { if (!roundFinished) { roundFinished = true; roundFailed('Connection lost.', _roundPartial, _roundToolContext); } return; }
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
                                else if (data.tool_calls) {
                                    // Server mirrors the assistant tool-call
                                    // message; hold it until its results arrive.
                                    _roundToolContext.push({ role: 'assistant', content: data.text || '', tool_calls: data.tool_calls, results: [] });
                                }
                                else if (data.tool_result) {
                                    var ctx = _roundToolContext[_roundToolContext.length - 1];
                                    if (ctx) {
                                        ctx.results.push({ role: 'tool', content: data.content, tool_name: data.name });
                                    }
                                }
                                else if (data.chunk) {
                                    _roundPartial += data.chunk;
                                    setStatus('running-text', 'Round ' + roundCount + ' — thinking...');
                                }
                                else if (data.error) {
                                    roundFinished = true;
                                    roundFailed(data.error, _roundPartial, _roundToolContext);
                                }
                                else if (data.round_done) {
                                    roundFinished = true;
                                    roundComplete(data.content, data.last_text, data.final, finish);
                                }
                            } catch (e) {}
                        }
                    });
                    read();
                }).catch(function (err) {
                    if (gen !== roundGen) return;
                    // Abort handling (salvage + state transition) is done
                    // synchronously by the caller that aborted; nothing to
                    // do here.
                    if (err.name === 'AbortError') { try { reader.cancel(); } catch (e) {} }
                });
            }
            read();
        }).catch(function (err) {
            if (gen !== roundGen) return;
            if (err.name === 'AbortError') return;
            roundFailed('Connection error. Please try again.', _roundPartial, _roundToolContext);
        });
    }

    // Salvage a round that ended unexpectedly: keep whatever the model
    // produced (text so far + tool call/result context) in the transcript
    // so later rounds can build on it without re-searching.
    function salvageRound(partialContent, toolContext) {
        var iterations = Array.isArray(toolContext) ? toolContext : [];
        var iterText = '';
        iterations.forEach(function (ctx) {
            transcript.push({ role: 'assistant', content: ctx.content || '', tool_calls: ctx.tool_calls });
            ctx.results.forEach(function (r) { transcript.push(r); });
            iterText += ctx.content || '';
        });
        // _roundPartial accumulates text across all iterations; the suffix
        // beyond the flushed iterations is the in-flight iteration's text.
        var currentPartial = (partialContent && partialContent.startsWith(iterText))
            ? partialContent.substring(iterText.length)
            : (partialContent || '');
        if (currentPartial && currentPartial.trim()) {
            transcript.push({ role: 'assistant', content: currentPartial });
        }
        var shown = currentPartial.trim() ? currentPartial : (iterations.length ? '' : (partialContent || ''));
        if (shown && shown.trim()) {
            addFeedEntry('ai-research-feed-round', 'Round ' + roundCount + ' findings (partial, preserved):');
            var entry = document.createElement('div');
            entry.className = 'ai-research-feed-content';
            entry.innerHTML = renderMarkdown(shown);
            feedEl.appendChild(entry);
            entry.querySelectorAll('pre code').forEach(function (b) { if (window.hljs) hljs.highlightElement(b); });
            feedEl.scrollTop = feedEl.scrollHeight;
        }
    }

    function roundFailed(errorMsg, partialContent, toolContext) {
        _currentAbortController = null;
        var iterations = Array.isArray(toolContext) ? toolContext : [];
        var preserved = (partialContent && partialContent.trim()) || iterations.some(function (c) { return c.content.trim() || c.results.length; });
        salvageRound(partialContent, toolContext);
        state = 'paused';
        setStatus('error', errorMsg + (preserved ? ' Partial findings preserved. Resume, redirect, or finish.' : ' Resume, redirect, or finish.'));
        addFeedEntry('ai-research-feed-error', errorMsg);
        updateControls();
    }

    function roundComplete(content, lastText, final, wasFinish) {
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
        // Reconstruct the round in the transcript exactly as the server built
        // it for the model: for each tool iteration an assistant message
        // (text + tool_calls) followed by the tool results, then the final
        // assistant text.
        _roundToolContext.forEach(function (ctx) {
            transcript.push({ role: 'assistant', content: ctx.content || '', tool_calls: ctx.tool_calls });
            ctx.results.forEach(function (r) { transcript.push(r); });
        });
        _roundToolContext = [];
        transcript.push({ role: 'assistant', content: (lastText && lastText.trim()) ? lastText : (content || '') });

        if (final || wasFinish || roundCount >= maxRounds) {
            // last_text is the model's final segment for this round (not
            // accumulated prior iterations) — the result block and export
            // use it, avoiding duplicated interim text.
            researchDone((lastText && lastText.trim()) ? lastText : (content || ''));
        } else {
            transcript.push({ role: 'user', content: 'Continue researching based on your findings so far. If you have enough information, give your final answer without calling tools.' });
            state = 'running';
            runRound(false);
        }
    }

    function researchDone(finalText) {
        state = 'done';
        _currentAbortController = null;
        setStatus('done', 'Research complete. Ask a follow-up, or export the result.');
        updateControls();
        feedEl.appendChild(buildResultBlock(finalText));
        feedEl.scrollTop = feedEl.scrollHeight;
        redirectInput.focus();
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
        _roundPartial = '';
        _roundToolContext = [];
        topicInput.value = '';
        redirectInput.value = '';
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