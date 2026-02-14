# Přehled oprav redesignu – ověření

Tento soubor shrnuje, co je v kódu implementováno a kde to najít. Slouží k rychlé kontrole po „spadnutí“ nebo po úpravách.

---

## 1. Fix neviditelných textů (tlačítka)

**Požadavek:** V Pracovně a jinde mají tlačítka s tmavým pozadím bílý text (`#FFFFFF`).

**Kde v kódu:**
- **Řádky cca 189–217:** blok `/* Dospělý režim: tlačítka s tmavým pozadím mají vždy bílý text */`
  - Bílý text je nastaven pro: `.btn-modal-submit`, `.analyze-button`, `.pracovna-card .btn-ai-presentation`, `.pracovna-section .btn-voice-briefing`, `.btn-ai-presentation:hover`, `.btn-voice-briefing:hover`, `.content-for-collection`, `.discworld-collection-modal`, `.add-book-btn`, `.btn-confirm-loan`, atd.
- **Řádky cca 2939–2942:** `.pracovna-card .btn-ai-presentation, .pracovna-card .btn-voice-briefing` mají `background: var(--btn-primary)` a `color: #FFFFFF !important`.

**Ověření:** V dospělém režimu otevři Pracovnu (Studium) – tlačítka „Vytvořit AI prezentaci“ a „Otevřít AI Prezentaci sbírky“ by měla mít čitelný bílý text na tmavém pozadí.

---

## 2. Aktivace nahrávání u dětí (Esky – „Nahrát novou knihu“)

**Požadavek:** Tlačítko „Nahrát novou knihu“ v profilu Esky (Moje knížky) je funkční, propojené s nahráváním obrázků; po přidání kniha jde do „Pending“ v Nastavení Admina.

**Kde v kódu:**
- **HTML (cca 4680–4681):** `<div id="childrenLibraryUploadWrap">` a `<button id="btnChildUploadBook">Nahrát novou knihu</button>`.
- **Viditelnost tlačítka (cca 6493–6494):** `childrenLibraryUploadWrap.style.display` je `'block'` jen když `currentModule === 'childrenLibrary' && childrenLibraryView === 'childrenCurrentlyReading' && viewingAsChild`.
- **Klik (cca 9983–9986):** `btnChildUploadBook` volá `openAddItemModal('library', !!isChild)`.
- **Otevření modalu (cca 9927–9945):** `openAddItemModal(presetCategory, fromChildUpload)` při `fromChildUpload === true`:
  - nastaví v placeholderu text „Vyber fotku obalu – klikni sem (kniha půjde ke schválení)“,
  - po 0 ms spustí `addItemModalCoverInput.click()` (výběr souboru).
- **Odeslání (cca 10016–10041):** při přidání do `library` se použije `addingAsChild = childProfile && currentProfileId === childProfile.id` a do záznamu se přidá `...(addingAsChild ? { pendingApproval: true, addedByProfileId: currentProfileId } : {})`.

**Ověření:** Přepni na Esky → Moje knížky → klikni „Nahrát novou knihu“. Otevře se modal „Přidat detailně“, může se otevřít i výběr souboru. Vyber fotku (nebo vyplň aspoň název), klikni Přidat. V Nastavení (Admin) v sekci „Knihy ke schválení“ by se měla objevit kniha ke schválení.

---

## 3. Accordion sidebar (sbalení Knihovny v dětském světě)

**Požadavek:** V sekci Dětská knihovna nebo Esky je celá horní sekce „Knihovna“ (Rozečteno, Půjčil jsem…) sbalená/skrytá.

**Kde v kódu:**
- **CSS (cca 4269):** `.viewing-as-child #sidebarMainLibrary` má `display: none !important` (v režimu Esky).
- **JS (cca 6368–6370):** V `applyModuleUI()`:
  - `inChildrenWorld = currentModule === 'childrenLibrary' || viewingAsChild`
  - `sidebarMainLib.style.display = inChildrenWorld ? 'none' : ''`

**Ověření:** Klikni na „Dětská knihovna“ nebo přepni na „Esky“ – v sidebaru by neměla být vidět sekce „Knihovna“ (Rozečteno, Půjčil/a jsem…), jen dětské položky.

---

## 4. Responzivita oken (scroll, max-height, tlačítka dole)

**Požadavek:** Modální okna (Nastavení, Přidat knihu…) mají `max-height: 85vh`, `overflow-y: auto` a spodní tlačítka (Zavřít, Schválit) jsou vždy dostupná.

**Kde v kódu:**
- **Základ všech modálů (cca 2392–2402):** `.wishlist-modal-content` má `max-height: 85vh` a `overflow-y: auto`.
- **Nastavení (cca 3431–3482):** `.settings-modal .wishlist-modal-content`: `max-height: 85vh`, `display: flex`, `flex-direction: column`, `overflow: hidden`. `.settings-modal-body`: `flex: 1`, `min-height: 0`, `overflow-y: auto`. `.settings-modal-footer`: `flex-shrink: 0` (sticky dole).
- **Přidat knihu / Upravit knihu (cca 3440–3466):** `.add-item-modal .wishlist-modal-content` stejný princip; `.add-item-modal-body` scrolluje, `.wishlist-modal-actions` je dole.
- **HTML:** Nastavení má `<div class="settings-modal-body">` a `<div class="wishlist-modal-actions settings-modal-footer">`. Přidat knihu a Upravit knihu mají `<div class="add-item-modal-body">` a pak `<div class="wishlist-modal-actions">`.

**Ověření:** Otevři Nastavení nebo Přidat knihu na menším okně / mobilu – mělo by jít scrollovat obsah a tlačítka Zavřít/Schválit by měla zůstat dole a viditelná.

---

## 5. Apple style (žádná fialová, bílá/šedá/limetka)

**Požadavek:** Žádné fialové přechody v dospělém režimu; bílá, šedá a jen drobné limetkové akcenty.

**Kde v kódu:**
- **CSS variables (cca 15–31):** `--text: #1D1D1F`, `--btn-primary: #1D1D1F`, `--surface: #F9F9F9`, `--accent: #84cc16` (limetka). Žádné fialové proměnné.
- V projektu není použit `purple`, `violet`, `#8b5c`, `#7c3a` ani fialové přechody.

**Ověření:** Projít vzhled v dospělém režimu – měly by být jen neutrální barvy a malé limetkové akcenty.

---

## Rychlý checklist

- [ ] Pracovna: tlačítka s tmavým pozadím mají bílý text.
- [ ] Esky → Moje knížky: tlačítko „Nahrát novou knihu“ je vidět a po kliknutí otevře modal (a případně výběr fotky).
- [ ] Po přidání knihy jako Esky se kniha objeví v Nastavení → Knihy ke schválení.
- [ ] V režimu Dětská knihovna / Esky není v sidebaru sekce Knihovna (Rozečteno, Půjčil jsem…).
- [ ] Modaly (Nastavení, Přidat knihu) se vejdou na obrazovku, jde scrollovat a tlačítka jsou dole vidět.
- [ ] Žádná fialová v dospělém režimu.

Když něco z toho nefunguje, podle tohoto přehledu rychle najdeš příslušné místo v `index.html` a můžeš tam zkontrolovat nebo opravit logiku/CSS.
