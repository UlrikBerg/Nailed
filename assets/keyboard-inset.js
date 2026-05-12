// Mobil-tastatur-håndtering via visualViewport API.
//
// Setter CSS-variabel --kb-inset på <html> til høyden av on-screen-tastaturet
// (px). Når tastaturet åpner seg blir verdien typisk 280-340 px på mobil. Når
// det lukkes går den til 0.
//
// CSS kan bruke variabelen til å løfte sticky elementer over tastaturet:
//   padding-bottom: var(--kb-inset, 0px);
//
// Faller stille tilbake til 0 på enheter uten visualViewport-støtte
// (eldre iOS < 13, Android-WebView < 61). De har ingen tastatur-overlap
// allikevel siden de bruker «resize» og endrer layout-viewport.

(function () {
  if (window.__nailedKbInset) return;
  window.__nailedKbInset = true;

  if (!window.visualViewport) return;

  var root = document.documentElement;
  var lastInset = 0;

  function update() {
    // window.innerHeight = layout viewport, visualViewport.height = visuelt
    // synlig område. Differansen er tastatur + browser-chrome.
    // Vi runder ned så små verdier (browser-chrome scroll) ignoreres.
    var diff = window.innerHeight - window.visualViewport.height;
    var inset = diff > 80 ? Math.round(diff) : 0;
    if (inset !== lastInset) {
      lastInset = inset;
      root.style.setProperty('--kb-inset', inset + 'px');
      // Body-klasse for CSS-handlere som bare bryr seg om åpen/lukket
      // (f.eks. skjul bottom-nav når tastaturet er åpent).
      document.body.classList.toggle('has-kb', inset > 0);
      // Trigger custom event så JS-handlers kan reagere (f.eks. scroll-to-bottom).
      window.dispatchEvent(new CustomEvent('nailed:kb-inset', { detail: { inset: inset } }));
    }
  }

  window.visualViewport.addEventListener('resize', update);
  window.visualViewport.addEventListener('scroll', update);
  update();
})();
