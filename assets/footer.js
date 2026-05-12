// Felles footer for alle offentlige sider.
//
// Bruk: legg <footer id="siteFooter"></footer> i HTML, og inkluder dette scriptet.
// Scriptet fyller inn markupen og kjører på nytt etter SPA-nav (spa:navigated-event).
//
// Hvorfor ikke server-side include? Vi serverer statiske HTML-filer via Express
// uten template-motor. JS-injeksjon holder filene rene og lar oss endre footer
// ett sted.

(function () {
  if (window.__nailedFooter) return;
  window.__nailedFooter = true;

  var FOOTER_HTML = '' +
    '<div class="page footer__inner">' +
      '<div class="footer__top">' +
        '<img src="/assets/logo-wordmark.svg?v=6" alt="nailed" class="footer__brand" />' +
        '<div class="footer__socials">' +
          '<a class="footer__social" href="#" aria-label="Instagram"><i data-lucide="instagram"></i></a>' +
          '<a class="footer__social" href="#" aria-label="TikTok"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.17a8.16 8.16 0 004.76 1.51v-3.45a4.85 4.85 0 01-1-.54z"/></svg></a>' +
          '<a class="footer__social" href="#" aria-label="Facebook"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.408.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.324V1.325C24 .593 23.407 0 22.675 0z"/></svg></a>' +
        '</div>' +
      '</div>' +
      '<div class="footer__links">' +
        '<a href="/utforsk">Utforsk</a>' +
        '<a href="/for-salonger">For salonger</a>' +
        '<a href="/last-ned-app">Last ned app</a>' +
        '<a href="/om-oss">Om oss</a>' +
        '<a href="/personvern">Personvern</a>' +
        '<a href="/vilkar">Bruksvilkår</a>' +
        '<a href="/cookies">Cookies</a>' +
        '<a href="/kontakt">Kontakt oss</a>' +
      '</div>' +
      '<div class="footer__bottom">' +
        '<small>&copy; 2026 Nailed av Berg Event &middot; Made in Oslo</small>' +
        '<div class="footer__badges">' +
          '<span class="footer__badge"><i data-lucide="smartphone" style="width:12px;height:12px;"></i> App Store — juni</span>' +
          '<span class="footer__badge"><i data-lucide="smartphone" style="width:12px;height:12px;"></i> Google Play — juli</span>' +
        '</div>' +
      '</div>' +
    '</div>';

  function render() {
    var el = document.getElementById('siteFooter');
    if (!el) return;
    el.className = 'footer';
    el.innerHTML = FOOTER_HTML;
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  }

  if (document.readyState !== 'loading') render();
  else document.addEventListener('DOMContentLoaded', render);

  // SPA-nav: ny side har en tom <footer id="siteFooter"> som må fylles på nytt.
  window.addEventListener('spa:navigated', render);
})();
