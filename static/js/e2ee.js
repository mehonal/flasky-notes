/**
 * Flasky Notes — E2EE Application Wrapper
 *
 * Higher-level API used by themes. Depends on crypto.js (FlaskyCrypto).
 * Checks body[data-encrypted], manages key loading, provides encrypt/decrypt helpers.
 */
(function () {
    'use strict';

    var _symKey = null;
    var _ready = false;
    var _encrypted = false;

    /**
     * Initialize E2EE. Call on page load.
     * Checks if encryption is enabled, loads key from sessionStorage.
     * Redirects to /unlock if key is missing.
     */
    async function init() {
        // Latch the encrypted state on first init (before revealContent removes the attribute)
        var body = document.body;
        if (body && body.getAttribute('data-encrypted') === 'true') {
            _encrypted = true;
        }
        if (!isEncrypted()) {
            _ready = true;
            return true;
        }
        _symKey = await FlaskyCrypto.loadSymmetricKey();
        if (!_symKey) {
            // Redirect to unlock page (save current URL for redirect back)
            var returnUrl = window.location.pathname + window.location.search;
            window.location.href = '/unlock?next=' + encodeURIComponent(returnUrl);
            return false;
        }
        _ready = true;
        return true;
    }

    /**
     * Check if the current user has encryption enabled.
     */
    function isEncrypted() {
        if (_encrypted) return true;
        var body = document.body;
        return body && body.getAttribute('data-encrypted') === 'true';
    }

    /**
     * Returns true once init() has completed successfully.
     */
    function isReady() {
        return _ready;
    }

    /**
     * Get the loaded symmetric key (null if not loaded).
     */
    function getKey() {
        return _symKey;
    }

    /**
     * Encrypt a plaintext field. No-op if encryption is not enabled.
     */
    async function encryptField(plaintext) {
        if (!isEncrypted() || !_symKey) return plaintext;
        if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
        return FlaskyCrypto.encrypt(plaintext, _symKey);
    }

    /**
     * Decrypt a ciphertext field. No-op if encryption is not enabled.
     */
    async function decryptField(ciphertext) {
        if (!isEncrypted() || !_symKey) return ciphertext;
        if (!ciphertext || ciphertext === '') return ciphertext;
        // Quick check: encrypted data starts with base64 of version byte
        try {
            return await FlaskyCrypto.decrypt(ciphertext, _symKey);
        } catch (e) {
            console.warn('E2EE decrypt failed, returning raw value:', e);
            return ciphertext;
        }
    }

    /**
     * Batch decrypt an array of objects on specified field names.
     * Modifies objects in place and returns the array.
     */
    async function decryptObjects(arr, fieldNames) {
        if (!isEncrypted() || !_symKey || !arr) return arr;
        var promises = [];
        for (var i = 0; i < arr.length; i++) {
            for (var j = 0; j < fieldNames.length; j++) {
                (function (obj, field) {
                    if (obj[field]) {
                        promises.push(
                            FlaskyCrypto.decrypt(obj[field], _symKey)
                                .then(function (val) { obj[field] = val; })
                                .catch(function () { /* keep original */ })
                        );
                    }
                })(arr[i], fieldNames[j]);
            }
        }
        await Promise.all(promises);
        return arr;
    }

    /**
     * Encrypt a blob (ArrayBuffer) for attachment upload.
     */
    async function encryptBlobData(arrayBuffer) {
        if (!isEncrypted() || !_symKey) return new Uint8Array(arrayBuffer);
        return FlaskyCrypto.encryptBlob(arrayBuffer, _symKey);
    }

    /**
     * Decrypt a blob (Uint8Array or ArrayBuffer) for attachment display.
     */
    async function decryptBlobData(encryptedData) {
        if (!isEncrypted() || !_symKey) return encryptedData;
        return FlaskyCrypto.decryptBlob(encryptedData, _symKey);
    }

    /**
     * Decrypt encrypted note data embedded in the page and populate DOM elements.
     * Used by themes on page load.
     */
    async function decryptPageData() {
        if (!isEncrypted() || !_symKey) return;
        var dataEl = document.getElementById('encrypted-note-data');
        if (!dataEl) return;
        try {
            var encData = JSON.parse(dataEl.textContent);
            var results = {};
            if (encData.title) {
                results.title = await decryptField(encData.title);
            }
            if (encData.content) {
                results.content = await decryptField(encData.content);
            }
            if (encData.properties) {
                results.properties = await decryptField(encData.properties);
            }
            if (encData.previous_content) {
                results.previous_content = await decryptField(encData.previous_content);
            }
            return results;
        } catch (e) {
            console.error('E2EE: failed to decrypt page data:', e);
            return null;
        }
    }

    /**
     * Reveal content that was hidden with CSS visibility:hidden.
     */
    function revealContent() {
        document.body.removeAttribute('data-encrypted');
    }

    // ======== Public API ========

    window.FlaskyE2EE = {
        init: init,
        isEncrypted: isEncrypted,
        isReady: isReady,
        getKey: getKey,
        encryptField: encryptField,
        decryptField: decryptField,
        decryptObjects: decryptObjects,
        encryptBlob: encryptBlobData,
        decryptBlob: decryptBlobData,
        decryptPageData: decryptPageData,
        revealContent: revealContent
    };
})();
