/**
 * Knihovna – nahrávání a analýza obrázků, ruční přidávání knih.
 * Používá moduly: js/sectors.js, js/modules/text-module.js, js/modules/upload-module.js (pokud načteny).
 */
(function () {
    'use strict';

    var BASE_STORAGE_KEY = 'omnishelf_library';
    var DEFAULT_BOOK_PLACEHOLDER = 'assets/img/placeholders/default-book-icon.png';
    var CURRENT_USER_KEY = 'omnishelf_current_user';
    var BIRTHDAY_STORAGE_KEY = 'omnishelf_user_birthday';
    var BIRTH_YEAR_STORAGE_KEY = 'omnishelf_user_birth_year';
    var VOICE_TONE_STORAGE_KEY = 'omnishelf_voice_tone';
    var PUBLIC_SHELVES_KEY = 'omnishelf_public_shelves';
    var SHELF_VISIBILITY_KEY = 'omnishelf_shelf_visibility_filter';
    var SHELF_SORT_KEY = 'omnishelf_shelf_sort';
    var GLOBAL_SORT_KEY = 'omnishelf_global_sort';
    var SHELF_ACCORDION_STATE_KEY = 'omnishelf_shelf_accordion_state';
    var SHELF_FAVORITES_KEY = 'omnishelf_shelf_favorites_filter';
    var LIBRARY_VIEW_MODE_KEY = 'omnishelf_library_view_mode';
    var FRIENDS_PUBLIC_RECOS_KEY = 'omnishelf_friends_public_recos_v1';
    var SHARED_TO_MARKETPLACE_KEY = 'omnishelf_shared_to_marketplace_v1';
    function getOpenAiKey() {
        try {
            if (window.OMNI_Keys && typeof window.OMNI_Keys.getOpenAiKey === 'function') return window.OMNI_Keys.getOpenAiKey();
        } catch (e0) {}
        return (window.OMNI_CONFIG && window.OMNI_CONFIG.openai) || '';
    }
    var shelfCurrentPage = {};
    var BOOKS_PER_PAGE = 5;
    var borrowedEmptyMsgIndex = 0;

    // Cache pro veřejná doporučení (připíchnutá napříč knihami)
    var __friendsPublicRecoCacheRaw = null;
    var __friendsPublicRecoCacheMap = null;

    function normalizeForRecoKey(str) {
        if (str == null) return '';
        return String(str).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function computeBookKeyForReco(bookLike) {
        var isbn = (bookLike && bookLike.isbn) ? String(bookLike.isbn).replace(/\s/g, '') : '';
        if (isbn) return 'isbn:' + isbn;
        var t = normalizeForRecoKey(bookLike && bookLike.title);
        var a = normalizeForRecoKey(bookLike && bookLike.author);
        if (!t && !a) return '';
        return 'ta:' + t + '|' + a;
    }

    function safeParseJson(raw, fallback) {
        try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }

    function getSharedToMarketplace() {
        try { return safeParseJson(localStorage.getItem(SHARED_TO_MARKETPLACE_KEY), []); } catch (e) { return []; }
    }
    function addToSharedMarketplace(item) {
        var list = getSharedToMarketplace();
        if (!Array.isArray(list)) list = [];
        list.push(item);
        try { localStorage.setItem(SHARED_TO_MARKETPLACE_KEY, JSON.stringify(list)); } catch (e) {}
    }

    /** Vrátí knihy ze knihovny, které mají status nebo tag Na prodej, Daruji nebo Výměna – pro sekci „Moje police na tržišti“. */
    function getBooksForMarketplaceMyShelf() {
        var arr = Array.isArray(library) ? library : [];
        return arr.filter(function (b) {
            var ownership = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
            if (ownership === 'forsale' || ownership === 'daruji' || ownership === 'vymena') return true;
            var tags = (b.tags && Array.isArray(b.tags)) ? b.tags : [];
            var tagStr = tags.map(function (t) { return String(t || '').trim().toLowerCase(); }).join(' ');
            if (!tagStr) return false;
            return tagStr.indexOf('na prodej') !== -1 || tagStr.indexOf('daruji') !== -1 || tagStr.indexOf('výměna') !== -1 || tagStr.indexOf('vymena') !== -1;
        });
    }

    /** Pro knihu vrácenou z getBooksForMarketplaceMyShelf vrátí normalizovaný ownership pro zobrazení (forsale/daruji/vymena). */
    function getMarketplaceOwnershipForBook(b) {
        var ownership = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
        if (ownership === 'forsale' || ownership === 'daruji' || ownership === 'vymena') return ownership;
        var tags = (b.tags && Array.isArray(b.tags)) ? b.tags : [];
        var tagStr = tags.map(function (t) { return String(t || '').trim().toLowerCase(); }).join(' ');
        if (tagStr.indexOf('daruji') !== -1) return 'daruji';
        if (tagStr.indexOf('výměna') !== -1 || tagStr.indexOf('vymena') !== -1) return 'vymena';
        if (tagStr.indexOf('na prodej') !== -1) return 'forsale';
        return 'forsale';
    }

    /** Vyplní sekci „Co prodávám“ v Tržišti: aktivně filtruje knihy (getBooksForMarketplaceMyShelf) a vykreslí bílé karty s štítky MOJE/NA PRODEJ, bublinou a tlačítkem Napsat majiteli. */
    function syncMarketplaceMyShelf() {
        var container = document.getElementById('marketplaceMyShelfContainer');
        if (!container) return;
        var books = getBooksForMarketplaceMyShelf();
        container.innerHTML = '';
        var statusToLabel = { forsale: 'NA PRODEJ', daruji: 'Daruji', vymena: 'Výměna' };
        var statusToClass = { forsale: 'na-prodej', daruji: 'daruji', vymena: 'vymena' };
        if (books.length === 0) {
            var emptyEl = document.createElement('p');
            emptyEl.className = 'marketplace-my-shelf-empty';
            emptyEl.setAttribute('aria-live', 'polite');
            emptyEl.textContent = 'Zatím nic neprodáváte. Přidejte knihu k prodeji v akordeonu „Na prodej“ nebo v detailu knihy („Vystavit na Tržišti“).';
            container.appendChild(emptyEl);
            if (typeof window.showMarketplaceMyShelfAfterSync === 'function') window.showMarketplaceMyShelfAfterSync();
            return;
        }
        books.forEach(function (b) {
            var ownership = getMarketplaceOwnershipForBook(b);
            var statusLabel = statusToLabel[ownership] || 'Na prodej';
            var statusClass = statusToClass[ownership] || 'na-prodej';
            var title = (b.title || '').trim() || '—';
            var author = (b.author || '').trim() || '—';
            var bubble = (b.marketplaceBubble || b.marketplaceNote || b.aiSummary || '').trim() || 'Doporučuji.';
            var coverValue = (b.image || b.coverImage || b.obal || '').toString().trim();
            var coverHtml = coverValue
                ? '<img src="' + (coverValue.indexOf('data:image') === 0 ? coverValue : 'data:image/jpeg;base64,' + coverValue) + '" alt="" class="marketplace-card__cover-img" />'
                : '<span class="marketplace-card__cover-fallback">&#128218;</span>';
            var article = document.createElement('article');
            article.className = 'marketplace-card marketplace-card--my-shelf';
            article.setAttribute('role', 'listitem');
            article.setAttribute('tabindex', '0');
            article.setAttribute('data-marketplace-card', '');
            article.setAttribute('data-marketplace-status', statusClass);
            article.setAttribute('data-book-id', (b.id || '').toString());
            article.setAttribute('title', 'Kliknutím zobrazíte detail');
            article.innerHTML =
                '<div class="marketplace-card__cover-wrap" aria-hidden="true">' +
                '<span class="marketplace-card__status-label marketplace-card__status-label--left marketplace-card__status-label--moje">MOJE</span>' +
                '<span class="marketplace-card__status-label marketplace-card__status-label--' + statusClass + '">' + escapeHtml(statusLabel) + '</span>' +
                coverHtml + '</div>' +
                '<div class="marketplace-card__body">' +
                '<h3 class="marketplace-card__title">' + escapeHtml(title) + '</h3>' +
                '<p class="marketplace-card__author">' + escapeHtml(author) + '</p>' +
                '<p class="marketplace-card__seller marketplace-card__seller--friend">Prodává: Já (ze své knihovny)</p>' +
                '<div class="user-bubble" aria-label="Vzkaz">' + escapeHtml(bubble) + '</div>' +
                '<button type="button" class="marketplace-card__msg-owner" data-action="message-owner" aria-label="Napsat majiteli">Napsat majiteli</button>' +
                '</div>';
            container.appendChild(article);
        });
        if (typeof window.showMarketplaceMyShelfAfterSync === 'function') window.showMarketplaceMyShelfAfterSync();
    }

    function getFriendsPublicRecoMap() {
        var raw = '';
        try { raw = String(localStorage.getItem(FRIENDS_PUBLIC_RECOS_KEY) || ''); } catch (e) { raw = ''; }
        if (__friendsPublicRecoCacheRaw === raw && __friendsPublicRecoCacheMap) return __friendsPublicRecoCacheMap;
        __friendsPublicRecoCacheRaw = raw;
        var list = safeParseJson(raw, []);
        var map = {};
        (Array.isArray(list) ? list : []).forEach(function (r) {
            if (!r) return;
            var key = String(r.bookKey || '').trim() || computeBookKeyForReco(r);
            if (!key) return;
            if (!map[key]) map[key] = [];
            map[key].push(r);
        });
        __friendsPublicRecoCacheMap = map;
        return map;
    }

    function truncateRecoMsg(s, maxLen) {
        var t = String(s || '');
        if (t.length <= maxLen) return t;
        return t.slice(0, Math.max(0, maxLen - 1)).trim() + '…';
    }

    function getShelfVisibilityFilter() {
        try {
            var raw = localStorage.getItem(SHELF_VISIBILITY_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function setShelfVisibilityFilter(shelfName, value) {
        var o = getShelfVisibilityFilter();
        o[shelfName] = value;
        try { localStorage.setItem(SHELF_VISIBILITY_KEY, JSON.stringify(o)); } catch (e) {}
    }

    function getShelfSort() {
        try {
            var raw = localStorage.getItem(SHELF_SORT_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function setShelfSort(shelfName, value) {
        var o = getShelfSort();
        o[shelfName] = value;
        try { localStorage.setItem(SHELF_SORT_KEY, JSON.stringify(o)); } catch (e) {}
    }

    function getGlobalSortMode() {
        try { return (localStorage.getItem(GLOBAL_SORT_KEY) || '').trim(); } catch (e) { return ''; }
    }
    function setGlobalSortMode(value) {
        try {
            var v = (value || '').trim();
            if (!v) localStorage.removeItem(GLOBAL_SORT_KEY);
            else localStorage.setItem(GLOBAL_SORT_KEY, v);
        } catch (e) {}
    }

    function getShelfAccordionState() {
        try {
            var raw = localStorage.getItem(SHELF_ACCORDION_STATE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function setShelfExpandedState(key, expanded) {
        var o = getShelfAccordionState();
        if (expanded) o[key] = true;
        else delete o[key];
        try { localStorage.setItem(SHELF_ACCORDION_STATE_KEY, JSON.stringify(o)); } catch (e) {}
    }

    function normalizeForFilter(str) {
        if (str == null) return '';
        return String(str).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function parseGlobalMode(raw) {
        var v = (raw || '').trim();
        if (!v) return { kind: 'none', value: '' };
        if (v.indexOf('genre:') === 0) return { kind: 'genre', value: normalizeForFilter(v.slice(6)) };
        if (v.indexOf('status:') === 0) return { kind: 'status', value: normalizeForFilter(v.slice(7)) };
        if (v.indexOf('privacy:') === 0) return { kind: 'privacy', value: normalizeForFilter(v.slice(8)) };
        if (v.indexOf('favorites:') === 0) return { kind: 'favorites', value: '1' };
        if (v.indexOf('sort:') === 0) return { kind: 'sort', value: normalizeForFilter(v.slice(5)).replace(/-/g, '_') };
        // zpětná kompatibilita
        return { kind: 'sort', value: normalizeForFilter(v).replace(/-/g, '_') };
    }

    function getBookStatusNorm(b) {
        return normalizeForFilter((b && (b.ownershipStatus || b.status)) || '');
    }

    function getFilterSummaryText(mode) {
        if (!mode || mode.kind === 'none') return 'Zobrazeno: Vše';
        if (mode.kind === 'favorites') return 'Zobrazeno: Jen srdcovky';
        if (mode.kind === 'status') {
            if (mode.value === 'borrowed' || mode.value === 'pujceno' || mode.value === 'borrowedbyme') return 'Zobrazeno: Stav – Půjčené';
            if (mode.value === 'borrowed_lent') return 'Zobrazeno: V zapůjčení';
            if (mode.value === 'wishlist') return 'Zobrazeno: Stav – Přeji si';
            if (mode.value === 'forsale') return 'Zobrazeno: Na prodej';
            if (mode.value === 'sold') return 'Zobrazeno: Prodané';
            return 'Zobrazeno: Stav';
        }
        if (mode.kind === 'privacy') {
            if (mode.value === 'public' || mode.value === 'verejna') return 'Zobrazeno: Veřejné';
            if (mode.value === 'private' || mode.value === 'soukroma') return 'Zobrazeno: Soukromé';
            return 'Zobrazeno: Sdílení';
        }
        if (mode.kind === 'genre') return 'Zobrazeno: Žánr – ' + (mode.value ? (mode.value.charAt(0).toUpperCase() + mode.value.slice(1)) : '—');
        if (mode.kind === 'sort') {
            var m = mode.value;
            if (m === 'author') return 'Zobrazeno: Autor A–Z';
            if (m === 'author_desc' || m === 'authordesc') return 'Zobrazeno: Autor Z–A';
            if (m === 'title') return 'Zobrazeno: Titul A–Z';
            if (m === 'title_desc' || m === 'titledesc') return 'Zobrazeno: Titul Z–A';
            if (m === 'added' || m === 'addedat') return 'Zobrazeno: Datum přidání';
            if (m === 'genre') return 'Zobrazeno: Žánr';
            if (m === 'owner' || m === 'majitel') return 'Zobrazeno: Majitel';
            if (m === 'privacy') return 'Zobrazeno: Sdílení';
            if (m === 'status') return 'Zobrazeno: Stav (priorita)';
            return 'Zobrazeno: Řazení';
        }
        return 'Zobrazeno: Filtr';
    }

    function collectGenres(list) {
        var seen = {};
        var out = [];
        (Array.isArray(list) ? list : []).forEach(function (b) {
            var gRaw = (b && b.genre) ? String(b.genre).trim() : '';
            if (!gRaw) return;
            var g = normalizeForFilter(gRaw);
            if (!g || seen[g]) return;
            seen[g] = true;
            out.push({ key: g, label: gRaw });
        });
        out.sort(function (a, b) { return a.label.localeCompare(b.label, 'cs'); });
        return out;
    }
    function getShelfFavoritesFilter() {
        try {
            var raw = localStorage.getItem(SHELF_FAVORITES_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function setShelfFavoritesFilter(shelfName, value) {
        var o = getShelfFavoritesFilter();
        o[shelfName] = value;
        try { localStorage.setItem(SHELF_FAVORITES_KEY, JSON.stringify(o)); } catch (e) {}
    }

    function getLibraryViewMode() {
        try {
            var v = localStorage.getItem(LIBRARY_VIEW_MODE_KEY);
            return (v === 'smart' || v === 'reality') ? v : 'reality';
        } catch (e) { return 'reality'; }
    }
    function getBirthday() {
        try { return (localStorage.getItem(BIRTHDAY_STORAGE_KEY) || '').trim(); } catch (e) { return ''; }
    }
    function setBirthday(mmdd) {
        try {
            var s = (mmdd || '').trim();
            if (s) localStorage.setItem(BIRTHDAY_STORAGE_KEY, s);
            else localStorage.removeItem(BIRTHDAY_STORAGE_KEY);
        } catch (e) {}
    }
    function getBirthYear() {
        try { return (localStorage.getItem(BIRTH_YEAR_STORAGE_KEY) || '').trim(); } catch (e) { return ''; }
    }
    function setBirthYear(year) {
        try {
            var s = String(year || '').trim();
            if (s) localStorage.setItem(BIRTH_YEAR_STORAGE_KEY, s);
            else localStorage.removeItem(BIRTH_YEAR_STORAGE_KEY);
        } catch (e) {}
    }
    function getVoiceTone() {
        try {
            var v = localStorage.getItem(VOICE_TONE_STORAGE_KEY);
            return (v === 'friendly' || v === 'kind' || v === 'funny' || v === 'motivating' || v === 'serious') ? v : 'friendly';
        } catch (e) { return 'friendly'; }
    }
    function setVoiceTone(tone) {
        try {
            if (['friendly', 'kind', 'funny', 'motivating', 'serious'].indexOf(tone) !== -1) localStorage.setItem(VOICE_TONE_STORAGE_KEY, tone);
        } catch (e) {}
    }
    /** Wishlist se v čase narozenin (týden před + den D) automaticky „otevře“ pro rodinu (FamilyID). */
    function isWishlistBirthdayOpen() {
        var b = getBirthday();
        if (!b) return false;
        var parts = b.split(/[-./]/);
        var month = parseInt(parts[0], 10);
        var day = parseInt(parts[1] || parts[0], 10);
        if (parts.length >= 2 && parts[0].length <= 2) { month = parseInt(parts[0], 10); day = parseInt(parts[1], 10); }
        if (parts.length === 1 && b.length >= 3) { month = parseInt(b.slice(0, 2), 10); day = parseInt(b.slice(2), 10); }
        if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return false;
        var now = new Date();
        var todayMonth = now.getMonth() + 1;
        var todayDay = now.getDate();
        var diff = (month * 32 + day) - (todayMonth * 32 + todayDay);
        if (diff < 0) diff += 366;
        return diff <= 7 || (todayMonth === month && todayDay === day);
    }
    /** Během období narozenin je Wishlist veřejný pro členy rodinného kódu (pro dárky). */
    function isWishlistPublicForFamily() { return isWishlistBirthdayOpen(); }
    function setLibraryViewMode(mode) {
        if (mode !== 'smart' && mode !== 'reality') return;
        try { localStorage.setItem(LIBRARY_VIEW_MODE_KEY, mode); } catch (e) {}
    }

    function getShelfKey(book) {
        var loc = (book.physicalLocation || book.location || '').trim();
        return loc || '— Bez poličky —';
    }
    function getBooksForShelf(shelfName) {
        var currentView = getCurrentLibraryView();
        var list = filterLibraryByView(library, currentView);
        var publicView = isPublicView();
        if (publicView) list = list.filter(function (b) { return (b.privacy || 'private').toLowerCase() === 'public'; });
        if (shelfName === 'Moje knihovna') return list.slice();
        if (shelfName === 'Co mám doma půjčeného - Potřebné vrátit') return list.filter(function (b) { return getBookStatusNorm(b) === 'borrowedbyme' && !b.returned; });
        if (shelfName === 'Mé knihy u přátel polici') return list.filter(function (b) { var s = getBookStatusNorm(b); return s === 'borrowed' || s === 'pujceno'; });
        return list.filter(function (b) { return getShelfKey(b) === shelfName; });
    }
    function getShelfNamesList() {
        var currentView = getCurrentLibraryView();
        var list = filterLibraryByView(library, currentView);
        var publicView = isPublicView();
        if (publicView) list = list.filter(function (b) { return (b.privacy || 'private').toLowerCase() === 'public'; });
        var keys = {};
        list.forEach(function (b) { keys[getShelfKey(b)] = true; });
        return Object.keys(keys).sort(function (a, b) {
            if (a === '— Bez poličky —') return 1;
            if (b === '— Bez poličky —') return -1;
            return a.localeCompare(b);
        });
    }
    function moveBookToShelf(bookId, targetShelf) {
        var book = library.filter(function (b) { return (b.id || '') === bookId; })[0];
        if (!book) return;
        var shelf = targetShelf || '— Bez poličky —';
        book.location = shelf;
        book.physicalLocation = shelf;
        saveLibrary();
    }
    function openShelfSettingsModal(shelfName, emptyState, scanHistoryGrid, shelfNameInput) {
        var overlay = document.getElementById('shelfSettingsModalOverlay');
        var modal = document.getElementById('shelfSettingsModal');
        var nameInput = document.getElementById('shelfSettingsName');
        var privacySelect = document.getElementById('shelfSettingsPrivacy');
        if (!overlay || !modal || !nameInput) return;
        nameInput.value = shelfName;
        privacySelect.value = getShelfVisibilityFilter()[shelfName] || 'all';
        overlay.style.display = 'flex';
        var close = function () { overlay.style.display = 'none'; };
        overlay.onclick = function (e) { if (e.target === overlay) close(); };
        document.getElementById('shelfSettingsModalClose').onclick = close;
        document.getElementById('shelfSettingsRename').onclick = function () {
            var newName = (nameInput.value || '').trim();
            if (!newName || newName === shelfName) { close(); return; }
            library.forEach(function (b) {
                if (getShelfKey(b) === shelfName) { b.location = newName; b.physicalLocation = newName; }
            });
            var v = getShelfVisibilityFilter(); v[newName] = v[shelfName] !== undefined ? v[shelfName] : 'all'; delete v[shelfName]; try { localStorage.setItem(SHELF_VISIBILITY_KEY, JSON.stringify(v)); } catch (e) {}
            var s = getShelfSort(); s[newName] = s[shelfName] !== undefined ? s[shelfName] : 'author'; delete s[shelfName]; try { localStorage.setItem(SHELF_SORT_KEY, JSON.stringify(s)); } catch (e) {}
            saveLibrary();
            close();
            renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        };
        document.getElementById('shelfSettingsDelete').onclick = function () {
            if (!confirm('Smazat polici „' + shelfName.replace(/"/g, '') + '“? Knihy budou přesunuty do Bez poličky.')) return;
            library.forEach(function (b) {
                if (getShelfKey(b) === shelfName) { b.location = '— Bez poličky —'; b.physicalLocation = '— Bez poličky —'; }
            });
            setShelfPublic(shelfName, null);
            var o = getShelfVisibilityFilter(); delete o[shelfName]; try { localStorage.setItem(SHELF_VISIBILITY_KEY, JSON.stringify(o)); } catch (e) {}
            var o3 = getShelfSort(); delete o3[shelfName]; try { localStorage.setItem(SHELF_SORT_KEY, JSON.stringify(o3)); } catch (e) {}
            saveLibrary();
            close();
            renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        };
        privacySelect.onchange = function () {
            setShelfVisibilityFilter(shelfName, privacySelect.value);
            renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        };
    }
    function sortBooksBy(books, sortBy) {
        if (window.OMNI_LibraryTextLogic && typeof window.OMNI_LibraryTextLogic.sortBooksBy === 'function') {
            return window.OMNI_LibraryTextLogic.sortBooksBy(books, sortBy);
        }
        sortBy = (sortBy || 'author').toLowerCase();
        var out = books.slice();
        if (sortBy === 'genre') {
            out.sort(function (a, b) {
                var ga = (a.genre || '').trim().toLowerCase();
                var gb = (b.genre || '').trim().toLowerCase();
                var cmp = ga.localeCompare(gb, 'cs');
                if (cmp !== 0) return cmp;
                var au = (a.author || '').trim().toLowerCase();
                var bu = (b.author || '').trim().toLowerCase();
                return au.localeCompare(bu, 'cs') || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'author') {
            out.sort(function (a, b) {
                var au = (a.author || '').trim().toLowerCase();
                var bu = (b.author || '').trim().toLowerCase();
                return au.localeCompare(bu, 'cs') || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'author_desc') {
            out.sort(function (a, b) {
                var au = (a.author || '').trim().toLowerCase();
                var bu = (b.author || '').trim().toLowerCase();
                return bu.localeCompare(au, 'cs') || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'title') {
            out.sort(function (a, b) {
                var ta = (a.title || '').trim().toLowerCase();
                var tb = (b.title || '').trim().toLowerCase();
                return ta.localeCompare(tb, 'cs') || ((a.author || '').trim().toLowerCase().localeCompare((b.author || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'title_desc') {
            out.sort(function (a, b) {
                var ta = (a.title || '').trim().toLowerCase();
                var tb = (b.title || '').trim().toLowerCase();
                return tb.localeCompare(ta, 'cs') || ((a.author || '').trim().toLowerCase().localeCompare((b.author || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'added' || sortBy === 'addedat') {
            out.sort(function (a, b) {
                var da = (a.addedAt || a.added_at || '').toString();
                var db = (b.addedAt || b.added_at || '').toString();
                var cmp = (da < db) ? 1 : (da > db) ? -1 : 0;
                if (cmp !== 0) return cmp;
                return ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'owner') {
            out.sort(function (a, b) {
                var oa = (a.owner || '').trim().toLowerCase();
                var ob = (b.owner || '').trim().toLowerCase();
                return oa.localeCompare(ob, 'cs') || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'status') {
            var statusOrder = { borrowed: 0, borrowedbyme: 1, reading: 2, mine: 3, forsale: 4, wishlist: 5 };
            out.sort(function (a, b) {
                var oa = (a.ownershipStatus || a.status || 'mine').toLowerCase().replace(/\s/g, '');
                var ob = (b.ownershipStatus || b.status || 'mine').toLowerCase().replace(/\s/g, '');
                var ra = (a.readingStatus || '').toLowerCase();
                var rb = (b.readingStatus || '').toLowerCase();
                var pa = (statusOrder[oa] !== undefined ? statusOrder[oa] : 6) - (ra === 'reading' ? 0.5 : 0);
                var pb = (statusOrder[ob] !== undefined ? statusOrder[ob] : 6) - (rb === 'reading' ? 0.5 : 0);
                return pa - pb || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        } else if (sortBy === 'privacy') {
            var privOrder = { private: 0, family: 1, public: 2 };
            out.sort(function (a, b) {
                var pa = privOrder[(a.privacy || 'private').toLowerCase()] !== undefined ? privOrder[(a.privacy || 'private').toLowerCase()] : 3;
                var pb = privOrder[(b.privacy || 'private').toLowerCase()] !== undefined ? privOrder[(b.privacy || 'private').toLowerCase()] : 3;
                return pa - pb || ((a.author || '').trim().toLowerCase().localeCompare((b.author || '').trim().toLowerCase(), 'cs')) || ((a.title || '').trim().toLowerCase().localeCompare((b.title || '').trim().toLowerCase(), 'cs'));
            });
        }
        return out;
    }

    function reorderShelfGridWithFlip(shelfName, sortBy, scanHistoryGrid) {
        if (!scanHistoryGrid) return;
        var group = null;
        for (var i = 0; i < scanHistoryGrid.children.length; i++) {
            if (scanHistoryGrid.children[i].getAttribute('data-shelf-name') === shelfName) {
                group = scanHistoryGrid.children[i];
                break;
            }
        }
        if (!group) return;
        var grid = group.querySelector('.books-grid');
        if (!grid || !grid.children.length) return;
        var books = getBooksForShelf(shelfName);
        var sorted = sortBooksBy(books, sortBy);
        var idOrder = sorted.map(function (b) { return (b.id || '').toString(); });
        var oldRects = {};
        for (var j = 0; j < grid.children.length; j++) {
            var c = grid.children[j];
            var bid = c.getAttribute('data-book-id');
            if (bid) oldRects[bid] = c.getBoundingClientRect();
        }
        var cards = Array.prototype.slice.call(grid.children);
        cards.sort(function (ca, cb) {
            var ia = idOrder.indexOf(ca.getAttribute('data-book-id'));
            var ib = idOrder.indexOf(cb.getAttribute('data-book-id'));
            return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
        });
        cards.forEach(function (c) { grid.appendChild(c); });
        grid.offsetHeight;
        for (j = 0; j < grid.children.length; j++) {
            c = grid.children[j];
            bid = c.getAttribute('data-book-id');
            var oldR = oldRects[bid];
            if (oldR) {
                var newR = c.getBoundingClientRect();
                var dx = oldR.left - newR.left;
                var dy = oldR.top - newR.top;
                c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                c.style.transition = 'none';
            }
        }
        requestAnimationFrame(function () {
            for (j = 0; j < grid.children.length; j++) {
                c = grid.children[j];
                c.style.transition = 'transform 0.4s ease';
                c.style.transform = 'none';
            }
            setTimeout(function () {
                for (j = 0; j < grid.children.length; j++) {
                    grid.children[j].style.transition = '';
                }
            }, 420);
        });
    }

    function getQueryParam(name) {
        var m = (window.location.search || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }

    function getPublicShelves() {
        try {
            var raw = localStorage.getItem(PUBLIC_SHELVES_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setShelfPublic(shelfName, tokenOrNull) {
        var shelves = getPublicShelves();
        if (tokenOrNull) shelves[shelfName] = { token: tokenOrNull }; else delete shelves[shelfName];
        try { localStorage.setItem(PUBLIC_SHELVES_KEY, JSON.stringify(shelves)); } catch (e) {}
    }

    function isPublicView() {
        var token = getQueryParam('public');
        var shelf = getQueryParam('shelf');
        if (!token || !shelf) return null;
        var shelves = getPublicShelves();
        var entry = shelves[shelf];
        return (entry && entry.token === token) ? { shelf: shelf, token: token } : null;
    }

    function generateShareToken() {
        return 'sh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    var scanHistory = [];
    var currentBooks = [];
    var library = [];
    var external_loans = [];
    var wishlist = [];
    var familyProfiles = [{ id: 'me', name: 'Já', initials: 'Já' }];
    var currentProfileId = 'me';
    var currentModule = 'library';
    // selected file + thisScanCollapsed přesunuto do window.OMNI_LibraryUploadLogic

    function getCurrentSectorId() {
        if (typeof window.OMNI_SECTORS !== 'undefined' && window.OMNI_SECTORS.getCurrentSector) {
            var s = window.OMNI_SECTORS.getCurrentSector();
            if (s && s.id) return s.id;
        }
        return currentModule;
    }
    var selectedBookIds = {};
    var favoritesBulkSelectMode = false; // Srdcovky: checkboxy jen v režimu hromadného výběru

    /* Prompt pro Vision API (shodný s index_zaloha2.html – OpenAI gpt-4o). Fotky nahrané v sekci Nahrávání (main.html / LibraryUpload) se odesílají zde. */
    var AI_ANALYZE_PROMPT = 'You are a professional librarian. Analyze the image and list EVERY single book you see. Return an individual entry for EVERY distinct spine you recognize, even if multiple books are by the same author. Each book spine should be listed separately with its specific title. Do not summarize or group books together. If a title is blurry, make your best guess but include it. If an ISBN or EAN barcode number is visible on the book spine, cover, or anywhere in the image for a specific book, include it as "isbn" (digits only, e.g. "9788012345678"). If not visible, omit the "isbn" key. Keep the response minimal: only title, author, and isbn when visible; no descriptions or extra fields. Output as JSON: {"books":[{"title":"Full Book Title","author":"Author Name","isbn":"optional digits"}]}. Reply with ONLY a valid JSON object, no markdown. If you cannot see any books, return {"books":[]}.';
    /* Wishlist: jedna fotka obálky – AI přečte jen název a autora. */
    var AI_WISHLIST_COVER_PROMPT = 'You see a single book cover. Extract the book title and author and return JSON: {"books":[{"title":"Exact title from cover","author":"Author name","isbn":""}]}. Reply with ONLY this JSON object, no markdown. If you cannot read the cover, return {"books":[]}.';
    /* Detailní sken: více fotek jedné knihy (obálka + ISBN). */
    var AI_ONE_BOOK_MULTI_PROMPT = 'You see MULTIPLE photos of the SAME single book (front cover, spine, and ISBN/EAN). Use ALL images to extract the most accurate title, author, and ISBN/EAN. Keep response minimal: only title, author, isbn. Return JSON: {"books":[{"title":"Exact title","author":"Author name","isbn":"digits only or empty"}]}. Reply with ONLY this JSON object, no markdown. If uncertain, return {"books":[]}.';

    function escapeHtml(s) {
        var div = document.createElement('div');
        div.textContent = s == null ? '' : s;
        return div.innerHTML;
    }

    function generateBookId() {
        return 'book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    }

    function ensureBookIds() {
        library.forEach(function (b) {
            if (!b.id) b.id = generateBookId();
        });
    }

    /**
     * Ukládá celou knihovnu včetně vypůjčených knih do localStorage.
     * Data jsou trvalá a přetrvají i po obnovení stránky nebo odhlášení.
     * Knihy s ownershipStatus: 'borrowedByMe' jsou uloženy v poli 'library' s location: 'Půjčená literatura'.
     */
    /** Vrací ID aktuálního uživatele/profilu pro úložiště. Preferuje currentProfileId (Gatekeeper), pak CURRENT_USER_KEY. */
    function getCurrentUserId() {
        if (typeof currentProfileId === 'string' && currentProfileId.trim()) return currentProfileId.trim();
        try {
            var id = localStorage.getItem(CURRENT_USER_KEY);
            if (id && typeof id === 'string') {
                id = id.trim();
                if (id) return id;
            }
        } catch (e) {}
        try {
            var legacyData = localStorage.getItem(BASE_STORAGE_KEY);
            if (legacyData) {
                var userId = 'legacy_admin';
                try { localStorage.setItem(CURRENT_USER_KEY, userId); } catch (e2) {}
                return userId;
            }
        } catch (e) {}
        return 'default';
    }

    /** Před uložením/načtením zajistí, že CURRENT_USER_KEY v localStorage odpovídá aktuálnímu profilu (propojení s Gatekeeperem). */
    function ensureStorageUserSync() {
        var id = getCurrentUserId();
        try {
            if (localStorage.getItem(CURRENT_USER_KEY) !== id) localStorage.setItem(CURRENT_USER_KEY, id);
        } catch (e) {}
    }

    function getUserStorageKey() {
        var familyId = typeof window.OMNI_UserState !== 'undefined' && window.OMNI_UserState.getFamilyId && window.OMNI_UserState.getFamilyId();
        if (familyId) return BASE_STORAGE_KEY + '__family__' + familyId;
        return BASE_STORAGE_KEY + '__user__' + getCurrentUserId();
    }

    function isQuotaExceededError(e) {
        if (!e) return false;
        // DOMException in different browsers
        if (e.name === 'QuotaExceededError') return true;
        if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
        // Legacy numeric codes (WebKit / IE)
        if (e.code === 22 || e.code === 1014) return true;
        if (e.number === -2147024882) return true;
        return false;
    }

    function saveLibrary() {
        ensureStorageUserSync();
        if (typeof window !== 'undefined') {
            window.__OMNI_lastSaveOk = true;
            window.__OMNI_lastSaveWasQuota = false;
            window.__OMNI_lastSaveError = null;
        }
        try {
            var key = getUserStorageKey();
            var payload = {
                scanHistory: scanHistory,
                currentBooks: currentBooks,
                library: library,
                external_loans: external_loans,
                wishlist: wishlist,
                familyProfiles: familyProfiles,
                currentProfileId: currentProfileId
            };
            localStorage.setItem(key, JSON.stringify(payload));
            return true;
        } catch (e) {
            console.warn('Omshelf: could not save to localStorage', e);
            if (typeof window !== 'undefined') {
                window.__OMNI_lastSaveOk = false;
                window.__OMNI_lastSaveWasQuota = isQuotaExceededError(e);
                window.__OMNI_lastSaveError = e;
            }
            if (isQuotaExceededError(e) && typeof window !== 'undefined' && typeof window.setAiAssistantNotice === 'function') {
                window.setAiAssistantNotice('storageFull');
            }
            return false;
        }
    }

    /** Globální funkce: přepíše localStorage aktuálním stavem pole knih (omnishelf_library pod klíčem uživatele). Volat po každé změně na kartě.
     * @param {Object} [bookOptional] - pokud předáš knihu, do konzole se vypíše diagnostika: „Ukladám knihu [Názov] so statusom [Status] a tagmi [Tagy]“
     */
    function saveToStorage(bookOptional) {
        if (bookOptional && typeof bookOptional === 'object') {
            var nazov = (bookOptional.title || '').trim() || '—';
            var status = (bookOptional.ownershipStatus || bookOptional.status || '').trim() || 'mine';
            var tagy = [];
            if (bookOptional.is_favorite || bookOptional.isFavorite) tagy.push('Srdcovka');
            if ((String(bookOptional.ownershipStatus || '').toLowerCase().replace(/\s/g, '')) === 'forsale') tagy.push('Na predaj');
            if (tagy.length === 0) tagy.push('—');
            console.log('Omshelf: Ukladám knihu [' + nazov + '] so statusom [' + status + '] a tagmi [' + tagy.join(', ') + ']');
            var hasCover = (bookOptional.coverImage || bookOptional.image || '').toString().trim();
            if (hasCover && hasCover.indexOf('data:image') === 0) console.log('Omshelf: Ukladám aj obálku knihy [' + nazov + '] do localStorage.');
        } else {
            console.log('Omshelf: Ukladám knihovnu, počet kníh: ' + (library && library.length) + '.');
        }
        return saveLibrary();
    }

    function migrateBookToNewFields(book) {
        if (!book) return;
        var s = (book.status || '').toLowerCase();
        var sNorm = (book.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s/g, '');
        if (!book.ownershipStatus) book.ownershipStatus = (s === 'borrowed' || s === 'pujceno' || sNorm === 'pujceno' || s === 'borrowedbyme' || s === 'forsale' || s === 'wishlist') ? ((s === 'pujceno' || sNorm === 'pujceno') ? 'borrowed' : s) : 'mine';
        if (!book.readingStatus) {
            var locNorm = ((book.location || '') + ' ' + (book.physicalLocation || '')).toLowerCase().replace(/\s/g, '');
            var fromLoc = (locNorm.indexOf('rozecteneknihy') >= 0 || locNorm.indexOf('rozectene') >= 0) ? 'reading' : null;
            book.readingStatus = fromLoc || (s === 'reading' ? 'reading' : s === 'read' ? 'read' : 'unread');
        }
        if (!book.privacy) book.privacy = 'private';
        if (book.is_favorite === undefined) book.is_favorite = !!(book.isFavorite || book.is_favorite);
        if (book.isFavorite === undefined) book.isFavorite = !!book.is_favorite;
        if (!Array.isArray(book.borrowedMessages)) book.borrowedMessages = [];
        if (book.physicalLocation === undefined) book.physicalLocation = (book.location || '').trim() || '';
        if (!Array.isArray(book.virtualSort)) book.virtualSort = [];
    }

    /**
     * Načítá celou knihovnu včetně vypůjčených knih z localStorage při startu aplikace.
     * Data jsou trvalá a přetrvají i po obnovení stránky nebo odhlášení.
     * Staré external_loans se automaticky migrují do library s ownershipStatus: 'borrowedByMe'.
     * Migruje také stará data z BASE_STORAGE_KEY do uživatelsky specifického klíče.
     */
    function loadLibrary() {
        ensureStorageUserSync();
        try {
            var key = getUserStorageKey();
            var raw = localStorage.getItem(key);
            
            // Pokud neexistují data pro aktuálního uživatele, zkus migrovat ze starého klíče
            if (!raw) {
                var legacyRaw = localStorage.getItem(BASE_STORAGE_KEY);
                if (legacyRaw) {
                    try {
                        // Migrace starých dat do nového uživatelsky specifického klíče
                        var legacyData = JSON.parse(legacyRaw);
                        localStorage.setItem(key, legacyRaw);
                        raw = legacyRaw;
                        console.log('Omshelf: Migrována stará data do uživatelsky specifického úložiště');
                    } catch (e) {
                        console.warn('Omshelf: Chyba při migraci starých dat', e);
                    }
                } else {
                    // Zkus ještě úložiště pod legacy_admin (knihy mohly zmizet po přihlášení pod jiným profilem)
                    var legacyUserKey = BASE_STORAGE_KEY + '__user__legacy_admin';
                    var legacyUserRaw = localStorage.getItem(legacyUserKey);
                    if (legacyUserRaw) {
                        try {
                            var parsed = JSON.parse(legacyUserRaw);
                            if (parsed && Array.isArray(parsed.library) && parsed.library.length > 0) {
                                localStorage.setItem(CURRENT_USER_KEY, 'legacy_admin');
                                raw = legacyUserRaw;
                                key = legacyUserKey;
                                console.log('Omshelf: Obnovena knihovna z profilu legacy_admin (počet knih: ' + parsed.library.length + ').');
                            }
                        } catch (e2) {}
                    }
                }
                if (!raw) {
                    library = [];
                    scanHistory = [];
                    currentBooks = [];
                    wishlist = [];
                    return;
                }
            }

            var data = JSON.parse(raw);
            if (Array.isArray(data.scanHistory)) scanHistory = data.scanHistory;
            if (Array.isArray(data.currentBooks)) currentBooks = data.currentBooks;
            if (Array.isArray(data.library)) library = data.library; // Obsahuje všechny knihy včetně borrowedByMe
            // Migrace starých external_loans do library (pro zpětnou kompatibilitu)
            if (Array.isArray(data.external_loans) && data.external_loans.length > 0) {
                data.external_loans.forEach(function (b) {
                    var book = {
                        id: b.id || generateBookId(),
                        title: b.title || b.nazev || '—',
                        author: b.author || b.autor || '—',
                        borrowedFrom: b.borrowedFrom || b.od_koho,
                        returnDueDate: b.returnDueDate || b.returnDate,
                        ownershipStatus: 'borrowedByMe',
                        location: 'Půjčená literatura',
                        coverImage: b.coverImage,
                        readingStatus: b.readingStatus || 'unread',
                        is_favorite: !!b.is_favorite,
                        addedAt: b.addedAt || new Date().toISOString()
                    };
                    migrateBookToNewFields(book);
                    library.push(book);
                });
                external_loans = [];
                saveLibrary(); // Uložit migrovaná data
            } else if (Array.isArray(data.external_loans)) {
                external_loans = data.external_loans;
            }
            if (Array.isArray(data.wishlist)) wishlist = data.wishlist;
            if (Array.isArray(data.familyProfiles)) familyProfiles = data.familyProfiles;
            if (data.currentProfileId) currentProfileId = data.currentProfileId;
            ensureBookIds();
            library.forEach(migrateBookToNewFields);
            console.log('Omshelf: Načítaná knihovna, počet kníh: ' + library.length + '. Labely a tagy sa zobrazia na kartách.');
        } catch (e) {
            console.warn('Omshelf: could not load from localStorage', e);
        }
    }

    function estimateDataUrlBytes(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return 0;
        if (dataUrl.indexOf('data:') !== 0) return dataUrl.length;
        var idx = dataUrl.indexOf(',');
        if (idx === -1) return dataUrl.length;
        var b64 = dataUrl.slice(idx + 1).trim();
        // base64 length -> bytes (approx)
        return Math.floor(b64.length * 3 / 4);
    }

    /**
     * Nouzová jednorázová migrace: zmenší staré obálky, které jsou příliš velké (>100KB),
     * aby se uvolnilo místo v localStorage a předešlo se QuotaExceededError.
     */
    function runOneTimeCoverDownsizeMigration() {
        var MIGRATION_KEY = 'omnishelf_cover_migration_v1_done__' + getUserStorageKey();
        try { if (localStorage.getItem(MIGRATION_KEY) === '1') return Promise.resolve(false); } catch (e) {}
        if (!window.OMNI_LibraryUploadLogic || typeof window.OMNI_LibraryUploadLogic.compressImageDataUrlToJpegDataUrl !== 'function') {
            return Promise.resolve(false);
        }
        var candidates = (library || []).filter(function (b) {
            var img = (b && b.image) ? String(b.image) : '';
            if (img.indexOf('data:image') !== 0) return false;
            return estimateDataUrlBytes(img) > (100 * 1024);
        }).sort(function (a, b) {
            return estimateDataUrlBytes(String(b.image || '')) - estimateDataUrlBytes(String(a.image || ''));
        });

        if (!candidates.length) {
            try { localStorage.setItem(MIGRATION_KEY, '1'); } catch (e2) {}
            return Promise.resolve(false);
        }

        console.warn('Omshelf: Nouzová migrace obálek – zmenšuji ' + candidates.length + ' obálek (>100KB).');

        var idx = 0;
        var anySaved = false;
        function step() {
            if (idx >= candidates.length) {
                if (anySaved) {
                    try { localStorage.setItem(MIGRATION_KEY, '1'); } catch (e3) {}
                    if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('slimming');
                }
                return Promise.resolve(anySaved);
            }
            var book = candidates[idx++];
            var beforeBytes = estimateDataUrlBytes(String(book.image || ''));
            return window.OMNI_LibraryUploadLogic.compressImageDataUrlToJpegDataUrl(String(book.image), 300, 0.6).then(function (out) {
                book.image = out;
                var afterBytes = estimateDataUrlBytes(String(out || ''));
                console.log('Omshelf: Cover downsize ' + idx + '/' + candidates.length + ' — ' + beforeBytes + 'B → ' + afterBytes + 'B');
                var ok = saveLibrary();
                if (ok) anySaved = true;
                // Pokud stále quota, pokračuj zmenšovat další
                return step();
            }).catch(function (e) {
                console.warn('Omshelf: Cover downsize selhal', e);
                return step();
            });
        }

        return step().then(function (saved) {
            if (!saved && typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('storageFull');
            return saved;
        });
    }

    function showError(msg, errorMessageEl) {
        if (!errorMessageEl) return;
        errorMessageEl.textContent = msg;
        errorMessageEl.classList.add('show');
        setTimeout(function () { errorMessageEl.classList.remove('show'); }, 6000);
    }

    function showSuccess(msg, successMessageEl) {
        if (!successMessageEl) return;
        successMessageEl.textContent = msg;
        successMessageEl.classList.add('show');
        setTimeout(function () { successMessageEl.classList.remove('show'); }, 4000);
    }

    function hideMessages(errorMessageEl, successMessageEl) {
        if (errorMessageEl) errorMessageEl.classList.remove('show');
        if (successMessageEl) successMessageEl.classList.remove('show');
    }

    var COVER_MAX_WIDTH = 400;
    var COVER_STORE_MAX_WIDTH = (window.OMNI_LibraryUploadLogic && window.OMNI_LibraryUploadLogic.DEFAULT_STORE_MAX_WIDTH) ? window.OMNI_LibraryUploadLogic.DEFAULT_STORE_MAX_WIDTH : 300;
    var COVER_STORE_JPEG_QUALITY = (window.OMNI_LibraryUploadLogic && window.OMNI_LibraryUploadLogic.DEFAULT_STORE_QUALITY) ? window.OMNI_LibraryUploadLogic.DEFAULT_STORE_QUALITY : 0.6;

    function compressImageFileToJpegDataUrl(file, maxWidth, quality) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.compressImageFileToJpegDataUrl === 'function') {
            return window.OMNI_LibraryUploadLogic.compressImageFileToJpegDataUrl(file, maxWidth, quality);
        }
        return new Promise(function (resolve, reject) {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                reject(new Error('Not an image.'));
                return;
            }
            var reader = new FileReader();
            reader.onerror = reject;
            reader.onload = function () {
                var dataUrl = reader.result;
                var img = new Image();
                img.onerror = function () { reject(new Error('Image load failed.')); };
                img.onload = function () {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    var targetW = w;
                    var targetH = h;
                    var mw = (typeof maxWidth === 'number' && maxWidth > 0) ? maxWidth : COVER_STORE_MAX_WIDTH;
                    if (w > mw) {
                        var scale = mw / w;
                        targetW = mw;
                        targetH = Math.max(1, Math.round(h * scale));
                    }
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(targetW));
                    canvas.height = Math.max(1, Math.round(targetH));
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    try {
                        var q = (typeof quality === 'number') ? quality : COVER_STORE_JPEG_QUALITY;
                        var out = canvas.toDataURL('image/jpeg', q);
                        resolve(out);
                    } catch (e) {
                        // Fallback: return original dataUrl (still better than crashing)
                        resolve(dataUrl);
                    }
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        });
    }

    function fileToBase64(file) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.fileToBase64ForAi === 'function') {
            return window.OMNI_LibraryUploadLogic.fileToBase64ForAi(file, COVER_MAX_WIDTH);
        }
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var dataUrl = reader.result;
                var img = new Image();
                img.onload = function () {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    if (w <= COVER_MAX_WIDTH) {
                        resolve(dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : dataUrl);
                        return;
                    }
                    var scale = COVER_MAX_WIDTH / w;
                    var cw = COVER_MAX_WIDTH;
                    var ch = Math.round(h * scale);
                    var canvas = document.createElement('canvas');
                    canvas.width = cw;
                    canvas.height = ch;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, cw, ch);
                    try {
                        var resized = canvas.toDataURL('image/jpeg', 0.85);
                        resolve(resized.indexOf(',') >= 0 ? resized.split(',')[1] : resized);
                    } catch (e) {
                        resolve(dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : dataUrl);
                    }
                };
                img.onerror = function () { resolve(dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : dataUrl); };
                img.src = dataUrl;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function findLibraryMatch(book) {
        var t = (book.title || '').trim().toLowerCase();
        var a = (book.author || '').trim().toLowerCase();
        if (!t && !a) return null;
        for (var i = 0; i < library.length; i++) {
            var lib = library[i];
            var lt = (lib.title || '').trim().toLowerCase();
            var la = (lib.author || '').trim().toLowerCase();
            if (t && lt && t === lt && (!a || !la || a === la)) return lib;
        }
        return null;
    }

    /**
     * Prohledá rodinnou knihovnu a upozorní na duplicitu (stejná kniha už u někoho z rodiny).
     * book: { title, author?, isbn? } nebo objekt s .id (pak hledáme podle id v knihovně – pro kontrolu před přidáním lépe title+author/isbn).
     * Vrací { duplicate: true, existingBook } nebo { duplicate: false }.
     */
    function checkDuplicate(book) {
        var list = library;
        var title = (book.title || '').trim().toLowerCase();
        var author = (book.author || '').trim().toLowerCase();
        var isbn = (book.isbn || '').trim().replace(/\s/g, '');
        if (!title && !isbn) return { duplicate: false };
        for (var i = 0; i < list.length; i++) {
            var b = list[i];
            var bt = (b.title || '').trim().toLowerCase();
            var ba = (b.author || '').trim().toLowerCase();
            var bisbn = (b.isbn || '').trim().replace(/\s/g, '');
            if (isbn && bisbn && isbn === bisbn) return { duplicate: true, existingBook: b };
            if (title && bt && title === bt && (!author || !ba || author === ba)) return { duplicate: true, existingBook: b };
        }
        return { duplicate: false };
    }

    /**
     * Vrátí Set ID knih, které mají v knihovně duplicitu (stejný název+autor nebo stejné ISBN).
     * Použije se pro zobrazení upozornění a badge na kartách.
     */
    function getDuplicateBookIds(lib) {
        var list = Array.isArray(lib) ? lib : [];
        var keyToIds = {};
        list.forEach(function (b) {
            var id = b.id || '';
            var title = (b.title || '').trim().toLowerCase();
            var author = (b.author || '').trim().toLowerCase();
            var isbn = (b.isbn || '').trim().replace(/\s/g, '');
            var key = isbn ? ('isbn:' + isbn) : (title + '|' + author);
            if (!key || key === '|') return;
            if (!keyToIds[key]) keyToIds[key] = [];
            keyToIds[key].push(id);
        });
        var duplicateIds = {};
        Object.keys(keyToIds).forEach(function (k) {
            var ids = keyToIds[k];
            if (ids.length > 1) ids.forEach(function (id) { duplicateIds[id] = true; });
        });
        return duplicateIds;
    }

    if (typeof window !== 'undefined') {
        window.OMNI_CheckDuplicate = checkDuplicate;
        window.OMNI_setBirthday = setBirthday;
        window.OMNI_getBirthday = getBirthday;
        window.OMNI_setBirthYear = setBirthYear;
        window.OMNI_getBirthYear = getBirthYear;
        window.OMNI_isWishlistBirthdayOpen = isWishlistBirthdayOpen;
        window.OMNI_isWishlistPublicForFamily = isWishlistPublicForFamily;
        window.OMNI_getVoiceTone = getVoiceTone;
        window.OMNI_setVoiceTone = setVoiceTone;
        window.saveLibrary = saveLibrary;
        window.saveToStorage = saveToStorage;
    }

    function getCurrentLibraryView() {
        var activeBtn = document.querySelector('#librarySubmenu .sidebar-submenu-item.active');
        return (activeBtn && activeBtn.getAttribute('data-view')) || 'collection';
    }

    function filterLibraryByView(list, view) {
        if (window.OMNI_LibraryTextLogic && typeof window.OMNI_LibraryTextLogic.filterLibraryByView === 'function') {
            return window.OMNI_LibraryTextLogic.filterLibraryByView(list, view);
        }
        var arr = Array.isArray(list) ? list : [];
        if (!view || view === 'collection') return arr;
        return arr.filter(function (b) {
            var ownership = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
            var ownershipNorm = normalizeStatusForCompare(b.ownershipStatus || b.status || '');
            var reading = (b.readingStatus || '').toLowerCase().replace(/\s/g, '');
            if (!reading && (b.status || '').toLowerCase() === 'reading') reading = 'reading';
            if (view === 'currentlyReading') {
                // V sekci Rozečtené zobrazit pouze aktivní knihy (ne vrácené)
                if (b.returned) return false;
                var loc = ((b.location || '') + ' ' + (b.physicalLocation || '')).toLowerCase().replace(/\s/g, '');
                return reading === 'reading' || loc.indexOf('rozecteneknihy') >= 0 || loc.indexOf('rozectene') >= 0;
            }
            if (view === 'borrowed') return (ownership === 'borrowed' || ownership === 'pujceno' || ownershipNorm === 'borrowed' || ownershipNorm === 'pujceno');
            if (view === 'borrowedByMe') {
                // V sekci "Mám vypůjčeno" zobrazit pouze aktivní knihy (ne vrácené)
                return ownership === 'borrowedbyme' && !b.returned;
            }
            if (view === 'wishlist') return ownership === 'wishlist';
            if (view === 'forSale') return (ownership === 'forsale' || ownership === 'daruji' || ownership === 'vymena');
            if (view === 'favorites') return !!(b.is_favorite || b.isFavorite);
            return true;
        });
    }

    /** Normalizace řetězce pro porovnání statusu (bez diakritiky: Půjčeno → pujceno). */
    function normalizeStatusForCompare(str) {
        if (window.OMNI_LibraryTextLogic && typeof window.OMNI_LibraryTextLogic.normalizeStatusForCompare === 'function') {
            return window.OMNI_LibraryTextLogic.normalizeStatusForCompare(str);
        }
        if (str == null || typeof str !== 'string') return '';
        var s = str.toLowerCase().replace(/\s/g, '');
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    /** Pro sekci „Půjčil/a jsem“: striktně jen knihy se statusem pujceno/borrowed (včetně Půjčeno), bez dalších filtrů. */
    function getBorrowedBooksList(lib) {
        var arr = Array.isArray(lib) ? lib : [];
        var borrowedBooks = arr.filter(function (b) {
            var s = (b.status || b.ownershipStatus || b.ownership_status || '').toString().toLowerCase().replace(/\s/g, '');
            var o = (b.ownershipStatus || b.ownership_status || b.status || '').toString().toLowerCase().replace(/\s/g, '');
            var sNorm = normalizeStatusForCompare(String(b.status || b.ownershipStatus || ''));
            var oNorm = normalizeStatusForCompare(String(b.ownershipStatus || b.ownership_status || b.status || ''));
            return s === 'borrowed' || s === 'pujceno' || o === 'borrowed' || o === 'pujceno' || sNorm === 'borrowed' || sNorm === 'pujceno' || oNorm === 'borrowed' || oNorm === 'pujceno';
        });
        if (typeof console !== 'undefined' && console.log) console.log('Nalezené půjčené knihy:', borrowedBooks.length, borrowedBooks);
        return borrowedBooks;
    }

    function parseReturnDueDate(val) {
        if (!val || typeof val !== 'string') return null;
        var trimmed = val.trim();
        if (!trimmed) return null;
        var d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d;
    }

    function isDueSoonOrOverdue(returnDueDateStr) {
        var d = parseReturnDueDate(returnDueDateStr);
        if (!d) return { soon: false, overdue: false };
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var end = new Date(today);
        end.setDate(end.getDate() + 3);
        d.setHours(0, 0, 0, 0);
        var overdue = d <= today;
        var soon = !overdue && d <= end;
        return { soon: soon, overdue: overdue };
    }

    function daysUntilReturn(returnDueDateStr) {
        var d = parseReturnDueDate(returnDueDateStr);
        if (!d) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.ceil((d - today) / (24 * 60 * 60 * 1000));
    }

    function getLibrarySearchQuery() {
        var el = document.getElementById('librarySearchInput');
        return (el && el.value) ? el.value.trim().toLowerCase() : '';
    }

    /** Sekce Půjčil/a jsem – samostatná funkce podle vzoru. */
    function renderBorrowedSection(books) {
        console.log('Spouštím renderBorrowedSection');
        console.log('Celkový seznam knih:', books);
        var borrowedBooks = (books || []).filter(function (b) {
            var s = (b.status || '').toString();
            var o = (b.ownershipStatus || b.ownership_status || '').toString();
            return s === 'pujceno' || s === 'půjčeno' || s === 'borrowed' || s.toLowerCase() === 'pujceno' || o === 'borrowed' || o === 'pujceno' || o === 'půjčeno';
        });
        console.log('Nalezené půjčené knihy:', borrowedBooks);

        var container = document.getElementById('pujceno-container');
        if (!container) {
            console.error('CHYBA: Nenalezen kontejner pro půjčené knihy!');
            return;
        }
        container.innerHTML = '';

        var emptyState = document.getElementById('emptyState');
        var scanHistoryGrid = document.getElementById('scanHistoryGrid');
        if (emptyState) emptyState.style.display = 'none';
        if (scanHistoryGrid) scanHistoryGrid.style.display = 'none';
        container.style.display = 'block';

        if (borrowedBooks.length === 0) {
            container.innerHTML = '<div class="empty-state-message" style="text-align: center; padding: 40px; color: #666;">' +
                '<h3>Super, všechny knihy jsou doma! 🏠</h3>' +
                '<p>Žádná se nikde netoulá.</p>' +
                '</div>';
        } else {
            var today = new Date().toISOString().split('T')[0];
            borrowedBooks.forEach(function (book) {
                var datumVraceni = book.returnDueDate || book.datum_vraceni || '';
                var isOverdue = datumVraceni && datumVraceni < today;
                var cardStyle = isOverdue ? 'border: 2px solid #ff4d4d; background-color: #fff0f0;' : '';
                var nazev = escapeHtml(book.title || book.nazev || '—');
                var autor = escapeHtml(book.author || book.autor || '—');
                var obal = (book.image || book.coverImage || book.obal || '').toString().trim();
                var obalSrc = obal ? ('src="' + (obal.indexOf('data:image') === 0 ? obal : ('data:image/jpeg;base64,' + obal)).replace(/"/g, '&quot;') + '"') : '';
                var pujcenoKomu = escapeHtml(book.borrowedTo || book.pujceno_komu || '—');
                var datumStr = datumVraceni ? escapeHtml(datumVraceni) : '—';
                var bookId = book.id || generateBookId();
                if (!book.id) book.id = bookId;
                var cardHTML = '<div class="book-card borrowed-card" data-book-id="' + bookId + '" style="' + cardStyle + '">' +
                    '<div class="card-content">' +
                    (obal ? '<img ' + obalSrc + ' alt="' + nazev + '" class="book-cover borrowed-cover-clickable" data-book-id="' + bookId + '">' : '<div class="book-cover-placeholder borrowed-cover-clickable" data-book-id="' + bookId + '">Klikni pro přidání obalu</div>') +
                    '<div class="book-info">' +
                    '<h4>' + nazev + '</h4>' +
                    '<p class="author">' + autor + '</p>' +
                    '<div class="loan-details">' +
                    '<p><strong>Půjčeno:</strong> ' + pujcenoKomu + '</p>' +
                    '<p><strong>Vrátit do:</strong> ' + datumStr + '</p>' +
                    '<p class="status-text" style="color: #d9534f; font-weight: bold;">Kniha je mimo domov</p>' +
                    '</div></div></div>' +
                    '<div class="book-chat-section"><p class="chat-placeholder">Zde bude komunikace k této knize...</p></div>' +
                    '</div>';
                container.innerHTML += cardHTML;
            });
            // Přidat event listenery pro klikací fotky
            container.querySelectorAll('.borrowed-cover-clickable').forEach(function (el) {
                el.style.cursor = 'pointer';
                el.addEventListener('click', function () {
                    var bid = this.getAttribute('data-book-id');
                    if (bid && typeof openEditModal === 'function') {
                        openEditModal(bid);
                    }
                });
            });
        }
    }

    /** Sekce Mám vypůjčeno – samostatná kolekce external_loans. */
    function renderBorrowedByMeSection() {
        var container = document.getElementById('borrowed-by-me-container');
        var pujcenoContainer = document.getElementById('pujceno-container');
        var emptyState = document.getElementById('emptyState');
        var scanHistoryGrid = document.getElementById('scanHistoryGrid');
        if (pujcenoContainer) pujcenoContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (scanHistoryGrid) scanHistoryGrid.style.display = 'none';
        if (!container) return;
        container.style.display = 'block';
        container.innerHTML = '';

        var books = external_loans || [];
        if (books.length === 0) {
            container.innerHTML = '<div class="empty-state-message borrowed-by-me-empty" style="text-align:center;padding:40px;color:#666;">' +
                '<h3>Skvělé! Všechny cizí knihy jsou vráceny.</h3>' +
                '<p>Nemáte žádné resty.</p>' +
                '</div>';
            return;
        }

        var today = new Date().toISOString().split('T')[0];
        books.forEach(function (book, idx) {
            var datumVraceni = book.returnDueDate || book.returnDate || '';
            var isOverdue = datumVraceni && datumVraceni < today;
            var cardStyle = isOverdue ? 'border: 2px solid #ff4d4d; background-color: #fff0f0;' : '';
            var nazev = escapeHtml(book.title || book.nazev || '—');
            var autor = escapeHtml(book.author || book.autor || '—');
            var odKoho = escapeHtml(book.borrowedFrom || book.od_koho || '—');
            var datumStr = datumVraceni ? escapeHtml(datumVraceni) : '—';
            var obalVal = (book.image || book.coverImage || book.obal || '').toString().trim();
            var obalSrcAttr = obalVal ? ('src="' + (obalVal.indexOf('data:image') === 0 ? obalVal : ('data:image/jpeg;base64,' + obalVal)).replace(/"/g, '&quot;') + '"') : '';
            var cardHTML = '<div class="book-card borrowed-by-me-card" data-idx="' + idx + '" style="' + cardStyle + '">' +
                '<div class="card-content">' +
                (obalSrcAttr ? '<img ' + obalSrcAttr + ' alt="' + nazev + '" class="book-cover">' : '<div class="book-cover-placeholder">Obálka</div>') +
                '<div class="book-info">' +
                '<h4>' + nazev + '</h4>' +
                '<p class="author">' + autor + '</p>' +
                '<div class="loan-details">' +
                '<p><strong>Od koho / Z knihovny:</strong> ' + odKoho + '</p>' +
                '<p><strong>Vrátit do:</strong> ' + datumStr + '</p>' +
                '<p class="status-text" style="color:#d9534f;font-weight:bold;">Kniha je mimo domov</p>' +
                '</div>' +
                '<button type="button" class="btn-return-borrowed" data-idx="' + idx + '">Vrátit</button>' +
                '</div></div></div>';
            container.innerHTML += cardHTML;
        });

        container.querySelectorAll('.btn-return-borrowed').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-idx'), 10);
                if (isNaN(idx) || idx < 0 || idx >= external_loans.length) return;
                external_loans.splice(idx, 1);
                saveLibrary();
                renderBorrowedByMeSection();
                checkBorrowedByMeOverdue();
            });
        });
    }

    function checkBorrowedByMeOverdue() {
        checkLendingStatus();
    }

    /**
     * Označí knihu jako vrácenou a přesune ji do archivu.
     * Místo mazání změní stav na returned: true a přesune na poličku "Co jsem si půjčila a vrátila".
     * Všechny poznámky, recenze a fotky zůstanou zachovány.
     */
    function markBookAsReturned(bookId) {
        var book = library.find(function (b) { return b.id === bookId; });
        if (!book) return;
        
        // Změna stavu na vrácenou
        book.returned = true;
        book.returnedDate = new Date().toISOString();
        book.returnedAt = book.returnedDate;
        
        // Přesun na archivní poličku
        book.location = 'Co jsem si půjčila a vrátila';
        
        // Pokud byla kniha v sekci Rozečtené, odstranit ji z aktivního seznamu
        // ale zachovat readingStatus a currentPage pro archiv
        // (readingStatus zůstane 'reading', ale kniha se už nezobrazí v currentlyReading díky filtru)
        
        // Uložení změn
        saveLibrary();
        
        // Aktualizace zobrazení
        updateScanHistory();
        checkBorrowedByMeOverdue();
    }

    /** AI výtah děje pouze do zadané stránky – ŽÁDNÉ SPOILERY. */
    function requestReadingSummaryUpToPage(bookId, pageNum, title, author, resultEl, btnEl) {
        if (!resultEl || !btnEl) return;
        var openaiKey = getOpenAiKey();
        var hasProxy = global.OMNI_Keys && global.OMNI_Keys.openAiFetch;
        if ((!openaiKey || (openaiKey.trim && !openaiKey.trim())) && !hasProxy) {
            resultEl.textContent = 'Pro výtah potřebuješ nastavit OpenAI API klíč v Nastavení.';
            resultEl.classList.add('has-text', 'is-message');
            resultEl.style.display = 'block';
            return;
        }
        btnEl.disabled = true;
        resultEl.textContent = 'Připravuju výtah…';
        resultEl.classList.remove('is-message');
        resultEl.classList.add('has-text');
        resultEl.style.display = 'block';
        var voiceTone = (typeof getVoiceTone === 'function' ? getVoiceTone() : 'friendly') || 'friendly';
        var toneHint = { friendly: 'Přátelský tón, oslovuj tykáním.', kind: 'Laskavý, vlídný tón, tykej.', funny: 'Lehce vtipný, hravý tón, tykej. Můžeš přidat drobný humor.', motivating: 'Povzbuzující tón, tykej. Povzbuď k další četbě.', serious: 'Střízlivý, věcný tón, tykej.' }[voiceTone] || 'Přátelský tón, tykej.';
        var systemPrompt = 'Jsi vstřícný asistent pro čtenáře. Pravidlo: NESMÍŠ prozradit nic, co se v knize odehrává PO stránce, kterou uživatel zadal. Výtah smí obsahovat pouze děj a události DO A VČETNĚ této stránky. Odpovídej stručně, bodově, v češtině. ' + toneHint;
        var userPrompt = 'Kniha: „' + (title || 'Bez názvu') + '“, autor: ' + (author || 'neznámý') + '.\nUživatel dočetl do stránky ' + pageNum + '. Napiš krátký výtah nejdůležitějších bodů a událostí děje POUZE do stránky ' + pageNum + ' (včetně). Nic za touto stránkou neprozrazuj.';
        var body = {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 600
        };
        var fetcher = hasProxy ? global.OMNI_Keys.openAiFetch(body) : fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
            body: JSON.stringify(body)
        });
        fetcher.then(function (response) {
            if (!response.ok) return response.json().then(function (err) { throw new Error(err.error && err.error.message || response.statusText); });
            return response.json();
        }).then(function (data) {
            var text = (data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '';
            resultEl.textContent = text || 'Výtah se nepodařilo vygenerovat.';
        }).catch(function (err) {
            console.error(err);
            resultEl.textContent = 'Výtah se nepodařilo připravit: ' + (err.message || 'neznámá chyba');
            resultEl.classList.add('is-message');
        }).then(function () {
            btnEl.disabled = false;
        });
    }

    function renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput) {
        var currentView = getCurrentLibraryView();
        var pujcenoContainer = document.getElementById('pujceno-container');
        var borrowedByMeContainer = document.getElementById('borrowed-by-me-container');
        if (currentView === 'borrowed') {
            if (pujcenoContainer) pujcenoContainer.style.display = '';
            if (borrowedByMeContainer) borrowedByMeContainer.style.display = 'none';
            renderBorrowedSection(library);
            return;
        }
        if (currentView === 'borrowedByMe') {
            if (pujcenoContainer) pujcenoContainer.style.display = 'none';
            if (borrowedByMeContainer) borrowedByMeContainer.style.display = 'none';
            checkBorrowedByMeOverdue();
        }
        if (pujcenoContainer) pujcenoContainer.style.display = 'none';
        if (borrowedByMeContainer) borrowedByMeContainer.style.display = 'none';
        if (!scanHistoryGrid) return;
        var searchQuery = getLibrarySearchQuery();
        var publicView = isPublicView();
        var list = filterLibraryByView(library, currentView);
        try {
            var wRes = document.getElementById('wishlistSearchResults');
            if (wRes && currentView !== 'wishlist') { wRes.style.display = 'none'; wRes.innerHTML = ''; }
        } catch (e0) {}
        // Wishlist: při psaní dotazu nabídni výsledky napříč knihovnou (přidat/odebrat)
        if (currentView === 'wishlist') {
            (function () {
                var header = document.getElementById('scanHistoryHeader');
                var wrap = header ? header.querySelector('.scan-history-search-wrap') : null;
                if (!wrap) return;
                var res = document.getElementById('wishlistSearchResults');
                if (!res) {
                    res = document.createElement('div');
                    res.id = 'wishlistSearchResults';
                    res.className = 'wishlist-search-results';
                    wrap.appendChild(res);
                }
                var q = String(searchQuery || '').trim();
                if (!q) { res.style.display = 'none'; res.innerHTML = ''; return; }
                var matches = (library || []).filter(function (b) {
                    if (!b) return false;
                    var t = String((b.title || '')).toLowerCase();
                    var a = String((b.author || '')).toLowerCase();
                    return t.indexOf(q) !== -1 || a.indexOf(q) !== -1;
                }).slice(0, 8);
                res.innerHTML = '';
                if (!matches.length) {
                    var empty = document.createElement('div');
                    empty.className = 'wishlist-search-empty';
                    empty.textContent = 'Nenalezeno. Zkuste upřesnit dotaz.';
                    res.appendChild(empty);
                    res.style.display = 'block';
                    return;
                }
                matches.forEach(function (b) {
                    var row = document.createElement('div');
                    row.className = 'wishlist-search-item';
                    var left = document.createElement('div');
                    left.className = 'wishlist-search-meta';
                    var t = document.createElement('div');
                    t.className = 'wishlist-search-title';
                    t.textContent = b.title || '—';
                    var a = document.createElement('div');
                    a.className = 'wishlist-search-author';
                    a.textContent = b.author || '';
                    left.appendChild(t);
                    left.appendChild(a);
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    var isWish = String((b.ownershipStatus || b.status || '')).toLowerCase().replace(/\s/g, '') === 'wishlist';
                    btn.className = 'wishlist-search-btn' + (isWish ? ' is-active' : '');
                    btn.textContent = isWish ? 'Odebrat' : 'Přidat';
                    btn.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var want = !isWish;
                        if (want) {
                            b.ownershipStatus = 'wishlist';
                            b.status = 'wishlist';
                        } else {
                            // vrátit zpět do sbírky (default mine)
                            b.ownershipStatus = 'mine';
                            b.status = 'mine';
                        }
                        var ok = true;
                        try { ok = saveToStorage(b) !== false; } catch (e0) { ok = false; }
                        if (!ok) {
                            try { if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('storageFull'); } catch (e1) {}
                            return;
                        }
                        refreshGrid();
                    });
                    row.appendChild(left);
                    row.appendChild(btn);
                    res.appendChild(row);
                });
                res.style.display = 'block';
            })();
        }
        var globalMode = parseGlobalMode(getGlobalSortMode());
        // Globální filtry (žánr/stav/favorit) – aplikovat před groupingem
        if (globalMode.kind === 'genre' && globalMode.value) {
            list = list.filter(function (b) { return normalizeForFilter((b.genre || '').trim()) === globalMode.value; });
        } else if (globalMode.kind === 'status') {
            list = list.filter(function (b) {
                var s = getBookStatusNorm(b);
                if (globalMode.value === 'wishlist') return s === 'wishlist';
                if (globalMode.value === 'borrowed') return (s === 'borrowed' || s === 'pujceno' || s === 'borrowedbyme');
                if (globalMode.value === 'borrowedbyme') return s === 'borrowedbyme';
                if (globalMode.value === 'borrowed_lent') return (s === 'borrowed' || s === 'pujceno');
                if (globalMode.value === 'forsale') return s === 'forsale';
                if (globalMode.value === 'sold') return (s === 'sold' || s === 'prodano');
                return true;
            });
        } else if (globalMode.kind === 'favorites') {
            list = list.filter(function (b) { return !!(b.is_favorite || b.isFavorite); });
        } else if (globalMode.kind === 'privacy') {
            list = list.filter(function (b) {
                var p = normalizeForFilter((b && b.privacy) || 'private');
                if (globalMode.value === 'public' || globalMode.value === 'verejna') return p === 'public' || p === 'verejna';
                if (globalMode.value === 'private' || globalMode.value === 'soukroma') return p === 'private' || p === 'soukroma';
                return true;
            });
        }
        // V kolekci zobrazit i vrácené knihy (v archivní poličce "Co jsem si půjčila a vrátila")
        if (currentView === 'collection') {
            var returnedBooks = library.filter(function (b) {
                return b.ownershipStatus === 'borrowedByMe' && b.returned === true;
            });
            // Přidat vrácené knihy do seznamu pro zobrazení v archivní poličce
            returnedBooks.forEach(function (b) {
                if (list.indexOf(b) === -1) list.push(b);
            });
        }
        if (publicView) {
            var shelfNamePub = publicView.shelf;
            list = list.filter(function (book) {
                var loc = (book.location || '').trim() || '— Bez poličky —';
                var priv = (book.privacy || 'private').toLowerCase();
                return loc === shelfNamePub && priv === 'public';
            });
        }
        var byShelf = {};
        var shelfNames;
        var viewMode = getLibraryViewMode();
        if (currentView === 'currentlyReading') {
            // Rozečteno: 2 poličky – aktuálně čtu + historie dočtených
            function isReadingNow(b) {
                if (!b || b.returned) return false;
                var r = (b.readingStatus || '').toString().toLowerCase().replace(/\s/g, '');
                var s = (b.status || '').toString().toLowerCase().replace(/\s/g, '');
                var loc = ((b.location || '') + ' ' + (b.physicalLocation || '')).toLowerCase().replace(/\s/g, '');
                return r === 'reading' || s === 'reading' || loc.indexOf('rozecteneknihy') >= 0 || loc.indexOf('rozectene') >= 0;
            }
            function isReadDone(b) {
                if (!b) return false;
                var r = (b.readingStatus || '').toString().toLowerCase().replace(/\s/g, '');
                var s = (b.status || '').toString().toLowerCase().replace(/\s/g, '');
                return r === 'read' || s === 'read';
            }
            var shelfReading = 'Rozečtené knihy';
            var shelfRead = 'Historie přečtených knih';
            byShelf = {};
            byShelf[shelfReading] = library.filter(isReadingNow);
            byShelf[shelfRead] = library.filter(isReadDone);
            shelfNames = [shelfReading, shelfRead].filter(function (n) { return (byShelf[n] || []).length > 0; });
            viewMode = 'reading';
        } else if (currentView === 'favorites') {
            // Virtuální polička pro Srdcovky – bez reálného členění podle místností
            var favShelfName = 'Moje srdcovky';
            byShelf = {};
            byShelf[favShelfName] = list.slice();
            shelfNames = [favShelfName];
            viewMode = 'favorites';
        } else if (currentView === 'wishlist') {
            // Wishlist: virtuální polička "Polička přání"
            var wishShelfName = 'Polička přání';
            byShelf = {};
            byShelf[wishShelfName] = list.slice();
            shelfNames = [wishShelfName];
            viewMode = 'wishlist';
        } else if (currentView === 'forSale') {
            // Na prodej: virtuální polička "Police na tržišti"
            var saleShelfName = 'Police na tržišti';
            byShelf = {};
            byShelf[saleShelfName] = list.slice();
            shelfNames = [saleShelfName];
            viewMode = 'forSale';
        } else if (viewMode === 'smart') {
            list.forEach(function (book) {
                var groupName = (book.genre || 'Bez žánru').trim() || 'Bez žánru';
                if (!byShelf[groupName]) byShelf[groupName] = [];
                byShelf[groupName].push(book);
            });
            shelfNames = Object.keys(byShelf).sort(function (a, b) {
                if (a === 'Bez žánru') return 1;
                if (b === 'Bez žánru') return -1;
                return a.localeCompare(b, 'cs');
            });
            shelfNames.forEach(function (g) { byShelf[g] = sortBooksBy(byShelf[g], 'genre'); });
        } else {
            var SHELF_ALL_LIBRARY = 'Moje knihovna';
            var SHELF_BORROWED_BY_ME = 'Co mám doma půjčeného - Potřebné vrátit';
            var SHELF_BORROWED_LENT = 'Mé knihy u přátel polici';
            byShelf[SHELF_ALL_LIBRARY] = list.slice();
            list.forEach(function (book) {
                var s = getBookStatusNorm(book);
                var shelfName;
                if (book.returned && s === 'borrowedbyme') {
                    shelfName = 'Co jsem si půjčila a vrátila';
                } else if (s === 'borrowedbyme' && !book.returned) {
                    shelfName = SHELF_BORROWED_BY_ME;
                } else if (s === 'borrowed' || s === 'pujceno') {
                    shelfName = SHELF_BORROWED_LENT;
                } else {
                    shelfName = getShelfKey(book);
                }
                if (!byShelf[shelfName]) byShelf[shelfName] = [];
                byShelf[shelfName].push(book);
            });
            var physicalOrder = Object.keys(byShelf).filter(function (k) {
                return k !== SHELF_ALL_LIBRARY && k !== SHELF_BORROWED_BY_ME && k !== SHELF_BORROWED_LENT;
            }).sort(function (a, b) {
                if (a === '— Bez poličky —') return 1;
                if (b === '— Bez poličky —') return -1;
                return a.localeCompare(b);
            });
            shelfNames = [SHELF_ALL_LIBRARY].concat(physicalOrder);
            if ((byShelf[SHELF_BORROWED_BY_ME] || []).length > 0) shelfNames.push(SHELF_BORROWED_BY_ME);
            if ((byShelf[SHELF_BORROWED_LENT] || []).length > 0) shelfNames.push(SHELF_BORROWED_LENT);
        }
        if (shelfNames.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                var msg = emptyState.querySelector('p');
                var iconEl = emptyState.querySelector('.empty-state-icon');
                if (msg) {
                    var borrowedMsgs = ['Super, všechny knihy jsou doma! Žádná se nikde netoulá.', 'Tvoje knihovna je kompletní. Nikdo ti nic nedluží!'];
                    var messages = { wishlist: 'V sekci Wishlist nemáte žádné knihy.', forSale: 'V sekci Na prodej nemáte žádné knihy.', borrowed: borrowedMsgs[borrowedEmptyMsgIndex % 2], borrowedByMe: 'Skvělé! Všechny cizí knihy jsou vráceny. Nemáte žádné resty.', currentlyReading: 'Přidej rozečtenou knihu a sleduj svůj pokrok!', favorites: 'Zatím tu nic není. Rozdej pár srdíček ♥ knihám, které tě chytily za srdce…' };
                    msg.textContent = messages[currentView] || 'Naskenované knihy se zobrazí zde.';
                    if (currentView === 'borrowed') borrowedEmptyMsgIndex++;
                }
                if (iconEl) iconEl.textContent = (currentView === 'borrowed') ? '\uD83C\uDFE0' : (currentView === 'favorites') ? '\u2665' : '\uD83D\uDCD6';
            }
            scanHistoryGrid.style.display = 'none';
            scanHistoryGrid.classList.remove('shelf-list-container');
            scanHistoryGrid.innerHTML = '';
            return;
        }
        if (emptyState) {
            emptyState.style.display = 'none';
            var iconReset = emptyState.querySelector('.empty-state-icon');
            if (iconReset) iconReset.textContent = '\uD83D\uDCD6';
        }
        scanHistoryGrid.style.display = 'block';
        scanHistoryGrid.classList.add('shelf-list-container');
        scanHistoryGrid.innerHTML = '';
        var duplicateIds = (currentView === 'collection' && !publicView) ? getDuplicateBookIds(library) : {};
        var duplicateCount = Object.keys(duplicateIds).length;
        var hasSelection = Object.keys(selectedBookIds).length > 0;
        if (!publicView && hasSelection && currentView !== 'favorites' && currentView !== 'wishlist' && currentView !== 'forSale') {
            var bulkBar = document.createElement('div');
            bulkBar.className = 'shelf-bulk-bar';
            var count = Object.keys(selectedBookIds).length;
            bulkBar.innerHTML = '<span class="shelf-bulk-label">Vybráno: ' + count + ' ' + (count === 1 ? 'kniha' : count < 5 ? 'knihy' : 'knih') + '</span>';
            var bulkSelect = document.createElement('select');
            bulkSelect.className = 'shelf-bulk-select';
            bulkSelect.innerHTML = '<option value="">Hromadný přesun do...</option>';
            var virtualShelfNames = { 'Moje knihovna': true, 'Co mám doma půjčeného - Potřebné vrátit': true, 'Mé knihy u přátel polici': true };
            shelfNames.forEach(function (sn) {
                if (virtualShelfNames[sn]) return;
                bulkSelect.appendChild(document.createElement('option')).value = sn; (bulkSelect.lastChild).textContent = sn;
            });
            var bulkBtn = document.createElement('button');
            bulkBtn.type = 'button';
            bulkBtn.className = 'shelf-bulk-clear';
            bulkBtn.textContent = 'Zrušit výběr';
            bulkBar.appendChild(bulkSelect);
            bulkBar.appendChild(bulkBtn);
            bulkSelect.addEventListener('change', function () {
                var target = bulkSelect.value;
                if (!target) return;
                library.forEach(function (b) {
                    if (selectedBookIds[b.id]) {
                        b.location = target;
                        b.physicalLocation = target;
                        delete selectedBookIds[b.id];
                    }
                });
                saveToStorage();
                bulkSelect.value = '';
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            });
            bulkBtn.addEventListener('click', function () {
                selectedBookIds = {};
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            });
            scanHistoryGrid.appendChild(bulkBar);
        }
        if (duplicateCount > 0) {
            var duplicateWarnBar = document.createElement('div');
            duplicateWarnBar.className = 'library-duplicate-warning-bar';
            duplicateWarnBar.setAttribute('role', 'alert');
            duplicateWarnBar.innerHTML = '⚠️ Upozornění: V knihovně máte <strong>' + duplicateCount + '</strong> knih, které se objevují vícekrát (stejný název/autor nebo ISBN). Zkontrolujte karty označené „Možná duplicita“.';
            scanHistoryGrid.appendChild(duplicateWarnBar);
        }
        // Defaultně zobraz sbalené police + per-shelf persistence
        var accState = getShelfAccordionState();
        function getShelfKeyForState(name) { return viewMode + '::' + String(name || ''); }
        function getCountLabel(n) {
            if (n === 1) return '1 kniha';
            if (n >= 2 && n <= 4) return n + ' knihy';
            return n + ' knih';
        }

        // Aktualizuj text "Zobrazeno: ..."
        try {
            var summary = getFilterSummaryText(globalMode);
            var sumTop = document.getElementById('libraryFilterSummaryTop');
            var sumHeader = document.getElementById('libraryFilterSummaryHeader');
            if (sumTop) sumTop.textContent = summary;
            if (sumHeader) sumHeader.textContent = summary;
        } catch (eSum) {}

        shelfNames.forEach(function (shelfName) {
            var allBooksOnShelf = byShelf[shelfName] || [];
            var visibilityFilter = publicView ? 'public' : (getShelfVisibilityFilter()[shelfName] || 'all');
            var favoritesFilter = getShelfFavoritesFilter()[shelfName] || 'all';
            // Řazení: buď globální sort (author/genre/status/privacy), nebo per-shelf
            var sortBy = (globalMode.kind === 'sort' && globalMode.value) ? globalMode.value : (getShelfSort()[shelfName] || 'author');
            if (currentView === 'favorites' || currentView === 'wishlist' || currentView === 'forSale') sortBy = (globalMode.kind === 'sort' && globalMode.value) ? globalMode.value : 'author';
            var books = sortBooksBy(allBooksOnShelf, sortBy);
            if (favoritesFilter === 'favorites' && currentView !== 'borrowed') books = books.filter(function (b) { return !!b.is_favorite; });
            var group = document.createElement('div');
            group.className = 'shelf-group';
            group.setAttribute('data-shelf-name', shelfName);
            if (shelfName === 'Co mám doma půjčeného - Potřebné vrátit') group.classList.add('shelf-group--virtual-borrowed-by-me');
            else if (shelfName === 'Mé knihy u přátel polici') group.classList.add('shelf-group--virtual-lent');
            var isVirtualOrAllShelf = (shelfName === 'Moje knihovna' || shelfName === 'Co mám doma půjčeného - Potřebné vrátit' || shelfName === 'Mé knihy u přátel polici');
            var header = null;
            if (currentView !== 'borrowed') {
            header = document.createElement('div');
            header.className = 'shelf-group-header shelf-bar';
            var barLeft = document.createElement('div');
            barLeft.className = 'shelf-bar-left';
            var shelfIconHtml = '<span class="shelf-group-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h8"/></svg></span>';
            if (currentView === 'favorites') shelfIconHtml = '<span class="shelf-group-icon" aria-hidden="true">♥</span>';
            if (currentView === 'wishlist') shelfIconHtml = '<span class="shelf-group-icon" aria-hidden="true">🎁</span>';
            barLeft.innerHTML = shelfIconHtml + '<span class="shelf-group-name">' + escapeHtml(shelfName) + '</span><span class="shelf-group-count">' + escapeHtml(getCountLabel(books.length)) + '</span>';
            header.appendChild(barLeft);
            if (currentView !== 'favorites' && currentView !== 'wishlist' && currentView !== 'forSale') {
                var hoverTip = document.createElement('span');
                hoverTip.className = 'shelf-group-hover-tip';
                hoverTip.textContent = books.length ? 'Polička je plná knih' : 'Zatím prázdná polička';
                header.appendChild(hoverTip);
            }
            var barActions = document.createElement('div');
            barActions.className = 'shelf-bar-actions';
            var publicShelves = getPublicShelves();
            var shelfIsPublic = !!(publicShelves[shelfName] && publicShelves[shelfName].token);
            if (currentView === 'favorites' || currentView === 'wishlist' || currentView === 'forSale') {
                // V Srdcovkách nezobrazujeme per-shelf akce (QR / viditelnost / řazení / smazání / sbalit)
                if (currentView === 'favorites') {
                    var bulkToggle = document.createElement('button');
                    bulkToggle.type = 'button';
                    bulkToggle.className = 'btn-shelf-bulk-toggle' + (favoritesBulkSelectMode ? ' is-active' : '');
                    bulkToggle.textContent = favoritesBulkSelectMode ? 'Hotovo' : 'Vybrat více';
                    bulkToggle.setAttribute('aria-label', favoritesBulkSelectMode ? 'Ukončit hromadný výběr' : 'Zapnout hromadný výběr');
                    bulkToggle.addEventListener('click', function (e) {
                        e.stopPropagation();
                        favoritesBulkSelectMode = !favoritesBulkSelectMode;
                        if (!favoritesBulkSelectMode) selectedBookIds = {};
                        renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    });
                    barActions.appendChild(bulkToggle);
                }
                header.appendChild(barActions);
                group.appendChild(header);
            } else {
            var minimalReadingActions = currentView === 'currentlyReading';
            if (!publicView) {
                if (!minimalReadingActions) {
                var qrBtn = document.createElement('button');
                qrBtn.type = 'button';
                qrBtn.className = 'btn-shelf-qr';
                qrBtn.textContent = 'Generovat QR kód';
                barActions.appendChild(qrBtn);
                }
            }
            if (!publicView && !isVirtualOrAllShelf) {
                if (!minimalReadingActions) {
                var visibilityBtn = document.createElement('button');
                visibilityBtn.type = 'button';
                visibilityBtn.className = 'btn-shelf-visibility';
                var cycleStates = ['all', 'private', 'family', 'public'];
                var labels = { all: 'Všechny', private: '🔒 Soukromá', family: '👥 Rodina', public: '🌐 Veřejná' };
                var ariaLabels = { all: 'Zobrazit všechny knihy', private: 'Zobrazit pouze soukromé knihy', family: 'Zobrazit knihy pro rodinu', public: 'Zobrazit veřejné knihy' };
                function updateVisibilityButton() {
                    var current = getShelfVisibilityFilter()[shelfName] || 'all';
                    visibilityBtn.className = 'btn-shelf-visibility btn-shelf-visibility--' + (current === 'all' ? 'all' : current);
                    visibilityBtn.innerHTML = '<span class="btn-shelf-visibility-icon">' + (current === 'all' ? '📚' : current === 'private' ? '🔒' : current === 'family' ? '👥' : '🌐') + '</span> ' + (labels[current] || 'Všechny');
                    visibilityBtn.setAttribute('aria-label', ariaLabels[current] || 'Filtr');
                }
                updateVisibilityButton();
                barActions.appendChild(visibilityBtn);
                visibilityBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var current = getShelfVisibilityFilter()[shelfName] || 'all';
                    var idx = cycleStates.indexOf(current);
                    var next = cycleStates[(idx + 1) % 4];
                    setShelfVisibilityFilter(shelfName, next);
                    updateVisibilityButton();
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                });
                }
            }
            if (!publicView && !isVirtualOrAllShelf) {
                if (!minimalReadingActions) {
                var favFilter = getShelfFavoritesFilter()[shelfName] || 'all';
                var favoritesBtn = document.createElement('button');
                favoritesBtn.type = 'button';
                favoritesBtn.className = 'btn-shelf-favorites' + (favFilter === 'favorites' ? ' is-active' : '');
                favoritesBtn.setAttribute('aria-label', favFilter === 'favorites' ? 'Zobrazit všechny knihy' : 'Zobrazit pouze oblíbené');
                favoritesBtn.innerHTML = '<span class="btn-shelf-favorites-icon">' + (favFilter === 'favorites' ? '♥' : '♡') + '</span> Oblíbené';
                favoritesBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var next = favFilter === 'favorites' ? 'all' : 'favorites';
                    setShelfFavoritesFilter(shelfName, next);
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                });
                barActions.appendChild(favoritesBtn);
                }
            }
            if (!publicView && !isVirtualOrAllShelf) {
                if (!minimalReadingActions) {
                var gearBtn = document.createElement('button');
                gearBtn.type = 'button';
                gearBtn.className = 'btn-shelf-gear';
                gearBtn.setAttribute('aria-label', 'Nastavení police');
                gearBtn.textContent = '⚙️';
                barActions.appendChild(gearBtn);
                gearBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openShelfSettingsModal(shelfName, emptyState, scanHistoryGrid, shelfNameInput);
                });
                }
            }
            if (!publicView && !isVirtualOrAllShelf) {
                if (!minimalReadingActions) {
                var sortSelect = document.createElement('select');
                sortSelect.className = 'shelf-sort-select';
                sortSelect.setAttribute('aria-label', 'Seřadit podle');
                sortSelect.innerHTML =
                    '<option value="author"' + (sortBy === 'author' ? ' selected' : '') + '>Autor A–Z</option>' +
                    '<option value="author_desc"' + (sortBy === 'author_desc' ? ' selected' : '') + '>Autor Z–A</option>' +
                    '<option value="title"' + (sortBy === 'title' ? ' selected' : '') + '>Titul A–Z</option>' +
                    '<option value="title_desc"' + (sortBy === 'title_desc' ? ' selected' : '') + '>Titul Z–A</option>' +
                    '<option value="genre"' + (sortBy === 'genre' ? ' selected' : '') + '>Žánr</option>' +
                    '<option value="added"' + (sortBy === 'added' ? ' selected' : '') + '>Datum přidání</option>' +
                    '<option value="owner"' + (sortBy === 'owner' ? ' selected' : '') + '>Majitel</option>' +
                    '<option value="status"' + (sortBy === 'status' ? ' selected' : '') + '>Stav</option>' +
                    '<option value="privacy"' + (sortBy === 'privacy' ? ' selected' : '') + '>Sdílení</option>';
                barActions.appendChild(sortSelect);
                sortSelect.addEventListener('change', function (e) {
                    e.stopPropagation();
                    var newSort = sortSelect.value;
                    setShelfSort(shelfName, newSort);
                    reorderShelfGridWithFlip(shelfName, newSort, scanHistoryGrid);
                });
                }
            }
            if (!publicView && !isVirtualOrAllShelf) {
                if (!minimalReadingActions) {
                var deleteShelfBtn = document.createElement('button');
                deleteShelfBtn.type = 'button';
                deleteShelfBtn.className = 'btn-shelf-delete shelf-delete-btn';
                deleteShelfBtn.textContent = 'Smazat tuto poličku';
                barActions.appendChild(deleteShelfBtn);
                deleteShelfBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!confirm('Smazat polici „' + shelfName.replace(/"/g, '') + '“? Knihy budou přesunuty do Bez poličky.')) return;
                library.forEach(function (item) {
                    if (getShelfKey(item) === shelfName) { item.location = '— Bez poličky —'; item.physicalLocation = '— Bez poličky —'; }
                });
                setShelfPublic(shelfName, null);
                saveLibrary();
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                });
                }
            }
            header.appendChild(barActions);
            // Wishlist/Srdcovky: bez sbalit/rozbalit (police je vždy otevřená a čistá)
            if (currentView === 'favorites' || currentView === 'wishlist') {
                group.appendChild(header);
            } else {
                var toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'shelf-bar-toggle';
                toggleBtn.setAttribute('aria-label', 'Sbalit / Rozbalit');
                toggleBtn.innerHTML = 'Sbalit / Rozbalit <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;"><path d="M6 9l6 6 6-6"/></svg>';
                header.appendChild(toggleBtn);
                toggleBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    group.classList.toggle('collapsed');
                    header.classList.toggle('collapsed', group.classList.contains('collapsed'));
                    setShelfExpandedState(getShelfKeyForState(shelfName), !group.classList.contains('collapsed'));
                    toggleBtn.innerHTML = group.classList.contains('collapsed') ? 'Rozbalit <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;"><path d="M6 15l6-6 6 6"/></svg>' : 'Sbalit / Rozbalit <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;"><path d="M6 9l6 6 6-6"/></svg>';
                });
                // Klik na celou lištu police také rozbalí/sbalí (UX: když je zbaleno, chci kliknout kamkoli)
                header.addEventListener('click', function (e) {
                    try {
                        if (e && e.target && e.target.closest && (e.target.closest('.shelf-bar-actions') || e.target.closest('.shelf-bar-toggle'))) return;
                    } catch (e0) {}
                    group.classList.toggle('collapsed');
                    header.classList.toggle('collapsed', group.classList.contains('collapsed'));
                    setShelfExpandedState(getShelfKeyForState(shelfName), !group.classList.contains('collapsed'));
                    toggleBtn.innerHTML = group.classList.contains('collapsed') ? 'Rozbalit <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;"><path d="M6 15l6-6 6 6"/></svg>' : 'Sbalit / Rozbalit <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;"><path d="M6 9l6 6 6-6"/></svg>';
                });
                group.appendChild(header);
            }
            }
            }
            // Default: sbalené, pokud nemáme uložený expanded stav
            var expanded = (currentView === 'favorites' || currentView === 'wishlist' || currentView === 'forSale' || currentView === 'currentlyReading') ? true : !!accState[getShelfKeyForState(shelfName)];
            if (!expanded) {
                group.classList.add('collapsed');
                if (header) header.classList.add('collapsed');
            }
            var booksWrap = document.createElement('div');
            booksWrap.className = 'shelf-group-books';
            var grid = document.createElement('div');
            grid.className = 'books-grid';
            var totalBooks = books.length;
            var totalPages = Math.ceil(totalBooks / BOOKS_PER_PAGE) || 1;
            var page = (shelfCurrentPage[shelfName] || 1);
            if (page > totalPages) page = totalPages;
            shelfCurrentPage[shelfName] = page;
            var booksToShow = totalPages > 1 ? books.slice((page - 1) * BOOKS_PER_PAGE, page * BOOKS_PER_PAGE) : books;
            booksToShow.forEach(function (b) {
                var bookId = b.id || generateBookId();
                if (!b.id) b.id = bookId;
                var ownership = (b.ownershipStatus || b.status || 'private').toLowerCase().replace(/\s/g, '');
                var reading = (b.readingStatus || '').toLowerCase().replace(/\s/g, '');
                if (!reading && (b.status || '').toLowerCase() === 'reading') reading = 'reading';
                if (!reading && (b.status || '').toLowerCase() === 'read') reading = 'read';
                var status = ownership || (b.status || 'private').toLowerCase();
                if (status === 'pujceno') status = 'borrowed';
                var dueInfo = isDueSoonOrOverdue(b.returnDueDate);
                var card = document.createElement('div');
                card.className = 'book-card';
                card.setAttribute('data-book-id', bookId);
                // Proklik: celá karta (včetně obálky) otevře detail nastavení
                if (currentView !== 'borrowed') {
                    card.addEventListener('click', function (e) {
                        if (!e) return;
                        if (e.target && e.target.closest && (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea'))) return;
                        if (typeof openEditModal === 'function') openEditModal(bookId);
                    });
                }
                var bookPrivacy = (b.privacy || 'private').toLowerCase();
                var effectiveVisibility = (currentView === 'borrowed') ? 'all' : visibilityFilter;
                if (effectiveVisibility !== 'all' && bookPrivacy !== effectiveVisibility) card.classList.add('ghosted'); else card.classList.add('focus-match');
                if (searchQuery) {
                    var title = ((b.title || '').trim()).toLowerCase();
                    var author = ((b.author || '').trim()).toLowerCase();
                    var matchesSearch = title.indexOf(searchQuery) !== -1 || author.indexOf(searchQuery) !== -1;
                    // Wishlist: dotaz slouží pro vyhledání napříč knihovnou, ne pro šednutí karet
                    if (currentView !== 'wishlist') {
                        if (!matchesSearch) card.classList.add('search-no-match');
                    }
                }
                if (duplicateIds[bookId]) card.classList.add('book-card--possible-duplicate');
                if (currentView === 'borrowed' && (status === 'borrowed' || status === 'borrowedbyme') && dueInfo.overdue) card.classList.add('book-card--overdue');
                if (currentView === 'borrowed') card.classList.add('book-card--borrowed-view');
                if (status === 'borrowedbyme') card.classList.add('book-card--borrowed-by-me');
                var coverWrap = document.createElement('div');
                coverWrap.className = 'book-card-cover-wrap';
                var coverFrame = document.createElement('div');
                coverFrame.className = 'book-card-cover-frame';
                var coverValue = (b.image || b.coverImage || b.obal || '').toString().trim();
                if (!publicView) {
                    var coverActions = document.createElement('div');
                    coverActions.className = 'book-card-cover-actions';
                    // Srdíčko (oblíbené) – dle nákresu vrátit, ikonku "na prodej" odstranit
                    var isFavorite = !!(b.is_favorite || b.isFavorite);
                    var heartBtn = document.createElement('button');
                    heartBtn.type = 'button';
                    heartBtn.className = 'book-card-cover-btn book-card-cover-favorite' + (isFavorite ? ' is-active' : '');
                    heartBtn.setAttribute('aria-label', isFavorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
                    heartBtn.innerHTML = isFavorite ? '♥' : '♡';
                    heartBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var book = library.find(function (x) { return x.id === bookId; });
                        if (book) {
                            // Okamžitá vizuální odezva (bez čekání na re-render)
                            var wasFav = !!(book.is_favorite || book.isFavorite);
                            var nextFav = !wasFav;
                            book.is_favorite = nextFav;
                            book.isFavorite = nextFav;
                            heartBtn.classList.toggle('is-active', nextFav);
                            heartBtn.innerHTML = nextFav ? '♥' : '♡';
                            heartBtn.setAttribute('aria-label', nextFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');

                            var ok = true;
                            try { ok = saveToStorage(book) !== false; } catch (e0) { ok = false; }
                            if (!ok) {
                                // rollback UI i dat při neúspěchu uložení
                                book.is_favorite = wasFav;
                                book.isFavorite = wasFav;
                                heartBtn.classList.toggle('is-active', wasFav);
                                heartBtn.innerHTML = wasFav ? '♥' : '♡';
                                heartBtn.setAttribute('aria-label', wasFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených');
                                try { if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('storageFull'); } catch (e1) {}
                                return;
                            }
                            refreshGrid();
                        }
                    });
                    coverActions.appendChild(heartBtn);
                    coverWrap.appendChild(coverActions);
                }
                if (coverValue) {
                    var coverSrc = (coverValue.indexOf('data:image') === 0) ? coverValue : ('data:image/jpeg;base64,' + coverValue);
                    var coverImg = document.createElement('img');
                    coverImg.src = coverSrc;
                    coverImg.alt = escapeHtml(b.title || '');
                    coverImg.className = 'book-card-cover-img';
                    coverImg.onerror = function () {
                        this.style.display = 'none';
                        var ph = this.parentElement;
                        if (ph) {
                            try { card.classList.add('no-cover'); } catch (e0) {}
                            try { coverFrame.classList.add('no-cover'); } catch (e1) {}
                            var placeholderImg = document.createElement('img');
                            placeholderImg.src = DEFAULT_BOOK_PLACEHOLDER;
                            placeholderImg.alt = 'Žádná obálka';
                            placeholderImg.className = 'book-card-cover-img book-card-cover-img--placeholder';
                            ph.appendChild(placeholderImg);
                            var lbl = document.createElement('div');
                            lbl.className = 'book-card-cover-placeholder-label';
                            lbl.textContent = 'Žádná obálka';
                            ph.appendChild(lbl);
                        }
                    };
                    coverFrame.appendChild(coverImg);
                } else {
                    try { card.classList.add('no-cover'); } catch (e2) {}
                    try { coverFrame.classList.add('no-cover'); } catch (e3) {}
                    var placeholderImg2 = document.createElement('img');
                    placeholderImg2.src = DEFAULT_BOOK_PLACEHOLDER;
                    placeholderImg2.alt = 'Žádná obálka';
                    placeholderImg2.className = 'book-card-cover-img book-card-cover-img--placeholder';
                    coverFrame.appendChild(placeholderImg2);
                    var lbl2 = document.createElement('div');
                    lbl2.className = 'book-card-cover-placeholder-label';
                    lbl2.textContent = 'Žádná obálka';
                    coverFrame.appendChild(lbl2);
                }
                coverWrap.appendChild(coverFrame);
                if (!publicView && status !== 'borrowedbyme' && !(currentView === 'favorites' && !favoritesBulkSelectMode)) {
                    var cardCheck = document.createElement('input');
                    cardCheck.type = 'checkbox';
                    cardCheck.className = 'book-card-select-checkbox';
                    cardCheck.setAttribute('aria-label', 'Vybrat knihu');
                    cardCheck.checked = !!selectedBookIds[bookId];
                    cardCheck.addEventListener('click', function (e) { e.stopPropagation(); });
                    cardCheck.addEventListener('change', function () {
                        if (cardCheck.checked) selectedBookIds[bookId] = true; else delete selectedBookIds[bookId];
                        renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    });
                    card.appendChild(cardCheck);
                }
                card.appendChild(coverWrap);
                var panel = document.createElement('div');
                panel.className = 'book-card-info-panel';
                var isCollectionView = currentView === 'collection';
                var targetForDetail = panel;
                var detailWrap = null;
                var toggleWrap = null;
                if (isCollectionView) {
                    card.classList.add('book-card--collapsible', 'book-card--collection-minimal');
                    if ((status === 'borrowed' || status === 'borrowedbyme') && dueInfo.overdue) card.classList.add('book-card--collapsible-overdue');
                    var coverOverlay = document.createElement('div');
                    coverOverlay.className = 'book-card-cover-overlay';
                    coverOverlay.innerHTML = '<div class="book-card-overlay-line">ISBN: ' + escapeHtml((b.isbn || '').trim() || '—') + '</div><div class="book-card-overlay-line">Žánr: ' + escapeHtml((b.genre || '').trim() || '—') + '</div><div class="book-card-overlay-line">Kolekce: ' + escapeHtml(((b.collection || b.series || '') + '').trim() || '—') + '</div><div class="book-card-overlay-line">Umístění v polici: ' + escapeHtml((b.position || '').trim() || '—') + '</div>';
                    coverFrame.appendChild(coverOverlay);
                    toggleWrap = document.createElement('button');
                    toggleWrap.type = 'button';
                    toggleWrap.className = 'book-card-toggle-wrap' + ((status === 'borrowed' || status === 'borrowedbyme') && dueInfo.overdue ? ' has-overdue' : '');
                    toggleWrap.setAttribute('aria-label', 'Rozbalit detail');
                    toggleWrap.innerHTML = '<span class="book-card-toggle-chevron">▼</span>';
                    toggleWrap.addEventListener('click', function (e) {
                        e.stopPropagation();
                        card.classList.toggle('expanded');
                        var chev = this.querySelector('.book-card-toggle-chevron');
                        if (chev) chev.textContent = card.classList.contains('expanded') ? '▲' : '▼';
                        this.setAttribute('aria-label', card.classList.contains('expanded') ? 'Sbalit detail' : 'Rozbalit detail');
                    });
                    targetForDetail = null;
                } else {
                    detailWrap = document.createElement('div');
                    detailWrap.className = 'book-card-detail-wrap';
                    targetForDetail = detailWrap;
                }
                var badgesWrap = document.createElement('div');
                badgesWrap.className = 'book-card-badges';
                if (status === 'borrowed' && currentView !== 'borrowed' && currentView !== 'currentlyReading') {
                    var borrowedLabel = document.createElement('span');
                    borrowedLabel.className = 'book-card-badge book-card-badge--borrowed';
                    if (dueInfo.soon || dueInfo.overdue) borrowedLabel.classList.add('book-card-badge--due-soon');
                    var name = escapeHtml((b.borrowedTo || b.owner || '').trim()) || '—';
                    borrowedLabel.innerHTML = '<span class="book-card-badge-icon">' + (dueInfo.soon || dueInfo.overdue ? '⚠️' : '👤') + '</span> Půjčeno: ' + name;
                    badgesWrap.appendChild(borrowedLabel);
                }
                if (status === 'borrowedbyme' && currentView !== 'currentlyReading' && currentView !== 'borrowedByMe' && !b.returned) {
                    var byMeLabel = document.createElement('span');
                    byMeLabel.className = 'book-card-badge book-card-badge--borrowed-by-me';
                    if (dueInfo.soon || dueInfo.overdue) byMeLabel.classList.add('book-card-badge--due-soon');
                    if ((b.returnDueDate || '').trim()) {
                        var dateStr = (b.returnDueDate || '').trim();
                        try {
                            var d = new Date(dateStr);
                            if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: '2-digit' });
                        } catch (e) {}
                        byMeLabel.innerHTML = '<span class="book-card-badge-icon">' + (dueInfo.overdue ? '⚠️' : '📅') + '</span> Vrátit do ' + escapeHtml(dateStr);
                    } else {
                        byMeLabel.innerHTML = '<span class="book-card-badge-icon">👤</span> Mám vypůjčeno';
                    }
                    badgesWrap.appendChild(byMeLabel);
                }
                if (status === 'borrowedbyme' && b.returned) {
                    var returnedBadge = document.createElement('span');
                    returnedBadge.className = 'book-card-badge book-card-badge--returned';
                    var returnedDate = b.returnedDate || b.returnedAt || new Date().toISOString();
                    try {
                        var dReturned = new Date(returnedDate);
                        if (!isNaN(dReturned.getTime())) returnedDate = dReturned.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                    } catch (e) {}
                    returnedBadge.innerHTML = '<span class="book-card-badge-icon">✓</span> Vráceno: ' + escapeHtml(returnedDate);
                    badgesWrap.appendChild(returnedBadge);
                }
                if (status === 'forsale') {
                    var saleLabel = document.createElement('span');
                    saleLabel.className = 'book-card-badge book-card-badge--forsale';
                    saleLabel.innerHTML = '<span class="book-card-badge-icon">🏷️</span> ' + (escapeHtml((b.estimatedValue || '').trim()) || 'Na prodej');
                    badgesWrap.appendChild(saleLabel);
                }
                if (reading === 'reading') {
                    var readingLabel = document.createElement('span');
                    readingLabel.className = 'book-card-badge book-card-badge--reading';
                    readingLabel.innerHTML = '<span class="book-card-badge-icon">📖</span> Rozečtená';
                    badgesWrap.appendChild(readingLabel);
                }
                if (reading === 'read') {
                    var doneLabel = document.createElement('span');
                    doneLabel.className = 'book-card-badge book-card-badge--read';
                    doneLabel.innerHTML = '<span class="book-card-badge-icon">✓</span> Dočteno';
                    badgesWrap.appendChild(doneLabel);
                }
                if (status === 'wishlist') {
                    var wishBadge = document.createElement('span');
                    wishBadge.className = 'book-card-badge book-card-badge--wishlist';
                    wishBadge.innerHTML = '<span class="book-card-badge-icon">❤️</span> Wishlist';
                    wishBadge.setAttribute('aria-label', 'Wishlist');
                    badgesWrap.appendChild(wishBadge);
                }
                if (duplicateIds[bookId]) {
                    var dupBadge = document.createElement('span');
                    dupBadge.className = 'book-card-badge book-card-badge--duplicate';
                    dupBadge.innerHTML = '<span class="book-card-badge-icon">⚠️</span> Možná duplicita';
                    dupBadge.setAttribute('aria-label', 'Kniha se v knihovně objevuje vícekrát');
                    badgesWrap.appendChild(dupBadge);
                }
                if (badgesWrap.childNodes.length) {
                    // V Srdcovkách/Wishlist/Na prodej chceme štítky nahoře (jako na hlavních kartách)
                    if (isCollectionView || currentView === 'favorites' || currentView === 'wishlist' || currentView === 'forSale') {
                        panel.insertBefore(badgesWrap, panel.firstChild);
                    } else if (targetForDetail) {
                        targetForDetail.appendChild(badgesWrap);
                    }
                }
                var header = document.createElement('div');
                header.className = 'book-card-panel-header';
                var titleWrap = document.createElement('div');
                titleWrap.className = 'book-card-title-with-privacy';
                var titleEl = document.createElement('div');
                titleEl.className = 'book-card-title';
                titleEl.textContent = b.title || '—';
                titleWrap.appendChild(titleEl);
                var privacy = (b.privacy || 'private').toLowerCase();
                var privacyIcon = document.createElement('span');
                privacyIcon.className = 'book-card-privacy-icon';
                var privacyLabel = privacy === 'public' ? 'Veřejná' : privacy === 'family' ? 'Rodina' : 'Soukromá';
                privacyIcon.setAttribute('aria-label', privacyLabel);
                privacyIcon.textContent = privacy === 'public' ? '🌐' : privacy === 'family' ? '👥' : '🔒';
                titleWrap.appendChild(privacyIcon);
                header.appendChild(titleWrap);
                panel.appendChild(header);
                var authorEl = document.createElement('div');
                authorEl.className = 'book-card-author';
                authorEl.textContent = b.author || '';
                panel.appendChild(authorEl);

                // V Tvoje sbírka: v akordeonu (po rozbalení) – Smazat knihu a Přesunout / Nová polička
                if (isCollectionView && !publicView) {
                    var accordionActions = document.createElement('div');
                    accordionActions.className = 'book-card-accordion-actions';
                    var delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'book-card-accordion-btn book-card-accordion-btn--delete';
                    delBtn.textContent = 'Smazat knihu';
                    delBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (typeof window.deleteBook === 'function') window.deleteBook(bookId);
                    });
                    var moveWrap = document.createElement('div');
                    moveWrap.className = 'book-card-accordion-move';
                    var moveLabel = document.createElement('label');
                    moveLabel.className = 'book-card-accordion-move-label';
                    moveLabel.textContent = 'Přesunout:';
                    var moveSelect = document.createElement('select');
                    moveSelect.className = 'book-card-accordion-select';
                    moveSelect.innerHTML = '<option value="">— vyberte poličku —</option>';
                    var allShelves = getShelfNamesList().filter(function (sn) { return sn !== shelfName; });
                    allShelves.forEach(function (sn) {
                        var opt = document.createElement('option');
                        opt.value = sn;
                        opt.textContent = sn;
                        moveSelect.appendChild(opt);
                    });
                    var newShelfOpt = document.createElement('option');
                    newShelfOpt.value = '__new__';
                    newShelfOpt.textContent = '➕ Nová polička';
                    moveSelect.appendChild(newShelfOpt);
                    moveLabel.appendChild(moveSelect);
                    moveWrap.appendChild(moveLabel);
                    moveSelect.addEventListener('click', function (e) { e.stopPropagation(); });
                    moveSelect.addEventListener('change', function (e) {
                        e.stopPropagation();
                        var target = moveSelect.value;
                        if (!target) return;
                        if (target === '__new__') {
                            var name = window.prompt('Název nové poličky?', '');
                            if (name && (name = name.trim())) {
                                moveBookToShelf(bookId, name);
                                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                            }
                            moveSelect.value = '';
                            return;
                        }
                        moveBookToShelf(bookId, target);
                        moveSelect.value = '';
                        renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    });
                    accordionActions.appendChild(delBtn);
                    accordionActions.appendChild(moveWrap);
                    panel.appendChild(accordionActions);
                }

                // Na prodej: akce na kartě (bez poznámek z wishlistu)
                if (currentView === 'forSale' && !publicView) {
                    var saleTools = document.createElement('div');
                    saleTools.className = 'book-card-sale-tools';

                    var btnList = document.createElement('button');
                    btnList.type = 'button';
                    btnList.className = 'book-card-sale-btn book-card-sale-btn--market';
                    btnList.textContent = 'Přidat na tržiště';
                    btnList.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            var overlay = document.getElementById('marketplaceModalOverlay');
                            if (overlay) overlay.style.display = 'flex';
                            else {
                                var btn = document.getElementById('btnMarketplace');
                                if (btn) btn.click();
                            }
                        } catch (e0) {}
                    });
                    saleTools.appendChild(btnList);

                    var acc = document.createElement('div');
                    acc.className = 'book-card-sale-acc';
                    var accToggle = document.createElement('button');
                    accToggle.type = 'button';
                    accToggle.className = 'book-card-sale-acc-toggle';
                    accToggle.setAttribute('aria-expanded', 'false');
                    accToggle.innerHTML = '<span>Další akce</span><span class="book-card-sale-acc-chev">▼</span>';
                    var accBody = document.createElement('div');
                    accBody.className = 'book-card-sale-acc-body';
                    accBody.hidden = true;
                    accToggle.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var open = accBody.hidden;
                        accBody.hidden = !open;
                        accToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                        var ch = accToggle.querySelector('.book-card-sale-acc-chev');
                        if (ch) ch.textContent = open ? '▲' : '▼';
                    });

                    var btnSold = document.createElement('button');
                    btnSold.type = 'button';
                    btnSold.className = 'book-card-sale-btn';
                    btnSold.textContent = 'Označit jako prodané';
                    btnSold.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var book = library.find(function (x) { return x.id === bookId; });
                        if (!book) return;
                        book.saleStatus = 'sold';
                        book.soldAt = new Date().toISOString();
                        book.ownershipStatus = 'sold';
                        book.status = 'sold';
                        saveLibrary();
                        refreshGrid();
                    });

                    var btnCancel = document.createElement('button');
                    btnCancel.type = 'button';
                    btnCancel.className = 'book-card-sale-btn book-card-sale-btn--cancel';
                    btnCancel.textContent = 'Zrušit prodej';
                    btnCancel.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var book = library.find(function (x) { return x.id === bookId; });
                        if (!book) return;
                        book.saleStatus = '';
                        book.ownershipStatus = 'mine';
                        book.status = 'mine';
                        saveLibrary();
                        refreshGrid();
                    });

                    accBody.appendChild(btnSold);
                    accBody.appendChild(btnCancel);
                    acc.appendChild(accToggle);
                    acc.appendChild(accBody);
                    saleTools.appendChild(acc);
                    panel.appendChild(saleTools);
                }
                // Srdcovky/Wishlist: poznámky + doporučení (pracovní režim přímo na kartě)
                if ((currentView === 'favorites' || currentView === 'wishlist') && !publicView) {
                    var favTools = document.createElement('div');
                    favTools.className = 'book-card-fav-tools';

                    var noteInput = document.createElement('textarea');
                    noteInput.className = 'book-card-fav-note-input';
                    noteInput.rows = 3;
                    noteInput.placeholder = currentView === 'wishlist'
                        ? 'Poznámka (proč ji chci, co na ní hledám, citát)…'
                        : 'Poznámka (citát, vzpomínka, proč je oblíbená)…';
                    noteInput.addEventListener('click', function (e) { e.stopPropagation(); });

                    var notesList = document.createElement('div');
                    notesList.className = 'book-card-fav-notes';

                    function renderFavNotes(book) {
                        notesList.innerHTML = '';
                        var arr = (book && Array.isArray(currentView === 'wishlist' ? book.wishlistNotes : book.favoriteNotes))
                            ? (currentView === 'wishlist' ? book.wishlistNotes : book.favoriteNotes)
                            : [];
                        if (!arr.length) return;
                        arr.slice(0, 6).forEach(function (n) {
                            var item = document.createElement('div');
                            item.className = 'book-card-fav-note-item';
                            var t = (n && (n.text || n.note)) ? String(n.text || n.note) : String(n || '');
                            item.textContent = t;
                            notesList.appendChild(item);
                        });
                        if (arr.length > 6) {
                            var more = document.createElement('div');
                            more.className = 'book-card-fav-note-more';
                            more.textContent = 'Zobrazeno 6 z ' + arr.length + ' poznámek';
                            notesList.appendChild(more);
                        }
                    }

                    renderFavNotes(b);

                    var actionsRow = document.createElement('div');
                    actionsRow.className = 'book-card-fav-actions';

                    var btnAddNote = document.createElement('button');
                    btnAddNote.type = 'button';
                    btnAddNote.className = 'book-card-fav-btn';
                    btnAddNote.textContent = 'Přidat poznámku';
                    btnAddNote.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var text = String(noteInput.value || '').trim();
                        if (!text) return;
                        var book = library.find(function (x) { return x.id === bookId; });
                        if (!book) return;
                        var key = currentView === 'wishlist' ? 'wishlistNotes' : 'favoriteNotes';
                        if (!Array.isArray(book[key])) book[key] = [];
                        book[key].unshift({ text: text, createdAt: new Date().toISOString() });
                        var ok = true;
                        try { ok = saveToStorage(book) !== false; } catch (e0) { ok = false; }
                        if (!ok) {
                            try { if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('storageFull'); } catch (e1) {}
                            return;
                        }
                        noteInput.value = '';
                        renderFavNotes(book);
                    });

                    var btnRecommend = document.createElement('button');
                    btnRecommend.type = 'button';
                    btnRecommend.className = 'book-card-fav-btn book-card-fav-btn--recommend';
                btnRecommend.textContent = (currentView === 'wishlist') ? 'Najít v Tržišti' : 'Doporučit';
                    btnRecommend.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var book = library.find(function (x) { return x.id === bookId; }) || b;
                    if (currentView === 'wishlist') {
                        var q = ((book.title || '') + ' ' + (book.author || '')).trim();
                        if (!q) q = 'kniha';
                        window.open('https://www.heureka.cz/?h=' + encodeURIComponent(q), '_blank');
                        return;
                    }
                        var latestNote = '';
                        try {
                            var arr = (book && Array.isArray(currentView === 'wishlist' ? book.wishlistNotes : book.favoriteNotes))
                                ? (currentView === 'wishlist' ? book.wishlistNotes : book.favoriteNotes)
                                : [];
                            latestNote = arr && arr[0] && arr[0].text ? String(arr[0].text) : '';
                        } catch (e0) {}
                        var msg = latestNote ? ('Doporučuji: ' + latestNote) : 'Doporučuji tuto knihu.';
                        // Přepni view na Přátelé doporučují
                        try {
                            var btnFriends = document.querySelector('#librarySubmenu .sidebar-submenu-item[data-view=\"friendsHighlights\"]');
                            if (btnFriends) btnFriends.click();
                        } catch (e1) {}
                        // Předvyplň formulář (pokud je modul načtený)
                        setTimeout(function () {
                            try {
                                if (window.OMNI_FriendsRecommendations && typeof window.OMNI_FriendsRecommendations.prefillAdd === 'function') {
                                    window.OMNI_FriendsRecommendations.prefillAdd({
                                        title: book.title || '',
                                        author: book.author || '',
                                        genre: book.genre || '',
                                        message: msg
                                    });
                                }
                            } catch (e2) {}
                        }, 50);
                    });

                    actionsRow.appendChild(btnAddNote);
                    actionsRow.appendChild(btnRecommend);

                    favTools.appendChild(noteInput);
                    favTools.appendChild(actionsRow);
                    favTools.appendChild(notesList);
                    panel.appendChild(favTools);
                }
                if (toggleWrap) panel.appendChild(toggleWrap);
                if (detailWrap) panel.appendChild(detailWrap);
                if (status === 'borrowed' && currentView !== 'currentlyReading' && !isCollectionView && currentView !== 'favorites' && currentView !== 'wishlist') {
                    var primaryWrap = document.createElement('div');
                    primaryWrap.className = 'book-card-borrowed-primary' + (dueInfo.overdue ? ' is-overdue' : '');
                    var nameRaw = ((b.borrowedTo || b.owner || '').trim()) || '—';
                    var nameText = escapeHtml(nameRaw);
                    var line1 = document.createElement('div');
                    line1.className = 'book-card-borrowed-primary-line';
                    var nameSpan = document.createElement('span');
                    nameSpan.className = 'book-card-borrowed-name book-card-borrowed-name-clickable';
                    nameSpan.setAttribute('data-book-id', bookId);
                    nameSpan.setAttribute('data-borrowed-to', nameRaw);
                    nameSpan.textContent = 'Půjčeno: ' + nameRaw;
                    line1.appendChild(nameSpan);
                    primaryWrap.appendChild(line1);
                    if ((b.returnDueDate || '').trim()) {
                        var dateStr = (b.returnDueDate || '').trim();
                        try {
                            var d2 = new Date(dateStr);
                            if (!isNaN(d2.getTime())) dateStr = d2.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                        } catch (e) {}
                        var line2 = document.createElement('div');
                        line2.className = 'book-card-borrowed-primary-line';
                        line2.textContent = 'Vrátit do: ' + dateStr;
                        primaryWrap.appendChild(line2);
                    }
                    var line3 = document.createElement('div');
                    line3.className = 'book-card-borrowed-primary-line';
                    line3.textContent = 'Stav: ' + (escapeHtml((b.borrowedNote || '').trim()) || '—');
                    primaryWrap.appendChild(line3);
                    targetForDetail.appendChild(primaryWrap);
                    var histBtn = document.createElement('button');
                    histBtn.type = 'button';
                    histBtn.className = 'book-card-borrowed-hist-btn';
                    histBtn.textContent = 'Historie';
                    histBtn.setAttribute('data-book-id', bookId);
                    histBtn.addEventListener('click', function (e) { e.stopPropagation(); showBorrowedHistory(this.getAttribute('data-book-id')); });
                    targetForDetail.appendChild(histBtn);
                }
                if (status === 'borrowedbyme' && !isCollectionView && !b.returned) {
                    var fromRaw = ((b.borrowedFrom || b.od_koho || '').trim()) || '—';
                    var lineFrom = document.createElement('div');
                    lineFrom.className = 'book-card-borrowed-primary-line';
                    lineFrom.textContent = 'Půjčeno od: ' + fromRaw;
                    targetForDetail.appendChild(lineFrom);
                    if ((b.returnDueDate || '').trim()) {
                        var dateStrByMe = (b.returnDueDate || '').trim();
                        try {
                            var dByMe = new Date(dateStrByMe);
                            if (!isNaN(dByMe.getTime())) dateStrByMe = dByMe.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                        } catch (e) {}
                        var returnBar = document.createElement('button');
                        returnBar.type = 'button';
                        returnBar.className = 'book-card-return-bar' + (dueInfo.overdue ? ' is-overdue' : '');
                        returnBar.setAttribute('data-book-id', bookId);
                        returnBar.textContent = 'Vrátit do: ' + dateStrByMe;
                        returnBar.addEventListener('click', function (e) {
                            e.stopPropagation();
                            var bid = this.getAttribute('data-book-id');
                            var book = library.find(function (b) { return b.id === bid; });
                            if (!book) return;
                            var title = escapeHtml(book.title || 'kniha');
                            if (confirm('Opravdu chceš označit knihu „' + title + '" jako vrácenou majiteli?')) {
                                markBookAsReturned(bid);
                            }
                        });
                        targetForDetail.appendChild(returnBar);
                    }
                }
                if (status === 'borrowedbyme' && !isCollectionView && b.returned) {
                    var returnedLabel = document.createElement('div');
                    returnedLabel.className = 'book-card-returned-label';
                    var returnedDate = b.returnedDate || b.returnedAt || new Date().toISOString();
                    try {
                        var dReturned = new Date(returnedDate);
                        if (!isNaN(dReturned.getTime())) returnedDate = dReturned.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                    } catch (e) {}
                    returnedLabel.textContent = 'Vráceno: ' + returnedDate;
                    targetForDetail.appendChild(returnedLabel);
                }
                // Srdcovky/Wishlist: karta je čistá (detaily patří do modálu po kliknutí na kartu)
                if (currentView !== 'favorites' && currentView !== 'wishlist') {
                    var dynamicRows = document.createElement('div');
                    dynamicRows.className = 'book-card-dynamic-rows';
                    var hasRows = false;
                    if (status === 'borrowed' && currentView !== 'borrowed' && currentView !== 'currentlyReading') {
                        var nameText = escapeHtml(((b.borrowedTo || b.owner || '').trim()) || '—');
                        var rowPujceno = document.createElement('div');
                        rowPujceno.className = 'book-card-dynamic-row';
                        rowPujceno.textContent = '👤 Půjčeno: ' + nameText;
                        dynamicRows.appendChild(rowPujceno);
                        hasRows = true;
                    }
                    if (status === 'borrowedbyme' && currentView !== 'borrowedByMe' && currentView !== 'collection' && !b.returned) {
                        var fromText = escapeHtml(((b.borrowedFrom || b.od_koho || '').trim()) || '—');
                        var rowOdKoho = document.createElement('div');
                        rowOdKoho.className = 'book-card-dynamic-row book-card-dynamic-row--borrowed-from';
                        rowOdKoho.textContent = 'Půjčeno od: ' + fromText;
                        dynamicRows.appendChild(rowOdKoho);
                        hasRows = true;
                    }
                    if (status === 'borrowed' && (b.returnDueDate || '').trim()) {
                        if (!(status === 'borrowed' && currentView === 'borrowed') && currentView !== 'currentlyReading') {
                            var dateStr = (b.returnDueDate || '').trim();
                            try {
                                var d2 = new Date(dateStr);
                                if (!isNaN(d2.getTime())) dateStr = d2.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                            } catch (e) {}
                            var rowTermin = document.createElement('div');
                            rowTermin.className = 'book-card-dynamic-row';
                            var daysLeft = daysUntilReturn(b.returnDueDate);
                            if (daysLeft !== null && daysLeft <= 2) rowTermin.classList.add('book-card-dynamic-row--urgent');
                            rowTermin.textContent = '📅 Vrátit do: ' + dateStr;
                            dynamicRows.appendChild(rowTermin);
                            hasRows = true;
                        }
                    }
                    if (reading === 'reading' || status === 'reading') {
                        var progress = Math.min(100, Math.max(0, parseInt(b.readingProgress, 10) || 0));
                        var rowStatus = document.createElement('div');
                        rowStatus.className = 'book-card-dynamic-row';
                        rowStatus.textContent = '📖 Status: Rozečteno' + (progress > 0 ? ' (' + progress + '%)' : '');
                        dynamicRows.appendChild(rowStatus);
                        hasRows = true;
                    }
                    if (reading === 'read') {
                        var rowRead = document.createElement('div');
                        rowRead.className = 'book-card-dynamic-row';
                        rowRead.textContent = '📖 Status: Dočteno';
                        dynamicRows.appendChild(rowRead);
                        hasRows = true;
                    }
                    if (status === 'forsale') {
                        var priceText = escapeHtml((b.estimatedValue || '').trim()) || 'Na prodej';
                        var rowCena = document.createElement('div');
                        rowCena.className = 'book-card-dynamic-row';
                        rowCena.textContent = '🏷️ ' + priceText;
                        dynamicRows.appendChild(rowCena);
                        hasRows = true;
                    }
                    if (b.is_favorite) {
                        var favRow = document.createElement('div');
                        favRow.className = 'book-card-dynamic-row book-card-dynamic-row--favorite';
                        favRow.textContent = '♥ Tato kniha patří mezi tvé oblíbené';
                        dynamicRows.appendChild(favRow);
                        hasRows = true;
                    }
                    // Připíchnuté veřejné doporučení: zobraz nenápadnou bublinu i mimo sekci Přátelé
                    if (currentView !== 'friendsHighlights') {
                        var bookKey = computeBookKeyForReco(b);
                        if (bookKey) {
                            var map = getFriendsPublicRecoMap();
                            var list = map && map[bookKey];
                            if (list && list.length) {
                                var r0 = list[0] || {};
                                var from0 = escapeHtml(String(r0.from || 'Přítel'));
                                var msg0 = String(r0.message || '').trim() || 'Doporučeno přáteli';
                                var rowReco = document.createElement('div');
                                rowReco.className = 'book-card-dynamic-row book-card-dynamic-row--friends-reco';
                                rowReco.textContent = '💬 ' + from0 + ': ' + truncateRecoMsg(msg0, 90);
                                dynamicRows.appendChild(rowReco);
                                hasRows = true;
                            }
                        }
                    }
                    if (hasRows && targetForDetail) targetForDetail.appendChild(dynamicRows);
                }
                if (currentView === 'currentlyReading') {
                    card.classList.add('book-card--reading-detail', 'book-card--reading-expandable', 'book-card--reading-minimal');
                    if ((status === 'borrowed' || status === 'borrowedbyme') && dueInfo.overdue) card.classList.add('book-card--reading-overdue');
                    var readingOverlay = document.createElement('div');
                    readingOverlay.className = 'book-card-cover-overlay';
                    readingOverlay.innerHTML = '<div class="book-card-overlay-line">ISBN: ' + escapeHtml((b.isbn || '').trim() || '—') + '</div><div class="book-card-overlay-line">Žánr: ' + escapeHtml((b.genre || '').trim() || '—') + '</div><div class="book-card-overlay-line">Kolekce: ' + escapeHtml(((b.collection || b.series || '') + '').trim() || '—') + '</div><div class="book-card-overlay-line">Umístění v polici: ' + escapeHtml((b.position || '').trim() || '—') + '</div>';
                    var summaryWrap = document.createElement('div');
                    summaryWrap.className = 'reading-summary-wrap';
                    var summaryBtn = document.createElement('button');
                    summaryBtn.type = 'button';
                    summaryBtn.className = 'reading-summary-btn';
                    summaryBtn.textContent = 'Chci výtah z děje';
                    summaryBtn.setAttribute('data-book-id', bookId);
                    var summaryResult = document.createElement('div');
                    summaryResult.className = 'reading-summary-result';
                    summaryResult.setAttribute('aria-live', 'polite');
                    var pageInput = document.createElement('input');
                    pageInput.type = 'number';
                    pageInput.min = '0';
                    pageInput.placeholder = 'Str.';
                    pageInput.className = 'book-card-page-input';
                    pageInput.value = (b.currentPage != null && b.currentPage !== '') ? String(b.currentPage) : '';
                    pageInput.setAttribute('data-book-id', bookId);
                    summaryBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var bid = this.getAttribute('data-book-id');
                        var pageVal = (pageInput.value || '').trim();
                        if (!pageVal) {
                            summaryResult.textContent = 'Zadej prosím číslo stránky v poli Str., abych mohl připravit výtah jen do místa, kde jsi.';
                            summaryResult.classList.add('has-text', 'is-message');
                            summaryResult.style.display = 'block';
                            return;
                        }
                        var book = library.find(function (x) { return x.id === bid; });
                        if (!book) return;
                        requestReadingSummaryUpToPage(bid, pageVal, book.title || '', book.author || '', summaryResult, summaryBtn);
                    });
                    summaryWrap.appendChild(summaryBtn);
                    summaryWrap.appendChild(summaryResult);
                    readingOverlay.appendChild(summaryWrap);
                    coverWrap.appendChild(readingOverlay);
                    var pageRow = document.createElement('div');
                    pageRow.className = 'book-card-reading-minimal';
                    pageInput.addEventListener('change', function () {
                        var bid = this.getAttribute('data-book-id');
                        var book = library.find(function (x) { return x.id === bid; });
                        if (book) { book.currentPage = this.value.trim() || undefined; saveLibrary(); }
                    });
                    pageInput.addEventListener('click', function (e) { e.stopPropagation(); });
                    var camBtn = document.createElement('button');
                    camBtn.type = 'button';
                    camBtn.className = 'book-card-cam-btn';
                    camBtn.setAttribute('aria-label', 'Nahrát stránku');
                    camBtn.setAttribute('title', 'Vyfoť si stranu, já ti udělám výtah z děje, abys neztratila nit.');
                    camBtn.innerHTML = '📷';
                    camBtn.setAttribute('data-book-id', bookId);
                    var camInput = document.createElement('input');
                    camInput.type = 'file';
                    camInput.accept = 'image/*';
                    camInput.style.display = 'none';
                    camInput.setAttribute('data-book-id', bookId);
                    camInput.addEventListener('change', function () {
                        var bid = this.getAttribute('data-book-id');
                        var file = this.files && this.files[0];
                        if (!bid || !file || !file.type.startsWith('image/')) return;
                        compressImageFileToJpegDataUrl(file, 300, 0.6).then(function (out) {
                            var book = library.find(function (x) { return x.id === bid; });
                            if (book) { book.readingPageImage = out || ''; saveLibrary(); }
                        }).catch(function () {});
                        this.value = '';
                    });
                    camBtn.addEventListener('click', function (e) { e.stopPropagation(); camInput.click(); });
                    var camWrap = document.createElement('div');
                    camWrap.className = 'book-card-cam-wrap';
                    var tooltipBubble = document.createElement('span');
                    tooltipBubble.className = 'book-card-tooltip-bubble';
                    tooltipBubble.setAttribute('role', 'tooltip');
                    tooltipBubble.textContent = 'Vyfoť si stranu, já ti udělám výtah z děje, abys neztratila nit.';
                    camWrap.appendChild(camBtn);
                    camWrap.appendChild(tooltipBubble);
                    pageRow.appendChild(pageInput);
                    pageRow.appendChild(camWrap);
                    pageRow.appendChild(camInput);
                    panel.appendChild(pageRow);
                    var readingToggleWrap = document.createElement('button');
                    readingToggleWrap.type = 'button';
                    readingToggleWrap.className = 'book-card-reading-toggle-wrap' + ((status === 'borrowed' || status === 'borrowedbyme') && dueInfo.overdue ? ' has-overdue' : '');
                    readingToggleWrap.setAttribute('aria-label', 'Rozbalit detail');
                    readingToggleWrap.innerHTML = '<span class="book-card-reading-toggle-chevron">▼</span>';
                    readingToggleWrap.addEventListener('click', function (e) {
                        e.stopPropagation();
                        card.classList.toggle('expanded');
                        var chev = this.querySelector('.book-card-reading-toggle-chevron');
                        if (chev) chev.textContent = card.classList.contains('expanded') ? '▲' : '▼';
                        this.setAttribute('aria-label', card.classList.contains('expanded') ? 'Sbalit detail' : 'Rozbalit detail');
                    });
                    panel.appendChild(readingToggleWrap);
                }
                if (currentView === 'borrowed' && status === 'borrowed') {
                    var actions = document.createElement('div');
                    actions.className = 'book-card-panel-actions book-card-panel-actions--borrowed-only';
                    // Zobrazit "Kniha je mimo domov" pouze pokud je skutečně půjčená
                    if (status === 'borrowed' && (b.borrowedTo || b.owner)) {
                        var outOfHome = document.createElement('div');
                        outOfHome.className = 'book-card-out-of-home';
                        outOfHome.textContent = 'Kniha je mimo domov';
                        actions.appendChild(outOfHome);
                    }
                    panel.appendChild(actions);
                } else if (!isCollectionView && currentView !== 'currentlyReading' && status !== 'borrowedbyme' && currentView !== 'favorites' && currentView !== 'wishlist' && currentView !== 'forSale') {
                    var actions = document.createElement('div');
                    actions.className = 'book-card-panel-actions';
                    var editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'book-card-btn book-card-btn-edit';
                    editBtn.textContent = 'Upravit';
                    editBtn.setAttribute('onclick', "event.stopPropagation(); typeof openEditModal === 'function' && openEditModal('" + escapeHtml(bookId) + "');");
                    var pracovnaBtn = document.createElement('button');
                    pracovnaBtn.type = 'button';
                    pracovnaBtn.className = 'book-card-btn book-card-btn-pracovna';
                    pracovnaBtn.textContent = 'Pracovna';
                    pracovnaBtn.setAttribute('onclick', "event.stopPropagation();");
                    actions.appendChild(editBtn);
                    actions.appendChild(pracovnaBtn);
                    if (!publicView) {
                        var moveWrap = document.createElement('div');
                        moveWrap.className = 'book-card-move-wrap';
                        var moveLabel = document.createElement('label');
                        moveLabel.className = 'book-card-move-label';
                        moveLabel.textContent = 'Přesunout:';
                        var moveSelect = document.createElement('select');
                        moveSelect.className = 'book-card-move-select';
                        moveSelect.innerHTML = '<option value="">— vyberte polici —</option>';
                        var otherShelves = getShelfNamesList().filter(function (sn) { return sn !== shelfName; });
                        otherShelves.forEach(function (sn) {
                            var opt = document.createElement('option');
                            opt.value = sn;
                            opt.textContent = sn;
                            moveSelect.appendChild(opt);
                        });
                        moveLabel.appendChild(moveSelect);
                        moveWrap.appendChild(moveLabel);
                        moveSelect.addEventListener('click', function (e) { e.stopPropagation(); });
                        moveSelect.addEventListener('change', function (e) {
                            e.stopPropagation();
                            var target = moveSelect.value;
                            if (!target) return;
                            moveBookToShelf(bookId, target);
                            moveSelect.value = '';
                            renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                        });
                        actions.appendChild(moveWrap);
                    }
                    panel.appendChild(actions);
                }
                card.appendChild(panel);
                if (currentView === 'borrowed') {
                    selectedBookIdForBorrowed = null;
                } else if (!isCollectionView) {
                    card.addEventListener('click', function (e) {
                        if (e.target.closest('button')) return;
                        if (typeof openEditModal === 'function') openEditModal(bookId);
                    });
                }
                if (currentView === 'borrowed' && (status === 'borrowed' || status === 'borrowedbyme')) {
                    var wrapper = document.createElement('div');
                    wrapper.className = 'borrowed-card-with-chat';
                    wrapper.appendChild(card);
                    var chatBlock = document.createElement('div');
                    chatBlock.className = 'item-chat';
                    chatBlock.setAttribute('data-context', 'borrowed');
                    chatBlock.setAttribute('data-item-id', bookId);
                    if (typeof window.itemChat !== 'undefined' && typeof window.itemChat.render === 'function') {
                        window.itemChat.render(chatBlock, { context: 'borrowed', itemId: bookId, messages: Array.isArray(b.borrowedMessages) ? b.borrowedMessages : [] });
                    } else {
                        renderItemChatInline(chatBlock, bookId, Array.isArray(b.borrowedMessages) ? b.borrowedMessages : []);
                    }
                    wrapper.appendChild(chatBlock);
                    grid.appendChild(wrapper);
                } else {
                    grid.appendChild(card);
                }
            });
            booksWrap.appendChild(grid);
            if (totalPages > 1) {
                var paginationWrap = document.createElement('div');
                paginationWrap.className = 'shelf-pagination';
                var prevBtn = document.createElement('button');
                prevBtn.type = 'button';
                prevBtn.className = 'shelf-pagination-btn';
                prevBtn.textContent = 'Předchozí';
                prevBtn.disabled = page <= 1;
                prevBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (page <= 1) return;
                    shelfCurrentPage[shelfName] = page - 1;
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                });
                paginationWrap.appendChild(prevBtn);
                var pagesWrap = document.createElement('span');
                pagesWrap.className = 'shelf-pagination-pages';
                for (var p = 1; p <= totalPages; p++) {
                    var pageBtn = document.createElement('button');
                    pageBtn.type = 'button';
                    pageBtn.className = 'shelf-pagination-num' + (p === page ? ' is-current' : '');
                    pageBtn.textContent = String(p);
                    pageBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        var pNum = parseInt(this.textContent, 10);
                        shelfCurrentPage[shelfName] = pNum;
                        renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    });
                    pagesWrap.appendChild(pageBtn);
                }
                paginationWrap.appendChild(pagesWrap);
                var nextBtn = document.createElement('button');
                nextBtn.type = 'button';
                nextBtn.className = 'shelf-pagination-btn';
                nextBtn.textContent = 'Další';
                nextBtn.disabled = page >= totalPages;
                nextBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (page >= totalPages) return;
                    shelfCurrentPage[shelfName] = page + 1;
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                });
                paginationWrap.appendChild(nextBtn);
                booksWrap.appendChild(paginationWrap);
            }
            group.appendChild(booksWrap);
            scanHistoryGrid.appendChild(group);
        });
        if (currentView === 'borrowed' && shelfNames.length > 0) {
            var messagesPanel = document.getElementById('borrowedMessagesPanel');
            if (messagesPanel) messagesPanel.style.display = 'none';
            var contentWrap = document.getElementById('scanHistoryContent');
            if (contentWrap) contentWrap.classList.remove('has-borrowed-messages');
            var alarmBar = document.getElementById('borrowedAlarmBar');
            var firstOverdue = null;
            shelfNames.forEach(function (sn) {
                if (firstOverdue) return;
                (byShelf[sn] || []).forEach(function (b) {
                    if (firstOverdue) return;
                    var os = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
                    if ((os === 'borrowed' || os === 'pujceno') && isDueSoonOrOverdue(b.returnDueDate).overdue) firstOverdue = b;
                });
            });
            if (alarmBar) {
                if (firstOverdue) {
                    alarmBar.style.display = 'flex';
                    var alarmText = alarmBar.querySelector('.borrowed-alarm-text');
                    var name = (firstOverdue.borrowedTo || firstOverdue.owner || '').trim() || 'Někdo';
                    if (alarmText) alarmText.textContent = 'Pozor, jedna knížka se nám někde zapomněla! ' + name + ' ji má u sebe už moc dlouho…';
                    var btn = alarmBar.querySelector('.borrowed-alarm-btn');
                    if (btn) {
                        btn.setAttribute('data-book-id', firstOverdue.id);
                        btn.textContent = 'Poslat jemné popostrčení';
                    }
                } else {
                    alarmBar.style.display = 'none';
                }
            }
        } else {
            var contentWrapElse = document.getElementById('scanHistoryContent');
            if (contentWrapElse) contentWrapElse.classList.remove('has-borrowed-messages');
        }
        if (searchQuery) {
            var firstMatch = scanHistoryGrid.querySelector('.book-card:not(.search-no-match)');
            if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        checkLendingStatus();
    }

    function checkLendingStatus() {
        var today = new Date().toISOString().split('T')[0];
        var ownershipNorm = function (s) { return (s || '').toLowerCase().replace(/\s/g, ''); };
        var overdueBorrowedByMe = (library || []).filter(function (b) {
            if (ownershipNorm(b.ownershipStatus) !== 'borrowedbyme') return false;
            var d = b.returnDueDate || b.returnDate || '';
            return d && d < today;
        });
        var banner = document.getElementById('overdueBanner');
        var bannerText = document.getElementById('overdueBannerText');
        var bannerBtn = document.getElementById('overdueBannerBtn');
        if (overdueBorrowedByMe.length > 0 && banner) {
            var first = overdueBorrowedByMe[0];
            var name = (first.borrowedFrom || first.od_koho || '').trim() || 'někdo';
            banner.style.display = 'flex';
            if (bannerText) bannerText.textContent = 'Pozor! Knihu „' + (first.title || first.nazev || 'kniha') + '“ je třeba vrátit ' + name + '. Termín už uplynul…';
            if (bannerBtn) bannerBtn.textContent = 'Přejít na Mám vypůjčeno';
            return;
        }
        var overdueBooks = library.filter(function (b) {
            var status = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
            if (status !== 'borrowed' && status !== 'pujceno') return false;
            var due = (b.returnDueDate || '').trim();
            if (!due) return false;
            return isDueSoonOrOverdue(b.returnDueDate).overdue;
        });
        var banner = document.getElementById('overdueBanner');
        var bannerText = document.getElementById('overdueBannerText');
        var bannerBtn = document.getElementById('overdueBannerBtn');
        if (!banner) return;
        if (overdueBooks.length > 0) {
            banner.style.display = 'flex';
            var first = overdueBooks[0];
            var name = (first.borrowedTo || first.owner || '').trim() || 'Někdo';
            if (bannerText) {
                bannerText.textContent = 'Pozor, jedna knížka se nám někde zapomněla! ' + name + ' ji má u sebe už moc dlouho…';
            }
            if (bannerBtn) bannerBtn.textContent = 'Poslat jemné popostrčení';
        } else {
            banner.style.display = 'none';
        }
    }

    function getUploadFlowCtx() {
        return {
            getOpenAiKey: getOpenAiKey,
            getAnalyzePrompt: function () { return AI_ANALYZE_PROMPT; },
            getWishlistPrompt: function () { return AI_WISHLIST_COVER_PROMPT; },
            getOneBookPrompt: function () { return AI_ONE_BOOK_MULTI_PROMPT; },
            getCurrentLibraryView: getCurrentLibraryView,
            getCurrentSectorId: getCurrentSectorId,
            showError: showError,
            showSuccess: showSuccess,
            hideMessages: hideMessages,
            /* Okamžitý render knihovny: překreslí mřížku (scanHistoryGrid) včetně .shelf-group s kartami knih. */
            refreshGrid: function () {
                var es = document.getElementById('emptyState');
                var grid = document.getElementById('scanHistoryGrid');
                var shelfInput = document.getElementById('shelfName');
                if (es && grid && shelfInput) renderScanHistory(es, grid, shelfInput);
                if (typeof window.__OMNI_updateAiAssistantBubble === 'function') window.__OMNI_updateAiAssistantBubble();
            },
            renderScanHistory: renderScanHistory,
            saveToStorage: saveToStorage,
            saveLibrary: saveLibrary,
            findLibraryMatch: findLibraryMatch,
            generateBookId: generateBookId,
            migrateBookToNewFields: migrateBookToNewFields,
            getFamilyProfiles: function () { return familyProfiles; },
            getLibrary: function () { return library; },
            getWishlist: function () { return wishlist; },
            getScanHistory: function () { return scanHistory; },
            getCurrentBooks: function () { return currentBooks; },
            setCurrentBooks: function (arr) { currentBooks = arr || []; }
        };
    }

    function renderResultsTable(resultsBody, shelfNameInput, t) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.renderResultsTable === 'function') {
            return window.OMNI_LibraryUploadLogic.renderResultsTable(getUploadFlowCtx(), resultsBody, shelfNameInput, t);
        }
    }

    function updateScanHistory(emptyState, scanHistoryGrid, shelfNameInput) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.updateScanHistory === 'function') {
            return window.OMNI_LibraryUploadLogic.updateScanHistory(getUploadFlowCtx(), emptyState, scanHistoryGrid, shelfNameInput);
        }
    }

    function addToScanHistory(shelfNameInput, emptyState, scanHistoryGrid, firstBookCoverDataUrl) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.addToScanHistory === 'function') {
            return window.OMNI_LibraryUploadLogic.addToScanHistory(getUploadFlowCtx(), shelfNameInput, emptyState, scanHistoryGrid, firstBookCoverDataUrl);
        }
    }

    function displayResults(books, resultsSection, shelfNameInput, emptyState, scanHistoryGrid) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.displayResults === 'function') {
            return window.OMNI_LibraryUploadLogic.displayResults(getUploadFlowCtx(), books, resultsSection, shelfNameInput, emptyState, scanHistoryGrid);
        }
    }

    function runAnalysis(uploadRefs, resultsSection, shelfNameInput, emptyState, scanHistoryGrid) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.runAnalysis === 'function') {
            return window.OMNI_LibraryUploadLogic.runAnalysis(getUploadFlowCtx(), uploadRefs, resultsSection, shelfNameInput, emptyState, scanHistoryGrid);
        }
    }

    function handleFileSelectFallback(file, uploadRefs) {
        if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.handleFileSelectFallback === 'function') {
            return window.OMNI_LibraryUploadLogic.handleFileSelectFallback(getUploadFlowCtx(), file, uploadRefs);
        }
    }

    function init() {
        var uploadArea = document.getElementById('uploadArea');
        var fileInput = document.getElementById('fileInput');
        var imagePreview = document.getElementById('imagePreview');
        var fileInfo = document.getElementById('fileInfo');
        var analyzeButton = document.getElementById('analyzeButton');
        var errorMessage = document.getElementById('errorMessage');
        var successMessage = document.getElementById('successMessage');
        var uploadAreaDetail = document.getElementById('uploadAreaDetail');
        var fileInputDetail = document.getElementById('fileInputDetail');
        var imagePreviewDetail = document.getElementById('imagePreviewDetail');
        var fileInfoDetail = document.getElementById('fileInfoDetail');
        var analyzeButtonDetail = document.getElementById('analyzeButtonDetail');
        var analyzeLoadingBarDetail = document.getElementById('analyzeLoadingBarDetail');
        var errorMessageDetail = document.getElementById('errorMessageDetail');
        var successMessageDetail = document.getElementById('successMessageDetail');
        var resultsSection = document.getElementById('resultsSection');
        var resultsBody = document.getElementById('resultsBody');
        var shelfNameInput = document.getElementById('shelfName');
        var emptyState = document.getElementById('emptyState');
        var scanHistoryGrid = document.getElementById('scanHistoryGrid');
        var addBookBtn = document.getElementById('addBookBtn');
        var manualAddForm = document.getElementById('manualAddForm');
        var manualAddPanel = document.getElementById('manualAddPanel');
        var btnToggleManualAdd = document.getElementById('btnToggleManualAdd');
        var manualTitleInput = document.getElementById('manualTitle');
        var manualAuthorInput = document.getElementById('manualAuthor');
        var manualLocationInput = document.getElementById('manualLocation');
        var manualPositionInput = document.getElementById('manualPosition');
        var manualEstimatedValueInput = document.getElementById('manualEstimatedValue');
        var manualIsbnInput = document.getElementById('manualIsbn');
        var manualOwnerSelect = document.getElementById('manualOwner');
        var btnAddWishlist = document.getElementById('btnAddWishlist');

        // Texty: rychlé ruční přidání (název/autor/žánr + obálka)
        var textQuickAddForm = document.getElementById('textQuickAddForm');
        var textQuickTitle = document.getElementById('textQuickTitle');
        var textQuickAuthor = document.getElementById('textQuickAuthor');
        var textQuickGenre = document.getElementById('textQuickGenre');
        var textQuickCover = document.getElementById('textQuickCover');
        var textQuickCoverPreview = document.getElementById('textQuickCoverPreview');
        var pendingTextQuickCover = '';

        function setPendingTextQuickCover(dataUrl) {
            pendingTextQuickCover = dataUrl || '';
            if (textQuickCoverPreview) {
                textQuickCoverPreview.innerHTML = pendingTextQuickCover ? ('<img src="' + pendingTextQuickCover + '" alt="Obálka" />') : '';
            }
        }

        if (textQuickCover) {
            textQuickCover.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file || !file.type || !file.type.startsWith('image/')) { setPendingTextQuickCover(''); return; }
                compressImageFileToJpegDataUrl(file, 300, 0.6).then(function (out) {
                    setPendingTextQuickCover(out || '');
                }).catch(function () {
                    setPendingTextQuickCover('');
                });
            });
        }

        if (textQuickAddForm) {
            textQuickAddForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var title = (textQuickTitle && textQuickTitle.value) ? textQuickTitle.value.trim() : '';
                var author = (textQuickAuthor && textQuickAuthor.value) ? textQuickAuthor.value.trim() : '';
                var genre = (textQuickGenre && textQuickGenre.value) ? textQuickGenre.value.trim() : '';
                if (!title && !author) return;
                var view = getCurrentLibraryView();
                var loc = (document.getElementById('shelfName') && document.getElementById('shelfName').value) ? document.getElementById('shelfName').value.trim() : '';
                if (!loc) loc = '— Bez poličky —';
                if (view === 'borrowedByMe') loc = 'Půjčená literatura';

                var newBook = {
                    id: generateBookId(),
                    title: title || '—',
                    author: author || '—',
                    genre: genre || '',
                    location: loc,
                    physicalLocation: loc,
                    virtualSort: [],
                    position: '',
                    collection: '',
                    originalLocation: loc,
                    addedAt: new Date().toISOString(),
                    borrowedBy: '',
                    owner: (familyProfiles && familyProfiles[0] && familyProfiles[0].name) ? familyProfiles[0].name : 'Já',
                    estimatedValue: '',
                    isbn: '',
                    category: getCurrentSectorId(),
                    image: pendingTextQuickCover || '',
                    isFavorite: false
                };
                if (view === 'borrowedByMe') { newBook.ownershipStatus = 'borrowedByMe'; newBook.readingStatus = 'unread'; }
                else if (view === 'borrowed') newBook.ownershipStatus = 'borrowed';
                else if (view === 'wishlist') newBook.ownershipStatus = 'wishlist';
                else if (view === 'currentlyReading') { newBook.ownershipStatus = 'mine'; newBook.readingStatus = 'reading'; }
                else if (view === 'forSale') newBook.ownershipStatus = 'forsale';
                else newBook.ownershipStatus = 'mine';

                migrateBookToNewFields(newBook);
                library.push(newBook);
                saveToStorage(newBook);
                refreshGrid();

                if (textQuickTitle) textQuickTitle.value = '';
                if (textQuickAuthor) textQuickAuthor.value = '';
                if (textQuickGenre) textQuickGenre.value = '';
                setPendingTextQuickCover('');
            });
        }

        function openManualAddPanel() {
            if (!manualAddPanel) return;
            manualAddPanel.hidden = false;
            try {
                if (manualTitleInput) manualTitleInput.focus();
            } catch (e) {}
        }

        function toggleManualAddPanel() {
            if (!manualAddPanel) return;
            manualAddPanel.hidden = !manualAddPanel.hidden;
            if (!manualAddPanel.hidden) openManualAddPanel();
        }

        if (btnToggleManualAdd) {
            btnToggleManualAdd.addEventListener('click', function () {
                toggleManualAddPanel();
                if (manualAddPanel && !manualAddPanel.hidden) {
                    manualAddPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }

        if (!uploadArea || !fileInput || !analyzeButton) return;

        var uploadRefs = { uploadArea: uploadArea, fileInput: fileInput, imagePreview: imagePreview, fileInfo: fileInfo, analyzeButton: analyzeButton, errorMessage: errorMessage, successMessage: successMessage };
        if (typeof window.OMNI_UploadModule !== 'undefined' && window.OMNI_UploadModule.initUpload) {
            window.OMNI_UploadModule.initUpload(uploadRefs, {
                getCurrentView: getCurrentLibraryView,
                onAnalyzeClick: function () {
                    runAnalysis(uploadRefs, resultsSection, shelfNameInput, emptyState, scanHistoryGrid);
                }
            });
        } else {
            uploadArea.addEventListener('click', function () { fileInput.click(); });
            uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); uploadArea.classList.add('dragover'); });
            uploadArea.addEventListener('dragleave', function () { uploadArea.classList.remove('dragover'); });
            uploadArea.addEventListener('drop', function (e) {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                if (e.dataTransfer.files.length) handleFileSelectFallback(e.dataTransfer.files[0], uploadRefs);
            });
            fileInput.addEventListener('change', function (e) {
                if (e.target.files.length) handleFileSelectFallback(e.target.files[0], uploadRefs);
            });
            analyzeButton.addEventListener('click', function () { runAnalysis(uploadRefs, resultsSection, shelfNameInput, emptyState, scanHistoryGrid); });
        }

        // Detailní sken (multi-upload) – více fotek jedné knihy
        var detailFiles = [];
        function updateDetailUi(files) {
            detailFiles = Array.isArray(files) ? files.filter(function (f) { return f && f.type && f.type.startsWith('image/'); }) : [];
            if (detailFiles.length > 3) {
                if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('tooManyDetailPhotos');
                detailFiles = detailFiles.slice(0, 3);
            }
            try {
                if (uploadAreaDetail) uploadAreaDetail.classList.toggle('has-file', detailFiles.length > 0);
            } catch (e0) {}
            if (fileInfoDetail) fileInfoDetail.textContent = detailFiles.length ? ('Vybráno: ' + detailFiles.length + ' fotek (max 3)') : '';
            if (imagePreviewDetail) {
                imagePreviewDetail.innerHTML = '';
                detailFiles.forEach(function (f) {
                    var r = new FileReader();
                    r.onload = function (e) {
                        var img = document.createElement('img');
                        img.src = e.target.result;
                        img.alt = 'Náhled';
                        imagePreviewDetail.appendChild(img);
                    };
                    r.readAsDataURL(f);
                });
            }
            if (analyzeButtonDetail) analyzeButtonDetail.disabled = detailFiles.length === 0;
            try {
                if (analyzeButtonDetail) analyzeButtonDetail.classList.toggle('is-active', detailFiles.length > 0);
            } catch (e1) {}
        }
        if (uploadAreaDetail && fileInputDetail && analyzeButtonDetail) {
            if (window.OMNI_UploadModule && window.OMNI_UploadModule.initMultiUpload) {
                window.OMNI_UploadModule.initMultiUpload({ uploadArea: uploadAreaDetail, fileInput: fileInputDetail }, {
                    onFilesSelect: function (files) { updateDetailUi(files); }
                });
            } else {
                uploadAreaDetail.addEventListener('click', function () { fileInputDetail.click(); });
                fileInputDetail.addEventListener('change', function (e) { updateDetailUi(Array.prototype.slice.call(e.target.files || [])); });
            }
            analyzeButtonDetail.addEventListener('click', function () {
                if (!window.OMNI_LibraryUploadLogic || typeof window.OMNI_LibraryUploadLogic.runDetailedOneBookAnalysis !== 'function') return;
                window.OMNI_LibraryUploadLogic.runDetailedOneBookAnalysis(
                    getUploadFlowCtx(),
                    detailFiles,
                    { analyzeButton: analyzeButtonDetail, errorMessage: errorMessageDetail, successMessage: successMessageDetail, loadingBar: analyzeLoadingBarDetail },
                    shelfNameInput,
                    emptyState,
                    scanHistoryGrid
                );
            });
        }

        /* Pracovní plocha „Tento sken“ – Schválit / Vymazat */
        var btnApproveWorkspace = document.getElementById('btnApproveWorkspace');
        var btnClearWorkspace = document.getElementById('btnClearWorkspace');
        var resultsSectionWrapEl = document.getElementById('resultsSectionWrap');
        var resultsBodyEl = document.getElementById('resultsBody');
        if (btnApproveWorkspace && window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.approveAndAddToLibrary === 'function') {
            btnApproveWorkspace.addEventListener('click', function () {
                var ctx = getUploadFlowCtx();
                var successMsg = document.getElementById('successMessage');
                window.OMNI_LibraryUploadLogic.approveAndAddToLibrary(ctx, shelfNameInput, emptyState, scanHistoryGrid, resultsBodyEl, resultsSectionWrapEl, successMsg);
            });
        }
        if (btnClearWorkspace && window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.clearWorkspace === 'function') {
            btnClearWorkspace.addEventListener('click', function () {
                var ctx = getUploadFlowCtx();
                window.OMNI_LibraryUploadLogic.clearWorkspace(ctx, resultsBodyEl, resultsSectionWrapEl);
            });
        }

        /* Globální vyhledávání – lupa v horní liště, výsledky v akordeonu */
        var globalSearchBar = document.getElementById('globalSearchBar');
        var globalSearchInput = document.getElementById('globalSearchInput');
        var globalSearchResults = document.getElementById('globalSearchResults');
        var btnGlobalSearchToggle = document.getElementById('btnGlobalSearchToggle');
        var btnGlobalSearchClose = document.getElementById('btnGlobalSearchClose');
        var libraryGlobalSortSelect = document.getElementById('libraryGlobalSortSelect');
        var librarySortSelectHeader = document.getElementById('librarySortSelectHeader');
        function syncSortSelects() {
            var v = getGlobalSortMode();
            if (libraryGlobalSortSelect) libraryGlobalSortSelect.value = v;
            if (librarySortSelectHeader) librarySortSelectHeader.value = v;
        }
        function populateFilterSelect(selectEl) {
            if (!selectEl) return;
            var current = getGlobalSortMode();
            // unikátní žánry z celé knihovny
            var genres = collectGenres(library);
            var html = '';
            html += '<option value="">Vše</option>';
            html += '<optgroup label="Seřadit">';
            html += '<option value="sort:author">Autor A–Z</option>';
            html += '<option value="sort:author_desc">Autor Z–A</option>';
            html += '<option value="sort:title">Titul A–Z</option>';
            html += '<option value="sort:title_desc">Titul Z–A</option>';
            html += '<option value="sort:genre">Žánr</option>';
            html += '<option value="sort:added">Datum přidání do knihovny</option>';
            html += '<option value="sort:owner">Majitel</option>';
            html += '<option value="sort:status">Stav (priorita)</option>';
            html += '<option value="sort:privacy">Sdílení</option>';
            html += '</optgroup>';
            if (genres.length) {
                html += '<optgroup label="Žánr (filtrovat)">';
                genres.forEach(function (g) {
                    html += '<option value="genre:' + String(g.key).replace(/"/g, '') + '">Žánr – ' + escapeHtml(g.label) + '</option>';
                });
                html += '</optgroup>';
            }
            html += '<optgroup label="Stav (filtrovat)">';
            html += '<option value="status:borrowed">Jen půjčené (mám vypůjčeno)</option>';
            html += '<option value="status:borrowed_lent">V zapůjčení (půjčil/a jsem)</option>';
            html += '<option value="status:forsale">Na prodej</option>';
            html += '<option value="status:sold">Prodané</option>';
            html += '<option value="status:wishlist">Jen přeji si</option>';
            html += '</optgroup>';
            html += '<optgroup label="Sdílení (filtrovat)">';
            html += '<option value="privacy:public">Veřejné</option>';
            html += '<option value="privacy:private">Soukromé</option>';
            html += '</optgroup>';
            html += '<optgroup label="Oblíbenost">';
            html += '<option value="favorites:1">Jen srdcovky</option>';
            html += '</optgroup>';
            selectEl.innerHTML = html;
            // restore selection if still present
            selectEl.value = current;
        }

        function updateFilterSummaryUi() {
            var mode = parseGlobalMode(getGlobalSortMode());
            var summary = getFilterSummaryText(mode);
            var sumTop = document.getElementById('libraryFilterSummaryTop');
            var sumHeader = document.getElementById('libraryFilterSummaryHeader');
            if (sumTop) sumTop.textContent = summary;
            if (sumHeader) sumHeader.textContent = summary;
        }

        if (libraryGlobalSortSelect) populateFilterSelect(libraryGlobalSortSelect);
        if (librarySortSelectHeader) populateFilterSelect(librarySortSelectHeader);
        updateFilterSummaryUi();
        if (libraryGlobalSortSelect) {
            syncSortSelects();
            libraryGlobalSortSelect.addEventListener('change', function () {
                setGlobalSortMode(this.value);
                syncSortSelects();
                updateFilterSummaryUi();
                refreshGrid();
            });
        }
        if (librarySortSelectHeader) {
            syncSortSelects();
            librarySortSelectHeader.addEventListener('change', function () {
                setGlobalSortMode(this.value);
                syncSortSelects();
                updateFilterSummaryUi();
                refreshGrid();
            });
        }
        if (btnGlobalSearchToggle && globalSearchBar && globalSearchResults) {
            btnGlobalSearchToggle.addEventListener('click', function () {
                globalSearchBar.classList.toggle('expanded');
                var isExpanded = globalSearchBar.classList.contains('expanded');
                globalSearchResults.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
                if (isExpanded && globalSearchInput) {
                    globalSearchInput.focus();
                    renderGlobalSearchResults(globalSearchInput.value);
                } else {
                    globalSearchResults.innerHTML = '';
                    globalSearchResults.style.display = '';
                }
            });
        }
        if (btnGlobalSearchClose && globalSearchBar) {
            btnGlobalSearchClose.addEventListener('click', function () {
                globalSearchBar.classList.remove('expanded');
                if (globalSearchInput) globalSearchInput.value = '';
                if (globalSearchResults) { globalSearchResults.innerHTML = ''; globalSearchResults.style.display = ''; }
                globalSearchResults.setAttribute('aria-hidden', 'true');
            });
        }
        function renderGlobalSearchResults(query) {
            if (!globalSearchResults) return;
            globalSearchResults.innerHTML = '';
            if (!query || !query.trim()) { globalSearchResults.style.display = ''; return; }
            var q = query.trim().toLowerCase();
            var matches = library.filter(function (b) {
                var t = (b.title || '').trim().toLowerCase();
                var a = (b.author || '').trim().toLowerCase();
                return t.indexOf(q) !== -1 || a.indexOf(q) !== -1;
            });
            var byLocation = {};
            matches.forEach(function (b) {
                var loc = (b.location || '').trim() || '— Bez poličky —';
                var label = 'Knihovna → ' + loc;
                if (!byLocation[label]) byLocation[label] = [];
                byLocation[label].push(b);
            });
            var locations = Object.keys(byLocation).sort();
            locations.forEach(function (label) {
                var section = document.createElement('div');
                section.className = 'global-search-accordion-section';
                var header = document.createElement('button');
                header.type = 'button';
                header.className = 'global-search-accordion-header';
                header.textContent = label;
                header.setAttribute('aria-expanded', 'true');
                var content = document.createElement('div');
                content.className = 'global-search-accordion-content';
                byLocation[label].forEach(function (b) {
                    var item = document.createElement('div');
                    item.className = 'global-search-result-item';
                    item.innerHTML = '<span class="result-title">' + escapeHtml(b.title || '—') + '</span><span class="result-location">' + escapeHtml(b.author || '') + ' · ' + escapeHtml(label) + '</span>';
                    content.appendChild(item);
                });
                section.appendChild(header);
                section.appendChild(content);
                globalSearchResults.appendChild(section);
            });
            globalSearchResults.style.display = locations.length ? 'block' : '';
        }
        if (globalSearchInput && globalSearchResults) {
            globalSearchInput.addEventListener('input', function () { renderGlobalSearchResults(globalSearchInput.value); });
            globalSearchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    globalSearchInput.value = '';
                    renderGlobalSearchResults('');
                    if (globalSearchBar) globalSearchBar.classList.remove('expanded');
                    globalSearchResults.setAttribute('aria-hidden', 'true');
                }
            });
        }

        /* Profil „Já“ – rozbalení menu: Nastavení účtu, seznam profilů, Přidat člena rodiny */
        var profileDropdown = document.getElementById('profileDropdown');
        var btnProfileSwitcher = document.getElementById('btnProfileSwitcher');
        var profileDropdownSettings = document.getElementById('profileDropdownSettings');
        var profileDropdownList = document.getElementById('profileDropdownList');
        if (btnProfileSwitcher && profileDropdown) {
            btnProfileSwitcher.addEventListener('click', function (e) {
                e.stopPropagation();
                var isVisible = profileDropdown.style.display === 'block';
                profileDropdown.style.display = isVisible ? 'none' : 'block';
                if (!isVisible && profileDropdownList) {
                    profileDropdownList.innerHTML = '';
                    familyProfiles.forEach(function (p) {
                        var btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'profile-dropdown-item' + (p.id === currentProfileId ? ' active' : '');
                        btn.textContent = p.name || p.id;
                        btn.addEventListener('click', function () {
                            saveLibrary();
                            currentProfileId = p.id;
                            try { localStorage.setItem(CURRENT_USER_KEY, currentProfileId); } catch (e) {}
                            loadLibrary();
                            profileDropdown.style.display = 'none';
                            if (emptyState && scanHistoryGrid && shelfNameInput) renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                            var initials = document.getElementById('profileInitials');
                            if (initials) initials.textContent = (p.name || p.id).slice(0, 2).toUpperCase() || 'Já';
                        });
                        profileDropdownList.appendChild(btn);
                    });
                }
            });
        }
        document.addEventListener('click', function (e) {
            if (profileDropdown && profileDropdown.style.display === 'block' && !e.target.closest('.profile-switcher-wrap')) {
                profileDropdown.style.display = 'none';
            }
        });
        if (profileDropdownSettings) {
            profileDropdownSettings.addEventListener('click', function () {
                profileDropdown.style.display = 'none';
                var btnOpenSettingsEl = document.getElementById('btnOpenSettings');
                if (btnOpenSettingsEl) btnOpenSettingsEl.click();
            });
        }
        var settingsModalOverlay = document.getElementById('settingsModalOverlay');
        var settingsModalClose = document.getElementById('settingsModalClose');
        var btnOpenSettingsEl = document.getElementById('btnOpenSettings');
        function refreshSettingsFamilyList() {
            var listEl = document.getElementById('settingsFamilyList');
            var limitHint = document.getElementById('settingsFamilyLimitHint');
            if (!listEl) return;
            var isFamily = typeof window.OMNI_UserState !== 'undefined' && window.OMNI_UserState.getCurrentUser().tier === 'family';
            listEl.innerHTML = '';
            if (isFamily && familyProfiles && familyProfiles.length > 0) {
                familyProfiles.forEach(function (p) {
                    var isMe = p.id === 'me';
                    var row = document.createElement('div');
                    row.className = 'settings-family-row';
                    row.innerHTML = '<span class="settings-family-name">' + (isMe ? 'Já (hlavní)' : (p.name || p.id)) + '</span>' +
                        (isMe ? '' : ' <span class="settings-family-meta">' + (p.itemCount !== undefined ? p.itemCount + ' položek' : '') + '</span>');
                    listEl.appendChild(row);
                });
                if (limitHint) limitHint.textContent = 'Limit: ' + familyProfiles.length + '/5';
            } else {
                var me = familyProfiles[0] || { id: 'me', name: 'Já' };
                var row = document.createElement('div');
                row.className = 'settings-family-row';
                row.innerHTML = '<span class="settings-family-name">Já (hlavní)</span>';
                listEl.appendChild(row);
                if (limitHint) limitHint.textContent = 'Pro přidání členů rodiny aktivujte tarif Rodina.';
            }
        }
        function refreshSettingsTierDisplay() {
            var tierEl = document.getElementById('settingsCurrentTier');
            var lockHint = document.getElementById('settingsFamilyLockHint');
            var tier = (typeof window.OMNI_UserState !== 'undefined' && window.OMNI_UserState.getCurrentUser())
                ? window.OMNI_UserState.getCurrentUser().tier
                : 'free';
            var tierLabel = tier === 'family' ? 'Family' : tier === 'pro' ? 'Pro' : 'Free';
            if (tierEl) tierEl.textContent = 'Aktuální tarif: ' + tierLabel;
            if (lockHint) lockHint.style.display = tier === 'free' ? '' : 'none';
        }
        function refreshSettingsVoiceAndBirthday() {
            var toneEl = document.getElementById('settingsVoiceTone');
            var birthdayEl = document.getElementById('settingsBirthday');
            var birthYearEl = document.getElementById('settingsBirthYear');
            if (toneEl) toneEl.value = getVoiceTone();
            if (birthdayEl) birthdayEl.value = getBirthday();
            if (birthYearEl) birthYearEl.value = getBirthYear();
        }
        if (btnOpenSettingsEl && settingsModalOverlay) {
            btnOpenSettingsEl.addEventListener('click', function () {
                refreshSettingsFamilyList();
                refreshSettingsTierDisplay();
                refreshSettingsVoiceAndBirthday();
                settingsModalOverlay.style.display = 'flex';
            });
        }
        var settingsVoiceTone = document.getElementById('settingsVoiceTone');
        var settingsBirthday = document.getElementById('settingsBirthday');
        var settingsBirthYear = document.getElementById('settingsBirthYear');
        if (settingsVoiceTone) settingsVoiceTone.addEventListener('change', function () { setVoiceTone(this.value); updateAiAssistantBubble(); });
        if (settingsBirthday) settingsBirthday.addEventListener('change', function () { setBirthday(this.value); });
        if (settingsBirthday) settingsBirthday.addEventListener('input', function () { setBirthday(this.value); });
        if (settingsBirthYear) settingsBirthYear.addEventListener('change', function () { setBirthYear(this.value); });
        if (settingsBirthYear) settingsBirthYear.addEventListener('input', function () { setBirthYear(this.value); });
        if (settingsModalClose && settingsModalOverlay) {
            settingsModalClose.addEventListener('click', function () { settingsModalOverlay.style.display = 'none'; });
        }
        if (settingsModalOverlay) {
            settingsModalOverlay.addEventListener('click', function (e) {
                if (e.target === settingsModalOverlay) settingsModalOverlay.style.display = 'none';
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && settingsModalOverlay && settingsModalOverlay.style.display === 'flex') {
                settingsModalOverlay.style.display = 'none';
            }
        });

        var libraryViewReality = document.getElementById('libraryViewReality');
        var libraryViewSmart = document.getElementById('libraryViewSmart');
        function syncLibraryViewToggle() {
            var mode = getLibraryViewMode();
            if (libraryViewReality) libraryViewReality.classList.toggle('active', mode === 'reality');
            if (libraryViewSmart) libraryViewSmart.classList.toggle('active', mode === 'smart');
        }
        if (libraryViewReality && libraryViewSmart && emptyState && scanHistoryGrid && shelfNameInput) {
            syncLibraryViewToggle();
            libraryViewReality.addEventListener('click', function () {
                setLibraryViewMode('reality');
                syncLibraryViewToggle();
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            });
            libraryViewSmart.addEventListener('click', function () {
                setLibraryViewMode('smart');
                syncLibraryViewToggle();
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            });
            var libraryViewSmartHelp = document.getElementById('libraryViewSmartHelp');
            var smartSortHelpOverlay = document.getElementById('smartSortHelpOverlay');
            var smartSortHelpClose = document.getElementById('smartSortHelpClose');
            if (libraryViewSmartHelp && smartSortHelpOverlay) {
                libraryViewSmartHelp.addEventListener('click', function () {
                    smartSortHelpOverlay.style.display = 'flex';
                });
            }
            if (smartSortHelpClose && smartSortHelpOverlay) {
                smartSortHelpClose.addEventListener('click', function () { smartSortHelpOverlay.style.display = 'none'; });
                smartSortHelpOverlay.addEventListener('click', function (e) { if (e.target === smartSortHelpOverlay) smartSortHelpOverlay.style.display = 'none'; });
            }
        }

        function getAiAssistantMessage(view, tone) {
            var list = filterLibraryByView(library, view);
            var count = list.length;
            var isEmpty = count === 0;
            var overdueCount = 0;
            if (view === 'borrowed' || view === 'borrowedByMe') {
                list.forEach(function (b) { if (isDueSoonOrOverdue(b.returnDueDate).overdue) overdueCount++; });
            }
            var t = tone || getVoiceTone();
            if (t !== 'friendly' && t !== 'kind' && t !== 'funny' && t !== 'motivating' && t !== 'serious') t = 'friendly';
            var emptyMessages = {
                collection: { friendly: 'Je tu prázdno – přidej první knihu!', kind: 'Tvoje knihovna čeká na první tituly.', funny: 'Teda, tuhle poličku jsi neuklidila už věky! 😄', motivating: 'Začni přidávat. Každá kniha se počítá!', serious: 'Evidence knihovny je prázdná. Doporučuji přidat tituly.' },
                borrowedByMe: { friendly: 'Nemáš teď nic vypůjčené. Skvělé!', kind: 'Žádné aktivní výpůjčky.', funny: 'Žádné knížky na návštěvě – všechny doma. 📚', motivating: 'Přehled výpůjček je v pořádku.', serious: 'Žádné položky v sekci Mám vypůjčeno.' },
                borrowed: { friendly: 'Nikomu jsi nic nepůjčil – zatím.', kind: 'Sekce Půjčil/a jsem je prázdná.', funny: 'Knížky jsou všichni doma. Kdo by něco chtěl? 🏠', motivating: 'Až něco půjčíš, označ to tady.', serious: 'Evidence půjček je prázdná.' },
                wishlist: { friendly: 'Co si přeješ? Přidej to sem!', kind: 'Wishlist čeká na tvé sny.', funny: 'Seznam přání je prázdný. Kdo ti má co koupit? 🎁', motivating: 'Přidej první položku na wishlist.', serious: 'Wishlist je prázdný.' },
                currentlyReading: { friendly: 'Žádná rozečtená kniha. Co právě čteš?', kind: 'Rozečtené knihy si zaslouží vlastní sekci.', funny: 'Rozečteno = nula. Čas na první knížku! 📖', motivating: 'Přidej knihu, kterou čteš.', serious: 'Sekce Rozečteno je prázdná.' },
                forSale: { friendly: 'Nic na prodej. Chceš něco nabídnout?', kind: 'Žádné položky na prodej.', funny: 'Žádné knížky na odpis. To je dobře! 💰', motivating: 'Označ knihy jako Na prodej, až budeš chtít.', serious: 'Evidence na prodej je prázdná.' },
                favorites: { friendly: 'Zatím žádné srdcovky. Rozdej pár!', kind: 'Oblíbené knihy si přidej srdíčkem.', funny: 'Žádné srdce – knížky čekají na lásku. ❤️', motivating: 'Označ oblíbené srdíčkem.', serious: 'Kategorie oblíbených je prázdná.' },
                friendsHighlights: { friendly: 'Co doporučují přátelé? Inspiruj se!', kind: 'Doporučení od přátel mohou obohatit výběr.', funny: 'Kamarádi čtou taky? Koukni, co mají na poličce!', motivating: 'Sdílejte tipy na knihy.', serious: 'Sekce doporučení od známých.' }
            };
            var overdueMessages = {
                borrowedByMe: { friendly: 'Pozor, něco máš po termínu! Vrať to.', kind: 'Připomínám termíny vrácení.', funny: 'Ty knížky u tebe mají dovolenou už moc dlouho! 📚', motivating: 'Vrať v termínu – bude klid.', serious: 'Kontrola výpůjček: zkontrolujte termíny vrácení.' },
                borrowed: { friendly: 'Někdo má u sebe knihu po termínu. Dej vědět!', kind: 'Připomeňte vypůjčiteli termín vrácení.', funny: 'Knížky na cestách – a některé se ztratily v čase. 🏠', motivating: 'Projektuj si připomínky vrácení.', serious: 'Evidence půjček: zkontrolujte termíny.' }
            };
            if (isEmpty) {
                var byView = emptyMessages[view] || emptyMessages.collection;
                return byView[t] || byView.friendly;
            }
            if (overdueCount > 0 && (view === 'borrowedByMe' || view === 'borrowed')) {
                var overdueView = overdueMessages[view];
                if (overdueView) return overdueView[t] || overdueView.friendly;
            }
            var messages = {
                collection: { friendly: 'Hele, pěkná sbírka! Chceš ji roztřídit podle žánru?', kind: 'Tvoje knihovna vypadá skvěle. Mohu pomoci s přehledem.', funny: 'To je úctyhodná hora knih. Už jsi z nich něco přečetl? 😄', motivating: 'Skvělý základ. Přidej další a udržuj pořádek!', serious: 'Doporučuji systematické řazení podle žánru nebo autora.' },
                borrowedByMe: { friendly: 'Všechny vráť v pohodě – nebo si prodluž výpůjčku.', kind: 'Připomínám termíny vrácení. Knížky rády najdou cestu domů.', funny: 'Ty knížky u tebe mají dovolenou. Ať se včas vrací! 📚', motivating: 'Drž přehled o vypůjčkách. Vrácení v termínu = klid.', serious: 'Kontrola výpůjček: zkontrolujte termíny vrácení.' },
                borrowed: { friendly: 'Komu jsi co půjčil? Kdy to má vrátit?', kind: 'Půjčené knihy je dobré evidovat. Mohu pomoci s přehledem.', funny: 'Knížky na cestách – kdo má co? 🏠', motivating: 'Evidence půjček ti ušetří nervy. Drž to v kurzu.', serious: 'Doporučuji evidovat vypůjčitele a termíny vrácení.' },
                wishlist: { friendly: 'Co si přeješ pod stromeček? Přidej to sem!', kind: 'Wishlist je skvělé místo pro sny. Přidávej tituly.', funny: 'Seznam přání roste jako z vody. Kdo ti to koupí? 🎁', motivating: 'Každá položka na wishlistu je cíl. Drž se toho!', serious: 'Wishlist slouží k evidenci požadovaných titulů.' },
                currentlyReading: { friendly: 'Co právě čteš? Přidej rozečtené a sleduj pokrok.', kind: 'Rozečtené knihy si zaslouží vlastní sekci.', funny: 'Rozečteno = nedokončeno. A to je v pořádku! 📖', motivating: 'Sleduj svůj čtenářský pokrok. Dokončuj jednu po druhé.', serious: 'Sekce Rozečteno pomáhá sledovat průběh četby.' },
                forSale: { friendly: 'Prodej duplicity nebo staré kousky. Tržiště čeká!', kind: 'Položky na prodej mohou najít nového majitele.', funny: 'Knížky na odpis? Dej jim druhou šanci. 💰', motivating: 'Prodej nepotřebného a uvolni místo novým titulům.', serious: 'Evidence položek na prodej pro přehlednost.' },
                favorites: { friendly: 'Srdcovky – to jsou ty pravé. Přidávej další!', kind: 'Oblíbené knihy si zaslouží zvláštní místo.', funny: 'Tyhle bys nepůjčil ani za zlaté prase. ❤️', motivating: 'Označuj srdcem to, co tě opravdu baví.', serious: 'Kategorie oblíbených pro rychlý přístup.' },
                friendsHighlights: { friendly: 'Co doporučují přátelé? Inspiruj se!', kind: 'Doporučení od přátel mohou obohatit výběr.', funny: 'Kamarádi čtou taky? Koukni, co mají na poličce!', motivating: 'Sdílejte tipy na knihy. Čtení spojuje.', serious: 'Sekce doporučení od známých.' }
            };
            var byView = messages[view] || messages.collection;
            return byView[t] || byView.friendly;
        }
        function updateAiAssistantBubble() {
            var textEl = document.getElementById('aiAssistantBubbleText');
            if (!textEl) return;
            var view = getCurrentLibraryView();
            var tone = getVoiceTone();
            textEl.textContent = getAiAssistantMessage(view, tone);
        }
        // Umožní volání z upload modulu / wrapperů mimo init scope
        window.__OMNI_updateAiAssistantBubble = updateAiAssistantBubble;
        function getAiAssistantErrorMessage(tone) {
            var t = tone || getVoiceTone();
            var messages = {
                friendly: 'Něco se pokazilo při ukládání. Zkus to znovu.',
                kind: 'Omlouvám se, uložení se nezdařilo. Zkontroluj prosím a zkus to znovu.',
                funny: 'Něco se drhne, asi mi do čipů nateklo kafe! Zkus uložit znovu.',
                motivating: 'Tentokrát to nevyšlo. Zkus to znovu – vytrvej!',
                serious: 'Chyba ukládání. Zkontrolujte konzoli a zkuste operaci opakovat.'
            };
            return messages[t] || messages.friendly;
        }
        function flashAiAssistantText(text, ms) {
            var textEl = document.getElementById('aiAssistantBubbleText');
            if (!textEl) return;
            textEl.textContent = text;
            var wrap = document.getElementById('aiAssistantBubbleWrap');
            if (wrap) wrap.classList.add('ai-assistant-expanded');
            setTimeout(function () {
                updateAiAssistantBubble();
                if (wrap) wrap.classList.remove('ai-assistant-expanded');
            }, ms || 5000);
        }
        function getAiAssistantStorageMessage(kind, tone) {
            var t = tone || getVoiceTone();
            if (t !== 'friendly' && t !== 'kind' && t !== 'funny' && t !== 'motivating' && t !== 'serious') t = 'friendly';
            var byKind = {
                scanStart: {
                    friendly: 'Chytám fotku a počítám hřbety… chvíli vydrž.',
                    kind: 'Začínám skenovat. Chvilku prosím vydrž.',
                    funny: 'Nakrmuju oči fotkou… jdu lovit názvy!',
                    motivating: 'Jdeme na to. Sken běží!',
                    serious: 'Probíhá analýza obrázku (Vision).'
                },
                scanDone: {
                    friendly: 'Hotovo! Přidáno do knihovny.',
                    kind: 'Hotovo. Knihy jsem přidal do knihovny.',
                    funny: 'Hotovo! Knížky jsou doma v systému.',
                    motivating: 'Skvělé! Sken dokončen.',
                    serious: 'Analýza dokončena. Data byla uložena.'
                },
                slimming: {
                    friendly: 'Knížky prošly odtučňovací kúrou a už se do paměti vejdou.',
                    kind: 'Hotovo. Obálky jsem zmenšil, aby se pohodlně uložily do paměti.',
                    funny: 'Knížky prošly odtučňovací kúrou. Teď se do paměti vejdou jak po másle.',
                    motivating: 'Skvělé! Obálky jsou odlehčené a knihovna může růst dál.',
                    serious: 'Obálky byly komprimovány (JPEG) pro úsporu úložiště.'
                },
                trimMore: {
                    friendly: 'Paměť se plní… zmenšuji obálku víc.',
                    kind: 'Paměť je téměř plná. Zkusím obrázek ještě víc zmenšit.',
                    funny: 'Uf, ta fotka je trochu tlustá. Jdu ji osekat!',
                    motivating: 'Nevzdávám to. Ještě to zkomprimuju a zkusím uložit znovu.',
                    serious: 'QuotaExceeded: provádím další kompresi obrázku.'
                },
                storageFull: {
                    friendly: 'Polička je plná. Paměť prohlížeče nestačí – zkus uvolnit místo.',
                    kind: 'Omlouvám se, paměť prohlížeče je plná. Zkuste prosím uvolnit místo.',
                    funny: 'Polička je plná! Musíme knížky trochu osekat… nebo uvolnit místo v paměti.',
                    motivating: 'Paměť je na hraně. Uvolni trochu místa a zkus to znovu.',
                    serious: 'Uložení selhalo: lokální úložiště je plné (QuotaExceededError).'
                },
                tooManyDetailPhotos: {
                    friendly: 'Tři fotky stačí. Vyber prosím jen ty nejostřejší.',
                    kind: 'Stačí prosím maximálně tři fotky – obálka, hřbet, ISBN.',
                    funny: 'Tři fotky stačí, nejsme v National Geographic.',
                    motivating: 'Zvládneme to i se třemi fotkami. Vyber ty nejlepší!',
                    serious: 'Limit pro detailní sken je 3 fotografie.'
                }
            };
            var set = byKind[kind] || byKind.storageFull;
            return set[t] || set.friendly;
        }
        window.setAiAssistantError = function (err) {
            var textEl = document.getElementById('aiAssistantBubbleText');
            if (!textEl) return;
            var tone = getVoiceTone();
            textEl.textContent = getAiAssistantErrorMessage(tone);
            var wrap = document.getElementById('aiAssistantBubbleWrap');
            if (wrap) wrap.classList.add('ai-assistant-expanded');
            setTimeout(function () {
                updateAiAssistantBubble();
                if (wrap) wrap.classList.remove('ai-assistant-expanded');
            }, 5000);
        };
        window.setAiAssistantNotice = function (kind) {
            flashAiAssistantText(getAiAssistantStorageMessage(kind, getVoiceTone()), 5000);
        };
        document.addEventListener('library-view-changed', function () {
            updateAiAssistantBubble();
        });
        var aiAssistantBubbleWrap = document.getElementById('aiAssistantBubbleWrap');
        var aiAssistantBubbleToggle = document.getElementById('aiAssistantBubbleToggle');
        var aiAssistantBubblePanel = document.getElementById('aiAssistantBubblePanel');
        var aiAssistantBubbleReport = document.getElementById('aiAssistantBubbleReport');
        var aiAssistantBubbleInput = document.getElementById('aiAssistantBubbleInput');
        var aiAssistantBubbleSend = document.getElementById('aiAssistantBubbleSend');
        if (aiAssistantBubbleWrap && aiAssistantBubbleToggle) {
            aiAssistantBubbleWrap.classList.add('ai-assistant-visible');
            updateAiAssistantBubble();
            aiAssistantBubbleToggle.addEventListener('click', function () {
                aiAssistantBubbleWrap.classList.toggle('ai-assistant-expanded');
            });
        }
        if (aiAssistantBubbleReport) aiAssistantBubbleReport.addEventListener('click', function () {
            if (typeof window.OMNI_reportError === 'function') window.OMNI_reportError();
            else window.open('mailto:support@omnishelf.app?subject=Omshelf - nahlášení chyby', '_blank');
        });
        if (aiAssistantBubbleSend && aiAssistantBubbleInput) aiAssistantBubbleSend.addEventListener('click', function () {
            var q = (aiAssistantBubbleInput.value || '').trim();
            if (!q) return;
            updateAiAssistantBubble();
            aiAssistantBubbleInput.value = '';
        });
        if (aiAssistantBubbleInput && aiAssistantBubbleSend) aiAssistantBubbleInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') aiAssistantBubbleSend.click();
        });
        var wishlistBirthYearDisplay = document.getElementById('wishlistBirthYearDisplay');
        var wishlistBirthdayNoteEl = document.getElementById('wishlistBirthdayNote');
        if (wishlistBirthYearDisplay) {
            wishlistBirthYearDisplay.addEventListener('change', function () { setBirthYear(this.value); if (wishlistBirthdayNoteEl) wishlistBirthdayNoteEl.style.display = (this.value || '').trim() ? 'block' : 'none'; });
            wishlistBirthYearDisplay.addEventListener('input', function () { setBirthYear(this.value); if (wishlistBirthdayNoteEl) wishlistBirthdayNoteEl.style.display = (this.value || '').trim() ? 'block' : 'none'; });
        }

        function updateUploadTargetHint() {
            var view = getCurrentLibraryView();
            var labels = { collection: 'Tvoje sbírka', borrowedByMe: 'Mám vypůjčeno', borrowed: 'Půjčil/a jsem', wishlist: 'Wishlist', currentlyReading: 'Rozečteno', forSale: 'Na prodej', favorites: 'Srdcovky', friendsHighlights: 'Přátelé doporučují' };
            var el = document.getElementById('uploadTargetCategory');
            if (el) el.textContent = labels[view] || 'Tvoje sbírka';
        }
        updateUploadTargetHint();
        document.addEventListener('library-view-changed', updateUploadTargetHint);

        /* Lokální lupa u Moje knihovna – vysunutí pole, real-time filtr, auto-scroll */
        var scanHistoryHeader = document.getElementById('scanHistoryHeader');
        var searchToggleBtn = document.getElementById('searchToggleBtn');
        var librarySearchInput = document.getElementById('librarySearchInput');
        if (searchToggleBtn && scanHistoryHeader) {
            searchToggleBtn.addEventListener('click', function () {
                scanHistoryHeader.classList.toggle('search-open');
                if (scanHistoryHeader.classList.contains('search-open') && librarySearchInput) librarySearchInput.focus();
            });
        }
        if (librarySearchInput && scanHistoryGrid) {
            librarySearchInput.addEventListener('input', function () {
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            });
            librarySearchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    librarySearchInput.value = '';
                    if (scanHistoryHeader) scanHistoryHeader.classList.remove('search-open');
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                }
            });
        }

        /* Sekce Rozečteno – AI odpověď, karta doporučené knihy, navigace na polici */
        function setReadingAiResponse(message, book) {
            var el = document.getElementById('readingAiResponseText');
            var wrap = document.getElementById('readingAiResponse');
            if (el) el.textContent = (message && message.trim()) ? message : 'zde bude odpověď od AI';
            if (wrap) wrap.classList.toggle('has-text', !!(message && message.trim()));
            var cardWrap = document.getElementById('readingRecommendedCardWrap');
            if (!cardWrap) return;
            cardWrap.innerHTML = '';
            if (book) renderReadingRecommendedCard(book, cardWrap);
        }
        /** Vykreslí kartu doporučené knihy a možnost přidat ji do Rozečteno. */
        function renderReadingRecommendedCard(book, container) {
            if (!container || !book) return;
            var bookId = book.id || '';
            var card = document.createElement('div');
            card.className = 'book-card reading-recommended-card';
            card.setAttribute('data-book-id', bookId);
            var coverWrap = document.createElement('div');
            coverWrap.className = 'book-card-cover-wrap';
            var coverFrame = document.createElement('div');
            coverFrame.className = 'book-card-cover-frame';
            var coverImgSrc = (book.image || book.coverImage || '').toString().trim();
            if (coverImgSrc) {
                var img = document.createElement('img');
                img.src = coverImgSrc.indexOf('data:image') === 0 ? coverImgSrc : ('data:image/jpeg;base64,' + coverImgSrc);
                img.alt = escapeHtml(book.title || '');
                img.className = 'book-card-cover-img';
                coverFrame.appendChild(img);
            } else {
                var ph = document.createElement('span');
                ph.className = 'book-card-cover-placeholder';
                ph.textContent = 'Bez obálky';
                coverFrame.appendChild(ph);
            }
            coverWrap.appendChild(coverFrame);
            card.appendChild(coverWrap);
            var panel = document.createElement('div');
            panel.className = 'book-card-info-panel';
            var header = document.createElement('div');
            header.className = 'book-card-panel-header';
            var titleEl = document.createElement('div');
            titleEl.className = 'book-card-title';
            titleEl.textContent = book.title || '—';
            header.appendChild(titleEl);
            panel.appendChild(header);
            var authorEl = document.createElement('div');
            authorEl.className = 'book-card-author';
            authorEl.textContent = book.author || '';
            panel.appendChild(authorEl);

            var helper = document.createElement('div');
            helper.className = 'book-card-dynamic-row reading-recommended-location';
            helper.textContent = 'Tip: přidáním se kniha objeví v sekci Rozečteno.';
            panel.appendChild(helper);

            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'reading-add-to-reading-btn';
            addBtn.textContent = 'Přidat do Rozečteno';
            addBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var existing = null;
                if (bookId) existing = library.find(function (x) { return x.id === bookId; }) || null;
                if (!existing && typeof window.OMNI_CheckDuplicate === 'function') {
                    try {
                        var dup = window.OMNI_CheckDuplicate({ title: book.title || '', author: book.author || '', isbn: book.isbn || '' });
                        if (dup && dup.duplicate && dup.existingBook) existing = dup.existingBook;
                    } catch (e0) {}
                }
                if (!existing) {
                    helper.textContent = 'Tuto knihu nelze přidat: není uložena ve vaší knihovně.';
                    return;
                }
                var reading = (existing.readingStatus || '').toString().toLowerCase().replace(/\\s/g, '');
                var statusLower = (existing.status || '').toString().toLowerCase().replace(/\\s/g, '');
                if (reading === 'reading' || statusLower === 'reading') {
                    addBtn.disabled = true;
                    addBtn.textContent = 'Už je v Rozečteno';
                    return;
                }
                existing.readingStatus = 'reading';
                var ok = true;
                try { ok = saveToStorage(existing) !== false; } catch (e1) { ok = false; }
                if (!ok) {
                    helper.textContent = 'Uložení se nepodařilo (paměť prohlížeče je plná).';
                    return;
                }
                // UX: po přidání kartu zavřít (nezabírat místo) + obnovit seznam Rozečteno
                try { setReadingAiResponse('Hotovo. Kniha je v Rozečteno.', null); } catch (e2) {}
                refreshGrid();
            });
            panel.appendChild(addBtn);
            card.appendChild(panel);
            container.appendChild(card);
        }
        function getReadingAiSuggestion(options) {
            var genre = options && options.genre;
            var list = genre
                ? library.filter(function (b) {
                    var g = (b.genre || '').toLowerCase();
                    var genreMap = { detektivka: 'detektiv', scifi: 'sci-fi', romantika: 'romant', fantasy: 'fantasy', thriller: 'thriller' };
                    var key = genreMap[genre] || '';
                    return key && g.indexOf(key) !== -1;
                })
                : library.slice();
            if (list.length === 0) return { message: null, book: null };
            var book = list[Math.floor(Math.random() * list.length)];
            var shelf = (book.location || '').trim() || '— Bez poličky —';
            var title = book.title || 'tuhle knihu';
            var author = (book.author || '').trim() || '';
            var t = (typeof getVoiceTone === 'function' ? getVoiceTone() : 'friendly') || 'friendly';
            if (t !== 'friendly' && t !== 'kind' && t !== 'funny' && t !== 'motivating' && t !== 'serious') t = 'friendly';
            var byTone = {
                friendly: [
                    'Mám pro tebe tip, u kterého se ti rozzáří oči. Ve tvé sbírce je „' + title + '“' + (author ? ' od ' + author : '') + '. Najdeš ji na ' + shelf + '. Je to přesně ten typ knihy, který tě teď vtáhne – vřele ji doporučuji.',
                    'Doporučuji „' + title + '“' + (author ? ' od ' + author : '') + '. Leží na ' + shelf + '. Myslím, že se ti teď bude číst výborně.',
                    'V tvé knihovně je skvělý tip: „' + title + '“' + (author ? ' od ' + author : '') + '. Polička: ' + shelf + '. Pokud chceš něco, co tě chytí a nepustí, je to dobrá volba.',
                    'Mám pro tebe doporučení: „' + title + '“' + (author ? ' – ' + author : '') + '. Najdeš ji na ' + shelf + '. Podle nálady ti může sednout na jedničku.'
                ],
                kind: [
                    'Tvoje knihovna skrývá perlou: „' + title + '“' + (author ? ' od ' + author : '') + '. Leží na ' + shelf + '. Doporučuji ji s láskou – může ti přinést hezké chvíle.',
                    'Vezmi si k srdci „' + title + '“' + (author ? ' od ' + author : '') + '. Umístění: ' + shelf + '. Je to kniha, která si zaslouží tvou pozornost.',
                    '„' + title + '“' + (author ? ' od ' + author : '') + ' čeká na ' + shelf + '. Tichá radost pro tebe – doporučuji přečíst.',
                    'Nabízím ti „' + title + '“' + (author ? ' – ' + author : '') + ' z ' + shelf + '. Kniha, která může obohatit tvůj den.'
                ],
                funny: [
                    'Hele, tohle tě chytí! „' + title + '“' + (author ? ' od ' + author : '') + ' číhá na ' + shelf + '. Odtrhni se od mobilu a dej jí šanci – slibuju, že nebudeš litovat! 📚',
                    'Tahle knížka ti sedne jak ulitá: „' + title + '“' + (author ? ' od ' + author : '') + '. Hledej na ' + shelf + '. Ideální na teď – věř mi! 😄',
                    '„' + title + '“' + (author ? ' od ' + author : '') + ' – polička ' + shelf + '. Tvůj další oběť… teda čtení čeká! Ber ji a čti. 🎯',
                    'Mám pro tebe bombu: „' + title + '“' + (author ? ' – ' + author : '') + '. Leží na ' + shelf + '. Přesně to, co teď potřebuješ – jen to neodkládej na zítra!'
                ],
                motivating: [
                    'Jdeme na to! „' + title + '“' + (author ? ' od ' + author : '') + ' je na ' + shelf + '. Tvůj další krok ke skvělé knize – ber ji a čti!',
                    '„' + title + '“' + (author ? ' od ' + author : '') + ' – najdeš ji na ' + shelf + '. Každá přečtená stránka se počítá. Držím palce!',
                    'Vzchop se a sáhni po „' + title + '“' + (author ? ' od ' + author : '') + '. Polička: ' + shelf + '. Je čas na další skvělý příběh.',
                    'Tvé knihy čekají. Začni s „' + title + '“' + (author ? ' – ' + author : '') + ' na ' + shelf + '. Teď je ten správný moment!'
                ],
                serious: [
                    'Doporučení: „' + title + '“' + (author ? ' od ' + author : '') + '. Umístění: ' + shelf + '. Titul odpovídající současnému výběru.',
                    'Evidovaný titul „' + title + '“' + (author ? ' – ' + author : '') + ' na poličce ' + shelf + '. Vhodný pro aktuální četbu.',
                    '„' + title + '“' + (author ? ' od ' + author : '') + '. Lokace: ' + shelf + '. Doporučeno na základě struktury knihovny.',
                    'Záznam: „' + title + '“' + (author ? ' – ' + author : '') + '. Polička: ' + shelf + '. Relevantní pro současný kontext.'
                ]
            };
            var msgs = byTone[t] || byTone.friendly;
            return { message: msgs[Math.floor(Math.random() * msgs.length)], book: book };
        }
        function triggerReadingAi(options) {
            var result = getReadingAiSuggestion(options);
            var genreLabels = { detektivka: 'detektivku', scifi: 'sci-fi', romantika: 'romantiku', fantasy: 'fantasy', thriller: 'thriller' };
            var fallback = (options && options.genre)
                ? ('Mám rozečtenou nějakou ' + (genreLabels[options.genre] || options.genre) + '? Zatím nic takového u sebe nemáš – přidej knihy a napiš mi znovu.')
                : 'Zatím nemám co doporučit. Přidej několik knih a zkus to znovu.';
            setReadingAiResponse(result.message || fallback, result.book || null);
        }
        var readingAiQueryInput = document.getElementById('readingAiQueryInput');
        var readingSearchBtn = document.getElementById('readingSearchBtn');
        var readingAiResponseText = document.getElementById('readingAiResponseText');
        if (readingAiQueryInput) {
            readingAiQueryInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') triggerReadingAi({});
            });
        }
        if (readingSearchBtn) readingSearchBtn.addEventListener('click', function () { triggerReadingAi({}); });
        document.querySelectorAll('.reading-bubble').forEach(function (btn) {
            btn.addEventListener('click', function () { triggerReadingAi({ mood: btn.getAttribute('data-mood') }); });
        });
        document.querySelectorAll('.reading-mood-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { triggerReadingAi({ mood: btn.getAttribute('data-mood') }); });
        });
        document.querySelectorAll('.reading-genre-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { triggerReadingAi({ genre: btn.getAttribute('data-genre') }); });
        });

        var btnAddDetailAnalyze = document.getElementById('btnAddDetailAnalyze');
        if (btnAddDetailAnalyze) btnAddDetailAnalyze.addEventListener('click', function () {
            /* modal v main není – volitelně otevřít ruční formulář */
            openManualAddPanel();
            document.getElementById('manualAddForm') && document.getElementById('manualAddForm').scrollIntoView({ behavior: 'smooth' });
        });

        if (typeof window.OMNI_TextModule !== 'undefined' && window.OMNI_TextModule.initManualAddForm && manualAddForm && manualTitleInput && manualAuthorInput) {
            var locDefault = (manualLocationInput && manualLocationInput.value) ? manualLocationInput.value.trim() : '';
            if (!locDefault && shelfNameInput) locDefault = (shelfNameInput.value || '').trim();
            window.OMNI_TextModule.initManualAddForm({
                form: manualAddForm,
                titleInput: manualTitleInput,
                authorInput: manualAuthorInput,
                locationInput: manualLocationInput,
                positionInput: manualPositionInput,
                estimatedValueInput: manualEstimatedValueInput,
                isbnInput: manualIsbnInput,
                ownerSelect: manualOwnerSelect,
                wishlistBtn: btnAddWishlist
            }, {
                getOwnerOptions: function () { return familyProfiles; },
                onSubmit: function (record) {
                    var dup = checkDuplicate({ title: record.title, author: record.author, isbn: record.isbn || '' });
                    if (dup.duplicate && dup.existingBook && !window.confirm('Tato kniha už v rodinné knihovně je: „' + (dup.existingBook.title || '') + '“' + (dup.existingBook.author ? ' od ' + dup.existingBook.author : '') + '. Přidat i tak?')) return;
                    var location = record.location || (shelfNameInput ? shelfNameInput.value.trim() : '') || '— Bez poličky —';
                    if (scanHistory.length > 0) {
                        scanHistory[scanHistory.length - 1].books.push(record);
                    } else {
                        scanHistory.push({ date: new Date().toISOString(), books: [record] });
                    }
                    var newBook = {
                        id: generateBookId(),
                        title: record.title,
                        author: record.author,
                        genre: record.genre || '',
                        location: location,
                        physicalLocation: location,
                        virtualSort: [],
                        position: record.position || '',
                        originalLocation: location,
                        addedAt: new Date().toISOString(),
                        borrowedBy: '',
                        owner: record.owner,
                        estimatedValue: record.estimatedValue || '',
                        isFavorite: false,
                        isbn: record.isbn || '',
                        category: getCurrentSectorId(),
                        coverImage: ''
                    };
                    migrateBookToNewFields(newBook);
                    library.push(newBook);
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    saveToStorage(newBook);
                    refreshGrid();
                    if (successMessage) showSuccess('Kniha přidána.', successMessage);
                },
                onWishlist: function (record) {
                    wishlist.push({ title: record.title, author: record.author, isbn: record.isbn || '', coverImage: '', reservedBy: '' });
                    saveToStorage();
                    if (successMessage) showSuccess('Přidáno do wishlistu.', successMessage);
                }
            });
        } else if (manualOwnerSelect) {
            manualOwnerSelect.innerHTML = '';
            familyProfiles.forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.name || p.id;
                opt.textContent = p.name || p.id;
                if (p.id === currentProfileId) opt.selected = true;
                manualOwnerSelect.appendChild(opt);
            });
        }
        if (!window.OMNI_TextModule || !window.OMNI_TextModule.initManualAddForm) {
            if (manualAddForm && manualTitleInput && manualAuthorInput) {
                manualAddForm.addEventListener('submit', function (e) {
                    e.preventDefault();
                    var title = (manualTitleInput.value || '').trim();
                    var author = (manualAuthorInput.value || '').trim();
                    var location = (manualLocationInput && manualLocationInput.value) ? manualLocationInput.value.trim() : '';
                    if (!location && shelfNameInput) location = (shelfNameInput.value || '').trim();
                    var position = (manualPositionInput && manualPositionInput.value) ? manualPositionInput.value.trim() : '';
                    var estimatedValue = (manualEstimatedValueInput && manualEstimatedValueInput.value) ? manualEstimatedValueInput.value.trim() : '';
                    var isbn = (manualIsbnInput && manualIsbnInput.value) ? manualIsbnInput.value.trim().replace(/\s/g, '') : '';
                    var owner = (manualOwnerSelect && manualOwnerSelect.value) ? manualOwnerSelect.value.trim() : 'Já';
                    if (!title && !author) return;
                    var book = { title: title || 'Unknown', author: author || 'Unknown', location: location, position: position, isbn: isbn };
                    if (scanHistory.length > 0) scanHistory[scanHistory.length - 1].books.push(book);
                    else scanHistory.push({ date: new Date().toISOString(), books: [book] });
                    var loc = (book.location || '').trim() || '— Bez poličky —';
                    var fbBook = { id: generateBookId(), title: book.title, author: book.author, genre: '', location: loc, physicalLocation: loc, virtualSort: [], position: book.position || '', originalLocation: loc, addedAt: new Date().toISOString(), borrowedBy: '', owner: owner, estimatedValue: estimatedValue, isFavorite: false, isbn: isbn, category: getCurrentSectorId(), coverImage: '' };
                    migrateBookToNewFields(fbBook);
                    library.push(fbBook);
                    manualTitleInput.value = ''; manualAuthorInput.value = '';
                    if (manualLocationInput) manualLocationInput.value = ''; if (manualPositionInput) manualPositionInput.value = ''; if (manualEstimatedValueInput) manualEstimatedValueInput.value = ''; if (manualIsbnInput) manualIsbnInput.value = '';
                    renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                    saveToStorage(fbBook);
                    refreshGrid();
                    if (successMessage) showSuccess('Kniha přidána.', successMessage);
                });
            }
            if (btnAddWishlist && manualTitleInput && manualAuthorInput && manualIsbnInput) {
                btnAddWishlist.addEventListener('click', function () {
                    var title = (manualTitleInput.value || '').trim();
                    var author = (manualAuthorInput.value || '').trim();
                    var isbn = (manualIsbnInput.value || '').trim().replace(/\s/g, '');
                    if (!title && !author) return;
                    wishlist.push({ title: title || 'Unknown', author: author || 'Unknown', isbn: isbn || '', coverImage: '', reservedBy: '' });
                    manualTitleInput.value = ''; manualAuthorInput.value = ''; manualIsbnInput.value = '';
                    saveToStorage();
                    if (successMessage) showSuccess('Přidáno do wishlistu.', successMessage);
                });
            }
        }

        if (addBookBtn) addBookBtn.addEventListener('click', function () {
            openManualAddPanel();
            var f = document.getElementById('manualAddForm');
            if (f) f.scrollIntoView({ behavior: 'smooth' });
        });

        function refreshGrid() {
            var es = document.getElementById('emptyState');
            var grid = document.getElementById('scanHistoryGrid');
            var shelfInput = document.getElementById('shelfName');
            if (es && grid && shelfInput) renderScanHistory(es, grid, shelfInput);
            if (typeof updateAiAssistantBubble === 'function') updateAiAssistantBubble();
        }

        window.deleteBook = function (bookId) {
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            if (!confirm('Opravdu smazat knihu „' + (book.title || '').replace(/"/g, '') + '“?')) return;
            library = library.filter(function (b) { return b.id !== bookId; });
            saveToStorage();
            refreshGrid();
        };

        window.toggleAccordion = function () {
            var accordion = document.getElementById('editBookAccordionContent');
            var toggle = document.getElementById('editBookAccordionToggle');
            var wrapper = toggle && toggle.closest('.edit-book-accordion');
            if (!accordion || !wrapper) return;
            var isOpen = wrapper.classList.toggle('open');
            if (accordion) accordion.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        };

        window.toggleAudioRecording = function () {
            var btn = document.getElementById('editBookVoiceBtn');
            var waveform = document.getElementById('editBookWaveform');
            if (!btn || !waveform) return;
            var isRecording = btn.classList.toggle('recording');
            waveform.style.display = isRecording ? 'flex' : 'none';
            waveform.setAttribute('aria-hidden', isRecording ? 'false' : 'true');
        };

        window.openEditModal = function (bookId) {
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            var overlay = document.getElementById('editBookModalOverlay');
            if (!overlay) return;
            var titleEl = document.getElementById('editBookTitle');
            var authorEl = document.getElementById('editBookAuthor');
            var borrowedToEl = document.getElementById('editBookBorrowedTo');
            var borrowedWrap = document.getElementById('editBookBorrowedWrap');
            var genreEl = document.getElementById('editBookGenre');
            var yearEl = document.getElementById('editBookYear');
            var isbnEl = document.getElementById('editBookIsbn');
            var locationSelectEl = document.getElementById('editBookLocationSelect');
            var locationNewWrap = document.getElementById('editBookLocationNewWrap');
            var locationNewInput = document.getElementById('editBookLocationNew');
            var ownerEl = document.getElementById('editBookOwner');
            var positionEl = document.getElementById('editBookPosition');
            var estimatedValueEl = document.getElementById('editBookEstimatedValue');
            var summaryEl = document.getElementById('editBookAiSummary');
            var coverPreview = document.getElementById('editBookCoverPreview');
            var coverInput = document.getElementById('editBookCoverInput');
            var accordionWrapper = document.querySelector('.edit-book-accordion');
            var readingStatusEl = document.getElementById('editBookReadingStatus');
            var ownershipStatusEl = document.getElementById('editBookOwnershipStatus');
            var privacyEl = document.getElementById('editBookPrivacy');
            var ownership = book.ownershipStatus || book.status || 'mine';
            var reading = book.readingStatus || (book.status === 'reading' ? 'reading' : book.status === 'read' ? 'read' : 'unread');
            var privacy = book.privacy || 'private';
            if (titleEl) titleEl.value = book.title || '';
            if (authorEl) authorEl.value = book.author || '';
            if (readingStatusEl) readingStatusEl.value = reading;
            if (ownershipStatusEl) ownershipStatusEl.value = ownership;
            if (privacyEl) privacyEl.value = privacy;
            var borrowedByMeWrap = document.getElementById('editBookBorrowedByMeWrap');
            var returnDueEl = document.getElementById('editBookReturnDueDate');
            var borrowedFromEl = document.getElementById('editBookBorrowedFrom');
            var returnDueByMeEl = document.getElementById('editBookReturnDueDateByMe');
            if (borrowedToEl) borrowedToEl.value = book.borrowedTo || '';
            if (borrowedWrap) borrowedWrap.style.display = (ownership === 'borrowed') ? 'block' : 'none';
            if (borrowedByMeWrap) borrowedByMeWrap.style.display = (ownership === 'borrowedByMe') ? 'block' : 'none';
            if (returnDueEl) returnDueEl.value = (ownership === 'borrowed' && book.returnDueDate) ? (String(book.returnDueDate).slice(0, 10)) : '';
            var borrowedNoteEl = document.getElementById('editBookBorrowedNote');
            if (borrowedNoteEl) borrowedNoteEl.value = book.borrowedNote || '';
            if (borrowedFromEl) borrowedFromEl.value = book.borrowedFrom || '';
            if (returnDueByMeEl) returnDueByMeEl.value = (ownership === 'borrowedByMe' && book.returnDueDate) ? (String(book.returnDueDate).slice(0, 10)) : '';
            // Sekce pro návrat knihy
            var returnSection = document.getElementById('editBookReturnSection');
            var returnStatusEl = document.getElementById('editBookReturnStatus');
            var returnLocationEl = document.getElementById('editBookReturnLocation');
            if (returnSection && ownership === 'borrowed') {
                returnSection.style.display = 'block';
                if (returnStatusEl) returnStatusEl.value = 'borrowed';
                // Výchozí hodnota umístění - původní polička nebo aktuální location
                var originalLocation = book.originalLocation || book.location || '';
                if (returnLocationEl) returnLocationEl.value = originalLocation;
            } else if (returnSection) {
                returnSection.style.display = 'none';
            }
            if (genreEl) genreEl.value = book.genre || '';
            if (yearEl) yearEl.value = book.yearPublished || '';
            if (isbnEl) isbnEl.value = book.isbn || '';
            if (locationSelectEl) {
                var shelfNames = getShelfNamesList();
                locationSelectEl.innerHTML = '';
                shelfNames.forEach(function (sn) {
                    var opt = document.createElement('option');
                    opt.value = sn;
                    opt.textContent = sn;
                    locationSelectEl.appendChild(opt);
                });
                var newOpt = document.createElement('option');
                newOpt.value = '__new__';
                newOpt.textContent = '➕ Nová polička';
                locationSelectEl.appendChild(newOpt);
                var currentLoc = (book.location || book.physicalLocation || '').trim() || '— Bez poličky —';
                if (shelfNames.indexOf(currentLoc) !== -1) {
                    locationSelectEl.value = currentLoc;
                } else {
                    locationSelectEl.value = '__new__';
                    if (locationNewInput) locationNewInput.value = currentLoc !== '— Bez poličky —' ? currentLoc : '';
                }
                if (locationNewWrap) locationNewWrap.style.display = locationSelectEl.value === '__new__' ? 'block' : 'none';
            }
            if (ownerEl) ownerEl.value = book.owner || '';
            if (positionEl) positionEl.value = book.position || '';
            var readingProgressEl = document.getElementById('editBookReadingProgress');
            if (readingProgressEl) readingProgressEl.value = (book.readingProgress != null && book.readingProgress !== '') ? String(book.readingProgress) : '';
            if (estimatedValueEl) estimatedValueEl.value = book.estimatedValue || '';
            if (summaryEl) summaryEl.value = book.aiSummary || '';
            if (coverInput) coverInput.value = '';
            if (coverPreview) {
                var coverImgData = (book.image || book.coverImage || '').toString().trim();
                if (coverImgData && coverImgData.indexOf('data:image') === 0) {
                    coverPreview.innerHTML = '<img src="' + coverImgData.replace(/"/g, '&quot;') + '" alt="Obálka" />';
                } else if (coverImgData) {
                    coverPreview.innerHTML = '<img src="data:image/jpeg;base64,' + coverImgData.replace(/"/g, '&quot;') + '" alt="Obálka" />';
                } else {
                    coverPreview.innerHTML = '<span class="edit-book-cover-placeholder">Náhled obálky</span>';
                }
            }
            if (accordionWrapper) accordionWrapper.classList.remove('open');
            var accordionContent = document.getElementById('editBookAccordionContent');
            var accordionToggle = document.getElementById('editBookAccordionToggle');
            if (accordionContent) accordionContent.setAttribute('aria-hidden', 'true');
            if (accordionToggle) accordionToggle.setAttribute('aria-expanded', 'false');
            var voiceBtn = document.getElementById('editBookVoiceBtn');
            var waveform = document.getElementById('editBookWaveform');
            if (voiceBtn) voiceBtn.classList.remove('recording');
            if (waveform) { waveform.style.display = 'none'; waveform.setAttribute('aria-hidden', 'true'); }
            overlay.setAttribute('data-edit-book-id', bookId);
            var exposeBtn = document.getElementById('editBookModalExposeMarketplace');
            if (exposeBtn) {
                var o = (ownership || '').toLowerCase().replace(/\s/g, '');
                if (o === 'forsale' || o === 'daruji' || o === 'vymena') {
                    exposeBtn.textContent = 'Odebrat z Tržiště';
                    exposeBtn.title = 'Odebrat knihu z Moje police na tržišti';
                } else {
                    exposeBtn.textContent = 'Vystavit na Tržišti';
                    exposeBtn.title = 'Vystavit knihu na Tržišti (Na prodej)';
                }
            }
            overlay.style.display = 'flex';
            overlay.classList.add('show');
            if (titleEl) titleEl.focus();
        };

        window.closeEditModal = function () {
            var overlay = document.getElementById('editBookModalOverlay');
            if (overlay) {
                overlay.style.display = 'none';
                overlay.classList.remove('show');
                overlay.removeAttribute('data-edit-book-id');
            }
        };

        function saveEditModal() {
            var overlay = document.getElementById('editBookModalOverlay');
            if (!overlay) return;
            var bookId = overlay.getAttribute('data-edit-book-id');
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            var titleEl = document.getElementById('editBookTitle');
            var authorEl = document.getElementById('editBookAuthor');
            var readingStatusEl = document.getElementById('editBookReadingStatus');
            var ownershipStatusEl = document.getElementById('editBookOwnershipStatus');
            var privacyEl = document.getElementById('editBookPrivacy');
            var borrowedToEl = document.getElementById('editBookBorrowedTo');
            var genreEl = document.getElementById('editBookGenre');
            var yearEl = document.getElementById('editBookYear');
            var isbnEl = document.getElementById('editBookIsbn');
            var ownerEl = document.getElementById('editBookOwner');
            var positionEl = document.getElementById('editBookPosition');
            var estimatedValueEl = document.getElementById('editBookEstimatedValue');
            var summaryEl = document.getElementById('editBookAiSummary');
            if (titleEl) book.title = (titleEl.value || '').trim() || '—';
            if (authorEl) book.author = (authorEl.value || '').trim();
            var returnDueEl = document.getElementById('editBookReturnDueDate');
            var borrowedFromEl = document.getElementById('editBookBorrowedFrom');
            var returnDueByMeEl = document.getElementById('editBookReturnDueDateByMe');
            if (readingStatusEl) book.readingStatus = (readingStatusEl.value || 'unread').trim();
            var newOwnership = ownershipStatusEl ? (ownershipStatusEl.value || 'mine').trim() : (book.ownershipStatus || 'mine');
            if ((book.ownershipStatus || '').toLowerCase() === 'borrowed' && newOwnership.toLowerCase() !== 'borrowed' && (book.borrowedTo || '').trim()) {
                book.borrowedHistory = book.borrowedHistory || [];
                book.borrowedHistory.push({ to: (book.borrowedTo || '').trim(), dateTo: book.returnDueDate || '' });
            }
            if (ownershipStatusEl) book.ownershipStatus = newOwnership;
            if (privacyEl) book.privacy = (privacyEl.value || 'private').trim();
            book.status = book.ownershipStatus;
            if (borrowedToEl) book.borrowedTo = (borrowedToEl.value || '').trim();
            if (book.ownershipStatus === 'borrowed' && returnDueEl) book.returnDueDate = (returnDueEl.value || '').trim() || undefined;
            var borrowedNoteEl = document.getElementById('editBookBorrowedNote');
            if (borrowedNoteEl && book.ownershipStatus === 'borrowed') book.borrowedNote = (borrowedNoteEl.value || '').trim() || undefined;
            if (book.ownershipStatus === 'borrowedByMe') {
                book.location = 'Půjčená literatura';
                book.physicalLocation = book.location;
                if (borrowedFromEl) book.borrowedFrom = (borrowedFromEl.value || '').trim();
                if (returnDueByMeEl) book.returnDueDate = (returnDueByMeEl.value || '').trim() || undefined;
            } else {
                book.borrowedFrom = undefined;
                if (book.ownershipStatus !== 'borrowed') book.returnDueDate = undefined;
            }
            // Zpracování návratu knihy (změna stavu z "Půjčeno" na "Doma")
            var returnStatusEl = document.getElementById('editBookReturnStatus');
            var returnLocationEl = document.getElementById('editBookReturnLocation');
            var locationSetByReturn = false;
            if (returnStatusEl && returnLocationEl && book.ownershipStatus === 'borrowed') {
                var returnStatus = (returnStatusEl.value || '').trim();
                if (returnStatus === 'returned') {
                    locationSetByReturn = true;
                    book.ownershipStatus = 'mine';
                    book.status = 'mine';
                    if (!book.originalLocation && book.location) {
                        book.originalLocation = book.location;
                    }
                    var newLocation = (returnLocationEl.value || '').trim();
                    if (newLocation) {
                        book.location = newLocation;
                        book.physicalLocation = newLocation;
                    } else if (book.originalLocation) {
                        book.location = book.originalLocation;
                        book.physicalLocation = book.originalLocation;
                    }
                    if (!book.borrowedHistory) book.borrowedHistory = [];
                    book.borrowedHistory.push({
                        to: (book.borrowedTo || '').trim(),
                        dateTo: book.returnDueDate || '',
                        returnedAt: new Date().toISOString()
                    });
                    book.borrowedTo = undefined;
                    book.returnDueDate = undefined;
                    book.borrowedNote = undefined;
                }
            }
            if (genreEl) book.genre = (genreEl.value || '').trim();
            if (yearEl) book.yearPublished = (yearEl.value || '').trim();
            if (isbnEl) book.isbn = (isbnEl.value || '').trim().replace(/\s/g, '');
            var locationSelectEl = document.getElementById('editBookLocationSelect');
            var locationNewInput = document.getElementById('editBookLocationNew');
            if (!locationSetByReturn && book.ownershipStatus !== 'borrowed' && book.ownershipStatus !== 'borrowedByMe') {
                var locVal = '';
                if (locationSelectEl) {
                    locVal = locationSelectEl.value === '__new__'
                        ? (locationNewInput ? (locationNewInput.value || '').trim() : '')
                        : (locationSelectEl.value || '').trim();
                }
                book.location = locVal || '— Bez poličky —';
                book.physicalLocation = book.location;
            }
            if (ownerEl) book.owner = (ownerEl.value || '').trim();
            if (positionEl) book.position = (positionEl.value || '').trim();
            var readingProgressEl = document.getElementById('editBookReadingProgress');
            if (readingProgressEl) {
                var prog = parseInt(readingProgressEl.value, 10);
                book.readingProgress = (isNaN(prog) || prog < 0 || prog > 100) ? undefined : prog;
            }
            if (estimatedValueEl) book.estimatedValue = (estimatedValueEl.value || '').trim();
            if (summaryEl) book.aiSummary = (summaryEl.value || '').trim();
            try {
                saveToStorage(book);
                refreshGrid();
                closeEditModal();
            } catch (err) {
                console.error('saveEditModal', err);
                if (typeof setAiAssistantError === 'function') setAiAssistantError(err);
            }
            // Pokud byla kniha vrácena, aktualizovat zobrazení sekce "Půjčil/a jsem"
            var returnStatusElCheck = document.getElementById('editBookReturnStatus');
            if (returnStatusElCheck && returnStatusElCheck.value === 'returned') {
                var currentView = getCurrentLibraryView();
                if (currentView === 'borrowed') {
                    renderBorrowedSection(library);
                }
            }
        }

        window.toggleBookFavorite = function (bookId) {
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            book.is_favorite = !(book.is_favorite || book.isFavorite);
            book.isFavorite = book.is_favorite;
            saveToStorage(book);
            refreshGrid();
        };

        function updateScanHistory() {
            var filtered = currentBooks.filter(function (b) { return (b.title || '').trim() || (b.author || '').trim(); });
            if (scanHistory.length > 0 && filtered.length > 0) {
                scanHistory[scanHistory.length - 1].books = filtered.map(function (b) { return { title: (b.title || '').trim() || 'Unknown', author: (b.author || '').trim() || 'Unknown', location: (b.location || '').trim(), position: (b.position || '').trim(), isbn: (b.isbn || '').trim() }; });
                renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
            }
            saveLibrary();
        }

        var editBookModalOverlay = document.getElementById('editBookModalOverlay');
        var editBookModalClose = document.getElementById('editBookModalClose');
        var editBookModalSave = document.getElementById('editBookModalSave');
        if (editBookModalOverlay) {
            editBookModalOverlay.addEventListener('click', function (e) {
                if (e.target === editBookModalOverlay) closeEditModal();
            });
        }
        if (editBookModalClose) editBookModalClose.addEventListener('click', closeEditModal);
        if (editBookModalSave) editBookModalSave.addEventListener('click', saveEditModal);
        var editBookModalExposeMarketplace = document.getElementById('editBookModalExposeMarketplace');
        if (editBookModalExposeMarketplace) {
            editBookModalExposeMarketplace.addEventListener('click', function () {
                var overlay = document.getElementById('editBookModalOverlay');
                if (!overlay) return;
                var bookId = overlay.getAttribute('data-edit-book-id');
                var book = library.find(function (b) { return b.id === bookId; });
                if (!book) return;
                var ownership = (book.ownershipStatus || book.status || '').toLowerCase().replace(/\s/g, '');
                var isOnMarketplace = (ownership === 'forsale' || ownership === 'daruji' || ownership === 'vymena');
                if (isOnMarketplace) {
                    book.ownershipStatus = 'mine';
                    book.status = 'mine';
                } else {
                    book.ownershipStatus = 'forSale';
                    book.status = 'forSale';
                    if (!book.estimatedValue) book.estimatedValue = '';
                }
                var ok = true;
                try { ok = saveToStorage(book) !== false; } catch (e0) { ok = false; }
                if (!ok) {
                    try { if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice('storageFull'); } catch (e1) {}
                    return;
                }
                saveLibrary();
                refreshGrid();
                closeEditModal();
                if (typeof window.loadMarketplaceContent === 'function') window.loadMarketplaceContent();
                if (typeof syncMarketplaceMyShelf === 'function') syncMarketplaceMyShelf();
                if (!isOnMarketplace) {
                    var btnMarketplaceEl = document.getElementById('btnMarketplace');
                    if (btnMarketplaceEl) btnMarketplaceEl.click();
                    setTimeout(function () {
                        if (typeof syncMarketplaceMyShelf === 'function') syncMarketplaceMyShelf();
                        var el = document.getElementById('marketplaceMyShelfSection');
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 200);
                }
            });
        }

        var editBookModalShareMarketplace = document.getElementById('editBookModalShareMarketplace');
        if (editBookModalShareMarketplace) {
            editBookModalShareMarketplace.addEventListener('click', function () {
                var overlay = document.getElementById('editBookModalOverlay');
                if (!overlay) return;
                var bookId = overlay.getAttribute('data-edit-book-id');
                var book = library.find(function (b) { return b.id === bookId; });
                if (!book) return;
                var titleEl = document.getElementById('editBookTitle');
                var authorEl = document.getElementById('editBookAuthor');
                var title = (titleEl && titleEl.value) ? titleEl.value.trim() : (book.title || '').trim() || '-';
                var author = (authorEl && authorEl.value) ? authorEl.value.trim() : (book.author || '').trim() || '-';
                var item = { id: 'shared-' + Date.now(), _ts: Date.now(), title: title, author: author, status: 'k-zapujceni', bubble: 'Doporučuji, skvělý stav.' };
                addToSharedMarketplace(item);
                closeEditModal();
                var btnMarketplaceEl = document.getElementById('btnMarketplace');
                if (btnMarketplaceEl) btnMarketplaceEl.click();
                if (typeof injectSharedMarketplaceCards === 'function') setTimeout(injectSharedMarketplaceCards, 150);
            });
        }

        var editBookLocationSelect = document.getElementById('editBookLocationSelect');
        var editBookLocationNewWrap = document.getElementById('editBookLocationNewWrap');
        if (editBookLocationSelect && editBookLocationNewWrap) {
            editBookLocationSelect.addEventListener('change', function () {
                editBookLocationNewWrap.style.display = this.value === '__new__' ? 'block' : 'none';
            });
        }

        var editBookOwnershipStatus = document.getElementById('editBookOwnershipStatus');
        var editBookBorrowedWrap = document.getElementById('editBookBorrowedWrap');
        var editBookBorrowedByMeWrap = document.getElementById('editBookBorrowedByMeWrap');
        if (editBookOwnershipStatus) {
            function updateBorrowedWraps() {
                var v = editBookOwnershipStatus.value;
                if (editBookBorrowedWrap) editBookBorrowedWrap.style.display = (v === 'borrowed') ? 'block' : 'none';
                if (editBookBorrowedByMeWrap) editBookBorrowedByMeWrap.style.display = (v === 'borrowedByMe') ? 'block' : 'none';
            }
            editBookOwnershipStatus.addEventListener('change', updateBorrowedWraps);
        }

        window.quickSetBookStatus = function (bookId, newStatus) {
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            var ownership = (book.ownershipStatus || book.status || '').toLowerCase();
            var key = newStatus.toLowerCase();
            if (ownership === key) {
                book.ownershipStatus = 'mine';
                book.status = 'mine';
                if (key === 'borrowed') book.borrowedTo = '';
                if (key === 'borrowedbyme') book.borrowedFrom = '';
                book.returnDueDate = undefined;
            } else {
                book.ownershipStatus = key === 'forsale' ? 'forSale' : key === 'borrowed' ? 'borrowed' : key === 'wishlist' ? 'wishlist' : key === 'borrowedbyme' ? 'borrowedByMe' : book.ownershipStatus;
                book.status = book.ownershipStatus;
                if (key === 'forsale' && !book.estimatedValue) book.estimatedValue = '';
            }
            saveLibrary();
            refreshGrid();
        };

        function applyReadingViewVisibility() {
            var view = getCurrentLibraryView();
            var isReading = view === 'currentlyReading';
            var isCollection = view === 'collection';
            var wrap = document.getElementById('readingViewWrap');
            var uploadCards = document.getElementById('libraryUploadTwoCards');
            var manualForm = document.getElementById('manualAddForm');
            var scanHeader = document.getElementById('scanHistoryHeader');
            var scanSection = document.getElementById('scanHistorySection');
            var friendsSection = document.getElementById('friendsRecommendationsSection');
            if (wrap) { wrap.style.display = isReading ? 'block' : 'none'; wrap.setAttribute('aria-hidden', isReading ? 'false' : 'true'); }
            if (uploadCards) uploadCards.style.display = '';
            if (manualForm) manualForm.style.display = '';
            if (scanHeader) scanHeader.style.display = 'flex';
            var borrowedPanel = document.getElementById('borrowedTopPanel');
            if (borrowedPanel) borrowedPanel.style.display = view === 'borrowed' ? 'block' : 'none';
            var borrowedByMePanel = document.getElementById('borrowedByMePanel');
            if (borrowedByMePanel) borrowedByMePanel.style.display = view === 'borrowedByMe' ? 'block' : 'none';
            var forSalePanel = document.getElementById('forSaleTopPanel');
            if (forSalePanel) forSalePanel.style.display = view === 'forSale' ? 'block' : 'none';
            var friendsInterests = document.getElementById('friendsInterestsSection');
            if (friendsInterests) friendsInterests.style.display = view === 'forSale' ? 'block' : 'none';
            var scanTitle = document.getElementById('scanHistoryTitle');
            var titleText = view === 'borrowed' ? 'Půjčil/a jsem'
                : view === 'borrowedByMe' ? 'Co mám půjčené'
                : view === 'favorites' ? 'Srdcovky'
                : view === 'wishlist' ? 'Wishlist'
                : view === 'forSale' ? 'Na prodej'
                : view === 'currentlyReading' ? 'Vaše rozečtené knihy'
                : 'Moje knihovna';
            if (scanTitle) scanTitle.textContent = titleText;
            var sub = document.getElementById('scanHistorySubtitle');
            if (sub) {
                if (view === 'favorites') sub.textContent = 'Moje srdcovky – seznam oblíbených knih. Vyhledávání se týká pouze této sekce.';
                else if (view === 'wishlist') sub.textContent = 'Polička přání – vyhledávejte napříč knihovnou a přidávejte knihy do seznamu přání.';
                else if (view === 'forSale') sub.textContent = 'Vyberte knihu k prodeji a spravujte svůj „virtuální stánek“.';
                else if (view === 'currentlyReading') sub.textContent = 'Knihy, které právě čtete, a historie dočtených.';
                else sub.textContent = '';
            }

            // Zjednodušit hlavičku (bez přepínače režimu a bez extra řazení) – Srdcovky/Wishlist/Mám vypůjčeno/Rozečteno
            var viewToggle = document.getElementById('libraryViewToggle');
            var sortWrap = scanHeader ? scanHeader.querySelector('.scan-history-sort-wrap') : null;
            if (viewToggle) viewToggle.style.display = (view === 'favorites' || view === 'wishlist' || view === 'borrowedByMe' || view === 'currentlyReading') ? 'none' : '';
            if (sortWrap) sortWrap.style.display = (view === 'favorites' || view === 'wishlist' || view === 'borrowedByMe' || view === 'currentlyReading') ? 'none' : '';

            // Srdcovky/Wishlist: vyhledávání je primární – otevřít pole a nastavit jasný placeholder
            var librarySearchInput = document.getElementById('librarySearchInput');
            if (scanHeader) {
                if (view === 'favorites' || view === 'wishlist') scanHeader.classList.add('search-open');
            }
            if (librarySearchInput) {
                librarySearchInput.placeholder = (view === 'favorites')
                    ? 'Vyhledat v srdcovkách (název, autor)…'
                    : (view === 'wishlist')
                        ? 'Hledat v knihovně a přidat do Wishlistu (název, autor)…'
                        : 'Hledat podle názvu nebo autora…';
            }
            var searchWrap = document.getElementById('searchFieldSlide');
            if (searchWrap && searchWrap.closest('.scan-history-search-wrap')) {
                searchWrap.closest('.scan-history-search-wrap').style.display = (view === 'borrowedByMe') ? 'none' : '';
            }
            /* Panel „Tento sken“ pouze v Tvoje sbírka a jen když je na pracovní ploše něco k schválení */
            var resultsSectionWrap = document.getElementById('resultsSectionWrap');
            var currentBooksList = getUploadFlowCtx().getCurrentBooks ? (getUploadFlowCtx().getCurrentBooks() || []) : [];
            if (resultsSectionWrap) resultsSectionWrap.style.display = (view === 'collection' && currentBooksList.length > 0) ? 'block' : 'none';
            var resultsSection = document.getElementById('resultsSection');
            if (resultsSection) resultsSection.style.display = (view === 'collection') ? '' : 'none';
            var alarmBar = document.getElementById('borrowedAlarmBar');
            if (alarmBar) alarmBar.style.display = 'none';
            var messagesPanel = document.getElementById('borrowedMessagesPanel');
            if (messagesPanel) messagesPanel.style.display = 'none';
            if (scanSection) {
                scanSection.classList.toggle('view-currently-reading', isReading);
                scanSection.classList.toggle('view-borrowed', view === 'borrowed');
                scanSection.classList.toggle('view-borrowed-by-me', view === 'borrowedByMe');
                scanSection.classList.toggle('view-favorites', view === 'favorites');
            scanSection.classList.toggle('favorites-bulk-select', !!favoritesBulkSelectMode);
            }
            var contentWrap = document.getElementById('scanHistoryContent');
            if (contentWrap) {
                contentWrap.style.display = 'block';
                contentWrap.style.visibility = 'visible';
                contentWrap.style.minHeight = view === 'borrowed' ? '200px' : '';
                contentWrap.classList.toggle('policka-vedle-active', view === 'borrowedByMe');
                contentWrap.classList.toggle('borrowed-shelf-view', view === 'borrowedByMe');
            }
            var polickaVedleTitle = document.getElementById('polickaVedleTitle');
            if (polickaVedleTitle) {
                polickaVedleTitle.style.display = view === 'borrowedByMe' ? 'block' : 'none';
                if (view === 'borrowedByMe') polickaVedleTitle.textContent = 'Police od vedle (vypůjčené knížky)';
            }
            var emptyEl = document.getElementById('emptyState');
            var gridEl = document.getElementById('scanHistoryGrid');
            if (view === 'borrowed') {
                if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.style.visibility = 'visible'; }
                if (gridEl) gridEl.style.display = '';
            }
            if (view === 'borrowedByMe') {
                if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.style.visibility = 'visible'; }
                if (gridEl) gridEl.style.display = '';
            }
            /* Radikální řez v tabech: Texty POUZE v Tvoje sbírka; Wishlist/Mám vypůjčeno/Na prodej = jen Upload; Rozečteno/Půjčil/a = bez uploadu */
            var libraryModulesWrap = document.getElementById('libraryModulesWrap');
            var libraryModuleTabs = document.querySelector('.library-module-tabs');
            var libraryTabTexty = document.getElementById('libraryTabTexty');
            var libraryTabUpload = document.getElementById('libraryTabUpload');
            var libraryModuleTexty = document.getElementById('libraryModuleTexty');
            var libraryModuleUpload = document.getElementById('libraryModuleUpload');
            var uploadOnlyViews = { wishlist: true, borrowedByMe: true, forSale: true, favorites: true };
            var noUploadViews = { currentlyReading: true, borrowed: true };
            // Friends Highlights: vlastní interaktivní stránka (bez upload/text panelu, bez klasické knihovny)
            if (friendsSection) friendsSection.style.display = (view === 'friendsHighlights') ? 'block' : 'none';
            if (scanSection) scanSection.style.display = (view === 'friendsHighlights') ? 'none' : '';
            if (view === 'friendsHighlights') {
                if (libraryModulesWrap) libraryModulesWrap.style.display = 'none';
            } else if (noUploadViews[view]) {
                if (libraryModulesWrap) libraryModulesWrap.style.display = 'none';
            } else {
                if (libraryModulesWrap) libraryModulesWrap.style.display = '';
                if (uploadOnlyViews[view]) {
                    if (libraryModuleTabs) libraryModuleTabs.style.display = 'none';
                    if (libraryTabTexty) libraryTabTexty.style.display = 'none';
                    if (libraryTabUpload) libraryTabUpload.style.display = '';
                    if (libraryModuleTexty) libraryModuleTexty.hidden = true;
                    if (libraryModuleUpload) libraryModuleUpload.hidden = false;
                    if (libraryTabUpload) libraryTabUpload.classList.add('active');
                    if (libraryTabUpload) libraryTabUpload.setAttribute('aria-selected', 'true');
                } else {
                    if (libraryModuleTabs) libraryModuleTabs.style.display = '';
                    if (libraryTabTexty) libraryTabTexty.style.display = '';
                    if (libraryTabUpload) libraryTabUpload.style.display = '';
                }
            }
            var wishlistBirthdayBanner = document.getElementById('wishlistBirthdayBanner');
            if (wishlistBirthdayBanner) wishlistBirthdayBanner.style.display = (view === 'wishlist' && isWishlistBirthdayOpen()) ? 'block' : 'none';
            var wishlistBirthyearRow = document.getElementById('wishlistBirthyearRow');
            if (wishlistBirthyearRow) wishlistBirthyearRow.style.display = view === 'wishlist' ? 'block' : 'none';
            var wishlistBirthYearDisplay = document.getElementById('wishlistBirthYearDisplay');
            if (wishlistBirthYearDisplay && view === 'wishlist') wishlistBirthYearDisplay.value = getBirthYear();
            var wishlistBirthdayNote = document.getElementById('wishlistBirthdayNote');
            if (wishlistBirthdayNote) wishlistBirthdayNote.style.display = (view === 'wishlist' && getBirthYear()) ? 'block' : 'none';
        }
        document.addEventListener('library-view-changed', function () {
            applyReadingViewVisibility();
            refreshGrid();
        });
        applyReadingViewVisibility();

        var selectedBookIdForBorrowed = null;

        /** Budoucí použití: Fórum, Tržiště, Půjčovna. context: 'borrowed' | 'forum' | 'trziste' | 'pujcovna' */
        window.itemChat = window.itemChat || {};
        window.itemChat.render = function (container, options) {
            var context = (options && options.context) || 'borrowed';
            var itemId = (options && options.itemId) || '';
            var messages = Array.isArray(options && options.messages) ? options.messages : [];
            container.innerHTML = '';
            container.setAttribute('data-context', context);
            container.setAttribute('data-item-id', itemId);
            if (messages.length === 0) {
                var p = document.createElement('p');
                p.className = 'item-chat-placeholder';
                p.textContent = 'Tu sa budu zobrazovat bodouci odkazy ke knize, pod sebou - jmeno pisatele: odkaz, a moznost soukrome nebo pridat k referenci knihy.';
                container.appendChild(p);
            } else {
                messages.forEach(function (msg, idx) {
                    var block = document.createElement('div');
                    block.className = 'item-chat-message';
                    var textEl = document.createElement('p');
                    textEl.className = 'item-chat-message-text';
                    textEl.textContent = typeof msg === 'string' ? msg : (msg.text || msg.body || '');
                    block.appendChild(textEl);
                    var btnRow = document.createElement('div');
                    btnRow.className = 'item-chat-message-actions';
                    var addRefBtn = document.createElement('button');
                    addRefBtn.type = 'button';
                    addRefBtn.className = 'item-chat-reply-btn';
                    addRefBtn.textContent = 'přidat k referenci knihy';
                    addRefBtn.addEventListener('click', function (e) { e.stopPropagation(); });
                    var thankBtn = document.createElement('button');
                    thankBtn.type = 'button';
                    thankBtn.className = 'item-chat-reply-btn';
                    thankBtn.textContent = 'poslat poděkování za zprávu';
                    thankBtn.setAttribute('data-context', context);
                    thankBtn.setAttribute('data-item-id', itemId);
                    thankBtn.setAttribute('data-message-index', String(idx));
                    thankBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (typeof window.itemChat.openReplyModal === 'function') {
                            window.itemChat.openReplyModal({ context: context, itemId: itemId, messageIndex: idx, message: msg });
                        } else {
                            openItemChatReplyModal({ context: context, itemId: itemId, messageIndex: idx, message: msg });
                        }
                    });
                    btnRow.appendChild(addRefBtn);
                    btnRow.appendChild(thankBtn);
                    block.appendChild(btnRow);
                    container.appendChild(block);
                });
            }
        };

        function renderItemChatInline(container, bookId, messages) {
            window.itemChat.render(container, { context: 'borrowed', itemId: bookId, messages: messages });
        }

        function openItemChatReplyModal(opts) {
            var overlay = document.getElementById('itemChatReplyModalOverlay');
            var textarea = document.getElementById('itemChatReplyModalText');
            var sendBtn = document.getElementById('itemChatReplyModalSend');
            var closeBtn = document.getElementById('itemChatReplyModalClose');
            if (!overlay || !textarea) return;
            overlay.setAttribute('data-context', opts.context || '');
            overlay.setAttribute('data-item-id', opts.itemId || '');
            overlay.setAttribute('data-message-index', String(opts.messageIndex != null ? opts.messageIndex : ''));
            textarea.value = '';
            textarea.placeholder = 'Napište vzkaz adresátovi…';
            overlay.style.display = 'flex';
            if (sendBtn) {
                sendBtn.onclick = function () {
                    var text = (textarea.value || '').trim();
                    if (!text) return;
                    var book = library.find(function (b) { return b.id === opts.itemId; });
                    if (book && Array.isArray(book.borrowedMessages)) {
                        book.borrowedMessages.push({ text: text, from: 'me', at: new Date().toISOString() });
                        saveLibrary();
                    }
                    overlay.style.display = 'none';
                    renderScanHistory(emptyState, document.getElementById('scanHistoryGrid'), document.getElementById('shelfNameInput'));
                };
            }
            if (closeBtn) closeBtn.onclick = function () { overlay.style.display = 'none'; };
        }
        window.itemChat.openReplyModal = openItemChatReplyModal;

        function refreshBorrowedMessagesPanel(bookId) {
            var body = document.getElementById('borrowedMessagesBody');
            if (!body) return;
            body.innerHTML = '';
            if (!bookId) {
                body.appendChild(document.createTextNode('Klikněte na knihu pro zobrazení vzkazů a referencí.'));
                var panel = body.closest('.borrowed-messages-panel');
                var globalActions = panel && panel.querySelector(':scope > .borrowed-messages-actions');
                if (globalActions) globalActions.style.display = 'block';
                return;
            }
            var book = library.find(function (b) { return b.id === bookId; });
            var messages = (book && Array.isArray(book.borrowedMessages)) ? book.borrowedMessages : [];
            if (messages.length === 0) {
                var p = document.createElement('p');
                p.className = 'borrowed-messages-placeholder';
                p.textContent = 'Zatím žádné vzkazy k této knize.';
                body.appendChild(p);
            } else {
                messages.forEach(function (msg, idx) {
                    var block = document.createElement('div');
                    block.className = 'borrowed-message-item';
                    var textEl = document.createElement('p');
                    textEl.className = 'borrowed-message-text';
                    textEl.textContent = typeof msg === 'string' ? msg : (msg.text || msg.body || '');
                    block.appendChild(textEl);
                    var btnRow = document.createElement('div');
                    btnRow.className = 'borrowed-messages-actions';
                    var addRefBtn = document.createElement('button');
                    addRefBtn.type = 'button';
                    addRefBtn.className = 'borrowed-msg-btn';
                    addRefBtn.textContent = 'přidat k referenci knihy';
                    var thankBtn = document.createElement('button');
                    thankBtn.type = 'button';
                    thankBtn.className = 'borrowed-msg-btn';
                    thankBtn.textContent = 'poslat poděkování za zprávu';
                    btnRow.appendChild(addRefBtn);
                    btnRow.appendChild(thankBtn);
                    block.appendChild(btnRow);
                    body.appendChild(block);
                });
            }
            var panel = body.closest('.borrowed-messages-panel');
            var globalActions = panel && panel.querySelector(':scope > .borrowed-messages-actions');
            if (globalActions) globalActions.style.display = messages.length > 0 ? 'none' : 'block';
        }

        var borrowedSearchInput = document.getElementById('borrowedSearchInput');
        var borrowedSearchResults = document.getElementById('borrowedSearchResults');
        var borrowedLendForm = document.getElementById('borrowedLendForm');
        var borrowedToInput = document.getElementById('borrowedToInput');
        var borrowedDueInput = document.getElementById('borrowedDueInput');
        var borrowedSubmitBtn = document.getElementById('borrowedSubmitBtn');
        if (borrowedSearchInput && borrowedSearchResults && borrowedLendForm) {
            borrowedSearchInput.addEventListener('input', function () {
                var q = (this.value || '').trim().toLowerCase();
                borrowedSearchResults.style.display = 'none';
                borrowedSearchResults.innerHTML = '';
                borrowedLendForm.style.display = 'none';
                selectedBookIdForBorrowed = null;
                if (q.length < 2) return;
                var available = library.filter(function (b) {
                    var os = (b.ownershipStatus || '').toLowerCase().replace(/\s/g, '');
                    if (os === 'borrowed') return false;
                    var t = ((b.title || '').trim()).toLowerCase();
                    var a = ((b.author || '').trim()).toLowerCase();
                    return t.indexOf(q) !== -1 || a.indexOf(q) !== -1;
                });
                var take = available.slice(0, 8);
                take.forEach(function (b) {
                    var item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'borrowed-search-result-item';
                    item.setAttribute('data-book-id', b.id || '');
                    item.textContent = (b.title || '—') + (b.author ? ' · ' + b.author : '');
                    item.addEventListener('click', function () {
                        selectedBookIdForBorrowed = this.getAttribute('data-book-id');
                        borrowedSearchResults.style.display = 'none';
                        borrowedSearchResults.innerHTML = '';
                        if (borrowedToInput) borrowedToInput.value = '';
                        if (borrowedDueInput) borrowedDueInput.value = '';
                        borrowedLendForm.style.display = 'block';
                    });
                    borrowedSearchResults.appendChild(item);
                });
                if (take.length > 0) borrowedSearchResults.style.display = 'block';
            });
            borrowedSearchInput.addEventListener('focus', function () {
                var q = (this.value || '').trim().toLowerCase();
                if (q.length >= 2 && borrowedSearchResults.childNodes.length > 0) borrowedSearchResults.style.display = 'block';
            });
            document.addEventListener('click', function (e) {
                if (borrowedSearchResults && borrowedLendForm && !borrowedSearchResults.contains(e.target) && !borrowedSearchInput.contains(e.target)) borrowedSearchResults.style.display = 'none';
            });
            if (borrowedSubmitBtn && borrowedToInput && borrowedDueInput) {
                borrowedSubmitBtn.addEventListener('click', function () {
                    if (!selectedBookIdForBorrowed) return;
                    var book = library.find(function (b) { return b.id === selectedBookIdForBorrowed; });
                    if (!book) return;
                    if ((book.ownershipStatus || '').toLowerCase() === 'borrowed' && (book.borrowedTo || '').trim()) {
                        book.borrowedHistory = book.borrowedHistory || [];
                        book.borrowedHistory.push({ to: (book.borrowedTo || '').trim(), dateTo: book.returnDueDate || '' });
                    }
                    book.ownershipStatus = 'borrowed';
                    book.borrowedTo = (borrowedToInput.value || '').trim() || undefined;
                    book.returnDueDate = (borrowedDueInput.value || '').trim() || undefined;
                    saveLibrary();
                    refreshGrid();
                    borrowedLendForm.style.display = 'none';
                    if (borrowedSearchInput) borrowedSearchInput.value = '';
                    selectedBookIdForBorrowed = null;
                });
            }
        }

        // Na prodej: vyhledat knihu ze sbírky a označit ji jako "Na prodej"
        var forSaleSearchInput = document.getElementById('forSaleSearchInput');
        var forSaleSearchResults = document.getElementById('forSaleSearchResults');
        if (forSaleSearchInput && forSaleSearchResults) {
            forSaleSearchInput.addEventListener('input', function () {
                var q = (this.value || '').trim().toLowerCase();
                forSaleSearchResults.style.display = 'none';
                forSaleSearchResults.innerHTML = '';
                if (q.length < 2) return;
                var available = library.filter(function (b) {
                    var os = (b.ownershipStatus || b.status || '').toLowerCase().replace(/\s/g, '');
                    if (os === 'borrowed' || os === 'pujceno' || os === 'borrowedbyme') return false;
                    if (os === 'wishlist' || os === 'forsale' || os === 'sold') return false;
                    var t = ((b.title || '').trim()).toLowerCase();
                    var a = ((b.author || '').trim()).toLowerCase();
                    return t.indexOf(q) !== -1 || a.indexOf(q) !== -1;
                });
                var take = available.slice(0, 8);
                take.forEach(function (b) {
                    var item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'borrowed-search-result-item';
                    item.setAttribute('data-book-id', b.id || '');
                    item.textContent = (b.title || '—') + (b.author ? ' · ' + b.author : '');
                    item.addEventListener('click', function () {
                        var bid = this.getAttribute('data-book-id');
                        var book = library.find(function (x) { return x.id === bid; });
                        if (!book) return;
                        book.ownershipStatus = 'forsale';
                        book.status = 'forsale';
                        saveLibrary();
                        forSaleSearchResults.style.display = 'none';
                        forSaleSearchResults.innerHTML = '';
                        forSaleSearchInput.value = '';
                        refreshGrid();
                        try { if (typeof openEditModal === 'function') openEditModal(bid); } catch (e0) {}
                    });
                    forSaleSearchResults.appendChild(item);
                });
                if (take.length > 0) forSaleSearchResults.style.display = 'block';
            });
            forSaleSearchInput.addEventListener('focus', function () {
                var q = (this.value || '').trim().toLowerCase();
                if (q.length >= 2 && forSaleSearchResults.childNodes.length > 0) forSaleSearchResults.style.display = 'block';
            });
            document.addEventListener('click', function (e) {
                if (!forSaleSearchResults.contains(e.target) && !forSaleSearchInput.contains(e.target)) forSaleSearchResults.style.display = 'none';
            });
        }

        // Na prodej: „O co mají zájem přátelé“ (demo) + rychlá zpráva do chatu
        (function () {
            var grid = document.getElementById('friendDemandsGrid');
            if (!grid) return;
            function openQuickMessage(prefill) {
                var overlay = document.getElementById('itemChatReplyModalOverlay');
                var textarea = document.getElementById('itemChatReplyModalText');
                var sendBtn = document.getElementById('itemChatReplyModalSend');
                var closeBtn = document.getElementById('itemChatReplyModalClose');
                if (!overlay || !textarea) return;
                textarea.value = String(prefill || '').trim();
                overlay.style.display = 'flex';
                if (sendBtn) {
                    sendBtn.onclick = function () {
                        overlay.style.display = 'none';
                        textarea.value = '';
                    };
                }
                if (closeBtn) closeBtn.onclick = function () { overlay.style.display = 'none'; };
            }

            function render() {
                grid.innerHTML = '';
                // demo karta podle screenu
                var d = { userName: 'Jana', title: 'Čaroprávnost', author: 'Terry Pratchett' };
                var card = document.createElement('div');
                card.className = 'friend-demand-card';
                var text = document.createElement('div');
                text.className = 'demand-text';
                var nameSpan = document.createElement('span');
                nameSpan.className = 'demand-name';
                nameSpan.textContent = d.userName + ' shání: ';
                text.appendChild(nameSpan);
                text.appendChild(document.createTextNode(d.title + (d.author ? ' (' + d.author + ')' : '')));
                card.appendChild(text);
                var actionsWrap = document.createElement('div');
                actionsWrap.className = 'demand-actions';
                var btnGive = document.createElement('button');
                btnGive.type = 'button';
                btnGive.className = 'btn-want-to-borrow';
                btnGive.textContent = 'Ráda ti půjčím / daruji';
                btnGive.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openQuickMessage('Ahoj ' + d.userName + ', mám knihu „' + d.title + '“' + (d.author ? ' (' + d.author + ')' : '') + '. Ráda ti ji půjčím nebo daruji. Kdy se ti to hodí?');
                });
                var btnSell = document.createElement('button');
                btnSell.type = 'button';
                btnSell.className = 'btn-sell-exchange';
                btnSell.textContent = 'Chci prodat / vyměnit';
                btnSell.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openQuickMessage('Ahoj ' + d.userName + ', knihu „' + d.title + '“' + (d.author ? ' (' + d.author + ')' : '') + ' můžu nabídnout k prodeji nebo výměně. Zajímá tě to?');
                });
                actionsWrap.appendChild(btnGive);
                actionsWrap.appendChild(btnSell);
                card.appendChild(actionsWrap);
                grid.appendChild(card);
            }
            render();
        })();

        var borrowedAlarmBtn = document.getElementById('borrowedAlarmBtn');
        if (borrowedAlarmBtn) {
            borrowedAlarmBtn.addEventListener('click', function () {
                var id = this.getAttribute('data-book-id');
                if (id) {
                    var card = document.querySelector('.book-card[data-book-id="' + id.replace(/"/g, '\\"') + '"]');
                    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        }
        var overdueBannerBtn = document.getElementById('overdueBannerBtn');
        if (overdueBannerBtn) {
            overdueBannerBtn.addEventListener('click', function () {
                var borrowedItem = document.querySelector('#librarySubmenu [data-view="borrowed"]');
                var borrowedByMeItem = document.querySelector('#librarySubmenu [data-view="borrowedByMe"]');
                var target = borrowedByMeItem || borrowedItem;
                if (target) target.click();
            });
        }

        var marketplaceModalOverlay = document.getElementById('marketplaceModalOverlay');
        var marketplaceModalClose = document.getElementById('marketplaceModalClose');
        var btnMarketplace = document.getElementById('btnMarketplace');
        var btnSellDuplicate = document.getElementById('btnSellDuplicate');
        var btnBuyFromWishlist = document.getElementById('btnBuyFromWishlist');

        function initMarketplaceUI() {
            var marketplaceModalOverlayEl = document.getElementById('marketplaceModalOverlay');
            var toggle = document.getElementById('marketplaceNaProdejToggle');
            var body = document.getElementById('marketplaceNaProdejBody');
            var accordion = document.getElementById('marketplaceNaProdejAccordion');
            if (toggle && body && accordion) {
                toggle.addEventListener('click', function () {
                    accordion.classList.toggle('collapsed');
                    var expanded = !accordion.classList.contains('collapsed');
                    toggle.setAttribute('aria-expanded', expanded);
                    body.hidden = !expanded;
                });
            }
            var container = document.getElementById('marketplaceSection') || document.getElementById('content-area');
            if (container) {
                container.querySelectorAll('.marketplace-category-btn').forEach(function (btn) {
                    if (btn._marketplaceCategoryBound) return;
                    btn._marketplaceCategoryBound = true;
                    btn.addEventListener('click', function () {
                        container.querySelectorAll('.marketplace-category-btn').forEach(function (b) {
                            b.classList.remove('active');
                            b.setAttribute('aria-selected', 'false');
                        });
                        btn.classList.add('active');
                        btn.setAttribute('aria-selected', 'true');
                    });
                });
            }
            var openModalBtn = document.getElementById('btnMarketplaceOpenModalFromSection');
            if (openModalBtn && marketplaceModalOverlayEl && !openModalBtn._marketplaceOpenModalBound) {
                openModalBtn._marketplaceOpenModalBound = true;
                openModalBtn.addEventListener('click', function () { marketplaceModalOverlayEl.style.display = 'flex'; });
            }
        }
        window.initMarketplaceUI = initMarketplaceUI;

        function injectSharedMarketplaceCards() {
            var carousel = document.getElementById('marketplaceNovinkyCarousel');
            if (!carousel) return;
            var list = getSharedToMarketplace();
            if (!Array.isArray(list) || list.length === 0) return;
            list.forEach(function (item) {
                var id = item.id || ('shared-' + (item._ts || Date.now()));
                if (carousel.querySelector('.marketplace-card[data-shared-id="' + id + '"]')) return;
                var article = document.createElement('article');
                article.className = 'marketplace-card marketplace-card--novinka';
                article.setAttribute('role', 'listitem');
                article.setAttribute('tabindex', '0');
                article.setAttribute('data-marketplace-card', '');
                article.setAttribute('data-marketplace-status', 'k-zapujceni');
                article.setAttribute('data-shared-id', id);
                article.setAttribute('title', 'Kliknutím zobrazíte detail');
                var status = (item.status || 'k-zapujceni').toLowerCase().replace(/\s/g, '-');
                var bubble = (item.bubble || '').trim() || 'Doporučuji, skvělý stav.';
                var title = (item.title || '').trim() || '—';
                var author = (item.author || '').trim() || '—';
                article.innerHTML =
                    '<div class="marketplace-card__cover-wrap" aria-hidden="true">' +
                    '<span class="marketplace-card__status-label marketplace-card__status-label--left marketplace-card__status-label--k-zapujceni">K zapůjčení</span>' +
                    '<span class="marketplace-card__cover-fallback">📖</span></div>' +
                    '<div class="marketplace-card__body">' +
                    '<h3 class="marketplace-card__title">' + (title.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</h3>' +
                    '<p class="marketplace-card__author">' + (author.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</p>' +
                    '<p class="marketplace-card__seller marketplace-card__seller--friend">Prodává: Já (ze své knihovny)</p>' +
                    '<div class="user-bubble" aria-label="Vzkaz prodávajícího">' + (bubble.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</div>' +
                    '<button type="button" class="marketplace-card__msg-owner" data-action="message-owner" aria-label="Napsat majiteli">Napsat majiteli</button>' +
                    '</div>';
                carousel.appendChild(article);
            });
        }

        function loadMarketplaceContent() {
            var container = document.getElementById('marketplaceSection');
            if (!container) return;
            if (container.children.length > 0) {
                injectSharedMarketplaceCards();
                if (typeof syncMarketplaceMyShelf === 'function') syncMarketplaceMyShelf();
                return;
            }
            var template = document.getElementById('marketplaceTemplate');
            if (template && template.content && template.content.cloneNode) {
                container.appendChild(template.content.cloneNode(true));
            } else if (template && template.innerHTML) {
                container.innerHTML = template.innerHTML;
            } else {
                container.innerHTML = '<p class="marketplace-cards-placeholder">Tržiště – žádný obsah.</p>';
            }
            initMarketplaceUI();
            injectSharedMarketplaceCards();
            syncMarketplaceMyShelf();
        }

        if (btnMarketplace) {
            btnMarketplace.addEventListener('click', function () {
                setTimeout(loadMarketplaceContent, 50);
            });
        }
        setTimeout(loadMarketplaceContent, 200);
        window.loadMarketplaceContent = loadMarketplaceContent;
        window.syncMarketplaceMyShelf = syncMarketplaceMyShelf;

        // Tržiště v sidebaru jen přepíná na sekci Tržiště (obsluha v navigation.js). Modal „Prodat / Koupit“ se otevírá z uvnitř sekce Tržiště.
        if (marketplaceModalClose && marketplaceModalOverlay) {
            marketplaceModalClose.addEventListener('click', function () { marketplaceModalOverlay.style.display = 'none'; });
            marketplaceModalOverlay.addEventListener('click', function (ev) { if (ev.target === marketplaceModalOverlay) marketplaceModalOverlay.style.display = 'none'; });
        }
        if (btnSellDuplicate && marketplaceModalOverlay) {
            btnSellDuplicate.addEventListener('click', function () {
                marketplaceModalOverlay.style.display = 'none';
                var forSaleItem = document.querySelector('#librarySubmenu [data-view="forSale"]');
                if (forSaleItem) forSaleItem.click();
            });
        }
        if (btnBuyFromWishlist && marketplaceModalOverlay) {
            btnBuyFromWishlist.addEventListener('click', function () {
                marketplaceModalOverlay.style.display = 'none';
                var wishlistBooks = library.filter(function (b) { return (b.ownershipStatus || '').toLowerCase() === 'wishlist'; });
                var q = wishlistBooks.length ? (wishlistBooks[0].title || '').trim() : 'knihy';
                if (!q) q = 'knihy';
                window.open('https://www.heureka.cz/?h=' + encodeURIComponent(q), '_blank');
            });
        }
        var marketplaceDetailOverlay = document.getElementById('marketplaceDetailOverlay');
        var marketplaceDetailClose = document.getElementById('marketplaceDetailClose');
        var marketplaceDetailTitleEl = document.getElementById('marketplaceDetailBookTitle');
        var marketplaceDetailAuthorEl = document.getElementById('marketplaceDetailAuthor');
        var marketplaceDetailSellerEl = document.getElementById('marketplaceDetailSeller');
        if (marketplaceDetailOverlay) {
            // Delegace na document – proklik na kartu funguje vždy (i když je sekce skrytá při načtení)
            document.addEventListener('click', function (e) {
                var section = document.getElementById('marketplaceSection') || document.getElementById('content-area');
                if (!section) return;
                var card = e.target && e.target.closest && e.target.closest('.marketplace-card[data-marketplace-card]');
                if (!card || !section.contains(card)) return;
                if (e.target.closest && e.target.closest('.marketplace-card__msg-owner')) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Otevírám chat s majitelem');
                    if (marketplaceDetailOverlay) marketplaceDetailOverlay.style.display = 'none';
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                var titleEl = card.querySelector('.marketplace-card__title');
                var authorEl = card.querySelector('.marketplace-card__author');
                var sellerEl = card.querySelector('.marketplace-card__seller');
                var storyEl = card.querySelector('.user-bubble') || card.querySelector('.bubble') || card.querySelector('.marketplace-card__story-text');
                var priceEl = card.querySelector('.marketplace-card__price');
                var statusEl = card.querySelector('.marketplace-card__status') || card.querySelector('.marketplace-card__status-label');
                if (marketplaceDetailTitleEl) marketplaceDetailTitleEl.textContent = titleEl ? titleEl.textContent.trim() : '';
                if (marketplaceDetailAuthorEl) marketplaceDetailAuthorEl.textContent = authorEl ? authorEl.textContent.trim() : '';
                if (marketplaceDetailSellerEl) marketplaceDetailSellerEl.textContent = sellerEl ? sellerEl.textContent.trim() : 'Prodává: —';
                var detailStatus = document.getElementById('marketplaceDetailStatus');
                if (detailStatus) {
                    if (statusEl && statusEl.textContent.trim()) {
                        detailStatus.textContent = statusEl.textContent.trim();
                        detailStatus.style.display = '';
                    } else { detailStatus.textContent = ''; detailStatus.style.display = 'none'; }
                }
                var detailBubble = document.getElementById('marketplaceDetailBubble');
                if (detailBubble) {
                    var bubbleText = storyEl ? storyEl.textContent.trim() : '';
                    detailBubble.textContent = bubbleText;
                    detailBubble.style.display = bubbleText ? 'block' : 'none';
                }
                var detailContent = document.getElementById('marketplaceDetailContent');
                if (detailContent) detailContent.textContent = 'Info o obsahu knihy se načte zde.';
                var detailPrice = document.getElementById('marketplaceDetailPrice');
                if (detailPrice) {
                    if (priceEl && priceEl.textContent.trim()) {
                        detailPrice.textContent = priceEl.textContent.trim();
                        detailPrice.style.display = '';
                    } else { detailPrice.textContent = ''; detailPrice.style.display = 'none'; }
                }
                marketplaceDetailOverlay.style.display = 'flex';
            }, true);
            if (marketplaceDetailClose) marketplaceDetailClose.addEventListener('click', function () { marketplaceDetailOverlay.style.display = 'none'; });
            marketplaceDetailOverlay.addEventListener('click', function (ev) { if (ev.target === marketplaceDetailOverlay) marketplaceDetailOverlay.style.display = 'none'; });
        }
        var marketplaceDetailBtnBuy = document.getElementById('marketplaceDetailBtnBuy');
        var marketplaceDetailBtnContact = document.getElementById('marketplaceDetailBtnContact');
        if (marketplaceDetailBtnBuy) marketplaceDetailBtnBuy.addEventListener('click', function () { if (marketplaceDetailOverlay) marketplaceDetailOverlay.style.display = 'none'; });
        if (marketplaceDetailBtnContact) marketplaceDetailBtnContact.addEventListener('click', function () { if (marketplaceDetailOverlay) marketplaceDetailOverlay.style.display = 'none'; });

        var borrowedByMeForm = document.getElementById('borrowedByMeForm');
        var borrowedByMeTitle = document.getElementById('borrowedByMeTitle');
        var borrowedByMeAuthor = document.getElementById('borrowedByMeAuthor');
        var borrowedByMeFrom = document.getElementById('borrowedByMeFrom');
        var borrowedByMeReturn = document.getElementById('borrowedByMeReturn');
        var borrowedByMeReading = document.getElementById('borrowedByMeReading');
        var borrowedByMeCoverInput = document.getElementById('borrowedByMeCoverInput');
        var btnScanBorrowedByMe = document.getElementById('btnScanBorrowedByMe');
        var borrowedByMeScanInput = document.getElementById('borrowedByMeScanInput');
        // UI: kompaktní rozbalovací panel
        var borrowedByMeBody = document.getElementById('borrowedByMeBody');
        var borrowedByMeStatusText = document.getElementById('borrowedByMeStatusText');
        var btnOpenBorrowedByMe = document.getElementById('btnOpenBorrowedByMe');
        var btnCloseBorrowedByMe = document.getElementById('btnCloseBorrowedByMe');
        var BORROWED_BY_ME_PANEL_KEY = 'omnishelf_borrowed_by_me_panel_open_v1';
        function getBorrowedByMePanelOpen() {
            try { return localStorage.getItem(BORROWED_BY_ME_PANEL_KEY) === '1'; } catch (e) { return false; }
        }
        function setBorrowedByMePanelOpen(isOpen) {
            var open = !!isOpen;
            try { localStorage.setItem(BORROWED_BY_ME_PANEL_KEY, open ? '1' : '0'); } catch (e) {}
            if (borrowedByMeBody) borrowedByMeBody.hidden = !open;
            if (borrowedByMeStatusText) borrowedByMeStatusText.textContent = open ? 'Panel „Přidat vypůjčenou knihu“ je otevřený' : 'Panel „Přidat vypůjčenou knihu“ je zavřený';
            if (btnOpenBorrowedByMe) btnOpenBorrowedByMe.hidden = open;
            if (btnCloseBorrowedByMe) btnCloseBorrowedByMe.hidden = !open;
        }
        if (btnOpenBorrowedByMe) btnOpenBorrowedByMe.addEventListener('click', function () { setBorrowedByMePanelOpen(true); });
        if (btnCloseBorrowedByMe) btnCloseBorrowedByMe.addEventListener('click', function () { setBorrowedByMePanelOpen(false); });
        // init state
        setBorrowedByMePanelOpen(getBorrowedByMePanelOpen());
        var pendingLoanCoverImage = null;
        function setPendingLoanCover(dataUrl) {
            pendingLoanCoverImage = dataUrl;
        }
        function clearPendingLoanCover() {
            pendingLoanCoverImage = null;
        }
        if (borrowedByMeCoverInput) {
            borrowedByMeCoverInput.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file || !file.type.startsWith('image/')) return;
                // Povinná komprese do localStorage: JPEG 300px / 0.6
                compressImageFileToJpegDataUrl(file, 300, 0.6).then(function (out) {
                    setPendingLoanCover(out || '');
                    try { console.log('Omshelf: borrowedByMe cover bytes=' + estimateDataUrlBytes(String(out || ''))); } catch (e2) {}
                }).catch(function () {
                    // fallback: i tak radši nic než obří dataURL
                    setPendingLoanCover('');
                });
            });
        }
        if (borrowedByMeForm && borrowedByMeTitle && borrowedByMeAuthor && borrowedByMeFrom && borrowedByMeReturn) {
            borrowedByMeForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var title = (borrowedByMeTitle.value || '').trim();
                var author = (borrowedByMeAuthor.value || '').trim();
                var borrowedFrom = (borrowedByMeFrom.value || '').trim();
                var returnDate = (borrowedByMeReturn.value || '').trim();
                var readingNow = borrowedByMeReading && borrowedByMeReading.checked;
                if (!title && !author) return;
                var book = {
                    id: generateBookId(),
                    title: title || '—',
                    author: author || '—',
                    borrowedFrom: borrowedFrom || undefined,
                    returnDueDate: returnDate || undefined,
                    returnDate: returnDate || undefined,
                    ownershipStatus: 'borrowedByMe',
                    location: 'Půjčená literatura',
                    readingStatus: readingNow ? 'reading' : 'unread',
                    image: pendingLoanCoverImage || '',
                    addedAt: new Date().toISOString()
                };
                migrateBookToNewFields(book);
                library.push(book);
                // Uložení do localStorage - data jsou trvalá a přetrvají i po obnovení stránky
                saveLibrary();
                borrowedByMeTitle.value = '';
                borrowedByMeAuthor.value = '';
                borrowedByMeFrom.value = '';
                borrowedByMeReturn.value = '';
                if (borrowedByMeReading) borrowedByMeReading.checked = false;
                clearPendingLoanCover();
                if (borrowedByMeCoverInput) borrowedByMeCoverInput.value = '';
                updateScanHistory();
                checkBorrowedByMeOverdue();
            });
        }
        if (btnScanBorrowedByMe && borrowedByMeScanInput) {
            btnScanBorrowedByMe.addEventListener('click', function () { borrowedByMeScanInput.click(); });
            borrowedByMeScanInput.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file || !file.type.startsWith('image/')) return;
                // 1) Ulož cover komprimovaně (kvóta)
                compressImageFileToJpegDataUrl(file, 300, 0.6).then(function (out) {
                    setPendingLoanCover(out || '');
                }).catch(function () {
                    setPendingLoanCover('');
                });

                // 2) Pro AI pošli optimalizovanou base64 (levnější payload)
                fileToBase64(file).then(function (base64) {
                    var openaiKey = getOpenAiKey();
                    var hasProxy = global.OMNI_Keys && global.OMNI_Keys.openAiFetch;
                    if (!base64 || (!openaiKey && !hasProxy)) {
                        if (borrowedByMeTitle) borrowedByMeTitle.placeholder = 'Naskenuj obálku – vyplň ručně';
                        return;
                    }
                    var body = {
                        model: 'gpt-4o',
                        max_tokens: 1024,
                        messages: [
                            { role: 'user', content: [
                                { type: 'text', text: AI_ANALYZE_PROMPT },
                                { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } }
                            ]}
                        ]
                    };
                    var fetcher = hasProxy ? global.OMNI_Keys.openAiFetch(body) : fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
                        body: JSON.stringify(body)
                    });
                    return fetcher.then(function (r) { return r.json(); }).then(function (data) {
                        var txt = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : '';
                        var json = txt.replace(/```json?\s*/g, '').replace(/```\s*$/g, '').trim();
                        var parsed = { books: [] };
                        try { parsed = JSON.parse(json); } catch (err) {}
                        var books = parsed.books || [];
                        var first = books[0];
                        if (first && (borrowedByMeTitle || borrowedByMeAuthor)) {
                            if (borrowedByMeTitle) borrowedByMeTitle.value = (first.title || '').trim();
                            if (borrowedByMeAuthor) borrowedByMeAuthor.value = (first.author || '').trim();
                        }
                    }).catch(function () {});
                }).catch(function () {});
            });
        }

        function showBorrowedHistory(bookId) {
            var book = library.find(function (b) { return b.id === bookId; });
            var overlay = document.getElementById('borrowedHistoryOverlay');
            var body = document.getElementById('borrowedHistoryBody');
            if (!overlay || !body) return;
            body.innerHTML = '';
            var hist = (book && book.borrowedHistory && book.borrowedHistory.length) ? book.borrowedHistory : [];
            if (hist.length === 0) {
                body.appendChild(document.createTextNode('Zatím žádná historie.'));
            } else {
                var ul = document.createElement('ul');
                ul.className = 'borrowed-history-list';
                hist.forEach(function (entry) {
                    var li = document.createElement('li');
                    li.textContent = entry.to + (entry.dateTo ? ' — vrátit do ' + entry.dateTo : '');
                    ul.appendChild(li);
                });
                body.appendChild(ul);
            }
            overlay.style.display = 'flex';
            document.getElementById('borrowedHistoryClose').onclick = function () { overlay.style.display = 'none'; };
        }

        function showBorrowedReminder(bookId) {
            var book = library.find(function (b) { return b.id === bookId; });
            if (!book) return;
            var overlay = document.getElementById('borrowedReminderOverlay');
            var choices = document.getElementById('borrowedReminderChoices');
            var result = document.getElementById('borrowedReminderResult');
            if (!overlay || !choices || !result) return;
            result.style.display = 'none';
            result.textContent = '';
            overlay.style.display = 'flex';
            var closeReminder = function () { overlay.style.display = 'none'; };
            document.getElementById('borrowedReminderClose').onclick = closeReminder;
            choices.querySelectorAll('.borrowed-reminder-btn').forEach(function (btn) {
                btn.onclick = function () {
                    var tone = this.getAttribute('data-tone');
                    result.style.display = 'block';
                    result.textContent = 'Připravuju upomínku…';
                    requestBorrowedReminder(book, tone, result, closeReminder);
                };
            });
        }

        function requestBorrowedReminder(book, tone, resultEl, onClose) {
            var title = book.title || 'kniha';
            var to = (book.borrowedTo || '').trim() || '—';
            var dateStr = (book.returnDueDate || '').trim();
            if (dateStr) {
                try {
                    var d = new Date(dateStr);
                    if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
                } catch (e) {}
            }
            if (!dateStr) dateStr = '—';
            var voiceTone = (typeof getVoiceTone === 'function' ? getVoiceTone() : 'friendly') || 'friendly';
            var styleHint = { friendly: 'Přátelsky, vlídně.', kind: 'Laskavě, s porozuměním.', funny: 'Lehce vtipně, hravě – můžeš přidat drobný humor.', motivating: 'Povzbudivě, ale mile.', serious: 'Věcně, střízlivě.' }[voiceTone] || 'Přátelsky.';
            var prompt = tone === 'firm'
                ? 'Napiš krátkou DŮRAZNOU upomínku (1–2 věty) pro vrácení knihy. Kniha: „' + title + '“, půjčeno: ' + to + ', vrátit do: ' + dateStr + '. Buď stručně a rozhodně. Tykej (používej ty). Česky.'
                : 'Napiš krátkou MILOU upomínku (1–2 věty) pro vrácení knihy. Kniha: „' + title + '“, půjčeno: ' + to + ', vrátit do: ' + dateStr + '. Tón: ' + styleHint + ' Tykej (používej ty). Česky.';
            var openaiKey = getOpenAiKey();
            var hasProxy = global.OMNI_Keys && global.OMNI_Keys.openAiFetch;
            if ((!openaiKey || (openaiKey.trim && !openaiKey.trim())) && !hasProxy) {
                resultEl.textContent = 'Pro generování upomínky nastav v Nastavení OpenAI API klíč.';
                return;
            }
            var body = {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 150
            };
            var fetcher = hasProxy ? global.OMNI_Keys.openAiFetch(body) : fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
                body: JSON.stringify(body)
            });
            fetcher.then(function (r) { return r.ok ? r.json() : r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); }); })
              .then(function (data) {
                var text = (data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '';
                resultEl.textContent = text || 'Nepodařilo se vygenerovat upomínku.';
            }).catch(function (err) {
                resultEl.textContent = 'Chyba: ' + (err.message || 'neznámá');
            });
        }

        document.addEventListener('click', function (e) {
            var nameEl = e.target.closest('.book-card-borrowed-name-clickable');
            if (nameEl) {
                e.preventDefault();
                e.stopPropagation();
                showBorrowedReminder(nameEl.getAttribute('data-book-id'));
            }
        });

        if (document.getElementById('borrowedHistoryClose')) {
            document.getElementById('borrowedHistoryClose').addEventListener('click', function () {
                var o = document.getElementById('borrowedHistoryOverlay');
                if (o) o.style.display = 'none';
            });
        }

        var editBookCoverInput = document.getElementById('editBookCoverInput');
        if (editBookCoverInput) {
            editBookCoverInput.addEventListener('change', function () {
                var overlay = document.getElementById('editBookModalOverlay');
                var bookId = overlay && overlay.getAttribute('data-edit-book-id');
                var book = bookId ? library.find(function (b) { return b.id === bookId; }) : null;
                var file = this.files && this.files[0];
                if (!book || !file || !file.type.startsWith('image/')) return;
                if (window.OMNI_LibraryUploadLogic && typeof window.OMNI_LibraryUploadLogic.storeCompressedCoverWithRetry === 'function' && typeof window.saveToStorage === 'function') {
                    window.OMNI_LibraryUploadLogic.storeCompressedCoverWithRetry({
                        file: file,
                        book: book,
                        saveToStorage: window.saveToStorage,
                        onPreview: function (dataUrl) {
                            var coverPreview = document.getElementById('editBookCoverPreview');
                            if (coverPreview) coverPreview.innerHTML = '<img src="' + String(dataUrl).replace(/"/g, '&quot;') + '" alt="Obálka" />';
                        },
                        onSuccess: function () {
                            if (typeof refreshGrid === 'function') refreshGrid();
                        },
                        onFail: function (err) {
                            if (typeof window.setAiAssistantError === 'function') window.setAiAssistantError(err);
                        },
                        onNotice: function (kind) {
                            if (typeof window.setAiAssistantNotice === 'function') window.setAiAssistantNotice(kind);
                        }
                    });
                }
            });
        }

        // Statistiky: filtry + export (aktuální funkční Omshelf)
        (function () {
            var STAT_FILTER_KEY = 'omnishelf_statistics_filter_v1';
            function getStatsState() {
                try {
                    var raw = localStorage.getItem(STAT_FILTER_KEY);
                    var o = raw ? JSON.parse(raw) : {};
                    return o && typeof o === 'object' ? o : {};
                } catch (e) { return {}; }
            }
            function setStatsState(o) {
                try { localStorage.setItem(STAT_FILTER_KEY, JSON.stringify(o || {})); } catch (e) {}
            }
            function norm(s) { return String(s || '').trim().toLowerCase(); }
            function uniqSorted(arr) {
                var seen = {};
                var out = [];
                (arr || []).forEach(function (x) {
                    var k = String(x || '').trim();
                    if (!k) return;
                    var nk = norm(k);
                    if (seen[nk]) return;
                    seen[nk] = true;
                    out.push(k);
                });
                out.sort(function (a, b) { return a.localeCompare(b, 'cs'); });
                return out;
            }
            function parseCzk(raw) {
                var s = String(raw || '').trim();
                if (!s) return 0;
                // "200 Kč", "1 200", "1200,-"
                s = s.replace(/[^\d,.\s]/g, '').replace(/\s/g, '');
                if (!s) return 0;
                // prefer last comma/dot as decimal separator (but we want int anyway)
                var m = s.match(/\d+/g);
                if (!m) return 0;
                try { return parseInt(m.join(''), 10) || 0; } catch (e) { return 0; }
            }
            function getOwnershipNorm(b) {
                return String((b && (b.ownershipStatus || b.status || 'mine')) || '').toLowerCase().replace(/\s/g, '');
            }
            function isSoldBook(b) {
                // Podpora více možných zápisů (v datech se to může lišit)
                var o = getOwnershipNorm(b);
                if (o === 'sold' || o === 'soldout' || o === 'prodane' || o === 'prodané' || o === 'prodana' || o === 'prodaná') return true;
                try {
                    if (b && (b.isSold === true || b.sold === true)) return true;
                    if (b && (b.soldAt || b.soldDate || b.saleCompletedAt)) return true;
                    var ss = String((b && (b.saleStatus || b.sale_state || b.saleState)) || '').toLowerCase().replace(/\s/g, '');
                    if (ss === 'sold' || ss === 'soldout' || ss === 'completed' || ss === 'done') return true;
                } catch (e) {}
                return false;
            }
            function getCollectionText(b) {
                return String((b && (b.collection || b.series || '')) || '').trim();
            }
            function getPrivacyNorm(b) {
                return String((b && (b.privacy || 'private')) || 'private').toLowerCase().replace(/\s/g, '');
            }
            function getSectionLabelForBook(b) {
                var o = getOwnershipNorm(b);
                var r = String((b && b.readingStatus) || '').toLowerCase().replace(/\s/g, '');
                if (o === 'wishlist') return 'Wishlist';
                if (o === 'borrowedbyme') return 'Mám vypůjčeno';
                if (o === 'borrowed' || o === 'pujceno' || o === 'půjčeno') return 'Půjčil/a jsem';
                if (isSoldBook(b)) return 'Prodané';
                if (o === 'forsale') return 'Na prodej';
                if (r === 'reading' || r === 'read') return 'Rozečteno';
                return 'Tvoje sbírka';
            }

            function getStatsDom() {
                return {
                    section: document.getElementById('statisticsSection'),
                    dateFrom: document.getElementById('statisticsDateFrom'),
                    dateTo: document.getElementById('statisticsDateTo'),
                    btnReset: document.getElementById('btnCasostrojReset'),
                    cards: document.getElementById('statisticsCards'),
                    loans: document.getElementById('statisticsLoans'),
                    rooms: document.getElementById('statisticsRooms'),
                    exportTable: document.getElementById('statisticsExportTable'),
                    filterToggle: document.getElementById('statisticsFilterToggle'),
                    filterBody: document.getElementById('statisticsFilterBody'),
                    filterField: document.getElementById('statisticsFilterField'),
                    filterValue: document.getElementById('statisticsFilterValue'),
                    filterApply: document.getElementById('statisticsApplyFilter'),
                    filterClear: document.getElementById('statisticsClearFilter'),
                    exportPdfSidebar: document.getElementById('btnExportPdf'),
                    exportCsvSidebar: document.getElementById('btnExportCsv'),
                    exportPdfStats: document.getElementById('btnExportPdfStats'),
                    exportCsvStats: document.getElementById('btnExportCsvStats')
                };
            }

            function isStatsActive() {
                try { return document.body.classList.contains('module-statistics'); } catch (e) { return false; }
            }

            function getStatsBaseList(sectionValue) {
                if (!sectionValue) return (library || []).slice();
                var map = {
                    collection: 'collection',
                    currentlyReading: 'currentlyReading',
                    borrowed: 'borrowed',
                    borrowedByMe: 'borrowedByMe',
                    wishlist: 'wishlist',
                    forSale: 'forSale',
                    favorites: 'favorites'
                };
                var v = map[sectionValue] || '';
                if (!v) return (library || []).slice();
                try { return filterLibraryByView(library, v) || []; } catch (e) { return []; }
            }

            function computeStatsFilteredItems() {
                var dom = getStatsDom();
                var st = getStatsState();
                var sectionValue = String(st.section || '');
                var field = String(st.field || '');
                var value = String(st.value || '');
                var fromVal = dom.dateFrom && dom.dateFrom.value ? new Date(dom.dateFrom.value) : null;
                var toVal = dom.dateTo && dom.dateTo.value ? new Date(dom.dateTo.value) : null;
                var list = getStatsBaseList(sectionValue);

                function filterByAddedAt(b) {
                    var added = b && b.addedAt ? new Date(b.addedAt) : null;
                    if (!added || isNaN(added.getTime())) return (!fromVal && !toVal);
                    if (fromVal && added < fromVal) return false;
                    if (toVal) {
                        var toEnd = new Date(toVal);
                        toEnd.setHours(23, 59, 59, 999);
                        if (added > toEnd) return false;
                    }
                    return true;
                }

                list = (list || []).filter(filterByAddedAt);

                if (field && value) {
                    var vNorm = norm(value);
                    if (field === 'section') {
                        // section filtr = přepne base list; tady už ne
                    } else if (field === 'shelf') {
                        list = list.filter(function (b) { return norm((b && b.location) || '') === vNorm; });
                    } else if (field === 'author') {
                        list = list.filter(function (b) { return norm((b && b.author) || '') === vNorm; });
                    } else if (field === 'collection') {
                        list = list.filter(function (b) { return norm(getCollectionText(b)) === vNorm; });
                    } else if (field === 'privacy') {
                        list = list.filter(function (b) { return getPrivacyNorm(b) === vNorm; });
                    } else if (field === 'favorites') {
                        list = list.filter(function (b) { return !!(b && (b.is_favorite || b.isFavorite)); });
                    }
                }
                return list;
            }

            function computeStatsTimeFilteredAll() {
                // „Celkem knih“ + poličky mají reflektovat celou knihovnu, ne poslední vybranou sekci.
                // (Použijeme jen časostroj, ostatní filtry jsou až po potvrzení a platí pro tabulku/karty.)
                var dom = getStatsDom();
                var fromVal = dom.dateFrom && dom.dateFrom.value ? new Date(dom.dateFrom.value) : null;
                var toVal = dom.dateTo && dom.dateTo.value ? new Date(dom.dateTo.value) : null;
                function filterByAddedAt(b) {
                    var added = b && b.addedAt ? new Date(b.addedAt) : null;
                    if (!added || isNaN(added.getTime())) return (!fromVal && !toVal);
                    if (fromVal && added < fromVal) return false;
                    if (toVal) {
                        var toEnd = new Date(toVal);
                        toEnd.setHours(23, 59, 59, 999);
                        if (added > toEnd) return false;
                    }
                    return true;
                }
                return (library || []).slice().filter(filterByAddedAt);
            }

            function buildValueOptionsForField(field) {
                if (!field) return [];
                if (field === 'section') {
                    return [
                        { v: 'collection', label: 'Tvoje sbírka' },
                        { v: 'currentlyReading', label: 'Rozečteno' },
                        { v: 'wishlist', label: 'Wishlist' },
                        { v: 'borrowed', label: 'Půjčil/a jsem' },
                        { v: 'borrowedByMe', label: 'Mám vypůjčeno' },
                        { v: 'forSale', label: 'Na prodej' },
                        { v: 'favorites', label: 'Srdcovky' }
                    ];
                }
                if (field === 'privacy') {
                    return [
                        { v: 'private', label: 'Soukromá' },
                        { v: 'family', label: 'Rodina' },
                        { v: 'public', label: 'Veřejná' }
                    ];
                }
                if (field === 'favorites') {
                    return [{ v: '1', label: 'Pouze srdcovky' }];
                }
                var list = (library || []).slice();
                if (field === 'shelf') {
                    return uniqSorted(list.map(function (b) { return (b && b.location) ? String(b.location).trim() : ''; }))
                        .map(function (s) { return { v: s, label: s }; });
                }
                if (field === 'author') {
                    return uniqSorted(list.map(function (b) { return (b && b.author) ? String(b.author).trim() : ''; }))
                        .map(function (s) { return { v: s, label: s }; });
                }
                if (field === 'collection') {
                    return uniqSorted(list.map(function (b) { return getCollectionText(b); }))
                        .map(function (s) { return { v: s, label: s }; });
                }
                return [];
            }

            function syncFilterValueSelect() {
                var dom = getStatsDom();
                if (!dom.filterField || !dom.filterValue) return;
                var st = getStatsState();
                var field = String(st.field || '');
                var value = (field === 'section') ? String(st.section || '') : String(st.value || '');
                var opts = buildValueOptionsForField(field);
                dom.filterValue.innerHTML = '<option value="">— vyberte hodnotu —</option>';
                if (!field) {
                    dom.filterValue.disabled = true;
                    return;
                }
                dom.filterValue.disabled = false;
                opts.forEach(function (o) {
                    var opt = document.createElement('option');
                    opt.value = o.v;
                    opt.textContent = o.label;
                    dom.filterValue.appendChild(opt);
                });
                if (value) dom.filterValue.value = value;
            }

            function exportCsvFromItems(items, filenameBase) {
                var rows = Array.isArray(items) ? items : [];
                if (!rows.length) { alert('Žádná data k exportu.'); return; }
                var lines = ['Název;Autor;Sekce;Polička;Přidáno'];
                rows.forEach(function (b) {
                    var title = (b && b.title) ? String(b.title).trim() : '';
                    var author = (b && b.author) ? String(b.author).trim() : '';
                    var section = getSectionLabelForBook(b);
                    var shelf = (b && b.location) ? String(b.location).trim() : '';
                    var added = b && b.addedAt ? (new Date(b.addedAt)).toLocaleDateString('cs-CZ') : '';
                    var arr = [title, author, section, shelf, added].map(function (s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; });
                    lines.push(arr.join(';'));
                });
                var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = (filenameBase || 'omnishelf-export') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
                a.click();
                URL.revokeObjectURL(a.href);
            }

            function exportPdfFromItems(items, title) {
                var rows = Array.isArray(items) ? items : [];
                if (!rows.length) { alert('Žádná data k exportu.'); return; }
                var html = '<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px;}h1{font-size:18px;margin:0 0 12px;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px;}th{background:#f3f4f6;}</style></head><body>';
                html += '<h1>' + escapeHtml(title || 'Omshelf – Export') + '</h1>';
                html += '<table><tr><th>Název</th><th>Autor</th><th>Sekce</th><th>Polička</th><th>Přidáno</th></tr>';
                rows.forEach(function (b) {
                    var t = escapeHtml((b && b.title) ? String(b.title).trim() : '');
                    var a = escapeHtml((b && b.author) ? String(b.author).trim() : '');
                    var s = escapeHtml(getSectionLabelForBook(b));
                    var sh = escapeHtml((b && b.location) ? String(b.location).trim() : '');
                    var ad = '';
                    try { ad = b && b.addedAt ? (new Date(b.addedAt)).toLocaleDateString('cs-CZ') : ''; } catch (e) {}
                    ad = escapeHtml(ad);
                    html += '<tr><td>' + t + '</td><td>' + a + '</td><td>' + s + '</td><td>' + sh + '</td><td>' + ad + '</td></tr>';
                });
                html += '</table></body></html>';
                var w = window.open('', '_blank');
                w.document.write(html);
                w.document.close();
                w.print();
            }

            function renderStatistics() {
                var dom = getStatsDom();
                if (!dom.section || !dom.cards || !dom.loans || !dom.rooms || !dom.exportTable) return;

                // UI selecty jsou „draft“ – filtr se aplikuje až tlačítkem
                var items = computeStatsFilteredItems();
                var allTime = computeStatsTimeFilteredAll();

                // Karty
                var totalAll = allTime.length;
                var investment = 0;
                items.forEach(function (b) { investment += parseCzk(b && b.estimatedValue); });
                var loanedOut = items.filter(function (b) {
                    var o = getOwnershipNorm(b);
                    return o === 'borrowed' || o === 'pujceno' || o === 'půjčeno';
                }).length;
                var forSale = items.filter(function (b) { return getOwnershipNorm(b) === 'forsale'; }).length;
                var soldCount = items.filter(function (b) { return isSoldBook(b); }).length;

                dom.cards.innerHTML =
                    '<div class="statistics-card"><div class="statistics-card-value">' + totalAll + '</div><div class="statistics-card-label">Celkem knih</div></div>' +
                    '<div class="statistics-card"><div class="statistics-card-value">' + (investment || 0) + '</div><div class="statistics-card-label">Investice do knih (Kč)</div></div>' +
                    '<div class="statistics-card"><div class="statistics-card-value">' + loanedOut + '</div><div class="statistics-card-label">Půjčené knihy</div></div>' +
                    '<div class="statistics-card"><div class="statistics-card-value">' + forSale + '</div><div class="statistics-card-label">Na prodej</div></div>' +
                    '<div class="statistics-card"><div class="statistics-card-value">' + soldCount + '</div><div class="statistics-card-label">Prodané knihy</div></div>';

                // Půjčeno venku
                var maxLoaned = Math.max(loanedOut, 5);
                var pct = Math.min(100, (loanedOut / maxLoaned) * 100);
                dom.loans.innerHTML =
                    '<div class="statistics-loans-title">Půjčeno venku</div>' +
                    '<div class="statistics-loans-bar-wrap"><div class="statistics-loans-bar" style="width:' + pct + '%"></div></div>' +
                    '<div class="statistics-loans-text">' + loanedOut + ' věcí u přátel</div>';

                // Poličky v knihovně (podle umístění)
                var shelfCounts = {};
                allTime.forEach(function (b) {
                    var loc = (b && b.location) ? String(b.location).trim() : '';
                    if (!loc) return;
                    // Wishlist apod. nechceme míchat do "poliček"
                    var o = getOwnershipNorm(b);
                    if (o === 'wishlist' || o === 'borrowedbyme') return;
                    shelfCounts[loc] = (shelfCounts[loc] || 0) + 1;
                });
                var shelves = Object.keys(shelfCounts).map(function (k) { return { name: k, count: shelfCounts[k] }; });
                shelves.sort(function (a, b) { return b.count - a.count; });
                var shelfMax = 1;
                shelves.forEach(function (s) { if (s.count > shelfMax) shelfMax = s.count; });
                var rowsHtml = shelves.slice(0, 12).map(function (r) {
                    var w = (r.count / shelfMax) * 100;
                    return '<div class="statistics-room-row statistics-room-clickable" data-shelf="' + String(r.name).replace(/"/g, '&quot;') + '" title="Klikněte pro přechod do knihovny">' +
                        '<span class="statistics-room-name">' + escapeHtml(r.name) + '</span>' +
                        '<div class="statistics-room-bar-wrap"><div class="statistics-room-bar" style="width:' + w + '%"></div></div>' +
                        '<span class="statistics-room-count">' + r.count + ' položek</span>' +
                        '</div>';
                }).join('');
                dom.rooms.innerHTML =
                    '<div class="statistics-rooms-title">Vizuální přehled poliček v knihovně</div>' +
                    '<div class="statistics-rooms-list">' + (rowsHtml || '<div style="color:var(--text-muted);padding:10px 0;">Zatím nejsou k dispozici žádná umístění.</div>') + '</div>';

                try {
                    dom.rooms.querySelectorAll('.statistics-room-clickable').forEach(function (row) {
                        row.addEventListener('click', function () {
                            var shelf = this.getAttribute('data-shelf') || '';
                            var btn = document.querySelector('#librarySubmenu .sidebar-submenu-item[data-view="collection"]');
                            if (btn) btn.click();
                            setTimeout(function () {
                                try {
                                    var groups = document.querySelectorAll('.shelf-group');
                                    var target = null;
                                    groups.forEach(function (g) {
                                        if (g && g.getAttribute && g.getAttribute('data-shelf-name') === shelf) target = g;
                                    });
                                    if (target) {
                                        target.classList.remove('collapsed');
                                        var h = target.querySelector('.shelf-group-header');
                                        if (h) h.classList.remove('collapsed');
                                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                } catch (e2) {}
                            }, 120);
                        });
                    });
                } catch (eRooms) {}

                // Exportní tabulka
                var rows = items.slice(0, 100).map(function (b) {
                    var title = (b && b.title) ? String(b.title).trim() : '—';
                    var author = (b && b.author) ? String(b.author).trim() : '—';
                    var added = b && b.addedAt ? (new Date(b.addedAt)).toLocaleDateString('cs-CZ') : '—';
                    return '<tr><td>' + escapeHtml(title) + '</td><td>' + escapeHtml(author) + '</td><td>' + escapeHtml(getSectionLabelForBook(b)) + '</td><td>' + escapeHtml(added) + '</td></tr>';
                }).join('');
                dom.exportTable.innerHTML =
                    '<table class="statistics-export-table-inner"><thead><tr><th>Název</th><th>Autor</th><th>Sekce</th><th>Přidáno</th></tr></thead><tbody>' +
                    (rows || '<tr><td colspan="4" style="color:#6b7280;">Žádná data pro vybraný filtr.</td></tr>') +
                    '</tbody></table>' +
                    (items.length > 100 ? ('<p class="statistics-export-more">Zobrazeno 100 z ' + items.length + ' položek.</p>') : '');
            }

            function applyStateAndRender() {
                if (!isStatsActive()) return;
                renderStatistics();
            }

            function initStatisticsUi() {
                var dom = getStatsDom();
                if (!dom.section) return;

                var st = getStatsState();
                // Draft selecty nastav podle posledního aplikovaného filtru
                if (dom.filterField) dom.filterField.value = String(st.field || '');
                syncFilterValueSelect();
                if (dom.filterValue) {
                    dom.filterValue.value = (String(st.field || '') === 'section') ? String(st.section || '') : String(st.value || '');
                }
                if (dom.filterApply) dom.filterApply.disabled = true;
                if (dom.filterClear) dom.filterClear.style.display = (st.field && (st.section || st.value)) ? '' : 'none';

                // Accordion
                if (dom.filterToggle && dom.filterBody) {
                    dom.filterToggle.addEventListener('click', function () {
                        var open = dom.filterBody.hasAttribute('hidden');
                        dom.filterBody.hidden = !open;
                        dom.filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                    });
                }

                // Date filter
                if (dom.dateFrom) dom.dateFrom.addEventListener('change', function () { applyStateAndRender(); });
                if (dom.dateTo) dom.dateTo.addEventListener('change', function () { applyStateAndRender(); });
                if (dom.btnReset) dom.btnReset.addEventListener('click', function () {
                    if (dom.dateFrom) dom.dateFrom.value = '';
                    if (dom.dateTo) dom.dateTo.value = '';
                    applyStateAndRender();
                });

                // Filter selects
                if (dom.filterField) {
                    dom.filterField.addEventListener('change', function () {
                        // Draft – pouze změna nabídky hodnot; nic se ještě neaplikuje
                        syncFilterValueSelect();
                        if (dom.filterApply) dom.filterApply.disabled = !(dom.filterField.value && dom.filterValue && dom.filterValue.value);
                    });
                }
                if (dom.filterValue) {
                    dom.filterValue.addEventListener('change', function () {
                        if (dom.filterApply) dom.filterApply.disabled = !(dom.filterField && dom.filterField.value && dom.filterValue.value);
                    });
                }

                // Apply/Clear
                if (dom.filterApply) {
                    dom.filterApply.addEventListener('click', function () {
                        var field = dom.filterField ? String(dom.filterField.value || '') : '';
                        var v = dom.filterValue ? String(dom.filterValue.value || '') : '';
                        if (!field || !v) return;
                        var next = getStatsState();
                        next.field = field;
                        next.section = '';
                        next.value = '';
                        if (field === 'section') next.section = v;
                        else next.value = v;
                        setStatsState(next);
                        if (dom.filterApply) dom.filterApply.disabled = true;
                        if (dom.filterClear) dom.filterClear.style.display = '';
                        applyStateAndRender();
                    });
                }
                if (dom.filterClear) {
                    dom.filterClear.addEventListener('click', function () {
                        setStatsState({});
                        if (dom.filterField) dom.filterField.value = '';
                        syncFilterValueSelect();
                        if (dom.filterValue) dom.filterValue.value = '';
                        if (dom.filterApply) dom.filterApply.disabled = true;
                        dom.filterClear.style.display = 'none';
                        applyStateAndRender();
                    });
                }

                // Export buttons (sidebar + pod tabulkou)
                function onExport(kind) {
                    if (!isStatsActive()) return;
                    var items = computeStatsFilteredItems();
                    if (kind === 'csv') exportCsvFromItems(items, 'omnishelf-statistiky');
                    else exportPdfFromItems(items, 'Omshelf – Statistiky (podle filtru)');
                }
                if (dom.exportPdfSidebar) dom.exportPdfSidebar.addEventListener('click', function () { onExport('pdf'); });
                if (dom.exportCsvSidebar) dom.exportCsvSidebar.addEventListener('click', function () { onExport('csv'); });
                if (dom.exportPdfStats) dom.exportPdfStats.addEventListener('click', function () { onExport('pdf'); });
                if (dom.exportCsvStats) dom.exportCsvStats.addEventListener('click', function () { onExport('csv'); });

                // Expose for navigation.js
                window.__OMNI_renderStatistics = function () {
                    // při přepnutí do Statistik zkontroluj options + ukaž poslední aplikovaný filtr jako draft
                    var st2 = getStatsState();
                    if (dom.filterField) dom.filterField.value = String(st2.field || '');
                    syncFilterValueSelect();
                    if (dom.filterValue) dom.filterValue.value = (String(st2.field || '') === 'section') ? String(st2.section || '') : String(st2.value || '');
                    if (dom.filterApply) dom.filterApply.disabled = true;
                    if (dom.filterClear) dom.filterClear.style.display = (st2.field && (st2.section || st2.value)) ? '' : 'none';
                    renderStatistics();
                };

                // initial render (pokud user už je ve statistikách)
                if (isStatsActive()) renderStatistics();
            }

            initStatisticsUi();
        })();

        // Synchronizace s Gatekeeperem: aktuální profil = zdroj pravdy pro úložiště
        try {
            var storedId = localStorage.getItem(CURRENT_USER_KEY);
            if (storedId && typeof storedId === 'string' && storedId.trim()) currentProfileId = storedId.trim();
        } catch (e) {}
        var currentUserId = getCurrentUserId();
        if (currentUserId === 'default' || currentUserId === 'legacy_admin') {
            var hasLegacyData = localStorage.getItem(BASE_STORAGE_KEY);
            if (hasLegacyData && !localStorage.getItem(CURRENT_USER_KEY)) {
                try { localStorage.setItem(CURRENT_USER_KEY, 'legacy_admin'); } catch (e2) {}
            }
        }
        ensureStorageUserSync();
        loadLibrary();
        if (library.length === 0) {
            try {
                var demo = [
                    { id: generateBookId(), title: 'Dámy a pánové', author: 'Terry Pratchett', location: 'Bez poličky', physicalLocation: 'Bez poličky', ownershipStatus: 'mine', readingStatus: 'unread', privacy: 'private', is_favorite: false, isFavorite: false, addedAt: new Date().toISOString() },
                    { id: generateBookId(), title: 'Dlouhá země', author: 'Terry Pratchett', location: 'Bez poličky', physicalLocation: 'Bez poličky', ownershipStatus: 'mine', readingStatus: 'reading', privacy: 'private', is_favorite: false, isFavorite: false, addedAt: new Date().toISOString() },
                    { id: generateBookId(), title: 'Klubko kouzel', author: 'Terry Pratchett', location: 'Bez poličky', physicalLocation: 'Bez poličky', ownershipStatus: 'borrowed', readingStatus: 'read', privacy: 'private', is_favorite: true, isFavorite: true, borrowedTo: 'Jana', addedAt: new Date().toISOString() }
                ];
                demo.forEach(function (b) { migrateBookToNewFields(b); library.push(b); });
                saveLibrary();
            } catch (e) {}
        }
        // Jednorázové nouzové zmenšení starých velkých obálek (uvolní quota v localStorage)
        setTimeout(function () {
            runOneTimeCoverDownsizeMigration().then(function (changed) {
                if (changed) {
                    // po uložení znovu překresli (už menší obálky)
                    if (emptyState && scanHistoryGrid && shelfNameInput) renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
                }
            });
        }, 50);
        renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        if (resultsBody && currentBooks.length > 0) renderResultsTable(resultsBody, shelfNameInput);

        window.addEventListener('beforeunload', function () {
            ensureStorageUserSync();
            saveLibrary();
            if (typeof window.OMNI_UserState !== 'undefined' && window.OMNI_UserState.ensureDataSavedUnderCurrentUser) {
                window.OMNI_UserState.ensureDataSavedUnderCurrentUser();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 450); });
    } else {
        setTimeout(init, 450);
    }
})();
