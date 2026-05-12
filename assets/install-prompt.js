// Diskret «Installer Nailed»-banner på mobil-nettleser som støtter PWA-install
// (Android Chrome, Edge). iOS Safari fyrer ikke beforeinstallprompt — for dem
// kommer en egen hint senere med Share → «Legg til på Hjem-skjerm».
//
// UX-regler:
//   - Vis bare på mobil (< 720 px)
//   - Vis ikke hvis allerede installert (standalone-display)
//   - Vis bare når window.__nailedInstallPrompt finnes (fra pwa.js)
//   - Dismiss varer i 7 dager — vi maser ikke
//   - Skipper login/auth-complete/confirmation/bli-salong (samme som bottom-nav)

(function () {
  if (window.__nailedInstall) return;
  window.__nailedInstall = true;

  var STORAGE_KEY = 'nailed.installDismissed';
  var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  var HIDE_ON = ['login', 'auth-complete', 'confirmation', 'bli-salong'];

  function currentPage() {
    var p = location.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    return p || 'index';
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  function recentlyDismissed() {
    try {
      var ts = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return ts && (Date.now() - ts) < COOLDOWN_MS;
    } catch (_) { return false; }
  }

  function shouldShow() {
    if (!window.__nailedInstallPrompt) return false;
    if (!isMobile()) return false;
    if (isStandalone()) return false;
    if (HIDE_ON.indexOf(currentPage()) !== -1) return false;
    if (currentPage().indexOf('admin') === 0) return false;
    if (recentlyDismissed()) return false;
    if (document.getElementById('installBanner')) return false;
    return true;
  }

  function show() {
    if (!shouldShow()) return;
    var html = '' +
      '<div id="installBanner" class="install-banner" role="region" aria-label="Installer Nailed">' +
        '<div class="install-banner__text">' +
          '<div class="install-banner__title">Få nailed på startskjermen</div>' +
          '<div class="install-banner__desc">Raskere booking, full-screen, ett trykk unna.</div>' +
        '</div>' +
        '<div class="install-banner__actions">' +
          '<button class="install-banner__btn" id="installInstall" type="button">Installer</button>' +
          '<button class="install-banner__close" id="installClose" type="button" aria-label="Lukk">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('installInstall').addEventListener('click', async function () {
      var p = window.__nailedInstallPrompt;
      if (!p) return hide();
      try {
        await p.prompt();
        await p.userChoice;
      } catch (_) {}
      // Etter prompt-en, eventet kan ikke brukes igjen.
      window.__nailedInstallPrompt = null;
      hide();
    });

    document.getElementById('installClose').addEventListener('click', function () {
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
      hide();
    });
  }

  function hide() {
    var el = document.getElementById('installBanner');
    if (el) el.remove();
  }

  // Reager på installable-event fra pwa.js. Hvis eventet allerede har fyrt
  // (f.eks. ved SPA-nav-tilbake), vis umiddelbart.
  window.addEventListener('nailed:installable', show);
  if (window.__nailedInstallPrompt) {
    // Vent litt så top-nav og bottom-nav rekker å rendre.
    setTimeout(show, 600);
  }
})();
