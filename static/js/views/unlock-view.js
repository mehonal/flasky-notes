/**
 * Unlock view module — rendered inside the SPA shell when the symmetric
 * key is missing from sessionStorage. Derives keys from the password,
 * unwraps the stored symmetric key, stores it, then closes the overlay
 * and re-initializes E2EE so the editor can decrypt notes.
 */
(function () {
    'use strict';

    var _form = null;
    var _submitHandler = null;

    async function init(container) {
        var root = container.querySelector('#unlock-root');
        if (!root) return;

        var dataEl = root.querySelector('#unlock-data');
        var data = {};
        if (dataEl) {
            try { data = JSON.parse(dataEl.textContent); } catch (e) { /* */ }
        }
        var encSymKey = data.encrypted_sym_key;
        var keySalt = data.key_salt;

        _form = root.querySelector('#unlock-form');
        var errorEl = root.querySelector('#unlock-error');
        var statusEl = root.querySelector('#unlock-status');
        var btn = root.querySelector('#unlock-btn');

        _submitHandler = async function (e) {
            e.preventDefault();
            errorEl.style.display = 'none';
            statusEl.style.display = 'block';
            statusEl.textContent = 'Deriving keys...';
            btn.disabled = true;

            var password = root.querySelector('#unlock-password').value;

            try {
                var keys = await FlaskyCrypto.deriveKeys(password, keySalt);
                statusEl.textContent = 'Unwrapping key...';
                var symKey = await FlaskyCrypto.unwrapSymmetricKey(encSymKey, keys.kek);
                await FlaskyCrypto.storeSymmetricKey(symKey);

                statusEl.textContent = 'Unlocking...';
                _closeAndReinit();
            } catch (err) {
                errorEl.textContent = 'Incorrect password. Please try again.';
                errorEl.style.display = 'block';
                statusEl.style.display = 'none';
                btn.disabled = false;
            }
        };

        _form.addEventListener('submit', _submitHandler);

        var pwInput = root.querySelector('#unlock-password');
        if (pwInput) pwInput.focus();
    }

    function destroy() {
        if (_form && _submitHandler) {
            _form.removeEventListener('submit', _submitHandler);
        }
        _form = null;
        _submitHandler = null;
    }

    function _closeAndReinit() {
        if (window.FlaskyRouter && typeof window.FlaskyRouter.closeOverlay === 'function') {
            window.FlaskyRouter.closeOverlay();
        }
        if (typeof window.afterUnlockReinit === 'function') {
            window.afterUnlockReinit();
        }
    }

    window.FlaskyUnlockView = { init: init, destroy: destroy };
})();