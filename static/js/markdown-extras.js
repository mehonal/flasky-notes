/**
 * FlaskyMarkdown — shared markdown extras for all themes
 * Provides callout processing for Obsidian-style > [!TYPE] blockquotes
 */
var FlaskyMarkdown = (function() {
    var calloutIcons = {
        note: 'pencil', info: 'info', tip: 'flame', hint: 'flame',
        warning: 'alert-triangle', caution: 'alert-triangle', attention: 'alert-triangle',
        danger: 'zap', error: 'x-circle', failure: 'x-circle', fail: 'x-circle', missing: 'x-circle',
        success: 'check-circle', check: 'check-circle', done: 'check-circle',
        question: 'help-circle', help: 'help-circle', faq: 'help-circle',
        example: 'list', quote: 'quote', cite: 'quote',
        abstract: 'clipboard', summary: 'clipboard', tldr: 'clipboard',
        bug: 'bug', todo: 'check-square'
    };

    var icons = {
        'pencil': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        'info': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        'flame': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 1.5 3z"/></svg>',
        'alert-triangle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        'zap': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        'x-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        'check-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        'help-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        'list': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        'quote': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>',
        'clipboard': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
        'bug': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 10h2"/><path d="M3 10h2"/><path d="M19 14h2"/><path d="M3 14h2"/><path d="M19 18h2"/><path d="M3 18h2"/><path d="M9 2l1.5 3"/><path d="M15 2l-1.5 3"/></svg>',
        'check-square': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    };

    function getCalloutIcon(type) {
        var iconName = calloutIcons[type] || 'info';
        return '<span class="callout-title-icon">' + (icons[iconName] || icons['info']) + '</span>';
    }

    function processCallouts(html) {
        var div = document.createElement('div');
        div.innerHTML = html;

        div.querySelectorAll('blockquote').forEach(function(bq) {
            var firstP = bq.querySelector('p');
            if (!firstP) return;
            var text = firstP.innerHTML;
            var match = text.match(/^\[!(\w+)\]\s*(.*)/);
            if (!match) return;

            var calloutType = match[1].toLowerCase();
            var titleText = match[2] || calloutType.charAt(0).toUpperCase() + calloutType.slice(1);

            var callout = document.createElement('div');
            callout.className = 'callout';
            callout.setAttribute('data-callout', calloutType);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'callout-title';
            titleDiv.innerHTML = getCalloutIcon(calloutType) + '<span>' + titleText + '</span>';
            callout.appendChild(titleDiv);

            var contentDiv = document.createElement('div');
            contentDiv.className = 'callout-content';

            var afterTitle = text.substring(match[0].length);
            if (afterTitle.trim()) {
                var p = document.createElement('p');
                p.innerHTML = afterTitle.replace(/^<br\s*\/?>/, '');
                if (p.innerHTML.trim()) contentDiv.appendChild(p);
            }

            var children = Array.from(bq.children);
            for (var i = 0; i < children.length; i++) {
                if (children[i] === firstP) continue;
                contentDiv.appendChild(children[i].cloneNode(true));
            }

            if (contentDiv.innerHTML.trim()) {
                callout.appendChild(contentDiv);
            }

            bq.parentNode.replaceChild(callout, bq);
        });

        return div.innerHTML;
    }

    return {
        processCallouts: processCallouts,
        getCalloutIcon: getCalloutIcon
    };
})();
