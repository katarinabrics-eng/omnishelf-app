(function (global) {
    'use strict';

    var STORAGE_PUBLIC = 'omnishelf_friends_public_recos_v1';
    var STORAGE_PRIVATE_PREFIX = 'omnishelf_friends_recos_v1__';
    var STORAGE_BORROW_INTENTS = 'omnishelf_friends_borrow_intents_v1';

    function nowIso() {
        try { return new Date().toISOString(); } catch (e) { return String(Date.now()); }
    }

    function norm(s) {
        if (s == null) return '';
        return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function safeJsonParse(raw, fallback) {
        try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }

    function getCurrentUserKey() {
        try { return String(localStorage.getItem('omnishelf_current_user') || '').trim() || 'anon'; } catch (e) { return 'anon'; }
    }

    function getPrivateStorageKey() {
        return STORAGE_PRIVATE_PREFIX + getCurrentUserKey();
    }

    function loadList(key) {
        try { return safeJsonParse(localStorage.getItem(key), []); } catch (e) { return []; }
    }

    function saveList(key, list) {
        try { localStorage.setItem(key, JSON.stringify(list || [])); return true; } catch (e) { return false; }
    }

    function loadBorrowIntents() {
        try { return safeJsonParse(localStorage.getItem(STORAGE_BORROW_INTENTS), {}); } catch (e) { return {}; }
    }
    function saveBorrowIntents(map) {
        try { localStorage.setItem(STORAGE_BORROW_INTENTS, JSON.stringify(map || {})); return true; } catch (e) { return false; }
    }

    function getBorrowIntentKey(r) {
        // stabilní klíč: bookKey + doporučující osoba
        var k = String((r && r.bookKey) || computeBookKey(r) || '').trim();
        var f = String((r && r.from) || '').trim();
        return (k || 'nokey') + '::' + f;
    }

    function computeBookKey(o) {
        var isbn = (o && o.isbn) ? String(o.isbn).replace(/\s/g, '') : '';
        if (isbn) return 'isbn:' + isbn;
        var t = norm(o && o.title);
        var a = norm(o && o.author);
        if (!t && !a) return '';
        return 'ta:' + t + '|' + a;
    }

    function getActiveLibraryView() {
        var activeBtn = document.querySelector('#librarySubmenu .sidebar-submenu-item.active');
        return (activeBtn && activeBtn.getAttribute('data-view')) || 'collection';
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, function (m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '"' ? '&quot;' : '&#039;';
        });
    }

    function truncate(s, n) {
        var t = String(s || '');
        if (t.length <= n) return t;
        return t.slice(0, Math.max(0, n - 1)).trim() + '…';
    }

    function interestingScore(r) {
        var up = Number(r && r.upvotes) || 0;
        var msg = String((r && r.message) || '');
        return up * 10 + Math.min(120, msg.length);
    }

    function getDom() {
        return {
            section: document.getElementById('friendsRecommendationsSection'),
            grid: document.getElementById('friendsRecoGrid'),
            empty: document.getElementById('friendsRecoEmpty'),
            tabs: document.querySelectorAll('.friends-reco-tab'),
            panelSearch: document.getElementById('friendsRecoPanelSearch'),
            panelAdd: document.getElementById('friendsRecoPanelAdd'),
            panelAi: document.getElementById('friendsRecoPanelAi'),
            acc: document.getElementById('friendsRecoAccordion'),
            accToggle: document.getElementById('friendsRecoAccordionToggle'),
            accBody: document.getElementById('friendsRecoAccordionBody'),
            fName: document.getElementById('friendsFilterName'),
            fTitle: document.getElementById('friendsFilterTitle'),
            fAuthor: document.getElementById('friendsFilterAuthor'),
            fGenre: document.getElementById('friendsFilterGenre'),
            fCircle: document.getElementById('friendsFilterCircle'),
            fSort: document.getElementById('friendsFilterSort'),
            addForm: document.getElementById('friendsRecoAddForm'),
            addFrom: document.getElementById('friendsAddFrom'),
            addTitle: document.getElementById('friendsAddTitle'),
            addAuthor: document.getElementById('friendsAddAuthor'),
            addGenre: document.getElementById('friendsAddGenre'),
            addCircle: document.getElementById('friendsAddCircle'),
            addAvail: document.getElementById('friendsAddAvailability'),
            addMsg: document.getElementById('friendsAddMessage')
        };
    }

    var state = {
        inited: false
    };

    function getMergedRecommendations() {
        var mine = loadList(getPrivateStorageKey());
        var pub = loadList(STORAGE_PUBLIC);
        // označ zdroj pro debug / UI
        mine.forEach(function (r) { if (r && !r._src) r._src = 'private'; });
        pub.forEach(function (r) { if (r && !r._src) r._src = 'public'; });
        // spoj
        return pub.concat(mine);
    }

    function initials(name) {
        var n = String(name || '').trim();
        if (!n) return '??';
        var parts = n.split(/\s+/).filter(Boolean);
        var a = parts[0] ? parts[0][0] : '';
        var b = parts.length > 1 ? parts[1][0] : (parts[0] && parts[0].length > 1 ? parts[0][1] : '');
        return (String(a || '?') + String(b || '')).toUpperCase();
    }

    function getSeedRecommendations() {
        var base = [
            {
                from: 'Jana B.',
                title: 'Čaroprávnost',
                author: 'Terry Pratchett',
                genre: 'Fantasy',
                message: 'Tuto knihu si přečtěte – je opravdu výborná.',
                availability: 'available',
                circle: 'friends'
            },
            {
                from: 'Martin K.',
                title: 'Eskarina: Čarodějka',
                author: 'Terry Pratchett',
                genre: 'Fantasy',
                message: 'Eskarina v akci – tuto čarodějku si zamilujete.',
                availability: 'available',
                circle: 'friends'
            },
            {
                from: 'Petra V.',
                title: 'Konec prokrastinace',
                author: 'Petr Ludwig',
                genre: 'Osobní rozvoj',
                message: 'Měla jsem ji na nočním stolku celý měsíc. Je přínosná a čtivá.',
                availability: 'available',
                circle: 'friends'
            },
            {
                from: 'Jakub K.',
                title: 'Písečníci',
                author: 'Jaroslav Mostecký',
                genre: 'Sci‑fi',
                message: 'Jedno z nejlepších sci‑fi, které jsem četl. Změní vám pohled na čas.',
                availability: 'available',
                circle: 'friends'
            }
        ];
        return base.map(function (r, idx) {
            var o = {
                id: 'seed_' + idx,
                from: r.from,
                title: r.title,
                author: r.author,
                genre: r.genre,
                message: r.message,
                availability: r.availability,
                circle: r.circle,
                privacy: r.circle,
                createdAt: nowIso(),
                _seed: true
            };
            o.bookKey = computeBookKey(o);
            return o;
        });
    }

    function matchesFilters(r, dom) {
        var n = norm(r && r.from);
        var t = norm(r && r.title);
        var a = norm(r && r.author);
        var g = norm(r && r.genre);
        var circle = norm(r && r.circle);

        var qName = norm(dom.fName && dom.fName.value);
        var qTitle = norm(dom.fTitle && dom.fTitle.value);
        var qAuthor = norm(dom.fAuthor && dom.fAuthor.value);
        var qGenre = norm(dom.fGenre && dom.fGenre.value);
        var qCircle = norm(dom.fCircle && dom.fCircle.value);

        if (qName && n.indexOf(qName) === -1) return false;
        if (qTitle && t.indexOf(qTitle) === -1) return false;
        if (qAuthor && a.indexOf(qAuthor) === -1) return false;
        if (qGenre && g.indexOf(qGenre) === -1) return false;
        if (qCircle && circle !== qCircle) return false;
        return true;
    }

    function render() {
        var dom = getDom();
        if (!dom.section || !dom.grid) return;
        if (getActiveLibraryView() !== 'friendsHighlights') return;

        var merged = getMergedRecommendations().filter(function (r) { return !!r && !!r.title; });
        var hasStored = merged.length > 0;
        var list = merged.filter(function (r) { return matchesFilters(r, dom); });
        var usingSeed = false;
        if (!hasStored) {
            usingSeed = true;
            list = getSeedRecommendations().filter(function (r) { return matchesFilters(r, dom); });
        }

        var sort = (dom.fSort && dom.fSort.value) || 'newest';
        list.sort(function (a, b) {
            if (sort === 'interesting') return interestingScore(b) - interestingScore(a);
            var da = Date.parse(a && a.createdAt) || 0;
            var db = Date.parse(b && b.createdAt) || 0;
            return db - da;
        });

        dom.grid.innerHTML = '';
        var seedNote = document.getElementById('friendsRecoSeedNote');
        if (seedNote) seedNote.hidden = !usingSeed;
        if (!list.length) {
            if (dom.empty) dom.empty.style.display = 'block';
            return;
        }
        if (dom.empty) dom.empty.style.display = 'none';

        var intents = loadBorrowIntents();
        list.forEach(function (r) {
            var card = document.createElement('div');
            card.className = 'friends-reco-card';
            card.setAttribute('data-book-key', r.bookKey || '');

            var top = document.createElement('div');
            top.className = 'friends-reco-top';

            var cover = document.createElement('div');
            cover.className = 'friends-reco-cover no-cover';
            cover.innerHTML = '<div class="friends-reco-cover-frame"><img src="assets/img/placeholders/default-book-icon.png" alt="Žádná obálka" class="friends-reco-cover-icon"></div>';

            var meta = document.createElement('div');
            meta.className = 'friends-reco-meta';
            meta.innerHTML =
                '<div class="friends-reco-book-title">' + escapeHtml(String(r.title || '').trim()) + '</div>' +
                '<div class="friends-reco-book-author">' + escapeHtml(String(r.author || '').trim() || '—') + '</div>' +
                '<div class="friends-reco-book-genre">' + escapeHtml(String(r.genre || '').trim() || '—') + '</div>';

            top.appendChild(cover);
            top.appendChild(meta);

            var bubble = document.createElement('div');
            bubble.className = 'friends-reco-bubble';
            var msg = String((r.message || '')).trim();
            if (!msg) {
                msg = 'Tato kniha vám pravděpodobně sedne. Dejte jí šanci a napište mi, jak se vám líbila.';
            }
            var av = initials(r.from || '');
            bubble.innerHTML =
                '<div class="friends-reco-bubble-from"><span class="friends-reco-avatar" aria-hidden="true">' + escapeHtml(av) + '</span><span class="friends-reco-from-name">' + escapeHtml(String(r.from || 'Neznámý přítel')) + '</span></div>' +
                '<div class="friends-reco-bubble-text">' + escapeHtml(truncate(msg, 220)) + '</div>';

            var bottom = document.createElement('div');
            bottom.className = 'friends-reco-bottom';

            var avail = document.createElement('div');
            var isAvail = (String(r.availability || 'available') === 'available');
            avail.className = 'friends-reco-availability' + (isAvail ? ' is-available' : ' is-unavailable');
            avail.textContent = isAvail ? 'Dávám k zapůjčení' : 'Nyní nezapůjčuji';

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'friends-reco-borrow-btn';
            var intentKey = getBorrowIntentKey(r);
            var requested = !!(intents && intents[intentKey]);
            btn.textContent = requested ? 'Nechci si půjčit' : 'Chci si půjčit';

            var helper = document.createElement('div');
            helper.className = 'friends-reco-helper';
            helper.textContent = requested
                ? ('Žádost byla odeslána. Knihu můžete získat od: ' + String(r.from || '—') + '.')
                : ('Kliknutím odešlete žádost o zapůjčení a OmniShelf si ji uloží.');
            helper.style.display = requested ? 'block' : 'none';

            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var map = loadBorrowIntents();
                var isOn = !!(map && map[intentKey]);
                if (!map || typeof map !== 'object') map = {};
                if (isOn) {
                    delete map[intentKey];
                    saveBorrowIntents(map);
                    btn.textContent = 'Chci si půjčit';
                    helper.style.display = 'none';
                    helper.textContent = 'Kliknutím odešlete žádost o zapůjčení a OmniShelf si ji uloží.';
                } else {
                    map[intentKey] = {
                        bookKey: r.bookKey || computeBookKey(r),
                        title: r.title || '',
                        author: r.author || '',
                        from: r.from || '',
                        createdAt: nowIso(),
                        status: 'pending'
                    };
                    saveBorrowIntents(map);
                    btn.textContent = 'Nechci si půjčit';
                    helper.style.display = 'block';
                    helper.textContent = 'Žádost byla odeslána. Knihu můžete získat od: ' + String(r.from || '—') + '.';
                    // lehké UX: otevři Tržiště jako "next step" (bez backendu)
                    try {
                        var btnMarketplace = document.getElementById('btnMarketplace');
                        if (btnMarketplace) btnMarketplace.click();
                    } catch (e2) {}
                }
            });

            bottom.appendChild(avail);
            bottom.appendChild(btn);

            card.appendChild(top);
            card.appendChild(bubble);
            card.appendChild(helper);
            card.appendChild(bottom);
            dom.grid.appendChild(card);
        });
    }

    function setTab(tabId) {
        var dom = getDom();
        if (!dom.panelSearch || !dom.panelAdd || !dom.panelAi) return;
        dom.tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-friends-tab') === tabId); });
        dom.panelSearch.hidden = tabId !== 'search';
        dom.panelAdd.hidden = tabId !== 'add';
        dom.panelAi.hidden = tabId !== 'ai';
    }

    function setAccordionOpen(open) {
        var dom = getDom();
        if (!dom.acc || !dom.accToggle || !dom.accBody) return;
        dom.acc.classList.toggle('collapsed', !open);
        dom.accToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        dom.accBody.hidden = !open;
        var ch = dom.accToggle.querySelector('.friends-reco-accordion-chevron');
        if (ch) ch.textContent = open ? '▲' : '▼';
    }

    function prefillAdd(payload) {
        var dom = getDom();
        if (!dom.section) return;
        // přepni na záložku "Zadat"
        setTab('add');
        try { dom.section.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e0) {}
        // vyplň pole
        try {
            if (dom.addTitle && payload && payload.title != null) dom.addTitle.value = String(payload.title || '');
            if (dom.addAuthor && payload && payload.author != null) dom.addAuthor.value = String(payload.author || '');
            if (dom.addGenre && payload && payload.genre != null) dom.addGenre.value = String(payload.genre || '');
            if (dom.addMsg && payload && payload.message != null) dom.addMsg.value = String(payload.message || '');
            // kdo doporučuje = aktuální uživatel (pokud známe)
            var me = '';
            try { me = String(localStorage.getItem('omnishelf_current_user_name') || '').trim(); } catch (e1) {}
            if (!me) me = 'Já';
            if (dom.addFrom && !String(dom.addFrom.value || '').trim()) dom.addFrom.value = me;
        } catch (e2) {}
        try { if (dom.addTitle) dom.addTitle.focus(); } catch (e3) {}
    }

    function handleAddSubmit(e) {
        e.preventDefault();
        var dom = getDom();
        if (!dom.addForm) return;
        var from = String(dom.addFrom && dom.addFrom.value || '').trim();
        var title = String(dom.addTitle && dom.addTitle.value || '').trim();
        if (!from || !title) return;

        var author = String(dom.addAuthor && dom.addAuthor.value || '').trim();
        var genre = String(dom.addGenre && dom.addGenre.value || '').trim();
        var circle = String(dom.addCircle && dom.addCircle.value || 'friends').trim();
        var availability = String(dom.addAvail && dom.addAvail.value || 'available').trim();
        var message = String(dom.addMsg && dom.addMsg.value || '').trim();
        var privacyEl = dom.addForm.querySelector('input[name="friendsPrivacy"]:checked');
        var privacy = privacyEl ? String(privacyEl.value) : circle;

        var reco = {
            id: 'reco_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            from: from,
            title: title,
            author: author,
            genre: genre,
            circle: circle,
            availability: availability,
            message: message,
            privacy: privacy,
            createdAt: nowIso()
        };
        reco.bookKey = computeBookKey(reco);

        var mineKey = getPrivateStorageKey();
        var mine = loadList(mineKey);
        mine.unshift(reco);
        saveList(mineKey, mine);

        if (privacy === 'public') {
            var pub = loadList(STORAGE_PUBLIC);
            pub.unshift(reco);
            saveList(STORAGE_PUBLIC, pub);
        }

        try { dom.addForm.reset(); } catch (e0) {}
        // default privacy zpět na friends
        try {
            var def = dom.addForm.querySelector('input[name="friendsPrivacy"][value="friends"]');
            if (def) def.checked = true;
        } catch (e1) {}

        setTab('search');
        render();
        try { document.dispatchEvent(new CustomEvent('friends-recos-updated')); } catch (e2) {}
    }

    function updateVisibility() {
        var dom = getDom();
        if (!dom.section) return;
        var show = getActiveLibraryView() === 'friendsHighlights';
        dom.section.style.display = show ? 'block' : 'none';
        if (show) {
            setTab('search');
            setAccordionOpen(false);
            render();
        }
    }

    function init() {
        if (state.inited) return;
        state.inited = true;

        var dom = getDom();
        if (!dom.section) return;

        // Tabs
        dom.tabs.forEach(function (t) {
            t.addEventListener('click', function () {
                setTab(t.getAttribute('data-friends-tab') || 'search');
            });
        });

        // Accordion
        if (dom.accToggle) dom.accToggle.addEventListener('click', function () {
            var open = dom.accToggle.getAttribute('aria-expanded') === 'true';
            setAccordionOpen(!open);
        });
        setAccordionOpen(false);

        // Filters
        [dom.fName, dom.fTitle, dom.fAuthor, dom.fGenre].forEach(function (el) {
            if (!el) return;
            el.addEventListener('input', function () { render(); });
        });
        [dom.fCircle, dom.fSort].forEach(function (el) {
            if (!el) return;
            el.addEventListener('change', function () { render(); });
        });

        // Add form
        if (dom.addForm) dom.addForm.addEventListener('submit', handleAddSubmit);

        // View switch
        document.addEventListener('library-view-changed', updateVisibility);
        document.addEventListener('friends-recos-updated', function () {
            // pokud někdo jiný přidal recos (např. jiný modul), rerender
            render();
        });

        updateVisibility();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.OMNI_FriendsRecommendations = {
        init: init,
        render: render,
        prefillAdd: prefillAdd,
        computeBookKey: computeBookKey,
        STORAGE_PUBLIC: STORAGE_PUBLIC
    };
})(typeof window !== 'undefined' ? window : this);

