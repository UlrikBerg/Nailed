// Sticky top-nav shrink: legger til .scrolled på #topNav når man scroller
// ned, fjerner den når man scroller opp til toppen. Bruker deadband
// (40 ned / 10 opp) for å unngå flicker når header-høyden endrer seg og
// scrollY hopper litt rundt terskelen.
//
// I paneler (kunde/salong/admin) skal headeren være kompakt hele tida på
// mobil — der låses .scrolled på under 720 px og deadband-en gjelder kun
// desktop. Pages-flagget `data-topnav-mode="panel"` på <body> styrer dette.

(function () {
  if (window.__nailedTopNavScroll) return;
  window.__nailedTopNavScroll = true;

  var mq = window.matchMedia('(max-width: 720px)');

  function currentMode() {
    return document.body.getAttribute('data-topnav-mode') || 'public';
  }

  function update() {
    var nav = document.getElementById('topNav');
    if (!nav) return;
    // Paneler på mobil: alltid kompakt
    if (currentMode() === 'panel' && mq.matches) {
      nav.classList.add('scrolled');
      return;
    }
    var y = window.scrollY;
    var on = nav.classList.contains('scrolled');
    if (!on && y > 40)      nav.classList.add('scrolled');
    else if (on && y < 10)  nav.classList.remove('scrolled');
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('spa:navigated', update);
  if (mq.addEventListener) mq.addEventListener('change', update);
  update();
})();
