/**
 * OmniShelf – Library Upload Logic (hotfix-safe).
 * - HTML5 Canvas komprese obálek (max 300px, JPEG, q=0.6)
 * - FileReader helpers
 * - Retry mechanism při QuotaExceededError (spolupracuje se saveToStorage(), které vrací boolean)
 *
 * Tento modul je čistě browserový (bez bundleru) a exportuje se na window.OMNI_LibraryUploadLogic.
 */
(function (global) {
    'use strict';

    var DEFAULT_STORE_MAX_WIDTH = 300;
    var DEFAULT_STORE_QUALITY = 0.6;
    /** Max šířka obrázku pro API (šetření tokenů). Kvalita JPEG pro API. */
    var DEFAULT_AI_MAX_WIDTH = 800;
    var DEFAULT_AI_JPEG_QUALITY = 0.75;
    var selectedFileFallback = null;
    var thisScanCollapsed = true;
    /** Obal první knihy z aktuálního skenu – použije se při „Schválit a přidat do knihovny“. */
    var pendingScanCoverDataUrl = '';

    function escapeHtml(str) {
        if (str == null) return '';
        var div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function compressImageFileToJpegDataUrl(file, maxWidth, quality) {
        return new Promise(function (resolve, reject) {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                reject(new Error('Not an image.'));
                return;
            }
            var reader = new FileReader();
            reader.onerror = reject;
            reader.onload = function () {
                var dataUrl = reader.result;
                var img = new Image();
                img.onerror = function () { reject(new Error('Image load failed.')); };
                img.onload = function () {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    var mw = (typeof maxWidth === 'number' && maxWidth > 0) ? maxWidth : DEFAULT_STORE_MAX_WIDTH;
                    var targetW = w;
                    var targetH = h;
                    if (w > mw) {
                        var scale = mw / w;
                        targetW = mw;
                        targetH = Math.max(1, Math.round(h * scale));
                    }
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(targetW));
                    canvas.height = Math.max(1, Math.round(targetH));
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    try {
                        var q = (typeof quality === 'number') ? quality : DEFAULT_STORE_QUALITY;
                        var out = canvas.toDataURL('image/jpeg', q);
                        resolve(out);
                    } catch (e) {
                        // Fallback: nikdy nevracej původní (může být obří). Zkus bez quality, jinak vrať prázdné.
                        try {
                            resolve(canvas.toDataURL('image/jpeg'));
                        } catch (e2) {
                            resolve('');
                        }
                    }
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        });
    }

    function compressImageDataUrlToJpegDataUrl(dataUrl, maxWidth, quality) {
        return new Promise(function (resolve, reject) {
            if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:image') !== 0) {
                reject(new Error('Not an image data URL.'));
                return;
            }
            var img = new Image();
            img.onerror = function () { reject(new Error('Image load failed.')); };
            img.onload = function () {
                var w = img.naturalWidth || img.width;
                var h = img.naturalHeight || img.height;
                var mw = (typeof maxWidth === 'number' && maxWidth > 0) ? maxWidth : DEFAULT_STORE_MAX_WIDTH;
                var targetW = w;
                var targetH = h;
                if (w > mw) {
                    var scale = mw / w;
                    targetW = mw;
                    targetH = Math.max(1, Math.round(h * scale));
                }
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(targetW));
                canvas.height = Math.max(1, Math.round(targetH));
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                try {
                    var q = (typeof quality === 'number') ? quality : DEFAULT_STORE_QUALITY;
                    var out = canvas.toDataURL('image/jpeg', q);
                    resolve(out);
                } catch (e) {
                    try {
                        resolve(canvas.toDataURL('image/jpeg'));
                    } catch (e2) {
                        resolve('');
                    }
                }
            };
            img.src = dataUrl;
        });
    }

    /**
     * Pro AI requesty: vrací base64 bez prefixu. Resize max 800px, JPEG komprese
     * (quality 0.75) – neposílat raw data, šetřit tokeny.
     */
    function fileToBase64ForAi(file, maxWidth) {
        var mw = (typeof maxWidth === 'number' && maxWidth > 0) ? maxWidth : DEFAULT_AI_MAX_WIDTH;
        var q = DEFAULT_AI_JPEG_QUALITY;
        // DŮLEŽITÉ: OpenAI nepodporuje HEIC/HEIF → vždy převádíme do JPEG.
        return compressImageFileToJpegDataUrl(file, mw, q).then(function (jpegDataUrl) {
            if (!jpegDataUrl || typeof jpegDataUrl !== 'string') throw new Error('jpeg_convert_failed');
            if (jpegDataUrl.indexOf('data:image/jpeg') !== 0) throw new Error('jpeg_convert_failed');
            var idx = jpegDataUrl.indexOf(',');
            var b64 = (idx >= 0) ? jpegDataUrl.slice(idx + 1) : '';
            if (!b64) throw new Error('jpeg_convert_failed');
            return b64;
        });
    }

    /**
     * Uloží obálku do book.image s povinnou kompresí.
     * Při Quota fail zkouší agresivnější kompresi.
     *
     * @param {Object} cfg
     * @param {File} cfg.file
     * @param {Object} cfg.book
     * @param {Function} cfg.saveToStorage - musí vracet boolean (true=uloženo)
     * @param {Function} [cfg.onPreview] - (dataUrl)=>void
     * @param {Function} [cfg.onSuccess] - ()=>void
     * @param {Function} [cfg.onFail] - (err)=>void
     * @param {Function} [cfg.onNotice] - (kind)=>void  kind: slimming|trimMore|storageFull
     */
    function storeCompressedCoverWithRetry(cfg) {
        if (!cfg || !cfg.file || !cfg.book || typeof cfg.saveToStorage !== 'function') return;
        var file = cfg.file;
        var book = cfg.book;
        var attempts = [
            { w: DEFAULT_STORE_MAX_WIDTH, q: DEFAULT_STORE_QUALITY },
            { w: 240, q: 0.55 },
            { w: 200, q: 0.5 },
            { w: 160, q: 0.45 }
        ];

        function tryAttempt(i) {
            if (i >= attempts.length) {
                if (typeof cfg.onNotice === 'function') cfg.onNotice('storageFull');
                if (typeof cfg.onFail === 'function') cfg.onFail(new Error('QuotaExceededError: storage full'));
                return;
            }
            compressImageFileToJpegDataUrl(file, attempts[i].w, attempts[i].q).then(function (dataUrl) {
                book.image = dataUrl;
                var ok = cfg.saveToStorage(book);
                var len = (book.image || '').length;
                console.log('OmniShelf: book.image délka po uložení = ' + len + ' (w=' + attempts[i].w + ', q=' + attempts[i].q + ')' + (len === 0 ? ' (CHYBA – obrázek se neuložil)' : ''));
                if (typeof cfg.onPreview === 'function') cfg.onPreview(dataUrl);

                if (ok) {
                    if (typeof cfg.onNotice === 'function') cfg.onNotice('slimming');
                    if (typeof cfg.onSuccess === 'function') cfg.onSuccess();
                    return;
                }
                // saveLibrary() nastavuje window.__OMNI_lastSaveWasQuota
                if (global && global.__OMNI_lastSaveWasQuota) {
                    console.warn('Paměť plná, zmenšuji víc...');
                    if (typeof cfg.onNotice === 'function') cfg.onNotice('trimMore');
                    tryAttempt(i + 1);
                    return;
                }
                if (typeof cfg.onFail === 'function') cfg.onFail(global && global.__OMNI_lastSaveError ? global.__OMNI_lastSaveError : new Error('Save failed'));
            }).catch(function (e) {
                console.warn('OmniShelf: Komprese obrázku selhala', e);
                if (typeof cfg.onFail === 'function') cfg.onFail(e);
            });
        }

        tryAttempt(0);
    }

    /** Internal helper: obtain selected file from OMNI_UploadModule or fallback. */
    function getSelectedFile() {
        if (global && global.OMNI_UploadModule && typeof global.OMNI_UploadModule.getSelectedFile === 'function') {
            return global.OMNI_UploadModule.getSelectedFile();
        }
        return selectedFileFallback;
    }

    function clearSelectedFile() {
        if (global && global.OMNI_UploadModule && typeof global.OMNI_UploadModule.clearSelectedFile === 'function') {
            global.OMNI_UploadModule.clearSelectedFile();
        }
        selectedFileFallback = null;
    }

    /**
     * Scanning flow: UI pro výsledky skenu (editace title/author/isbn) – zapisuje do ctx.setCurrentBooks()
     * a udržuje scanHistory skrz ctx.getScanHistory().
     */
    function recomputeDuplicateInScan(list) {
        if (!list || !list.length) return;
        var keyCount = {};
        list.forEach(function (b) {
            var k = ((b.title || '').trim().toLowerCase() + '|' + (b.author || '').trim().toLowerCase());
            if (!k || k === '|') return;
            keyCount[k] = (keyCount[k] || 0) + 1;
        });
        list.forEach(function (b) {
            var k = ((b.title || '').trim().toLowerCase() + '|' + (b.author || '').trim().toLowerCase());
            b._duplicateInScan = !!(k && k !== '|' && keyCount[k] > 1);
        });
    }

    function renderResultsTable(ctx, resultsBody, shelfNameInput, t) {
        if (!resultsBody || !ctx) return;
        var tr = t || function (x) { return x; };
        var currentBooks = ctx.getCurrentBooks ? (ctx.getCurrentBooks() || []) : [];
        recomputeDuplicateInScan(currentBooks);
        var hintEl = document.getElementById('thisScanHint');
        if (hintEl) {
            if (currentBooks.length === 0) {
                hintEl.style.display = 'none';
            } else {
                hintEl.textContent = 'Rozpoznáno ' + currentBooks.length + ' knih. Na fotce vidíte víc? Zkuste ostřejší snímek s čitelnými hřbety.';
                hintEl.style.display = 'block';
            }
        }
        resultsBody.innerHTML = '';
        if (currentBooks.length === 0) {
            resultsBody.innerHTML = '<div style="grid-column:1/-1;color:var(--text-muted);text-align:center;padding:32px;">Žádné knihy nebyly rozpoznány.</div>';
            return;
        }
        currentBooks.forEach(function (book, index) {
            var card = document.createElement('div');
            card.className = 'item-card' + (book._duplicateShelf ? ' item-card--duplicate' : '') + (book._duplicateInScan ? ' item-card--duplicate-in-scan' : '');
            var titleEl = document.createElement('div');
            titleEl.className = 'editable-cell item-card-title';
            titleEl.contentEditable = true;
            titleEl.textContent = book.title || '';
            titleEl.addEventListener('blur', function () {
                var list = ctx.getCurrentBooks();
                if (!list || !list[index]) return;
                list[index].title = titleEl.textContent.trim();
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });
            var metaEl = document.createElement('div');
            metaEl.className = 'editable-cell item-card-meta';
            metaEl.contentEditable = true;
            metaEl.textContent = book.author || '';
            metaEl.addEventListener('blur', function () {
                var list = ctx.getCurrentBooks();
                if (!list || !list[index]) return;
                list[index].author = metaEl.textContent.trim();
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });
            var isbnInput = document.createElement('input');
            isbnInput.type = 'text';
            isbnInput.placeholder = 'ISBN/EAN';
            isbnInput.value = book.isbn || '';
            isbnInput.style.cssText = 'font-size:0.7rem;padding:2px 6px;width:120px;margin-top:4px;border:1px solid var(--border);border-radius:4px;';
            isbnInput.addEventListener('blur', function () {
                var list = ctx.getCurrentBooks();
                if (!list || !list[index]) return;
                list[index].isbn = (isbnInput.value || '').trim().replace(/\s/g, '');
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });

            var posInput = document.createElement('input');
            posInput.type = 'text';
            posInput.placeholder = 'Umístění v polici';
            posInput.value = book.position || '';
            posInput.style.cssText = 'font-size:0.7rem;padding:2px 6px;width:140px;margin-top:4px;border:1px solid var(--border);border-radius:4px;';
            posInput.addEventListener('blur', function () {
                var list = ctx.getCurrentBooks();
                if (!list || !list[index]) return;
                list[index].position = (posInput.value || '').trim();
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });

            var colInput = document.createElement('input');
            colInput.type = 'text';
            colInput.placeholder = 'Kolekce';
            colInput.value = book.collection || '';
            colInput.style.cssText = 'font-size:0.7rem;padding:2px 6px;width:140px;margin-top:4px;border:1px solid var(--border);border-radius:4px;';
            colInput.addEventListener('blur', function () {
                var list = ctx.getCurrentBooks();
                if (!list || !list[index]) return;
                list[index].collection = (colInput.value || '').trim();
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });
            if (book._duplicateShelf) {
                var dupLabel = document.createElement('span');
                dupLabel.className = 'item-card-duplicate-label';
                dupLabel.textContent = 'Už v knihovně – chceš ji tam mít dvakrát? Pokud ne, smaž (koš).';
                card.appendChild(dupLabel);
            }
            if (book._duplicateInScan) {
                var dupScanLabel = document.createElement('span');
                dupScanLabel.className = 'item-card-duplicate-in-scan-label';
                dupScanLabel.textContent = 'Stejná kniha v tomto skenu (duplicita – zkontrolujte detekci).';
                card.appendChild(dupScanLabel);
            }
            var actions = document.createElement('div');
            actions.className = 'item-card-actions';
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'item-card-delete';
            deleteBtn.setAttribute('aria-label', 'Smazat ze seznamu – kniha nebude přidána do knihovny');
            deleteBtn.title = 'Odstranit ze seznamu (natrvalo – nebude přidána)';
            deleteBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 3.5h5M3.5 5.5v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8M6.5 5.5v6M9.5 5.5v6"/></svg>';
            deleteBtn.addEventListener('click', function () {
                var list = ctx.getCurrentBooks();
                if (!list) return;
                list.splice(index, 1);
                renderResultsTable(ctx, resultsBody, shelfNameInput, tr);
            });
            actions.appendChild(deleteBtn);
            card.appendChild(titleEl);
            card.appendChild(metaEl);
            card.appendChild(isbnInput);
            card.appendChild(posInput);
            card.appendChild(colInput);
            card.appendChild(actions);
            resultsBody.appendChild(card);
        });
    }

    function updateScanHistory(ctx, emptyState, scanHistoryGrid, shelfNameInput) {
        if (!ctx || !ctx.getScanHistory || !ctx.getCurrentBooks) return;
        var currentBooks = ctx.getCurrentBooks() || [];
        var filtered = currentBooks.filter(function (b) { return (b.title || '').trim() || (b.author || '').trim(); });
        var history = ctx.getScanHistory() || [];
        if (history.length > 0 && filtered.length > 0) {
            history[history.length - 1].books = filtered.map(function (b) {
                return {
                    title: (b.title || '').trim() || 'Unknown',
                    author: (b.author || '').trim() || 'Unknown',
                    location: (b.location || '').trim(),
                    position: (b.position || '').trim(),
                    collection: (b.collection || '').trim(),
                    isbn: (b.isbn || '').trim()
                };
            });
            if (ctx.renderScanHistory && emptyState && scanHistoryGrid) ctx.renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        }
        if (ctx.saveLibrary) ctx.saveLibrary();
    }

    function getBatchMeta() {
        var pos = '';
        var col = '';
        try {
            var posEl = document.getElementById('batchShelfPosition');
            var colEl = document.getElementById('batchCollection');
            pos = posEl ? String(posEl.value || '').trim() : '';
            col = colEl ? String(colEl.value || '').trim() : '';
        } catch (e) {}
        return { position: pos, collection: col };
    }

    function addToScanHistory(ctx, shelfNameInput, emptyState, scanHistoryGrid, firstBookCoverDataUrl) {
        if (!ctx || !ctx.getCurrentBooks || !ctx.getScanHistory || !ctx.getCurrentLibraryView) return;
        var currentBooks = ctx.getCurrentBooks() || [];
        var filtered = currentBooks.filter(function (b) { return (b.title || '').trim() || (b.author || '').trim(); });
        if (filtered.length === 0) return;
        var currentView = ctx.getCurrentLibraryView();
        var meta = getBatchMeta();
        var newBooks = filtered.map(function (b) {
            return {
                title: (b.title || '').trim() || 'Unknown',
                author: (b.author || '').trim() || 'Unknown',
                location: (b.location || '').trim(),
                position: ((b.position || '').trim() || meta.position),
                collection: ((b.collection || '').trim() || meta.collection),
                isbn: (b.isbn || '').trim(),
                genre: (b.genre || '').trim()
            };
        });
        var history = ctx.getScanHistory();
        history.push({ date: new Date().toISOString(), books: newBooks });
        var familyProfiles = ctx.getFamilyProfiles ? (ctx.getFamilyProfiles() || []) : [];
        var defOwner = (familyProfiles[0] && familyProfiles[0].name) ? familyProfiles[0].name : 'Já';
        var loc0 = (shelfNameInput && shelfNameInput.value) ? shelfNameInput.value.trim() : '';
        var firstCover = (typeof firstBookCoverDataUrl === 'string' && firstBookCoverDataUrl.trim()) ? firstBookCoverDataUrl.trim() : '';

        var lib = ctx.getLibrary ? ctx.getLibrary() : null;
        if (!lib) return;

        newBooks.forEach(function (b, idx) {
            var loc = (b.location || loc0 || '— Bez poličky —').trim() || '— Bez poličky —';
            if (currentView === 'borrowedByMe') loc = 'Půjčená literatura';
            var coverValue = (idx === 0 && firstCover) ? (firstCover.indexOf('data:image') === 0 ? firstCover : (firstCover.indexOf('data:') === 0 ? firstCover : 'data:image/jpeg;base64,' + firstCover)) : '';
            var newBook = {
                id: (ctx.generateBookId ? ctx.generateBookId() : ('book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9))),
                title: b.title,
                author: b.author,
                genre: b.genre || '',
                location: loc,
                physicalLocation: loc,
                virtualSort: [],
                position: b.position || '',
                collection: b.collection || '',
                originalLocation: loc,
                addedAt: new Date().toISOString(),
                borrowedBy: '',
                owner: defOwner,
                estimatedValue: '',
                isbn: (b.isbn || '').trim(),
                category: ctx.getCurrentSectorId ? ctx.getCurrentSectorId() : '',
                image: coverValue,
                isFavorite: false
            };
            if (currentView === 'borrowedByMe') {
                newBook.ownershipStatus = 'borrowedByMe';
                newBook.readingStatus = 'unread';
            } else if (currentView === 'borrowed') {
                newBook.ownershipStatus = 'borrowed';
            } else if (currentView === 'wishlist') {
                newBook.ownershipStatus = 'wishlist';
            } else if (currentView === 'currentlyReading') {
                newBook.ownershipStatus = 'mine';
                newBook.readingStatus = 'reading';
            } else if (currentView === 'forSale') {
                newBook.ownershipStatus = 'forsale';
            } else {
                newBook.ownershipStatus = 'mine';
            }
            if (ctx.migrateBookToNewFields) ctx.migrateBookToNewFields(newBook);
            lib.push(newBook);
        });

        if (ctx.renderScanHistory) ctx.renderScanHistory(emptyState, scanHistoryGrid, shelfNameInput);
        if (ctx.saveToStorage) ctx.saveToStorage();
    }

    /**
     * Vymaže pracovní plochu „Tento sken“ – bez přidání do knihovny.
     */
    function clearWorkspace(ctx, resultsBody, resultsSectionWrap) {
        if (ctx && ctx.setCurrentBooks) ctx.setCurrentBooks([]);
        pendingScanCoverDataUrl = '';
        if (resultsBody) {
            resultsBody.innerHTML = '<div style="grid-column:1/-1;color:var(--text-muted);text-align:center;padding:32px;">Žádné knihy nebyly rozpoznány.</div>';
        }
        if (resultsSectionWrap) resultsSectionWrap.style.display = 'none';
        thisScanCollapsed = true;
    }

    /**
     * Schválí položky z pracovní plochy a přidá je do knihovny; pak pracovní plochu vymaže.
     * Pokud jsou v seznamu duplicity, zobrazí varování: už v knihovně – chceš tam mít dvakrát?
     */
    function approveAndAddToLibrary(ctx, shelfNameInput, emptyState, scanHistoryGrid, resultsBody, resultsSectionWrap, successMessage) {
        if (!ctx || !ctx.getCurrentBooks) return;
        var currentBooks = ctx.getCurrentBooks() || [];
        var filtered = currentBooks.filter(function (b) { return (b.title || '').trim() || (b.author || '').trim(); });
        if (filtered.length === 0) {
            if (ctx.showError) ctx.showError('Na pracovní ploše nejsou žádné knihy k přidání.', document.getElementById('errorMessage'));
            return;
        }
        var duplicates = filtered.filter(function (b) { return b._duplicateShelf; });
        if (duplicates.length > 0) {
            var msg = duplicates.length === 1
                ? 'Tato kniha je už v knihovně. Chcete ji tam mít dvakrát? Pokud ne, nejdřív ji ze seznamu odstraňte (ikona koše).'
                : 'Tyto ' + duplicates.length + ' knihy jsou už v knihovně. Chcete je tam mít duplicitně? Pokud ne, nejdřív je ze seznamu odstraňte (ikona koše).';
            if (!global.confirm(msg + '\n\nPřidat i tak do knihovny?')) return;
        }
        addToScanHistory(ctx, shelfNameInput, emptyState, scanHistoryGrid, pendingScanCoverDataUrl);
        pendingScanCoverDataUrl = '';
        if (ctx.setCurrentBooks) ctx.setCurrentBooks([]);
        if (resultsBody) {
            resultsBody.innerHTML = '<div style="grid-column:1/-1;color:var(--text-muted);text-align:center;padding:32px;">Žádné knihy nebyly rozpoznány.</div>';
        }
        if (resultsSectionWrap) resultsSectionWrap.style.display = 'none';
        thisScanCollapsed = true;
        if (ctx.refreshGrid) ctx.refreshGrid();
        setTimeout(function () { if (ctx.refreshGrid) ctx.refreshGrid(); }, 0);
        if (ctx.showSuccess && successMessage) ctx.showSuccess('Knihy byly přidány do knihovny.', successMessage);
    }

    function displayResults(ctx, books, resultsSection, shelfNameInput, emptyState, scanHistoryGrid) {
        if (!ctx || !ctx.setCurrentBooks || !ctx.findLibraryMatch) return;
        var shelf = (shelfNameInput && shelfNameInput.value) ? shelfNameInput.value.trim() : '';
        var meta = getBatchMeta();
        var mapped = (books || []).map(function (b) {
            var match = ctx.findLibraryMatch(b);
            var loc = match ? (match.location || '').trim() : null;
            var isbn = (b.isbn || '').trim().replace(/\D/g, '');
            return { title: b.title || '', author: b.author || '', location: shelf, position: meta.position || '', collection: meta.collection || '', isbn: isbn || '', _duplicateShelf: loc || undefined };
        });
        ctx.setCurrentBooks(mapped);
        var resultsBody = document.getElementById('resultsBody');
        if (resultsBody) renderResultsTable(ctx, resultsBody, shelfNameInput);
        if (resultsSection) {
            resultsSection.classList.add('show');
            resultsSection.classList.remove('collapsed');
        }
        thisScanCollapsed = false;
    }

    function runAnalysis(ctx, uploadRefs, resultsSection, shelfNameInput, emptyState, scanHistoryGrid) {
        if (!ctx || !uploadRefs) return;
        var analyzeButton = uploadRefs.analyzeButton;
        var errorMessage = uploadRefs.errorMessage;
        var successMessage = uploadRefs.successMessage;
        var loadingOverlay = document.getElementById('loadingOverlay');
        var loadingBar = document.getElementById('analyzeLoadingBar');
        var file = getSelectedFile();

        var openaiKey = ctx.getOpenAiKey ? ctx.getOpenAiKey() : '';
        if (!openaiKey || (openaiKey.trim && !openaiKey.trim())) {
            if (ctx.showError) ctx.showError('Chybí OpenAI API klíč. Použijte process.env.OPENAI_API_KEY, nebo nastavte v „Nastavení“, případně lokálně v config.js (necommitovat).', errorMessage);
            return;
        }
        if (!file) {
            if (ctx.showError) ctx.showError('Nejprve vyberte obrázek.', errorMessage);
            return;
        }
        if (ctx.hideMessages) ctx.hideMessages(errorMessage, successMessage);
        if (global.OMNI_UploadModule && global.OMNI_UploadModule.setLoading) global.OMNI_UploadModule.setLoading(analyzeButton, true);
        else if (analyzeButton) { analyzeButton.disabled = true; analyzeButton.classList.add('loading'); }
        if (loadingOverlay) loadingOverlay.classList.add('show');
        if (loadingBar) loadingBar.classList.add('show');
        if (resultsSection) resultsSection.classList.remove('show');

        if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanStart');

        var view = ctx.getCurrentLibraryView ? ctx.getCurrentLibraryView() : 'collection';
        var basePrompt = (view === 'wishlist') ? (ctx.getWishlistPrompt ? ctx.getWishlistPrompt() : '') : (ctx.getAnalyzePrompt ? ctx.getAnalyzePrompt() : '');
        // Šetření tokenů: neanalyzovat znovu knihy už v knihovně – předat krátký seznam
        var existingTitles = [];
        if (ctx.getLibrary && view !== 'wishlist') {
            var lib = ctx.getLibrary() || [];
            existingTitles = lib.slice(0, 80).map(function (b) {
                var t = (b.title || '').trim();
                var a = (b.author || '').trim();
                return t ? (t + (a ? ' | ' + a : '')) : '';
            }).filter(Boolean);
        }
        var prompt = basePrompt;
        if (existingTitles.length > 0) {
            prompt = basePrompt + '\n\nAlready in library (do NOT include in output): ' + JSON.stringify(existingTitles.slice(0, 40)) + '. Return only NEW books.';
        }

        fileToBase64ForAi(file, DEFAULT_AI_MAX_WIDTH).then(function (base64Image) {
            // Obrázek je vždy JPEG (komprese v fileToBase64ForAi) – nepoužívat file.type.
            var imageUrl = 'data:image/jpeg;base64,' + base64Image;
            return fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageUrl } }
                        ]
                    }],
                    max_tokens: 1500
                })
            });
        }).then(function (response) {
            if (!response.ok) return response.json().then(function (err) { throw new Error(err.error && err.error.message || response.statusText); });
            return response.json();
        }).then(function (data) {
            var raw = (data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '';
            raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
            var parsed = { books: [] };
            try { parsed = JSON.parse(raw); } catch (_) {}
            var books = Array.isArray(parsed.books) ? parsed.books : [];
            if (view === 'wishlist') {
                var first = books[0];
                if (first && (first.title || first.author)) {
                    compressImageFileToJpegDataUrl(file, DEFAULT_STORE_MAX_WIDTH, DEFAULT_STORE_QUALITY).then(function (coverDataUrl) {
                        var wl = ctx.getWishlist ? ctx.getWishlist() : null;
                        if (wl) wl.push({ title: (first.title || '').trim() || 'Bez názvu', author: (first.author || '').trim() || '', isbn: (first.isbn || '').trim() || '', image: coverDataUrl, reservedBy: '' });
                        if (ctx.saveToStorage) ctx.saveToStorage();
                        if (ctx.refreshGrid) ctx.refreshGrid();
                        if (ctx.showSuccess) ctx.showSuccess('Přidáno do wishlistu.', successMessage);
                        if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanDone');
                    }).catch(function () {
                        var wl2 = ctx.getWishlist ? ctx.getWishlist() : null;
                        if (wl2) wl2.push({ title: (first.title || '').trim() || 'Bez názvu', author: (first.author || '').trim() || '', isbn: (first.isbn || '').trim() || '', image: '', reservedBy: '' });
                        if (ctx.saveToStorage) ctx.saveToStorage();
                        if (ctx.refreshGrid) ctx.refreshGrid();
                        if (ctx.showSuccess) ctx.showSuccess('Přidáno do wishlistu.', successMessage);
                        if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanDone');
                    });
                } else if (books.length > 0) {
                    var wl3 = ctx.getWishlist ? ctx.getWishlist() : null;
                    if (wl3) wl3.push({ title: (books[0].title || '').trim() || 'Bez názvu', author: (books[0].author || '').trim() || '', isbn: '', image: '', reservedBy: '' });
                    if (ctx.saveToStorage) ctx.saveToStorage();
                    if (ctx.refreshGrid) ctx.refreshGrid();
                    if (ctx.showSuccess) ctx.showSuccess('Přidáno do wishlistu.', successMessage);
                    if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanDone');
                } else {
                    if (ctx.showError) ctx.showError('Z obálky se nepodařilo přečíst název ani autora. Zkus jinou fotku.', errorMessage);
                }
            } else {
                displayResults(ctx, books, resultsSection, shelfNameInput, emptyState, scanHistoryGrid);
                pendingScanCoverDataUrl = '';
                compressImageFileToJpegDataUrl(file, DEFAULT_STORE_MAX_WIDTH, DEFAULT_STORE_QUALITY).then(function (coverDataUrl) {
                    pendingScanCoverDataUrl = coverDataUrl || '';
                }).catch(function () {
                    pendingScanCoverDataUrl = '';
                });
                if (resultsSection) {
                    resultsSection.classList.remove('collapsed');
                    resultsSection.classList.add('show');
                }
                thisScanCollapsed = false;
                if (ctx.showSuccess) ctx.showSuccess('Sken dokončen. Zkontrolujte seznam níže (duplicity červeně), odstraňte je a klikněte na „Schválit a přidat do knihovny“.', successMessage);
                var wrap = document.getElementById('resultsSectionWrap');
                if (wrap) {
                    wrap.style.display = 'block';
                    setTimeout(function () { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 300);
                }
                if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanDone');
            }
            if (successMessage) {
                successMessage.classList.add('upload-success-flash');
                setTimeout(function () { successMessage.classList.remove('upload-success-flash'); }, 1500);
            }
            var scanSection = document.getElementById('scanHistorySection');
            if (scanSection) scanSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            clearSelectedFile();
        }).catch(function (err) {
            console.error(err);
            var msg = String((err && err.message) ? err.message : err);
            if (msg.indexOf('jpeg_convert_failed') >= 0) {
                if (ctx.showError) ctx.showError('Nepodporovaný formát fotky (často HEIC). Zkuste fotku převést na JPG/PNG nebo v iPhonu zapnout Nastavení → Fotoaparát → Formáty → Nejvíce kompatibilní (JPEG).', errorMessage);
            } else {
                if (ctx.showError) ctx.showError('Analýza selhala: ' + (err.message || 'neznámá chyba'), errorMessage);
            }
            if (typeof global.setAiAssistantError === 'function') global.setAiAssistantError(err);
        }).then(function () {
            if (global.OMNI_UploadModule && global.OMNI_UploadModule.setLoading) global.OMNI_UploadModule.setLoading(analyzeButton, false);
            else if (analyzeButton) { analyzeButton.disabled = false; analyzeButton.classList.remove('loading'); }
            if (loadingOverlay) loadingOverlay.classList.remove('show');
            if (loadingBar) loadingBar.classList.remove('show');
        });
    }

    /**
     * Detailní sken jedné knihy: více fotek (obálka + ISBN) -> jedna kniha do knihovny.
     * files: File[]
     */
    function runDetailedOneBookAnalysis(ctx, files, uiRefs, shelfNameInput, emptyState, scanHistoryGrid) {
        if (!ctx || !Array.isArray(files) || files.length === 0) return;
        var analyzeButton = uiRefs && uiRefs.analyzeButton;
        var errorMessage = uiRefs && uiRefs.errorMessage;
        var successMessage = uiRefs && uiRefs.successMessage;
        var loadingBar = uiRefs && uiRefs.loadingBar;

        var openaiKey = ctx.getOpenAiKey ? ctx.getOpenAiKey() : '';
        var geminiKey = ctx.getGeminiKey ? ctx.getGeminiKey() : '';
        if ((!openaiKey || (openaiKey.trim && !openaiKey.trim())) && (!geminiKey || (geminiKey.trim && !geminiKey.trim()))) {
            if (ctx.showError) ctx.showError('Chybí AI klíč. Nastav v „Nastavení“ OpenAI API klíč nebo Gemini API klíč.', errorMessage);
            return;
        }
        if (ctx.hideMessages) ctx.hideMessages(errorMessage, successMessage);
        if (analyzeButton) { analyzeButton.disabled = true; analyzeButton.classList.add('loading'); }
        if (loadingBar) { loadingBar.classList.add('show'); loadingBar.setAttribute('aria-hidden', 'false'); }
        if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanStart');

        var view = ctx.getCurrentLibraryView ? ctx.getCurrentLibraryView() : 'collection';
        var prompt = ctx.getOneBookPrompt ? ctx.getOneBookPrompt() : '';

        function extractBooksFromJsonText(raw) {
            raw = String(raw || '').trim();
            raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
            var parsed = { books: [] };
            try { parsed = JSON.parse(raw); } catch (_) {}
            return Array.isArray(parsed.books) ? parsed.books : [];
        }

        function geminiGenerateBooksMulti(base64List) {
            var schema = {
                type: 'object',
                properties: {
                    books: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { title: { type: 'string' }, author: { type: 'string' }, isbn: { type: 'string' } },
                            required: ['title', 'author'],
                            additionalProperties: true
                        }
                    }
                },
                required: ['books'],
                additionalProperties: false
            };
            var model = (global.OMNI_CONFIG && global.OMNI_CONFIG.geminiModel) ? String(global.OMNI_CONFIG.geminiModel) : 'gemini-3-flash-preview';
            var parts = [{ text: prompt }];
            (base64List || []).forEach(function (b64) {
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
            });
            return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(geminiKey || '') },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: parts }],
                    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema }
                })
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (e) { throw new Error((e && e.error && e.error.message) ? e.error.message : r.statusText); });
                return r.json();
            }).then(function (data) {
                var txt = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0])
                    ? (data.candidates[0].content.parts[0].text || '')
                    : '';
                return txt;
            });
        }

        // Připrav více fotek v jednom requestu (vždy JPEG base64)
        Promise.all(files.slice(0, 3).map(function (f) { return fileToBase64ForAi(f, DEFAULT_AI_MAX_WIDTH); })).then(function (base64List) {
            if (openaiKey && (openaiKey.trim ? openaiKey.trim() : openaiKey)) {
                var content = [{ type: 'text', text: prompt }];
                base64List.forEach(function (b64) {
                    content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } });
                });
                return fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
                    body: JSON.stringify({
                        model: 'gpt-4o',
                        messages: [{ role: 'user', content: content }],
                        max_tokens: 1200
                    })
                }).then(function (response) {
                    if (!response.ok) return response.json().then(function (err) { throw new Error(err.error && err.error.message || response.statusText); });
                    return response.json();
                }).then(function (data) {
                    return (data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content.trim() : '';
                });
            }
            return geminiGenerateBooksMulti(base64List);
        }).then(function (raw) {
            var books = extractBooksFromJsonText(raw);
            var first = books[0];
            if (!first || !(first.title || first.author || first.isbn)) {
                if (ctx.showError) ctx.showError('Z detailních fotek se nepodařilo jistě přečíst název/autora/ISBN. Zkus prosím ostřejší fotku obálky a zvlášť ISBN.', errorMessage);
                return;
            }

            // Vytvoř knihu (image nastavíme až po kompresi + quota-safe uložení)
            var lib = ctx.getLibrary ? ctx.getLibrary() : null;
            if (!lib) throw new Error('Library not available');
            var loc0 = (shelfNameInput && shelfNameInput.value) ? shelfNameInput.value.trim() : '';
            var loc = (loc0 || '— Bez poličky —').trim() || '— Bez poličky —';
            if (view === 'borrowedByMe') loc = 'Půjčená literatura';
            var meta = getBatchMeta();
            var newBook = {
                id: (ctx.generateBookId ? ctx.generateBookId() : ('book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9))),
                title: (first.title || '').trim() || '—',
                author: (first.author || '').trim() || '',
                isbn: (String(first.isbn || '')).trim().replace(/\\D/g, ''),
                genre: '',
                location: loc,
                physicalLocation: loc,
                virtualSort: [],
                position: meta.position || '',
                collection: meta.collection || '',
                originalLocation: loc,
                addedAt: new Date().toISOString(),
                borrowedBy: '',
                owner: '',
                estimatedValue: '',
                category: ctx.getCurrentSectorId ? ctx.getCurrentSectorId() : '',
                image: '',
                isFavorite: false
            };
            if (view === 'borrowedByMe') {
                newBook.ownershipStatus = 'borrowedByMe';
                newBook.readingStatus = 'unread';
            } else if (view === 'borrowed') {
                newBook.ownershipStatus = 'borrowed';
            } else if (view === 'wishlist') {
                newBook.ownershipStatus = 'wishlist';
            } else if (view === 'currentlyReading') {
                newBook.ownershipStatus = 'mine';
                newBook.readingStatus = 'reading';
            } else if (view === 'forSale') {
                newBook.ownershipStatus = 'forsale';
            } else {
                newBook.ownershipStatus = 'mine';
            }
            if (ctx.migrateBookToNewFields) ctx.migrateBookToNewFields(newBook);
            lib.push(newBook);

            // Quota-safe: opakuj kompresi + uložení při QuotaExceededError
            var attempts = [
                { w: DEFAULT_STORE_MAX_WIDTH, q: DEFAULT_STORE_QUALITY },
                { w: 240, q: 0.55 },
                { w: 200, q: 0.5 },
                { w: 160, q: 0.45 }
            ];
            function trySave(i) {
                if (i >= attempts.length) {
                    // rollback: nenechávej knihu jen v paměti bez persistence
                    var idx = lib.indexOf(newBook);
                    if (idx >= 0) lib.splice(idx, 1);
                    if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('storageFull');
                    throw new Error('QuotaExceededError: storage full');
                }
                return compressImageFileToJpegDataUrl(files[0], attempts[i].w, attempts[i].q).then(function (coverDataUrl) {
                    newBook.image = coverDataUrl || '';
                    var ok = true;
                    if (typeof ctx.saveToStorage === 'function') ok = ctx.saveToStorage(newBook);
                    if (ok) return true;
                    if (global && global.__OMNI_lastSaveWasQuota) {
                        console.warn('Paměť plná, zmenšuji víc...');
                        if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('trimMore');
                        return trySave(i + 1);
                    }
                    throw (global && global.__OMNI_lastSaveError) ? global.__OMNI_lastSaveError : new Error('Save failed');
                });
            }

            return trySave(0).then(function () {
                if (ctx.refreshGrid) ctx.refreshGrid();
                setTimeout(function () { if (ctx.refreshGrid) ctx.refreshGrid(); }, 0);
                if (ctx.showSuccess) ctx.showSuccess('Hotovo. Detailní sken přidal 1 knihu.', successMessage);
                if (typeof global.setAiAssistantNotice === 'function') global.setAiAssistantNotice('scanDone');
            });
        }).catch(function (err) {
            console.error(err);
            var msg = String((err && err.message) ? err.message : err);
            if (msg.indexOf('jpeg_convert_failed') >= 0) {
                if (ctx.showError) ctx.showError('Nepodporovaný formát fotky (často HEIC). Zkuste fotky převést na JPG/PNG nebo v iPhonu zapnout Nastavení → Fotoaparát → Formáty → Nejvíce kompatibilní (JPEG).', errorMessage);
            } else {
                if (ctx.showError) ctx.showError('Detailní sken selhal: ' + (err.message || 'neznámá chyba'), errorMessage);
            }
            if (typeof global.setAiAssistantError === 'function') global.setAiAssistantError(err);
        }).then(function () {
            if (analyzeButton) { analyzeButton.disabled = false; analyzeButton.classList.remove('loading'); }
            if (loadingBar) { loadingBar.classList.remove('show'); loadingBar.setAttribute('aria-hidden', 'true'); }
        });
    }

    function handleFileSelectFallback(ctx, file, uploadRefs) {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            if (ctx && ctx.showError) ctx.showError('Vyberte prosím obrázek.', uploadRefs && uploadRefs.errorMessage);
            return;
        }
        selectedFileFallback = file;
        if (ctx && ctx.hideMessages) ctx.hideMessages(uploadRefs.errorMessage, uploadRefs.successMessage);
        var fileSize = (file.size / 1024 / 1024).toFixed(2);
        if (uploadRefs && uploadRefs.fileInfo) uploadRefs.fileInfo.innerHTML = 'Vybráno: <strong>' + escapeHtml(file.name) + '</strong> · ' + fileSize + ' MB';
        if (uploadRefs && uploadRefs.imagePreview) {
            // Úsporný náhled: miniatura (max 200px), JPEG, aby panel byl lehký
            compressImageFileToJpegDataUrl(file, 200, 0.6).then(function (dataUrl) {
                if (uploadRefs.imagePreview) {
                    uploadRefs.imagePreview.innerHTML = '<img src="' + (dataUrl || '').replace(/"/g, '&quot;') + '" alt="Náhled" class="image-preview image-preview-thumb" />';
                }
            }).catch(function () {
                var reader = new FileReader();
                reader.onload = function (e) {
                    if (uploadRefs.imagePreview) {
                        uploadRefs.imagePreview.innerHTML = '<img src="' + (e.target.result || '').replace(/"/g, '&quot;') + '" alt="Náhled" class="image-preview" />';
                    }
                };
                reader.readAsDataURL(file);
            });
        }
        if (uploadRefs && uploadRefs.analyzeButton) uploadRefs.analyzeButton.disabled = false;
    }

    global.OMNI_LibraryUploadLogic = {
        DEFAULT_STORE_MAX_WIDTH: DEFAULT_STORE_MAX_WIDTH,
        DEFAULT_STORE_QUALITY: DEFAULT_STORE_QUALITY,
        compressImageFileToJpegDataUrl: compressImageFileToJpegDataUrl,
        compressImageDataUrlToJpegDataUrl: compressImageDataUrlToJpegDataUrl,
        fileToBase64ForAi: fileToBase64ForAi,
        storeCompressedCoverWithRetry: storeCompressedCoverWithRetry,
        // Scanning flow (moved from library-logic.js)
        runAnalysis: runAnalysis,
        runDetailedOneBookAnalysis: runDetailedOneBookAnalysis,
        addToScanHistory: addToScanHistory,
        updateScanHistory: updateScanHistory,
        displayResults: displayResults,
        renderResultsTable: renderResultsTable,
        clearWorkspace: clearWorkspace,
        approveAndAddToLibrary: approveAndAddToLibrary,
        handleFileSelectFallback: handleFileSelectFallback,
        clearSelectedFileFallback: function () { selectedFileFallback = null; },
        getSelectedFileFallback: function () { return selectedFileFallback; }
    };
})(window);

