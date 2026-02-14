#!/usr/bin/env node
/**
 * Sestaví app.html z modulů (MODULES/*.html).
 * Výstup: main-built.html – jeden soubor bez fetch, funguje i v Safari při file://.
 *
 * Použití: node build.js
 * Nebo: npm run build
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const MAIN = path.join(ROOT, 'app.html');
const OUT = path.join(ROOT, 'main-built.html');
const MODULES_DIR = path.join(ROOT, 'MODULES');

const SLOTS = [
    { id: 'sidebar-slot', file: 'SidebarModule.html' },
    { id: 'main-header-slot', file: 'MainHeader.html' },
    { id: 'content-area-slot', file: 'CollectionContent.html' },
    { id: 'library-upload-slot', file: 'LibraryUpload.html' },
    { id: 'library-grid-slot', file: 'LibraryGrid.html' },
    { id: 'library-manual-add-slot', file: 'LibraryManualAdd.html' },
];

function main() {
    let html = fs.readFileSync(MAIN, 'utf8');

    for (const { id, file } of SLOTS) {
        const filePath = path.join(MODULES_DIR, file);
        if (!fs.existsSync(filePath)) {
            console.warn('Chybí modul:', filePath);
            continue;
        }
        const content = fs.readFileSync(filePath, 'utf8').trim();
        const regex = new RegExp(`<div\\s+id="${id}"\\s*>\\s*</div>`, 's');
        if (!regex.test(html)) {
            console.warn('Slot v app.html nenalezen:', id);
            continue;
        }
        html = html.replace(regex, content);
        console.log('Vložen modul:', file, '→', id);
    }

    fs.writeFileSync(OUT, html, 'utf8');
    console.log('Hotovo. Výstup:', OUT);
}

main();
