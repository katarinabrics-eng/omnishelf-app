/**
 * src/modules/vitus/vitus-shell.js
 * Základní “shell” pro modul Vitus (Apatyka).
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    var refreshMedsView = null;
    var vitusDataListenerBound = false;
    var vitusSettingsCtaBound = false;

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getLogic() {
        return (typeof window !== 'undefined' && window.OMNI_VitusLogic) ? window.OMNI_VitusLogic : null;
    }

    function getEnrich() {
        return (typeof window !== 'undefined' && window.OMNI_VitusEnrich) ? window.OMNI_VitusEnrich : null;
    }

    function getMedById(id) {
        id = String(id || '');
        var logic = getLogic();
        if (!logic) return null;
        var meds = logic.listMeds();
        for (var i = 0; i < meds.length; i++) if (meds[i].id === id) return meds[i];
        return null;
    }

    var CATEGORIES = ['Srdce', 'Klouby', 'Krása', 'Spánek', 'Trávení', 'Imunita', 'Jiné'];
    var pendingAiContext = '';

    function fmtQty(m) {
        var r = (m && typeof m.remainingQuantity === 'number') ? m.remainingQuantity : Number(m && m.remainingQuantity);
        var t = (m && typeof m.totalQuantity === 'number') ? m.totalQuantity : Number(m && m.totalQuantity);
        if (!isFinite(r)) r = 0;
        if (!isFinite(t)) t = 0;
        return r + (t ? (' / ' + t) : '');
    }

    function daysTo(iso) {
        iso = String(iso || '').trim();
        if (!iso) return null;
        var parts = iso.split('-');
        if (parts.length !== 3) return null;
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        var a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return Math.ceil((b.getTime() - a.getTime()) / 86400000);
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            try {
                var r = new FileReader();
                r.onload = function () { resolve(String(r.result || '')); };
                r.onerror = function () { reject(new Error('file_read_failed')); };
                r.readAsDataURL(file);
            } catch (e) {
                reject(e);
            }
        });
    }

    function niceNameFromFilename(fileName) {
        var s = String(fileName || '').replace(/\.[^.]+$/, '');
        s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function applyScanResultToMedForm(result) {
        result = result || {};
        var set = function (id, val) {
            var el = $(id);
            if (!el) return;
            if (val === null || val === undefined) return;
            var v = String(val);
            if (!v.trim()) return;
            el.value = v;
        };
        var setSelectOrInput = function (id, val) {
            var el = $(id);
            if (!el) return;
            if (val === null || val === undefined) return;
            var v = String(val).trim();
            if (!v) return;
            if (el.tagName === 'SELECT') {
                var low = v.toLowerCase();
                for (var i = 0; i < el.options.length; i++) {
                    if ((el.options[i].value || '').toLowerCase() === low) {
                        el.value = el.options[i].value;
                        return;
                    }
                }
                el.value = v;
            } else {
                el.value = v;
            }
        };
        set('vitusMedName', result.name);
        setSelectOrInput('vitusMedType', result.type);
        if (typeof result.totalQuantity === 'number' && isFinite(result.totalQuantity)) set('vitusMedTotal', String(result.totalQuantity));
        if (typeof result.remainingQuantity === 'number' && isFinite(result.remainingQuantity)) set('vitusMedRemaining', String(result.remainingQuantity));
        if (typeof result.doseAmount === 'number' && isFinite(result.doseAmount)) set('vitusMedDoseAmount', String(result.doseAmount));
        set('vitusMedExpiration', result.expiration);
        set('vitusMedPurpose', result.purpose);
        set('vitusMedPrescription', result.prescription);
        set('vitusMedNotes', result.notes);
        set('vitusMedWarning', result.warning);
        set('vitusMedCategory', result.category);
        set('vitusMedForWhom', result.forWhom);
        set('vitusMedAiContext', result.aiContext);
        try { pendingAiContext = String(result.aiContext || ''); } catch (e0) { pendingAiContext = ''; }
        var typeEl = $('vitusMedType');
        if (typeEl) typeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function applyScanResultToCureForm(result) {
        result = result || {};
        var name = (result && result.name) ? String(result.name).trim() : '';
        if (!name) return;
        var el = $('vitusCureName');
        if (el) el.value = el.value ? el.value : ('Kúra – ' + name);
    }

    function renderMedsView(body) {
        var logic = getLogic();
        if (!logic) {
            body.innerHTML = '<p class="vitus-muted">Chybí logika Vitusu (vitus-logic.js nebyl načten).</p>';
            return;
        }

        var options = '<option value="">Ostatní</option>' + CATEGORIES.map(function (c) {
            return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
        }).join('');
        var recipientOpts = '<option value="">—</option>' + getRecipients().map(function (r) {
            return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>';
        }).join('');

        var SECTOR_KEY = 'omnishelf_vitus_sector';
        var defaultSector = 'add';
        try { defaultSector = String(localStorage.getItem(SECTOR_KEY) || 'add'); } catch (e0) { defaultSector = 'add'; }
        if (defaultSector !== 'add' && defaultSector !== 'scan' && defaultSector !== 'cures') defaultSector = 'add';

        body.innerHTML = ''
            + '<div class="vitus-sector-intro">'
            + '  <p class="vitus-sector-intro-text">Ruční zadání nebo analýza fotky receptu/krabičky – vyberte sekci a doplňte data.</p>'
            + '</div>'
            + '<div class="vitus-sector-tabs" role="tablist">'
            + '  <button type="button" class="vitus-sector-tab" data-sector="add" role="tab" aria-selected="' + (defaultSector === 'add' ? 'true' : 'false') + '"><span class="vitus-sector-icon">➕</span><span class="vitus-sector-label">Přidat lék</span></button>'
            + '  <button type="button" class="vitus-sector-tab" data-sector="scan" role="tab" aria-selected="' + (defaultSector === 'scan' ? 'true' : 'false') + '"><span class="vitus-sector-icon">📄</span><span class="vitus-sector-label">Skenovat</span></button>'
            + '  <button type="button" class="vitus-sector-tab" data-sector="cures" role="tab" aria-selected="' + (defaultSector === 'cures' ? 'true' : 'false') + '"><span class="vitus-sector-icon">📅</span><span class="vitus-sector-label">Kúry</span></button>'
            + '</div>'
            + '<div class="vitus-sector-panels">'
            + '  <div class="vitus-sector-panel' + (defaultSector === 'add' ? ' vitus-sector-panel--active' : '') + '" id="vitusPanelAdd" role="tabpanel">'
            + '    <section class="vitus-card">'
            + '        <div class="vitus-card-head">'
            + '          <div class="vitus-card-title">Moje Apatyka</div>'
            + '          <div class="vitus-card-sub">Tady můžete cokoliv ručně doplnit nebo opravit.</div>'
            + '        </div>'
            + '        <form class="vitus-form vitus-form--compact" id="vitusAddMedForm" autocomplete="off">'
            + '      <div class="vitus-form-row vitus-form-row--inline">'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedName">Název léku</label><input class="vitus-input" id="vitusMedName" required placeholder="např. Ibuprofen" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedType">Typ</label><select class="vitus-input vitus-select" id="vitusMedType"><option value="">—</option><option value="tablety">tablety</option><option value="sirup">sirup</option><option value="kapky">kapky</option><option value="roztok">roztok</option><option value="mast">mast</option><option value="spray">spray</option><option value="tobolky">tobolky</option><option value="čípky">čípky</option><option value="jiné">jiné</option></select></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedExpiration">Expirace</label><input class="vitus-input" id="vitusMedExpiration" type="date" /></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline" id="vitusMedQtyRow">'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedTotal" id="vitusMedTotalLabel">Počet v bal.</label><input class="vitus-input" id="vitusMedTotal" type="number" min="0" step="1" placeholder="30" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedRemaining">Zbývá</label><input class="vitus-input" id="vitusMedRemaining" type="number" min="0" step="0.1" placeholder="12" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedDoseAmount" id="vitusMedDoseLabel">Dávka (ks)</label><input class="vitus-input" id="vitusMedDoseAmount" type="number" min="0" step="0.1" value="1" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedCategory">Umístění</label><select class="vitus-input vitus-select" id="vitusMedCategory">' + options + '</select></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedForWhom">Pro koho</label><select class="vitus-input vitus-select" id="vitusMedForWhom">' + recipientOpts + '</select></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedPurpose">Účel</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedPurpose" rows="2" placeholder="např. bolest hlavy, spánek…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedPrescription">Recept / instrukce</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedPrescription" rows="2" placeholder="např. 1× denně po jídle…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedNotes">Poznámky</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedNotes" rows="2" placeholder="např. nekombinovat s…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedWarning">Varování</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedWarning" rows="2" placeholder="na co si dát pozor…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--stacked">'
            + '        <div class="vitus-field vitus-field--full"><label class="vitus-label" for="vitusMedAiContext">Složení / AI kontext</label><textarea class="vitus-input vitus-textarea-add vitus-textarea-add--ai" id="vitusMedAiContext" rows="3" placeholder="účinná látka, indikace…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-cover-block" id="vitusCoverBlock">'
            + '        <div class="vitus-cover-preview" id="vitusCoverPreview" style="display:none;"></div>'
            + '        <p class="vitus-cover-from-scan" id="vitusCoverFromScan" style="display:none;">Obrázek ze skenu – bude použit jako obal léku. Můžete nahradit tlačítkem níže.</p>'
            + '      </div>'
            + '      <div class="vitus-actions vitus-actions--wrap">'
            + '        <button type="submit" class="vitus-btn vitus-btn--primary">Přidat lék</button>'
            + '        <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusPickCoverBtn">Přidat / nahradit foto léku</button>'
            + '        <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusAddMedEnrich" title="Bába Kořenářka dohledá info o léku přes AI">Dohledat info</button>'
            + '        <span class="vitus-form-hint" id="vitusMedFormHint"></span>'
            + '      </div>'
            + '      <input type="file" id="vitusCoverInput" accept="image/*" style="display:none;" />'
            + '    </form>'
            + '    </section>'
            + '  </div>'
            + '  <div class="vitus-sector-panel' + (defaultSector === 'scan' ? ' vitus-sector-panel--active' : '') + '" id="vitusPanelScan" role="tabpanel">'
            + '    <section class="vitus-card">'
            + '        <div class="vitus-card-head">'
            + '          <div class="vitus-card-title">Skenovat detailně</div>'
            + '          <div class="vitus-card-sub">Recept, krabička, příbalový leták nebo ručně psaný dokument.</div>'
            + '        </div>'
            + '        <div class="vitus-scan-pad">'
            + '          <div class="vitus-scan-target">'
            + '            <span class="vitus-scan-target-label">Přepsat do:</span>'
            + '            <label class="vitus-pill"><input type="radio" name="vitusScanTarget" value="med" checked /> <span>Lék</span></label>'
            + '            <label class="vitus-pill"><input type="radio" name="vitusScanTarget" value="cure" /> <span>Kúra</span></label>'
            + '          </div>'
            + '          <div class="vitus-dropzone" id="vitusScanDropzone">'
            + '            <div class="vitus-dropzone-inner">'
            + '              <div class="vitus-dropzone-icon">📄</div>'
            + '              <div class="vitus-dropzone-title">Nahrajte dokument / fotku</div>'
            + '              <div class="vitus-dropzone-sub">Více fotek jedné věci (např. obal + info strana). Data se předvyplní vlevo a vy je jen doladíte.</div>'
            + '              <div class="vitus-dropzone-tip">Doporučeno: formát <strong>JPEG</strong> – u iPhonu Nastavení → Fotoaparát → Formáty → Nejvíce kompatibilní. HEIC analýzu výrazně zpomalí.</div>'
            + '              <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusScanPickBtn">Vybrat soubory</button>'
            + '            </div>'
            + '          </div>'
            + '          <input type="file" id="vitusScanInput" accept="image/*,application/pdf" multiple style="display:none;" />'
            + '          <div class="vitus-scan-preview" id="vitusScanPreview" style="display:none;"></div>'
            + '          <div class="vitus-actions vitus-actions--scan">'
            + '            <button type="button" class="vitus-btn vitus-btn--primary" id="vitusScanBtn" disabled>Skenovat detailně</button>'
            + '            <a href="#" class="vitus-scan-tips" id="vitusScanTips">Tipy a video návod</a>'
            + '            <span class="vitus-form-hint" id="vitusScanHint"></span>'
            + '          </div>'
            + '        </div>'
            + '    </section>'
            + '  </div>'
            + '  <div class="vitus-sector-panel' + (defaultSector === 'cures' ? ' vitus-sector-panel--active' : '') + '" id="vitusPanelCures" role="tabpanel">'
            + '    <section class="vitus-card vitus-card--wide">'
            + '  <div class="vitus-card-head">'
            + '    <div class="vitus-card-title">Léčebné kúry</div>'
            + '    <div class="vitus-card-sub">Aktivní kúry mají odpočet do konce a zobrazují se v Dávkování.</div>'
            + '  </div>'
            + '  <div class="vitus-cures-grid">'
            + '    <form class="vitus-form" id="vitusAddCureForm" autocomplete="off">'
            + '      <div class="vitus-form-row">'
            + '        <div class="vitus-field vitus-field--full">'
            + '          <label class="vitus-label" for="vitusCureName">Název kúry</label>'
            + '          <input class="vitus-input" id="vitusCureName" required placeholder="např. 14 dní – imunita" />'
            + '        </div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--cure-type">'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureType">Typ kúry</label>'
            + '          <select class="vitus-input vitus-select" id="vitusCureType">'
            + '            <option value="custom">Vlastní (ručně zadat)</option>'
            + '            <option value="weekly">Týdenní (7 dní)</option>'
            + '            <option value="monthly">Měsíční (30 dní)</option>'
            + '            <option value="longterm">Dlouhodobá (1 rok)</option>'
            + '          </select>'
            + '        </div>'
            + '        <div class="vitus-field vitus-field--custom-days" id="vitusCureCustomDaysWrap" style="display:none;">'
            + '          <label class="vitus-label" for="vitusCureDays">Počet dní</label>'
            + '          <input class="vitus-input" id="vitusCureDays" type="number" min="1" placeholder="14" />'
            + '        </div>'
            + '        <div class="vitus-field vitus-field--doses-per-day" id="vitusCureDosesPerDayWrap">'
            + '          <label class="vitus-label" for="vitusCureDosesPerDay" title="Pro výpočet konce z tablet">Dávky denně</label>'
            + '          <input class="vitus-input" id="vitusCureDosesPerDay" type="number" min="1" value="1" title="Kolikrát denně berete léky (pro auto-výpočet)" />'
            + '        </div>'
            + '      </div>'
            + '      <div class="vitus-form-row">'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureStart">Start</label>'
            + '          <input class="vitus-input" id="vitusCureStart" type="date" required />'
            + '        </div>'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureEnd">Konec</label>'
            + '          <input class="vitus-input" id="vitusCureEnd" type="date" required />'
            + '        </div>'
            + '        <div class="vitus-field vitus-field--calc">'
            + '          <label class="vitus-label">&nbsp;</label>'
            + '          <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusCureCalcEnd" title="Vypočítat konec z typu kúry nebo z tablet">Vypočítat konec</button>'
            + '        </div>'
            + '      </div>'
            + '      <div class="vitus-form-row">'
            + '        <div class="vitus-field vitus-field--full">'
            + '          <label class="vitus-label">Přiřazené léky (měsíčně/denně beru tyto)</label>'
            + '          <div class="vitus-checkboxes" id="vitusCureMeds"></div>'
            + '        </div>'
            + '      </div>'
            + '      <p class="vitus-disclaimer">Při nejasnostech se poraďte s lékařem. Vitus není náhrada lékaře – jen pomáhá nezapomenout.</p>'
            + '      <div class="vitus-actions">'
            + '        <button type="submit" class="vitus-btn vitus-btn--primary">Přidat kúru</button>'
            + '        <span class="vitus-form-hint" id="vitusCureFormHint"></span>'
            + '      </div>'
            + '    </form>'
            + '    <div>'
            + '      <div class="vitus-active-title">Aktivní kúry</div>'
            + '      <div class="vitus-active-cures" id="vitusActiveCures"></div>'
            + '    </div>'
            + '  </div>'
            + '    </section>'
            + '  </div>'
            + '</div>'
            + '<section class="vitus-card vitus-card--wide vitus-shelves-block">'
            + '  <div class="vitus-card-head">'
            + '    <div class="vitus-card-title">Moje lékárnička</div>'
            + '    <div class="vitus-card-sub">Všechny vaše léky na jednom místě. Skupiny podle kategorie. <em>Klikni na lék pro víc info.</em></div>'
            + '  </div>'
            + '  <div class="vitus-shelves" id="vitusShelves"></div>'
            + '</section>'
            + '<div class="vitus-modal-overlay" id="vitusMedModal" hidden>'
            + '  <div class="vitus-modal">'
            + '    <div class="vitus-modal-top">'
            + '      <div class="vitus-modal-title" id="vitusMedModalTitle">Detail léku</div>'
            + '      <button type="button" class="vitus-modal-close" id="vitusMedModalClose" aria-label="Zavřít">×</button>'
            + '    </div>'
            + '    <div class="vitus-modal-body" id="vitusMedModalBody"></div>'
            + '  </div>'
            + '</div>';

        function renderShelves() {
            var wrap = $('vitusShelves');
            if (!wrap) return;
            var grouped = logic.groupMedsByCategory();
            var keys = Object.keys(grouped).sort(function (a, b) {
                if (a === 'Ostatní') return 1;
                if (b === 'Ostatní') return -1;
                return a.localeCompare(b);
            });
            if (!keys.length) {
                wrap.innerHTML = '<div class="vitus-empty">Zatím tu nejsou žádné léky. Přidejte první do Apatyky.</div>';
                return;
            }
            wrap.innerHTML = keys.map(function (cat) {
                var meds = grouped[cat] || [];
                var forWhomShort = function (s) {
                    var t = String(s || '').trim().toLowerCase();
                    if (t.indexOf('já') >= 0 || t === 'ja') return 'JA';
                    if (t.indexOf('partner') >= 0) return 'P';
                    if (t.indexOf('děti') >= 0 || t.indexOf('deti') >= 0) return 'D';
                    if (t.indexOf('mazlíček') >= 0 || t.indexOf('mazlicek') >= 0) return 'M';
                    return (s && s.length) ? String(s).charAt(0).toUpperCase() : '';
                };
                var cards = meds.map(function (m) {
                    var expDays = daysTo(m.expiration);
                    var expBadge = '';
                    if (typeof expDays === 'number') {
                        if (expDays < 0) expBadge = '<span class="vitus-badge vitus-badge--danger">Expirované</span>';
                        else if (expDays <= 14) expBadge = '<span class="vitus-badge vitus-badge--warn">Exp. ' + expDays + ' dní</span>';
                    }
                    var forWhomLabel = forWhomShort(m.forWhom);
                    var cover = (m.coverImage && String(m.coverImage).indexOf('data:image') === 0)
                        ? ('<div class="vitus-med-cover"><img src="' + escapeHtml(m.coverImage) + '" alt="' + escapeHtml(m.name) + '" /></div>')
                        : '<div class="vitus-med-cover vitus-med-cover--empty"><span>🌿</span></div>';
                    return ''
                        + '<div class="vitus-med-card" data-med-id="' + escapeHtml(m.id) + '" title="Klikni pro víc info">'
                        + '  <div class="vitus-med-cover-wrap">'
                        + '    ' + cover
                        + (forWhomLabel ? ('<span class="vitus-med-forwhom" title="Kdo lék užívá">' + escapeHtml(forWhomLabel) + '</span>') : '')
                        + '    <span class="vitus-med-status" title="Zbývá / celkem">' + escapeHtml(fmtQty(m)) + '</span>'
                        + '  </div>'
                        + '  <div class="vitus-med-main">'
                        + '    <div class="vitus-med-top">'
                        + '      <div class="vitus-med-name">' + escapeHtml(m.name) + '</div>'
                        + '      <div class="vitus-med-badges">' + expBadge + '</div>'
                        + '    </div>'
                        + '    <div class="vitus-med-actions">'
                        + '      <button type="button" class="vitus-btn vitus-btn--dose" data-action="dose">Užít dávku</button>'
                        + '      <button type="button" class="vitus-btn vitus-btn--ghost" data-action="delete" title="Smazat">Smazat</button>'
                        + '    </div>'
                        + '  </div>'
                        + '</div>';
                }).join('');
                return ''
                    + '<div class="vitus-shelf">'
                    + '  <div class="vitus-shelf-title">' + escapeHtml(cat) + '</div>'
                    + '  <div class="vitus-shelf-scroll" role="region" aria-label="Léky – listování do stran">'
                    + '    <div class="vitus-shelf-grid">' + cards + '</div>'
                    + '  </div>'
                    + '</div>';
            }).join('');
        }

        /** Pro koho – členové rodiny / mazlíčci. Modularně: lze napojit na OMNI_LibraryLogic.getFamilyProfiles */
        function getRecipients() {
            if (typeof window.OMNI_LibraryLogic !== 'undefined' && typeof window.OMNI_LibraryLogic.getFamilyProfiles === 'function') {
                var fp = window.OMNI_LibraryLogic.getFamilyProfiles();
                if (fp && fp.length) return fp.map(function (p) { return p.name || p.id || '—'; });
            }
            return ['Já', 'Partner/ka', 'Děti', 'Mazlíček'];
        }

        function initTextareaAutoResize(ta) {
            if (!ta || ta.tagName !== 'TEXTAREA') return;
            function resize() {
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 300) + 'px';
            }
            ta.addEventListener('input', resize);
            ta.addEventListener('focus', resize);
            setTimeout(resize, 50);
        }

        function openMedModal(id) {
            var med = getMedById(id);
            var overlay = $('vitusMedModal');
            var bodyEl = $('vitusMedModalBody');
            if (!overlay || !bodyEl || !med) return;

            var enrich = getEnrich();
            var enrichEnabled = !!(enrich && typeof enrich.isEnabled === 'function' && enrich.isEnabled());
            var enrichDisabledAttr = enrichEnabled ? '' : ' disabled';
            var enrichTitle = enrichEnabled
                ? 'Bába Kořenářka dohledá info přes AI'
                : 'Chybí OpenAI nebo Gemini API klíč (Nastavení).';

            var coverHtml = (med.coverImage && String(med.coverImage).indexOf('data:image') === 0)
                ? ('<img class="vitus-modal-cover-img" src="' + escapeHtml(med.coverImage) + '" alt="' + escapeHtml(med.name) + '" />')
                : '<div class="vitus-modal-cover-empty">Bez fotky</div>';

            var recipients = getRecipients();
            var recipientsOptions = '<option value="">—</option>' + recipients.map(function (r) {
                return '<option value="' + escapeHtml(r) + '"' + (med.forWhom === r ? ' selected' : '') + '>' + escapeHtml(r) + '</option>';
            }).join('');

            bodyEl.innerHTML = ''
                + '<div class="vitus-modal-grid vitus-modal-grid--detail">'
                + '  <div class="vitus-modal-cover">'
                + '    ' + coverHtml
                + '    <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalPickCover">Nahrát / změnit fotku</button>'
                + '    <input type="file" id="vitusModalCoverInput" accept="image/*" style="display:none;" />'
                + '  </div>'
                + '  <form class="vitus-form vitus-form--modal vitus-form--detail" id="vitusEditMedForm">'
                + '    <input type="hidden" id="vitusEditMedId" value="' + escapeHtml(med.id) + '" />'
                + '    <div class="vitus-form-row vitus-form-row--name">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedName">Název</label>'
                + '        <textarea class="vitus-input vitus-textarea vitus-textarea--name" id="vitusEditMedName" rows="2" required>' + escapeHtml(med.name) + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field">'
                + '        <label class="vitus-label" for="vitusEditMedType">Forma</label>'
                + '        <input class="vitus-input vitus-input--large" id="vitusEditMedType" value="' + escapeHtml(med.type) + '" />'
                + '      </div>'
                + '      <div class="vitus-field">'
                + '        <label class="vitus-label" for="vitusEditMedForWhom">Pro koho</label>'
                + '        <select class="vitus-input vitus-select vitus-input--large" id="vitusEditMedForWhom">' + recipientsOptions + '</select>'
                + '      </div>'
                + '      <div class="vitus-field">'
                + '        <label class="vitus-label" for="vitusEditMedCat">Umístění</label>'
                + '        <select class="vitus-input vitus-select vitus-input--large" id="vitusEditMedCat">' + options + '</select>'
                + '      </div>'
                + '    </div>'
                + (function () {
                    var t = String(med.type || '').toLowerCase();
                    var isLiq = (t === 'sirup' || t === 'kapky' || t === 'roztok');
                    var totalLbl = isLiq ? 'Objem (ml)' : 'Počet v balení';
                    var remainLbl = isLiq ? 'Zbývá ml' : 'Zbývá tablet/bal.';
                    var doseLbl = isLiq ? 'Dávka (ml)' : 'Dávka (ks)';
                    var step = isLiq ? '0.1' : '1';
                    return '    <div class="vitus-detail-block vitus-detail-block--stock">'
                        + '      <h4 class="vitus-detail-block-title">Stav zásob & Expirace</h4>'
                        + '      <div class="vitus-form-row">'
                        + '        <div class="vitus-field">'
                        + '          <label class="vitus-label" for="vitusEditMedTotal">' + escapeHtml(totalLbl) + '</label>'
                        + '          <input class="vitus-input vitus-input--large" id="vitusEditMedTotal" type="number" min="0" step="' + step + '" value="' + escapeHtml(String(med.totalQuantity || 0)) + '" />'
                        + '        </div>'
                        + '        <div class="vitus-field">'
                        + '          <label class="vitus-label" for="vitusEditMedRemaining">' + escapeHtml(remainLbl) + '</label>'
                        + '          <input class="vitus-input vitus-input--large" id="vitusEditMedRemaining" type="number" min="0" step="' + step + '" value="' + escapeHtml(String(med.remainingQuantity || 0)) + '" />'
                        + '        </div>'
                        + '        <div class="vitus-field">'
                        + '          <label class="vitus-label" for="vitusEditMedExp">Datum expirace</label>'
                        + '          <input class="vitus-input vitus-input--large" id="vitusEditMedExp" type="date" value="' + escapeHtml(med.expiration) + '" />'
                        + '        </div>'
                        + '        <div class="vitus-field">'
                        + '          <label class="vitus-label" for="vitusEditMedDose">' + escapeHtml(doseLbl) + '</label>'
                        + '          <input class="vitus-input vitus-input--large" id="vitusEditMedDose" type="number" min="0" step="' + step + '" value="' + escapeHtml(String((med.dosage && med.dosage.amount) ? med.dosage.amount : 1)) + '" />'
                        + '        </div>'
                        + '      </div>'
                        + '    </div>';
                })()
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedPurpose">Účel</label>'
                + '        <textarea class="vitus-input vitus-textarea vitus-textarea--ai" id="vitusEditMedPurpose" rows="3" placeholder="např. bolest hlavy, spánek…">' + escapeHtml(med.purpose) + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedAiContext">Složení / AI profil léku</label>'
                + '        <textarea class="vitus-input vitus-textarea vitus-textarea--ai" id="vitusEditMedAiContext" rows="4" placeholder="účinná látka, indikace…">' + escapeHtml(med.aiContext || '') + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedPrescription">Recept / instrukce</label>'
                + '        <textarea class="vitus-input vitus-textarea" id="vitusEditMedPrescription" rows="2">' + escapeHtml(med.prescription) + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedNotes">Poznámky</label>'
                + '        <textarea class="vitus-input vitus-textarea" id="vitusEditMedNotes" rows="2">' + escapeHtml(med.notes) + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-form-row">'
                + '      <div class="vitus-field vitus-field--full">'
                + '        <label class="vitus-label" for="vitusEditMedWarning">Varování</label>'
                + '        <textarea class="vitus-input vitus-textarea" id="vitusEditMedWarning" rows="2">' + escapeHtml(med.warning || '') + '</textarea>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-detail-block vitus-detail-block--herbalist">'
                + '      <h4 class="vitus-detail-block-title">🌿 Bába Kořenářka</h4>'
                + '      <div class="vitus-form-row">'
                + '        <div class="vitus-field vitus-field--full">'
                + '          <label class="vitus-label" for="vitusEditMedAbsorbability">Vstřebatelnost</label>'
                + '          <textarea class="vitus-input vitus-textarea vitus-textarea--herbalist" id="vitusEditMedAbsorbability" rows="2" placeholder="Analýza vstřebatelnosti (AI)">' + escapeHtml(med.absorbability || '') + '</textarea>'
                + '        </div>'
                + '      </div>'
                + '      <div class="vitus-form-row">'
                + '        <div class="vitus-field vitus-field--full">'
                + '          <label class="vitus-label" for="vitusEditMedInteractions">Varování – interakce s jinými léky</label>'
                + '          <textarea class="vitus-input vitus-textarea vitus-textarea--herbalist" id="vitusEditMedInteractions" rows="2" placeholder="Nekombinovat s… (AI)">' + escapeHtml(med.interactions || '') + '</textarea>'
                + '        </div>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-detail-block vitus-detail-block--sos">'
                + '      <h4 class="vitus-detail-block-title">Rychlé akce</h4>'
                + '      <div class="vitus-sos-buttons">'
                + '        <button type="button" class="vitus-btn vitus-btn--sos" id="vitusBtnSos" disabled title="Připravujeme">SOS První pomoc</button>'
                + '        <button type="button" class="vitus-btn vitus-btn--sos" id="vitusBtnRecept" disabled title="Připravujeme">Žádost o recept</button>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-actions">'
                + '      <button type="submit" class="vitus-btn vitus-btn--primary">Uložit</button>'
                + '      <button type="button" class="vitus-btn vitus-btn--dose" id="vitusModalTakeDose">Užít dávku</button>'
                + '      <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalAddToCure" title="Přidá lék do nové kúry a otevře formulář">Přidat do kúry</button>'
                + '      <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalEnrich" title="' + escapeHtml(enrichTitle) + '"' + enrichDisabledAttr + '>Dohledat info o léku</button>'
                + '      <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalDelete">Smazat</button>'
                + '      <span class="vitus-form-hint" id="vitusModalHint"></span>'
                + '    </div>'
                + '    <div class="vitus-ai-disclaimer">Informace jsou generovány AI a mají informativní charakter. Při nejasnostech se poraďte s lékařem – Vitus není náhrada lékaře, jen pomáhá nezapomenout.</div>'
                + '  </form>'
                + '</div>';

            bodyEl.querySelectorAll('.vitus-textarea').forEach(initTextareaAutoResize);

            // set selected category
            try {
                var sel = $('vitusEditMedCat');
                if (sel) sel.value = med.category || '';
            } catch (e0) {}

            overlay.hidden = false;
        }

        function closeMedModal() {
            var overlay = $('vitusMedModal');
            if (overlay) overlay.hidden = true;
        }

        var pendingAddToCure = null;

        function renderCureMeds(preSelectIds) {
            var box = $('vitusCureMeds');
            if (!box) return;
            var meds = logic.listMeds();
            if (!meds.length) {
                box.innerHTML = '<div class="vitus-muted">Nejdřív přidejte léky do Apatyky.</div>';
                return;
            }
            preSelectIds = preSelectIds || (pendingAddToCure ? [pendingAddToCure.medId] : []);
            box.innerHTML = meds.map(function (m) {
                var checked = preSelectIds.indexOf(m.id) >= 0 ? ' checked' : '';
                return ''
                    + '<label class="vitus-checkbox">'
                    + '  <input type="checkbox" value="' + escapeHtml(m.id) + '"' + checked + ' />'
                    + '  <span>' + escapeHtml(m.name) + '</span>'
                    + '</label>';
            }).join('');
            pendingAddToCure = null;
        }

        function switchSector(id) {
            var panels = document.querySelectorAll('.vitus-sector-panel');
            var tabs = document.querySelectorAll('.vitus-sector-tab');
            panels.forEach(function (p) { p.classList.remove('vitus-sector-panel--active'); });
            tabs.forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('data-sector') === id ? 'true' : 'false'); });
            var panel = $('vitusPanel' + id.charAt(0).toUpperCase() + id.slice(1));
            var tab = document.querySelector('.vitus-sector-tab[data-sector="' + id + '"]');
            if (panel) panel.classList.add('vitus-sector-panel--active');
            if (tab) tab.classList.add('vitus-sector-tab--active');
            tabs.forEach(function (t) { if (t.getAttribute('data-sector') !== id) t.classList.remove('vitus-sector-tab--active'); });
            try { localStorage.setItem(SECTOR_KEY, id); } catch (e0) {}
        }

        function openCureFormWithMed(med) {
            if (!med) return;
            closeMedModal();
            switchSector('cures');
            var nameEl = $('vitusCureName');
            if (nameEl) nameEl.value = 'Kúra – ' + (med.name || '');
            var startEl = $('vitusCureStart');
            if (startEl) {
                var t = new Date();
                startEl.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
            }
            pendingAddToCure = { medId: med.id, medName: med.name };
            renderCureMeds([med.id]);
            var form = $('vitusAddCureForm');
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function renderActiveCures() {
            var wrap = $('vitusActiveCures');
            if (!wrap) return;
            var active = logic.listActiveCures();
            if (!active.length) {
                wrap.innerHTML = '<div class="vitus-empty">Žádná aktivní kúra. Přidejte si jednu (léky → Přidat do kúry).</div>';
                return;
            }
            var typeLabels = { longterm: 'Dlouhodobá', monthly: 'Měsíční', weekly: 'Týdenní', custom: 'Vlastní' };
            wrap.innerHTML = active.map(function (x) {
                var c = x.cure;
                var medsById = {};
                logic.listMeds().forEach(function (m) { medsById[m.id] = m; });
                var medNames = (c.medIds || []).map(function (id) { return medsById[id] ? medsById[id].name : ''; }).filter(Boolean);
                var typeLabel = typeLabels[c.cureType] || typeLabels.custom;
                return ''
                    + '<div class="vitus-cure-card" data-cure-id="' + escapeHtml(c.id) + '">'
                    + '  <div class="vitus-cure-top">'
                    + '    <div class="vitus-cure-name">' + escapeHtml(c.name) + ' <span class="vitus-cure-type-badge">' + escapeHtml(typeLabel) + '</span></div>'
                    + '    <div class="vitus-cure-days">' + escapeHtml(String(x.daysLeft)) + ' dní</div>'
                    + '  </div>'
                    + '  <div class="vitus-cure-meta">'
                    + '    <span>' + escapeHtml(c.start) + ' → ' + escapeHtml(c.end) + '</span>'
                    + (medNames.length ? ('<span>• ' + escapeHtml(medNames.join(', ')) + '</span>') : '')
                    + '  </div>'
                    + '  <div class="vitus-med-actions">'
                    + '    <button type="button" class="vitus-btn vitus-btn--ghost" data-action="delete-cure">Smazat kúru</button>'
                    + '  </div>'
                    + '</div>';
            }).join('');
        }

        function wire() {
            // Sector tabs
            document.querySelectorAll('.vitus-sector-tab').forEach(function (btn) {
                var sector = btn.getAttribute('data-sector');
                if (!sector) return;
                var isDefault = sector === defaultSector;
                if (isDefault) btn.classList.add('vitus-sector-tab--active');
                btn.addEventListener('click', function () { switchSector(sector); });
            });
            document.querySelectorAll('.vitus-textarea-add').forEach(initTextareaAutoResize);

            // Cover picking (no AI)
            var pendingCover = '';
            var coverBtn = $('vitusPickCoverBtn');
            var coverInput = $('vitusCoverInput');
            var coverPrev = $('vitusCoverPreview');
            function setCoverPreview(dataUrl, fromScan) {
                pendingCover = dataUrl || '';
                var fromScanEl = document.getElementById('vitusCoverFromScan');
                if (!coverPrev) return;
                if (!pendingCover) {
                    coverPrev.style.display = 'none';
                    coverPrev.innerHTML = '';
                    if (fromScanEl) fromScanEl.style.display = 'none';
                    return;
                }
                coverPrev.style.display = '';
                coverPrev.innerHTML = '<img src="' + escapeHtml(pendingCover) + '" alt="Foto léku" />';
                if (fromScanEl) fromScanEl.style.display = fromScan ? '' : 'none';
            }
            if (coverBtn && coverInput) {
                coverBtn.addEventListener('click', function () { coverInput.click(); });
                coverInput.addEventListener('change', function () {
                    var f = coverInput.files && coverInput.files[0];
                    if (!f) return;
                    readFileAsDataUrl(f).then(function (dataUrl) {
                        setCoverPreview(dataUrl);
                    }).catch(function () {});
                });
            }

            // Scan panel
            var scanFiles = [];
            var scanDrop = $('vitusScanDropzone');
            var scanPick = $('vitusScanPickBtn');
            var scanInput = $('vitusScanInput');
            var scanPrev = $('vitusScanPreview');
            var scanBtn = $('vitusScanBtn');
            var scanHint = $('vitusScanHint');
            function hasKey() {
                try { return !!(window.OMNI_Keys && typeof window.OMNI_Keys.hasOpenAiKey === 'function' && window.OMNI_Keys.hasOpenAiKey()); } catch (e0) { return false; }
            }
            function renderScanPreview() {
                if (!scanPrev) return;
                if (!scanFiles || !scanFiles.length) { scanPrev.style.display = 'none'; scanPrev.innerHTML = ''; return; }
                scanPrev.style.display = '';
                var names = scanFiles.map(function (f) { return escapeHtml((f && f.name) ? f.name : 'soubor'); });
                scanPrev.innerHTML = ''
                    + '<div class="vitus-scan-file"><strong>Vybráno:</strong> ' + escapeHtml(String(scanFiles.length)) + ' soubor(ů)</div>'
                    + '<div class="vitus-scan-file-list">' + names.map(function (n) { return '<span class="vitus-scan-file-pill">' + n + '</span>'; }).join('') + '</div>';
            }
            function setScanFiles(list) {
                scanFiles = Array.isArray(list) ? list.filter(Boolean) : [];
                if (scanHint) { scanHint.textContent = ''; scanHint.innerHTML = ''; }
                if (scanBtn) scanBtn.disabled = !scanFiles.length;
                renderScanPreview();
            }
            function getScanTarget() {
                var v = 'med';
                try {
                    document.querySelectorAll('input[name="vitusScanTarget"]').forEach(function (r) {
                        if (r.checked) v = r.value;
                    });
                } catch (e0) {}
                return v;
            }
            function scanFallback(files) {
                return new Promise(function (resolve) {
                    var first = (files && files[0]) ? files[0] : null;
                    var base = niceNameFromFilename(first && first.name);
                    var res = {
                        name: base || '',
                        type: '',
                        purpose: '',
                        prescription: '',
                        notes: 'Předvyplněno ze skenu (zatím bez napojení na AI) – prosím zkontrolujte a opravte.',
                        category: ''
                    };
                    if (files && files.length > 1) {
                        res.notes = 'Předvyplněno ze skenu (' + files.length + ' fotek, zatím bez AI) – prosím zkontrolujte a opravte.';
                    }
                    if (first && first.type && String(first.type).indexOf('image/') === 0) {
                        readFileAsDataUrl(first).then(function (dataUrl) {
                            res.coverImage = dataUrl;
                            resolve(res);
                        }).catch(function () { resolve(res); });
                        return;
                    }
                    resolve(res);
                });
            }
            async function runScan() {
                if (!scanFiles || !scanFiles.length) return;
                var keyOk = hasKey();
                if (!keyOk) {
                    if (scanHint) {
                        scanHint.innerHTML =
                            'Chybí OpenAI API klíč. Používám jen jednoduché předvyplnění. ' +
                            '<button type="button" class="vitus-inline-link" id="vitusOpenSettingsFromScan">Otevřít Nastavení</button>';
                    }
                } else {
                    var n = scanFiles.length;
                    var hasHeic = scanFiles.some(function (f) { return (f && f.name && f.name.toLowerCase().endsWith('.heic')) || (f && f.type === 'image/heic'); });
                    var waitMsg = 'Analyzuji…';
                    if (n > 1 || hasHeic) {
                        waitMsg += ' (';
                        if (n > 1) waitMsg += n + ' fotek';
                        if (hasHeic) waitMsg += (n > 1 ? ', ' : '') + 'HEIC';
                        waitMsg += ' – převod a AI může trvat 30–90 s, neuklážejte stránku)';
                    }
                    if (scanHint) { scanHint.innerHTML = ''; scanHint.textContent = waitMsg; }
                }
                if (scanBtn) scanBtn.disabled = true;
                var target = getScanTarget();
                var result = null;
                var usedFallback = false;
                try {
                    if (window.OMNI_VitusAi && typeof window.OMNI_VitusAi.scan === 'function') {
                        result = await window.OMNI_VitusAi.scan(scanFiles);
                    } else {
                        result = await scanFallback(scanFiles);
                        usedFallback = true;
                    }
                } catch (e0) {
                    result = await scanFallback(scanFiles);
                    usedFallback = true;
                    try {
                        var msg = String((e0 && e0.message) ? e0.message : e0);
                        if (msg.indexOf('missing_openai_key') >= 0) {
                            if (scanHint) {
                                scanHint.innerHTML =
                                    'Chybí OpenAI API klíč. Používám jen jednoduché předvyplnění. ' +
                                    '<button type="button" class="vitus-inline-link" id="vitusOpenSettingsFromScan">Otevřít Nastavení</button>';
                            }
                        } else if (msg.indexOf('timeout_analýza_trvala_příliš_dlouho') >= 0 || msg.indexOf('AbortError') >= 0) {
                            if (scanHint) {
                                scanHint.textContent = 'Analýza trvala příliš dlouho (timeout 2 min). Zkuste méně fotek nebo formát JPEG místo HEIC.';
                            }
                        }
                    } catch (e1) {}
                }

                if (target === 'cure') {
                    applyScanResultToCureForm(result);
                    switchSector('cures');
                } else {
                    applyScanResultToMedForm(result);
                    switchSector('add');
                }

                // pokud AI (nebo fallback) poslal coverImage, nabídni ho jako obal léku
                if (result && result.coverImage) setCoverPreview(String(result.coverImage), true);

                if (scanHint && !scanHint.textContent && !scanHint.innerHTML) {
                    scanHint.textContent = usedFallback
                        ? 'Hotovo (bez AI). Doplňte/zkontrolujte vlevo a uložte.'
                        : 'Hotovo. Doplňte/zkontrolujte vlevo a uložte.';
                }
                if (scanBtn) scanBtn.disabled = !scanFiles.length;
            }

            if (scanPick && scanInput) scanPick.addEventListener('click', function () {
                // umožní vybrat stejné soubory znovu (a zároveň smaže staré hlášky)
                try { scanInput.value = ''; } catch (e0) {}
                if (scanHint) { scanHint.textContent = ''; scanHint.innerHTML = ''; }
                scanInput.click();
            });
            if (scanInput) scanInput.addEventListener('change', function () {
                var list = scanInput.files ? Array.prototype.slice.call(scanInput.files) : [];
                if (list.length) setScanFiles(list);
            });
            if (scanDrop) {
                scanDrop.addEventListener('dragover', function (e) { e.preventDefault(); scanDrop.classList.add('is-dragover'); });
                scanDrop.addEventListener('dragleave', function () { scanDrop.classList.remove('is-dragover'); });
                scanDrop.addEventListener('drop', function (e) {
                    e.preventDefault();
                    scanDrop.classList.remove('is-dragover');
                    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
                    if (files.length) setScanFiles(files);
                });
            }
            if (scanBtn) scanBtn.addEventListener('click', function () { runScan(); });
            var tips = $('vitusScanTips');
            if (tips) tips.addEventListener('click', function (e) {
                e.preventDefault();
                if (scanHint) {
                    scanHint.textContent = 'Tip: Foťte čitelně, bez odlesků. Pokud fotíte na iPhone, zvažte „Most Compatible“ (JPEG) kvůli lepší podpoře.';
                }
            });

            // CTA: otevřít nastavení z hlášky ve skenu
            if (!vitusSettingsCtaBound) {
                vitusSettingsCtaBound = true;
                document.addEventListener('click', function (e) {
                    var t = e && e.target;
                    if (!t) return;
                    if (t.id !== 'vitusOpenSettingsFromScan') return;
                    e.preventDefault();
                    try {
                        var btn = document.getElementById('btnOpenSettings');
                        if (btn) btn.click();
                    } catch (e0) {}
                });
            }

            var hint = $('vitusMedFormHint');
            var form = $('vitusAddMedForm');
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    if (hint) hint.textContent = '';
                    var name = $('vitusMedName') && $('vitusMedName').value;
                    var type = $('vitusMedType') && $('vitusMedType').value;
                    var total = $('vitusMedTotal') && $('vitusMedTotal').value;
                    var rem = $('vitusMedRemaining') && $('vitusMedRemaining').value;
                    var doseAmount = $('vitusMedDoseAmount') && $('vitusMedDoseAmount').value;
                    var exp = $('vitusMedExpiration') && $('vitusMedExpiration').value;
                    var purpose = $('vitusMedPurpose') && $('vitusMedPurpose').value;
                    var prescription = $('vitusMedPrescription') && $('vitusMedPrescription').value;
                    var notes = $('vitusMedNotes') && $('vitusMedNotes').value;
                    var warning = $('vitusMedWarning') && $('vitusMedWarning').value;
                    var category = $('vitusMedCategory') && $('vitusMedCategory').value;
                    var forWhom = $('vitusMedForWhom') && $('vitusMedForWhom').value;
                    var aiContext = $('vitusMedAiContext') && $('vitusMedAiContext').value;

                    var totalN = Number(total);
                    var remN = (String(rem || '').trim() === '') ? totalN : Number(rem);
                    if (!isFinite(totalN) || totalN < 0) totalN = 0;
                    if (!isFinite(remN) || remN < 0) remN = 0;
                    if (totalN > 0 && remN > totalN) remN = totalN;
                    var doseUnit = (type === 'sirup' || type === 'kapky' || type === 'roztok') ? 'ml' : 'ks';

                    var res = logic.upsertMed({
                        name: name,
                        type: type,
                        totalQuantity: totalN,
                        remainingQuantity: remN,
                        dosage: { amount: Number(doseAmount || 1), text: '', unit: doseUnit },
                        expiration: exp,
                        purpose: purpose,
                        prescription: prescription,
                        notes: notes,
                        warning: warning,
                        category: category,
                        forWhom: forWhom || '',
                        coverImage: pendingCover || '',
                        aiContext: String(aiContext || pendingAiContext || '')
                    });
                    if (!res.ok) {
                        if (hint) hint.textContent = res.message || 'Nelze uložit.';
                        return;
                    }
                    try { form.reset(); } catch (e0) {}
                    // po resetu nastav dávku zpět na 1
                    var doseEl = $('vitusMedDoseAmount'); if (doseEl) doseEl.value = '1';
                    // vyčisti pending obal
                    try { if (coverInput) coverInput.value = ''; } catch (e1) {}
                    setCoverPreview('');
                    pendingAiContext = '';
                    // vyčisti i sken panel (aby se po uložení nepoužíval omylem starý výběr)
                    try { if (scanInput) scanInput.value = ''; } catch (e2) {}
                    setScanFiles([]);
                    if (hint) hint.textContent = 'Uloženo.';
                    renderShelves();
                    renderCureMeds();
                    renderActiveCures();
                });
                var typeSelect = $('vitusMedType');
                var totalLabel = $('vitusMedTotalLabel');
                var doseLabel = $('vitusMedDoseLabel');
                var totalInput = $('vitusMedTotal');
                function updateMedFormLabels() {
                    var t = (typeSelect && typeSelect.value) ? String(typeSelect.value).toLowerCase() : '';
                    var isLiquid = (t === 'sirup' || t === 'kapky' || t === 'roztok');
                    if (totalLabel) totalLabel.textContent = isLiquid ? 'Objem (ml)' : 'Počet v bal.';
                    if (doseLabel) doseLabel.textContent = isLiquid ? 'Dávka (ml)' : 'Dávka (ks)';
                    if (totalInput) totalInput.placeholder = isLiquid ? '100' : '30';
                }
                if (typeSelect) typeSelect.addEventListener('change', updateMedFormLabels);
                updateMedFormLabels();
            }

            var shelvesWrap = $('vitusShelves');
            if (shelvesWrap) {
                shelvesWrap.addEventListener('click', function (e) {
                    var btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
                    if (!btn) return;
                    var card = btn.closest('.vitus-med-card');
                    if (!card) return;
                    var id = card.getAttribute('data-med-id') || '';
                    var action = btn.getAttribute('data-action');
                    if (action === 'dose') {
                        logic.takeDose(id);
                        renderShelves();
                        return;
                    }
                    if (action === 'delete') {
                        logic.deleteMed(id);
                        renderShelves();
                        renderCureMeds();
                        renderActiveCures();
                        return;
                    }
                });

                // klik na kartu (mimo tlačítka) otevře detail
                shelvesWrap.addEventListener('click', function (e) {
                    var btn2 = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
                    if (btn2) return;
                    var card2 = e.target && e.target.closest ? e.target.closest('.vitus-med-card') : null;
                    if (!card2) return;
                    var id2 = card2.getAttribute('data-med-id') || '';
                    if (!id2) return;
                    openMedModal(id2);
                });
            }

            var cureForm = $('vitusAddCureForm');
            var cureHint = $('vitusCureFormHint');
            var cureTypeEl = $('vitusCureType');
            var customDaysWrap = $('vitusCureCustomDaysWrap');
            if (cureTypeEl && customDaysWrap) {
                function toggleCustomDays() {
                    customDaysWrap.style.display = (cureTypeEl.value === 'custom') ? '' : 'none';
                }
                cureTypeEl.addEventListener('change', toggleCustomDays);
                toggleCustomDays();
            }
            var startEl = $('vitusCureStart');
            if (startEl && !startEl.value) {
                var today = new Date();
                startEl.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            }
            var calcBtn = $('vitusCureCalcEnd');
            if (calcBtn) {
                calcBtn.addEventListener('click', function () {
                    var start = ($('vitusCureStart') || {}).value;
                    var type = ($('vitusCureType') || {}).value || 'custom';
                    var daysInput = $('vitusCureDays');
                    var cureDays = daysInput ? parseInt(daysInput.value, 10) : 0;
                    var dosesPerDay = parseInt(($('vitusCureDosesPerDay') || {}).value || '1', 10) || 1;
                    var medsBox = $('vitusCureMeds');
                    var selected = [];
                    if (medsBox) {
                        medsBox.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) { selected.push(cb.value); });
                    }
                    var end = '';
                    if (selected.length && start) {
                        end = logic.calculateEndFromPills && logic.calculateEndFromPills(selected, start, dosesPerDay);
                    }
                    if (!end && start) {
                        end = logic.calculateEndFromType && logic.calculateEndFromType(start, type, cureDays);
                    }
                    var endEl = $('vitusCureEnd');
                    if (endEl && end) endEl.value = end;
                });
            }
            if (cureForm) {
                cureForm.addEventListener('submit', function (e) {
                    e.preventDefault();
                    if (cureHint) cureHint.textContent = '';
                    var name = $('vitusCureName') && $('vitusCureName').value;
                    var start = $('vitusCureStart') && $('vitusCureStart').value;
                    var end = $('vitusCureEnd') && $('vitusCureEnd').value;
                    var type = ($('vitusCureType') || {}).value || 'custom';
                    var cureDays = parseInt(($('vitusCureDays') || {}).value || '0', 10) || null;
                    var medsBox = $('vitusCureMeds');
                    var selected = [];
                    if (medsBox) {
                        medsBox.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) { selected.push(cb.value); });
                    }
                    var res = logic.upsertCure({ name: name, start: start, end: end, cureType: type, cureDays: cureDays, medIds: selected });
                    if (!res.ok) {
                        if (cureHint) cureHint.textContent = res.message || 'Nelze uložit.';
                        return;
                    }
                    try { cureForm.reset(); } catch (e0) {}
                    if (startEl && !startEl.value) {
                        var t = new Date();
                        startEl.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
                    }
                    if (cureHint) cureHint.textContent = 'Uloženo. Kúra se zobrazí v Dávkování.';
                    renderActiveCures();
                });
            }

            var activeWrap = $('vitusActiveCures');
            if (activeWrap) {
                activeWrap.addEventListener('click', function (e) {
                    var btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
                    if (!btn) return;
                    var card = btn.closest('.vitus-cure-card');
                    if (!card) return;
                    var id = card.getAttribute('data-cure-id') || '';
                    var action = btn.getAttribute('data-action');
                    if (action === 'delete-cure') {
                        logic.deleteCure(id);
                        renderActiveCures();
                    }
                });
            }

            // modal wiring
            var modalClose = $('vitusMedModalClose');
            var modalOverlay = $('vitusMedModal');
            if (modalClose) modalClose.addEventListener('click', closeMedModal);
            if (modalOverlay) modalOverlay.addEventListener('click', function (e) {
                if (e.target === modalOverlay) closeMedModal();
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeMedModal();
            });

            // delegate modal actions after open (since body is replaced each open)
            document.addEventListener('click', function (e) {
                var pick = e.target && e.target.id === 'vitusModalPickCover' ? e.target : null;
                if (pick) {
                    var inp = $('vitusModalCoverInput');
                    if (inp) inp.click();
                }
            });
            document.addEventListener('change', function (e) {
                if (!(e && e.target && e.target.id === 'vitusModalCoverInput')) return;
                var input = e.target;
                var f = input.files && input.files[0];
                if (!f) return;
                readFileAsDataUrl(f).then(function (dataUrl) {
                    var id = $('vitusEditMedId') && $('vitusEditMedId').value;
                    var med = getMedById(id);
                    if (!med) return;
                    med.coverImage = dataUrl;
                    logic.upsertMed(med);
                    openMedModal(id);
                    renderShelves();
                }).catch(function () {});
            });
            document.addEventListener('submit', function (e) {
                if (!(e && e.target && e.target.id === 'vitusEditMedForm')) return;
                e.preventDefault();
                var id = $('vitusEditMedId') && $('vitusEditMedId').value;
                var med = getMedById(id);
                if (!med) return;
                var hintEl = $('vitusModalHint');
                if (hintEl) hintEl.textContent = '';
                med.name = $('vitusEditMedName') ? $('vitusEditMedName').value : med.name;
                med.type = $('vitusEditMedType') ? $('vitusEditMedType').value : med.type;
                med.totalQuantity = Number($('vitusEditMedTotal') ? $('vitusEditMedTotal').value : med.totalQuantity);
                med.remainingQuantity = Number($('vitusEditMedRemaining') ? $('vitusEditMedRemaining').value : med.remainingQuantity);
                med.dosage = med.dosage || {};
                med.dosage.amount = Number($('vitusEditMedDose') ? $('vitusEditMedDose').value : (med.dosage.amount || 1));
                med.expiration = $('vitusEditMedExp') ? $('vitusEditMedExp').value : med.expiration;
                med.category = $('vitusEditMedCat') ? $('vitusEditMedCat').value : med.category;
                med.forWhom = $('vitusEditMedForWhom') ? $('vitusEditMedForWhom').value : (med.forWhom || '');
                med.purpose = $('vitusEditMedPurpose') ? $('vitusEditMedPurpose').value : med.purpose;
                med.prescription = $('vitusEditMedPrescription') ? $('vitusEditMedPrescription').value : med.prescription;
                med.notes = $('vitusEditMedNotes') ? $('vitusEditMedNotes').value : med.notes;
                med.warning = $('vitusEditMedWarning') ? $('vitusEditMedWarning').value : (med.warning || '');
                med.aiContext = $('vitusEditMedAiContext') ? $('vitusEditMedAiContext').value : (med.aiContext || '');
                med.absorbability = $('vitusEditMedAbsorbability') ? $('vitusEditMedAbsorbability').value : (med.absorbability || '');
                med.interactions = $('vitusEditMedInteractions') ? $('vitusEditMedInteractions').value : (med.interactions || '');
                var res = logic.upsertMed(med);
                if (hintEl) hintEl.textContent = res && res.ok ? 'Uloženo.' : 'Nelze uložit.';
                renderShelves();
                renderCureMeds();
                renderActiveCures();
            });
            document.addEventListener('click', function (e) {
                if (!(e && e.target)) return;
                if (e.target.id === 'vitusModalTakeDose') {
                    var id = $('vitusEditMedId') && $('vitusEditMedId').value;
                    if (!id) return;
                    logic.takeDose(id);
                    openMedModal(id);
                    renderShelves();
                }
                if (e.target.id === 'vitusModalAddToCure') {
                    var idA = $('vitusEditMedId') && $('vitusEditMedId').value;
                    if (!idA) return;
                    var medA = getMedById(idA);
                    if (medA) openCureFormWithMed(medA);
                }
                if (e.target.id === 'vitusModalEnrich') {
                    var idE = $('vitusEditMedId') && $('vitusEditMedId').value;
                    if (!idE) return;
                    var hintE = $('vitusModalHint');
                    var btnE = e.target;
                    var enrichApi = getEnrich();
                    var enabled = !!(enrichApi && typeof enrichApi.isEnabled === 'function' && enrichApi.isEnabled());
                    if (!enabled) {
                        if (hintE) hintE.textContent = 'Chybí AI klíč. Nastavte v Nastavení OpenAI API klíč nebo Gemini API klíč.';
                        return;
                    }
                    var medE = getMedById(idE);
                    if (!medE || !enrichApi || typeof enrichApi.enrichMed !== 'function') return;
                    if (hintE) hintE.textContent = '';
                    var originalText = '';
                    try { originalText = btnE.textContent; } catch (eT) { originalText = 'Dohledat info o léku'; }
                    try {
                        btnE.disabled = true;
                        btnE.classList.add('is-loading');
                        btnE.textContent = 'Bába listuje v herbářích...';
                    } catch (eUI) {}
                    Promise.resolve()
                        .then(function () { return enrichApi.enrichMed(medE); })
                        .then(function (res) {
                            if (!res || res.ok !== true) throw new Error('enrich_failed');
                            var patch = res.med || {};
                            // do léku nepřepisujeme coverImage (jen textová data)
                            ['aiContext', 'purpose', 'prescription', 'notes', 'warning', 'category', 'type', 'absorbability', 'interactions'].forEach(function (k) {
                                if (typeof patch[k] === 'string' && patch[k].trim()) medE[k] = patch[k];
                            });
                            logic.upsertMed(medE);
                            openMedModal(idE);
                            renderShelves();
                        })
                        .catch(function (err) {
                            var msg = String((err && err.message) ? err.message : err);
                            if (msg.indexOf('missing_ai_key') >= 0 || msg.indexOf('missing_openai_key') >= 0 || msg.indexOf('missing_gemini_key') >= 0) {
                                if (hintE) hintE.textContent = 'Chybí AI klíč. Nastavte v Nastavení OpenAI API klíč nebo Gemini API klíč.';
                            } else {
                                if (hintE) hintE.textContent = 'Nepodařilo se dohledat: ' + msg;
                            }
                        })
                        .finally(function () {
                            try {
                                btnE.disabled = false;
                                btnE.classList.remove('is-loading');
                                btnE.textContent = originalText;
                            } catch (eUI2) {}
                        });
                }
                if (e.target.id === 'vitusModalDelete') {
                    var id2 = $('vitusEditMedId') && $('vitusEditMedId').value;
                    if (!id2) return;
                    logic.deleteMed(id2);
                    closeMedModal();
                    renderShelves();
                    renderCureMeds();
                    renderActiveCures();
                }
                if (e.target.id === 'vitusAddMedEnrich') {
                    var nameEl = $('vitusMedName');
                    var nameVal = (nameEl && nameEl.value) ? String(nameEl.value).trim() : '';
                    var hintAdd = $('vitusMedFormHint');
                    var btnAdd = e.target;
                    var enrichApi = getEnrich();
                    var enabled = !!(enrichApi && typeof enrichApi.isEnabled === 'function' && enrichApi.isEnabled());
                    if (!enabled) {
                        if (hintAdd) hintAdd.textContent = 'Chybí AI klíč. Nastavte v Nastavení OpenAI API klíč nebo Gemini API klíč.';
                        return;
                    }
                    if (!nameVal) {
                        if (hintAdd) hintAdd.textContent = 'Nejprve zadejte název léku.';
                        return;
                    }
                    var typeEl = $('vitusMedType');
                    var typeVal = (typeEl && typeEl.value) ? String(typeEl.value).trim() : '';
                    var medLike = { name: nameVal, type: typeVal };
                    if (!enrichApi || typeof enrichApi.enrichMed !== 'function') return;
                    if (hintAdd) hintAdd.textContent = '';
                    var originalText = '';
                    try { originalText = btnAdd.textContent; } catch (eT2) { originalText = 'Dohledat info'; }
                    try {
                        btnAdd.disabled = true;
                        btnAdd.classList.add('is-loading');
                        btnAdd.textContent = 'Bába listuje v herbářích...';
                    } catch (eUI3) {}
                    Promise.resolve()
                        .then(function () { return enrichApi.enrichMed(medLike); })
                        .then(function (res) {
                            if (!res || res.ok !== true) throw new Error('enrich_failed');
                            var patch = res.med || {};
                            function setForm(id, val) {
                                var el = $(id);
                                if (!el || val == null || val === undefined) return;
                                var s = String(val).trim();
                                if (!s) return;
                                el.value = s;
                            }
                            if (typeof patch.purpose === 'string' && patch.purpose.trim()) setForm('vitusMedPurpose', patch.purpose);
                            if (typeof patch.prescription === 'string' && patch.prescription.trim()) setForm('vitusMedPrescription', patch.prescription);
                            if (typeof patch.notes === 'string' && patch.notes.trim()) setForm('vitusMedNotes', patch.notes);
                            if (typeof patch.warning === 'string' && patch.warning.trim()) setForm('vitusMedWarning', patch.warning);
                            if (typeof patch.aiContext === 'string' && patch.aiContext.trim()) setForm('vitusMedAiContext', patch.aiContext);
                            if (typeof patch.category === 'string' && patch.category.trim()) setForm('vitusMedCategory', patch.category);
                            if (typeof patch.type === 'string' && patch.type.trim()) {
                                setForm('vitusMedType', patch.type);
                                var typeSelect = $('vitusMedType');
                                if (typeSelect) typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (hintAdd) hintAdd.textContent = 'Info dohledáno. Zkontrolujte a případně doplňte.';
                            document.querySelectorAll('#vitusAddMedForm .vitus-textarea-add').forEach(function (ta) {
                                if (ta && ta.tagName === 'TEXTAREA') ta.dispatchEvent(new Event('input', { bubbles: true }));
                            });
                        })
                        .catch(function (err) {
                            var msg = String((err && err.message) ? err.message : err);
                            if (msg.indexOf('missing_ai_key') >= 0 || msg.indexOf('missing_openai_key') >= 0 || msg.indexOf('missing_gemini_key') >= 0) {
                                if (hintAdd) hintAdd.textContent = 'Chybí AI klíč. Nastavte v Nastavení OpenAI API klíč nebo Gemini API klíč.';
                            } else {
                                if (hintAdd) hintAdd.textContent = 'Nepodařilo se dohledat: ' + msg;
                            }
                        })
                        .finally(function () {
                            try {
                                btnAdd.disabled = false;
                                btnAdd.classList.remove('is-loading');
                                btnAdd.textContent = originalText;
                            } catch (eUI4) {}
                        });
                }
            });
        }

        renderShelves();
        renderCureMeds();
        renderActiveCures();
        wire();
        refreshMedsView = function () {
            renderShelves();
            renderCureMeds();
            renderActiveCures();
        };
    }

    var DOSE_VIEW_STATE = { mode: 'day', date: null };

    function getMedColor(medId, medIndex) {
        var palette = ['#5C8A6A', '#8B7355', '#6B8E9E', '#9E6B7A', '#7A8E6B', '#8E7A6B', '#6B7A8E'];
        var idx = medIndex >= 0 ? medIndex % palette.length : 0;
        return palette[idx];
    }

    function renderDoseView(body) {
        if (!body) return;
        var logic = getLogic();
        if (!logic) {
            body.innerHTML = '<p class="vitus-muted">Chybí logika Vitusu.</p>';
            return;
        }
        var today = new Date();
        var d = DOSE_VIEW_STATE.date || new Date(today.getTime());
        var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var slots = logic.getDoseSlotsForDay(dateStr) || [];
        var activeCures = logic.listActiveCures() || [];
        var archive = logic.listArchive() || [];
        var medColorMap = {};
        var idx = 0;
        activeCures.forEach(function (a) {
            (a.cure.medIds || []).forEach(function (mid) {
                if (medColorMap[mid] === undefined) medColorMap[mid] = getMedColor(mid, idx++);
            });
        });

        var prevDate = new Date(d.getTime());
        prevDate.setDate(prevDate.getDate() - 1);
        var nextDate = new Date(d.getTime());
        nextDate.setDate(nextDate.getDate() + 1);
        var prevStr = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0') + '-' + String(prevDate.getDate()).padStart(2, '0');
        var nextStr = nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0') + '-' + String(nextDate.getDate()).padStart(2, '0');
        var isToday = dateStr === (today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'));

        var slotsHtml = slots.length
            ? slots.map(function (s) {
                var col = medColorMap[s.medId] || '#5C8A6A';
                return ''
                    + '<div class="vitus-dose-slot" data-med-id="' + escapeHtml(s.medId) + '" data-date="' + escapeHtml(s.date) + '" data-time="' + escapeHtml(s.time) + '">'
                    + '  <span class="vitus-dose-color" style="background:' + escapeHtml(col) + '"></span>'
                    + '  <span class="vitus-dose-time">' + escapeHtml(s.time) + '</span>'
                    + '  <span class="vitus-dose-name">' + escapeHtml(s.medName) + '</span>'
                    + '  <label class="vitus-dose-check">'
                    + '    <input type="checkbox" class="vitus-dose-checkbox" ' + (s.taken ? 'checked' : '') + ' /> Užito'
                    + '  </label>'
                    + '</div>';
            }).join('')
            : '<p class="vitus-empty">Žádná dávka na tento den. Přidejte aktivní kúru s léky v sekci Léky.</p>';

        var legendHtml = Object.keys(medColorMap).length ? activeCures.map(function (a) {
            return (a.cure.medIds || []).map(function (mid) {
                var m = getMedById(mid);
                if (!m) return '';
                return '<span class="vitus-dose-legend-item" style="--med-color:' + escapeHtml(medColorMap[mid] || '#5C8A6A') + '" data-med-id="' + escapeHtml(mid) + '" data-cure-id="' + escapeHtml(a.cure.id) + '">'
                    + escapeHtml(m.name) + ' <button type="button" class="vitus-dose-legend-edit" title="Upravit časy dávkování">čas</button></span>';
            }).join('');
        }).join('') : '';

        var archiveHtml = archive.length
            ? '<section class="vitus-dose-archive">'
                + '<h4 class="vitus-dose-section-title">Historie / Archiv</h4>'
                + '<div class="vitus-dose-archive-list">'
                + archive.slice(0, 10).map(function (e) {
                    var adh = e.adherence || {};
                    var adhText = (adh.total > 0) ? (' | Poctivost: ' + (adh.taken || 0) + '/' + adh.total) : '';
                    return '<div class="vitus-dose-archive-item">'
                        + '<span class="vitus-dose-archive-name">' + escapeHtml(e.cure && e.cure.name || 'Kúra') + '</span>'
                        + '<span class="vitus-dose-archive-meta">Ukončeno ' + escapeHtml(e.archivedAt || '') + ' – ' + (e.reason === 'tablets_zero' ? 'tabletky došly' : 'konec kúry') + adhText + '</span>'
                        + '</div>';
                }).join('')
                + '</div></section>'
            : '';

        var mode = DOSE_VIEW_STATE.mode || 'day';
        var weekSlotsHtml = '';
        if (mode === 'week' || mode === 'month') {
            var daysToShow = mode === 'week' ? 7 : 28;
            var startD = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            var weekDays = [];
            for (var i = 0; i < daysToShow; i++) {
                var dd = new Date(startD.getTime());
                dd.setDate(dd.getDate() + i);
                var ds = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
                var daySlots = logic.getDoseSlotsForDay(ds) || [];
                var isDayToday = ds === (today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'));
                var dayLabel = (dd.getDate()) + '.' + (dd.getMonth() + 1) + '.';
                var daySlotsStr = daySlots.map(function (s) {
                    var col = medColorMap[s.medId] || '#5C8A6A';
                    return '<div class="vitus-dose-slot vitus-dose-slot--compact" data-med-id="' + escapeHtml(s.medId) + '" data-date="' + escapeHtml(s.date) + '" data-time="' + escapeHtml(s.time) + '">'
                        + '<span class="vitus-dose-color" style="background:' + escapeHtml(col) + '"></span>'
                        + '<span class="vitus-dose-time">' + escapeHtml(s.time) + '</span> '
                        + '<span class="vitus-dose-name">' + escapeHtml(s.medName) + '</span>'
                        + '<label class="vitus-dose-check"><input type="checkbox" class="vitus-dose-checkbox" ' + (s.taken ? 'checked' : '') + ' /> Užito</label></div>';
                }).join('');
                weekDays.push('<div class="vitus-dose-week-day' + (isDayToday ? ' vitus-dose-week-day--today' : '') + '">'
                    + '<div class="vitus-dose-week-day-label">' + escapeHtml(dayLabel) + (isDayToday ? ' (Dnes)' : '') + '</div>'
                    + '<div class="vitus-dose-week-day-slots">' + (daySlotsStr || '<span class="vitus-muted">—</span>') + '</div></div>');
            }
            weekSlotsHtml = '<div class="vitus-dose-week-grid">' + weekDays.join('') + '</div>';
        }
        var displaySlots = (mode === 'week' || mode === 'month') ? weekSlotsHtml : slotsHtml;
        var prevOffset = mode === 'day' ? 1 : (mode === 'week' ? 7 : 28);
        var nextOffset = prevOffset;
        var prevDateMode = new Date(d.getTime());
        prevDateMode.setDate(prevDateMode.getDate() - prevOffset);
        var nextDateMode = new Date(d.getTime());
        nextDateMode.setDate(nextDateMode.getDate() + nextOffset);
        var prevStrMode = prevDateMode.getFullYear() + '-' + String(prevDateMode.getMonth() + 1).padStart(2, '0') + '-' + String(prevDateMode.getDate()).padStart(2, '0');
        var nextStrMode = nextDateMode.getFullYear() + '-' + String(nextDateMode.getMonth() + 1).padStart(2, '0') + '-' + String(nextDateMode.getDate()).padStart(2, '0');

        body.innerHTML = ''
            + '<div class="vitus-dose-view">'
            + '  <p class="vitus-disclaimer vitus-dose-disclaimer">Vitus není náhrada lékaře – jen pomáhá nezapomenout. Při nejasnostech se poraďte s odborníkem.</p>'
            + '  <div class="vitus-dose-mode-toggle" role="group">'
            + '    <button type="button" class="vitus-dose-mode-btn' + (mode === 'day' ? ' active' : '') + '" data-mode="day">Den</button>'
            + '    <button type="button" class="vitus-dose-mode-btn' + (mode === 'week' ? ' active' : '') + '" data-mode="week">Týden</button>'
            + '    <button type="button" class="vitus-dose-mode-btn' + (mode === 'month' ? ' active' : '') + '" data-mode="month">Měsíc</button>'
            + '  </div>'
            + '  <div class="vitus-dose-nav">'
            + '    <button type="button" class="vitus-btn vitus-btn--ghost vitus-dose-nav-btn" data-date="' + escapeHtml(mode === 'day' ? prevStr : prevStrMode) + '">← Předchozí</button>'
            + '    <span class="vitus-dose-date">' + (isToday && mode === 'day' ? 'Dnes' : '') + ' ' + escapeHtml(dateStr) + (mode === 'week' ? ' (týden)' : mode === 'month' ? ' (4 týdny)' : '') + '</span>'
            + '    <button type="button" class="vitus-btn vitus-btn--ghost vitus-dose-nav-btn" data-date="' + escapeHtml(mode === 'day' ? nextStr : nextStrMode) + '">Další →</button>'
            + '  </div>'
            + '  <div class="vitus-dose-slots" id="vitusDoseSlots">'
            + (typeof displaySlots === 'string' ? displaySlots : slotsHtml)
            + '  </div>'
            + (legendHtml ? '<div class="vitus-dose-legend"><h4 class="vitus-dose-legend-title">Léky</h4><div class="vitus-dose-legend-items">' + legendHtml + '</div></div>' : '')
            + archiveHtml
            + '</div>';

        body.querySelectorAll('.vitus-dose-checkbox').forEach(function (cb) {
            cb.addEventListener('change', function () {
                if (!this.checked) return;
                var slot = this.closest('.vitus-dose-slot');
                if (!slot) return;
                var medId = slot.getAttribute('data-med-id');
                var date = slot.getAttribute('data-date');
                var time = slot.getAttribute('data-time');
                if (medId && date && time) logic.markDoseTaken(medId, date, time);
                if (typeof refreshMedsView === 'function') refreshMedsView();
                renderDoseView(body);
            });
        });

        body.querySelectorAll('.vitus-dose-nav-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dt = this.getAttribute('data-date');
                if (dt) {
                    var parts = dt.split('-');
                    DOSE_VIEW_STATE.date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                    renderDoseView(body);
                }
            });
        });

        body.querySelectorAll('.vitus-dose-mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var m = this.getAttribute('data-mode') || 'day';
                DOSE_VIEW_STATE.mode = m;
                renderDoseView(body);
            });
        });

        body.querySelectorAll('.vitus-dose-legend-edit').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = this.closest('.vitus-dose-legend-item');
                if (!item) return;
                var medId = item.getAttribute('data-med-id');
                var cureId = item.getAttribute('data-cure-id');
                var m = getMedById(medId);
                if (!m || !cureId) return;
                var active = (logic.listActiveCures() || []).find(function (x) { return x.cure.id === cureId; });
                var cure = active ? active.cure : null;
                var current = (cure && logic.getMedSchedule) ? logic.getMedSchedule(cure, medId) : ['08:00', '20:00'];
                var raw = prompt('Časy dávkování oddělené čárkou (např. 08:00, 12:00, 20:00):', current.join(', '));
                if (raw == null) return;
                var times = String(raw || '').split(/[,\s]+/).map(function (t) { return t.trim(); }).filter(Boolean);
                if (times.length && logic.setCureSchedule) {
                    logic.setCureSchedule(cureId, medId, times);
                    renderDoseView(body);
                }
            });
        });
    }

    function renderHerbalistView(body) {
        if (!body) return;
        var logic = getLogic();
        var quickItems = [
            { q: 'bolí mě zub', label: 'Bolí zub' },
            { q: 'bolí mě hlava', label: 'Bolest hlavy' },
            { q: 'nachlazení, rýma', label: 'Nachlazení' },
            { q: 'heřmánek', label: 'Heřmánek' },
            { q: 'šalvěj', label: 'Šalvěj' },
            { q: 'meduňka', label: 'Meduňka' },
            { q: 'šípek', label: 'Šípek' }
        ];
        var ctx = '';
        if (logic) {
            var meds = logic.listMeds() || [];
            if (meds.length) ctx += 'Léky v lékárničce: ' + meds.map(function (m) { return (m.name || ''); }).filter(Boolean).join(', ') + '. ';
            if (typeof logic.getMissedDosesReport === 'function') {
                var rep = logic.getMissedDosesReport();
                if (rep) ctx += rep;
            }
        }
        body.innerHTML = ''
            + '<div class="vitus-herbalist-view">'
            + '  <p class="vitus-disclaimer vitus-herbalist-disclaimer">Není to náhrada lékaře – jen doplněk pro domácí lékárničku. U závažných potíží vždy vyhledejte odborníka.</p>'
            + '  <div class="vitus-herbalist-quick">'
            + '    <span class="vitus-herbalist-quick-label">Rychlý výběr:</span>'
            + quickItems.map(function (x) { return '<button type="button" class="vitus-herbalist-quick-btn" data-query="' + escapeHtml(x.q) + '">' + escapeHtml(x.label) + '</button>'; }).join('')
            + '  </div>'
            + '  <div class="vitus-herbalist-input-wrap">'
            + '    <input type="text" id="vitusHerbalistInput" class="vitus-herbalist-input" placeholder="Napiš např. bolí mě zub, heřmánek, co na kašel…" autocomplete="off" />'
            + '    <button type="button" class="vitus-btn vitus-herbalist-send" id="vitusHerbalistSend">Zeptat se</button>'
            + '  </div>'
            + '  <div class="vitus-herbalist-response" id="vitusHerbalistResponse" aria-live="polite"></div>'
            + '</div>';
        var inputEl = document.getElementById('vitusHerbalistInput');
        var respEl = document.getElementById('vitusHerbalistResponse');
        var sendBtn = document.getElementById('vitusHerbalistSend');
        function ask(query) {
            query = String(query || '').trim();
            if (!query) return;
            if (respEl) respEl.innerHTML = '<p class="vitus-muted">Bába přemýšlí…</p>';
            if (sendBtn) sendBtn.disabled = true;
            var systemPrompt = 'Jsi Bába Kořenářka, zkušená bylinkářka. Pomáháš s běžnými neduhy a bylinkami pro domácí lékárničku. NENÍŠ náhrada lékaře – vždy doporuč návštěvu odborníka u vážných potíží. '
                + 'Když uživatel popíše problém (např. bolí zub): doporuč zubaře, ale též babskou radu, jak si krátkodobě ulevit, aniž by sahal po chemii z lékárny. '
                + 'Když uživatel napsal název bylinky: vysvětli, na co se používá a jak ji připravit. Piš stručně, srozumitelně, v češtině.';
            var userContent = query;
            if (ctx) userContent = '[Kontext o lécích a dávkování uživatele: ' + ctx + ']\n\nDotaz: ' + query;
            var bodyReq = {
                model: 'gpt-4o-mini',
                max_tokens: 600,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            };
            var hasProxy = window.OMNI_Keys && typeof window.OMNI_Keys.openAiFetch === 'function';
            var key = (window.OMNI_Keys && typeof window.OMNI_Keys.getOpenAiKey === 'function') ? window.OMNI_Keys.getOpenAiKey() : '';
            var url = (window.OMNI_CONFIG && window.OMNI_CONFIG.apiBase) ? (window.OMNI_CONFIG.apiBase + '/openai') : '/api/openai';
            var fetchPromise = hasProxy
                ? window.OMNI_Keys.openAiFetch(bodyReq)
                : (key ? fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                    body: JSON.stringify(bodyReq)
                }) : fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq) }));
            Promise.resolve(fetchPromise)
                .then(function (r) { return r.json ? r.json() : r; })
                .then(function (data) {
                    var text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
                        ? data.choices[0].message.content
                        : (data && data.choices && data.choices[0]) ? String(data.choices[0]) : '';
                    if (respEl) respEl.innerHTML = '<div class="vitus-herbalist-answer">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
                })
                .catch(function (err) {
                    var msg = (err && err.message) ? err.message : 'Nepodařilo se zeptat. Zkontrolujte API klíč v Nastavení.';
                    if (respEl) respEl.innerHTML = '<p class="vitus-herbalist-error">' + escapeHtml(msg) + '</p>';
                })
                .finally(function () {
                    if (sendBtn) sendBtn.disabled = false;
                });
        }
        body.querySelectorAll('.vitus-herbalist-quick-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var q = this.getAttribute('data-query') || '';
                if (inputEl) inputEl.value = q;
                ask(q);
            });
        });
        if (sendBtn) sendBtn.addEventListener('click', function () { ask(inputEl ? inputEl.value : ''); });
        if (inputEl) inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(this.value); });
    }

    function runDoseMissedCheck() {
        var logic = getLogic();
        if (!logic || typeof logic.getDoseSlotsForDay !== 'function') return;
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        var ys = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
        var slots = logic.getDoseSlotsForDay(ys) || [];
        slots.forEach(function (s) {
            if (!s.taken) logic.recordMissedDose(s.medId, s.medName, s.date, s.time);
        });
    }

    var currentVitusView = 'meds';
    var vitusIntroVisible = false;

    function setView(view) {
        view = String(view || '').trim() || 'meds';
        currentVitusView = view;
        vitusIntroVisible = false;
        var introSection = document.getElementById('vitusIntroSection');
        var panel = document.getElementById('vitusPanel');
        if (introSection) introSection.style.display = 'none';
        if (panel) panel.style.display = '';
        var title = $('vitusViewTitle');
        var body = $('vitusViewBody');
        if (!title || !body) return;

        var t = 'Lékárnička';
        var content = '';
        if (view === 'dose') {
            t = 'Zobání';
            refreshMedsView = function () {
                renderDoseView(body);
            };
            renderDoseView(body);
            title.textContent = t;
            document.querySelectorAll('.vitus-nav-item').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-vitus-view') === view);
            });
            return;
        } else if (view === 'herbalist') {
            t = 'Bába Kořenářka';
            content = '';
        } else if (view === 'rodina') {
            t = 'Rodina';
            content = '<p class="vitus-muted">Léky pro členy rodiny – připravujeme.</p>';
        }

        title.textContent = t;
        if (view === 'meds') {
            renderMedsView(body);
        } else if (view === 'herbalist') {
            refreshMedsView = null;
            renderHerbalistView(body);
        } else {
            refreshMedsView = null;
            body.innerHTML = content;
        }

        document.querySelectorAll('.vitus-nav-item').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-vitus-view') === view);
        });
    }

    function init() {
        if (!vitusDataListenerBound) {
            vitusDataListenerBound = true;
            document.addEventListener('omni:vitus-data-changed', function () {
                if (typeof refreshMedsView === 'function') refreshMedsView();
            });
        }
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('.vitus-nav-item') : null;
            if (btn) {
                try {
                    if (window.OMNI_AppState && window.OMNI_AppState.getActiveModule && window.OMNI_AppState.getActiveModule() !== 'vitus') return;
                } catch (err) {}
                var v = btn.getAttribute('data-vitus-view') || 'meds';
                setView(v);
                return;
            }
            var introCard = e.target && e.target.closest ? e.target.closest('.vitus-intro-card') : null;
            if (introCard) {
                var v2 = introCard.getAttribute('data-vitus-view') || 'meds';
                setView(v2);
            }
        });

        document.addEventListener('omni:module-changed', function (e) {
            var next = (e && e.detail && e.detail.next) ? e.detail.next : '';
            if (next === 'vitus') {
                try {
                    if (document.body.classList.contains('module-vitus')) vitusIntroVisible = true;
                } catch (err) {}
                var introSection = document.getElementById('vitusIntroSection');
                var panel = document.getElementById('vitusPanel');
                if (vitusIntroVisible && introSection && panel) {
                    introSection.style.display = 'block';
                    panel.style.display = 'none';
                } else {
                    setView(currentVitusView);
                }
            }
        });

        try {
            if (document.body.classList.contains('module-vitus')) vitusIntroVisible = true;
        } catch (err) {}
        var introSection = document.getElementById('vitusIntroSection');
        var panel = document.getElementById('vitusPanel');
        if (vitusIntroVisible && introSection && panel) {
            introSection.style.display = 'block';
            panel.style.display = 'none';
        } else {
            setView(currentVitusView);
        }

        runDoseMissedCheck();

        // uvítací text (požadavek)
        var welcome = $('vitusWelcomeText');
        if (welcome) {
            welcome.textContent = 'Vítejte v Apatyce. Bába Kořenářka připravuje vaše bylinky a léky.';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

