# OmniShelf – Architektura refaktoringu

## Checkpoint 0 – Stav před end-to-end refaktorem

**Datum:** 2025-02-10

### Aktuální struktura
- `main.html` – vstupní bod, načítá: sectors → text-module → upload-module → library-logic → navigation
- `js/sectors.js` – konfigurace sektorů (Library, Workshop, Wardrobe, Music, Pantry, …)
- `js/modules/text-module.js` – API pro textové záznamy (createTextRecord, initManualAddForm)
- `js/modules/upload-module.js` – API pro upload (initUpload, getSelectedFile, setLoading)
- `library-logic.js` – knihovna: storage, render, analýza obrázků, propojení s moduly
- `navigation.js` – sidebar, přepínání modulů a „připravujeme“ texty dle sectors
- `MODULES/*.html` – šablony pro build (Sidebar, CollectionContent, LibraryUpload, LibraryManualAdd, …)

### Cíle refaktoringu
1. **Modul Text** – samostatná logika pro textové záznamy (poznámky, citace), nezávislá na knihovně.
2. **Modul Upload** – robustní upload + příprava API pro budoucí vizuální mapy (místnosti, workshop, šatník).
3. **Sektory** – hladké přepínání: Library, Workshop, Wardrobe, Music Library, Pantry (jedna konfigurace, jednotné UX).
4. **Škálovatelnost** – připravenost na AI navigaci v prostoru (vizuální mapy).

### Cílová struktura (po refaktoru) – IMPLEMENTOVÁNO
```
js/
  config/
    sectors.js          # Konfigurace sektorů + setCurrentSector / getCurrentSector
  modules/
    text/
      text-module.js    # Samostatná logika textových záznamů (poznámky, citace)
    upload/
      upload-module.js  # Upload jednoho/ více souborů, připraveno na vizuální mapy
      visual-map.js     # Stub: saveRoomImages / loadRoomImages pro AI navigaci v prostoru
```
- `main.html` načítá: `js/config/sectors.js` → `js/modules/text/text-module.js` → `js/modules/upload/upload-module.js` → `js/modules/upload/visual-map.js` → `library-logic.js` → `navigation.js`.
- `library-logic.js` zůstává v rootu; používá `getCurrentSectorId()` (z OMNI_SECTORS) pro kategorii přidávaných položek.
- Přepínání sektorů: navigation.js volá `OMNI_SECTORS.setCurrentSector(id)`; uživatel hladce přepíná Library, Workshop, Wardrobe, Music Library, Pantry.

### Návrat na Checkpoint 0
```bash
git log --oneline      # najít "Checkpoint 0: před end-to-end refaktoringem"
git checkout <hash> -- .
```

---

## Checkpoint 1 – Po end-to-end refaktoringu

**Struktura:** viz výše. Staré soubory `js/sectors.js`, `js/modules/text-module.js`, `js/modules/upload-module.js` odstraněny.

**Návrat na Checkpoint 1** (po tomto commitu):
```bash
git log --oneline      # najít "Checkpoint 1: po end-to-end refaktoringu"
git checkout <hash> -- .
```
