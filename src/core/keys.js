/**
 * src/core/keys.js
 * Jednotný přístup k API klíčům (Knihovna + Vitus).
 *
 * OpenAI:
 * - localStorage['omnishelf_openai_api_key'] (preferované, nastavitelné v Nastavení)
 * - fallback: window.OMNI_CONFIG.openai (např. z config.local.js)
 */
(function (global) {
    'use strict';

    var OPENAI_LS_KEY = 'omnishelf_openai_api_key';
    var GEMINI_LS_KEY = 'omnishelf_gemini_api_key';

    function safeTrim(s) {
        try { return String(s || '').trim(); } catch (e) { return ''; }
    }

    function getOpenAiKey() {
        var fromLs = '';
        try { fromLs = safeTrim(localStorage.getItem(OPENAI_LS_KEY) || ''); } catch (e0) { fromLs = ''; }
        if (fromLs) return fromLs;
        try { return safeTrim(global.OMNI_CONFIG && global.OMNI_CONFIG.openai); } catch (e1) { return ''; }
    }

    function setOpenAiKey(key) {
        var k = safeTrim(key);
        try {
            if (!k) localStorage.removeItem(OPENAI_LS_KEY);
            else localStorage.setItem(OPENAI_LS_KEY, k);
        } catch (e0) {}
        try { document.dispatchEvent(new CustomEvent('omni:keys-changed', { detail: { openai: !!k } })); } catch (e1) {}
        return true;
    }

    function clearOpenAiKey() {
        return setOpenAiKey('');
    }

    function hasOpenAiKey() {
        return !!getOpenAiKey();
    }

    function getGeminiKey() {
        var fromLs = '';
        try { fromLs = safeTrim(localStorage.getItem(GEMINI_LS_KEY) || ''); } catch (e0) { fromLs = ''; }
        if (fromLs) return fromLs;
        try { return safeTrim(global.OMNI_CONFIG && global.OMNI_CONFIG.gemini); } catch (e1) { return ''; }
    }

    function setGeminiKey(key) {
        var k = safeTrim(key);
        try {
            if (!k) localStorage.removeItem(GEMINI_LS_KEY);
            else localStorage.setItem(GEMINI_LS_KEY, k);
        } catch (e0) {}
        try { document.dispatchEvent(new CustomEvent('omni:keys-changed', { detail: { gemini: !!k } })); } catch (e1) {}
        return true;
    }

    function clearGeminiKey() { return setGeminiKey(''); }
    function hasGeminiKey() { return !!getGeminiKey(); }

    // Optional UI binding (Settings modal)
    function bindSettingsUi() {
        var input = document.getElementById('settingsOpenAiKey');
        var gemInput = document.getElementById('settingsGeminiKey');
        var hint = document.getElementById('settingsOpenAiKeyHint');
        var btnClear = document.getElementById('settingsOpenAiKeyClear');
        var gemHint = document.getElementById('settingsGeminiKeyHint');
        var gemClear = document.getElementById('settingsGeminiKeyClear');

        // Prefill with current value (password input = masked)
        if (input) {
            try { input.value = getOpenAiKey(); } catch (e0) {}
            if (hint) hint.textContent = hasOpenAiKey() ? 'Klíč je nastaven.' : 'Klíč není nastaven.';
        }
        if (gemInput) {
            try { gemInput.value = getGeminiKey(); } catch (e1) {}
            if (gemHint) gemHint.textContent = hasGeminiKey() ? 'Klíč je nastaven.' : 'Klíč není nastaven.';
        }

        function saveNow() {
            if (input) {
                setOpenAiKey(input.value);
                if (hint) hint.textContent = input.value ? 'Uloženo.' : 'Klíč odstraněn.';
            }
        }

        // Ukládej okamžitě – aby to „stihlo“ před klikem na AI scan
        if (input) {
            input.addEventListener('input', saveNow);
            input.addEventListener('blur', function () {
                setOpenAiKey(input.value);
                if (hint) hint.textContent = input.value ? 'Uloženo.' : 'Klíč odstraněn.';
            });
        }
        if (btnClear) {
            btnClear.addEventListener('click', function () {
                if (input) input.value = '';
                clearOpenAiKey();
                if (hint) hint.textContent = 'Klíč odstraněn.';
            });
        }
        if (gemInput) {
            gemInput.addEventListener('input', function () {
                setGeminiKey(gemInput.value);
                if (gemHint) gemHint.textContent = gemInput.value ? 'Uloženo.' : 'Klíč odstraněn.';
            });
            gemInput.addEventListener('blur', function () {
                setGeminiKey(gemInput.value);
                if (gemHint) gemHint.textContent = gemInput.value ? 'Uloženo.' : 'Klíč odstraněn.';
            });
        }
        if (gemClear) {
            gemClear.addEventListener('click', function () {
                if (gemInput) gemInput.value = '';
                clearGeminiKey();
                if (gemHint) gemHint.textContent = 'Klíč odstraněn.';
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSettingsUi);
    else bindSettingsUi();

    global.OMNI_Keys = global.OMNI_Keys || {};
    global.OMNI_Keys.getOpenAiKey = getOpenAiKey;
    global.OMNI_Keys.setOpenAiKey = setOpenAiKey;
    global.OMNI_Keys.clearOpenAiKey = clearOpenAiKey;
    global.OMNI_Keys.hasOpenAiKey = hasOpenAiKey;
    global.OMNI_Keys.getGeminiKey = getGeminiKey;
    global.OMNI_Keys.setGeminiKey = setGeminiKey;
    global.OMNI_Keys.clearGeminiKey = clearGeminiKey;
    global.OMNI_Keys.hasGeminiKey = hasGeminiKey;
})(typeof window !== 'undefined' ? window : this);

