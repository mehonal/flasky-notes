/* CLI Theme — Vim Editor Module
 *
 * Depends on DOM elements: #vim-overlay, #vim-titlebar, #vim-content,
 * #vim-status-mode, #vim-status-msg, #vim-status-file, #vim-status-pos,
 * #vim-commandline, #vim-cmd-prefix, #vim-cmd-input
 *
 * Exposes window.CliVim with:
 *   open(type, id, title, content)
 *   close()
 *   isActive()
 */
(function() {
    'use strict';

    // --- DOM refs (resolved once on first open) ---
    let vimOverlay, vimTitlebar, vimContent, vimStatusMode, vimStatusMsg,
        vimStatusFile, vimStatusPos, vimCommandLine, vimCmdInput;

    function resolveDOM() {
        vimOverlay    = document.getElementById('vim-overlay');
        vimTitlebar   = document.getElementById('vim-titlebar');
        vimContent    = document.getElementById('vim-content');
        vimStatusMode = document.getElementById('vim-status-mode');
        vimStatusMsg  = document.getElementById('vim-status-msg');
        vimStatusFile = document.getElementById('vim-status-file');
        vimStatusPos  = document.getElementById('vim-status-pos');
        vimCommandLine = document.getElementById('vim-commandline');
        vimCmdInput   = document.getElementById('vim-cmd-input');
    }

    // --- State ---
    let vimMode = 'normal';
    let vimOriginalTitle = '';
    let vimOriginalContent = '';
    let vimPendingKey = null;
    let vimClipboard = '';
    let vimClipboardLinewise = false;
    let vimEditingType = null;
    let vimEditingId = null;
    let vimTitle = '';
    let vimMsgTimeout = null;
    let vimUndoStack = [];
    let vimRedoStack = [];
    let vimLastFind = null;
    let vimVisual = null;
    let vimCursorOffset = 0;

    // --- Callbacks (set by the main CLI module) ---
    let onSave = null;   // async (type, id, title, content) => bool
    let onClose = null;  // () => void

    // --- Undo ---

    function vimPushUndo() {
        vimUndoStack.push({ content: vimContent.value, offset: vimCursorOffset });
        vimRedoStack = [];
        if (vimUndoStack.length > 200) vimUndoStack.shift();
    }

    // --- Public API ---

    function open(type, id, title, content) {
        if (!vimOverlay) resolveDOM();
        vimEditingType = type;
        vimEditingId = id;
        vimTitle = title;
        vimOriginalTitle = title;
        vimOriginalContent = content;
        vimContent.value = content;
        vimTitlebar.textContent = type + ' #' + id + ' \u2014 ' + title;
        vimMode = 'normal';
        vimPendingKey = null;
        vimVisual = null;
        vimCursorOffset = 0;
        vimUndoStack = [];
        vimRedoStack = [];
        vimContent.classList.add('vim-normal');
        vimOverlay.classList.add('active');
        vimCommandLine.classList.remove('active');
        vimContent.focus();
        vimContent.setSelectionRange(0, 0);
        updateVimStatusLine();
    }

    function isActive() {
        return vimOverlay && vimOverlay.classList.contains('active');
    }

    function isDirty() {
        return vimContent.value !== vimOriginalContent || vimTitle !== vimOriginalTitle;
    }

    async function save() {
        if (!onSave) return false;
        const ok = await onSave(vimEditingType, vimEditingId, vimTitle, vimContent.value);
        if (ok) {
            vimOriginalTitle = vimTitle;
            vimOriginalContent = vimContent.value;
            showMsg('"' + vimTitle + '" written');
        } else {
            showMsg('Error saving!', true);
        }
        return ok;
    }

    function close() {
        vimOverlay.classList.remove('active');
        vimEditingType = null;
        vimEditingId = null;
        vimMode = 'normal';
        vimVisual = null;
        if (onClose) onClose();
    }

    async function saveAndClose() {
        const ok = await save();
        if (ok) close();
        return ok;
    }

    // --- Status helpers ---

    function showMsg(msg, isError) {
        vimStatusMsg.textContent = msg;
        vimStatusMsg.style.color = isError ? '#ff6b6b' : '#ffd93d';
        clearTimeout(vimMsgTimeout);
        vimMsgTimeout = setTimeout(function() { vimStatusMsg.textContent = ''; }, 3000);
    }

    function setMode(mode) {
        if (mode === 'insert' && vimMode !== 'insert') vimPushUndo();
        if (mode !== 'normal' && vimVisual) exitVisual();
        vimMode = mode;
        vimPendingKey = null;
        if (mode === 'normal') {
            vimContent.classList.add('vim-normal');
            vimCommandLine.classList.remove('active');
            vimContent.focus();
        } else if (mode === 'insert') {
            vimContent.classList.remove('vim-normal');
            vimCommandLine.classList.remove('active');
            vimContent.focus();
        } else if (mode === 'command') {
            vimContent.classList.add('vim-normal');
            vimCommandLine.classList.add('active');
            vimCmdInput.value = '';
            vimCmdInput.focus();
        }
        updateVimStatusLine();
    }

    function updateVimStatusLine() {
        if (vimMode === 'insert') {
            vimStatusMode.textContent = '-- INSERT --';
        } else if (vimMode === 'command') {
            vimStatusMode.textContent = '';
        } else if (vimVisual) {
            vimStatusMode.textContent = vimVisual.mode === 'line' ? '-- VISUAL LINE --' : '-- VISUAL --';
        } else {
            vimStatusMode.textContent = '';
        }
        vimStatusFile.textContent = vimEditingType + ' #' + vimEditingId;
        var pos = getCursorPos();
        vimStatusPos.textContent = (pos.line + 1) + ',' + (pos.col + 1);
    }

    // --- Cursor helpers ---

    function getCursorPos() {
        var text = vimContent.value;
        var before = text.substring(0, vimCursorOffset);
        var lines = before.split('\n');
        return { line: lines.length - 1, col: lines[lines.length - 1].length };
    }

    function getLines() {
        return vimContent.value.split('\n');
    }

    function getLineStartOffset(lineNum) {
        var lines = getLines();
        var offset = 0;
        for (var i = 0; i < lineNum && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset;
    }

    function setCursorOffset(offset) {
        offset = Math.max(0, Math.min(offset, vimContent.value.length));
        vimCursorOffset = offset;
        if (!vimVisual) {
            vimContent.setSelectionRange(offset, offset);
        }
        updateVimStatusLine();
    }

    function setCursorPos(line, col) {
        var lines = getLines();
        line = Math.max(0, Math.min(line, lines.length - 1));
        col = Math.max(0, Math.min(col, Math.max(0, lines[line].length - 1)));
        setCursorOffset(getLineStartOffset(line) + col);
    }

    // --- Find-char helpers ---

    function findChar(ch, direction) {
        var pos = getCursorPos();
        var lineStart = getLineStartOffset(pos.line);
        var lineText = getLines()[pos.line];

        if (direction === 'f') {
            var idx = lineText.indexOf(ch, pos.col + 1);
            if (idx >= 0) return lineStart + idx;
        } else if (direction === 'F') {
            var idx = lineText.lastIndexOf(ch, pos.col - 1);
            if (idx >= 0) return lineStart + idx;
        } else if (direction === 't') {
            var idx = lineText.indexOf(ch, pos.col + 1);
            if (idx >= 1) return lineStart + idx - 1;
        } else if (direction === 'T') {
            var idx = lineText.lastIndexOf(ch, pos.col - 1);
            if (idx >= 0 && idx + 1 < lineText.length) return lineStart + idx + 1;
        }
        return -1;
    }

    function repeatFind(reverse) {
        if (!vimLastFind) return -1;
        var dir = reverse
            ? {f:'F', F:'f', t:'T', T:'t'}[vimLastFind.direction]
            : vimLastFind.direction;
        return findChar(vimLastFind.char, dir);
    }

    // --- Visual mode helpers ---

    function updateVisualSelection() {
        if (!vimVisual) return;
        var cursor = vimCursorOffset;
        if (vimVisual.mode === 'char') {
            var start = Math.min(vimVisual.anchor, cursor);
            var end = Math.max(vimVisual.anchor, cursor) + 1;
            vimContent.setSelectionRange(start, end);
        } else {
            var anchorPos = (function() {
                var before = vimContent.value.substring(0, vimVisual.anchor);
                return before.split('\n').length - 1;
            })();
            var cursorPos = getCursorPos().line;
            var startLine = Math.min(anchorPos, cursorPos);
            var endLine = Math.max(anchorPos, cursorPos);
            var lines = getLines();
            var start = getLineStartOffset(startLine);
            var end = getLineStartOffset(endLine) + lines[endLine].length + (endLine < lines.length - 1 ? 1 : 0);
            vimContent.setSelectionRange(start, end);
        }
        updateVimStatusLine();
    }

    function getVisualRange() {
        if (!vimVisual) return null;
        return {
            start: vimContent.selectionStart,
            end: vimContent.selectionEnd,
            linewise: vimVisual.mode === 'line'
        };
    }

    function exitVisual() {
        vimVisual = null;
        vimContent.setSelectionRange(vimCursorOffset, vimCursorOffset);
        updateVimStatusLine();
    }

    // --- Command execution ---

    function execCommand(cmdStr) {
        var cmd = cmdStr.trim();
        if (cmd === 'w' || cmd === 'w!') {
            save();
        } else if (cmd === 'wq' || cmd === 'wq!' || cmd === 'x') {
            saveAndClose();
        } else if (cmd === 'q') {
            if (isDirty()) {
                showMsg('E37: No write since last change (add ! to override)', true);
            } else {
                close();
            }
        } else if (cmd === 'q!') {
            close();
        } else if (/^\d+$/.test(cmd)) {
            var lineNum = parseInt(cmd) - 1;
            setCursorPos(lineNum, 0);
        } else if (cmd.startsWith('title ')) {
            var newTitle = cmd.substring(6).trim();
            if (newTitle) {
                vimTitle = newTitle;
                vimTitlebar.textContent = vimEditingType + ' #' + vimEditingId + ' \u2014 ' + vimTitle;
                showMsg('Title set to "' + newTitle + '"');
            }
        } else {
            showMsg('E492: Not an editor command: ' + cmd, true);
        }
        setMode('normal');
    }

    // --- Normal mode key handler ---

    function handleNormalKey(e) {
        var key = e.key;

        // Multi-key sequences
        if (vimPendingKey) {
            e.preventDefault();
            var pending = vimPendingKey;
            vimPendingKey = null;

            if (pending === 'g') {
                if (key === 'g') {
                    setCursorPos(0, 0);
                    if (vimVisual) updateVisualSelection();
                }
                return;
            }
            if (pending === 'd') {
                if (key === 'd') {
                    vimPushUndo();
                    var pos = getCursorPos();
                    var lines = getLines();
                    vimClipboard = lines[pos.line];
                    vimClipboardLinewise = true;
                    lines.splice(pos.line, 1);
                    if (lines.length === 0) lines.push('');
                    vimContent.value = lines.join('\n');
                    setCursorPos(Math.min(pos.line, lines.length - 1), 0);
                } else if (key === 'w') {
                    var offset = vimCursorOffset;
                    var text = vimContent.value;
                    var match = text.substring(offset).match(/^(\S+\s*|\s+)/);
                    if (match) {
                        vimPushUndo();
                        vimClipboard = match[0];
                        vimClipboardLinewise = false;
                        vimContent.value = text.substring(0, offset) + text.substring(offset + match[0].length);
                        setCursorOffset(Math.min(offset, vimContent.value.length - 1));
                    }
                } else if (key === '$') {
                    var pos = getCursorPos();
                    var lines = getLines();
                    if (pos.col < lines[pos.line].length) {
                        vimPushUndo();
                        var lineStart = getLineStartOffset(pos.line);
                        vimClipboard = lines[pos.line].substring(pos.col);
                        vimClipboardLinewise = false;
                        vimContent.value = vimContent.value.substring(0, lineStart + pos.col) + vimContent.value.substring(lineStart + lines[pos.line].length);
                        setCursorOffset(Math.max(0, lineStart + pos.col - 1));
                    }
                }
                return;
            }
            if (pending === 'y') {
                if (key === 'y') {
                    var pos = getCursorPos();
                    var lines = getLines();
                    vimClipboard = lines[pos.line];
                    vimClipboardLinewise = true;
                    showMsg('1 line yanked');
                }
                return;
            }
            if (pending === 'c') {
                if (key === 'c') {
                    vimPushUndo();
                    var pos = getCursorPos();
                    var lines = getLines();
                    vimClipboard = lines[pos.line];
                    vimClipboardLinewise = true;
                    lines[pos.line] = '';
                    vimContent.value = lines.join('\n');
                    setCursorPos(pos.line, 0);
                    vimMode = 'insert';
                    vimContent.classList.remove('vim-normal');
                    updateVimStatusLine();
                } else if (key === 'w') {
                    var offset = vimCursorOffset;
                    var text = vimContent.value;
                    var match = text.substring(offset).match(/^(\S+\s*|\s+)/);
                    if (match) {
                        vimPushUndo();
                        vimClipboard = match[0];
                        vimClipboardLinewise = false;
                        vimContent.value = text.substring(0, offset) + text.substring(offset + match[0].length);
                        setCursorOffset(offset);
                    }
                    vimMode = 'insert';
                    vimContent.classList.remove('vim-normal');
                    updateVimStatusLine();
                }
                return;
            }
            if (pending === 'Z') {
                if (key === 'Z') saveAndClose();
                return;
            }
            if (pending === 'f' || pending === 'F' || pending === 't' || pending === 'T') {
                if (key.length === 1) {
                    vimLastFind = { char: key, direction: pending };
                    var target = findChar(key, pending);
                    if (target >= 0) setCursorOffset(target);
                    if (vimVisual) updateVisualSelection();
                }
                return;
            }
            if (pending === 'r') {
                if (key.length === 1) {
                    var offset = vimCursorOffset;
                    var text = vimContent.value;
                    if (offset < text.length && text[offset] !== '\n') {
                        vimPushUndo();
                        vimContent.value = text.substring(0, offset) + key + text.substring(offset + 1);
                        setCursorOffset(offset);
                    }
                }
                return;
            }
            return;
        }

        e.preventDefault();

        var pos = getCursorPos();
        var lines = getLines();
        var offset = vimCursorOffset;
        var text = vimContent.value;

        switch(key) {
            // Insert mode entry
            case 'i':
                setMode('insert');
                break;
            case 'I':
                {
                    var lineText = lines[pos.line];
                    var firstNonWs = lineText.search(/\S/);
                    setCursorPos(pos.line, firstNonWs >= 0 ? firstNonWs : 0);
                }
                setMode('insert');
                break;
            case 'a':
                setCursorOffset(Math.min(offset + 1, text.length));
                setMode('insert');
                break;
            case 'A':
                setCursorOffset(getLineStartOffset(pos.line) + lines[pos.line].length);
                setMode('insert');
                break;
            case 'o':
                {
                    vimPushUndo();
                    var eol = getLineStartOffset(pos.line) + lines[pos.line].length;
                    vimContent.value = text.substring(0, eol) + '\n' + text.substring(eol);
                    setCursorOffset(eol + 1);
                }
                vimMode = 'insert';
                vimContent.classList.remove('vim-normal');
                updateVimStatusLine();
                break;
            case 'O':
                {
                    vimPushUndo();
                    var sol = getLineStartOffset(pos.line);
                    vimContent.value = text.substring(0, sol) + '\n' + text.substring(sol);
                    setCursorOffset(sol);
                }
                vimMode = 'insert';
                vimContent.classList.remove('vim-normal');
                updateVimStatusLine();
                break;

            // Movement
            case 'h': case 'ArrowLeft':
                if (pos.col > 0) setCursorOffset(offset - 1);
                break;
            case 'l': case 'ArrowRight':
                if (pos.col < lines[pos.line].length - 1) setCursorOffset(offset + 1);
                break;
            case 'j': case 'ArrowDown':
                if (pos.line < lines.length - 1) setCursorPos(pos.line + 1, pos.col);
                break;
            case 'k': case 'ArrowUp':
                if (pos.line > 0) setCursorPos(pos.line - 1, pos.col);
                break;
            case '0':
                setCursorPos(pos.line, 0);
                break;
            case '^':
                {
                    var firstNonWs = lines[pos.line].search(/\S/);
                    setCursorPos(pos.line, firstNonWs >= 0 ? firstNonWs : 0);
                }
                break;
            case '$':
                setCursorOffset(getLineStartOffset(pos.line) + Math.max(0, lines[pos.line].length - 1));
                break;
            case 'G':
                setCursorPos(lines.length - 1, 0);
                break;
            case 'g':
                vimPendingKey = 'g';
                break;

            // Word motions
            case 'w':
                {
                    var after = text.substring(offset);
                    var m = after.match(/^(\S+\s*|\s+)/);
                    if (m) setCursorOffset(Math.min(offset + m[0].length, text.length - 1));
                }
                break;
            case 'b':
                {
                    var i = offset - 1;
                    while (i > 0 && /\s/.test(text[i])) i--;
                    while (i > 0 && /\S/.test(text[i - 1])) i--;
                    setCursorOffset(Math.max(0, i));
                }
                break;
            case 'e':
                {
                    var i = offset + 1;
                    while (i < text.length && /\s/.test(text[i])) i++;
                    while (i < text.length - 1 && /\S/.test(text[i + 1])) i++;
                    if (i < text.length) setCursorOffset(i);
                }
                break;

            // Text operations
            case 'x':
                if (offset < text.length && text[offset] !== '\n') {
                    vimPushUndo();
                    vimClipboard = text[offset];
                    vimClipboardLinewise = false;
                    vimContent.value = text.substring(0, offset) + text.substring(offset + 1);
                    var newLines = getLines();
                    var newPos = getCursorPos();
                    if (newPos.col > 0 && newPos.col >= newLines[newPos.line].length) {
                        setCursorOffset(offset - 1);
                    } else {
                        setCursorOffset(offset);
                    }
                }
                break;
            case 'D':
                {
                    vimPushUndo();
                    var lineStart = getLineStartOffset(pos.line);
                    vimClipboard = lines[pos.line].substring(pos.col);
                    vimClipboardLinewise = false;
                    vimContent.value = text.substring(0, lineStart + pos.col) + text.substring(lineStart + lines[pos.line].length);
                    setCursorOffset(Math.max(0, lineStart + pos.col - 1));
                }
                break;
            case 'C':
                {
                    vimPushUndo();
                    var lineStart = getLineStartOffset(pos.line);
                    vimClipboard = lines[pos.line].substring(pos.col);
                    vimClipboardLinewise = false;
                    vimContent.value = text.substring(0, lineStart + pos.col) + text.substring(lineStart + lines[pos.line].length);
                    setCursorOffset(lineStart + pos.col);
                    vimMode = 'insert';
                    vimContent.classList.remove('vim-normal');
                    updateVimStatusLine();
                }
                break;
            case 'd':
                vimPendingKey = 'd';
                break;
            case 'y':
                vimPendingKey = 'y';
                break;
            case 'c':
                vimPendingKey = 'c';
                break;
            case 'r':
                vimPendingKey = 'r';
                break;
            case 'p':
                if (vimClipboard) {
                    vimPushUndo();
                    if (vimClipboardLinewise) {
                        var eol = getLineStartOffset(pos.line) + lines[pos.line].length;
                        vimContent.value = text.substring(0, eol) + '\n' + vimClipboard + text.substring(eol);
                        setCursorPos(pos.line + 1, 0);
                    } else {
                        vimContent.value = text.substring(0, offset + 1) + vimClipboard + text.substring(offset + 1);
                        setCursorOffset(offset + vimClipboard.length);
                    }
                }
                break;
            case 'P':
                if (vimClipboard) {
                    vimPushUndo();
                    if (vimClipboardLinewise) {
                        var sol = getLineStartOffset(pos.line);
                        vimContent.value = text.substring(0, sol) + vimClipboard + '\n' + text.substring(sol);
                        setCursorPos(pos.line, 0);
                    } else {
                        vimContent.value = text.substring(0, offset) + vimClipboard + text.substring(offset);
                        setCursorOffset(offset + vimClipboard.length - 1);
                    }
                }
                break;

            // Replace / toggle case
            case '~':
                if (offset < text.length && text[offset] !== '\n') {
                    vimPushUndo();
                    var ch = text[offset];
                    var toggled = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
                    vimContent.value = text.substring(0, offset) + toggled + text.substring(offset + 1);
                    setCursorOffset(Math.min(offset + 1, getLineStartOffset(pos.line) + lines[pos.line].length - 1));
                }
                break;

            // Undo/redo
            case 'u':
                if (vimUndoStack.length > 0) {
                    vimRedoStack.push({ content: vimContent.value, offset: vimCursorOffset });
                    var state = vimUndoStack.pop();
                    vimContent.value = state.content;
                    setCursorOffset(state.offset);
                } else {
                    showMsg('Already at oldest change');
                }
                break;

            // Save+quit shortcuts
            case 'Z':
                vimPendingKey = 'Z';
                break;

            // Join lines (J)
            case 'J':
                if (pos.line < lines.length - 1) {
                    vimPushUndo();
                    var eol = getLineStartOffset(pos.line) + lines[pos.line].length;
                    var nextLineContent = lines[pos.line + 1].replace(/^\s+/, '');
                    vimContent.value = text.substring(0, eol) + ' ' + nextLineContent + text.substring(getLineStartOffset(pos.line + 1) + lines[pos.line + 1].length);
                    setCursorOffset(eol);
                }
                break;

            // Paragraph navigation
            case '{':
                {
                    var i = pos.line - 1;
                    while (i >= 0 && lines[i].trim() === '') i--;
                    while (i >= 0 && lines[i].trim() !== '') i--;
                    setCursorPos(Math.max(0, i), 0);
                    if (vimVisual) updateVisualSelection();
                }
                break;
            case '}':
                {
                    var i = pos.line + 1;
                    while (i < lines.length && lines[i].trim() === '') i++;
                    while (i < lines.length && lines[i].trim() !== '') i++;
                    setCursorPos(Math.min(i, lines.length - 1), 0);
                    if (vimVisual) updateVisualSelection();
                }
                break;

            // Find character on line
            case 'f': case 'F': case 't': case 'T':
                vimPendingKey = key;
                break;
            case ';':
                {
                    var target = repeatFind(false);
                    if (target >= 0) setCursorOffset(target);
                    if (vimVisual) updateVisualSelection();
                }
                break;
            case ',':
                {
                    var target = repeatFind(true);
                    if (target >= 0) setCursorOffset(target);
                    if (vimVisual) updateVisualSelection();
                }
                break;

            // Visual mode
            case 'v':
                if (vimVisual && vimVisual.mode === 'char') {
                    exitVisual();
                } else {
                    vimVisual = { mode: 'char', anchor: offset };
                    updateVisualSelection();
                }
                break;
            case 'V':
                if (vimVisual && vimVisual.mode === 'line') {
                    exitVisual();
                } else {
                    vimVisual = { mode: 'line', anchor: offset };
                    updateVisualSelection();
                }
                break;

            // Command mode
            case ':':
                setMode('command');
                break;
        }

        // Update visual selection after any movement
        if (vimVisual && !['v','V'].includes(key)) {
            updateVisualSelection();
        }
    }

    // --- Visual mode operations ---

    function visualYank() {
        var range = getVisualRange();
        if (!range) return;
        vimClipboard = vimContent.value.substring(range.start, range.end);
        vimClipboardLinewise = range.linewise;
        if (range.linewise && vimClipboard.endsWith('\n')) {
            vimClipboard = vimClipboard.slice(0, -1);
        }
        setCursorOffset(range.start);
        exitVisual();
        showMsg(range.linewise
            ? vimClipboard.split('\n').length + ' line(s) yanked'
            : (range.end - range.start) + ' char(s) yanked');
    }

    function visualDelete() {
        var range = getVisualRange();
        if (!range) return;
        vimPushUndo();
        vimClipboard = vimContent.value.substring(range.start, range.end);
        vimClipboardLinewise = range.linewise;
        if (range.linewise && vimClipboard.endsWith('\n')) {
            vimClipboard = vimClipboard.slice(0, -1);
        }
        vimContent.value = vimContent.value.substring(0, range.start) + vimContent.value.substring(range.end);
        setCursorOffset(Math.min(range.start, Math.max(0, vimContent.value.length - 1)));
        exitVisual();
    }

    function visualChange() {
        visualDelete();
        vimMode = 'insert';
        vimContent.classList.remove('vim-normal');
        updateVimStatusLine();
    }

    function visualToggleCase() {
        var range = getVisualRange();
        if (!range) return;
        vimPushUndo();
        var selected = vimContent.value.substring(range.start, range.end);
        var toggled = '';
        for (var i = 0; i < selected.length; i++) {
            var ch = selected[i];
            toggled += ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
        }
        vimContent.value = vimContent.value.substring(0, range.start) + toggled + vimContent.value.substring(range.end);
        setCursorOffset(range.start);
        exitVisual();
    }

    // --- Keydown handler (attached to document) ---

    function handleKeydown(e) {
        if (!isActive()) return;

        if (vimMode === 'normal') {
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                if (vimRedoStack.length > 0) {
                    vimUndoStack.push({ content: vimContent.value, offset: vimCursorOffset });
                    var state = vimRedoStack.pop();
                    vimContent.value = state.content;
                    setCursorOffset(state.offset);
                } else {
                    showMsg('Already at newest change');
                }
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                vimPendingKey = null;
                if (vimVisual) exitVisual();
                return;
            }
            if (e.key.startsWith('F') && e.key.length > 1) return;
            // Visual mode special keys
            if (vimVisual) {
                if (e.key === 'y') { e.preventDefault(); visualYank(); return; }
                if (e.key === 'd' || e.key === 'x') { e.preventDefault(); visualDelete(); return; }
                if (e.key === 'c') { e.preventDefault(); visualChange(); return; }
                if (e.key === '~') { e.preventDefault(); visualToggleCase(); return; }
                if (e.key === 'J') {
                    e.preventDefault();
                    var range = getVisualRange();
                    if (range) {
                        var text = vimContent.value;
                        var selected = text.substring(range.start, range.end);
                        if (selected.includes('\n')) {
                            vimPushUndo();
                            var joined = selected.split('\n').map(function(l, i) { return i === 0 ? l : l.replace(/^\s+/, ''); }).join(' ');
                            vimContent.value = text.substring(0, range.start) + joined + text.substring(range.end);
                            setCursorOffset(range.start);
                        }
                    }
                    exitVisual();
                    return;
                }
            }
            handleNormalKey(e);
        } else if (vimMode === 'insert') {
            if (e.key === 'Escape') {
                e.preventDefault();
                vimCursorOffset = vimContent.selectionStart;
                var off = vimCursorOffset;
                if (off > 0) {
                    var ch = vimContent.value[off - 1];
                    if (ch !== '\n') setCursorOffset(off - 1);
                }
                setMode('normal');
            }
        } else if (vimMode === 'command') {
            if (e.key === 'Escape') {
                e.preventDefault();
                setMode('normal');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                execCommand(vimCmdInput.value);
            }
        }
    }

    function handleMouseUp() {
        updateVimStatusLine();
    }

    function handleKeyUp() {
        if (vimMode === 'insert') updateVimStatusLine();
    }

    // --- Init: attach event listeners ---

    function init() {
        resolveDOM();
        document.addEventListener('keydown', handleKeydown);
        vimContent.addEventListener('mouseup', handleMouseUp);
        vimContent.addEventListener('keyup', handleKeyUp);
    }

    // --- Expose public API ---

    window.CliVim = {
        init: init,
        open: open,
        close: close,
        isActive: isActive,
        isDirty: isDirty,
        save: save,
        saveAndClose: saveAndClose,
        getEditingType: function() { return vimEditingType; },
        getEditingId: function() { return vimEditingId; },
        setOnSave: function(fn) { onSave = fn; },
        setOnClose: function(fn) { onClose = fn; }
    };
})();
