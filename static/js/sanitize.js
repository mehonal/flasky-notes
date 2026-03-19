/**
 * Shared HTML escaping utility.
 * Use escapeHtml() whenever inserting user-controlled text into innerHTML.
 */
(function () {
    'use strict';

    var entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, function (c) {
            return entityMap[c];
        });
    }

    /**
     * Sanitize HTML from markdown renderers using DOMPurify if available,
     * otherwise strip scripts/event handlers as a fallback.
     */
    function sanitizeMarkdown(html) {
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html);
        }
        // Fallback: strip script tags and on* attributes
        var div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script').forEach(function (el) { el.remove(); });
        div.querySelectorAll('*').forEach(function (el) {
            Array.from(el.attributes).forEach(function (attr) {
                if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
            });
        });
        return div.innerHTML;
    }

    window.escapeHtml = escapeHtml;
    window.sanitizeMarkdown = sanitizeMarkdown;
})();
