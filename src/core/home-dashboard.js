/**
 * src/core/home-dashboard.js
 * Domovská stránka – oznámení a přehled z knihovny, Vitus, zpráv.
 */
(function () {
    'use strict';

    var BASE_STORAGE_KEY = 'omnishelf_library';
    var CURRENT_USER_KEY = 'omnishelf_current_user';
    var VITUS_STORAGE_KEY = 'omnishelf_vitus_data';

    function getLibraryStorageKey() {
        var familyId = typeof window.OMNI_UserState !== 'undefined' && window.OMNI_UserState.getFamilyId && window.OMNI_UserState.getFamilyId();
        var userId = '';
        try { userId = String(localStorage.getItem(CURRENT_USER_KEY) || '').trim(); } catch (e) {}
        if (familyId) return BASE_STORAGE_KEY + '__family__' + familyId;
        return BASE_STORAGE_KEY + '__user__' + (userId || 'default');
    }

    function safeParseJson(raw, fallback) {
        try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }

    function todayStr() {
        try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; }
    }

    function getLibraryData() {
        var key = getLibraryStorageKey();
        var raw = '';
        try { raw = localStorage.getItem(key); } catch (e) {}
        var data = safeParseJson(raw, null);
        var library = (data && Array.isArray(data.library)) ? data.library : [];
        return library;
    }

    function getVitusData() {
        var raw = '';
        try { raw = localStorage.getItem(VITUS_STORAGE_KEY); } catch (e) {}
        var data = safeParseJson(raw, null);
        var meds = (data && Array.isArray(data.meds)) ? data.meds : [];
        return meds;
    }

    function getShelves(books) {
        var shelves = {};
        books.forEach(function (b) {
            var loc = (b.physicalLocation || b.location || 'Bez poličky').trim() || 'Bez poličky';
            shelves[loc] = (shelves[loc] || 0) + 1;
        });
        return shelves;
    }

    function refreshHomeDashboard() {
        var listEl = document.getElementById('homeNotificationsList');
        var emptyEl = document.getElementById('homeNotificationsEmpty');
        var libText = document.getElementById('homeOverviewLibraryText');
        var vitusText = document.getElementById('homeOverviewVitusText');

        var books = getLibraryData();
        var meds = getVitusData();
        var today = todayStr();

        var notifications = [];
        var status = function (s) { return String(s || '').toLowerCase().replace(/\s/g, ''); };
        var hasOverdueBorrowed = false;
        var hasOverdueBorrowedByMe = false;
        var hasReading = false;

        books.forEach(function (b) {
            var own = status(b.ownershipStatus || b.status);
            var read = status(b.readingStatus);
            var due = (b.returnDueDate || b.returnDate || '').trim();

            if (own === 'borrowed' && due && due <= today && !hasOverdueBorrowed) {
                hasOverdueBorrowed = true;
                var name = (b.borrowedTo || b.owner || '').trim() || 'Dlužník';
                notifications.push({ type: 'library', text: 'Napsat ' + name + ' – kniha po termínu vrácení', href: './app.html?module=library', view: 'borrowed' });
            }
            if (own === 'borrowedbyme' && due && due <= today && !hasOverdueBorrowedByMe) {
                hasOverdueBorrowedByMe = true;
                notifications.push({ type: 'library', text: 'Vrátit knihu – po termínu', href: './app.html?module=library', view: 'borrowedByMe' });
            }
            if (read === 'reading' && !hasReading) {
                hasReading = true;
                notifications.push({ type: 'library', text: 'Máš rozečtenou knihu', href: './app.html?module=library', view: 'currentlyReading' });
            }
        });

        if (meds.length > 0) {
            var low = meds.filter(function (m) {
                var r = Number(m.remainingQuantity);
                var t = Number(m.totalQuantity);
                return isFinite(r) && isFinite(t) && t > 0 && r <= t * 0.2;
            });
            if (low.length > 0) {
                notifications.push({ type: 'vitus', text: 'Doplnit léky – ' + low.length + ' položek', href: './app.html?module=vitus' });
            }
        }

        if (listEl) {
            listEl.innerHTML = '';
            if (notifications.length > 0 && emptyEl) emptyEl.style.display = 'none';
            else if (emptyEl) emptyEl.style.display = 'block';

            notifications.slice(0, 6).forEach(function (n) {
                var li = document.createElement('li');
                li.className = 'home-notification-item';
                var a = document.createElement('a');
                a.href = n.href || '#';
                a.className = 'home-notification-link';
                a.textContent = n.text;
                li.appendChild(a);
                listEl.appendChild(li);
            });
        }

        var shelves = getShelves(books);
        var shelfCount = Object.keys(shelves).filter(function (k) { return k !== 'Bez poličky'; }).length;
        if (shelfCount === 0 && books.length > 0) shelfCount = 1;

        if (libText) {
            var parts = [];
            if (books.length > 0) parts.push(books.length + ' knih');
            if (shelfCount > 0) parts.push(shelfCount + ' poliček');
            libText.textContent = parts.length > 0 ? parts.join(', ') : 'Prázdná knihovna';
        }

        if (vitusText) {
            vitusText.textContent = meds.length > 0 ? meds.length + ' aktuálních léků' : 'Žádné léky';
        }
    }

    window.__OMNI_refreshHomeDashboard = refreshHomeDashboard;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (document.body.classList.contains('module-home')) refreshHomeDashboard();
        });
    } else if (document.body && document.body.classList.contains('module-home')) {
        refreshHomeDashboard();
    }
})();
