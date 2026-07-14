/**
 * Flasky Notes — SPA router.
 *
 * The note editor page (note_single.html) is the persistent shell. All JS/CSS
 * is loaded there once. Cross-page navigation to /agenda, /settings, /ai,
 * /export, etc. is done in-place:
 *
 *   1. Intercept same-origin <a> clicks (except note links + #note-preview).
 *   2. history.pushState + fetch the URL with ?_fragment=1.
 *   3. The server returns just the inner view HTML (no <html>/<head>/<body>).
 *   4. Swap it into the #app-view overlay (full-screen, above the editor).
 *   5. Call the registered view module's init(), if any.
 *
 * Note-to-note navigation (/note/<id>) is NOT handled here — app.js's loadNote
 * owns that (it fetches JSON, decrypts, updates DOM in place). The router only
 * steps in when leaving the editor for another page, and when returning from
 * another page back to a note (closes the overlay and resumes the editor).
 *
 * View modules register themselves: FlaskyRouter.registerView('/export', {
 *   init(container) {...}, destroy() {...}
 * });
 */
(function () {
    'use strict';

    var VIEW_CONTAINER_ID = 'app-view';
    var FRAGMENT_PARAM = '_fragment';
    var NOTE_PATH_RE = /^\/note\/(\d+)(?:[/?#]|$)/;

    var _views = {};          // path-prefix -> { init, destroy }
    var _currentView = null;  // { path, module, container }
    var _inFlight = null;     // AbortController for current fetch
    var _bar = null;
    var _hideTimer = null;

    // ---- progress bar (kept from page-transition.js) ----
    function ensureBar() {
        if (_bar) return _bar;
        _bar = document.createElement('div');
        _bar.className = 'flasky-nav-progress';
        document.body.appendChild(_bar);
        return _bar;
    }
    function showBar() {
        if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
        ensureBar();
        _bar.classList.remove('is-done', 'is-hiding');
        _bar.classList.add('is-loading');
    }
    function finishBar() {
        if (!_bar) return;
        _bar.classList.remove('is-loading');
        _bar.classList.add('is-done');
        if (_hideTimer) clearTimeout(_hideTimer);
        _hideTimer = setTimeout(function () {
            _bar.classList.add('is-hiding');
            _hideTimer = setTimeout(function () {
                _bar.classList.remove('is-done', 'is-hiding');
                _hideTimer = null;
            }, 360);
        }, 60);
    }

    // ---- helpers ----
    function isInternalLink(a) {
        if (!a) return false;
        if (a.target && a.target !== '_self') return false;
        if (a.hasAttribute('download')) return false;
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#') return false;
        var url;
        try { url = new URL(a.href, window.location.href); } catch (e) { return false; }
        if (url.origin !== window.location.origin) return false;
        return true;
    }

    function isNoteLink(path) {
        return NOTE_PATH_RE.test(path);
    }

    function isEditorActive() {
        return !_currentView;
    }

    function getContainer() {
        var el = document.getElementById(VIEW_CONTAINER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = VIEW_CONTAINER_ID;
            el.className = 'app-view-overlay';
            el.setAttribute('hidden', '');
            document.body.appendChild(el);
        }
        return el;
    }

    function matchView(path) {
        // Strip query string for matching — only the pathname matters.
        var qIdx = path.indexOf('?');
        var pathname = qIdx === -1 ? path : path.substring(0, qIdx);
        var match = null;
        var bestLen = 0;
        Object.keys(_views).forEach(function (prefix) {
            if (pathname === prefix || pathname.indexOf(prefix + '/') === 0) {
                if (prefix.length > bestLen) { match = prefix; bestLen = prefix.length; }
            }
        });
        return match ? { prefix: match, module: _views[match] } : null;
    }

    function destroyCurrentView() {
        if (_currentView && _currentView.module && typeof _currentView.module.destroy === 'function') {
            try { _currentView.module.destroy(); } catch (e) { console.warn('view destroy failed', e); }
        }
        _currentView = null;
    }

    function getEditorRoot() {
        return document.querySelector('body > .app') || document.querySelector('body > .app-shell');
    }

    var _editorRoot = null;

    function detachEditor() {
        var root = getEditorRoot();
        if (!root || root.parentNode !== document.body) return;
        _editorRoot = root;
        document.body.removeChild(root);
    }

    function reattachEditor() {
        if (_editorRoot && _editorRoot.parentNode !== document.body) {
            document.body.appendChild(_editorRoot);
        }
        _editorRoot = null;
    }

    function closeOverlay() {
        destroyCurrentView();
        var el = getContainer();
        el.innerHTML = '';
        el.setAttribute('hidden', '');
        document.body.classList.remove('app-view-open');
        reattachEditor();
    }

    function openOverlay(html, viewModule) {
        detachEditor();
        var el = getContainer();
        el.innerHTML = html;
        el.removeAttribute('hidden');
        document.body.classList.add('app-view-open');
        if (viewModule && typeof viewModule.init === 'function') {
            try { viewModule.init(el); } catch (e) { console.error('view init failed', e); }
        }
        _currentView = { module: viewModule, container: el };
    }

    function buildFragmentUrl(path) {
        var sep = path.indexOf('?') === -1 ? '?' : '&';
        return path + sep + FRAGMENT_PARAM + '=1';
    }

    async function fetchFragment(path) {
        if (_inFlight) { _inFlight.abort(); }
        _inFlight = new AbortController();
        var resp = await fetch(buildFragmentUrl(path), {
            headers: { 'Accept': 'text/html' },
            signal: _inFlight.signal,
            credentials: 'same-origin'
        });
        if (!resp.ok) throw new Error('Fragment fetch failed: ' + resp.status);
        return await resp.text();
    }

    async function navigate(path, opts) {
        opts = opts || {};
        if (isNoteLink(path)) {
            var match = path.match(NOTE_PATH_RE);
            var noteId = parseInt(match[1], 10);
            closeOverlay();
            // loadNote owns the pushState for note-to-note navigation.
            if (typeof window.loadNote === 'function') {
                window.loadNote(noteId);
            } else {
                window.location.href = path;
            }
            return;
        }

        var viewMatch = matchView(path);
        if (!viewMatch) {
            window.location.href = path;
            return;
        }

        showBar();
        var html;
        try {
            html = await fetchFragment(path);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('router fetch failed', e);
            window.location.href = path;
            return;
        } finally {
            _inFlight = null;
        }

        destroyCurrentView();
        if (!opts.popstate && !opts.noPushState) history.pushState({ flasky: { view: 'page', path: path } }, '', path);
        openOverlay(html, viewMatch ? viewMatch.module : null);
        finishBar();
    }

    function handlePopState(e) {
        var st = e.state;
        if (st && st.flasky && st.flasky.view === 'page') {
            // Returning to a non-editor view — re-fetch the fragment.
            navigate(st.flasky.path, { popstate: true });
        } else if (st && st.flasky && st.flasky.view === 'note') {
            // Note navigation is handled by app.js's popstate handler which
            // calls loadNote. The router just ensures the overlay is closed,
            // but app.js also calls closeOverlay — so skip to avoid double-call.
        } else if (!st) {
            if (!isEditorActive()) {
                navigate(window.location.pathname + window.location.search, { popstate: true });
            }
        }
    }

    function onDocClick(e) {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || !isInternalLink(a)) return;
        var url;
        try { url = new URL(a.href, window.location.href); } catch (e) { return; }
        var path = url.pathname + url.search;
        if (isNoteLink(path)) return;
        if (!matchView(path)) return;
        e.preventDefault();
        navigate(path);
    }

    function onDocClickCapture(e) {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || !isInternalLink(a)) return;
        var url;
        try { url = new URL(a.href, window.location.href); } catch (e) { return; }
        if (isNoteLink(url.pathname)) return;
        if (!matchView(url.pathname)) return;
        showBar();
    }

    function registerView(prefix, module) {
        _views[prefix] = module || {};
    }

    function init() {
        window.addEventListener('popstate', handlePopState);
        document.addEventListener('click', onDocClick, false);
        document.addEventListener('click', onDocClickCapture, true);
        var container = getContainer();
        if (container) container.setAttribute('hidden', '');

        if (!history.state || !history.state.flasky) {
            history.replaceState(
                { flasky: { view: 'note', noteId: window._pageData ? window._pageData.noteId : 0 } },
                '',
                window.location.href
            );
        }
    }

    window.FlaskyRouter = {
        init: init,
        navigate: navigate,
        registerView: registerView,
        closeOverlay: closeOverlay,
        isEditorActive: isEditorActive
    };
})();