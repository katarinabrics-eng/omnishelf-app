/**
 * OmniShelf – modul Text.
 * Samostatná logika pro textové záznamy: ruční přidání, poznámky, citace.
 * Nezávislá na sektoru – použitelná pro Library, Workshop, Wardrobe, Music, Pantry.
 */
(function (global) {
    'use strict';

    function escapeHtml(str) {
        if (str == null) return '';
        var s = String(str);
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    /**
     * Vytvoří normalizovaný textový záznam z polí formuláře.
     * @param {Object} fields - title, author, location, position, estimatedValue, isbn, owner, note, citation
     * @returns {Object} Záznam připravený k uložení
     */
    function createTextRecord(fields) {
        var title = (fields.title || '').trim();
        var author = (fields.author || '').trim();
        return {
            title: title || 'Unknown',
            author: author || 'Unknown',
            location: (fields.location || '').trim(),
            position: (fields.position || '').trim(),
            estimatedValue: (fields.estimatedValue || '').trim(),
            isbn: (fields.isbn || '').trim().replace(/\s/g, ''),
            owner: (fields.owner || '').trim() || 'Já',
            note: (fields.note || '').trim(),
            citation: (fields.citation || '').trim(),
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Inicializuje formulář pro ruční přidání (kniha / položka / poznámka).
     * @param {Object} refs - form, titleInput, authorInput, locationInput, positionInput, estimatedValueInput, isbnInput, ownerSelect, wishlistBtn
     * @param {Object} options - onSubmit(record), onWishlist(record), getOwnerOptions() -> [{ id, name }]
     */
    function initManualAddForm(refs, options) {
        var form = refs.form;
        if (!form) return;

        var titleInput = refs.titleInput;
        var authorInput = refs.authorInput;
        var locationInput = refs.locationInput;
        var positionInput = refs.positionInput;
        var estimatedValueInput = refs.estimatedValueInput;
        var isbnInput = refs.isbnInput;
        var ownerSelect = refs.ownerSelect;

        if (ownerSelect && typeof options.getOwnerOptions === 'function') {
            ownerSelect.innerHTML = '';
            var opts = options.getOwnerOptions();
            (opts || []).forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.name || p.id;
                opt.textContent = p.name || p.id;
                ownerSelect.appendChild(opt);
            });
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var title = titleInput ? (titleInput.value || '').trim() : '';
            var author = authorInput ? (authorInput.value || '').trim() : '';
            if (!title && !author) return;

            var record = createTextRecord({
                title: title,
                author: author,
                location: locationInput ? locationInput.value : '',
                position: positionInput ? positionInput.value : '',
                estimatedValue: estimatedValueInput ? estimatedValueInput.value : '',
                isbn: isbnInput ? isbnInput.value : '',
                owner: ownerSelect ? ownerSelect.value : 'Já'
            });

            if (typeof options.onSubmit === 'function') options.onSubmit(record);

            if (titleInput) titleInput.value = '';
            if (authorInput) authorInput.value = '';
            if (locationInput) locationInput.value = '';
            if (positionInput) positionInput.value = '';
            if (estimatedValueInput) estimatedValueInput.value = '';
            if (isbnInput) isbnInput.value = '';
        });

        if (refs.wishlistBtn && typeof options.onWishlist === 'function') {
            refs.wishlistBtn.addEventListener('click', function () {
                var title = titleInput ? (titleInput.value || '').trim() : '';
                var author = authorInput ? (authorInput.value || '').trim() : '';
                if (!title && !author) return;
                var record = createTextRecord({
                    title: title,
                    author: author,
                    isbn: isbnInput ? isbnInput.value : ''
                });
                options.onWishlist(record);
                if (titleInput) titleInput.value = '';
                if (authorInput) authorInput.value = '';
                if (isbnInput) isbnInput.value = '';
            });
        }
    }

    global.OMNI_TextModule = {
        createTextRecord: createTextRecord,
        initManualAddForm: initManualAddForm,
        escapeHtml: escapeHtml
    };
})(typeof window !== 'undefined' ? window : this);
