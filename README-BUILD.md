# Sestavení Omshelf (bez fetch)

V Safari při otevření `app.html` přes **file://** prohlížeč blokuje `fetch()` na lokální soubory, takže moduly se nenačtou.

**Řešení:** před otevřením v Safari sestavte jeden soubor, do kterého se moduly vlepí.

## Jak sestavit

V kořenu projektu spusťte:

```bash
# Varianta A – Node.js
node build.js

# Varianta B – Python 3
python3 build.py
```

Vznikne soubor **main-built.html**. Ten otevřete v Safari (nebo dvojklikem) – vše bude v jednom souboru, fetch se nepoužívá.

## Co skript dělá

1. Načte `app.html`.
2. Najde každý prázdný `<div id="…-slot"></div>`.
3. Nahradí ho obsahem odpovídajícího souboru z `MODULES/`.
4. Výsledek zapíše do `main-built.html`.

## Sloty a moduly

| Slot | Modul |
|------|--------|
| sidebar-slot | MODULES/SidebarModule.html |
| main-header-slot | MODULES/MainHeader.html |
| content-area-slot | MODULES/CollectionContent.html |
| library-upload-slot | MODULES/LibraryUpload.html |
| library-grid-slot | MODULES/LibraryGrid.html |
| library-manual-add-slot | MODULES/LibraryManualAdd.html |

## Automatické sestavení při uložení (volitelné)

V Cursoru nelze přímo nastavit „při Save spusť skript“. Můžete si ale dát do úlohy (Task) nebo terminálu příkaz `node build.js` / `python3 build.py` a spouštět ho po úpravě modulů před otevřením v prohlížeči. Případně použijte VS Code/Cursor rozšíření pro „Run on Save“.
