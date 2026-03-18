import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, rectangularSelection, lineNumbers, Decoration, ViewPlugin, MatchDecorator } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
// Not importing @codemirror/language-data — it adds ~1MB for fenced code block
// sub-language highlighting. Preview mode uses highlight.js for that instead.

// Markdown continue-list on Enter
import { insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';

// Custom highlight style that reads from CSS variables
const obsidifiedHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.6em', lineHeight: '1.4' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.35em', lineHeight: '1.4' },
  { tag: tags.heading3, fontWeight: '700', fontSize: '1.15em', lineHeight: '1.5' },
  { tag: tags.heading4, fontWeight: '700', fontSize: '1.05em' },
  { tag: tags.heading5, fontWeight: '700' },
  { tag: tags.heading6, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, class: 'cm6-link' },
  { tag: tags.url, class: 'cm6-url' },
  { tag: tags.monospace, class: 'cm6-code' },
  { tag: tags.quote, class: 'cm6-quote' },
  { tag: tags.meta, class: 'cm6-meta' },
  { tag: tags.processingInstruction, class: 'cm6-formatting' },
  { tag: tags.contentSeparator, class: 'cm6-hr' },
  { tag: tags.list, class: 'cm6-list-marker' },
]);

// Base theme using CSS variables
const obsidifiedTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 'var(--font-size)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif)',
    lineHeight: '1.7',
    overflow: 'auto',
    padding: '8px 20px 40px',
  },
  '.cm-content': {
    minHeight: '200px',
    caretColor: 'var(--accent)',
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--accent-dim) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(180,190,254,0.2) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-gutters': {
    display: 'none',
  },
  // Markdown token styling via classes
  '.cm6-link': {
    color: 'var(--accent)',
    textDecoration: 'none',
  },
  '.cm6-url': {
    color: 'var(--text-muted)',
    fontSize: '0.9em',
  },
  '.cm6-code': {
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-hover)',
    borderRadius: '3px',
    padding: '1px 4px',
  },
  '.cm6-quote': {
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
  '.cm6-meta': {
    color: 'var(--accent-hover)',
  },
  '.cm6-formatting': {
    color: 'var(--text-muted)',
  },
  '.cm6-hr': {
    color: 'var(--text-muted)',
    display: 'block',
  },
  '.cm6-list-marker': {
    color: 'var(--accent)',
  },
  '.cm6-wikilink, .cm6-wikilink *': {
    color: 'var(--accent) !important',
  },
});

// Wikilink decoration: styles [[...]] brackets and content consistently
const wikilinkMark = Decoration.mark({ class: 'cm6-wikilink' });
const wikilinkMatcher = new MatchDecorator({
  regexp: /\[\[[^\]]*\]\]/g,
  decoration: wikilinkMark,
});
const wikilinkPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = wikilinkMatcher.createDeco(view);
  }
  update(update) {
    this.decorations = wikilinkMatcher.updateDeco(update, this.decorations);
  }
}, { decorations: v => v.decorations });


/**
 * Create a CM6 editor with a CM5-compatible adapter API.
 *
 * @param {HTMLElement} parentElement - the DOM element to render the editor into
 * @param {Object} options
 * @param {string} options.initialContent - initial text content
 * @param {function} options.onChange - called on document changes
 * @param {function} options.onInputRead - called on user-typed input (receives adapter)
 * @param {function} options.onCursorActivity - called on cursor/selection changes (receives adapter)
 * @param {function} options.onKeydown - called on keydown (receives adapter, event)
 * @param {Object} options.keybindings - map of key strings to handler functions
 * @returns {Object} adapter with CM5-compatible methods
 */
