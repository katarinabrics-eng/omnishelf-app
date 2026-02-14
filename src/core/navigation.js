/**
 * Sidebar navigation pro main.html – přepínání active a zobrazení content-for-collection.
 * Odvozeno z index.html (obsluha .sidebar-nav-item a .sidebar-submenu-item).
 */
(function () {
    'use strict';

    var currentModule = 'library';
    var libraryView = 'collection';
    // Default: vše sbalené (podle poznámek UI)
    var libraryAccordionExpanded = false;
    var otherSectorsExpanded = false;
    var activeNavGroup = ''; // 'library' | 'other' | 'childrenLibrary' | 'pracovna' | 'statistics' | ...
    var hasUserNavigated = false;

    var comingSoonPlaceholderModules = (typeof window.OMNI_SECTORS !== 'undefined' && window.OMNI_SECTORS.SIDEBAR_SECTOR_IDS) ? window.OMNI_SECTORS.SIDEBAR_SECTOR_IDS : ['visualMap', 'vinyl', 'warehouse', 'cardindex', 'wardrobe', 'workshop', 'winery', 'pantry'];

    // Po refreshi / přihlášení chceme jasně vidět, že jsme v Moje knihovna (zvýraznění zeleně)
    try {
        var activeSub = document.querySelector('#librarySubmenu .sidebar-submenu-item.active');
        if (activeSub && activeSub.getAttribute('data-view')) libraryView = activeSub.getAttribute('data-view');
    } catch (e0) {}
    currentModule = 'library';
    activeNavGroup = 'library';
    hasUserNavigated = true;
    libraryAccordionExpanded = true;
    try {
        var qs = typeof window !== 'undefined' && window.location && window.location.search ? window.location.search : '';
        var urlMod = (qs && qs.indexOf('module=') >= 0) ? (function () { var p = new URLSearchParams(qs); return (p.get('module') || '').trim(); })() : '';
        if (urlMod === 'marketplace') {
            currentModule = 'marketplace';
            activeNavGroup = 'marketplace';
            libraryAccordionExpanded = false;
        }
        if (urlMod === 'messages') {
            currentModule = 'messages';
            activeNavGroup = 'messages';
            libraryAccordionExpanded = false;
        }
    } catch (eUrl) {}

    function applyModuleUI() {
        var sidebarMain = document.getElementById('sidebarMainLibrary');
        var sidebarOther = document.getElementById('sidebarOtherSectors');
        if (currentModule === 'marketplace') {
            if (sidebarMain) sidebarMain.classList.remove('expanded');
        } else {
            if (sidebarMain) sidebarMain.classList.toggle('expanded', libraryAccordionExpanded);
        }
        var mojeKnihovnaToggle = document.getElementById('sidebarMojeKnihovnaToggle');
        if (mojeKnihovnaToggle) mojeKnihovnaToggle.setAttribute('aria-expanded', (currentModule === 'marketplace' ? false : libraryAccordionExpanded) ? 'true' : 'false');
        if (sidebarOther) sidebarOther.classList.toggle('expanded', otherSectorsExpanded);

        // Aktivní zvýraznění: zeleně jen aktuální sekce/folder (až po první interakci)
        document.querySelectorAll('.sidebar-nav-item').forEach(function (el) {
            var mod = el.getAttribute('data-module') || '';
            var id = el.id || '';
            var isLibraryToggle = mod === 'library' && el.getAttribute('data-has-submenu') === '1';
            var isOtherToggle = id === 'btnOtherSectorsToggle';
            var isKids = mod === 'childrenLibrary';
            var isPracovna = mod === 'pracovna';
            var isStats = mod === 'statistics';
            var isMarketplace = mod === 'marketplace';
            var isMessages = mod === 'messages';

            var active = false;
            if (hasUserNavigated) {
                if (isLibraryToggle) active = (activeNavGroup === 'library');
                else if (isOtherToggle) active = (activeNavGroup === 'other');
                else if (isKids) active = (activeNavGroup === 'childrenLibrary');
                else if (isPracovna) active = (activeNavGroup === 'pracovna');
                else if (isStats) active = (activeNavGroup === 'statistics');
                else if (isMarketplace) active = (activeNavGroup === 'marketplace');
                else if (isMessages) active = (activeNavGroup === 'messages');
            }
            el.classList.toggle('active', !!active);
        });

        var submenu = document.getElementById('librarySubmenu');
        if (submenu) {
            document.querySelectorAll('#librarySubmenu .sidebar-submenu-item').forEach(function (el) {
                el.classList.toggle('active', hasUserNavigated && currentModule === 'library' && el.getAttribute('data-view') === libraryView);
            });
        }
        var otherSub = document.getElementById('otherSectorsSubmenu');
        if (otherSub) {
            document.querySelectorAll('#otherSectorsSubmenu .sidebar-submenu-item').forEach(function (el) {
                el.classList.toggle('active', hasUserNavigated && el.getAttribute('data-module') === currentModule);
            });
        }

        var contentForCollection = document.getElementById('contentForCollection');
        var contentForCollectionMain = document.getElementById('contentForCollectionMain');
        var contentForCollectionPlaceholder = document.getElementById('contentForCollectionPlaceholder');
        var showPlaceholder = contentForCollection && comingSoonPlaceholderModules.indexOf(currentModule) !== -1;
        var showContentForCollection = currentModule !== 'statistics' && currentModule !== 'childrenLibrary' && currentModule !== 'pracovna' && currentModule !== 'marketplace' && currentModule !== 'messages' &&
            (currentModule === 'library' || currentModule !== 'library');

        if (contentForCollection) contentForCollection.style.display = showContentForCollection ? 'block' : 'none';
        if (contentForCollectionMain) contentForCollectionMain.style.display = showPlaceholder ? 'none' : 'block';
        if (contentForCollectionPlaceholder) contentForCollectionPlaceholder.style.display = showPlaceholder ? 'block' : 'none';

        var mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.classList.toggle('view-collection', !!showContentForCollection);

        // Statistiky: přepnout režim stránky (skryje knihovnu a ukáže sekci Statistiky)
        try {
            document.body.classList.toggle('module-statistics', currentModule === 'statistics');
        } catch (e0) {}
        // Tržiště: ukázat sekci Tržiště, skrýt knihovnu (zelené tlačítko jako Pracovna)
        try {
            document.body.classList.toggle('module-marketplace', currentModule === 'marketplace');
            var marketplaceSection = document.getElementById('marketplaceSection');
            if (marketplaceSection) marketplaceSection.style.display = currentModule === 'marketplace' ? 'block' : 'none';
        } catch (e0) {}
        // Zprávy: ukázat sekci Zprávy, skrýt knihovnu a Tržiště
        try {
            document.body.classList.toggle('module-messages', currentModule === 'messages');
            var messagesSection = document.getElementById('messagesSection');
            if (messagesSection) messagesSection.style.display = currentModule === 'messages' ? 'block' : 'none';
        } catch (e0) {}
        try {
            if (currentModule === 'statistics' && typeof window.__OMNI_renderStatistics === 'function') {
                window.__OMNI_renderStatistics();
            }
        } catch (e1) {}

        var visualMapUploadWrap = document.getElementById('visualMapUploadWrap');
        var comingSoonCard = document.getElementById('comingSoonCard');
        if (visualMapUploadWrap) visualMapUploadWrap.style.display = (showPlaceholder && currentModule === 'visualMap') ? 'block' : 'none';
        if (comingSoonCard) comingSoonCard.style.display = (showPlaceholder && currentModule !== 'visualMap') ? 'block' : 'none';

        var comingSoonTextEl = document.getElementById('comingSoonText');
        if (comingSoonTextEl && typeof window.OMNI_SECTORS !== 'undefined' && window.OMNI_SECTORS.getComingSoonMessage) {
            comingSoonTextEl.textContent = window.OMNI_SECTORS.getComingSoonMessage(currentModule);
        } else if (comingSoonTextEl) {
            comingSoonTextEl.textContent = 'Tato sekce se pro tebe připravuje.';
        }
    }

    document.querySelectorAll('.sidebar-nav-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (btn.getAttribute('data-open-modal')) return;
            if (btn.getAttribute('data-module') === 'library' && btn.getAttribute('data-has-submenu') === '1') {
                // Akordeon: otevřít knihovnu, zavřít ostatní
                hasUserNavigated = true;
                activeNavGroup = 'library';
                otherSectorsExpanded = false;
                libraryAccordionExpanded = !libraryAccordionExpanded;
                currentModule = 'library';
                applyModuleUI();
                return;
            }
            if (btn.id === 'btnOtherSectorsToggle') {
                // Akordeon: otevřít "Další sektory", zavřít knihovnu
                hasUserNavigated = true;
                activeNavGroup = 'other';
                libraryAccordionExpanded = false;
                otherSectorsExpanded = !otherSectorsExpanded;
                applyModuleUI();
                return;
            }
            if (btn.id === 'btnChildrenLibraryToggle') {
                currentModule = 'childrenLibrary';
                hasUserNavigated = true;
                activeNavGroup = 'childrenLibrary';
                libraryAccordionExpanded = false;
                otherSectorsExpanded = false;
                applyModuleUI();
                return;
            }
            var mod = btn.getAttribute('data-module');
            if (mod === 'marketplace') {
                currentModule = 'marketplace';
                hasUserNavigated = true;
                libraryAccordionExpanded = false;
                otherSectorsExpanded = false;
                activeNavGroup = 'marketplace';
                applyModuleUI();
                return;
            }
            if (mod === 'messages') {
                currentModule = 'messages';
                hasUserNavigated = true;
                libraryAccordionExpanded = false;
                otherSectorsExpanded = false;
                activeNavGroup = 'messages';
                applyModuleUI();
                return;
            }
            if (mod) {
                currentModule = mod;
                if (window.OMNI_SECTORS && window.OMNI_SECTORS.setCurrentSector) window.OMNI_SECTORS.setCurrentSector(mod);
            }
            // Při přechodu mimo knihovnu sbal akordeony
            if (mod && mod !== 'library' && comingSoonPlaceholderModules.indexOf(mod) === -1) {
                hasUserNavigated = true;
                libraryAccordionExpanded = false;
                otherSectorsExpanded = false;
                activeNavGroup = mod;
            }
            applyModuleUI();
        });
    });

    document.querySelectorAll('.sidebar-submenu-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var parent = btn.closest('[id$="Submenu"]');
            var parentId = parent ? parent.id : '';
            if (parentId === 'otherSectorsSubmenu' && btn.hasAttribute('data-module')) {
                currentModule = btn.getAttribute('data-module');
                if (window.OMNI_SECTORS && window.OMNI_SECTORS.setCurrentSector) window.OMNI_SECTORS.setCurrentSector(currentModule);
                hasUserNavigated = true;
                activeNavGroup = 'other';
                otherSectorsExpanded = true;
                libraryAccordionExpanded = false;
                applyModuleUI();
                return;
            }
            if (parentId === 'librarySubmenu' && btn.hasAttribute('data-view')) {
                var view = btn.getAttribute('data-view');
                libraryView = view;
                if (view === 'forSale') {
                    currentModule = 'marketplace';
                    hasUserNavigated = true;
                    activeNavGroup = 'marketplace';
                    libraryAccordionExpanded = false;
                    document.querySelectorAll('#librarySubmenu .sidebar-submenu-item').forEach(function (b) {
                        b.classList.toggle('active', b.getAttribute('data-view') === libraryView);
                    });
                    applyModuleUI();
                    try { document.dispatchEvent(new CustomEvent('library-view-changed')); } catch (e) {}
                    if (typeof window.loadMarketplaceContent === 'function') window.loadMarketplaceContent();
                    setTimeout(function () {
                        var el = document.getElementById('marketplaceMyShelfSection');
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 150);
                    return;
                }
                currentModule = 'library';
                document.querySelectorAll('#librarySubmenu .sidebar-submenu-item').forEach(function (b) {
                    b.classList.toggle('active', b.getAttribute('data-view') === libraryView);
                });
                hasUserNavigated = true;
                activeNavGroup = 'library';
                applyModuleUI();
                try { document.dispatchEvent(new CustomEvent('library-view-changed')); } catch (e) {}
                return;
            }
        });
    });

    var logo = document.getElementById('sidebarLogo');
    if (logo) {
        logo.addEventListener('click', function () {
            // Globální přepnutí na Knihovnu (multi-modulární switcher)
            try {
                if (window.OMNI_AppState && typeof window.OMNI_AppState.setActiveModule === 'function') {
                    window.OMNI_AppState.setActiveModule('library');
                }
            } catch (eZ) {}

            currentModule = 'library';
            libraryView = 'collection';
            activeNavGroup = '';
            hasUserNavigated = false;
            // při startu/kliknutí logo nech zbalené (uživatel si rozbalí)
            libraryAccordionExpanded = false;
            otherSectorsExpanded = false;
            if (window.OMNI_SECTORS && window.OMNI_SECTORS.setCurrentSector) window.OMNI_SECTORS.setCurrentSector('library');
            applyModuleUI();
        });
    }

    var btnBack = document.getElementById('btnSidebarBackToLibrary');
    if (btnBack) {
        btnBack.addEventListener('click', function () {
            // Pro jistotu: vždy zpět do knihovního modulu
            try {
                if (window.OMNI_AppState && typeof window.OMNI_AppState.setActiveModule === 'function') {
                    window.OMNI_AppState.setActiveModule('library');
                }
            } catch (eY) {}

            currentModule = 'library';
            libraryView = 'collection';
            activeNavGroup = '';
            hasUserNavigated = false;
            libraryAccordionExpanded = false;
            otherSectorsExpanded = false;
            if (window.OMNI_SECTORS && window.OMNI_SECTORS.setCurrentSector) window.OMNI_SECTORS.setCurrentSector('library');
            applyModuleUI();
        });
    }

    applyModuleUI();
})();
