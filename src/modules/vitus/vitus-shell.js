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

        var ADD_OPEN_KEY = 'omnishelf_vitus_add_open';
        var addOpen = false;
        try { addOpen = String(localStorage.getItem(ADD_OPEN_KEY) || '') === '1'; } catch (e0) { addOpen = false; }

        body.innerHTML = ''
            + '<details class="vitus-accordion" id="vitusAddAccordion"' + (addOpen ? ' open' : '') + '>'
            + '  <summary class="vitus-accordion-summary">'
            + '    <div class="vitus-accordion-title">Přidej lék do Ventusu</div>'
            + '    <div class="vitus-accordion-sub">Vpravo sken receptu/letáku/krabičky, vlevo rychlá kontrola a opravy.</div>'
            + '  </summary>'
            + '  <div class="vitus-accordion-body">'
            + '    <div class="vitus-add-grid">'
            + '      <section class="vitus-card">'
            + '        <div class="vitus-card-head">'
            + '          <div class="vitus-card-title">Moje Apatyka</div>'
            + '          <div class="vitus-card-sub">Tady můžete cokoliv ručně doplnit nebo opravit.</div>'
            + '        </div>'
            + '        <form class="vitus-form vitus-form--compact" id="vitusAddMedForm" autocomplete="off">'
            + '      <div class="vitus-form-row vitus-form-row--inline">'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedName">Název léku</label><input class="vitus-input" id="vitusMedName" required placeholder="např. Ibuprofen" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedType">Typ</label><select class="vitus-input vitus-select" id="vitusMedType"><option value="">—</option><option value="tablety">tablety</option><option value="sirup">sirup</option><option value="kapky">kapky</option><option value="mast">mast</option><option value="spray">spray</option><option value="tobolky">tobolky</option><option value="čípky">čípky</option><option value="jiné">jiné</option></select></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedExpiration">Expirace</label><input class="vitus-input" id="vitusMedExpiration" type="date" /></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline">'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedTotal">Počet v bal.</label><input class="vitus-input" id="vitusMedTotal" type="number" min="0" step="1" placeholder="30" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedRemaining">Zbývá</label><input class="vitus-input" id="vitusMedRemaining" type="number" min="0" step="1" placeholder="12" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedDoseAmount">Dávka (ks)</label><input class="vitus-input" id="vitusMedDoseAmount" type="number" min="0" step="1" value="1" /></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedCategory">Polička</label><select class="vitus-input vitus-select" id="vitusMedCategory">' + options + '</select></div>'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedForWhom">Pro koho</label><select class="vitus-input vitus-select" id="vitusMedForWhom">' + recipientOpts + '</select></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline vitus-form-row--full">'
            + '        <div class="vitus-field-inline"><label class="vitus-label" for="vitusMedPurpose">Účel</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedPurpose" rows="2" placeholder="např. bolest hlavy, spánek…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline vitus-form-row--full">'
            + '        <div class="vitus-field-inline vitus-field-inline--full"><label class="vitus-label" for="vitusMedPrescription">Recept / instrukce</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedPrescription" rows="2" placeholder="např. 1× denně po jídle…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline vitus-form-row--full">'
            + '        <div class="vitus-field-inline vitus-field-inline--full"><label class="vitus-label" for="vitusMedNotes">Poznámky</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedNotes" rows="2" placeholder="např. nekombinovat s…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline vitus-form-row--full">'
            + '        <div class="vitus-field-inline vitus-field-inline--full"><label class="vitus-label" for="vitusMedWarning">Varování</label><textarea class="vitus-input vitus-textarea-add" id="vitusMedWarning" rows="2" placeholder="na co si dát pozor…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-form-row vitus-form-row--inline vitus-form-row--full">'
            + '        <div class="vitus-field-inline vitus-field-inline--full"><label class="vitus-label" for="vitusMedAiContext">Složení / AI kontext</label><textarea class="vitus-input vitus-textarea-add vitus-textarea-add--ai" id="vitusMedAiContext" rows="3" placeholder="účinná látka, indikace…"></textarea></div>'
            + '      </div>'
            + '      <div class="vitus-cover-block" id="vitusCoverBlock">'
            + '        <div class="vitus-cover-preview" id="vitusCoverPreview" style="display:none;"></div>'
            + '        <p class="vitus-cover-from-scan" id="vitusCoverFromScan" style="display:none;">Obrázek ze skenu – bude použit jako obal léku. Můžete nahradit tlačítkem níže.</p>'
            + '      </div>'
            + '      <div class="vitus-actions">'
            + '        <button type="submit" class="vitus-btn vitus-btn--primary">Přidat lék</button>'
            + '        <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusPickCoverBtn">Přidat / nahradit foto léku</button>'
            + '        <span class="vitus-form-hint" id="vitusMedFormHint"></span>'
            + '      </div>'
            + '      <input type="file" id="vitusCoverInput" accept="image/*" style="display:none;" />'
            + '    </form>'
            + '      </section>'
            + '      <section class="vitus-card">'
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
            + '      </section>'
            + '    </div>'
            + '    <section class="vitus-card vitus-card--wide">'
            + '  <div class="vitus-card-head">'
            + '    <div class="vitus-card-title">Léčebné kúry</div>'
            + '    <div class="vitus-card-sub">Aktivní kúry mají odpočet do konce.</div>'
            + '  </div>'
            + '  <div class="vitus-cures-grid">'
            + '    <form class="vitus-form" id="vitusAddCureForm" autocomplete="off">'
            + '      <div class="vitus-form-row">'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureName">Název kúry</label>'
            + '          <input class="vitus-input" id="vitusCureName" required placeholder="např. 14 dní – imunita" />'
            + '        </div>'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureStart">Start</label>'
            + '          <input class="vitus-input" id="vitusCureStart" type="date" required />'
            + '        </div>'
            + '        <div class="vitus-field">'
            + '          <label class="vitus-label" for="vitusCureEnd">Konec</label>'
            + '          <input class="vitus-input" id="vitusCureEnd" type="date" required />'
            + '        </div>'
            + '      </div>'
            + '      <div class="vitus-form-row">'
            + '        <div class="vitus-field vitus-field--full">'
            + '          <label class="vitus-label">Přiřazené léky</label>'
            + '          <div class="vitus-checkboxes" id="vitusCureMeds"></div>'
            + '        </div>'
            + '      </div>'
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
            + '</details>'
            + '<section class="vitus-card vitus-card--wide">'
            + '  <div class="vitus-card-head">'
            + '    <div class="vitus-card-title">Moje poličky</div>'
            + '    <div class="vitus-card-sub">Skupiny podle kategorií (účel můžete použít jako label na kartě).</div>'
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
                var cards = meds.map(function (m) {
                    var expDays = daysTo(m.expiration);
                    var expBadge = '';
                    if (typeof expDays === 'number') {
                        if (expDays < 0) expBadge = '<span class="vitus-badge vitus-badge--danger">Expirované</span>';
                        else if (expDays <= 14) expBadge = '<span class="vitus-badge vitus-badge--warn">Exp. ' + expDays + ' dní</span>';
                    }
                    var doseText = (m.dosage && (m.dosage.text || m.dosage.amount)) ? ('<span class="vitus-meta-item">Dávka: ' + escapeHtml(m.dosage.text || (String(m.dosage.amount) + ' ks')) + '</span>') : '';
                    var purpose = m.purpose ? ('<span class="vitus-meta-item">Účel: ' + escapeHtml(m.purpose) + '</span>') : '';
                    var cover = (m.coverImage && String(m.coverImage).indexOf('data:image') === 0)
                        ? ('<div class="vitus-med-cover"><img src="' + escapeHtml(m.coverImage) + '" alt="' + escapeHtml(m.name) + '" /></div>')
                        : '<div class="vitus-med-cover vitus-med-cover--empty"><span>🌿</span></div>';
                    return ''
                        + '<div class="vitus-med-card" data-med-id="' + escapeHtml(m.id) + '">'
                        + cover
                        + '  <div class="vitus-med-main">'
                        + '  <div class="vitus-med-top">'
                        + '    <div class="vitus-med-name">' + escapeHtml(m.name) + '</div>'
                        + '    <div class="vitus-med-badges">'
                        +       expBadge
                        + '      <span class="vitus-badge vitus-badge--qty">' + escapeHtml(fmtQty(m)) + '</span>'
                        + '    </div>'
                        + '  </div>'
                        + '  <div class="vitus-med-meta">'
                        + '    ' + (m.type ? ('<span class="vitus-meta-item">Forma: ' + escapeHtml(m.type) + '</span>') : '')
                        + '    ' + doseText
                        + '    ' + purpose
                        + '  </div>'
                        + '  <div class="vitus-med-actions">'
                        + '    <button type="button" class="vitus-btn vitus-btn--dose" data-action="dose">Užít dávku</button>'
                        + '    <button type="button" class="vitus-btn vitus-btn--ghost" data-action="delete" title="Smazat">Smazat</button>'
                        + '  </div>'
                        + '  </div>'
                        + '</div>';
                }).join('');
                return ''
                    + '<div class="vitus-shelf">'
                    + '  <div class="vitus-shelf-title">' + escapeHtml(cat) + '</div>'
                    + '  <div class="vitus-shelf-grid">' + cards + '</div>'
                    + '</div>';
            }).join('');
        }

        function getMedById(id) {
            id = String(id || '');
            var meds = logic.listMeds();
            for (var i = 0; i < meds.length; i++) if (meds[i].id === id) return meds[i];
            return null;
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
                + '        <label class="vitus-label" for="vitusEditMedCat">Polička</label>'
                + '        <select class="vitus-input vitus-select vitus-input--large" id="vitusEditMedCat">' + options + '</select>'
                + '      </div>'
                + '    </div>'
                + '    <div class="vitus-detail-block vitus-detail-block--stock">'
                + '      <h4 class="vitus-detail-block-title">Stav zásob & Expirace</h4>'
                + '      <div class="vitus-form-row">'
                + '        <div class="vitus-field">'
                + '          <label class="vitus-label" for="vitusEditMedTotal">Počet v balení</label>'
                + '          <input class="vitus-input vitus-input--large" id="vitusEditMedTotal" type="number" min="0" step="1" value="' + escapeHtml(String(med.totalQuantity || 0)) + '" />'
                + '        </div>'
                + '        <div class="vitus-field">'
                + '          <label class="vitus-label" for="vitusEditMedRemaining">Zbývá tablet/bal.</label>'
                + '          <input class="vitus-input vitus-input--large" id="vitusEditMedRemaining" type="number" min="0" step="1" value="' + escapeHtml(String(med.remainingQuantity || 0)) + '" />'
                + '        </div>'
                + '        <div class="vitus-field">'
                + '          <label class="vitus-label" for="vitusEditMedExp">Datum expirace</label>'
                + '          <input class="vitus-input vitus-input--large" id="vitusEditMedExp" type="date" value="' + escapeHtml(med.expiration) + '" />'
                + '        </div>'
                + '        <div class="vitus-field">'
                + '          <label class="vitus-label" for="vitusEditMedDose">Dávka (ks)</label>'
                + '          <input class="vitus-input vitus-input--large" id="vitusEditMedDose" type="number" min="0" step="1" value="' + escapeHtml(String((med.dosage && med.dosage.amount) ? med.dosage.amount : 1)) + '" />'
                + '        </div>'
                + '      </div>'
                + '    </div>'
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
                + '      <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalEnrich" title="' + escapeHtml(enrichTitle) + '"' + enrichDisabledAttr + '>Dohledat info o léku</button>'
                + '      <button type="button" class="vitus-btn vitus-btn--ghost" id="vitusModalDelete">Smazat</button>'
                + '      <span class="vitus-form-hint" id="vitusModalHint"></span>'
                + '    </div>'
                + '    <div class="vitus-ai-disclaimer">Informace jsou generovány AI a mají informativní charakter. Vždy konzultuj s lékařem.</div>'
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

        function renderCureMeds() {
            var box = $('vitusCureMeds');
            if (!box) return;
            var meds = logic.listMeds();
            if (!meds.length) {
                box.innerHTML = '<div class="vitus-muted">Nejdřív přidejte léky do Apatyky.</div>';
                return;
            }
            box.innerHTML = meds.map(function (m) {
                return ''
                    + '<label class="vitus-checkbox">'
                    + '  <input type="checkbox" value="' + escapeHtml(m.id) + '" />'
                    + '  <span>' + escapeHtml(m.name) + '</span>'
                    + '</label>';
            }).join('');
        }

        function renderActiveCures() {
            var wrap = $('vitusActiveCures');
            if (!wrap) return;
            var active = logic.listActiveCures();
            if (!active.length) {
                wrap.innerHTML = '<div class="vitus-empty">Žádná aktivní kúra. Přidejte si jednu.</div>';
                return;
            }
            wrap.innerHTML = active.map(function (x) {
                var c = x.cure;
                var medsById = {};
                logic.listMeds().forEach(function (m) { medsById[m.id] = m; });
                var medNames = (c.medIds || []).map(function (id) { return medsById[id] ? medsById[id].name : ''; }).filter(Boolean);
                return ''
                    + '<div class="vitus-cure-card" data-cure-id="' + escapeHtml(c.id) + '">'
                    + '  <div class="vitus-cure-top">'
                    + '    <div class="vitus-cure-name">' + escapeHtml(c.name) + '</div>'
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
            // Accordion persistence
            var acc = $('vitusAddAccordion');
            if (acc) {
                acc.addEventListener('toggle', function () {
                    try { localStorage.setItem(ADD_OPEN_KEY, acc.open ? '1' : '0'); } catch (e0) {}
                });
            }
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

                if (target === 'cure') applyScanResultToCureForm(result);
                else applyScanResultToMedForm(result);

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

                    var res = logic.upsertMed({
                        name: name,
                        type: type,
                        totalQuantity: totalN,
                        remainingQuantity: remN,
                        dosage: { amount: Number(doseAmount || 1), text: '' },
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
            if (cureForm) {
                cureForm.addEventListener('submit', function (e) {
                    e.preventDefault();
                    if (cureHint) cureHint.textContent = '';
                    var name = $('vitusCureName') && $('vitusCureName').value;
                    var start = $('vitusCureStart') && $('vitusCureStart').value;
                    var end = $('vitusCureEnd') && $('vitusCureEnd').value;
                    var medsBox = $('vitusCureMeds');
                    var selected = [];
                    if (medsBox) {
                        medsBox.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                            if (cb.checked) selected.push(cb.value);
                        });
                    }
                    var res = logic.upsertCure({ name: name, start: start, end: end, medIds: selected });
                    if (!res.ok) {
                        if (cureHint) cureHint.textContent = res.message || 'Nelze uložit.';
                        return;
                    }
                    try { cureForm.reset(); } catch (e0) {}
                    if (cureHint) cureHint.textContent = 'Uloženo.';
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

    function setView(view) {
        view = String(view || '').trim() || 'meds';
        var title = $('vitusViewTitle');
        var body = $('vitusViewBody');
        if (!title || !body) return;

        var t = 'Léky';
        var content = '';
        if (view === 'dose') {
            t = 'Dávkování';
            content = '<p class="vitus-muted">Zde bude plán dávkování, upozornění a historie.</p>';
        } else if (view === 'herbalist') {
            t = 'Bába Kořenářka';
            content = '<p class="vitus-muted">Zde budou bylinkové recepty, rady a “AI kořenářka”.</p>';
        }

        title.textContent = t;
        if (view === 'meds') {
            renderMedsView(body);
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
        document.querySelectorAll('.vitus-nav-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var v = btn.getAttribute('data-vitus-view') || 'meds';
                setView(v);
            });
        });

        // default
        setView('meds');

        // uvítací text (požadavek)
        var welcome = $('vitusWelcomeText');
        if (welcome) {
            welcome.textContent = 'Vítejte v Apatyce. Bába Kořenářka připravuje vaše bylinky a léky.';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

