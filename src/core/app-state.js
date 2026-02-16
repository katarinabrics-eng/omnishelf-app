/**
 * src/core/app-state.js
 * Globální stav aplikace – přepínání modulů (Library / Vitus / ...).
 */
(function () {
    'use strict';

    var KEY = 'omnishelf_active_module';
    var active = 'library';

    function safeGet() {
        try { return String(localStorage.getItem(KEY) || '').trim(); } catch (e) { return ''; }
    }
    function safeSet(v) {
        try { localStorage.setItem(KEY, String(v || '')); } catch (e) {}
    }

    function normalizeModule(m) {
        m = String(m || '').trim().toLowerCase();
        if (m === 'vitus') return 'vitus';
        if (m === 'library') return 'library';
        return 'home';
    }

    function load() {
        var hasModuleParam = typeof window !== 'undefined' && window.location && window.location.search && window.location.search.indexOf('module=') >= 0;
        if (!hasModuleParam) {
            active = 'home';
            safeSet(active);
            return active;
        }
        var fromUrl = (typeof window !== 'undefined' && window.__omniOpenModule) ? window.__omniOpenModule : '';
        if (fromUrl && (fromUrl === 'vitus' || fromUrl === 'library')) {
            active = fromUrl;
            safeSet(active);
            return active;
        }
        active = normalizeModule(safeGet() || 'library');
        return active;
    }

    function getActiveModule() {
        return active || load();
    }

    function setActiveModule(next) {
        var prev = getActiveModule();
        var n = normalizeModule(next);
        if (n === prev) return;
        active = n;
        safeSet(active);
        try {
            document.dispatchEvent(new CustomEvent('omni:module-changed', { detail: { prev: prev, next: active } }));
        } catch (e) {}
    }

    // init
    load();

    window.OMNI_AppState = window.OMNI_AppState || {};
    window.OMNI_AppState.getActiveModule = getActiveModule;
    window.OMNI_AppState.setActiveModule = setActiveModule;
})();

