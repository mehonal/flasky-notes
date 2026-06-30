(function () {
    'use strict';

    var NAV_FLAG = 'flasky-nav';
    var LOADING_CLASS = 'is-loading';
    var DONE_CLASS = 'is-done';
    var HIDING_CLASS = 'is-hiding';

    // The progress bar signals in-flight navigation; it complements (rather
    // than conflicts with) the cross-document View Transitions cross-fade
    // enabled via CSS in Chromium/Safari. Always run regardless of VT support.
    var bar = null;
    var hideTimer = null;

    function ensureBar() {
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'flasky-nav-progress';
        (document.body || document.documentElement).appendChild(bar);
        return bar;
    }

    function showBar() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        ensureBar();
        bar.classList.remove(DONE_CLASS, HIDING_CLASS);
        bar.classList.add(LOADING_CLASS);
    }

    function finishBar() {
        if (!bar) return;
        bar.classList.remove(LOADING_CLASS);
        bar.classList.add(DONE_CLASS);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            bar.classList.add(HIDING_CLASS);
            hideTimer = setTimeout(function () {
                bar.classList.remove(DONE_CLASS, HIDING_CLASS);
                hideTimer = null;
            }, 360);
        }, 60);
    }

    function isInternalLink(a) {
        if (!a) return false;
        if (a.target && a.target !== '_self') return false;
        if (a.hasAttribute('download')) return false;
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#') return false;
        var url;
        try { url = new URL(a.href, window.location.href); } catch (e) { return false; }
        if (url.origin !== window.location.origin) return false;
        // Editor-intercepted note links inside the preview pane are handled
        // by app.js (openNote) and never trigger a full navigation.
        if (a.closest('#note-preview')) return false;
        return true;
    }

    // Show the bar before the current page unloads on a same-origin nav.
    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href]');
        if (!isInternalLink(a)) return;
        showBar();
        try { sessionStorage.setItem(NAV_FLAG, '1'); } catch (e) {}
    }, true);

    // Arrived on a new page (or restored from bfcache on back/forward).
    function onPageArrival() {
        var flagged = false;
        try { flagged = sessionStorage.getItem(NAV_FLAG) === '1'; } catch (e) {}
        if (!flagged) return;
        try { sessionStorage.removeItem(NAV_FLAG); } catch (e) {}
        ensureBar();
        showBar();
        // Finish once the new document has painted, so the bar completes
        // promptly on load rather than lingering through E2EE decrypt.
        requestAnimationFrame(function () { requestAnimationFrame(finishBar); });
    }

    window.addEventListener('pageshow', function (e) {
        // persisted === true means bfcache restore (back/forward).
        if (e.persisted) {
            ensureBar();
            showBar();
            requestAnimationFrame(function () { requestAnimationFrame(finishBar); });
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onPageArrival);
    } else {
        onPageArrival();
    }
})();