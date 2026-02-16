/**
 * Omshelf – uživatelský stav, tarif (tier) a rodinná synchronizace.
 * Použití: kontrola přístupu k Omshelf Kids, zobrazení ceníku, sdílení knihovny pod FamilyID.
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'omnishelf_user_state';

    var currentUser = {
        isLoggedIn: false,
        tier: 'free',      // 'free' | 'pro' | 'family'
        familyId: null,    // při platném rodinném kódu – přístup ke společné databázi
        familyCode: null   // zobrazený kód (např. pro ověření)
    };

    function load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (data && typeof data.tier === 'string') currentUser.tier = data.tier;
                if (data && typeof data.isLoggedIn === 'boolean') currentUser.isLoggedIn = data.isLoggedIn;
                if (data && (data.familyId === null || typeof data.familyId === 'string')) currentUser.familyId = data.familyId || null;
                if (data && (data.familyCode === null || typeof data.familyCode === 'string')) currentUser.familyCode = data.familyCode || null;
            }
        } catch (e) {}
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        } catch (e) {}
    }

    load();

    /** Je tarif PRO nebo FAMILY (přístup ke všem sektorům a Kids). */
    function isPremium() {
        return currentUser.tier === 'pro' || currentUser.tier === 'family';
    }

    /** Může uživatel otevřít Omshelf Kids (potřeba PRO nebo FAMILY). */
    function canAccessKids() {
        return isPremium();
    }

    function setTier(tier) {
        if (tier === 'free' || tier === 'pro' || tier === 'family') {
            currentUser.tier = tier;
            save();
            return true;
        }
        return false;
    }

    function setLoggedIn(value) {
        currentUser.isLoggedIn = value === true;
        save();
    }

    /** Vrací FamilyID, pod nímž se sdílí knihovna (localStorage). Null = vlastní data. */
    function getFamilyId() {
        return currentUser.familyId;
    }

    /** Nastaví rodinný přístup po zadání platného kódu. Kód = FamilyID nebo budoucí token. */
    function joinFamilyByCode(code) {
        var c = (code || '').trim();
        if (!c) return { ok: false, message: 'Zadejte kód.' };
        currentUser.familyId = c;
        currentUser.familyCode = c;
        save();
        return { ok: true, familyId: c };
    }

    /** Odpojí od rodinné knihovny (přepne zpět na vlastní úložiště). */
    function leaveFamily() {
        currentUser.familyId = null;
        currentUser.familyCode = null;
        save();
    }

    function getCurrentUser() {
        return {
            isLoggedIn: currentUser.isLoggedIn,
            tier: currentUser.tier,
            familyId: currentUser.familyId,
            familyCode: currentUser.familyCode
        };
    }

    /**
     * Vrací ID pro úložiště knihovny (localStorage). Propojení s Gatekeeperem:
     * knihovna ukládá pod klíčem omnishelf_library__user__{id} nebo __family__{familyId}.
     * Při přihlášení / změně profilu nastavte v knihovně CURRENT_USER_KEY (omnishelf_current_user)
     * na toto ID, aby load/save používaly správný účet.
     */
    function getStorageUserId() {
        if (currentUser.familyId) return currentUser.familyId;
        return 'default';
    }

    /** Zajistí, že data jsou uložena pod aktuálním uživatelem (volá knihovna před odchodem ze stránky). */
    function ensureDataSavedUnderCurrentUser() {
        save();
    }

    global.OMNI_UserState = {
        getCurrentUser: getCurrentUser,
        setTier: setTier,
        setLoggedIn: setLoggedIn,
        getFamilyId: getFamilyId,
        getStorageUserId: getStorageUserId,
        joinFamilyByCode: joinFamilyByCode,
        leaveFamily: leaveFamily,
        isPremium: isPremium,
        canAccessKids: canAccessKids,
        ensureDataSavedUnderCurrentUser: ensureDataSavedUnderCurrentUser,
        load: load
    };
})(typeof window !== 'undefined' ? window : this);
