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
     * Sanitize HTML from markdown renderers using DOMPurify.
     * If DOMPurify is unavailable, use an allowlist-based fallback
     * that permits safe formatting tags and strips everything else.
     */
    var ALLOWED_TAGS = {
        'H1':1,'H2':1,'H3':1,'H4':1,'H5':1,'H6':1,
        'P':1,'BR':1,'HR':1,'BLOCKQUOTE':1,'PRE':1,'CODE':1,
        'UL':1,'OL':1,'LI':1,'DL':1,'DT':1,'DD':1,
        'STRONG':1,'EM':1,'B':1,'I':1,'U':1,'S':1,'DEL':1,'INS':1,
        'MARK':1,'SMALL':1,'SUB':1,'SUP':1,'ABBR':1,'KBD':1,
        'A':1,'IMG':1,'TABLE':1,'THEAD':1,'TBODY':1,'TR':1,'TH':1,'TD':1,
        'DETAILS':1,'SUMMARY':1,'SPAN':1,'DIV':1
    };
    var ALLOWED_ATTRS = {
        'href':1,'src':1,'alt':1,'title':1,'class':1,'id':1,
        'colspan':1,'rowspan':1,'align':1,'open':1
    };
    var SAFE_URL = /^(?:https?:|\/|#|mailto:)/i;

    function sanitizeFallback(html) {
        var doc = document.createElement('div');
        doc.innerHTML = html;
        walkNode(doc);
        return doc.innerHTML;
    }

    function walkNode(node) {
        var i = node.childNodes.length;
        while (i--) {
            var child = node.childNodes[i];
            if (child.nodeType === 3) continue; // text node — keep
            if (child.nodeType === 1) { // element
                if (!ALLOWED_TAGS[child.tagName]) {
                    // Replace disallowed element with its text content
                    node.replaceChild(document.createTextNode(child.textContent), child);
                    continue;
                }
                // Strip disallowed attributes
                var attrs = Array.from(child.attributes);
                for (var j = 0; j < attrs.length; j++) {
                    var name = attrs[j].name.toLowerCase();
                    if (!ALLOWED_ATTRS[name] || name.startsWith('on')) {
                        child.removeAttribute(attrs[j].name);
                    } else if ((name === 'href' || name === 'src') && !SAFE_URL.test(attrs[j].value.trim())) {
                        child.removeAttribute(attrs[j].name);
                    }
                }
                walkNode(child);
            } else {
                // Comments, processing instructions — remove
                node.removeChild(child);
            }
        }
    }

    function sanitizeMarkdown(html) {
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html);
        }
        return sanitizeFallback(html);
    }

    window.escapeHtml = escapeHtml;
    window.sanitizeMarkdown = sanitizeMarkdown;
})();
