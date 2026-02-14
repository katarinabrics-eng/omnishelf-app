#!/usr/bin/env python3
"""
Sestaví app.html z modulů (MODULES/*.html).
Výstup: app-built.html – jeden soubor bez fetch, funguje i v Safari při file://.

Použití: python3 build.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAIN = ROOT / "app.html"
OUT = ROOT / "app-built.html"
MODULES_DIR = ROOT / "MODULES"

SLOTS = [
    ("sidebar-slot", "SidebarModule.html"),
    ("main-header-slot", "MainHeader.html"),
    ("content-area-slot", "CollectionContent.html"),
    ("library-upload-slot", "LibraryUpload.html"),
    ("library-grid-slot", "LibraryGrid.html"),
    ("library-manual-add-slot", "LibraryManualAdd.html"),
]

def main():
    html = MAIN.read_text(encoding="utf-8")
    for slot_id, filename in SLOTS:
        filepath = MODULES_DIR / filename
        if not filepath.exists():
            print("Chybí modul:", filepath)
            continue
        content = filepath.read_text(encoding="utf-8").strip()
        pattern = re.compile(r'<div\s+id="' + re.escape(slot_id) + r'"\s*>\s*</div>', re.DOTALL)
        if not pattern.search(html):
            print("Slot v app.html nenalezen:", slot_id)
            continue
        html = pattern.sub(content, html, count=1)
        print("Vložen modul:", filename, "→", slot_id)
    OUT.write_text(html, encoding="utf-8")
    print("Hotovo. Výstup:", OUT)

if __name__ == "__main__":
    main()
