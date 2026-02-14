/**
 * login-form.js – univerzální vstupní logika pro OmniShelf a budoucí sekce (Workshop, Wardrobe).
 * Centrální bod přihlášení: věk → app.html?mode=kids nebo app.html.
 */
(function () {
    'use strict';

    var DESTINATION_FULL = 'app.html';
    var DESTINATION_KIDS = 'app.html?mode=kids';
    var AGE_KIDS_LIMIT = 14;

    function getFormElements() {
        return {
            form: document.getElementById('authForm'),
            ageInput: document.getElementById('authAge'),
            familyCodeInput: document.getElementById('authFamilyCode'),
            errorEl: document.getElementById('authError'),
            submitBtn: document.getElementById('authSubmit'),
            googleBtn: document.getElementById('authGoogle')
        };
    }

    function showError(el, msg) {
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('visible', !!msg);
    }

    /**
     * Určí cílovou URL podle věku.
     * @param {number} age
     * @returns {string} URL pro přesměrování
     */
    function getRedirectUrl(age) {
        return age < AGE_KIDS_LIMIT ? DESTINATION_KIDS : DESTINATION_FULL;
    }

    /**
     * Provede přesměrování a volitelně uloží režim do localStorage.
     */
    function redirect(age, familyCode) {
        var isKids = age < AGE_KIDS_LIMIT;
        var url = getRedirectUrl(age);
        try {
            var params = new URLSearchParams(window.location.search || '');
            var next = params.get('next');
            // Přesměrování z guardu (app.html) – zachovej cíl (např. app.html?mode=kids)
            if (next && typeof next === 'string') {
                var n = next.trim();
                // jednoduchá ochrana proti otevřenému redirectu
                if (n && n.indexOf('://') === -1 && n.indexOf('\\') === -1 && (n.indexOf('app.html') === 0 || n.indexOf('app.html?') === 0 || n.indexOf('app.html#') === 0)) {
                    url = n;
                }
            }
        } catch (e0) {}
        try {
            localStorage.setItem('omniAuthMode', isKids ? 'kids' : 'full');
            if (familyCode && (familyCode + '').trim()) {
                localStorage.setItem('omniFamilyCode', (familyCode + '').trim());
            }
        } catch (e) {}
        try {
            // "Soft login" (demo): označ uživatele jako přihlášeného pro guard v app.html
            if (window.OMNI_UserState && typeof window.OMNI_UserState.setLoggedIn === 'function') {
                window.OMNI_UserState.setLoggedIn(true);
            }
            if (familyCode && (familyCode + '').trim() && window.OMNI_UserState && typeof window.OMNI_UserState.joinFamilyByCode === 'function') {
                window.OMNI_UserState.joinFamilyByCode((familyCode + '').trim());
            }
        } catch (e2) {}
        window.location.href = url;
    }

    function init() {
        var el = getFormElements();
        if (!el.form || !el.ageInput) return;

        var showFamilyBtn = document.getElementById('authShowFamilyCode');
        var familyWrap = document.getElementById('authFamilyCodeWrap');
        if (showFamilyBtn && familyWrap) {
            showFamilyBtn.addEventListener('click', function () {
                familyWrap.classList.toggle('visible');
            });
        }

        el.form.addEventListener('submit', function (e) {
            e.preventDefault();
            showError(el.errorEl, '');
            var ageVal = parseInt(el.ageInput.value, 10);
            var familyCode = (el.familyCodeInput && el.familyCodeInput.value) ? el.familyCodeInput.value.trim() : '';
            if (isNaN(ageVal) || ageVal < 1 || ageVal > 120) {
                showError(el.errorEl, 'Zadej platný věk (1–120).');
                return;
            }
            redirect(ageVal, familyCode);
        });

        if (el.googleBtn) {
            el.googleBtn.addEventListener('click', function () {
                showError(el.errorEl, 'Přihlášení přes Google připravujeme. Vyplň formulář a klikni na Vstoupit do aplikace.');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.OmniAuth = window.OmniAuth || {};
    window.OmniAuth.getRedirectUrl = getRedirectUrl;
    window.OmniAuth.redirect = redirect;
    window.OmniAuth.AGE_KIDS_LIMIT = AGE_KIDS_LIMIT;
})();
