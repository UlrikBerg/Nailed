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
          '<a class="footer__social" href="https://instagram.com/nailed.no" target="_blank" rel="noopener" aria-label="Instagram @nailed.no">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>' +
          '</a>' +
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
