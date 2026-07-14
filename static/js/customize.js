/* Flasky Notes — Customize appearance (colors, font, custom CSS, AI generate).
   Loaded in the SPA shell (note_single.html). Self-contained: registers its
   own delegated listeners for data-action="customize-*" / "open-customize" /
   "save-customize" / etc. so it does not need to be wired into app.js's
   central switch. */
(function() {
    'use strict';

    // ---------- Page data ----------
    var pageDataEl = document.getElementById('app-page-data');
    var pageData = pageDataEl ? JSON.parse(pageDataEl.textContent) : null;
    // Settings page uses a separate data block.
    if (!pageData || pageData.customColors === undefined) {
        var sd = document.getElementById('customize-page-data');
        if (sd) {
            try { pageData = JSON.parse(sd.textContent); } catch(e) { pageData = {}; }
        } else {
            pageData = {};
        }
    }

    var SAVED_COLORS = pageData.customColors || {};
    var SAVED_CSS = pageData.customCss || '';
    var AI_ENABLED = !!pageData.aiEnabled;
    var SAVED_FONT_FAMILY = pageData.fontFamily || '';
    var SAVED_FONT_SIZE = pageData.fontSize || 16;

    // The 10 customizable vars with friendly labels. rgba vars use text input.
    var COLOR_VARS = [
        {var: '--bg-primary',    label: 'Background',      rgba: false},
        {var: '--bg-secondary',  label: 'Secondary bg',    rgba: false},
        {var: '--bg-sidebar',    label: 'Sidebar bg',      rgba: false},
        {var: '--text-primary',  label: 'Text',            rgba: false},
        {var: '--text-secondary',label: 'Secondary text',  rgba: false},
        {var: '--text-muted',    label: 'Muted text',      rgba: false},
        {var: '--accent',        label: 'Accent',          rgba: false},
        {var: '--accent-hover',  label: 'Accent hover',    rgba: false},
        {var: '--border',        label: 'Border',          rgba: true},
        {var: '--border-light',  label: 'Border light',    rgba: true}
    ];
    var DEFAULT_COLORS = {
        dark: {
            '--bg-primary': '#1e1e2e', '--bg-secondary': '#181825',
            '--bg-sidebar': '#11111b', '--text-primary': '#cdd6f4',
            '--text-secondary': '#bac2de', '--text-muted': '#585b70',
            '--accent': '#b4befe', '--accent-hover': '#cba6f7',
            '--border': 'rgba(255,255,255,0.06)', '--border-light': 'rgba(255,255,255,0.1)'
        },
        light: {
            '--bg-primary': '#f8f9fc', '--bg-secondary': '#eff1f5',
            '--bg-sidebar': '#e6e9ef', '--text-primary': '#4c4f69',
            '--text-secondary': '#5c5f77', '--text-muted': '#9ca0b0',
            '--accent': '#7287fd', '--accent-hover': '#8839ef',
            '--border': 'rgba(0,0,0,0.06)', '--border-light': 'rgba(0,0,0,0.1)'
        }
    };

    // Pending (unsaved) state per scope. On open we copy from saved; on save
    // we persist; on cancel we revert.
    var scopes = {};  // {scope: {colors: {...}, css: str, font: str, fontSize: num, activeColorTheme: str}}

    function initScope(name) {
        scopes[name] = {
            colors: JSON.parse(JSON.stringify(SAVED_COLORS)),
            css: SAVED_CSS,
            font: SAVED_FONT_FAMILY,
            fontSize: SAVED_FONT_SIZE,
            activeColorTheme: 'dark'
        };
    }

    function getScope(name) {
        if (!scopes[name]) initScope(name);
        return scopes[name];
    }

    // ---------- Live preview helpers ----------
    // Build a CSS string with BOTH dark (:root) and light ([data-theme="light"])
    // rules from the scope's colors state — mirrors what the server-rendered
    // override block emits. Applied via a <style id="custom-colors-live">
    // element so it persists after save/revert without relying on the stale
    // server block.
    function buildColorsCss(st) {
        var lines = [];
        ['dark', 'light'].forEach(function(mode) {
            var modeColors = st.colors[mode];
            if (!modeColors || Object.keys(modeColors).length === 0) return;
            var selector = mode === 'dark' ? ':root' : '[data-theme="light"]';
            lines.push(selector + ' {');
            COLOR_VARS.forEach(function(c) {
                var val = modeColors[c.var];
                if (val !== undefined && val !== '') {
                    lines.push('  ' + c.var + ': ' + val + ';');
                }
            });
            lines.push('}');
        });
        return lines.join('\n');
    }

    function applyColorsLive(scopeName) {
        var st = getScope(scopeName);
        var css = buildColorsCss(st);
        var el = document.getElementById('custom-colors-live');
        if (!el) {
            el = document.createElement('style');
            el.id = 'custom-colors-live';
            document.head.appendChild(el);
        }
        el.textContent = css;
    }

    function applyCssLive(scopeName) {
        var st = getScope(scopeName);
        var el = document.getElementById('custom-css-live');
        if (!el) {
            el = document.createElement('style');
            el.id = 'custom-css-live';
            document.head.appendChild(el);
        }
        el.textContent = st.css || '';
    }

    function applyFontLive(scopeName) {
        var st = getScope(scopeName);
        if (st.font) {
            document.documentElement.style.setProperty('--editor-font', st.font);
        } else {
            document.documentElement.style.removeProperty('--editor-font');
        }
        if (st.fontSize) {
            document.documentElement.style.setProperty('--font-size', st.fontSize + 'px');
        }
    }

    function revertAll(scopeName) {
        // Restore from saved state
        initScope(scopeName);
        applyColorsLive(scopeName);
        applyCssLive(scopeName);
        applyFontLive(scopeName);
    }

    // ---------- Color picker grid build ----------
    function buildColorGrid(scopeName) {
        var grid = document.getElementById('color-grid-' + scopeName);
        if (!grid) return;
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        grid.innerHTML = '';
        COLOR_VARS.forEach(function(c) {
            var row = document.createElement('div');
            row.className = 'color-picker-row';
            var label = document.createElement('span');
            label.className = 'color-picker-label';
            label.textContent = c.label;
            row.appendChild(label);
            var ctrl = document.createElement('div');
            ctrl.className = 'color-picker-control';
            if (c.rgba) {
                var txt = document.createElement('input');
                txt.type = 'text';
                txt.className = 'customize-input color-text-input';
                txt.dataset.colorVar = c.var;
                txt.value = (st.colors[mode] && st.colors[mode][c.var]) || '';
                txt.placeholder = DEFAULT_COLORS[mode][c.var];
                ctrl.appendChild(txt);
            } else {
                var inp = document.createElement('input');
                inp.type = 'color';
                inp.className = 'color-input';
                inp.dataset.colorVar = c.var;
                var cur = (st.colors[mode] && st.colors[mode][c.var]) || DEFAULT_COLORS[mode][c.var];
                inp.value = toHexColor(cur);
                ctrl.appendChild(inp);
            }
            var reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'color-reset-btn';
            reset.dataset.action = 'reset-color';
            reset.dataset.colorVar = c.var;
            reset.dataset.scope = scopeName;
            reset.title = 'Reset';
            reset.innerHTML = '&#8617;';
            ctrl.appendChild(reset);
            row.appendChild(ctrl);
            grid.appendChild(row);
        });
    }

    function toHexColor(v) {
        // Best-effort: if it's already #hex, return; else try to convert.
        if (!v) return '#000000';
        if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
        if (/^#[0-9a-fA-F]{3}$/.test(v)) {
            return '#' + v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
        }
        // rgba/rgb or named → attempt via a temporary canvas/style trick
        var s = document.createElement('span');
        s.style.color = v;
        document.body.appendChild(s);
        var computed = getComputedStyle(s).color;
        document.body.removeChild(s);
        var m = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            return '#' + (+m[1]).toString(16).padStart(2,'0')
                       + (+m[2]).toString(16).padStart(2,'0')
                       + (+m[3]).toString(16).padStart(2,'0');
        }
        return '#000000';
    }

    // ---------- CSRF ----------
    function getCSRF() {
        var m = document.cookie.match(/X-CSRF-Token=([^;]+)/);
        return m ? m[1] : '';
    }

    // ---------- Persistence ----------
    function saveAll(scopeName) {
        var st = getScope(scopeName);
        var promises = [];
        promises.push(fetch('/api/save_custom_colors', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify({colors: st.colors})
        }).then(function(r){return r.json();}));
        promises.push(fetch('/api/save_custom_css', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify({css: st.css || ''})
        }).then(function(r){return r.json();}));
        promises.push(fetch('/api/save_font_family', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify({font: st.font || ''})
        }).then(function(r){return r.json();}));
        if (st.fontSize && st.fontSize !== SAVED_FONT_SIZE) {
            promises.push(fetch('/api/save_font_size/' + st.fontSize, {
                headers: {'X-CSRFToken': getCSRF()}
            }).then(function(r){return r.json();}));
        }
        return Promise.all(promises).then(function() {
            SAVED_COLORS = JSON.parse(JSON.stringify(st.colors));
            SAVED_CSS = st.css || '';
            SAVED_FONT_FAMILY = st.font || '';
            SAVED_FONT_SIZE = st.fontSize;
        });
    }

    // ---------- AI generate CSS ----------
    // Fetched lazily on first AI tab open per scope. Cached after first load.
    var aiModels = null;
    var aiModelsLoading = false;
    var aiDefaultModel = pageData.aiModel || '';

    function loadAiModels(scopeName, selectEl) {
        if (aiModels) {
            populateModelSelect(selectEl, aiModels);
            return;
        }
        if (aiModelsLoading) return;
        aiModelsLoading = true;
        fetch('/ai/api/models', {headers: {'X-CSRFToken': getCSRF()}})
            .then(function(r) { return r.json(); })
            .then(function(data) {
                aiModels = (data && data.models) || [];
                aiModelsLoading = false;
                populateModelSelect(selectEl, aiModels);
            }).catch(function() { aiModelsLoading = false; });
    }

    function populateModelSelect(selectEl, models) {
        if (!selectEl || !models || !models.length) return;
        var prev = selectEl.value || aiDefaultModel || '';
        selectEl.innerHTML = '';
        models.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === prev) opt.selected = true;
            selectEl.appendChild(opt);
        });
        if (!selectEl.value && aiDefaultModel) selectEl.value = aiDefaultModel;
    }

    function aiGenerate(scopeName) {
        var promptEl = document.getElementById('ai-css-prompt-' + scopeName);
        var resultEl = document.getElementById('ai-css-result-' + scopeName);
        var statusEl = document.getElementById('ai-css-status-' + scopeName);
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        var applyBtn = document.getElementById('apply-ai-css-btn-' + scopeName);
        var modelEl = document.getElementById('ai-css-model-' + scopeName);
        var includeCssEl = document.getElementById('ai-css-include-css-' + scopeName);
        var includeColorsEl = document.getElementById('ai-css-include-colors-' + scopeName);
        if (!promptEl || !resultEl || !statusEl || !outputEl || !applyBtn) return;
        var prompt = promptEl.value.trim();
        if (!prompt) { statusEl.textContent = 'Please enter a prompt.'; resultEl.hidden = false; return; }
        if (!AI_ENABLED) { statusEl.textContent = 'AI is not enabled.'; resultEl.hidden = false; return; }
        statusEl.textContent = 'Generating...';
        resultEl.hidden = false;
        outputEl.value = '';
        applyBtn.disabled = true;
        var st = getScope(scopeName);
        var payload = {
            prompt: prompt,
            theme: st.activeColorTheme,
            include_current_css: !!(includeCssEl && includeCssEl.checked),
            include_color_overrides: !!(includeColorsEl && includeColorsEl.checked),
        };
        if (modelEl && modelEl.value) payload.model = modelEl.value;
        fetch('/ai/api/generate_css', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.error) {
                statusEl.textContent = data.error;
                statusEl.className = 'ai-css-status ai-css-error';
                return;
            }
            outputEl.value = data.css || '';
            if (data.valid) {
                statusEl.textContent = 'Generated. Review and copy/apply.';
                statusEl.className = 'ai-css-status ai-css-ok';
                applyBtn.disabled = false;
            } else {
                statusEl.textContent = 'Generated, but may contain invalid CSS. Review carefully.';
                statusEl.className = 'ai-css-status ai-css-warn';
                applyBtn.disabled = false;
            }
        }).catch(function(err) {
            statusEl.textContent = 'Request failed: ' + err.message;
            statusEl.className = 'ai-css-status ai-css-error';
        });
    }

    function copyAiCss(scopeName) {
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        if (!outputEl) return;
        outputEl.select();
        try { document.execCommand('copy'); } catch(e) {}
        if (navigator.clipboard) {
            navigator.clipboard.writeText(outputEl.value).catch(function(){});
        }
    }

    function applyAiCss(scopeName) {
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        var cssTabBtn = document.querySelector('[data-action="customize-tab"][data-scope="' + scopeName + '"][data-tab="css"]');
        var cssInput = document.getElementById('cust-css-input-' + scopeName);
        if (!outputEl || !cssInput) return;
        var gen = outputEl.value.trim();
        if (!gen) return;
        var modeEl = document.querySelector('.ai-css-apply-mode[name="ai-css-apply-mode-' + scopeName + '"]:checked');
        var mode = modeEl ? modeEl.value : 'append';
        // Switch to CSS tab
        if (cssTabBtn) cssTabBtn.click();
        var existing = cssInput.value.trim();
        if (mode === 'replace') {
            cssInput.value = '/* AI generated */\n' + gen;
        } else {
            cssInput.value = existing ? existing + '\n\n/* AI generated */\n' + gen : '/* AI generated */\n' + gen;
        }
        // Live apply
        var st = getScope(scopeName);
        st.css = cssInput.value;
        applyCssLive(scopeName);
    }

    // ---------- Tab switching within a scope ----------
    function switchTab(scopeName, tab) {
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (!scope) return;
        scope.querySelectorAll('.customize-tab-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        scope.querySelectorAll('.customize-panel').forEach(function(p) {
            var name = p.dataset.customizePanel;
            p.hidden = (name !== scopeName + '-' + tab);
        });
        if (tab === 'ai' && AI_ENABLED) {
            var selectEl = document.getElementById('ai-css-model-' + scopeName);
            if (selectEl) loadAiModels(scopeName, selectEl);
        }
    }

    function switchColorTheme(scopeName, theme) {
        var st = getScope(scopeName);
        st.activeColorTheme = theme;
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (!scope) return;
        scope.querySelectorAll('.customize-theme-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.theme === theme);
        });
        buildColorGrid(scopeName);
    }

    // ---------- Reset helpers ----------
    function resetColor(scopeName, varName) {
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        if (st.colors[mode]) delete st.colors[mode][varName];
        applyColorsLive(scopeName);
        buildColorGrid(scopeName);
    }

    function resetAllColors(scopeName) {
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        if (st.colors[mode]) {
            delete st.colors[mode];
        }
        applyColorsLive(scopeName);
        buildColorGrid(scopeName);
    }

    // ---------- Modal open/close ----------
    function openModal() {
        var o = document.getElementById('customize-overlay');
        if (!o) return;
        initScope('modal');
        populateFields('modal');
        o.classList.add('visible');
    }
    function closeModal() {
        var o = document.getElementById('customize-overlay');
        if (!o) return;
        o.classList.remove('visible');
        revertAll('modal');
    }

    // ---------- Populate UI fields from scope state ----------
    function populateFields(scopeName) {
        var st = getScope(scopeName);
        // Colors
        buildColorGrid(scopeName);
        // Theme subtab
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (scope) {
            scope.querySelectorAll('.customize-theme-btn').forEach(function(b) {
                b.classList.toggle('active', b.dataset.theme === st.activeColorTheme);
            });
        }
        // Font
        var ff = document.getElementById('cust-font-family-' + scopeName);
        if (ff) ff.value = st.font || '';
        var fs = document.getElementById('cust-font-size-' + scopeName);
        if (fs) fs.value = st.fontSize;
        // CSS
        var css = document.getElementById('cust-css-input-' + scopeName);
        if (css) css.value = st.css || '';
        // Reset AI tab
        var aiResult = document.getElementById('ai-css-result-' + scopeName);
        if (aiResult) aiResult.hidden = true;
        var aiPrompt = document.getElementById('ai-css-prompt-' + scopeName);
        if (aiPrompt) aiPrompt.value = '';
    }

    // ---------- Save handler ----------
    // Flush pending DOM values into the scope state before persisting. The
    // input listener debounces CSS textarea updates (300ms), so if the user
    // types and immediately clicks Save the scope state would be stale. This
    // reads the live values from the DOM so Save always persists what's on
    // screen.
    function flushScope(scopeName) {
        var st = getScope(scopeName);
        var cssEl = document.getElementById('cust-css-input-' + scopeName);
        if (cssEl) st.css = cssEl.value;
        var ffEl = document.getElementById('cust-font-family-' + scopeName);
        if (ffEl) st.font = ffEl.value;
        var fsEl = document.getElementById('cust-font-size-' + scopeName);
        if (fsEl) {
            var v = parseInt(fsEl.value, 10);
            if (v >= 8 && v <= 40) st.fontSize = v;
        }
        // Colors are updated synchronously on input (no debounce), so st.colors
        // is already current — no flush needed.
    }

    function handleSave(scopeName) {
        flushScope(scopeName);
        saveAll(scopeName).then(function() {
            applyColorsLive(scopeName);
            applyCssLive(scopeName);
            applyFontLive(scopeName);
            if (scopeName === 'modal') closeModal();
            showStatus(scopeName, 'Saved');
        }).catch(function() {
            showStatus(scopeName, 'Save failed');
        });
    }
    function showStatus(scopeName, msg) {
        if (scopeName === 'modal') {
            var footer = document.querySelector('#customize-overlay .customize-modal-footer');
            if (footer) {
                var span = footer.querySelector('.customize-save-status');
                if (!span) {
                    span = document.createElement('span');
                    span.className = 'customize-save-status';
                    footer.insertBefore(span, footer.firstChild);
                }
                span.textContent = msg;
                setTimeout(function() { if (span) span.textContent = ''; }, 2000);
            }
        } else {
            // Settings scope: show a temporary status next to the Save button
            var saveBtn = document.querySelector('[data-action="save-customize"][data-scope="' + scopeName + '"]');
            if (saveBtn && saveBtn.parentElement) {
                var span2 = saveBtn.parentElement.querySelector('.customize-save-status');
                if (!span2) {
                    span2 = document.createElement('span');
                    span2.className = 'customize-save-status';
                    saveBtn.parentElement.insertBefore(span2, saveBtn);
                }
                span2.textContent = msg;
                setTimeout(function() { if (span2) span2.textContent = ''; }, 2000);
            }
        }
    }

    // ---------- Delegated listeners ----------
    document.addEventListener('click', function(e) {
        var el = e.target.closest ? e.target.closest('[data-action]') : _findActionCompat(e.target);
        if (!el || !el.dataset) return;
        var action = el.dataset.action;
        var scope = el.dataset.scope;
        switch (action) {
            case 'open-customize': openModal(); break;
            case 'close-customize-modal': closeModal(); break;
            case 'customize-tab':
                if (scope) switchTab(scope, el.dataset.tab);
                break;
            case 'customize-color-theme':
                if (scope) switchColorTheme(scope, el.dataset.theme);
                break;
            case 'reset-color':
                if (scope) resetColor(scope, el.dataset.colorVar);
                break;
            case 'reset-all-colors':
                if (scope) resetAllColors(scope);
                break;
            case 'apply-custom-css': {
                if (!scope) break;
                var cssEl = document.getElementById('cust-css-input-' + scope);
                if (cssEl) {
                    getScope(scope).css = cssEl.value;
                    applyCssLive(scope);
                }
                break;
            }
            case 'ai-generate-css':
                if (scope) aiGenerate(scope);
                break;
            case 'copy-ai-css':
                if (scope) copyAiCss(scope);
                break;
            case 'apply-ai-css':
                if (scope) applyAiCss(scope);
                break;
            case 'save-customize':
                if (scope) handleSave(scope);
                break;
        }
    });

    // Live input/change for color + font fields (scoped by data-customize-scope)
    document.addEventListener('input', function(e) {
        var el = e.target;
        if (!el.dataset) return;
        var scope = _scopeOf(el);
        if (!scope) return;
        // Color inputs (type=color)
        if (el.type === 'color' && el.dataset.colorVar) {
            var st = getScope(scope);
            var mode = st.activeColorTheme;
            if (!st.colors[mode]) st.colors[mode] = {};
            st.colors[mode][el.dataset.colorVar] = el.value;
            applyColorsLive(scope);
            return;
        }
        // Color text inputs (rgba vars)
        if (el.classList && el.classList.contains('color-text-input') && el.dataset.colorVar) {
            var st2 = getScope(scope);
            var mode2 = st2.activeColorTheme;
            if (!st2.colors[mode2]) st2.colors[mode2] = {};
            var v = el.value.trim();
            if (v) st2.colors[mode2][el.dataset.colorVar] = v;
            else delete st2.colors[mode2][el.dataset.colorVar];
            applyColorsLive(scope);
            return;
        }
        // Custom CSS textarea (debounced)
        if (el.id === 'cust-css-input-' + scope) {
            clearTimeout(el._debounce);
            el._debounce = setTimeout(function() {
                getScope(scope).css = el.value;
                applyCssLive(scope);
            }, 300);
            return;
        }
        // Font family
        if (el.id === 'cust-font-family-' + scope) {
            getScope(scope).font = el.value;
            applyFontLive(scope);
            return;
        }
    });
    document.addEventListener('change', function(e) {
        var el = e.target;
        if (!el.dataset) return;
        var scope = _scopeOf(el);
        if (!scope) return;
        if (el.id === 'cust-font-size-' + scope) {
            var v = parseInt(el.value, 10);
            if (v >= 8 && v <= 40) {
                getScope(scope).fontSize = v;
                applyFontLive(scope);
            }
        }
    });

    function _scopeOf(el) {
        var wrap = el.closest ? el.closest('[data-customize-scope]') : null;
        return wrap ? wrap.dataset.customizeScope : null;
    }
    function _findActionCompat(el) {
        while (el && el !== document.body) {
            if (el.dataset && el.dataset.action) return el;
            el = el.parentElement;
        }
        return null;
    }

    // Esc to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var o = document.getElementById('customize-overlay');
            if (o && o.classList.contains('visible')) { e.preventDefault(); closeModal(); }
        }
    });

    // ---------- Init ----------
    // On the settings page there's no modal; the "settings" scope is always
    // present in the DOM (inside the Customize tab). Initialize it.
    if (document.querySelector('[data-customize-scope="settings"]')) {
        initScope('settings');
        populateFields('settings');
    }
})();