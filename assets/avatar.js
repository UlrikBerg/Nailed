// Gradient-initialer for avatarer uten bilde. Hver navn får sin egen pastel-
// gradient fra en kuratert brand-vennlig palett. Hash baserer seg på navnet
// så samme person alltid får samme farge.

(function (global) {
  if (global.NailedAvatar) return;

  // 6 gradienter fra brand-tonene: rosa, peach, sand, lavender, sage, coral.
  // Mørkere ende dyp nok til at hvit tekst leses bra på toppen.
  var PALETTES = [
    ['#FFE0E9', '#EE3F7E'], // rosa (brand)
    ['#FFE9D6', '#E89465'], // peach
    ['#F4E5D2', '#C9966B'], // sand
    ['#E5DEFA', '#9785D8'], // lavender
    ['#DDE3D2', '#7B9E5C'], // sage
    ['#F5D7C0', '#D4724F'], // coral
  ];

  function hashOf(name) {
    var n = String(name || '?');
    var h = 0;
    for (var i = 0; i < n.length; i++) {
      h = ((h << 5) - h) + n.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function gradientFor(name) {
    var pair = PALETTES[hashOf(name) % PALETTES.length];
    return 'linear-gradient(135deg, ' + pair[0] + ' 0%, ' + pair[1] + ' 100%)';
  }

  function initialsOf(name) {
    var n = String(name || '').trim();
    if (!n) return '?';
    var parts = n.split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p[0].toUpperCase(); }).join('');
  }

  global.NailedAvatar = {
    gradientFor: gradientFor,
    initialsOf: initialsOf,
  };
})(window);
