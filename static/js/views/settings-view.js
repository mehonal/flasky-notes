/**
 * Flasky Notes — Settings view module.
 *
 * Forms tagged [data-spa-form] are intercepted on submit. The form is POSTed
 * to /settings?_fragment=1; the server processes it and returns a freshly-
 * rendered _settings_view.html fragment, which is swapped back into the
 * container. The server's existing form handler is reused unchanged — no
 * new JSON endpoints needed.
 */
(function () {
    'use strict';

    var _root = null;
    var _bound = [];
    var _docBound = [];

    function bind(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); _bound.push([el, ev, fn]); }
    function bindDoc(el, ev, fn) { el.addEventListener(ev, fn); _docBound.push([el, ev, fn]); }
    function unbindAll() {
        _bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        _docBound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        _bound = []; _docBound = [];
    }

    function init(container) {
        _root = container.querySelector('#settings-root');
        if (!_root) return;

        function getCSRFToken() {
            var cookie = document.cookie.split('; ').find(function (c) { return c.startsWith('X-CSRF-Token='); });
            return cookie ? cookie.split('=')[1] : '';
        }

        function showToast(message, type) {
            type = type || 'success';
            var c = document.getElementById('toast-container');
            if (!c) return;
            var toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerText = message;
            c.appendChild(toast);
            setTimeout(function () { if (toast.parentElement) toast.remove(); }, 3000);
        }

        // ============ Form submit interception ============
        function swapFragment(html) {
            container.innerHTML = html;
            var newRoot = container.querySelector('#settings-root');
            if (newRoot) newRoot.setAttribute('data-spa-reloaded', '');
            unbindAll();
            init(container);
        }

        async function submitForm(form, submitter) {
            var requiresRefresh = form.hasAttribute('data-requires-refresh');
            var formData = new FormData(form);
            formData.set('_fragment', '1');
            if (submitter && submitter.name) formData.set(submitter.name, submitter.value);
            try {
                var resp = await fetch('/settings?_fragment=1', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCSRFToken() },
                    body: formData,
                    credentials: 'same-origin',
                });
                if (!resp.ok) { showToast('Failed to save settings.', 'danger'); return; }
                if (requiresRefresh) {
                    showToast('Settings saved. Reloading…');
                    window.location.reload();
                    return;
                }
                var html = await resp.text();
                if (html && html.indexOf('settings-root') !== -1) {
                    swapFragment(html);
                    showToast('Settings saved.');
                } else {
                    showToast('Settings saved.');
                }
            } catch (e) {
                showToast('Network error: ' + e.message, 'danger');
            }
        }

        _root.querySelectorAll('form[data-spa-form]').forEach(function (form) {
            bind(form, 'submit', function (e) {
                e.preventDefault();
                submitForm(form, e.submitter);
            });
        });

        // Auto-submit checkboxes (AI toggle, sync toggle)
        _root.querySelectorAll('[data-spa-auto-submit]').forEach(function (input) {
            bind(input, 'change', function () {
                var form = input.closest('form');
                if (form) submitForm(form);
            });
        });

        // ============ Sidebar ============
        function toggleSidebar() {
            var sidebar = document.getElementById('sidebar');
            var backdrop = document.getElementById('sidebar-backdrop');
            sidebar.classList.toggle('collapsed');
            if (window.innerWidth <= 768) backdrop.classList.toggle('visible');
        }
        if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('collapsed');

        // ============ Settings tabs ============
        var settingsTabs = _root.querySelectorAll('[data-action="settings-tab"]');
        var settingsPanels = _root.querySelectorAll('.settings-grid .panel[data-tab]');

        function activateTab(tab) {
            if (!tab) return;
            var name = tab.dataset.tab;
            settingsTabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
            settingsPanels.forEach(function (p) {
                if (p.dataset.tab === name) p.removeAttribute('hidden');
                else p.setAttribute('hidden', '');
            });
            try { localStorage.setItem('flasky-settings-tab', name); } catch (e) {}
            var area = _root.querySelector('.content-area');
            if (area) area.scrollTop = 0;
            if (window.innerWidth <= 768) {
                var sb = document.getElementById('sidebar');
                var bd = document.getElementById('sidebar-backdrop');
                if (sb) sb.classList.add('collapsed');
                if (bd) bd.classList.remove('visible');
            }
        }
        settingsTabs.forEach(function (tab) { bind(tab, 'click', function () { activateTab(tab); }); });

        var savedTab = null;
        try { savedTab = localStorage.getItem('flasky-settings-tab'); } catch (e) {}
        if (savedTab) {
            var match = _root.querySelector('[data-action="settings-tab"][data-tab="' + savedTab + '"]');
            if (match) activateTab(match);
        }

        // ============ Theme ============
        function toggleTheme() {
            var html = document.documentElement;
            var isDark = html.getAttribute('data-theme') === 'dark';
            html.setAttribute('data-theme', isDark ? 'light' : 'dark');
            var label = document.getElementById('theme-label');
            if (label) label.innerText = isDark ? 'Light' : 'Dark';
            fetch('/api/save_dark_mode/' + (isDark ? '0' : '1'));
        }

        // ============ Toggle switches ============
        function syncToggle(el) {
            var input = el.querySelector('input');
            if (!input) return;
            el.classList.toggle('on', input.checked);
        }
        _root.querySelectorAll('.toggle[data-toggle]').forEach(function (el) {
            syncToggle(el);
            bind(el, 'click', function (e) {
                var input = el.querySelector('input');
                if (!input) return;
                if (e.target === input) return;
                e.preventDefault();
                input.checked = !input.checked;
                syncToggle(el);
                if (input.hasAttribute('data-spa-auto-submit')) {
                    var form = input.closest('form');
                    if (form) submitForm(form);
                }
            });
        });

        // ============ Token copy ============
        var tokenInput = document.getElementById('new-token-input');
        if (tokenInput) bind(tokenInput, 'click', function () { this.select(); });

        // ============ Event delegation ============
        bindDoc(document, 'click', function (e) {
            var el = e.target.closest('[data-action]');
            if (!el) return;
            var action = el.dataset.action;
            switch (action) {
                case 'router-back': history.back(); break;
                case 'toggle-sidebar': toggleSidebar(); break;
                case 'toggle-theme': toggleTheme(); break;
                case 'copy-token':
                    if (tokenInput) {
                        tokenInput.select();
                        document.execCommand('copy');
                        showToast('Token copied to clipboard.');
                    }
                    break;
            }
        });

        // ============ Change password / recovery key ============
        var settingsDataEl = document.getElementById('settings-encryption-data');
        var settingsData = settingsDataEl ? JSON.parse(settingsDataEl.textContent) : null;
        var changePwBtn = document.getElementById('change-pw-btn');
        var regenBtn = document.getElementById('regen-recovery-btn');

        function escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }

        async function changeEncryptionPassword() {
            var statusEl = document.getElementById('change-pw-status');
            var currentPw = document.getElementById('current-password').value;
            var newPw = document.getElementById('new-password').value;
            var confirmPw = document.getElementById('confirm-password').value;
            if (!currentPw || !newPw || !confirmPw) { statusEl.innerHTML = '<span style="color:var(--red)">All fields are required.</span>'; return; }
            if (newPw !== confirmPw) { statusEl.innerHTML = '<span style="color:var(--red)">New passwords do not match.</span>'; return; }
            if (newPw.length < 8) { statusEl.innerHTML = '<span style="color:var(--red)">Password must be at least 8 characters.</span>'; return; }
            statusEl.innerHTML = '<span style="color:var(--text-muted)">Deriving keys...</span>';
            try {
                var oldSalt = await FlaskyCrypto.fetchSalt(settingsData.username);
                var oldKeys = await FlaskyCrypto.deriveKeys(currentPw, oldSalt);
                var symKey;
                try { symKey = await FlaskyCrypto.unwrapSymmetricKey(settingsData.encryptedSymKey, oldKeys.kek); }
                catch (e) { statusEl.innerHTML = '<span style="color:var(--red)">Current password is incorrect.</span>'; return; }
                statusEl.innerHTML = '<span style="color:var(--text-muted)">Encrypting with new password...</span>';
                var newKeySalt = FlaskyCrypto.generateSalt();
                var newKeys = await FlaskyCrypto.deriveKeys(newPw, newKeySalt);
                var newWrappedKey = await FlaskyCrypto.wrapSymmetricKey(symKey, newKeys.kek);
                var resp = await fetch('/api/auth/change_password', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_auth_key: newKeys.authKeyHex, new_encrypted_sym_key: newWrappedKey, new_key_salt: newKeySalt })
                });
                var data = await resp.json();
                if (data.success) {
                    await FlaskyCrypto.storeSymmetricKey(symKey);
                    statusEl.innerHTML = '<span style="color:var(--green)">Password changed successfully.</span>';
                    document.getElementById('current-password').value = '';
                    document.getElementById('new-password').value = '';
                    document.getElementById('confirm-password').value = '';
                } else {
                    statusEl.innerHTML = '<span style="color:var(--red)">Error: ' + escapeHtml(data.reason || 'Unknown error') + '</span>';
                }
            } catch (e) {
                statusEl.innerHTML = '<span style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</span>';
            }
        }

        async function regenerateRecoveryKey() {
            try {
                var symKey = await FlaskyCrypto.loadSymmetricKey();
                if (!symKey) { showToast('Encryption key not loaded. Please unlock first.', 'danger'); return; }
                var recovery = await FlaskyCrypto.generateRecoveryKey();
                var wrappedKey = await FlaskyCrypto.wrapSymmetricKey(symKey, recovery.cryptoKey);
                var recoveryHash = await FlaskyCrypto.recoveryKeyHash(recovery.keyBytes);
                var resp = await fetch('/api/auth/update_recovery_key', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recovery_encrypted_key: wrappedKey, recovery_key_hash: recoveryHash })
                });
                var data = await resp.json();
                if (data.success) {
                    document.getElementById('new-recovery-key').textContent = recovery.displayString;
                    document.getElementById('recovery-key-display').style.display = '';
                } else { showToast('Error: ' + (data.reason || 'Unknown error'), 'danger'); }
            } catch (e) { showToast('Error: ' + e.message, 'danger'); }
        }

        if (changePwBtn) bind(changePwBtn, 'click', changeEncryptionPassword);
        if (regenBtn) bind(regenBtn, 'click', regenerateRecoveryKey);

        // ============ Daily notes dropdowns + preview ============
        var tzForPreview = (typeof window._pageData !== 'undefined' && window._pageData.timezone) ? window._pageData.timezone : null;

        function formatDailyTitle(fmt, date) {
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            return String(fmt || '')
                .replace(/YYYY/g, date.getFullYear())
                .replace(/MM/g, pad(date.getMonth() + 1))
                .replace(/DD/g, pad(date.getDate()))
                .replace(/HH/g, pad(date.getHours()))
                .replace(/mm/g, pad(date.getMinutes()));
        }

        function updateDailyPreview() {
            var fmtInput = document.getElementById('daily-note-title-format');
            if (!fmtInput) return;
            var fmt = fmtInput.value || 'YYYY-MM-DD';
            var now = new Date();
            if (tzForPreview && typeof Intl !== 'undefined') {
                try {
                    var parts = new Intl.DateTimeFormat('en-US', { timeZone: tzForPreview, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
                    var map = {}; parts.forEach(function (p) { map[p.type] = p.value; });
                    if (map.hour === '24') map.hour = '00';
                    now = new Date(map.year, map.month - 1, map.day, map.hour, map.minute);
                } catch (e) {}
            }
            var prev = document.getElementById('daily-note-preview');
            if (prev) prev.textContent = formatDailyTitle(fmt, now);
        }
        var fmtInputEl = document.getElementById('daily-note-title-format');
        if (fmtInputEl) bind(fmtInputEl, 'input', updateDailyPreview);
        updateDailyPreview();

        async function populateDailyTemplateSelect() {
            var sel = document.getElementById('daily-note-template-id');
            if (!sel) return;
            var selectedId = parseInt(sel.dataset.selected || '0', 10) || 0;
            try {
                var resp = await fetch('/api/templates');
                var list = await resp.json();
                if (!Array.isArray(list)) list = [];
                for (var i = 0; i < list.length; i++) {
                    var t = list[i]; var name = t.name || '';
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted && FlaskyE2EE.isEncrypted() && name) {
                        try { name = await FlaskyE2EE.decryptField(name); } catch (e) {}
                    }
                    var opt = document.createElement('option');
                    opt.value = t.id; opt.textContent = name || ('Template #' + t.id);
                    if (t.id === selectedId) opt.selected = true;
                    sel.appendChild(opt);
                }
            } catch (e) {}
        }

        async function populateDailyCategorySelect() {
            var sel = document.getElementById('daily-note-category-id');
            if (!sel) return;
            var selectedId = parseInt(sel.dataset.selected || '0', 10) || 0;
            try {
                var resp = await fetch('/api/sidebar_tree_data');
                var data = await resp.json();
                if (!data || !data.success) return;
                var cats = data.categories || [];
                for (var i = 0; i < cats.length; i++) {
                    var c = cats[i]; var label = c.name || '';
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted && FlaskyE2EE.isEncrypted() && c.name) {
                        try { label = await FlaskyE2EE.decryptField(c.name); } catch (e) {}
                    }
                    var opt = document.createElement('option');
                    opt.value = c.id; opt.textContent = label;
                    if (c.id === selectedId) opt.selected = true;
                    sel.appendChild(opt);
                }
            } catch (e) {}
        }

        async function populateDefaultCategorySelect() {
            var sel = document.getElementById('default-category-id');
            if (!sel) return;
            var selectedId = parseInt(sel.dataset.selected || '0', 10) || 0;
            try {
                var resp = await fetch('/api/sidebar_tree_data');
                var data = await resp.json();
                if (!data || !data.success) return;
                var cats = data.categories || [];
                for (var i = 0; i < cats.length; i++) {
                    var c = cats[i]; var label = c.name || '';
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted && FlaskyE2EE.isEncrypted() && c.name) {
                        try { label = await FlaskyE2EE.decryptField(c.name); } catch (e) {}
                    }
                    var opt = document.createElement('option');
                    opt.value = c.id; opt.textContent = label;
                    if (c.id === selectedId || (!selectedId && sel.options.length === 0)) opt.selected = true;
                    sel.appendChild(opt);
                }
            } catch (e) {}
        }

        function whenE2EEReady(cb) {
            if (typeof FlaskyE2EE === 'undefined' || typeof FlaskyE2EE.init !== 'function') { cb(); return; }
            if (FlaskyE2EE.isReady && FlaskyE2EE.isReady()) { cb(); return; }
            FlaskyE2EE.init().then(function () { cb(); }).catch(function () { cb(); });
        }
        whenE2EEReady(function () {
            populateDailyTemplateSelect();
            populateDailyCategorySelect();
            populateDefaultCategorySelect();
        });

        // Customize tab is handled by customize.js (document-level delegation
        // that persists across fragment swaps). Re-trigger populate so the
        // preset grid and color grid render after the fragment is injected.
        if (window.FlaskyCustomize && window.FlaskyCustomize.refreshSettings) {
            window.FlaskyCustomize.refreshSettings();
        }
    }

    function destroy() {
        unbindAll();
        _root = null;
    }

    window.FlaskyViews = window.FlaskyViews || {};
    window.FlaskyViews.settings = { init: init, destroy: destroy };
})();