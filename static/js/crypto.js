/**
 * Flasky Notes — E2EE Crypto Module (Web Crypto API)
 *
 * Key hierarchy (Bitwarden-inspired, zero external dependencies):
 *   Password → PBKDF2 → Master Key
 *     ├─ HKDF("flasky-auth")       → Auth Key (sent to server as hex)
 *     └─ HKDF("flasky-encryption") → KEK (wraps/unwraps symmetric key)
 *
 * All user data is encrypted with a random 256-bit Symmetric Key.
 * The Symmetric Key is wrapped (AES-GCM) with the KEK.
 *
 * Ciphertext format: base64( 0x01 || IV[12] || ciphertext || GCM-tag[16] )
 */
(function () {
    'use strict';

    var PBKDF2_ITERATIONS = 600000;
    var VERSION_BYTE = 0x01;

    // ======== Utility helpers ========

    function bufToHex(buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
            return b.toString(16).padStart(2, '0');
        }).join('');
    }

    function hexToBuf(hex) {
        var bytes = new Uint8Array(hex.length / 2);
        for (var i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }

    function bufToBase64(buf) {
        var bytes = new Uint8Array(buf);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToBuf(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function strToUtf8(str) {
        return new TextEncoder().encode(str);
    }

    function utf8ToStr(buf) {
        return new TextDecoder().decode(buf);
    }

    // ======== Key Derivation ========

    /**
     * Generate a random 32-byte salt as hex string (for new registrations).
     */
    function generateSalt() {
        var buf = crypto.getRandomValues(new Uint8Array(32));
        return bufToHex(buf);
    }

    /**
     * Fetch the PBKDF2 salt for a username from the server.
     */
    async function fetchSalt(username) {
        var resp = await fetch('/api/auth/salt?username=' + encodeURIComponent(username));
        var data = await resp.json();
        return data.key_salt || null;
    }

    /**
     * Derive Auth Key and KEK from password + salt.
     * @param {string} password
     * @param {string} saltHex - hex-encoded 32-byte salt (from server or generateSalt)
     * Returns { authKeyHex: string, kek: CryptoKey }
     */
    async function deriveKeys(password, saltHex) {
        var salt = saltHex ? hexToBuf(saltHex) : strToUtf8('');
        salt = new Uint8Array(salt);

        // Import password as raw key material for PBKDF2
        var passwordKey = await crypto.subtle.importKey(
            'raw', strToUtf8(password), 'PBKDF2', false, ['deriveBits']
        );

        // PBKDF2 → Master Key (256 bits)
        var masterBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            passwordKey, 256
        );

        // Import master key for HKDF
        var masterKey = await crypto.subtle.importKey(
            'raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']
        );

        // HKDF → Auth Key (256 bits, sent as hex to server)
        var authBits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: strToUtf8('flasky-auth') },
            masterKey, 256
        );
        var authKeyHex = bufToHex(authBits);

        // HKDF → KEK (AES-GCM key for wrapping symmetric key)
        var kek = await crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: strToUtf8('flasky-encryption') },
            masterKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
        );

        return { authKeyHex: authKeyHex, kek: kek };
    }

    // ======== Symmetric Key Management ========

    /**
     * Generate a random 256-bit AES-GCM key.
     */
    async function generateSymmetricKey() {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true, // extractable so we can wrap it
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Wrap (encrypt) the symmetric key with KEK using AES-GCM.
     * Returns base64 string: IV[12] || wrapped_key || tag[16]
     */
    async function wrapSymmetricKey(symKey, kek) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var wrapped = await crypto.subtle.wrapKey('raw', symKey, kek, { name: 'AES-GCM', iv: iv });
        // Combine IV + wrapped key bytes
        var combined = new Uint8Array(iv.length + wrapped.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(wrapped), iv.length);
        return bufToBase64(combined.buffer);
    }

    /**
     * Unwrap (decrypt) the symmetric key with KEK.
     * Input: base64 string from wrapSymmetricKey.
     */
    async function unwrapSymmetricKey(wrappedB64, kek) {
        var combined = new Uint8Array(base64ToBuf(wrappedB64));
        var iv = combined.slice(0, 12);
        var wrappedBytes = combined.slice(12);
        return crypto.subtle.unwrapKey(
            'raw', wrappedBytes.buffer, kek,
            { name: 'AES-GCM', iv: iv },
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // ======== Encrypt / Decrypt ========

    /**
     * Encrypt plaintext string → base64 envelope.
     * Format: base64( VERSION_BYTE || IV[12] || ciphertext || GCM-tag[16] )
     */
    async function encrypt(plaintext, symKey) {
        if (plaintext === null || plaintext === undefined) return null;
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var encoded = strToUtf8(plaintext);
        var ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            symKey, encoded
        );
        // VERSION_BYTE + IV + ciphertext (includes GCM tag)
        var result = new Uint8Array(1 + iv.length + ciphertext.byteLength);
        result[0] = VERSION_BYTE;
        result.set(iv, 1);
        result.set(new Uint8Array(ciphertext), 1 + iv.length);
        return bufToBase64(result.buffer);
    }

    /**
     * Decrypt base64 envelope → plaintext string.
     */
    async function decrypt(ciphertextB64, symKey) {
        if (!ciphertextB64) return ciphertextB64;
        var data = new Uint8Array(base64ToBuf(ciphertextB64));
        var version = data[0];
        if (version !== VERSION_BYTE) {
            throw new Error('Unsupported encryption version: ' + version);
        }
        var iv = data.slice(1, 13);
        var ciphertext = data.slice(13);
        var decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            symKey, ciphertext
        );
        return utf8ToStr(decrypted);
    }

    /**
     * Encrypt ArrayBuffer → Uint8Array (for attachments).
     * Same envelope format as text encrypt.
     */
    async function encryptBlob(arrayBuffer, symKey) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            symKey, arrayBuffer
        );
        var result = new Uint8Array(1 + iv.length + ciphertext.byteLength);
        result[0] = VERSION_BYTE;
        result.set(iv, 1);
        result.set(new Uint8Array(ciphertext), 1 + iv.length);
        return result;
    }

    /**
     * Decrypt Uint8Array → ArrayBuffer (for attachments).
     */
    async function decryptBlob(encryptedData, symKey) {
        var data = new Uint8Array(encryptedData);
        var version = data[0];
        if (version !== VERSION_BYTE) {
            throw new Error('Unsupported encryption version: ' + version);
        }
        var iv = data.slice(1, 13);
        var ciphertext = data.slice(13);
        return crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            symKey, ciphertext
        );
    }

    // ======== Recovery Key ========

    /**
     * Generate a recovery key — random 256-bit key, displayed as grouped base64.
     * Returns { keyBytes: Uint8Array, displayString: string, cryptoKey: CryptoKey }
     */
    async function generateRecoveryKey() {
        var keyBytes = crypto.getRandomValues(new Uint8Array(32));
        var b64 = bufToBase64(keyBytes.buffer);
        // Display as groups of 5 chars for readability
        var groups = [];
        for (var i = 0; i < b64.length; i += 5) {
            groups.push(b64.substr(i, 5));
        }
        var displayString = groups.join('-');

        // Import as AES-GCM key for wrapping
        var cryptoKey = await crypto.subtle.importKey(
            'raw', keyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
        );

        return { keyBytes: keyBytes, displayString: displayString, cryptoKey: cryptoKey };
    }

    /**
     * Parse a recovery key display string back to a CryptoKey.
     */
    async function parseRecoveryKey(displayString) {
        var b64 = displayString.replace(/-/g, '');
        var keyBytes = new Uint8Array(base64ToBuf(b64));
        return crypto.subtle.importKey(
            'raw', keyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
        );
    }

    // ======== Session Storage (per-tab symmetric key) ========

    async function storeSymmetricKey(symKey) {
        var raw = await crypto.subtle.exportKey('raw', symKey);
        var b64 = bufToBase64(raw);
        sessionStorage.setItem('flasky_sym_key', b64);
        // Notify other tabs
        try {
            var bc = new BroadcastChannel('flasky-e2ee');
            bc.postMessage({ type: 'key-share', key: b64 });
            bc.close();
        } catch (e) { /* BroadcastChannel not supported */ }
    }

    async function loadSymmetricKey() {
        var b64 = sessionStorage.getItem('flasky_sym_key');
        if (!b64) return null;
        var raw = base64ToBuf(b64);
        return crypto.subtle.importKey(
            'raw', raw,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    function clearSymmetricKey() {
        sessionStorage.removeItem('flasky_sym_key');
    }

    // ======== BroadcastChannel listener for multi-tab key sharing ========

    try {
        var bc = new BroadcastChannel('flasky-e2ee');
        bc.onmessage = function (e) {
            if (e.data && e.data.type === 'key-share' && e.data.key) {
                var existing = sessionStorage.getItem('flasky_sym_key');
                if (!existing) {
                    sessionStorage.setItem('flasky_sym_key', e.data.key);
                    // If we're on the unlock page, redirect
                    if (window.location.pathname === '/unlock') {
                        window.location.href = '/notes';
                    }
                }
            }
        };
    } catch (e) { /* BroadcastChannel not supported */ }

    // ======== Public API ========

    window.FlaskyCrypto = {
        deriveKeys: deriveKeys,
        generateSalt: generateSalt,
        fetchSalt: fetchSalt,
        generateSymmetricKey: generateSymmetricKey,
        wrapSymmetricKey: wrapSymmetricKey,
        unwrapSymmetricKey: unwrapSymmetricKey,
        encrypt: encrypt,
        decrypt: decrypt,
        encryptBlob: encryptBlob,
        decryptBlob: decryptBlob,
        generateRecoveryKey: generateRecoveryKey,
        parseRecoveryKey: parseRecoveryKey,
        storeSymmetricKey: storeSymmetricKey,
        loadSymmetricKey: loadSymmetricKey,
        clearSymmetricKey: clearSymmetricKey,
        bufToHex: bufToHex,
        hexToBuf: hexToBuf,
        bufToBase64: bufToBase64,
        base64ToBuf: base64ToBuf
    };
})();
