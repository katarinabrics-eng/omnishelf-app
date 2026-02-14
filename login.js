/**
 * login.js – registrace + přihlášení do localStorage.
 * - Uživatelé: localStorage['omnishelf_users'] = [{ id, username, password, role, createdAt }]
 * - Session: localStorage['omnishelf_current_user'] = user.id
 * - Role + jméno (pro budoucí UI): localStorage['omnishelf_current_user_role'], ['omnishelf_current_user_name']
 *
 * Backdoor: pokud je username nebo password přesně ".", přihlásí jako Master Admin (admin).
 */
(function () {
    'use strict';

    var USERS_KEY = 'omnishelf_users';
    var CURRENT_USER_KEY = 'omnishelf_current_user';
    var CURRENT_USER_ROLE_KEY = 'omnishelf_current_user_role';
    var CURRENT_USER_NAME_KEY = 'omnishelf_current_user_name';

    var ADMIN_USER_ID = 'legacy_admin';
    var ADMIN_DISPLAY_NAME = 'Master Admin';

    var isRegisterMode = false;

    function $(id) { return document.getElementById(id); }

    function safeParse(json, fallback) {
        try { return JSON.parse(json); } catch (e) { return fallback; }
    }

    function getUsers() {
        try {
            var raw = localStorage.getItem(USERS_KEY);
            var list = raw ? safeParse(raw, []) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function saveUsers(users) {
        try { localStorage.setItem(USERS_KEY, JSON.stringify(users || [])); } catch (e) {}
    }

    function normalizeUsername(u) {
        return (u || '').trim();
    }

    function canonicalUsername(u) {
        return normalizeUsername(u).toLowerCase();
    }

    function findUserByUsername(users, username) {
        var cu = canonicalUsername(username);
        if (!cu) return null;
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            if (!u) continue;
            if (canonicalUsername(u.username) === cu) return u;
        }
        return null;
    }

    function showError(msg) {
        var el = $('authError');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('visible', !!msg);
    }

    function showSuccess(msg) {
        var el = $('authSuccess');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('visible', !!msg);
    }

    function getNextUrl() {
        var fallback = 'app.html';
        try {
            var params = new URLSearchParams(window.location.search || '');
            var next = params.get('next') || '';
            next = String(next || '').trim();
            // jednoduchá ochrana proti open-redirect
            if (!next) return fallback;
            if (next.indexOf('://') >= 0) return fallback;
            if (next.indexOf('\\') >= 0) return fallback;
            var allowed = ['app.html', 'library.html', 'vitus.html'];
            if (!allowed.some(function (p) { return next === p || next.indexOf(p + '?') === 0; })) return fallback;
            return next;
        } catch (e) {
            return fallback;
        }
    }

    function getAuthModeFromUrl() {
        try {
            var p = new URLSearchParams(window.location.search || '');
            var m = String(p.get('mode') || '').trim().toLowerCase();
            var reg = String(p.get('register') || '').trim();
            if (m === 'register' || reg === '1' || reg === 'true') return 'register';
            if (m === 'login') return 'login';
        } catch (e) {}
        return '';
    }

    function isFileProtocol() {
        try { return String(window.location.protocol || '') === 'file:'; } catch (e) { return false; }
    }

    function setLoggedInState(isLoggedIn) {
        try {
            if (window.OMNI_UserState && typeof window.OMNI_UserState.setLoggedIn === 'function') {
                window.OMNI_UserState.setLoggedIn(!!isLoggedIn);
            } else {
                // fallback: minimalní kompatibilita
                localStorage.setItem('omnishelf_user_state', JSON.stringify({ isLoggedIn: !!isLoggedIn, tier: 'free', familyId: null, familyCode: null }));
            }
        } catch (e) {}
    }

    function setSession(user) {
        try { localStorage.setItem(CURRENT_USER_KEY, String(user.id || 'default')); } catch (e) {}
        try { localStorage.setItem(CURRENT_USER_ROLE_KEY, String(user.role || 'user')); } catch (e2) {}
        try { localStorage.setItem(CURRENT_USER_NAME_KEY, String(user.displayName || user.username || user.id || '')); } catch (e3) {}
        setLoggedInState(true);
    }

    function loginAsAdminBackdoor() {
        setSession({ id: ADMIN_USER_ID, role: 'admin', displayName: ADMIN_DISPLAY_NAME, username: ADMIN_DISPLAY_NAME });
        window.location.href = getNextUrl();
    }

    function sanitizeUserId(username) {
        var cu = canonicalUsername(username);
        if (!cu) return '';
        // jen bezpečné znaky pro klíč
        cu = cu.replace(/[^a-z0-9_\-\.]/g, '_');
        return 'user__' + cu;
    }

    function setMode(isRegister) {
        isRegisterMode = !!isRegister;
        var title = $('auth-title');
        var subtitle = $('auth-subtitle');
        var btn = $('auth-submit-btn');
        var toggleText = $('toggle-text');
        var passwordInput = $('password');
        try { document.body.classList.toggle('is-register', isRegisterMode); } catch (e0) {}

        if (isRegisterMode) {
            if (title) title.textContent = 'Registrace do OmniShelf';
            if (subtitle) subtitle.textContent = 'Vytvořte si účet a pokračujte do aplikace.';
            if (btn) btn.textContent = 'Vytvořit účet';
            if (toggleText) toggleText.innerHTML = 'Už máte účet? <span id="toggle-link">Přihlásit se</span>';
            if (passwordInput) passwordInput.setAttribute('autocomplete', 'new-password');
        } else {
            if (title) title.textContent = 'Přihlášení do OmniShelf';
            if (subtitle) subtitle.textContent = 'Vítejte zpět! Prosím, přihlaste se.';
            if (btn) btn.textContent = 'Vstoupit';
            if (toggleText) toggleText.innerHTML = 'Nemáte ještě účet? <span id="toggle-link">Zaregistrujte se</span>';
            if (passwordInput) passwordInput.setAttribute('autocomplete', 'current-password');
        }

        // po přepsání innerHTML se mění node reference
        var toggleLink = $('toggle-link');
        if (toggleLink) toggleLink.addEventListener('click', function () {
            showError('');
            showSuccess('');
            setMode(!isRegisterMode);
        });
    }

    function resetPasswordTestFlow() {
        showError('');
        showSuccess('');

        var users = getUsers();
        if (!users || !users.length) {
            showError('Zatím tu není žádný účet. Nejprve se zaregistrujte.');
            return;
        }

        var who = window.prompt('Reset hesla (test)\n\nZadejte uživatelské jméno / e-mail účtu, kterému chcete změnit heslo:', '');
        who = normalizeUsername(who);
        if (!who) return;

        var u = findUserByUsername(users, who);
        if (!u) {
            showError('Účet nebyl nalezen.');
            return;
        }

        var newPass = window.prompt('Zadejte nové heslo (test):', '123456');
        newPass = String(newPass || '').trim();
        if (!newPass) return;

        // U test režimu neřešíme hashování ani e-mailové ověření – jen přepíšeme.
        u.password = newPass;
        saveUsers(users);
        showSuccess('Hotovo. Heslo bylo změněno. Teď se můžete přihlásit.');
    }

    function init() {
        var form = $('login-form');
        var usernameInput = $('username');
        var passwordInput = $('password');
        if (!form || !usernameInput || !passwordInput) return;

        var regNameInput = $('regName');
        var regAgeInput = $('regAge');
        var btnReset = $('btnResetPasswordTest');
        var btnAdminDot = $('btnAdminDot');

        // UX: pokud není žádný účet, začni rovnou registrací
        var users0 = getUsers();
        var forced = getAuthModeFromUrl();
        if (forced === 'register') setMode(true);
        else if (forced === 'login') setMode(false);
        else setMode(!(users0 && users0.length));

        // Upozornění pro file:// režim (localStorage může být nečekaně izolovaný mezi stránkami v některých prohlížečích)
        if (isFileProtocol()) {
            showError('Poznámka: aplikaci otevíráte jako soubor (file://). V některých prohlížečích pak přihlášení/účty nemusí fungovat konzistentně mezi stránkami. Doporučení: spustit OmniShelf přes lokální server (localhost).');
        }

        if (btnReset) {
            btnReset.addEventListener('click', function () {
                resetPasswordTestFlow();
            });
        }
        if (btnAdminDot) {
            btnAdminDot.addEventListener('click', function () {
                showError('');
                showSuccess('');
                loginAsAdminBackdoor();
            });
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            showError('');
            showSuccess('');

            var username = normalizeUsername(usernameInput.value);
            var password = String(passwordInput.value || '').trim();

            // Backdoor tečka: jméno nebo heslo pouze "."
            if (username === '.' || password === '.') {
                loginAsAdminBackdoor();
                return;
            }

            if (!username) {
                showError('Zadejte uživatelské jméno.');
                return;
            }
            if (!password) {
                showError('Zadejte heslo.');
                return;
            }

            var users = getUsers();

            if (isRegisterMode) {
                var existing = findUserByUsername(users, username);
                if (existing) {
                    showError('Tento uživatel už existuje. Zkuste se přihlásit.');
                    return;
                }
                var id = sanitizeUserId(username);
                if (!id) {
                    showError('Neplatné uživatelské jméno.');
                    return;
                }
                var displayName = normalizeUsername(regNameInput && regNameInput.value) || username;
                var age = '';
                if (regAgeInput && String(regAgeInput.value || '').trim()) {
                    age = String(regAgeInput.value || '').trim();
                }
                var newUser = {
                    id: id,
                    username: username,
                    displayName: displayName,
                    password: password,
                    role: 'user',
                    createdAt: new Date().toISOString(),
                    age: age
                };
                users.push(newUser);
                saveUsers(users);
                setSession(newUser);
                window.location.href = getNextUrl();
                return;
            }

            // Login
            var user = findUserByUsername(users, username);
            if (!user || String(user.password || '') !== password) {
                showError('Nesprávné jméno nebo heslo.');
                return;
            }
            setSession(user);
            window.location.href = getNextUrl();
        });

        // Pokud už je přihlášený, rovnou přesměruj (ale ne když uživatel chce registraci)
        try {
            var u = window.OMNI_UserState && window.OMNI_UserState.getCurrentUser ? window.OMNI_UserState.getCurrentUser() : null;
            var hasSession = false;
            try { hasSession = !!(localStorage.getItem(CURRENT_USER_KEY) || '').trim(); } catch (e0) { hasSession = false; }
            if (forced !== 'register' && u && u.isLoggedIn === true && hasSession) {
                window.location.href = getNextUrl();
            }
        } catch (e2) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

