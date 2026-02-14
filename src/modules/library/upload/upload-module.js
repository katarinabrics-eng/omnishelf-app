/**
 * OmniShelf – modul Upload.
 * Robustní nahrávání a zobrazení souborů/fotek.
 * Připraveno pro vizuální mapy: místnosti, workshop, šatník, spíž (AI navigace v prostoru).
 *
 * Persistence: Host (library-logic.js) musí každou nově přidanou knihu včetně obálky (Base64)
 * okamžitě uložit do pole omnishelf_library v localStorage pod klíčem getUserStorageKey().
 * Tento modul volá onAnalyzeClick(); host převede nahraný soubor na Base64, přiřadí obálku
 * první přidané knize a podle aktuální sekce nastaví ownershipStatus: v "Mám vypůjčeno"
 * → borrowedByMe, ve "Wishlist" → wishlist (host detekuje view přes getCurrentLibraryView()).
 */
(function (global) {
    'use strict';

    var selectedFile = null;

    function escapeHtml(str) {
        if (str == null) return '';
        var div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function showError(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(function () { el.classList.remove('show'); }, 6000);
    }

    function hideMessages(errorEl, successEl) {
        if (errorEl) errorEl.classList.remove('show');
        if (successEl) successEl.classList.remove('show');
    }

    /**
     * Inicializuje upload oblast: klik, drag & drop, náhled, tlačítko Analyzovat.
     * Host při přidání knih z uploadu nastaví ownershipStatus dle aktuální sekce
     * (getCurrentView / getCurrentLibraryView): Mám vypůjčeno → borrowedByMe, Wishlist → wishlist.
     * @param {Object} refs - uploadArea, fileInput, imagePreview, fileInfo, analyzeButton, errorMessage, successMessage
     * @param {Object} callbacks - onFileSelect(file), onAnalyzeClick(), getCurrentView?() pro detekci sekce
     */
    function initUpload(refs, callbacks) {
        var uploadArea = refs.uploadArea;
        var fileInput = refs.fileInput;
        var imagePreview = refs.imagePreview;
        var fileInfo = refs.fileInfo;
        var analyzeButton = refs.analyzeButton;
        var errorMessage = refs.errorMessage;
        var successMessage = refs.successMessage;

        if (!uploadArea || !fileInput || !analyzeButton) return;

        function handleFile(file) {
            if (!file || !file.type.startsWith('image/')) {
                if (errorMessage) showError(errorMessage, 'Vyberte prosím obrázek.');
                return;
            }
            selectedFile = file;
            try { uploadArea.classList.add('has-file'); } catch (e0) {}
            hideMessages(errorMessage, successMessage);
            if (fileInfo) {
                var fileSize = (file.size / 1024 / 1024).toFixed(2);
                fileInfo.innerHTML = 'Vybráno: <strong>' + escapeHtml(file.name) + '</strong> · ' + fileSize + ' MB';
            }
            if (imagePreview) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    imagePreview.innerHTML = '<img src="' + e.target.result + '" alt="Náhled" class="image-preview image-preview--compact" />';
                };
                reader.readAsDataURL(file);
            }
            analyzeButton.disabled = false;
            try { analyzeButton.classList.add('is-active'); } catch (e1) {}
            if (typeof callbacks.onFileSelect === 'function') callbacks.onFileSelect(file);
        }

        uploadArea.addEventListener('click', function () { fileInput.click(); });
        uploadArea.addEventListener('dragover', function (e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', function () {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', function (e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });

        fileInput.addEventListener('change', function (e) {
            if (e.target.files && e.target.files.length) handleFile(e.target.files[0]);
        });

        analyzeButton.addEventListener('click', function () {
            if (typeof callbacks.onAnalyzeClick === 'function') callbacks.onAnalyzeClick();
        });
    }

    /**
     * Více souborů – pro budoucí vizuální mapy (několik fotek místnosti).
     * @param {Object} refs - uploadArea, fileInput (multiple), previewContainer
     * @param {Object} callbacks - onFilesSelect(files[])
     */
    function initMultiUpload(refs, callbacks) {
        var uploadArea = refs.uploadArea;
        var fileInput = refs.fileInput;
        if (!uploadArea || !fileInput) return;
        fileInput.setAttribute('multiple', 'multiple');
        uploadArea.addEventListener('click', function () { fileInput.click(); });
        uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', function () { uploadArea.classList.remove('dragover'); });
        uploadArea.addEventListener('drop', function (e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length && typeof callbacks.onFilesSelect === 'function') {
                callbacks.onFilesSelect(Array.prototype.slice.call(e.dataTransfer.files));
            }
        });
        fileInput.addEventListener('change', function (e) {
            if (e.target.files && e.target.files.length && typeof callbacks.onFilesSelect === 'function') {
                callbacks.onFilesSelect(Array.prototype.slice.call(e.target.files));
            }
        });
    }

    function getSelectedFile() {
        return selectedFile;
    }

    function clearSelectedFile() {
        selectedFile = null;
    }

    function setLoading(analyzeButton, loading) {
        if (!analyzeButton) return;
        analyzeButton.disabled = loading;
        if (loading) analyzeButton.classList.add('loading');
        else analyzeButton.classList.remove('loading');
    }

    global.OMNI_UploadModule = {
        initUpload: initUpload,
        initMultiUpload: initMultiUpload,
        getSelectedFile: getSelectedFile,
        clearSelectedFile: clearSelectedFile,
        setLoading: setLoading,
        showError: showError,
        hideMessages: hideMessages,
        escapeHtml: escapeHtml
    };
})(typeof window !== 'undefined' ? window : this);
