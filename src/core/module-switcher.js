/**
 * src/core/module-switcher.js
 * Přepínač modulů v sidebaru + zobrazení správného dashboardu.
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function overrideDisplay(el, value) {
        if (!el) return;
        try {
            if (!el.hasAttribute('data-omni-prev-display')) {
                el.setAttribute('data-omni-prev-display', el.style.display || '');
            }
            el.style.display = value;
        } catch (e) {}
    }

    function clearDisplayOverride(el) {
        if (!el) return;
        try {
            if (!el.hasAttribute('data-omni-prev-display')) return;
            el.style.display = el.getAttribute('data-omni-prev-display') || '';
            el.removeAttribute('data-omni-prev-display');
        } catch (e) {}
    }

    function getActive() {
        try {
            return window.OMNI_AppState && typeof window.OMNI_AppState.getActiveModule === 'function'
                ? window.OMNI_AppState.getActiveModule()
                : 'library';
        } catch (e) {
            return 'library';
        }
    }

    function setActive(mod) {
        try {
            if (window.OMNI_AppState && typeof window.OMNI_AppState.setActiveModule === 'function') {
                window.OMNI_AppState.setActiveModule(mod);
            }
        } catch (e) {}
    }

    function applyUi(mod) {
        var active = (mod === 'vitus') ? 'vitus' : 'library';
        try {
            document.body.classList.toggle('module-vitus', active === 'vitus');
            document.body.classList.toggle('module-library', active === 'library');
        } catch (e0) {}

        // Knihovna – hlavní sekce (bezpečné skrývání, aby Vitus byl izolovaný)
        var overdueBanner = $('overdueBanner');
        if (active === 'vitus') overrideDisplay(overdueBanner, 'none');
        else clearDisplayOverride(overdueBanner);

        var menuLib = $('sidebarMenuLibrary');
        var menuVitus = $('sidebarMenuVitus');
        if (menuLib) menuLib.hidden = (active !== 'library');
        if (menuVitus) menuVitus.hidden = (active !== 'vitus');

        var stats = $('sidebarStats');
        if (active === 'vitus') overrideDisplay(stats, 'none');
        else clearDisplayOverride(stats);

        var topBar = $('topBar');
        if (active === 'vitus') overrideDisplay(topBar, 'none');
        else clearDisplayOverride(topBar);

        var libraryModules = $('libraryModulesWrap');
        if (active === 'vitus') overrideDisplay(libraryModules, 'none');
        else clearDisplayOverride(libraryModules);

        var readingWrap = $('readingViewWrap');
        if (active === 'vitus') overrideDisplay(readingWrap, 'none');
        else clearDisplayOverride(readingWrap);

        var scanHistory = $('scanHistorySection');
        if (active === 'vitus') overrideDisplay(scanHistory, 'none');
        else clearDisplayOverride(scanHistory);

        var friendsReco = $('friendsRecommendationsSection');
        if (active === 'vitus') overrideDisplay(friendsReco, 'none');
        else clearDisplayOverride(friendsReco);

        var statsSection = $('statisticsSection');
        if (statsSection) statsSection.style.display = 'none';
        try { document.body.classList.remove('module-statistics'); } catch (e1) {}

        var vitusSection = $('vitusSection');
        if (active === 'vitus') overrideDisplay(vitusSection, '');
        else clearDisplayOverride(vitusSection);

        document.querySelectorAll('[data-omni-module]').forEach(function (btn) {
            var m = String(btn.getAttribute('data-omni-module') || '');
            var isActive = (m === active);
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function init() {
        applyUi(getActive());

        document.querySelectorAll('[data-omni-module]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                if (btn.disabled) return;
                var mod = btn.getAttribute('data-omni-module');
                if (!mod) return;
                if (btn.tagName === 'A' && btn.getAttribute('href')) return;
                e.preventDefault();
                setActive(mod);
                applyUi(getActive());
            });
        });

        document.addEventListener('omni:module-changed', function (e) {
            applyUi((e && e.detail && e.detail.next) ? e.detail.next : getActive());
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

