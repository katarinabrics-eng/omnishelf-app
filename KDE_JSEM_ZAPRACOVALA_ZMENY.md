# Kde jsou zapracované změny (Tržiště + ostatní)

Tento soubor slouží jako **přesný seznam souborů a míst**, kde byly změny provedeny. Pokud nic nevidíte v prohlížeči, nejčastěji jde o **cache** – viz níže „Jak zobrazit novou verzi“.

---

## Důležité: Kterou stránku otevíráte?

- **Tržiště** je součást **main.html** v kořenu projektu:  
  `OmniShelf/main.html`  
  (ne např. `Zaloha a grafika/index.html` ani jiné složky.)

- Tržiště se **zobrazí až po kliknutí na „Tržiště“** v levém sidebaru.  
  Sekce má `display:none`, dokud není aktivní modul „marketplace“.  
  Po kliknutí na „Tržiště“ by se měl objevit šedý podklad a bílé karty.

---

## 1. Tržiště – redesign podle předloh

### main.html (řádky cca 232–334)

- **Šedý podklad, celá sekce Tržiště**  
  Sekce: `<section class="marketplace-section" id="marketplaceSection" ...>`
- **Horní lišta kategorií**: Knihy, Nářadí, Oblečení (s ikonami) – řádky 243–257.
- **Karta knihy** (řádky 291–314):
  - **Status** místo samotné ceny: `<p class="marketplace-card__status" data-status="na-prodej">Na prodej</p>`
  - **Bublina se vzkazem**:  
    `<div class="marketplace-card__story-bubble">`  
    `<span class="marketplace-card__story-text">Tuhle knihu jsem četla 3x, je boží.</span>`
  - Žádný tlustý rámeček – karta má jen třídy pro bílou kartu.

### style.css

- **Řádky 613–620**: Šedý podklad Tržiště  
  `#marketplaceSection.marketplace-section { background: #f0f0f0; ... }`  
  `body.module-marketplace .main-content { background: #f0f0f0; }`
- **Řádky 643–668**: Lišta kategorií (Knihy, Nářadí, Oblečení).
- **Řádky 721–755**: Čisté bílé karty (bez tlustého rámečku, `border: none`),  
  statusy: `.marketplace-card__status`, `data-status="na-prodej"`, `k-zapujceni`, `daruji`.
- **Řádky 797–807**: Bublina se vzkazem –  
  `.marketplace-card__story-bubble`, `.marketplace-card__story-text`.

### library-logic.js (src/modules/library/)

- Klik na kartu otevře detail; do modalu se předává i **status** a **bublina (vzkaz)**.

---

## 2. Ostatní zapracované věci ze stejného dotazu

### Navigace / prokliky

- **main.html**:  
  - Šatník, Workshop, Pantry – odkazy na `coming-soon.html?module=wardrobe|workshop|pantry`.  
  - Přátelé (Coming Soon) – odkaz na `coming-soon.html?module=friends`.
- **coming-soon.html** (v kořenu): Jednoduchá „Již brzy“ stránka ve vašem stylu, tlačítko „Zpět do aplikace“ → main.html.
- **library.html**, **vitus.html**: Placeholdery s přesměrováním na main.html?module=library|vitus.
- **login.js**: Po přihlášení lze přesměrovat na main.html, library.html, vitus.html.

### Tab bar (spodní navigace)

- **main.html**: Domů → main.html, Knihovna → library.html, Vitus → vitus.html (odkazy).

### Mobil / PWA

- **main.html**: Viewport s `maximum-scale=1.0, user-scalable=no`.
- **style.css**:  
  - `cursor: pointer` a `touch-action: manipulation` u tlačítek a odkazů.  
  - Větší dotykové zóny (min-height 48px, padding) u tab baru a sidebaru.  
  - Sidebar `z-index: 1050`, spodní tab bar `z-index: 1100`.

---

## Jak zobrazit novou verzi (vyřešit „nic se nezměnilo“)

Prohlížeč často drží **starou verzi** CSS a občas i HTML (cache nebo Service Worker).

1. **Tvrdé obnovení stránky**  
   - **Mac**: Cmd + Shift + R  
   - **Windows**: Ctrl + Shift + R  

2. **Vyprázdnit cache / vypnout cache**  
   - Chrome: DevTools (F12) → Application → Storage → „Clear site data“  
   - nebo při otevřených DevTools: pravý klik na tlačítko Obnovit → „Vyprázdnit mezipaměť a provést obnovení“.

3. **Service Worker**  
   - DevTools → Application → Service Workers  
   - Zvolit „Unregister“ pro tento web.  
   - Pak znovu načíst stránku (ideálně tvrdé obnovení).

4. **Otevřít správnou stránku**  
   - Adresa by měla být na **main.html** v kořenu projektu  
     (např. `file:///Users/katarina/Documents/OmniShelf/main.html` nebo `http://localhost/.../main.html`).  
   - V sidebaru kliknout na **„Tržiště“** – teprve pak uvidíte šedý podklad a karty s bublinami a statusy.

Po těchto krocích by měly být vidět: šedé pozadí Tržiště, bílé karty bez tlustých rámečků, status „Na prodej“, bublina s vzkazem a lišta kategorií Knihy / Nářadí / Oblečení.
