/**
 * src/modules/vitus/vitus-logic.js
 * Vitus (Apatyka) – datový model + persistence (localStorage).
 *
 * Storage key: localStorage['omnishelf_vitus_data']
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'omnishelf_vitus_data';
    var VERSION = 1;

    function nowIsoDate() {
        // YYYY-MM-DD
        try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; }
    }

    function uid(prefix) {
        var p = String(prefix || 'id');
        return p + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
    }

    function safeJsonParse(raw, fallback) {
        try { return JSON.parse(raw); } catch (e) { return fallback; }
    }

    function normalizeCategory(c) {
        c = String(c || '').trim();
        return c || '';
    }

    function normalizeMed(m) {
        m = m || {};
        var totalQ = Number(m.totalQuantity);
        if (!isFinite(totalQ) || totalQ < 0) totalQ = 0;

        var remainingQ = Number(m.remainingQuantity);
        if (!isFinite(remainingQ) || remainingQ < 0) remainingQ = 0;
        if (totalQ > 0 && remainingQ > totalQ) remainingQ = totalQ;

        var dosage = m.dosage;
        if (typeof dosage === 'string') {
            dosage = { amount: 1, text: dosage };
        }
        dosage = dosage && typeof dosage === 'object' ? dosage : {};
        var dosageAmount = Number(dosage.amount);
        if (!isFinite(dosageAmount) || dosageAmount <= 0) dosageAmount = 1;

        return {
            id: String(m.id || uid('med')),
            name: String(m.name || '').trim(),
            type: String(m.type || '').trim(),
            totalQuantity: totalQ,
            remainingQuantity: remainingQ,
            dosage: {
                amount: dosageAmount,
                text: String(dosage.text || '').trim()
            },
            expiration: String(m.expiration || '').trim(), // YYYY-MM-DD
            purpose: String(m.purpose || '').trim(),
            prescription: String(m.prescription || '').trim(),
            notes: String(m.notes || '').trim(),
            warning: String(m.warning || '').trim(),
            category: normalizeCategory(m.category),
            // obal/fotka léku (data URL), volitelné
            coverImage: (typeof m.coverImage === 'string') ? m.coverImage : '',
            // AI kontext (textový profil z fotek/letáku/receptu) – volitelné
            aiContext: (typeof m.aiContext === 'string') ? m.aiContext : ''
        };
    }

    function normalizeCure(c) {
        c = c || {};
        var start = String(c.start || '').trim();
        var end = String(c.end || '').trim();
        return {
            id: String(c.id || uid('cure')),
            name: String(c.name || '').trim(),
            start: start,
            end: end,
            medIds: Array.isArray(c.medIds) ? c.medIds.map(function (x) { return String(x || ''); }).filter(Boolean) : []
        };
    }

    function makeEmpty() {
        return {
            version: VERSION,
            updatedAt: nowIsoDate(),
            meds: [],
            cures: []
        };
    }

    var state = makeEmpty();

    function load() {
        var raw = '';
        try { raw = String(localStorage.getItem(STORAGE_KEY) || ''); } catch (e0) { raw = ''; }
        if (!raw) {
            state = makeEmpty();
            return state;
        }
        var parsed = safeJsonParse(raw, null);
        if (!parsed || typeof parsed !== 'object') {
            state = makeEmpty();
            return state;
        }

        var meds = Array.isArray(parsed.meds) ? parsed.meds.map(normalizeMed) : [];
        var cures = Array.isArray(parsed.cures) ? parsed.cures.map(normalizeCure) : [];
        state = {
            version: VERSION,
            updatedAt: nowIsoDate(),
            meds: meds,
            cures: cures
        };
        return state;
    }

    function save() {
        state.updatedAt = nowIsoDate();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e0) {}
        try { document.dispatchEvent(new CustomEvent('omni:vitus-data-changed')); } catch (e1) {}
    }

    function getState() {
        return state || load();
    }

    function listMeds() {
        return getState().meds.slice();
    }

    function upsertMed(med) {
        var m = normalizeMed(med);
        if (!m.name) return { ok: false, message: 'Zadejte název léku.' };

        var st = getState();
        var idx = -1;
        for (var i = 0; i < st.meds.length; i++) {
            if (st.meds[i].id === m.id) { idx = i; break; }
        }
        if (idx >= 0) st.meds[idx] = m;
        else st.meds.unshift(m);

        save();
        return { ok: true, med: m };
    }

    function deleteMed(id) {
        id = String(id || '');
        var st = getState();
        st.meds = st.meds.filter(function (m) { return m.id !== id; });
        // odpoj z kúr
        st.cures = st.cures.map(function (c) {
            c.medIds = (c.medIds || []).filter(function (mid) { return mid !== id; });
            return c;
        });
        save();
        return { ok: true };
    }

    function takeDose(id) {
        id = String(id || '');
        var st = getState();
        for (var i = 0; i < st.meds.length; i++) {
            if (st.meds[i].id !== id) continue;
            var m = st.meds[i];
            var amount = (m.dosage && typeof m.dosage.amount === 'number' && isFinite(m.dosage.amount) && m.dosage.amount > 0)
                ? m.dosage.amount
                : 1;
            var next = Math.max(0, Number(m.remainingQuantity || 0) - amount);
            m.remainingQuantity = next;
            st.meds[i] = m;
            save();
            return { ok: true, med: m };
        }
        return { ok: false, message: 'Lék nebyl nalezen.' };
    }

    function listCures() {
        return getState().cures.slice();
    }

    function upsertCure(cure) {
        var c = normalizeCure(cure);
        if (!c.name) return { ok: false, message: 'Zadejte název kúry.' };
        if (!c.start || !c.end) return { ok: false, message: 'Zadejte start i konec.' };

        var st = getState();
        var idx = -1;
        for (var i = 0; i < st.cures.length; i++) {
            if (st.cures[i].id === c.id) { idx = i; break; }
        }
        if (idx >= 0) st.cures[idx] = c;
        else st.cures.unshift(c);

        save();
        return { ok: true, cure: c };
    }

    function deleteCure(id) {
        id = String(id || '');
        var st = getState();
        st.cures = st.cures.filter(function (c) { return c.id !== id; });
        save();
        return { ok: true };
    }

    function toMidnight(d) {
        if (!(d instanceof Date)) d = new Date(d);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function parseIsoDate(s) {
        s = String(s || '').trim();
        if (!s) return null;
        var parts = s.split('-');
        if (parts.length !== 3) return null;
        var y = Number(parts[0]), m = Number(parts[1]), dd = Number(parts[2]);
        if (!isFinite(y) || !isFinite(m) || !isFinite(dd)) return null;
        return new Date(y, m - 1, dd);
    }

    function isCureActive(cure, today) {
        today = today || toMidnight(new Date());
        var s = parseIsoDate(cure.start);
        var e = parseIsoDate(cure.end);
        if (!s || !e) return false;
        s = toMidnight(s); e = toMidnight(e);
        return today >= s && today <= e;
    }

    function daysLeftToEnd(cure, today) {
        today = today || toMidnight(new Date());
        var e = parseIsoDate(cure.end);
        if (!e) return null;
        e = toMidnight(e);
        var diffMs = e.getTime() - today.getTime();
        // zahrnout dnešek: pokud končí dnes, dny=0
        return Math.max(0, Math.ceil(diffMs / 86400000));
    }

    function listActiveCures() {
        var today = toMidnight(new Date());
        return listCures()
            .filter(function (c) { return isCureActive(c, today); })
            .map(function (c) {
                return {
                    cure: c,
                    daysLeft: daysLeftToEnd(c, today)
                };
            })
            .sort(function (a, b) { return (a.daysLeft || 0) - (b.daysLeft || 0); });
    }

    function groupMedsByCategory() {
        var meds = listMeds();
        var map = {};
        meds.forEach(function (m) {
            var key = normalizeCategory(m.category) || 'Ostatní';
            if (!map[key]) map[key] = [];
            map[key].push(m);
        });
        return map;
    }

    // init
    load();

    global.OMNI_VitusLogic = {
        load: load,
        save: save,
        getState: getState,
        listMeds: listMeds,
        upsertMed: upsertMed,
        deleteMed: deleteMed,
        takeDose: takeDose,
        listCures: listCures,
        upsertCure: upsertCure,
        deleteCure: deleteCure,
        listActiveCures: listActiveCures,
        groupMedsByCategory: groupMedsByCategory
    };
})(typeof window !== 'undefined' ? window : this);

