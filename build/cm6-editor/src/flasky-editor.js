import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, rectangularSelection, lineNumbers, Decoration, ViewPlugin, MatchDecorator, WidgetType } from '@codemirror/view';
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
const flaskyHighlight = HighlightStyle.define([
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
const flaskyTheme = EditorView.theme({
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


// Inline embed rendering for edit mode. Replaces ![[file.png]] /
// ![[drawing.fldraw]] text with the rendered image/drawing, without altering
// the underlying document. Gated behind a Compartment so it can be toggled at
// runtime via adapter.setRenderEmbeds(). Resolution + decryption is delegated
// to the existing client pipeline (window._getAttachmentMap and
// window._decryptAttachments) so the server never sees plaintext.
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i;
const FLDRAW_EXT = /\.fldraw$/i;

class EmbedWidget extends WidgetType {
  constructor(name, att, fallbackText) {
    super();
    this.name = name;
    this.att = att; // { id, filename } or null when unresolved
    this.fallbackText = fallbackText;
  }

  eq(other) {
    // Compare by name AND attachment id. When the attachment map isn't ready
    // on first render, the widget is created with att=null (unresolved text).
    // Once the map loads, refreshEmbeds() rebuilds with a populated att — the
    // id changes from undefined to a number, so eq() returns false and CM6
    // discards the old DOM and calls toDOM() again with the resolved att.
    return other && other.name === this.name &&
      (other.att ? other.att.id : null) === (this.att ? this.att.id : null);
  }

  toDOM() {
    if (!this.att) {
      // Unresolved embed: render the raw source text so the user still sees
      // what's in the document and can edit/correct it.
      var span = document.createElement('span');
      span.className = 'cm6-embed-unresolved';
      span.textContent = this.fallbackText;
      return span;
    }

    var url = '/attachment/' + this.att.id + '/' + encodeURIComponent(this.att.filename);
    var filename = this.att.filename;

    // Wrapper is needed because window._decryptAttachments(container) uses
    // container.querySelectorAll() — it only inspects descendants, not the
    // container itself. The embeddable element must live inside this wrapper.
    var holder = document.createElement('div');
    holder.className = 'cm6-embed-holder';

    if (FLDRAW_EXT.test(filename)) {
      var wrap = document.createElement('div');
      wrap.className = 'fldraw-render cm6-embed';
      wrap.setAttribute('data-encrypted-src', url);
      wrap.setAttribute('data-att-id', String(this.att.id));
      wrap.setAttribute('data-att-filename', filename);
      wrap.setAttribute('data-action', 'edit-fldraw');
      holder.appendChild(wrap);
      if (window._decryptAttachments) window._decryptAttachments(holder);
      return holder;
    }

    if (IMAGE_EXT.test(filename)) {
      var img = document.createElement('img');
      img.className = 'e2ee-attachment cm6-embed';
      img.setAttribute('data-encrypted-src', url);
      img.setAttribute('data-att-filename', filename);
      img.setAttribute('alt', this.name);
      img.style.maxWidth = '100%';
      img.style.cursor = 'pointer';
      holder.appendChild(img);
      if (window._decryptAttachments) window._decryptAttachments(holder);
      return holder;
    }

    // Non-image/non-fldraw embeds fall back to a link (matches preview mode).
    var a = document.createElement('a');
    a.href = url;
    a.textContent = this.name;
    holder.appendChild(a);
    return holder;
  }

  // Let clicks pass through to the attachment handlers wired up in app.js
  // (.fldraw click opens the drawing modal via data-action delegation).
  ignoreEvent(event) {
    return false;
  }
}

const EMBED_RE = /!\[\[[^\]]+\]\]/g;

// Build the Decoration.replace widget for a single ![[...]] match, or null
// when the attachment is unresolved / non-embeddable (falls back to text).
function _embedDeco(raw) {
  var name = raw.slice(3, -2);
  var maps = window._getAttachmentMap ? window._getAttachmentMap() : null;
  var att = null;
  if (maps && maps.attachments) {
    att = maps.attachments[name.toLowerCase().trim()];
  }
  if (att) {
    if (!IMAGE_EXT.test(att.filename) && !FLDRAW_EXT.test(att.filename)) {
      att = null;
    }
  }
  if (!att) return null;
  return Decoration.replace({
    widget: new EmbedWidget(name, att, raw),
  });
}

// ViewPlugin that scans visible lines for ![[...]] embeds and replaces them
// with inline widgets — EXCEPT on the line holding the cursor. There the raw
// source text is shown so the user can edit it. Decorations are rebuilt on
// every doc/viewport/selection change; CM6 diffs the DecorationSet so only
// affected widgets are torn down / re-created.
function makeEmbedPlugin() {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = this._build(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this._build(update.view);
      }
    }
    _build(view) {
      var builder = [];
      var sel = view.state.selection.main;
      // Active line range (cursor may span a selection; use the head's line).
      var headLine = view.state.doc.lineAt(sel.head).number;
      for (var r = 0; r < view.visibleRanges.length; r++) {
        var range = view.visibleRanges[r];
        var fromLine = view.state.doc.lineAt(range.from).number;
        var toLine = view.state.doc.lineAt(range.to).number;
        for (var n = fromLine; n <= toLine; n++) {
          var line = view.state.doc.line(n);
          // Skip decoration on the cursor's line so the ![[...]] text stays
          // editable there.
          if (n === headLine) continue;
          var text = line.text;
          var m;
          EMBED_RE.lastIndex = 0;
          while ((m = EMBED_RE.exec(text)) !== null) {
            var deco = _embedDeco(m[0]);
            if (deco) builder.push(deco.range(line.from + m.index, line.from + m.index + m[0].length));
          }
        }
      }
      return Decoration.set(builder, true);
    }
  }, { decorations: v => v.decorations });
}


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

  // Compartment for the inline-embed plugin so it can be toggled at runtime
  // without rebuilding the editor. Initial state is set from options.renderEmbeds.
  var embedCompartment = new Compartment();
  var embedsEnabled = !!options.renderEmbeds;

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
    flaskyTheme,
    syntaxHighlighting(flaskyHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    wikilinkPlugin,

    // Inline embed rendering (gated by Compartment; off by default)
    embedCompartment.of(options.renderEmbeds ? makeEmbedPlugin() : []),

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

  // Toggle inline embed rendering at runtime without rebuilding the editor.
  // A fresh plugin instance is created each time so CM6 actually re-runs the
  // decoration pass (re-using the same instance reference is a no-op).
  adapter.setRenderEmbeds = function(enabled) {
    embedsEnabled = !!enabled;
    view.dispatch({
      effects: embedCompartment.reconfigure(enabled ? makeEmbedPlugin() : []),
    });
  };

  // Force the embed decorations to rebuild — called from app.js after the
  // attachment map becomes available (wikiLinksReady / noteMapUpdated).
  // Reconfiguring with a fresh plugin instance tears down the old decorations
  // and re-runs _build()/toDOM(), now with a populated attachment map.
  adapter.refreshEmbeds = function() {
    if (!embedsEnabled) return;
    view.dispatch({
      effects: embedCompartment.reconfigure(makeEmbedPlugin()),
    });
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
