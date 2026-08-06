import { EditorState, Compartment, Prec, StateField, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, rectangularSelection, lineNumbers, Decoration, ViewPlugin, MatchDecorator, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle, bracketMatching, syntaxTree } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
// Not importing @codemirror/language-data — it adds ~1MB for fenced code block
// sub-language highlighting. Preview mode uses highlight.js for that instead.

// Markdown continue-list on Enter
import { insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';

// Custom highlight style that reads from CSS variables
const flaskyHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.6em', lineHeight: '1.3' },
  { tag: tags.heading2, fontWeight: '600', fontSize: '1.3em', lineHeight: '1.3' },
  { tag: tags.heading3, fontWeight: '600', fontSize: '1.1em', lineHeight: '1.3' },
  { tag: tags.heading4, fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading5, fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading6, fontWeight: '700', lineHeight: '1.3' },
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
  // Block widgets (code blocks, callouts) use `block: true` and don't
  // produce buffer spacers. Inline widgets that render block-level content
  // (embed holders) do — collapse the default 1em buffer so spacing comes
  // from the widget's own margin instead of stacking both.
  '.cm-widgetBuffer': {
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
    backgroundColor: 'var(--bg-hover)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
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
  '.cm6-wikilink-live, .cm6-wikilink-live *': {
    color: 'var(--accent) !important',
    fontWeight: '700',
  },
  // --- Live-preview content styling (applied via Decoration.mark) ---
  '.cm6-h1': { fontWeight: '700' },
  '.cm6-h2': { fontWeight: '600' },
  '.cm6-h3': { fontWeight: '600' },
  '.cm6-h4': { fontWeight: '700' },
  '.cm6-h5': { fontWeight: '700' },
  '.cm6-h6': { fontWeight: '700' },
  // Code block widget (block-level replace)
  '.cm6-codeblock': {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '16px 20px',
    overflowX: 'auto',
    margin: '0.5em 0',
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm6-codeblock code': { background: 'none', padding: '0', fontFamily: 'inherit', fontSize: 'inherit' },
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
const AUDIO_EXT = /\.(mp3|wav|flac|m4a|weba|opus|ogg)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;

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
      var drawMw = window._getEmbedMaxWidths ? window._getEmbedMaxWidths().draw : null;
      wrap.style.maxWidth = drawMw || '100%';
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
      var imgMw = window._getEmbedMaxWidths ? window._getEmbedMaxWidths().img : null;
      img.style.maxWidth = imgMw || '100%';
      img.style.cursor = 'pointer';
      holder.appendChild(img);
      if (window._decryptAttachments) window._decryptAttachments(holder);
      return holder;
    }

    if (AUDIO_EXT.test(filename)) {
      var player;
      if (window.FlaskyAudioPlayer) {
        player = window.FlaskyAudioPlayer.create(this.att);
        holder.appendChild(player);
        var aud = player.querySelector('audio');
        if (window._decryptAttachments && aud && aud.getAttribute('data-encrypted-src')) {
          window._decryptAttachments(holder);
        } else if (window._getCachedBlobUrl) {
          var cached = window._getCachedBlobUrl(this.att.id);
          if (cached && aud && !aud.src) aud.src = cached;
        }
      } else {
        var fallback = document.createElement('audio');
        fallback.controls = true;
        fallback.className = 'e2ee-attachment cm6-embed';
        fallback.setAttribute('data-encrypted-src', url);
        fallback.setAttribute('data-att-filename', filename);
        holder.appendChild(fallback);
        if (window._decryptAttachments) window._decryptAttachments(holder);
      }
      return holder;
    }

    if (VIDEO_EXT.test(filename)) {
      var vid = document.createElement('video');
      vid.controls = true;
      vid.className = 'e2ee-attachment cm6-embed';
      vid.setAttribute('data-encrypted-src', url);
      vid.setAttribute('data-att-filename', filename);
      var vidMw = window._getEmbedMaxWidths ? window._getEmbedMaxWidths().img : null;
      vid.style.maxWidth = vidMw || '100%';
      holder.appendChild(vid);
      if (window._decryptAttachments) window._decryptAttachments(holder);
      return holder;
    }

    // Non-embeddable attachments fall back to a link (matches preview mode).
    var a = document.createElement('a');
    a.href = url;
    a.textContent = this.name;
    holder.appendChild(a);
    return holder;
  }

  // For audio and video embeds, ignore all DOM events so clicks/keys on the
  // media controls (play/pause, seek, volume) are handled by the player
  // instead of interpreted as editor actions (cursor movement, selection).
  // For image/fldraw embeds, let CM6 handle events normally (fldraw clicks
  // are dispatched to the drawing modal via data-action delegation in app.js).
  ignoreEvent(event) {
    if (!this.att) return false;
    return AUDIO_EXT.test(this.att.filename) || VIDEO_EXT.test(this.att.filename);
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
    if (!IMAGE_EXT.test(att.filename) && !FLDRAW_EXT.test(att.filename) && !AUDIO_EXT.test(att.filename) && !VIDEO_EXT.test(att.filename)) {
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


// ---------------------------------------------------------------------------
// Live preview: hide markdown syntax and render styled output while editing.
// Gated behind adapter.setLivePreview() (driven by the `live_preview` UI
// setting). The raw source is revealed on the line holding the cursor so it
// stays editable — same approach as the embed plugin above.
//
// The plugin walks the Lezer markdown syntax tree (kept in sync with the
// document by @codemirror/lang-markdown) and emits:
//   - Decoration.replace { widget } for whole-block widgets (code blocks,
//     callouts) — replaces the entire source span with a rendered DOM node.
//   - Decoration.replace {} (no widget) for inline markers (#, **, `, etc.)
//     — hides the marker text without collapsing the line.
//   - Decoration.mark { class } for the *content* of inline constructs —
//     styles the visible text (e.g. heading text becomes big/bold, link text
//     gets the accent color).
//
// Any node that overlaps the cursor's line is left untouched so the user can
// see and edit the raw markdown there.
// ---------------------------------------------------------------------------

// Node names in the @lezer/markdown tree that carry the leading marker
// characters we want to hide (the `#`, `>`, `` ` `` etc.). The helpers below
// (_hideFirstMark, _hideMarkChildren, _hideQuoteMarks, _styleListMarkers)
// walk the relevant node's children and emit Decoration.replace ranges for
// the marker nodes, leaving the content visible.

// Heading level → marker node name + content class. ATX headings ("# Title")
// have a HeaderMark first child followed by the heading text. Setext headings
// (underlined with ===/---) are not common in notes; we leave them as-is.
var HEADING_NODES = {
  ATXHeading1: { level: 1, cls: 'cm6-h1' },
  ATXHeading2: { level: 2, cls: 'cm6-h2' },
  ATXHeading3: { level: 3, cls: 'cm6-h3' },
  ATXHeading4: { level: 4, cls: 'cm6-h4' },
  ATXHeading5: { level: 5, cls: 'cm6-h5' },
  ATXHeading6: { level: 6, cls: 'cm6-h6' },
};

// Fenced code block widget: replaces ```lang\n...\n``` with a styled <pre>.
// Reuses the page's hljs (already loaded for preview mode) for syntax
// highlighting. Falls back to plain monospace when hljs isn't available.
class CodeBlockWidget extends WidgetType {
  constructor(lang, code) {
    super();
    this.lang = lang;
    this.code = code;
  }

  eq(other) {
    return other && other.lang === this.lang && other.code === this.code;
  }

  toDOM() {
    var pre = document.createElement('pre');
    pre.className = 'cm6-codeblock';
    var code = document.createElement('code');
    code.textContent = this.code;
    if (this.lang) code.className = 'language-' + this.lang;
    pre.appendChild(code);
    if (window.hljs) {
      try { window.hljs.highlightElement(code); } catch (e) { /* ignore */ }
    }
    return pre;
  }

  ignoreEvent() { return false; }
}

// Callout widget: replaces an Obsidian-style `> [!type] title` blockquote
// (possibly multi-line) with a styled callout box. Reuses window._getCalloutIcon
// and the .callout CSS classes from app.css so the look matches preview mode.
class CalloutWidget extends WidgetType {
  constructor(type, title, bodyLines) {
    super();
    this.type = type;
    this.title = title;
    this.bodyLines = bodyLines;
  }

  eq(other) {
    return other && other.type === this.type && other.title === this.title &&
      other.bodyLines.join('\n') === this.bodyLines.join('\n');
  }

  toDOM() {
    var callout = document.createElement('div');
    callout.className = 'callout';
    callout.setAttribute('data-callout', this.type);

    var titleDiv = document.createElement('div');
    titleDiv.className = 'callout-title';
    var iconHtml = window._getCalloutIcon
      ? window._getCalloutIcon(this.type)
      : '';
    titleDiv.innerHTML = iconHtml + '<span>' + _escapeHtml(this.title) + '</span>';
    callout.appendChild(titleDiv);

    if (this.bodyLines.length) {
      var contentDiv = document.createElement('div');
      contentDiv.className = 'callout-content';
      // Render the body as simple paragraphs separated by blank lines. We
      // intentionally don't run the full marked pipeline here (the body is
      // a fragment, not a full document) — inline markdown is left as text,
      // matching the "reveal on active line" contract: the user edits the
      // raw source on the callout's line and sees it rendered when they
      // leave it.
      var paragraphs = this.bodyLines.join('\n').split(/\n{2,}/);
      for (var i = 0; i < paragraphs.length; i++) {
        var p = document.createElement('p');
        p.textContent = paragraphs[i].replace(/\n/g, ' ');
        contentDiv.appendChild(p);
      }
      callout.appendChild(contentDiv);
    }
    return callout;
  }

  ignoreEvent() { return false; }
}

function _escapeHtml(s) {
  return s.replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Build the decoration set for the live-preview plugin. Walks the syntax tree
// top-down; for each recognized node decides whether to emit hide/mark/widget
// decorations. Nodes overlapping the active line are skipped.
function _buildLivePreview(state) {
  var builder = [];
  var excluded = [];  // ranges covered by block widgets or inline code/links
  var sel = state.selection.main;
  var headLine = state.doc.lineAt(sel.head).number;
  var doc = state.doc;

  function nodeOnActiveLine(from, to) {
    var startLine = doc.lineAt(from).number;
    var endLine = doc.lineAt(to).number;
    return headLine >= startLine && headLine <= endLine;
  }

  _walkTree(state, builder, nodeOnActiveLine, excluded);
  _decorateLiveInlineCode(state, builder, nodeOnActiveLine, excluded);
  _decorateLiveWikilinks(state, builder, nodeOnActiveLine, excluded);
  return Decoration.set(builder, true);
}

// Live-preview wikilink rendering: hide the [[ ]] brackets and style the
// inner text bold + accent-colored. Skipped on the cursor's line so the raw
// [[...]] source stays editable there. ![[...]] embeds are left to the embed
// plugin. Runs as part of the live-preview StateField.
var WIKILINK_LIVE_RE = /\[\[([^\]]+)\]\]/g;

function _decorateLiveWikilinks(state, builder, nodeOnActiveLine, excluded) {
  var doc = state.doc;
  var lineCount = doc.lines;
  for (var n = 1; n <= lineCount; n++) {
    var line = doc.line(n);
    var text = line.text;
    WIKILINK_LIVE_RE.lastIndex = 0;
    var m;
    while ((m = WIKILINK_LIVE_RE.exec(text)) !== null) {
      // Skip ![[...]] embeds (handled by the embed plugin).
      var bracketIdx = m.index;
      if (bracketIdx > 0 && text[bracketIdx - 1] === '!') continue;
      var fullFrom = line.from + bracketIdx;
      var fullTo = fullFrom + m[0].length;
      if (nodeOnActiveLine(fullFrom, fullTo)) continue;
      // Skip wikilinks inside block widgets / inline code / links.
      if (_inExcluded(fullFrom, excluded)) continue;
      // Hide the [[ and ]] brackets, mark the inner content bold + accent.
      builder.push(Decoration.replace({}).range(fullFrom, fullFrom + 2));
      builder.push(Decoration.replace({}).range(fullTo - 2, fullTo));
      if (fullFrom + 2 < fullTo - 2) {
        builder.push(Decoration.mark({ class: 'cm6-wikilink-live' }).range(fullFrom + 2, fullTo - 2));
      }
    }
  }
}

// Live-preview inline-code fallback: the Lezer tree is built incrementally, so
// lines far from the parse frontier may have no InlineCode node yet — this
// hides the backticks on those lines. Same active-line reveal as wikilinks.
var INLINE_CODE_LIVE_RE = /(`+)([^`]|[^`]*[^`\n])\1/g;

function _decorateLiveInlineCode(state, builder, nodeOnActiveLine, excluded) {
  var doc = state.doc;
  var lineCount = doc.lines;
  for (var n = 1; n <= lineCount; n++) {
    var line = doc.line(n);
    var text = line.text;
    INLINE_CODE_LIVE_RE.lastIndex = 0;
    var m;
    while ((m = INLINE_CODE_LIVE_RE.exec(text)) !== null) {
      var fullFrom = line.from + m.index;
      var fullTo = fullFrom + m[0].length;
      if (nodeOnActiveLine(fullFrom, fullTo)) continue;
      if (_inExcluded(fullFrom + 1, excluded)) continue;
      var openLen = m[1].length;
      builder.push(Decoration.replace({}).range(fullFrom, fullFrom + openLen));
      builder.push(Decoration.replace({}).range(fullTo - openLen, fullTo));
      if (excluded) excluded.push({ from: fullFrom, to: fullTo });
    }
  }
}

// Check whether a position falls inside any of the excluded ranges.
function _inExcluded(pos, excluded) {
  for (var i = 0; i < excluded.length; i++) {
    if (pos >= excluded[i].from && pos < excluded[i].to) return true;
  }
  return false;
}

function _walkTree(state, builder, nodeOnActiveLine, excluded) {
  var tree = syntaxTree(state);
  var doc = state.doc;

  tree.iterate({
    enter: function(node) {
      var name = node.name;
      var from = node.from, to = node.to;

      // --- Block-level widgets (replace whole span) ---

      // Fenced code block: ```lang \n code \n ```
      if (name === 'FencedCode') {
        if (nodeOnActiveLine(from, to)) return;
        // Parse from raw text — the @lezer/markdown child structure for the
        // info string varies across versions, so slicing the source is more
        // robust. Format: ```lang\n code \n```  (fence may be ~~~ too).
        var raw = doc.sliceString(from, to);
        var fenceMatch = raw.match(/^([`~]{3,})(\w*)\n([\s\S]*?)\n?[`~]{3,}$/);
        var lang, codeText;
        if (fenceMatch) {
          lang = fenceMatch[2] || '';
          codeText = fenceMatch[3] || '';
        } else {
          var lines = raw.split('\n');
          lang = (lines[0] || '').replace(/^[`~]{3,}/, '').trim();
          codeText = lines.slice(1, lines.length - 1).join('\n');
        }
        builder.push(Decoration.replace({
          block: true,
          widget: new CodeBlockWidget(lang, codeText),
        }).range(from, to));
        if (excluded) excluded.push({ from: from, to: to });
        return false;
      }

      // Callout: a Blockquote whose first line starts with [!type]
      if (name === 'Blockquote') {
        if (nodeOnActiveLine(from, to)) return;
        var blockText = doc.sliceString(from, to);
        var calloutParsed = _parseCallout(blockText);
        if (calloutParsed) {
          builder.push(Decoration.replace({
            block: true,
            widget: new CalloutWidget(calloutParsed.type, calloutParsed.title, calloutParsed.bodyLines),
          }).range(from, to));
          if (excluded) excluded.push({ from: from, to: to });
          return false;
        }
        // Not a callout — style the `>` markers on each line as dimmed.
        _hideQuoteMarks(node, builder);
        return false;
      }

      // --- Headings: hide the leading # marks, style the content ---
      var h = HEADING_NODES[name];
      if (h) {
        if (nodeOnActiveLine(from, to)) return;
        _hideFirstMark(node, builder);
        builder.push(Decoration.mark({ class: h.cls }).range(from, to));
        return false;
      }

      // --- Inline emphasis / strikethrough: hide the delim markers ---
      if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
        if (nodeOnActiveLine(from, to)) return;
        _hideMarkChildren(node, builder);
        return false;
      }

      // --- Inline code: hide the backticks (CodeText is already styled cm6-code
      // by the HighlightStyle; a second mark would nest backgrounds + compound
      // the 0.88em font-size) ---
      if (name === 'InlineCode') {
        if (nodeOnActiveLine(from, to)) return;
        _hideMarkChildren(node, builder);
        if (excluded) excluded.push({ from: from, to: to });
        return false;
      }

      // --- Links: hide [ ] ( ) and the URL, style the link text ---
      if (name === 'Link') {
        if (nodeOnActiveLine(from, to)) return;
        _hideLinkMarkers(node, builder);
        if (excluded) excluded.push({ from: from, to: to });
        return false;
      }

      // --- Images: ![alt](url) — leave as-is on non-active lines too,
      // the embed plugin handles ![[...]] embeds. Standard markdown images
      // are rare in notes; we just hide the leading ! and the URL. ---
      if (name === 'Image') {
        if (nodeOnActiveLine(from, to)) return;
        _hideLinkMarkers(node, builder);
        if (excluded) excluded.push({ from: from, to: to });
        return false;
      }

      // --- List markers: `-`, `*`, `+`, `1.` — dim rather than hide so the
      // list structure stays readable. Task markers [ ] / [x] are hidden. ---
      if (name === 'ListItem') {
        if (nodeOnActiveLine(from, to)) return;
        _styleListMarkers(node, builder);
        return false;
      }
    },
  });

  return Decoration.set(builder, true);
}

// Parse a blockquote's raw text for an Obsidian-style callout. Returns
// { type, title, bodyLines } or null if it's a plain blockquote.
// Format:
//   > [!type] Optional title
//   > body line 1
//   > body line 2
function _parseCallout(blockText) {
  var lines = blockText.split('\n');
  var stripped = [];
  for (var i = 0; i < lines.length; i++) {
    stripped.push(lines[i].replace(/^\s*>\s?/, ''));
  }
  var firstLine = stripped[0] || '';
  var m = firstLine.match(/^\[!(\w+)\]\s*(.*)/);
  if (!m) return null;
  var type = m[1].toLowerCase();
  var title = m[2] || type.charAt(0).toUpperCase() + type.slice(1);
  var bodyLines = stripped.slice(1);
  // Trim a single leading blank line (common when title is alone on line 1).
  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
  return { type: type, title: title, bodyLines: bodyLines };
}

// Hide the first child of a node (used for ATX heading HeaderMark).
function _hideFirstMark(node, builder) {
  var child = node.node.firstChild;
  if (child && child.name === 'HeaderMark') {
    builder.push(Decoration.replace({}).range(child.from, child.to));
  }
}

// Hide all *Mark children of a node (EmphasisMark, StrikethroughMark, CodeMark).
function _hideMarkChildren(node, builder) {
  var child = node.node.firstChild;
  while (child) {
    if (/Mark$/.test(child.name) || child.name === 'CodeMark') {
      builder.push(Decoration.replace({}).range(child.from, child.to));
    }
    child = child.nextSibling;
  }
}

// Hide the `>` quote markers on each line of a blockquote.
function _hideQuoteMarks(node, builder) {
  var child = node.node.firstChild;
  while (child) {
    if (child.name === 'QuoteMark') {
      builder.push(Decoration.replace({}).range(child.from, child.to));
    }
    child = child.nextSibling;
  }
}

// For a Link node: hide [ ] ( ) and the URL inside, keep the link text styled.
// Link children: LinkMark, LinkLabel (the [text]), LinkMark, URL, LinkMark, ...
// We hide LinkMark nodes and the URL node, and mark the LinkLabel content.
function _hideLinkMarkers(node, builder) {
  var child = node.node.firstChild;
  while (child) {
    if (child.name === 'LinkMark' || child.name === 'URL' || child.name === 'LinkTitle') {
      builder.push(Decoration.replace({}).range(child.from, child.to));
    } else if (child.name === 'LinkLabel') {
      builder.push(Decoration.mark({ class: 'cm6-link' }).range(child.from, child.to));
    }
    child = child.nextSibling;
  }
}

// Dim list markers and hide task markers ([ ] / [x]).
function _styleListMarkers(node, builder) {
  var child = node.node.firstChild;
  while (child) {
    if (child.name === 'ListMark') {
      builder.push(Decoration.mark({ class: 'cm6-list-marker' }).range(child.from, child.to));
    } else if (child.name === 'TaskMarker') {
      builder.push(Decoration.replace({}).range(child.from, child.to));
    }
    child = child.nextSibling;
  }
}

// Live preview is a StateField (not a ViewPlugin) because CM6 only permits
// Decoration.replace ranges that span line breaks from state fields. The
// code-block and callout widgets cover multiple lines, so a ViewPlugin would
// throw "Decorations that replace line breaks may not be specified via
// plugins". Recompute on doc or selection changes — covers typing, cursor
// movement, and programmatic edits. CM6 diffs the old and new decoration
// sets so only affected ranges are re-rendered in the DOM.
// Live preview is a StateField (not a ViewPlugin) because CM6 only permits
// Decoration.replace ranges that span line breaks from state fields. The
// code-block and callout widgets cover multiple lines, so a ViewPlugin would
// throw "Decorations that replace line breaks may not be specified via
// plugins". Recompute on doc or selection changes — covers typing, cursor
// movement, and programmatic edits. CM6 diffs the old and new decoration
// sets so only affected ranges are re-rendered in the DOM.
var livePreviewField = StateField.define({
  create(state) {
    return _buildLivePreview(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) return _buildLivePreview(tr.state);
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function makeLivePreviewPlugin() {
  return livePreviewField;
}

// When live preview is active, block widgets (code blocks, callouts) replace
// entire line ranges. CM6's default ArrowUp/ArrowDown uses *visual* line
// movement, which skips over block widgets — the cursor jumps from the line
// above to the line below without ever landing on the widget's first/last
// line. That prevents the user from entering the block to edit its raw source
// (our active-line reveal only triggers when the cursor is on the block's
// line). These handlers replace the default vertical movement entirely when
// live preview is on: move one *document* line at a time. If the destination
// line is inside a block widget, snap to the block's boundary line instead.
function _livePreviewBlockRanges(view) {
  var field = view.state.field(livePreviewField, false);
  if (!field) return null;
  var decos = view.state.field(livePreviewField);
  if (!decos || !decos.size) return null;
  var ranges = [];
  decos.between(0, view.state.doc.length, function(from, to, deco) {
    if (deco.spec.block) ranges.push({ from: from, to: to });
  });
  return ranges.length ? ranges : null;
}

// Find the block widget whose line range contains the given line number.
// Returns {from, to} or null.
function _blockAtLine(blocks, view, lineNum) {
  for (var i = 0; i < blocks.length; i++) {
    var r = blocks[i];
    var fromLine = view.state.doc.lineAt(r.from).number;
    var toLine = _blockLastLineNum(view.state.doc, r);
    if (lineNum >= fromLine && lineNum <= toLine) return r;
  }
  return null;
}

// Block replace ranges are exclusive at `to` — when `to` falls on a line
// start, the block's last content line is the one before it.
function _blockLastLineNum(doc, block) {
  var toLine = doc.lineAt(block.to);
  if (block.to === toLine.from && toLine.number > 1) return toLine.number - 1;
  return toLine.number;
}

function _moveVertically(view, dir) {
  var blocks = _livePreviewBlockRanges(view);
  var head = view.state.selection.main.head;
  var line = view.state.doc.lineAt(head);
  var col = head - line.from;
  var doc = view.state.doc;

  if (!blocks) {
    // No block widgets — let the default handler run.
    return false;
  }

  var targetLineNum = dir < 0 ? line.number - 1 : line.number + 1;
  if (targetLineNum < 1 || targetLineNum > doc.lines) return false;

  // If the target line is inside a block widget, snap to the block's
  // boundary line (first line for ArrowDown, last line for ArrowUp).
  var block = _blockAtLine(blocks, view, targetLineNum);
  if (block) {
    if (dir < 0) {
      // Moving up into a block — land on the block's last line.
      targetLineNum = _blockLastLineNum(doc, block);
    } else {
      // Moving down into a block — land on the block's first line.
      targetLineNum = doc.lineAt(block.from).number;
    }
  }

  var target = doc.line(targetLineNum);
  var pos = Math.min(target.from + col, target.to);
  view.dispatch({
    selection: EditorSelection.single(pos),
    scrollIntoView: true,
  });
  return true;
}

function arrowUpLivePreview(view) {
  return _moveVertically(view, -1);
}

function arrowDownLivePreview(view) {
  return _moveVertically(view, 1);
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

  // Compartment for the live-preview plugin (hide markdown syntax, render
  // styled output). Toggled at runtime via adapter.setLivePreview().
  var livePreviewCompartment = new Compartment();

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

    // Live preview (gated by Compartment; off by default)
    livePreviewCompartment.of(options.livePreview ? makeLivePreviewPlugin() : []),

    // Keybindings (order matters — custom first, then markdown, then defaults)
    keymap.of(customKeys),
    // Live-preview arrow interception: when the cursor would skip over a
    // block widget (code block / callout), snap to its boundary line instead
    // so the user can enter the block and edit raw markdown. Handlers are
    // no-ops (return false) when live preview is off, so default arrows run.
    keymap.of([
      { key: 'ArrowUp', run: arrowUpLivePreview },
      { key: 'ArrowDown', run: arrowDownLivePreview },
    ]),
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

  // Toggle live-preview rendering at runtime without rebuilding the editor.
  adapter.setLivePreview = function(enabled) {
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(enabled ? makeLivePreviewPlugin() : []),
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
