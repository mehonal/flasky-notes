/**
 * CSRF protection — double-submit cookie pattern.
 * Reads the CSRF token from the X-CSRF-Token cookie and injects it
 * as an X-CSRFToken header on all state-changing fetch() requests.
 * Also injects a hidden csrf_token field into all POST forms.
 */
(function() {
    'use strict';

    function getCsrfToken() {
        var match = document.cookie.match(/(^|;\s*)X-CSRF-Token=([^;]+)/);
        return match ? match[2] : '';
    }

    var originalFetch = window.fetch;
    window.fetch = function(url, options) {
        options = options || {};
        var method = (options.method || 'GET').toUpperCase();
        if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
            if (!options.headers) options.headers = {};
            if (options.headers instanceof Headers) {
                if (!options.headers.has('X-CSRFToken')) {
                    options.headers.set('X-CSRFToken', getCsrfToken());
                }
            } else {
                if (!options.headers['X-CSRFToken']) {
                    options.headers['X-CSRFToken'] = getCsrfToken();
                }
            }
        }
        return originalFetch.apply(this, arguments);
    };

    // Inject hidden csrf_token field into all POST forms
    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('form[method="POST"], form[method="post"]').forEach(function(form) {
            if (form.querySelector('input[name="csrf_token"]')) return;
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'csrf_token';
            input.value = getCsrfToken();
            form.appendChild(input);
        });
    });
})();
