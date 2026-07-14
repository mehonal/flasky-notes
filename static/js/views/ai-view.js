/**
 * Flasky Notes — AI chat view module.
 *
 * Reads conversation data from the #ai-view-data JSON block injected by the
 * fragment template. Document-level listeners are tracked for removal in
 * destroy().
 */
(function () {
    'use strict';

    var _root = null;
    var _bound = [];
    var _docBound = [];
    var _currentAbortController = null;

    function bind(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); _bound.push([el, ev, fn]); }
    function bindDoc(el, ev, fn) { el.addEventListener(ev, fn); _docBound.push([el, ev, fn]); }
    function unbindAll() {
        _bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        _docBound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        _bound = []; _docBound = [];
    }

    function init(container) {
        _root = container.querySelector('#ai-root');
        if (!_root) return;

        // If AI is disabled, just wire the settings link + back button; nothing else.
        var dataEl = container.querySelector('#ai-view-data');
        if (!dataEl) {
            var backBtn = container.querySelector('[data-action="router-back"]');
            if (backBtn) backBtn.addEventListener('click', function () { history.back(); });
            return;
        }
        var data = JSON.parse(dataEl.textContent);

        var conversationId = data.conversationId;
        var currentConvData = data.currentConvData;
        var conversations = data.conversations;
        var isStreaming = false;
        var isEncrypted = false;
        var localMessages = [];

        var messagesEl = document.getElementById('ai-messages');
        var inputEl = document.getElementById('ai-input');
        var sendBtn = document.getElementById('ai-send-btn');
        var stopBtn = document.getElementById('ai-stop-btn');
        var newChatBtn = document.getElementById('ai-new-chat-btn');
        var convListEl = document.getElementById('ai-conversation-list');
        var emptyState = document.getElementById('ai-empty-state');
        var toolbarTitle = document.getElementById('ai-toolbar-title');
        var statusText = document.getElementById('ai-status-text');
        var modelSelect = document.getElementById('ai-model-select');

        var sidebar = document.getElementById('ai-sidebar');
        var backdrop = document.getElementById('ai-sidebar-backdrop');
        var panel = document.getElementById('ai-right-panel');
        var panelConvSection = document.getElementById('ai-panel-conversation');
        var panelConvTitle = document.getElementById('ai-panel-conv-title');
        var panelConvCount = document.getElementById('ai-panel-conv-count');
        var panelDeleteBtn = document.getElementById('ai-panel-delete-btn');
        var panelModelName = document.getElementById('ai-panel-model-name');
        var panelConvCreated = document.getElementById('ai-panel-conv-created');
        var panelConvSize = document.getElementById('ai-panel-conv-size');
        var panelExportBtn = document.getElementById('ai-panel-export-btn');
        var panelRenameBtn = document.getElementById('ai-panel-rename-btn');

        function getCSRFToken() {
            var cookie = document.cookie.split('; ').find(function (c) { return c.startsWith('X-CSRF-Token='); });
            return cookie ? cookie.split('=')[1] : '';
        }

        function initE2EE() {
            return FlaskyE2EE.init().then(function (ready) {
                if (!ready) return false;
                isEncrypted = true;
                return true;
            });
        }
        async function encryptIfNeeded(plaintext) { return isEncrypted ? await FlaskyE2EE.encryptField(plaintext) : plaintext; }
        async function decryptIfNeeded(ciphertext) { return isEncrypted ? await FlaskyE2EE.decryptField(ciphertext) : ciphertext; }
        function revealContent() { if (window.FlaskyE2EE) { FlaskyE2EE.revealContent(); _root.removeAttribute('data-encrypted'); } }

        function isMobile() { return window.innerWidth <= 768; }
        function openSidebar() { sidebar.classList.remove('collapsed'); if (isMobile()) backdrop.classList.add('visible'); }
        function closeSidebar() { sidebar.classList.add('collapsed'); backdrop.classList.remove('visible'); }
        function toggleSidebar() { if (sidebar.classList.contains('collapsed')) openSidebar(); else closeSidebar(); }

        bind(document.getElementById('ai-toggle-sidebar'), 'click', toggleSidebar);
        bind(document.getElementById('ai-close-sidebar-btn'), 'click', closeSidebar);
        bind(backdrop, 'click', closeSidebar);
        if (isMobile()) sidebar.classList.add('collapsed');

        function togglePanel() { panel.classList.toggle('collapsed'); }
        bind(document.getElementById('ai-toggle-panel'), 'click', togglePanel);
        var closePanelBtn = document.getElementById('ai-close-panel-btn');
        if (closePanelBtn) bind(closePanelBtn, 'click', function () { panel.classList.add('collapsed'); });

        // Back button
        var backBtn = container.querySelector('[data-action="router-back"]');
        if (backBtn) bind(backBtn, 'click', function () { history.back(); });

        // Dark mode
        var toggleDark = document.getElementById('ai-toggle-dark');
        var themeIcon = document.getElementById('ai-theme-icon');
        bind(toggleDark, 'click', function () {
            var html = document.documentElement;
            var isDark = html.getAttribute('data-theme') === 'dark';
            var newDark = !isDark;
            html.setAttribute('data-theme', newDark ? 'dark' : 'light');
            var darkCSS = document.getElementById('hljs-dark');
            var lightCSS = document.getElementById('hljs-light');
            if (darkCSS && lightCSS) { darkCSS.disabled = !newDark; lightCSS.disabled = newDark; }
            if (themeIcon) themeIcon.innerHTML = newDark
                ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
                : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
            fetch('/api/save_dark_mode/' + (newDark ? 1 : 0), { headers: { 'X-CSRFToken': getCSRFToken() } });
        });

        bind(modelSelect, 'change', function () {
            var newModel = modelSelect.value;
            panelModelName.textContent = newModel;
            fetch('/ai/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify({ model: newModel }) }).catch(function () {});
        });

        bindDoc(document, 'keydown', function (e) {
            if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
            if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); newChatBtn.click(); }
            if (e.key === 'Escape') {
                if (!sidebar.classList.contains('collapsed')) closeSidebar();
                else if (!panel.classList.contains('collapsed')) panel.classList.add('collapsed');
            }
        });

        function renderConversationList(convData) {
            convListEl.innerHTML = '';
            convData.forEach(function (c) {
                var div = document.createElement('div');
                div.className = 'ai-conversation-item' + (c.id === conversationId ? ' active' : '');
                div.dataset.id = c.id;
                var titleSpan = document.createElement('span');
                titleSpan.className = 'ai-conversation-title';
                var displayTitle = c.title || 'Untitled';
                decryptIfNeeded(displayTitle).then(function (dec) { titleSpan.textContent = dec; });
                div.appendChild(titleSpan);
                var del = document.createElement('button');
                del.className = 'ai-conversation-delete'; del.title = 'Delete';
                del.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (confirm('Delete this conversation?')) {
                        fetch('/ai/api/conversations/' + c.id, { method: 'DELETE', headers: { 'X-CSRFToken': getCSRFToken() } }).then(function () {
                            loadConversations();
                            if (conversationId === c.id) { conversationId = null; currentConvData = null; localMessages = []; clearMessages(); updatePanel(); }
                        });
                    }
                });
                var rename = document.createElement('button');
                rename.className = 'ai-conversation-rename'; rename.title = 'Rename';
                rename.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                rename.addEventListener('click', function (e) { e.stopPropagation(); decryptIfNeeded(c.title || 'Untitled').then(function (dec) { promptRename(c.id, dec); }); });
                div.appendChild(rename); div.appendChild(del);
                div.addEventListener('click', function () {
                    conversationId = c.id; currentConvData = c; loadMessages(c.id); loadConversations(); updatePanel();
                    if (isMobile()) closeSidebar();
                });
                titleSpan.addEventListener('dblclick', function (e) { e.stopPropagation(); e.preventDefault(); decryptIfNeeded(c.title || 'Untitled').then(function (dec) { promptRename(c.id, dec); }); });
                convListEl.appendChild(div);
            });
        }

        function loadConversations() {
            fetch('/ai/api/conversations', { headers: { 'X-CSRFToken': getCSRFToken() } }).then(function (r) { return r.json(); }).then(function (convData) { conversations = convData; renderConversationList(convData); });
        }

        function promptRename(convId, currentTitle) {
            var newTitle = prompt('Rename conversation:', currentTitle);
            if (newTitle === null || !newTitle.trim()) return;
            newTitle = newTitle.trim();
            encryptIfNeeded(newTitle).then(function (enc) { doRename(convId, enc); });
        }
        function doRename(convId, title) {
            fetch('/ai/api/conversations/' + convId + '/rename', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify({ title: title }) }).then(function (r) { return r.json(); }).then(function (data) {
                if (data.error) { alert(data.error); return; }
                loadConversations();
                if (conversationId === convId) { currentConvData = data; updatePanel(); }
            });
        }

        function clearMessages() {
            messagesEl.innerHTML = ''; localMessages = [];
            var empty = document.createElement('div');
            empty.className = 'ai-empty-state'; empty.id = 'ai-empty-state';
            empty.innerHTML = '<div class="ai-empty-state-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="ai-empty-state-title">Start a conversation</div><div class="ai-empty-state-subtitle">Type a message below to begin chatting with AI.</div>';
            messagesEl.appendChild(empty); emptyState = empty;
        }

        function escapeHtml(text) { var d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

        var SANITIZE_CONFIG = { ALLOWED_TAGS: ['p','br','strong','em','a','code','pre','ul','ol','li','h1','h2','h3','h4','h5','h6','blockquote','table','thead','tbody','tr','th','td','hr','img','del','s','sup','sub'], ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'], ALLOW_DATA_ATTR: false };
        function renderMarkdown(text) { try { return DOMPurify.sanitize(marked.parse(text), SANITIZE_CONFIG); } catch (e) { return escapeHtml(text); } }

        var COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        var REGEN_ICON = '<svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

        function addCopyButtons(c) {
            c.querySelectorAll('pre').forEach(function (pre) {
                if (pre.querySelector('.ai-code-copy-btn')) return;
                var btn = document.createElement('button');
                btn.className = 'ai-code-copy-btn'; btn.title = 'Copy code'; btn.setAttribute('aria-label', 'Copy code');
                btn.innerHTML = COPY_ICON;
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    var code = pre.querySelector('code'); var text = code ? code.textContent : pre.textContent;
                    navigator.clipboard.writeText(text).then(function () {
                        btn.classList.add('copied'); btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
                        setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = COPY_ICON; }, 2000);
                    });
                });
                pre.style.position = 'relative'; pre.appendChild(btn);
            });
        }

        function addMessageBubble(role, content, doRender, messageId) {
            if (emptyState && emptyState.parentNode) emptyState.remove();
            var wrapper = document.createElement('div');
            wrapper.className = 'ai-message ai-message-' + role;
            if (messageId) wrapper.dataset.messageId = messageId;
            var avatar = document.createElement('div'); avatar.className = 'ai-message-avatar'; avatar.textContent = role === 'user' ? 'U' : 'AI'; wrapper.appendChild(avatar);
            var contentDiv = document.createElement('div'); contentDiv.className = 'ai-message-content';
            if (role === 'assistant' && doRender !== false) {
                contentDiv.innerHTML = renderMarkdown(content);
                setTimeout(function () { contentDiv.querySelectorAll('pre code').forEach(function (b) { hljs.highlightElement(b); }); addCopyButtons(contentDiv); }, 0);
            } else { contentDiv.textContent = content; }
            wrapper.appendChild(contentDiv);
            if (content) {
                var actions = document.createElement('div'); actions.className = 'ai-message-actions';
                var copyBtn = document.createElement('button'); copyBtn.className = 'ai-message-action-btn'; copyBtn.title = 'Copy message'; copyBtn.setAttribute('aria-label', 'Copy message'); copyBtn.innerHTML = COPY_ICON;
                copyBtn.addEventListener('click', function () { navigator.clipboard.writeText(content).then(function () { copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'; setTimeout(function () { copyBtn.innerHTML = COPY_ICON; }, 2000); }); });
                actions.appendChild(copyBtn);
                if (role === 'assistant') {
                    var noteBtn = document.createElement('button'); noteBtn.className = 'ai-message-action-btn'; noteBtn.title = 'Create note from this message'; noteBtn.setAttribute('aria-label', 'Create note from this message');
                    noteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
                    noteBtn.addEventListener('click', function () { createNoteFromMessage(content, messageId); });
                    actions.appendChild(noteBtn);
                }
                wrapper.appendChild(actions);
            }
            messagesEl.appendChild(wrapper); messagesEl.scrollTop = messagesEl.scrollHeight;
            return contentDiv;
        }

        async function createNoteFromAi(title, content) {
            var payload = { source: 'custom', title: title, content: content };
            if (isEncrypted) { try { payload.title = await encryptIfNeeded(title); payload.content = await encryptIfNeeded(content); } catch (e) { alert('Failed to encrypt note content.'); return; } }
            fetch('/ai/api/create_note', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify(payload) })
                .then(function (r) { return r.json(); }).then(function (data) { if (data.success) showNoteToast('Note created: ', data.note_id, title); else alert(data.error || 'Failed to create note.'); }).catch(function () { alert('Failed to create note.'); });
        }

        function showNoteToast(prefix, noteId, title) {
            var toast = document.createElement('div'); toast.className = 'ai-toast';
            var link = document.createElement('a'); link.href = '/note/' + encodeURIComponent(noteId); link.target = '_blank'; link.textContent = title || 'Untitled';
            toast.textContent = ''; toast.appendChild(document.createTextNode(prefix)); toast.appendChild(link);
            document.body.appendChild(toast);
            setTimeout(function () { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function () { toast.remove(); }, 300); }, 5000);
        }

        function createNoteFromMessage(content, messageId) {
            var title = content.split('\n')[0].substring(0, 100); title = title.replace(/^#+\s*/, '').trim() || 'AI Chat Note';
            createNoteFromAi(title, content);
        }

        function exportConversationToNote() {
            if (!conversationId) { alert('No active conversation to export.'); return; }
            var lines = [];
            for (var i = 0; i < localMessages.length; i++) { var m = localMessages[i]; lines.push('**' + (m.role === 'user' ? 'You' : 'AI') + ':** ' + m.content); }
            var content = lines.join('\n\n---\n\n');
            if (!content) { alert('No messages to export.'); return; }
            (currentConvData && currentConvData.title ? decryptIfNeeded(currentConvData.title) : Promise.resolve(null)).then(function (dec) { createNoteFromAi(dec || 'AI Chat Export', content); });
        }
        bind(panelExportBtn, 'click', exportConversationToNote);

        function formatRelativeDate(dateStr) {
            if (!dateStr) return '—';
            var d = new Date(dateStr); var now = new Date(); var diffMs = now - d; var diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'Just now'; if (diffMins < 60) return diffMins + 'm ago';
            var diffHours = Math.floor(diffMins / 60); if (diffHours < 24) return diffHours + 'h ago';
            var diffDays = Math.floor(diffHours / 24); if (diffDays < 7) return diffDays + 'd ago';
            return d.toLocaleDateString();
        }
        function formatCharCount(chars) { if (chars < 1000) return chars + ' chars'; if (chars < 1000000) return (chars / 1000).toFixed(1) + 'k chars'; return (chars / 1000000).toFixed(1) + 'M chars'; }

        function updatePanel() {
            panelModelName.textContent = modelSelect.value;
            if (conversationId && currentConvData) {
                panelConvSection.style.display = '';
                decryptIfNeeded(currentConvData.title || 'Untitled').then(function (dec) { panelConvTitle.textContent = dec; toolbarTitle.textContent = dec; });
                panelConvCreated.textContent = formatRelativeDate(currentConvData.created_at);
                var userCount = 0, assistantCount = 0, totalChars = 0;
                for (var i = 0; i < localMessages.length; i++) { if (localMessages[i].role === 'user') userCount++; else if (localMessages[i].role === 'assistant') assistantCount++; totalChars += (localMessages[i].content || '').length; }
                panelConvCount.textContent = localMessages.length + ' (' + userCount + ' you, ' + assistantCount + ' AI)';
                panelConvSize.textContent = formatCharCount(totalChars);
            } else { panelConvSection.style.display = 'none'; toolbarTitle.textContent = 'AI Chat'; }
        }

        function loadMessages(convId) {
            localMessages = [];
            fetch('/ai/api/conversations/' + convId + '/messages', { headers: { 'X-CSRFToken': getCSRFToken() } }).then(function (r) { return r.json(); }).then(function (msgs) {
                messagesEl.innerHTML = '';
                if (msgs.length === 0) {
                    var empty = document.createElement('div'); empty.className = 'ai-empty-state'; empty.id = 'ai-empty-state';
                    empty.innerHTML = '<div class="ai-empty-state-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="ai-empty-state-title">No messages yet</div><div class="ai-empty-state-subtitle">Type something below to start chatting.</div>';
                    messagesEl.appendChild(empty); emptyState = empty;
                } else {
                    emptyState = null;
                    (async function () {
                        for (var i = 0; i < msgs.length; i++) {
                            var m = msgs[i]; var content = m.content;
                            if (isEncrypted) { try { content = await decryptIfNeeded(m.content); } catch (e) {} }
                            localMessages.push({ role: m.role, content: content });
                            addMessageBubble(m.role, content, true, m.id);
                        }
                        updatePanel();
                    })();
                }
            });
        }

        bind(panelDeleteBtn, 'click', function () {
            if (!conversationId) return;
            if (confirm('Delete this conversation?')) {
                fetch('/ai/api/conversations/' + conversationId, { method: 'DELETE', headers: { 'X-CSRFToken': getCSRFToken() } }).then(function () { conversationId = null; currentConvData = null; localMessages = []; clearMessages(); loadConversations(); updatePanel(); });
            }
        });
        bind(panelRenameBtn, 'click', function () {
            if (!conversationId) return;
            decryptIfNeeded(currentConvData ? (currentConvData.title || 'Untitled') : 'Untitled').then(function (dec) { promptRename(conversationId, dec); });
        });

        async function sendMessage() {
            var text = inputEl.value.trim();
            if (!text || isStreaming) return;
            inputEl.value = ''; inputEl.style.height = 'auto';
            addMessageBubble('user', text, false);
            localMessages.push({ role: 'user', content: text });
            statusText.innerHTML = '<span class="ai-status-streaming">Sending...</span>';
            var encryptedTitle = text.substring(0, 100), encryptedMessage = text;
            if (isEncrypted) { encryptedTitle = await encryptIfNeeded(text.substring(0, 100)); encryptedMessage = await encryptIfNeeded(text); }
            if (!conversationId) {
                fetch('/ai/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify({ title: encryptedTitle }) })
                    .then(function (r) { return r.json(); }).then(function (data) {
                        if (data.error) { alert(data.error); statusText.textContent = 'Ready'; return; }
                        conversationId = data.id; currentConvData = data; updatePanel(); loadConversations(); streamResponse(encryptedMessage);
                    });
            } else { streamResponse(encryptedMessage); }
        }

        function stopGeneration() { if (_currentAbortController) { _currentAbortController.abort(); _currentAbortController = null; } }
        bind(stopBtn, 'click', stopGeneration);

        function streamResponse(encryptedMessage) {
            isStreaming = true; sendBtn.style.display = 'none'; stopBtn.style.display = 'flex'; inputEl.disabled = true;
            statusText.innerHTML = '<span class="ai-status-streaming">Thinking...</span>';
            var assistantDiv = addMessageBubble('assistant', '', false);
            assistantDiv.classList.add('ai-cursor-blink');
            var abortController = new AbortController(); _currentAbortController = abortController;
            var chatBody = { message: encryptedMessage };
            if (isEncrypted) chatBody.messages = localMessages;
            fetch('/ai/api/conversations/' + conversationId + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify(chatBody), signal: abortController.signal })
                .then(function (response) {
                    if (!response.ok) {
                        response.text().then(function (t) {
                            var errorMsg = 'Something went wrong. Please try again.';
                            try { var errData = JSON.parse(t); errorMsg = errData.error || errorMsg; } catch (e) {}
                            var errWrapper = assistantDiv.closest('.ai-message'); if (errWrapper) errWrapper.classList.add('ai-message-error');
                            assistantDiv.textContent = errorMsg;
                            var retryBtn = document.createElement('button'); retryBtn.className = 'ai-error-retry-btn'; retryBtn.innerHTML = REGEN_ICON + ' Retry';
                            retryBtn.addEventListener('click', function () {
                                if (errWrapper) errWrapper.remove();
                                var lastUserMsg = ''; for (var i = localMessages.length - 1; i >= 0; i--) { if (localMessages[i].role === 'user') { lastUserMsg = localMessages[i].content; break; } }
                                if (lastUserMsg) { localMessages.pop(); var prev = localMessages[localMessages.length - 1]; if (prev && prev.role === 'user') { inputEl.value = prev.content; localMessages.pop(); } sendMessage(); }
                            });
                            assistantDiv.appendChild(document.createElement('br')); assistantDiv.appendChild(retryBtn); assistantDiv.classList.remove('ai-cursor-blink');
                            isStreaming = false; sendBtn.style.display = 'flex'; stopBtn.style.display = 'none'; inputEl.disabled = false; statusText.textContent = 'Error';
                        });
                        return;
                    }
                    var reader = response.body.getReader(); var decoder = new TextDecoder(); var fullText = ''; var streamFinished = false;
                    function read() {
                        reader.read().then(function (result) {
                            if (result.done) { if (!streamFinished) { streamFinished = true; finishStream(assistantDiv, fullText, null, false); } return; }
                            var chunk = decoder.decode(result.value, { stream: true });
                            chunk.split('\n').forEach(function (line) {
                                if (line.startsWith('data: ')) {
                                    try {
                                        var data = JSON.parse(line.substring(6));
                                        if (data.chunk) { fullText += data.chunk; assistantDiv.textContent = fullText; messagesEl.scrollTop = messagesEl.scrollHeight; statusText.innerHTML = '<span class="ai-status-streaming">Streaming...</span>'; }
                                        else if (data.error) { streamFinished = true; assistantDiv.textContent = data.error; assistantDiv.classList.remove('ai-cursor-blink'); isStreaming = false; sendBtn.style.display = 'flex'; stopBtn.style.display = 'none'; inputEl.disabled = false; statusText.textContent = 'Error'; }
                                        else if (data.done) { streamFinished = true; finishStream(assistantDiv, fullText, data.message_id, true); }
                                    } catch (e) {}
                                }
                            });
                            read();
                        }).catch(function (err) { if (err.name === 'AbortError' && !streamFinished) { streamFinished = true; reader.cancel(); finishStream(assistantDiv, fullText, null, false); } });
                    }
                    read();
                }).catch(function (err) {
                    if (err.name === 'AbortError') return;
                    var errWrapper = assistantDiv.closest('.ai-message'); if (errWrapper) errWrapper.classList.add('ai-message-error');
                    assistantDiv.textContent = 'Connection error. Please try again.';
                    var retryBtn = document.createElement('button'); retryBtn.className = 'ai-error-retry-btn'; retryBtn.innerHTML = REGEN_ICON + ' Retry';
                    retryBtn.addEventListener('click', function () {
                        if (errWrapper) errWrapper.remove();
                        if (localMessages.length > 0) { var lastUserMsg = ''; for (var i = localMessages.length - 1; i >= 0; i--) { if (localMessages[i].role === 'user') { lastUserMsg = localMessages[i].content; break; } } if (lastUserMsg) { localMessages.pop(); inputEl.value = lastUserMsg; sendMessage(); } }
                    });
                    assistantDiv.appendChild(document.createElement('br')); assistantDiv.appendChild(retryBtn); assistantDiv.classList.remove('ai-cursor-blink');
                    isStreaming = false; sendBtn.style.display = 'flex'; stopBtn.style.display = 'none'; inputEl.disabled = false; statusText.textContent = 'Error';
                });

            function finishStream(div, text, messageId, wasClean) {
                div.classList.remove('ai-cursor-blink');
                if (text) { div.innerHTML = renderMarkdown(text); div.querySelectorAll('pre code').forEach(function (b) { hljs.highlightElement(b); }); addCopyButtons(div); localMessages.push({ role: 'assistant', content: text }); }
                if (messageId) {
                    var wrapper = div.closest('.ai-message');
                    if (wrapper) {
                        wrapper.dataset.messageId = messageId;
                        var existingActions = wrapper.querySelector('.ai-message-actions'); if (existingActions) existingActions.remove();
                        var actions = document.createElement('div'); actions.className = 'ai-message-actions';
                        var copyBtn = document.createElement('button'); copyBtn.className = 'ai-message-action-btn'; copyBtn.title = 'Copy message'; copyBtn.setAttribute('aria-label', 'Copy message'); copyBtn.innerHTML = COPY_ICON;
                        var capturedText = text;
                        copyBtn.addEventListener('click', function () { navigator.clipboard.writeText(capturedText).then(function () { copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'; setTimeout(function () { copyBtn.innerHTML = COPY_ICON; }, 2000); }); });
                        actions.appendChild(copyBtn);
                        var noteBtn = document.createElement('button'); noteBtn.className = 'ai-message-action-btn'; noteBtn.title = 'Create note from this message'; noteBtn.setAttribute('aria-label', 'Create note from this message');
                        noteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
                        noteBtn.addEventListener('click', function () { createNoteFromMessage(capturedText, messageId); });
                        actions.appendChild(noteBtn);
                        var regenBtn = document.createElement('button'); regenBtn.className = 'ai-message-action-btn'; regenBtn.title = 'Regenerate response'; regenBtn.setAttribute('aria-label', 'Regenerate response'); regenBtn.innerHTML = REGEN_ICON;
                        regenBtn.addEventListener('click', function () {
                            if (isStreaming) return;
                            var msgWrapper = div.closest('.ai-message');
                            if (msgWrapper) { var prev = msgWrapper.previousElementSibling; if (prev && prev.classList.contains('ai-message-user')) { msgWrapper.remove(); if (prev.parentNode) prev.remove(); } else { msgWrapper.remove(); } }
                            if (localMessages.length >= 2) localMessages.splice(-2, 2);
                            if (conversationId) { inputEl.value = ''; var lastUserMsg = ''; for (var i = localMessages.length - 1; i >= 0; i--) { if (localMessages[i].role === 'user') { lastUserMsg = localMessages[i].content; break; } } if (!lastUserMsg && localMessages.length > 0) lastUserMsg = localMessages[localMessages.length - 1].content; if (lastUserMsg) { inputEl.value = lastUserMsg; sendMessage(); } }
                        });
                        actions.appendChild(regenBtn); wrapper.appendChild(actions);
                    }
                }
                if (isEncrypted && messageId && text) { encryptIfNeeded(text).then(function (enc) { fetch('/ai/api/messages/' + messageId + '/encrypt', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify({ content: enc }) }).catch(function () {}); }); }
                isStreaming = false; sendBtn.style.display = 'flex'; stopBtn.style.display = 'none'; inputEl.disabled = false; statusText.textContent = wasClean ? 'Ready' : 'Stopped'; inputEl.focus(); _currentAbortController = null; loadConversations(); updatePanel();
            }
        }

        bind(sendBtn, 'click', sendMessage);
        bind(inputEl, 'keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
        bind(newChatBtn, 'click', function () { conversationId = null; currentConvData = null; localMessages = []; clearMessages(); loadConversations(); updatePanel(); inputEl.focus(); if (isMobile()) closeSidebar(); });
        bind(inputEl, 'input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 160) + 'px'; });
        bindDoc(document, 'click', function (e) { var btn = e.target.closest('.ai-suggestion-btn'); if (btn && btn.dataset.prompt) { inputEl.value = btn.dataset.prompt; inputEl.focus(); inputEl.dispatchEvent(new Event('input')); } });

        (async function () {
            await initE2EE();
            revealContent();
            loadConversations();
            updatePanel();
            if (conversationId) loadMessages(conversationId);
        })();
    }

    function destroy() {
        if (_currentAbortController) { try { _currentAbortController.abort(); } catch (e) {} _currentAbortController = null; }
        unbindAll();
        _root = null;
    }

    window.FlaskyViews = window.FlaskyViews || {};
    window.FlaskyViews.ai = { init: init, destroy: destroy };
})();