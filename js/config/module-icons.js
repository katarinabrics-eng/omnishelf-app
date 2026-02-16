/**
 * Omshelf – mapování modulů na číselné ikony (složka Ikony do aplikace _ 200px).
 * Formát souborů: 01_small200px.png (Domů), 01_small200px_[číslo].png
 */
(function (global) {
    'use strict';
    var BASE = 'Ikony do aplikace _ 200px/01_small200px';
    var map = {
        home: BASE + '.png',
        library: BASE + '_4.png',
        vitus: BASE + '_8.png',
        workshop: BASE + '_14.png',
        wardrobe: BASE + '_13.png',
        study: BASE + '_1.png',
        omnikids: BASE + '_11.png',
        debordelizace: BASE + '_4.png',
        statistics: BASE + '_8.png',
        profile: BASE + '_7.png',
        settings: BASE + '_6.png',
        pantry: BASE + '_5.png',
        marketplace: BASE + '_11.png'
    };
    function getIconUrl(key) { return map[key] || map.library; }
    global.OMNI_ModuleIcons = { getIconUrl: getIconUrl, base: BASE, map: map };
})(typeof window !== 'undefined' ? window : this);
