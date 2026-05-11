/* ============================================================================
 * nailed — Cookie Consent Banner
 * ----------------------------------------------------------------------------
 * Norsk samtykke-banner for førstegangsbesøk.
 *
 * Lagrer valget i localStorage som `nailed.cookieConsent`:
 *   { level: 'all' | 'necessary', acceptedAt: ISO string, version: 1 }
 *
 * Banneret vises ikke hvis:
 *   - et gyldig samtykke (under 12 mnd) finnes, eller
 *   - URL-en er i en innlogget seksjon (admin, kunde-panel, salong-panel).
 *
 * Andre script kan lese gjeldende valg via window.NailedCookieConsent.get().
 * ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'nailed.cookieConsent';
  var VERSION = 1;
  var TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

  // -------------------------------------------------------------------------
  // Storage helpers
  // -------------------------------------------------------------------------
  function readConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.version !== VERSION) return null;
      if (!parsed.acceptedAt) return null;
      var acceptedAt = new Date(parsed.acceptedAt).getTime();
      if (isNaN(acceptedAt)) return null;
      if (Date.now() - acceptedAt > TWELVE_MONTHS_MS) return null;
      if (parsed.level !== 'all' && parsed.level !== 'necessary') return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeConsent(level) {
    var payload = {
      level: level,
      acceptedAt: new Date().toISOString(),
      version: VERSION
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      // Fail silently — localStorage may be disabled.
    }
    return payload;
  }

  // -------------------------------------------------------------------------
  // Path gating — don't show on gated/auth flow pages
  // -------------------------------------------------------------------------
  function isGatedPath() {
    var path = (window.location.pathname || '').toLowerCase();
    if (path.indexOf('/admin/') === 0 || path.indexOf('/admin') === 0) return true;
    if (path.indexOf('/kunde-panel') !== -1) return true;
    if (path.indexOf('/salong-panel') !== -1) return true;
    // Mid-flow auth/booking screens — don't pop a consent dialog over them.
    if (path.indexOf('/auth-complete') !== -1) return true;
    if (path.indexOf('/confirmation') !== -1) return true;
    if (path.indexOf('/bli-salong') !== -1) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // CSS — injected so we don't need to touch styles.css
  // -------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('nailed-cookie-banner-styles')) return;
    var style = document.createElement('style');
    style.id = 'nailed-cookie-banner-styles';
    style.textContent = [
      '.nailed-cb {',
      '  position: fixed;',
      '  left: 16px;',
      '  right: 16px;',
      '  bottom: 16px;',
      '  z-index: 9999;',
      '  max-width: 520px;',
      '  margin-left: auto;',
      '  margin-right: auto;',
      '  background: var(--cream-50, #FFFCF7);',
      '  color: var(--ink, #1B1218);',
      '  border: 1px solid var(--stone-200, #ECE8E2);',
      '  border-radius: 14px;',
      '  box-shadow: 0 24px 48px -16px rgba(31, 19, 24, 0.20), 0 6px 12px -6px rgba(31, 19, 24, 0.08);',
      '  padding: 20px;',
      '  font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;',
      '  font-size: 14px;',
      '  line-height: 1.5;',
      '  transform: translateY(120%);',
      '  opacity: 0;',
      '  transition: transform 320ms cubic-bezier(.2,.8,.2,1), opacity 320ms cubic-bezier(.2,.8,.2,1);',
      '}',
      '.nailed-cb.is-visible {',
      '  transform: translateY(0);',
      '  opacity: 1;',
      '}',
      '.nailed-cb__title {',
      '  font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;',
      '  font-weight: 700;',
      '  font-size: 18px;',
      '  margin: 0 0 8px;',
      '  color: var(--ink, #1B1218);',
      '}',
      '.nailed-cb__body {',
      '  margin: 0 0 16px;',
      '  color: var(--ink, #1B1218);',
      '}',
      '.nailed-cb__body a {',
      '  color: var(--rouge-500, #EE3F7E);',
      '  text-decoration: underline;',
      '}',
      '.nailed-cb__actions {',
      '  display: flex;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '.nailed-cb__btn {',
      '  font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;',
      '  font-weight: 600;',
      '  font-size: 14px;',
      '  padding: 10px 18px;',
      '  border-radius: 999px;',
      '  border: 0;',
      '  cursor: pointer;',
      '  transition: background 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms cubic-bezier(.2,.8,.2,1);',
      '}',
      '.nailed-cb__btn--primary {',
      '  background: var(--rouge-500, #EE3F7E);',
      '  color: #fff;',
      '}',
      '.nailed-cb__btn--primary:hover {',
      '  background: var(--rouge-600, #D62469);',
      '  box-shadow: 0 18px 40px -16px rgba(238, 63, 126, 0.45);',
      '}',
      '.nailed-cb__btn--ghost {',
      '  background: transparent;',
      '  color: var(--ink, #1B1218);',
      '  border: 1px solid var(--stone-300, #BCB3A4);',
      '}',
      '.nailed-cb__btn--ghost:hover {',
      '  background: var(--stone-100, #ECE8E2);',
      '}',
      '@media (max-width: 480px) {',
      '  .nailed-cb { left: 12px; right: 12px; bottom: 12px; padding: 16px; }',
      '  .nailed-cb__btn { flex: 1 1 auto; text-align: center; justify-content: center; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Banner DOM
  // -------------------------------------------------------------------------
  function buildBanner() {
    var wrap = document.createElement('div');
    wrap.className = 'nailed-cb';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Samtykke til informasjonskapsler');

    var title = document.createElement('div');
    title.className = 'nailed-cb__title';
    title.textContent = 'Vi bruker informasjonskapsler';
    wrap.appendChild(title);

    var body = document.createElement('p');
    body.className = 'nailed-cb__body';
    body.innerHTML =
      'Vi bruker strengt nødvendige kapsler for at nailed skal fungere, og vil gjerne sette ' +
      'flere for å forbedre tjenesten. Du velger selv. Les mer i vår ' +
      '<a href="/cookies">cookie-erklæring</a> og ' +
      '<a href="/personvern">personvernerklæring</a>.';
    wrap.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'nailed-cb__actions';

    var necessaryBtn = document.createElement('button');
    necessaryBtn.type = 'button';
    necessaryBtn.className = 'nailed-cb__btn nailed-cb__btn--ghost';
    necessaryBtn.textContent = 'Bare nødvendig';
    necessaryBtn.addEventListener('click', function () { acceptAndClose(wrap, 'necessary'); });
    actions.appendChild(necessaryBtn);

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'nailed-cb__btn nailed-cb__btn--primary';
    allBtn.textContent = 'Godta alle';
    allBtn.addEventListener('click', function () { acceptAndClose(wrap, 'all'); });
    actions.appendChild(allBtn);

    wrap.appendChild(actions);
    return wrap;
  }

  function acceptAndClose(wrap, level) {
    writeConsent(level);
    wrap.classList.remove('is-visible');
    setTimeout(function () {
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 360);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  window.NailedCookieConsent = {
    get: function () { return readConsent(); },
    set: function (level) {
      if (level !== 'all' && level !== 'necessary') return null;
      return writeConsent(level);
    },
    clear: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    }
  };

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  function init() {
    if (isGatedPath()) return;
    if (readConsent()) return;
    injectStyles();
    var banner = buildBanner();
    document.body.appendChild(banner);
    // Trigger slide-in on next frame so transition fires.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        banner.classList.add('is-visible');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
