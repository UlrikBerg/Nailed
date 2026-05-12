// Diskret «Installer Nailed»-banner på mobil.
//   - Android Chrome/Edge: bruker beforeinstallprompt-eventet til å trigge
//     innfødt install-flyt («Installer»-knapp).
//   - iOS Safari: fyrer ikke eventet. I stedet viser vi en hint-modus med
//     «Tap Share → Legg til på Hjem-skjerm»-instruks.
//
// UX-regler:
//   - Vis bare på mobil (< 720 px)
//   - Vis ikke hvis allerede installert (standalone-display)
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

  function isIOS() {
    // iPad fra iOS 13+ rapporterer Mac i UA — sjekk maxTouchPoints for å fange.
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function isIOSSafari() {
    if (!isIOS()) return false;
    var ua = navigator.userAgent || '';
    // Ekskluder Chrome/Firefox/Edge på iOS — de støtter ikke Add-to-Home fra Share.
    return !/CriOS|FxiOS|EdgiOS/.test(ua);
  }

  function recentlyDismissed() {
    try {
      var ts = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return ts && (Date.now() - ts) < COOLDOWN_MS;
    } catch (_) { return false; }
  }

  function shouldShow(mode) {
    if (!isMobile()) return false;
    if (isStandalone()) return false;
    if (HIDE_ON.indexOf(currentPage()) !== -1) return false;
    if (currentPage().indexOf('admin') === 0) return false;
    if (recentlyDismissed()) return false;
    if (document.getElementById('installBanner')) return false;
    if (mode === 'android') return !!window.__nailedInstallPrompt;
    if (mode === 'ios') return isIOSSafari();
    return false;
  }

  function showAndroid() {
    if (!shouldShow('android')) return;
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

  // iOS Safari fyrer ikke beforeinstallprompt. Vis en hint med instruksjon
  // som peker mot Share-knappen («Legg til på Hjem-skjerm»).
  function showIOS() {
    if (!shouldShow('ios')) return;
    var html = '' +
      '<div id="installBanner" class="install-banner install-banner--ios" role="region" aria-label="Legg Nailed til på startskjerm">' +
        '<div class="install-banner__text">' +
          '<div class="install-banner__title">Få nailed på startskjermen</div>' +
          '<div class="install-banner__desc">Trykk på ' +
            '<svg class="install-banner__share" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>' +
            ' og velg «Legg til på Hjem-skjerm».</div>' +
        '</div>' +
        '<button class="install-banner__close" id="installClose" type="button" aria-label="Lukk">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
        '</button>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('installClose').addEventListener('click', function () {
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
      hide();
    });
  }

  function hide() {
    var el = document.getElementById('installBanner');
    if (el) el.remove();
  }

  // Android: reager på installable-event fra pwa.js.
  window.addEventListener('nailed:installable', showAndroid);
  if (window.__nailedInstallPrompt) {
    setTimeout(showAndroid, 600);
  }

  // iOS: vent på DOM, så vis hint etter litt forsinkelse så top-nav rekker
  // å rendre først.
  function maybeShowIOS() {
    if (!isIOSSafari()) return;
    setTimeout(showIOS, 800);
  }
  if (document.readyState !== 'loading') maybeShowIOS();
  else document.addEventListener('DOMContentLoaded', maybeShowIOS);
})();