export function create(parentElement, options) {
  options = options || {};

  // Build keybindings
  var customKeys = [];
  if (options.keybindings) {
    Object.keys(options.keybindings).forEach(function(key) {
      customKeys.push({ key: key, run: function() { options.keybindings[key](); return true; } });
    });
  }

  // The adapter object (forward-declared so listeners can reference it)
  var adapter = {};

  var extensions = [
    // Core
    history(),
    drawSelection(),
    rectangularSelection(),
    highlightActiveLine(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping,

    // Markdown with GFM
    markdown({
      base: markdownLanguage,
      extensions: [GFM],
    }),

    // Styling
    obsidifiedTheme,
    syntaxHighlighting(obsidifiedHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    wikilinkPlugin,

    // Keybindings (order matters — custom first, then markdown, then defaults)
    keymap.of(customKeys),
    keymap.of([
      { key: 'Enter', run: insertNewlineContinueMarkup },
      { key: 'Backspace', run: deleteMarkupBackward },
    ]),
    keymap.of(closeBracketsKeymap),
    keymap.of(historyKeymap),
    keymap.of([indentWithTab]),
    keymap.of(defaultKeymap),

    // Update listener for change, inputRead, cursorActivity
    EditorView.updateListener.of(function(update) {
      if (update.docChanged) {
        if (options.onChange) options.onChange();

        // Check if this was user-typed input (not programmatic setValue)
        if (options.onInputRead && !adapter._programmatic) {
          var isUserInput = update.transactions.some(function(tr) {
            return tr.isUserEvent('input') || tr.isUserEvent('input.type');
          });
          if (isUserInput) {
            options.onInputRead(adapter);
          }
        }
      }

      if (update.selectionSet) {
        if (options.onCursorActivity) options.onCursorActivity(adapter);
      }
    }),

    // DOM event handlers for keydown interception at highest priority
    // Returning true tells CM6 the event was handled, stopping keymap processing
    Prec.highest(EditorView.domEventHandlers({
      keydown: function(e, view) {
        if (options.onKeydown) {
          options.onKeydown(adapter, e);
          return e.defaultPrevented;
        }
      }
    })),
  ];

  var state = EditorState.create({
    doc: options.initialContent || '',
    extensions: extensions,
  });

  var view = new EditorView({
    state: state,
    parent: parentElement,
  });

  // Flag to suppress onInputRead during programmatic changes
  adapter._programmatic = false;

  // ---- CM5-compatible adapter methods ----

  adapter.getValue = function() {
    return view.state.doc.toString();
  };

  adapter.setValue = function(str) {
    adapter._programmatic = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: str },
    });
    adapter._programmatic = false;
  };

  adapter.getCursor = function() {
    var head = view.state.selection.main.head;
    var line = view.state.doc.lineAt(head);
    return { line: line.number - 1, ch: head - line.from };
  };

  adapter.setCursor = function(lineOrPos, ch) {
    var line, col;
    if (typeof lineOrPos === 'object') {
      line = lineOrPos.line;
      col = lineOrPos.ch || 0;
    } else {
      line = lineOrPos;
      col = ch || 0;
    }
    var lineInfo = view.state.doc.line(line + 1);
    var pos = lineInfo.from + Math.min(col, lineInfo.length);
    view.dispatch({ selection: { anchor: pos } });
  };

  adapter.getLine = function(n) {
    var lineNum = n + 1;
    if (lineNum < 1 || lineNum > view.state.doc.lines) return '';
    return view.state.doc.line(lineNum).text;
  };

  adapter.getSelection = function() {
    var sel = view.state.selection.main;
    return view.state.sliceDoc(sel.from, sel.to);
  };

  adapter.replaceSelection = function(str) {
    view.dispatch(view.state.replaceSelection(str));
  };

  adapter.replaceRange = function(str, from, to) {
    var fromOff = _posToOffset(from);
    var toOff = to ? _posToOffset(to) : fromOff;
    view.dispatch({ changes: { from: fromOff, to: toOff, insert: str } });
  };

  adapter.cursorCoords = function() {
    var head = view.state.selection.main.head;
    var coords = view.coordsAtPos(head);
    if (!coords) {
      // Fallback if position is out of view
      return { left: 0, top: 0, bottom: 0 };
    }
    return { left: coords.left, top: coords.top, bottom: coords.bottom };
  };

  adapter.scrollIntoView = function(pos, margin) {
    var offset;
    if (typeof pos === 'object') {
      offset = _posToOffset(pos);
    } else {
      offset = pos;
    }
    view.dispatch({
      effects: EditorView.scrollIntoView(offset, { y: 'center' }),
    });
  };

  adapter.refresh = function() {
    view.requestMeasure();
  };

  adapter.focus = function() {
    view.focus();
  };

  adapter.destroy = function() {
    view.destroy();
  };

  adapter.getView = function() {
    return view;
  };

  // Internal: convert {line, ch} to absolute offset
  function _posToOffset(pos) {
    var lineNum = (pos.line || 0) + 1;
    if (lineNum < 1) lineNum = 1;
    if (lineNum > view.state.doc.lines) lineNum = view.state.doc.lines;
    var lineInfo = view.state.doc.line(lineNum);
    var col = pos.ch || 0;
    return lineInfo.from + Math.min(col, lineInfo.length);
  }

  return adapter;
}
