/**
 * src/modules/vitus/vitus-logic.js
 * Vitus (Apatyka) – datový model + persistence (localStorage).
 *
 * Storage key: localStorage['omnishelf_vitus_data']
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'omnishelf_vitus_data';
    var VERSION = 2;

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
            forWhom: String(m.forWhom || '').trim(), // Pro koho (člen rodiny / mazlíček)
            absorbability: String(m.absorbability || '').trim(), // Bába Kořenářka: vstřebatelnost
            interactions: String(m.interactions || '').trim(), // Bába Kořenářka: varování interakcí
            coverImage: (typeof m.coverImage === 'string') ? m.coverImage : '',
            aiContext: (typeof m.aiContext === 'string') ? m.aiContext : ''
        };
    }

    function normalizeCure(c) {
        c = c || {};
        var start = String(c.start || '').trim();
        var end = String(c.end || '').trim();
        var schedule = (c.schedule && typeof c.schedule === 'object') ? c.schedule : {};
        return {
            id: String(c.id || uid('cure')),
            name: String(c.name || '').trim(),
            start: start,
            end: end,
            medIds: Array.isArray(c.medIds) ? c.medIds.map(function (x) { return String(x || ''); }).filter(Boolean) : [],
            schedule: schedule
        };
    }

    function makeEmpty() {
        return {
            version: VERSION,
            updatedAt: nowIsoDate(),
            meds: [],
            cures: [],
            doseLogs: {},
            doseMissed: [],
            archive: []
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
        var doseLogs = (parsed.doseLogs && typeof parsed.doseLogs === 'object') ? parsed.doseLogs : {};
        var doseMissed = Array.isArray(parsed.doseMissed) ? parsed.doseMissed : [];
        var archive = Array.isArray(parsed.archive) ? parsed.archive : [];
        state = {
            version: VERSION,
            updatedAt: nowIsoDate(),
            meds: meds,
            cures: cures,
            doseLogs: doseLogs,
            doseMissed: doseMissed,
            archive: archive
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

    var DEFAULT_TIMES = ['08:00', '20:00'];

    function getMedSchedule(cure, medId) {
        var s = cure.schedule && cure.schedule[medId];
        return Array.isArray(s) && s.length ? s : DEFAULT_TIMES;
    }

    function setCureSchedule(cureId, medId, times) {
        cureId = String(cureId || '');
        medId = String(medId || '');
        if (!medId) return { ok: false };
        times = Array.isArray(times) ? times.filter(function (t) { return String(t || '').trim(); }) : DEFAULT_TIMES;
        var st = getState();
        for (var i = 0; i < st.cures.length; i++) {
            if (st.cures[i].id !== cureId) continue;
            if (!st.cures[i].schedule) st.cures[i].schedule = {};
            st.cures[i].schedule[medId] = times;
            save();
            return { ok: true };
        }
        return { ok: false };
    }

    function doseLogKey(date, medId, time) {
        return String(date || '') + '::' + String(medId || '') + '::' + String(time || '');
    }

    function getDoseSlotsForDay(date) {
        date = String(date || nowIsoDate()).trim();
        var today = nowIsoDate();
        var st = getState();
        var slots = [];
        var active = listActiveCures();
        active.forEach(function (a) {
            var c = a.cure;
            var s = parseIsoDate(c.start);
            var e = parseIsoDate(c.end);
            if (!s || !e) return;
            var d = parseIsoDate(date);
            if (!d) return;
            s = toMidnight(s);
            e = toMidnight(e);
            d = toMidnight(d);
            if (d < s || d > e) return;
            (c.medIds || []).forEach(function (mid) {
                var m = null;
                for (var j = 0; j < st.meds.length; j++) {
                    if (st.meds[j].id === mid) { m = st.meds[j]; break; }
                }
                if (!m || (m.remainingQuantity !== undefined && m.remainingQuantity <= 0)) return;
                var times = getMedSchedule(c, mid);
                times.forEach(function (tm) {
                    var key = doseLogKey(date, mid, tm);
                    var taken = st.doseLogs[key] === true;
                    slots.push({
                        medId: mid,
                        medName: m.name,
                        cureId: c.id,
                        cureName: c.name,
                        date: date,
                        time: tm,
                        key: key,
                        taken: taken
                    });
                });
            });
        });
        slots.sort(function (x, y) {
            var t = (x.time || '').localeCompare(y.time || '');
            return t !== 0 ? t : (x.medName || '').localeCompare(y.medName || '');
        });
        return slots;
    }

    function markDoseTaken(medId, date, time) {
        medId = String(medId || '');
        date = String(date || nowIsoDate()).trim();
        time = String(time || '').trim();
        if (!medId || !date || !time) return { ok: false };
        var st = getState();
        st.doseLogs[doseLogKey(date, medId, time)] = true;
        takeDose(medId);
        save();
        return { ok: true };
    }

    function recordMissedDose(medId, medName, date, time) {
        medId = String(medId || '');
        medName = String(medName || '').trim();
        date = String(date || '').trim();
        time = String(time || '').trim();
        if (!medId || !date) return;
        var st = getState();
        st.doseMissed = st.doseMissed || [];
        var already = st.doseMissed.some(function (x) { return x.medId === medId && x.date === date && x.time === time; });
        if (already) return;
        st.doseMissed.push({
            medId: medId,
            medName: medName,
            date: date,
            time: time,
            recordedAt: nowIsoDate()
        });
        save();
    }

    function getMissedDoses() {
        return (getState().doseMissed || []).slice();
    }

    function clearMissedDoses() {
        getState().doseMissed = [];
        save();
    }

    function getMissedDosesReport() {
        var missed = getMissedDoses();
        if (!missed.length) return '';
        var lines = missed.map(function (x) {
            return '- ' + (x.medName || x.medId) + ': ' + x.date + ' ' + (x.time || '') + ' (vynecháno)';
        });
        return 'Zaznamenané vynechané dávky:\n' + lines.join('\n');
    }

    function archiveCure(cureId, reason, doseHistory, adherence) {
        cureId = String(cureId || '');
        var st = getState();
        var cure = null;
        for (var i = 0; i < st.cures.length; i++) {
            if (st.cures[i].id === cureId) { cure = st.cures[i]; break; }
        }
        if (!cure) return { ok: false };
        var meds = (cure.medIds || []).map(function (mid) {
            for (var j = 0; j < st.meds.length; j++) if (st.meds[j].id === mid) return st.meds[j];
            return null;
        }).filter(Boolean);
        var entry = {
            id: 'arch_' + cureId + '_' + Date.now(),
            archivedAt: nowIsoDate(),
            reason: String(reason || 'cycle_end'),
            cure: JSON.parse(JSON.stringify(cure)),
            meds: meds.map(function (m) { return JSON.parse(JSON.stringify(m)); }),
            doseHistory: Array.isArray(doseHistory) ? doseHistory : [],
            adherence: adherence || {}
        };
        st.archive = st.archive || [];
        st.archive.unshift(entry);
        st.cures = st.cures.filter(function (c) { return c.id !== cureId; });
        save();
        return { ok: true, entry: entry };
    }

    function listArchive() {
        return (getState().archive || []).slice();
    }

    function runAutoArchive() {
        var today = toMidnight(new Date());
        var st = getState();
        var toArchive = [];
        st.cures.forEach(function (c) {
            var e = parseIsoDate(c.end);
            if (!e) return;
            e = toMidnight(e);
            if (today > e) toArchive.push({ id: c.id, reason: 'cycle_end' });
        });
        st.meds.forEach(function (m) {
            if (Number(m.remainingQuantity || 0) <= 0) {
                st.cures.forEach(function (c) {
                    if ((c.medIds || []).indexOf(m.id) >= 0) {
                        if (!toArchive.some(function (a) { return a.id === c.id; })) {
                            toArchive.push({ id: c.id, reason: 'tablets_zero' });
                        }
                    }
                });
            }
        });
        var preload = toArchive.map(function (a) {
            var c = st.cures.find(function (x) { return x.id === a.id; });
            var history = [];
            var total = 0;
            var taken = 0;
            if (c) {
                var s = parseIsoDate(c.start);
                var e2 = parseIsoDate(c.end);
                if (s && e2) {
                    var d = new Date(s.getTime());
                    while (d <= e2) {
                        var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                        (c.medIds || []).forEach(function (mid) {
                            var times = getMedSchedule(c, mid);
                            times.forEach(function (tm) {
                                total++;
                                var key = doseLogKey(ds, mid, tm);
                                if (st.doseLogs && st.doseLogs[key] === true) { taken++; history.push({ date: ds, medId: mid, time: tm, taken: true }); }
                            });
                        });
                        d.setDate(d.getDate() + 1);
                    }
                }
            }
            return { id: a.id, reason: a.reason, history: history, adherence: { total: total, taken: taken } };
        });
        preload.forEach(function (p) { archiveCure(p.id, p.reason, p.history, p.adherence); });
        return preload.map(function (p) { return p.id; });
    }

    // init
    load();
    runAutoArchive();

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
        groupMedsByCategory: groupMedsByCategory,
        getMedSchedule: getMedSchedule,
        setCureSchedule: setCureSchedule,
        getDoseSlotsForDay: getDoseSlotsForDay,
        markDoseTaken: markDoseTaken,
        recordMissedDose: recordMissedDose,
        getMissedDoses: getMissedDoses,
        clearMissedDoses: clearMissedDoses,
        getMissedDosesReport: getMissedDosesReport,
        archiveCure: archiveCure,
        listArchive: listArchive,
        runAutoArchive: runAutoArchive
    };
})(typeof window !== 'undefined' ? window : this);

