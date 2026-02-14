/**
 * src/modules/vitus/vitus-enrich.js
 * Bába Kořenářka – enrichment přes OpenAI.
 *
 * Používá OpenAI API klíč z OMNI_Keys (Nastavení → OpenAI API klíč),
 * stejně jako modul Knihovna.
 */
(function (global) {
    'use strict';

    function safeTrim(s) { try { return String(s || '').trim(); } catch (e) { return ''; } }

    function getOpenAiKey() {
        try {
            if (global.OMNI_Keys && typeof global.OMNI_Keys.getOpenAiKey === 'function') return safeTrim(global.OMNI_Keys.getOpenAiKey());
        } catch (e0) {}
        try { return safeTrim(global.OMNI_CONFIG && global.OMNI_CONFIG.openai); } catch (e1) { return ''; }
    }

    function getGeminiKey() {
        try {
            if (global.OMNI_Keys && typeof global.OMNI_Keys.getGeminiKey === 'function') return safeTrim(global.OMNI_Keys.getGeminiKey());
        } catch (e0) {}
        try { return safeTrim(global.OMNI_CONFIG && global.OMNI_CONFIG.gemini); } catch (e1) { return ''; }
    }

    function isEnabled() {
        return !!getOpenAiKey() || !!getGeminiKey() || !!(global.OMNI_Keys && global.OMNI_Keys.openAiFetch);
    }

    function stripJsonFences(txt) {
        return String(txt || '')
            .replace(/```json\s*/gi, '')
            .replace(/```/g, '')
            .trim();
    }

    function normalizeCategory(cat) {
        var allowed = ['Srdce', 'Klouby', 'Krása', 'Spánek', 'Trávení', 'Imunita', 'Jiné'];
        var c = safeTrim(cat);
        if (!c) return 'Jiné';
        // accept exact
        if (allowed.indexOf(c) >= 0) return c;
        // accept lowercase variants
        var lower = c.toLowerCase();
        for (var i = 0; i < allowed.length; i++) {
            if (allowed[i].toLowerCase() === lower) return allowed[i];
        }
        return 'Jiné';
    }

    async function enrichMed(medLike) {
        var openaiKey = getOpenAiKey();
        var geminiKey = getGeminiKey();
        var hasProxy = global.OMNI_Keys && global.OMNI_Keys.openAiFetch;
        if (!openaiKey && !geminiKey && !hasProxy) throw new Error('missing_ai_key');

        var name = safeTrim(medLike && medLike.name);
        var type = safeTrim(medLike && medLike.type);
        if (!name) throw new Error('missing_med_name');

        var systemPrompt =
            'Jsi Bába Kořenářka, expertka na farmacii a bylinkářství. Tvým úkolem je poskytnout přesné informace o léku nebo doplňku stravy. ' +
            'Odpověz VŽDY pouze ve formátu JSON s těmito poli: purpose (stručný účel), category (vyber jednu z: Srdce, Klouby, Krása, Spánek, Trávení, Imunita, Jiné), ' +
            'prescription (jak užívat), notes (zajímavost nebo rada), warning (na co si dát pozor), aiContext (stručné shrnutí).';

        var userPrompt =
            'Název: "' + name + '".' + (type ? (' Forma: "' + type + '".') : '') +
            ' Pokud si nejsi jistá, napiš to do warning/notes a category dej Jiné.';

        // Prefer OpenAI (pokud je klíč nebo proxy), jinak Gemini
        if (!openaiKey && !hasProxy && geminiKey) {
            var schema = {
                type: 'object',
                properties: {
                    purpose: { type: 'string', description: 'Stručný účel.' },
                    category: { type: 'string', enum: ['Srdce', 'Klouby', 'Krása', 'Spánek', 'Trávení', 'Imunita', 'Jiné'] },
                    prescription: { type: 'string', description: 'Jak užívat.' },
                    notes: { type: 'string', description: 'Zajímavost nebo rada.' },
                    warning: { type: 'string', description: 'Na co si dát pozor.' },
                    aiContext: { type: 'string', description: 'Stručné shrnutí.' }
                },
                required: ['purpose', 'category', 'prescription', 'notes', 'warning', 'aiContext'],
                additionalProperties: false
            };

            var model = safeTrim(global.OMNI_CONFIG && global.OMNI_CONFIG.geminiModel) || 'gemini-3-flash-preview';

            var r2 = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': geminiKey
                },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userPrompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseJsonSchema: schema
                    }
                })
            });

            var data2 = await r2.json().catch(function () { return null; });
            if (!r2.ok) {
                var msg2 = (data2 && data2.error && data2.error.message) ? String(data2.error.message) : (r2.statusText || 'gemini_error');
                throw new Error(msg2);
            }
            var txt2 = (data2 && data2.candidates && data2.candidates[0] && data2.candidates[0].content && data2.candidates[0].content.parts && data2.candidates[0].content.parts[0])
                ? (data2.candidates[0].content.parts[0].text || '')
                : '';
            var raw2 = stripJsonFences(txt2);
            var parsed2 = {};
            try { parsed2 = JSON.parse(raw2); } catch (eP) { parsed2 = {}; }

            return {
                ok: true,
                med: {
                    purpose: safeTrim(parsed2.purpose),
                    category: normalizeCategory(parsed2.category),
                    prescription: safeTrim(parsed2.prescription),
                    notes: safeTrim(parsed2.notes),
                    warning: safeTrim(parsed2.warning),
                    aiContext: safeTrim(parsed2.aiContext)
                }
            };
        }

        var body = {
            model: 'gpt-4o',
            max_tokens: 500,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        };
        var resp = hasProxy
            ? await global.OMNI_Keys.openAiFetch(body)
            : await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
                body: JSON.stringify(body)
            });

        var data = await resp.json().catch(function () { return null; });
        if (!resp.ok) {
            var msg = (data && data.error && data.error.message) ? String(data.error.message) : (resp.statusText || 'openai_error');
            throw new Error(msg);
        }

        var txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
            ? data.choices[0].message.content
            : '';
        var jsonRaw = stripJsonFences(txt);
        var parsed = {};
        try { parsed = JSON.parse(jsonRaw); } catch (e0) { parsed = {}; }

        var med = {
            purpose: safeTrim(parsed.purpose),
            category: normalizeCategory(parsed.category),
            prescription: safeTrim(parsed.prescription),
            notes: safeTrim(parsed.notes),
            warning: safeTrim(parsed.warning),
            aiContext: safeTrim(parsed.aiContext)
        };

        return { ok: true, med: med };
    }

    global.OMNI_VitusEnrich = global.OMNI_VitusEnrich || {};
    global.OMNI_VitusEnrich.isEnabled = isEnabled;
    global.OMNI_VitusEnrich.enrichMed = enrichMed;
})(typeof window !== 'undefined' ? window : this);

