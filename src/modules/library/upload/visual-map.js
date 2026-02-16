/**
 * Omshelf – příprava na vizuální mapy (AI navigace v prostoru).
 * Stub pro budoucí funkce: nahrání fotek místnosti, 3D/panorama, hotspoty na poličky.
 * Sektory: visualMap, workshop, wardrobe, pantry (místnosti).
 */
(function (global) {
    'use strict';

    var VISUAL_MAP_STORAGE_KEY = 'omnishelf_visual_maps';

    /**
     * Vrátí konfiguraci pro daný sektor (místnost) – zatím stub.
     * @param {string} sectorId - visualMap | workshop | wardrobe | pantry
     * @returns {{ sectorId: string, label: string, supportsMultiUpload: boolean }}
     */
    function getConfig(sectorId) {
        var sector = (typeof global.OMNI_SECTORS !== 'undefined' && global.OMNI_SECTORS.getSector) ? global.OMNI_SECTORS.getSector(sectorId) : null;
        return {
            sectorId: sectorId || 'visualMap',
            label: (sector && sector.label) ? sector.label : 'Vizuální mapa',
            supportsMultiUpload: true
        };
    }

    /**
     * Uloží reference na nahrání fotek místnosti (pro budoucí AI skládání).
     * @param {string} sectorId
     * @param {Array<{ name: string, dataUrl?: string }>} images
     */
    function saveRoomImages(sectorId, images) {
        try {
            var raw = localStorage.getItem(VISUAL_MAP_STORAGE_KEY);
            var data = raw ? JSON.parse(raw) : {};
            data[sectorId] = { images: images, updatedAt: new Date().toISOString() };
            localStorage.setItem(VISUAL_MAP_STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Omshelf VisualMap: save failed', e);
        }
    }

    /**
     * Načte uložené obrázky místnosti pro sektor.
     * @param {string} sectorId
     * @returns {Array}
     */
    function loadRoomImages(sectorId) {
        try {
            var raw = localStorage.getItem(VISUAL_MAP_STORAGE_KEY);
            var data = raw ? JSON.parse(raw) : {};
            var room = data[sectorId];
            return (room && room.images) ? room.images : [];
        } catch (e) {
            return [];
        }
    }

    global.OMNI_VisualMap = {
        getConfig: getConfig,
        saveRoomImages: saveRoomImages,
        loadRoomImages: loadRoomImages
    };
})(typeof window !== 'undefined' ? window : this);
