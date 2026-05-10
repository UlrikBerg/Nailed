// Shared amenity catalog. Both /salong-panel.html (editor) and /salon.html
// (public profile) use this to map amenity codes → Lucide icon + Norwegian
// label. Backend stores only the code; frontend renders the rest.

(function (global) {
  var CATALOG = [
    { code: 'bio_gel',               icon: 'leaf',         label: 'Bio-gel' },
    { code: 'wifi',                  icon: 'wifi',         label: 'Wifi' },
    { code: 'coffee',                icon: 'coffee',       label: 'Kaffe' },
    { code: 'water',                 icon: 'droplet',      label: 'Vann' },
    { code: 'accessible',            icon: 'accessibility', label: 'Tilgjengelig' },
    { code: 'parking',               icon: 'car',          label: 'Parkering' },
    { code: 'vegan_products',        icon: 'sparkles',     label: 'Vegansk' },
    { code: 'card_payment',          icon: 'credit-card',  label: 'Kortbetaling' },
    { code: 'vipps_payment',         icon: 'smartphone',   label: 'Vipps' },
    { code: 'child_friendly',        icon: 'baby',         label: 'Barnevennlig' },
    { code: 'late_hours',            icon: 'moon',         label: 'Åpent kveldstid' },
    { code: 'weekend_hours',         icon: 'calendar',     label: 'Åpent helg' },
    { code: 'free_cancellation_24h', icon: 'shield-check', label: 'Gratis avbestilling 24t før' },
  ];

  var byCode = {};
  CATALOG.forEach(function (a) { byCode[a.code] = a; });

  global.NailedAmenities = {
    catalog: CATALOG,
    get: function (code) { return byCode[code] || null; },
  };

  // Norwegian weekday names, indexed by ISO day-of-week (1=Mon … 7=Sun).
  global.NailedWeekdays = {
    long: ['', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'],
    short: ['', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'],
    // Convert JS getDay() (0=Sun…6=Sat) to ISO (1=Mon…7=Sun)
    todayIso: function () {
      var d = (new Date()).getDay();
      return d === 0 ? 7 : d;
    },
  };
})(window);
