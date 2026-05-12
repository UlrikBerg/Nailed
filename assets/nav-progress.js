// Tynn fremgangsstripe i toppen av siden under SPA-navigasjon.
// Lytter på spa:loading (start) og spa:navigated (slutt) fra spa-nav.js.
//
// Atferd:
//   1. Ved start: animer bredden raskt til 80 % (føles responsivt)
//   2. Ved slutt: animer til 100 % og fade ut

(function () {
  if (window.__nailedNavProgress) return;
  window.__nailedNavProgress = true;

  var bar = null;
  var hideTimer = null;

  function ensureStyles() {
    if (document.getElementById('nailed-nav-progress-styles')) return;
    var s = document.createElement('style');
    s.id = 'nailed-nav-progress-styles';
    s.textContent =
      '.nailed-progress{position:fixed;top:0;left:0;height:2px;width:0;' +
      'background:var(--rouge-500,#EE3F7E);z-index:9998;' +
      'transition:width .25s cubic-bezier(.22,.61,.36,1),opacity .2s ease-out;' +
      'box-shadow:0 0 8px rgba(238,63,126,.6);}';
    document.head.appendChild(s);
  }

  function ensureBar() {
    ensureStyles();
    if (bar && bar.isConnected) return bar;
    bar = document.createElement('div');
    bar.className = 'nailed-progress';
    document.body.appendChild(bar);
    return bar;
  }

  function start() {
    clearTimeout(hideTimer);
    var b = ensureBar();
    b.style.opacity = '1';
    b.style.width = '0';
    // Force layout så transition fyrer
    void b.offsetWidth;
    b.style.width = '80%';
  }

  function done() {
    if (!bar) return;
    bar.style.width = '100%';
    hideTimer = setTimeout(function () {
      if (!bar) return;
      bar.style.opacity = '0';
      hideTimer = setTimeout(function () {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        bar = null;
      }, 220);
    }, 180);
  }

  window.addEventListener('spa:loading', start);
  window.addEventListener('spa:navigated', done);
})();
