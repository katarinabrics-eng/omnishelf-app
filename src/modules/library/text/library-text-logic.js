/**
 * Omshelf – Library Text Logic.
 * - Filtrování knih podle view (Tvoje sbírka, Půjčil/a jsem, Rozečteno, ...)
 * - Normalizace statusů pro porovnání (bez diakritiky)
 *
 * Export: window.OMNI_LibraryTextLogic
 */
(function (global) {
    'use strict';

    function normalizeStatusForCompare(str) {
        if (str == null || typeof str !== 'string') return '';
        var s = str.toLowerCase().replace(/\s/g, '');
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function normalizeForSort(str) {
        if (str == null) return '';
        return String(str).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function cmpCs(a, b) {
        return a.localeCompare(b, 'cs');
    }

    function getOwnershipNorm(b) {
        return normalizeStatusForCompare(String((b && (b.ownershipStatus || b.status)) || ''));
    }

    function getPrivacyNorm(b) {
        return normalizeStatusForCompare(String((b && b.privacy) || 'private'));
    }

    function getStatusRank(b) {
        // Požadavek: Půjčená, Přeji si (Wishlist), Prodávám, Prodaná, Doma
        var o = getOwnershipNorm(b);
        if (o === 'borrowed' || o === 'pujceno' || o === 'borrowedbyme') return 0; // Půjčená
        if (o === 'wishlist') return 1; // Přeji si
        if (o === 'forsale') return 2; // Prodávám
        // Prodaná: podporuj různé varianty polí
        var soldFlag = !!(b && (b.sold || b.isSold));
        var soldStatus = (o === 'sold' || o === 'prodano' || o === 'prodaná' || o === 'prodana');
        if (soldFlag || soldStatus) return 3;
        return 4; // Doma
    }

    function getPrivacyRank(b) {
        // Požadavek: Soukromá, Veřejná, Rodinné sdílení
        var p = getPrivacyNorm(b);
        if (p === 'private' || p === 'soukroma' || p === 'soukromá') return 0;
        if (p === 'public' || p === 'verejna' || p === 'veřejná') return 1;
        if (p === 'family' || p === 'rodina' || p === 'rodinne' || p === 'rodinné') return 2;
        return 3;
    }

    function filterLibraryByView(list, view) {
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
            if (view === 'forSale') return ownership === 'forsale';
            if (view === 'favorites') return !!(b.is_favorite || b.isFavorite);
            return true;
        });
    }

    function sortBooksBy(list, sortBy) {
        var arr = Array.isArray(list) ? list.slice() : [];
        var mode = normalizeStatusForCompare(sortBy || 'author');

        // podporuj aliasy (UI může posílat author_az/author_za)
        if (mode === 'authoraz') mode = 'author';
        if (mode === 'authorza') mode = 'authordesc';
        if (mode === 'author_desc') mode = 'authordesc';
        if (mode === 'visibility') mode = 'privacy';

        if (mode === 'genre') {
            arr.sort(function (a, b) {
                var ga = normalizeForSort(a && a.genre);
                var gb = normalizeForSort(b && b.genre);
                return cmpCs(ga, gb) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author)) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        if (mode === 'title') {
            arr.sort(function (a, b) {
                var ta = normalizeForSort(a && a.title);
                var tb = normalizeForSort(b && b.title);
                return cmpCs(ta, tb) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author));
            });
            return arr;
        }

        if (mode === 'titledesc' || mode === 'title_desc') {
            arr.sort(function (a, b) {
                var ta = normalizeForSort(a && a.title);
                var tb = normalizeForSort(b && b.title);
                return cmpCs(tb, ta) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author));
            });
            return arr;
        }

        function getAddedAt(book) {
            var d = book && (book.addedAt || book.added_at || book.createdAt || book.created_at);
            if (!d) return 0;
            var t = typeof d === 'number' ? d : new Date(d).getTime();
            return isNaN(t) ? 0 : t;
        }
        if (mode === 'added' || mode === 'addedat') {
            arr.sort(function (a, b) {
                return getAddedAt(b) - getAddedAt(a);
            });
            return arr;
        }

        if (mode === 'authordesc') {
            arr.sort(function (a, b) {
                var au = normalizeForSort(a && a.author);
                var bu = normalizeForSort(b && b.author);
                return cmpCs(bu, au) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        if (mode === 'author') {
            arr.sort(function (a, b) {
                var au = normalizeForSort(a && a.author);
                var bu = normalizeForSort(b && b.author);
                return cmpCs(au, bu) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        if (mode === 'status') {
            arr.sort(function (a, b) {
                var ra = getStatusRank(a);
                var rb = getStatusRank(b);
                return (ra - rb) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author)) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        if (mode === 'privacy') {
            arr.sort(function (a, b) {
                var pa = getPrivacyRank(a);
                var pb = getPrivacyRank(b);
                return (pa - pb) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author)) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        function getOwnerForSort(book) {
            if (!book) return '';
            var o = normalizeStatusForCompare(book.ownershipStatus || book.status || '');
            if (o === 'borrowedbyme') return normalizeForSort(book.borrowedFrom || book.od_koho || '');
            return normalizeForSort(book.owner || '');
        }
        if (mode === 'owner' || mode === 'majitel') {
            arr.sort(function (a, b) {
                var oa = getOwnerForSort(a);
                var ob = getOwnerForSort(b);
                return cmpCs(oa, ob) || cmpCs(normalizeForSort(a && a.author), normalizeForSort(b && b.author)) || cmpCs(normalizeForSort(a && a.title), normalizeForSort(b && b.title));
            });
            return arr;
        }

        return arr;
    }

    global.OMNI_LibraryTextLogic = {
        normalizeStatusForCompare: normalizeStatusForCompare,
        filterLibraryByView: filterLibraryByView,
        sortBooksBy: sortBooksBy
    };
})(window);

