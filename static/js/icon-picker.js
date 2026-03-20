/**
 * Lucide Icon Picker — searchable icon grid with color support.
 * No dependencies. Loads icon data lazily from /static/js/lucide-icons.json.
 *
 * Usage:
 *   openIconPicker({ icon, color, onSelect(icon, color), onRemove() })
 */
(function() {
    var ICONS = null;       // { name: svgInner }
    var TAGS = null;        // { name: [tag, ...] }
    var ICON_NAMES = null;  // sorted array
    var overlay = null;
    var searchInput = null;
    var gridEl = null;
    var colorRow = null;
    var hexInput = null;
    var currentCallback = null;
    var currentRemoveCallback = null;
    var selectedIcon = null;
    var selectedColor = null;
    var renderBatch = 80;

    var PRESET_COLORS = [
        null,       // default (theme color)
        '#ef4444',  // red
        '#f97316',  // orange
        '#eab308',  // yellow
        '#22c55e',  // green
        '#14b8a6',  // teal
        '#3b82f6',  // blue
        '#8b5cf6',  // purple
        '#ec4899',  // pink
    ];

    function renderLucideIcon(name, color, size) {
        if (!ICONS || !ICONS[name]) return '';
        var style = color ? 'color:' + color : '';
        return '<svg viewBox="0 0 24 24" width="' + (size||16) + '" height="' + (size||16) + '" ' +
            'stroke="currentColor" fill="none" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"' +
            (style ? ' style="' + style + '"' : '') + '>' +
            ICONS[name] + '</svg>';
    }

    // Expose globally for sidebar/editor use
    window.renderLucideIcon = renderLucideIcon;
    window.ensureLucideLoaded = ensureLoaded;

    function ensureLoaded(cb) {
        if (ICONS) return cb();
        var done = 0;
        function check() { if (++done === 2) { ICON_NAMES = Object.keys(ICONS).sort(); cb(); } }
        fetch('/static/js/lucide-icons.json').then(function(r) { return r.json(); }).then(function(d) { ICONS = d; check(); });
        fetch('/static/js/lucide-tags.json').then(function(r) { return r.json(); }).then(function(d) { TAGS = d; check(); });
    }

    function createOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'icon-picker-overlay';
        overlay.innerHTML =
            '<div class="icon-picker-modal">' +
                '<div class="icon-picker-header">' +
                    '<input type="text" class="icon-picker-search" placeholder="Search icons..." autofocus>' +
                    '<button class="icon-picker-close" title="Close">&times;</button>' +
                '</div>' +
                '<div class="icon-picker-colors"></div>' +
                '<div class="icon-picker-grid"></div>' +
                '<div class="icon-picker-footer">' +
                    '<button class="icon-picker-remove-btn">Remove icon</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        searchInput = overlay.querySelector('.icon-picker-search');
        gridEl = overlay.querySelector('.icon-picker-grid');
        colorRow = overlay.querySelector('.icon-picker-colors');

        // Build color swatches
        var colorsHtml = '';
        PRESET_COLORS.forEach(function(c) {
            var cls = 'icon-color-swatch' + (c === null ? ' swatch-default' : '');
            var bg = c || 'var(--text-primary, #ccc)';
            colorsHtml += '<button class="' + cls + '" data-color="' + (c || '') + '" style="background:' + bg + '" title="' + (c || 'Default') + '"></button>';
        });
        colorsHtml += '<input type="text" class="icon-hex-input" placeholder="#hex" maxlength="7">';
        colorRow.innerHTML = colorsHtml;
        hexInput = colorRow.querySelector('.icon-hex-input');

        // Events
        searchInput.addEventListener('input', function() { renderGrid(searchInput.value); });
        overlay.querySelector('.icon-picker-close').addEventListener('click', closeIconPicker);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeIconPicker();
        });

        colorRow.addEventListener('click', function(e) {
            var swatch = e.target.closest('.icon-color-swatch');
            if (!swatch) return;
            var c = swatch.dataset.color || null;
            selectedColor = c;
            hexInput.value = c || '';
            highlightColor();
            updatePreview();
        });

        hexInput.addEventListener('input', function() {
            var v = hexInput.value.trim();
            if (/^#[0-9a-fA-F]{3,6}$/.test(v)) {
                selectedColor = v;
                highlightColor();
                updatePreview();
            }
        });

        overlay.querySelector('.icon-picker-remove-btn').addEventListener('click', function() {
            if (currentRemoveCallback) currentRemoveCallback();
            closeIconPicker();
        });

        gridEl.addEventListener('click', function(e) {
            var cell = e.target.closest('.icon-cell');
            if (!cell) return;
            selectedIcon = cell.dataset.icon;
            if (currentCallback) currentCallback(selectedIcon, selectedColor);
            closeIconPicker();
        });
    }

    function highlightColor() {
        var swatches = colorRow.querySelectorAll('.icon-color-swatch');
        swatches.forEach(function(s) {
            var c = s.dataset.color || null;
            s.classList.toggle('active', c === selectedColor);
        });
    }

    function updatePreview() {
        // Re-render visible icons with current color
        var cells = gridEl.querySelectorAll('.icon-cell');
        cells.forEach(function(cell) {
            var name = cell.dataset.icon;
            cell.innerHTML = renderLucideIcon(name, selectedColor, 28) +
                '<span class="icon-cell-name">' + name + '</span>';
        });
    }

    function renderGrid(query) {
        var filtered = ICON_NAMES;
        if (query) {
            var q = query.toLowerCase().split(/\s+/);
            filtered = ICON_NAMES.filter(function(name) {
                var haystack = name;
                if (TAGS && TAGS[name]) haystack += ' ' + TAGS[name].join(' ');
                haystack = haystack.toLowerCase();
                return q.every(function(term) { return haystack.indexOf(term) !== -1; });
            });
        }
        gridEl.innerHTML = '';
        gridEl._filtered = filtered;
        gridEl._rendered = 0;
        renderMoreItems();
    }

    function renderMoreItems() {
        var filtered = gridEl._filtered;
        var start = gridEl._rendered;
        var end = Math.min(start + renderBatch, filtered.length);
        var html = '';
        for (var i = start; i < end; i++) {
            var name = filtered[i];
            html += '<div class="icon-cell" data-icon="' + name + '" title="' + name + '">' +
                renderLucideIcon(name, selectedColor, 28) +
                '<span class="icon-cell-name">' + name + '</span>' +
                '</div>';
        }
        gridEl.insertAdjacentHTML('beforeend', html);
        gridEl._rendered = end;
    }

    function onGridScroll() {
        if (!gridEl._filtered) return;
        if (gridEl._rendered >= gridEl._filtered.length) return;
        if (gridEl.scrollTop + gridEl.clientHeight >= gridEl.scrollHeight - 100) {
            renderMoreItems();
        }
    }

    window.openIconPicker = function(opts) {
        opts = opts || {};
        ensureLoaded(function() {
            createOverlay();
            selectedIcon = opts.icon || null;
            selectedColor = opts.color || null;
            currentCallback = opts.onSelect || null;
            currentRemoveCallback = opts.onRemove || null;
            searchInput.value = '';
            hexInput.value = selectedColor || '';
            highlightColor();
            renderGrid('');
            gridEl.addEventListener('scroll', onGridScroll);
            overlay.classList.add('visible');
            searchInput.focus();
        });
    };

    function closeIconPicker() {
        if (overlay) {
            overlay.classList.remove('visible');
            gridEl.removeEventListener('scroll', onGridScroll);
        }
    }
    window.closeIconPicker = closeIconPicker;
})();
