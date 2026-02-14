/**
 * src/modules/vitus/vitus-ai.js
 * Vitus AI wrapper – sken dokumentu/fotky → návrh strukturovaných dat.
 *
 * Pozn.: Běží v prohlížeči (stejně jako Knihovna). Klíč se bere přes OMNI_Keys.
 */
(function (global) {
    'use strict';

    function getOpenAiKey() {
        try {
            if (global.OMNI_Keys && typeof global.OMNI_Keys.getOpenAiKey === 'function') return global.OMNI_Keys.getOpenAiKey();
        } catch (e0) {}
        try { return (global.OMNI_CONFIG && global.OMNI_CONFIG.openai) || ''; } catch (e1) { return ''; }
    }

    function safeTrim(s) { try { return String(s || '').trim(); } catch (e) { return ''; } }

    function readAsDataUrl(file) {
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

    async function toOptimizedJpegDataUrl(file) {
        // Best-effort: decode → resize → jpeg. If it fails, fallback to original dataURL.
        try {
            if (typeof createImageBitmap !== 'function') throw new Error('no_createImageBitmap');
            // createImageBitmap accepts Blob/File
            // eslint-disable-next-line no-undef
            var bmp = await createImageBitmap(file);
            var maxSide = 1280;
            var w = bmp.width || 0;
            var h = bmp.height || 0;
            if (!w || !h) throw new Error('invalid_image');
            var scale = Math.min(1, maxSide / Math.max(w, h));
            var tw = Math.max(1, Math.round(w * scale));
            var th = Math.max(1, Math.round(h * scale));

            var canvas;
            var ctx;
            if (typeof OffscreenCanvas !== 'undefined') {
                // eslint-disable-next-line no-undef
                canvas = new OffscreenCanvas(tw, th);
                ctx = canvas.getContext('2d');
            } else {
                canvas = document.createElement('canvas');
                canvas.width = tw;
                canvas.height = th;
                ctx = canvas.getContext('2d');
            }
            if (!ctx) throw new Error('no_canvas');
            ctx.drawImage(bmp, 0, 0, tw, th);

            if (canvas.convertToBlob) {
                // OffscreenCanvas
                // eslint-disable-next-line no-await-in-loop
                var blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
                return await readAsDataUrl(blob);
            }
            // HTMLCanvasElement
            return canvas.toDataURL('image/jpeg', 0.86);
        } catch (e0) {
            return await readAsDataUrl(file);
        }
    }

    function stripJsonFences(txt) {
        return String(txt || '')
            .replace(/```json\s*/gi, '')
            .replace(/```\s*$/g, '')
            .trim();
    }

    function toFileArray(input) {
        if (!input) return [];
        // FileList
        if (typeof input.length === 'number' && typeof input.item === 'function') {
            return Array.prototype.slice.call(input);
        }
        // Array
        if (Array.isArray(input)) return input.slice();
        return [input];
    }

    function isPdf(file) {
        var type = safeTrim(file && file.type);
        var name = safeTrim(file && file.name);
        return type === 'application/pdf' || /\.pdf$/i.test(name);
    }

    function isImage(file) {
        var type = safeTrim(file && file.type);
        return type.indexOf('image/') === 0;
    }

    async function scan(input) {
        var key = safeTrim(getOpenAiKey());
        if (!key) throw new Error('missing_openai_key');

        var files = toFileArray(input).filter(Boolean);
        if (!files.length) throw new Error('missing_file');

        // PDF support (limited): for now we do not OCR PDFs client-side
        // If any PDF is present, we short-circuit (UI can still do manual entry).
        if (files.some(isPdf)) {
            return {
                notes: 'PDF sken: zatím bez OCR v prohlížeči. Prosím přepište údaje ručně nebo nahrajte fotku.',
            };
        }

        // Take up to N images (max 4 pro rozumnou dobu odpovědi; HEIC převod + API může trvat 30–90 s)
        var images = files.filter(isImage).slice(0, 4);
        if (!images.length) {
            return { notes: 'Soubor není obrázek. Nahrajte fotku krabičky / receptu / letáku.' };
        }

        var contentParts = [{ type: 'text', text: '' }];

        var prompt = [
            'Jsi asistent pro digitální lékárničku (Apatyka).',
            'Z více fotek (krabička / recept / leták / ručně psaný dokument) vytěž strukturovaná data.',
            'Vrátíš POUZE validní JSON bez komentářů.',
            'Schéma:',
            '{',
            '  "name": string,',
            '  "type": string,',
            '  "totalQuantity": number|null,',
            '  "remainingQuantity": number|null,',
            '  "doseAmount": number|null,',
            '  "expiration": "YYYY-MM-DD"|"" ,',
            '  "purpose": string,',
            '  "prescription": string,',
            '  "notes": string,',
            '  "category": string,',
            '  "aiContext": string',
            '}',
            'Pokud si nejsi jistý, ponech hodnotu prázdnou ("" nebo null).',
            'Kategorie navrhni jedním slovem/krátkou frází (např. "Srdce", "Klouby", "Spánek", "Krása", "Jiné").'
            , 'Do aiContext napiš stručný “profil léku” (účinná látka, na co je, hlavní upozornění/interakce), pokud to z fotek poznáš.'
        ].join('\n');

        contentParts[0].text = prompt;

        var coverDataUrl = '';
        for (var i = 0; i < images.length; i++) {
            // eslint-disable-next-line no-await-in-loop
            var dataUrl = await toOptimizedJpegDataUrl(images[i]);
            contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
            if (i === 0) coverDataUrl = dataUrl || '';
        }

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = null;
        var timeoutMs = 120000;
        if (controller) {
            timeoutId = global.setTimeout(function () { controller.abort(); }, timeoutMs);
        }

        var fetchOpts = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 600,
                messages: [
                    {
                        role: 'user',
                        content: contentParts
                    }
                ]
            })
        };
        if (controller && controller.signal) fetchOpts.signal = controller.signal;

        var resp;
        try {
            resp = await fetch('https://api.openai.com/v1/chat/completions', fetchOpts);
        } catch (fetchErr) {
            if (timeoutId) global.clearTimeout(timeoutId);
            if (fetchErr && fetchErr.name === 'AbortError') throw new Error('timeout_analýza_trvala_příliš_dlouho');
            throw fetchErr;
        }
        if (timeoutId) global.clearTimeout(timeoutId);

        var data = await resp.json();
        if (!resp.ok) {
            var msg = (data && data.error && data.error.message) ? data.error.message : 'openai_error';
            throw new Error(msg);
        }

        var txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
            ? data.choices[0].message.content
            : '';
        var jsonRaw = stripJsonFences(txt);
        var parsed = {};
        try { parsed = JSON.parse(jsonRaw); } catch (e1) { parsed = { notes: 'AI odpověď se nepodařila přečíst jako JSON. Zkontrolujte údaje ručně.' }; }

        // attach cover image for UI
        if (coverDataUrl && String(coverDataUrl).indexOf('data:image') === 0) parsed.coverImage = coverDataUrl;
        return parsed;
    }

    global.OMNI_VitusAi = global.OMNI_VitusAi || {};
    global.OMNI_VitusAi.scan = scan;
})(typeof window !== 'undefined' ? window : this);

