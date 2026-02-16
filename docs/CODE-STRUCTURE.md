# Struktura kódu Omshelf

## HTML stránky
- **index.html** – zelená LP (landing) se sektory, vstupní brána pro celý svět
- **login.html** – přihlášení
- **app.html** – hlavní aplikace „Vítej zpět“ (Knihovna, Vitus, Tržiště, …)
- **library.html**, **vitus.html** – placeholder stránky s přesměrováním
- **coming-soon.html** – moduly „Již brzy“

## CSS
- **style.css** – hlavní styly (~10k řádků)
- **css/tags.css** – univerzální štítky (`.tag`, `.tag--red`, `.tag--green`, `.tag--orange`)
- **css/pricing.css** – ceník
- **css/marketplace.css** – tržiště
- **css/messages.css** – zprávy

## JavaScript moduly (src/)
- **core/** – navigation.js, app-state.js, module-switcher.js, keys.js
- **modules/library/** – library-logic.js, text/, upload/, friends/
- **modules/vitus/** – vitus-logic.js, vitus-ai.js, vitus-enrich.js, vitus-shell.js

## PWA
- **manifest.json** – název „Omshelf“, start_url ./app.html (PWA ikona otevře přímo aplikaci)
- **service-worker.js** – offline cache
- Meta tagy pro Apple: apple-touch-icon, mobile-web-app-capable

## Flow
`/` → index.html (LP) → login.html → app.html

**PWA:** Uložení ikony z index.html → po kliknutí na ikonu se otevře app.html (ne LP znovu)
