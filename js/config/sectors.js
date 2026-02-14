/**
 * OmniShelf – centrální konfigurace sektorů aplikace.
 * Umožňuje snadné přepínání mezi: Knihovna, Workshop (Dílna), Wardrobe (Šatník),
 * Music Library (Hudební sbírka), Pantry (Spíž) a dalšími.
 * Použití: přepínání v sidebaru, ukládání podle kategorie, vizuální mapy.
 */
(function (global) {
    'use strict';

    var SECTORS = [
        { id: 'library', label: 'Moje knihovna', labelEn: 'Library', icon: '📚', hasSubViews: true },
        { id: 'workshop', label: 'Dílna', labelEn: 'Workshop', icon: '🔧', hasSubViews: false },
        { id: 'wardrobe', label: 'Šatník', labelEn: 'Wardrobe', icon: '👕', hasSubViews: false },
        { id: 'vinyl', label: 'Hudební sbírka', labelEn: 'Music Library', icon: '🎵', hasSubViews: false },
        { id: 'pantry', label: 'Spíž', labelEn: 'Pantry', icon: '🥫', hasSubViews: false },
        { id: 'warehouse', label: 'Sklad', labelEn: 'Warehouse', icon: '📦', hasSubViews: false },
        { id: 'cardindex', label: 'Kartotéka', labelEn: 'Card index', icon: '📁', hasSubViews: false },
        { id: 'winery', label: 'Vinotéka', labelEn: 'Winery', icon: '🍷', hasSubViews: false },
        { id: 'visualMap', label: 'Vizuální mapa', labelEn: 'Visual Map', icon: '🗺️', hasSubViews: false }
    ];

    /** Sektory zobrazené v menu „Další sektory“ (kromě knihovny a dětí). */
    var SIDEBAR_SECTOR_IDS = ['visualMap', 'vinyl', 'warehouse', 'cardindex', 'wardrobe', 'workshop', 'winery', 'pantry'];

    /** Placeholder zprávy pro „připravujeme“ sekce. */
    var COMING_SOON_MESSAGES = {
        vinyl: 'Právě ladíme gramofonové jehly a třídíme vinyly...',
        warehouse: 'V regálech skladu právě děláme místo pro tvé krabice a zásoby...',
        cardindex: 'Srovnáváme šanony a papíry do latě. Brzy tu bude tvůj digitální pořádek v dokumentech.',
        wardrobe: 'Věšíme ramínka a žehlíme regály. Tvá móda si zaslouží chytrý přehled!',
        workshop: 'Hledáme zatoulaný šroubovák a organizujeme ponk...',
        winery: 'Právě leštíme sklenice a nastavujeme správnou teplotu pro tvůj archiv...',
        pantry: 'Roztřídíme zásoby a připravíme přehled spíže. Brzy tu bude tvůj chytrý špajz.',
        visualMap: 'Tady vzniká tvůj digitální domov. Brzy zde uvidíš mapu svých místností a AI tě navede přímo ke každé poličce.'
    };

    function getSector(id) {
        for (var i = 0; i < SECTORS.length; i++) {
            if (SECTORS[i].id === id) return SECTORS[i];
        }
        return null;
    }

    function getSidebarSectors() {
        return SIDEBAR_SECTOR_IDS.map(function (id) { return getSector(id); }).filter(Boolean);
    }

    function getComingSoonMessage(sectorId) {
        return COMING_SOON_MESSAGES[sectorId] || 'Tato sekce se pro tebe připravuje.';
    }

    function isPlaceholderSector(sectorId) {
        return SIDEBAR_SECTOR_IDS.indexOf(sectorId) !== -1;
    }

    /** Aktuálně vybraný sektor (pro jednotné přepínání UI). */
    var currentSectorId = 'library';

    function setCurrentSector(id) {
        if (getSector(id)) currentSectorId = id;
        return currentSectorId;
    }

    function getCurrentSector() {
        return getSector(currentSectorId) || getSector('library');
    }

    global.OMNI_SECTORS = {
        SECTORS: SECTORS,
        SIDEBAR_SECTOR_IDS: SIDEBAR_SECTOR_IDS,
        getSector: getSector,
        getSidebarSectors: getSidebarSectors,
        getComingSoonMessage: getComingSoonMessage,
        isPlaceholderSector: isPlaceholderSector,
        setCurrentSector: setCurrentSector,
        getCurrentSector: getCurrentSector,
        getCurrentSectorId: function () { return currentSectorId; }
    };
})(typeof window !== 'undefined' ? window : this);
