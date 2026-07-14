/**
 * Flasky Notes — Command registry.
 *
 * Single source of truth for editor slash-commands and the command-palette
 * `>` mode. Each command has:
 *   { id, label, icon, hint, editorOnly, run(ctx) }
 * `ctx` = { editor: CodeMirror instance or null, page: 'editor'|'agenda'|'other' }
 *
 * Editor-only commands (insert text, AI actions) are returned only when
 * `context === 'editor'`. Global commands (New note, Toggle dark mode, ...)
 * are returned on every page; they call functions off `window` so the
 * registry can be loaded on pages where those functions don't exist.
 */
(function () {
    'use strict';

    var _editorCommands = [
        { label: 'Heading 1', icon: 'H1', editorOnly: true, run: _insert('# ') },
        { label: 'Heading 2', icon: 'H2', editorOnly: true, run: _insert('## ') },
        { label: 'Heading 3', icon: 'H3', editorOnly: true, run: _insert('### ') },
        { label: 'Callout', icon: '!', editorOnly: true, run: _insert('> [!note] \n> ') },
        { label: 'Code block', icon: '{}', editorOnly: true, run: _insert('```\n\n```', 4) },
        { label: 'Divider', icon: '--', editorOnly: true, run: _insert('---\n') },
        { label: 'Table', icon: '||', editorOnly: true, run: _insert('| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n') },
        { label: 'Checkbox list', icon: '[]', editorOnly: true, run: _insert('- [ ] ') },
        { label: 'Drawing', icon: '\u270F', editorOnly: true, run: function () { _call('openDrawingForNew'); } },
        { label: 'Bullet list', icon: '-', editorOnly: true, run: _insert('- ') },
        { label: 'Numbered list', icon: '1.', editorOnly: true, run: _insert('1. ') },
        { label: 'Date (today)', icon: 'D', editorOnly: true, run: _insertDate },
        { label: 'Insert template', icon: 'T', editorOnly: true, run: function () { _call('openTemplatePicker', ['insert']); } },
        { label: 'Save as template', icon: 'S', editorOnly: true, run: function () { _call('saveCurrentAsTemplate'); } },
        { label: 'New from template', icon: 'N', editorOnly: true, run: function () { _call('openTemplatePicker', ['new']); } },
        { label: 'Manage templates', icon: 'M', editorOnly: true, run: function () { _call('openManageTemplates'); } }
    ];

    var _aiCommands = [
        { label: 'AI: Ask', icon: '?', editorOnly: true, run: function () { _call('openAIPanelWithPrompt', [null, null, false]); } },
        { label: 'AI: Summarize', icon: '\u2261', editorOnly: true, run: function () { _aiRun('Summarize this note', 'Summarize this note'); } },
        { label: 'AI: Rewrite', icon: '\u270E', editorOnly: true, run: function () { _aiRun('Rewrite', 'Rewrite this note more clearly'); } },
        { label: 'AI: Expand', icon: '+', editorOnly: true, run: function () { _aiRun('Expand', 'Expand on this note with more detail'); } },
        { label: 'AI: Fix grammar', icon: 'Aa', editorOnly: true, run: function () { _aiRun('Fix grammar', 'Fix the grammar and spelling in this note'); } },
        { label: 'AI: Explain', icon: '\u2139', editorOnly: true, run: function () { _aiRun('Explain', 'Explain this in simple terms'); } },
        { label: 'AI: Bullet points', icon: '\u2022', editorOnly: true, run: function () { _aiRun('Bullet points', 'Convert this into bullet points'); } }
    ];

    var _globalCommands = [
        { label: 'New note', icon: '+', hint: 'Ctrl N', run: function () { _call('createNewNote'); } },
        { label: 'Open daily note', icon: '\u2605', run: function () { _call('openDailyNote'); } },
        { label: 'Toggle sidebar', icon: '\u2630', hint: 'Ctrl B', run: function () { _call('toggleSidebar'); } },
        { label: 'Toggle dark mode', icon: '\u25CF', run: function () { _call('toggleDarkMode'); } },
        { label: 'Toggle spotlight mode', icon: '\u25D2', hint: 'Ctrl Shift F', run: function () { _call('toggleSpotlightMode'); } },
        { label: 'Toggle compact mode', icon: '\u25A1', run: function () { _call('toggleCompactMode'); } },
        { label: 'Toggle outline panel', icon: '\u2637', hint: 'Ctrl Shift O', run: function () { _call('toggleRightPanel'); } },
        { label: 'Toggle AI panel', icon: '\u2728', hint: 'Ctrl Shift A', run: function () { _call('toggleAIPanel'); } },
        { label: 'Toggle auto-save', icon: '\u21BB', run: function () { _call('toggleAutoSave'); } },
        { label: 'Toggle hide title', icon: '\u00B7', run: function () { _call('toggleHideTitle'); } },
        { label: 'Edit / Preview', icon: '\u270E', hint: 'Ctrl E', run: function () { _call('toggleMode'); } },
        { label: 'Open agenda', icon: '\u2311', run: function () { _nav('/agenda'); } },
        { label: 'Open settings', icon: '\u2699', run: function () { _nav('/settings'); } },
        { label: 'Open AI chat', icon: '\u2B50', run: function () { _nav('/ai'); } },
        { label: 'Export notes', icon: '\u2B07', run: function () { _nav('/export'); } },
        { label: 'Keyboard shortcuts', icon: '?', hint: 'Ctrl /', run: function () { _call('toggleShortcutsModal'); } }
    ];

    function _insert(text, cursorBack) {
        return function (ctx) {
            if (!ctx || !ctx.editor) return;
            var ed = ctx.editor;
            var cursor = ed.getCursor();
            ed.replaceRange(text, cursor);
            ed.setCursor({ line: cursor.line, ch: cursor.ch + (cursorBack ? text.length - cursorBack : text.length) });
            ed.focus();
        };
    }

    function _insertDate(ctx) {
        if (!ctx || !ctx.editor) return;
        var text = new Date().toISOString().split('T')[0];
        _insert(text)(ctx);
    }

    function _aiRun(label, prompt) {
        _call('openAIPanelWithPrompt', [label, prompt, true]);
    }

    function _call(fnName, args) {
        var fn = window[fnName];
        if (typeof fn !== 'function') return;
        if (args) return fn.apply(null, args);
        return fn();
    }

    function getCommands(context, opts) {
        context = context || 'other';
        opts = opts || {};
        var list = [];
        if (context === 'editor') {
            list = list.concat(_editorCommands);
            if (!opts.drawingEnabled) {
                list = list.filter(function (cmd) { return cmd.label !== 'Drawing'; });
            }
            if (opts.aiEnabled) list = list.concat(_aiCommands);
        }
        list = list.concat(_globalCommands);
        return list.map(function (cmd, i) {
            return { id: i, label: cmd.label, icon: cmd.icon, hint: cmd.hint || '', editorOnly: !!cmd.editorOnly, run: cmd.run };
        });
    }

    function filter(commands, query) {
        if (!query) return commands;
        var q = query.toLowerCase();
        return commands.filter(function (cmd) {
            return cmd.label.toLowerCase().indexOf(q) !== -1;
        });
    }

    function _nav(path) {
        if (window.FlaskyRouter && window.FlaskyRouter.navigate) FlaskyRouter.navigate(path);
        else window.location.href = path;
    }

    window.FlaskyCommands = {
        getCommands: getCommands,
        filter: filter
    };
})();