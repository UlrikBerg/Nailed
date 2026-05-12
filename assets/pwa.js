// PWA-registrering. Inkluderes på alle hovedsider.
//
// 1. Registrerer service worker (sw.js) — gir offline + Add-to-Home-Screen.
// 2. Lytter på «beforeinstallprompt» og lagrer eventet, så vi kan trigge
//    install fra en egen «Legg til på startskjerm»-knapp senere.

(function () {
  if (window.__nailedPwa) return;
  window.__nailedPwa = true;

  if (!('serviceWorker' in navigator)) return;

  // Registrer SW etter load så vi ikke konkurrerer med first-paint.
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function () { /* Best-effort — fail silent på utvikling */ });
  });

  // Lagrer install-prompten så vi kan vise vår egen knapp på et passende tidspunkt.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__nailedInstallPrompt = e;
    // Eventet plukkes opp av sider som vil vise sin egen install-CTA.
    window.dispatchEvent(new CustomEvent('nailed:installable'));
  });
})();
