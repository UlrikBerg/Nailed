// Bottom navigation for mobile (< 720px). Primær-navigasjon per rolle.
//
// Auto-injiserer en <nav class="bottom-nav"> i bunnen av <body>. Skipper
// fokuserte sider (login, auth-complete, confirmation, bli-salong, admin/*)
// hvor en persistent nav stjeler oppmerksomhet fra én konkret handling.
//
// To rollebaserte sett:
//   - kunde: Utforsk · Favoritter · Bookinger · Meldinger · Profil
//   - salong: Hjem · Bookinger · Kunder · Meldinger · Profil
//
// Aktiv rolle hentes fra NailedAuth.getRole() (salon_owner → salong, ellers
// kunde). Re-render kjøres på spa:navigated, hashchange og storage-events.

(function () {
  if (window.__nailedBottomNav) return;
  window.__nailedBottomNav = true;

  var HIDE_ON = ['login', 'auth-complete', 'confirmation', 'bli-salong'];
  // Hvilken sub-side under /admin/ vi viser bottom-nav på (resten skipper)
  var ADMIN_HIDE_PATHS = []; // tom: alle admin-sider får bottom-nav

  function currentPage() {
    var p = location.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    return p || 'index';
  }

  function shouldRender() {
    var page = currentPage();
    if (page.indexOf('admin') === 0) {
      return ADMIN_HIDE_PATHS.indexOf(page) === -1;
    }
    return HIDE_ON.indexOf(page) === -1;
  }

  function isLoggedIn() {
    return !!(window.NailedAuth && window.NailedAuth.isLoggedIn && window.NailedAuth.isLoggedIn());
  }

  // Aktiv rolle = hvilken panel-kontekst brukeren er i, basert på URL.
  // Slik bytter bottom-nav automatisk når man navigerer mellom panel.
  function activeRole() {
    var page = currentPage();
    if (page === 'salong-panel') return 'salon';
    if (page.indexOf('admin') === 0) return 'admin';
    return 'customer';
  }

  // Ikon-SVG-er — inline siden lucide har fjernet brand-ikoner og vi vil
  // unngå nye script-avhengigheter for bottom-nav.
  var SVG = {
    search:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    heart:    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    calendar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    message:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    user:     '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    home:     '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    users:    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  };

  var ITEMS_CUSTOMER = [
    { key: 'utforsk',    label: 'Utforsk',    href: '/utforsk',                       svg: SVG.search },
    { key: 'bookinger',  label: 'Bookinger',  href: '/kunde-panel#tab-bookinger',     svg: SVG.calendar, requiresAuth: true },
    { key: 'favoritter', label: 'Favoritter', href: '/favoritter',                    svg: SVG.heart },
    { key: 'profil',     label: 'Min profil', href: '/kunde-panel#tab-profil',        svg: SVG.user },
  ];

  var ITEMS_SALON = [
    { key: 'dashboard',  label: 'Dashboard',  href: '/salong-panel#tab-dashboard',    svg: SVG.home },
    { key: 'minsalong',  label: 'Min salong', href: '/salong-panel#tab-profil',       svg: SVG.users },
    { key: 'bookinger',  label: 'Bookinger',  href: '/salong-panel#tab-bookinger',    svg: SVG.calendar },
    { key: 'profil',     label: 'Min profil', href: '/salong-panel#tab-innstillinger', svg: SVG.user },
  ];

  // Admin-nav: 5 viktigste tabs i admin-panelet
  var ITEMS_ADMIN = [
    { key: 'dashboard',  label: 'Oversikt',   href: '/admin/#tab-dashboard',  svg: SVG.home },
    { key: 'salonger',   label: 'Salonger',   href: '/admin/#tab-salonger',   svg: SVG.users },
    { key: 'bookinger',  label: 'Bookinger',  href: '/admin/#tab-bookinger',  svg: SVG.calendar },
    { key: 'moderering', label: 'Moderering', href: '/admin/#tab-moderering', svg: SVG.message },
    { key: 'profil',     label: 'Profil',     href: '/admin/#tab-innstillinger', svg: SVG.user },
  ];

  // Hent fornavn fra cachet brukerdata (lagt der av /assets/nav.js).
  // Brukes som label på profil-item i bottom-nav når brukeren er logget inn.
  function firstName() {
    try {
      var raw = localStorage.getItem('nailed.user');
      if (!raw) return '';
      var u = JSON.parse(raw);
      return (u && u.name ? u.name.trim().split(/\s+/)[0] : '') || '';
    } catch (_) { return ''; }
  }

  function visibleItems() {
    var role = activeRole();
    var loggedIn = isLoggedIn();
    var fn = firstName();

    function withProfileLabel(items) {
      if (!fn) return items;
      return items.map(function (it) {
        if (it.key === 'profil') return Object.assign({}, it, { label: fn });
        return it;
      });
    }

    if (role === 'salon') return withProfileLabel(ITEMS_SALON);
    if (role === 'admin') return withProfileLabel(ITEMS_ADMIN);

    // Kunde-modus: filtrer på auth + omdiriger Profil til login når utlogget
    var customer = ITEMS_CUSTOMER.filter(function (it) {
      return !it.requiresAuth || loggedIn;
    }).map(function (it) {
      if (it.key === 'profil') {
        if (!loggedIn) return Object.assign({}, it, { href: '/login', label: 'Logg inn' });
        if (fn) return Object.assign({}, it, { label: fn });
      }
      return it;
    });
    return customer;
  }

  function activeKey() {
    var page = currentPage();
    var hash = location.hash;
    var role = activeRole();

    if (role === 'salon') {
      if (hash === '#tab-profil')       return 'minsalong';
      if (hash === '#tab-bookinger')    return 'bookinger';
      if (hash === '#tab-innstillinger') return 'profil';
      // tjenester/analyse/anmeldelser/kunder/meldinger faller på Min salong/Profil avhengig
      if (hash === '#tab-tjenester')    return 'minsalong';
      if (hash === '#tab-analyse' || hash === '#tab-anmeldelser' ||
          hash === '#tab-kunder' || hash === '#tab-meldinger') return 'profil';
      return 'dashboard'; // default
    }

    if (role === 'admin') {
      if (hash === '#tab-salonger')    return 'salonger';
      if (hash === '#tab-bookinger')   return 'bookinger';
      if (hash === '#tab-moderering')  return 'moderering';
      if (hash === '#tab-innstillinger') return 'profil';
      return 'dashboard'; // default
    }

    // Kunde-rute
    if (page === 'utforsk')    return 'utforsk';
    if (page === 'favoritter') return 'favoritter';
    if (page === 'kunde-panel') {
      if (hash === '#tab-favoritter') return 'favoritter';
      if (hash === '#tab-profil' || hash === '#tab-innstillinger') return 'profil';
      return 'bookinger';
    }
    return null;
  }

  function html() {
    var active = activeKey();
    var items = visibleItems().map(function (item) {
      var cls = 'bottom-nav__item' + (item.key === active ? ' bottom-nav__item--active' : '');
      var badge = '';
      if (item.key === 'meldinger') {
        badge = '<span class="bottom-nav__badge" id="bnMsgBadge" hidden></span>';
      } else if (item.key === 'bookinger') {
        badge = '<span class="bottom-nav__badge" id="bnBookingsBadge" hidden></span>';
      } else if (item.key === 'profil' || item.key === 'minsalong') {
        badge = '<span class="bottom-nav__badge bottom-nav__badge--dot" id="bnAlertsBadge" hidden></span>';
      } else if (item.key === 'moderering') {
        badge = '<span class="bottom-nav__badge" id="bnModBadge" hidden></span>';
      }
      return (
        '<a class="' + cls + '" href="' + item.href + '" data-key="' + item.key + '">' +
          '<span class="bottom-nav__icon">' + item.svg + badge + '</span>' +
          '<span class="bottom-nav__label">' + item.label + '</span>' +
        '</a>'
      );
    }).join('');
    return '<nav class="bottom-nav" id="bottomNav" data-spa-persist="true" aria-label="Hovedmeny">' + items + '</nav>';
  }

  function render() {
    if (!shouldRender()) {
      var existing = document.getElementById('bottomNav');
      if (existing) existing.remove();
      document.body.classList.remove('has-bottom-nav');
      return;
    }
    var el = document.getElementById('bottomNav');
    if (el) el.remove();
    document.body.insertAdjacentHTML('beforeend', html());
    document.body.classList.add('has-bottom-nav');
    syncMsgBadge();
  }

  // Oppdater kun aktiv-klassen på eksisterende items — uten å re-rendere
  // hele nav-en. Brukes når man bytter tab/side innen samme rolle.
  function updateActive() {
    var nav = document.getElementById('bottomNav');
    if (!nav) return;
    var key = activeKey();
    nav.querySelectorAll('.bottom-nav__item').forEach(function (a) {
      a.classList.toggle('bottom-nav__item--active', a.getAttribute('data-key') === key);
    });
  }

  // Bestem om vi trenger full re-render (rolle endret, login-state for kunde
  // endret, shouldRender flipped, eller nav-noden er fjernet av SPA-swap)
  // — ellers oppdater bare active-state. spa-nav.js wiper alt utenom
  // header.top-nav ved navigasjon, så bottom-nav forsvinner og må re-mountes.
  var lastRole = null;
  var lastShouldRender = null;
  var lastLoggedIn = null;
  function syncOrRender() {
    var should = shouldRender();
    var role = activeRole();
    var loggedIn = isLoggedIn();
    var navExists = !!document.getElementById('bottomNav');
    var needsRender = (
      should !== lastShouldRender ||
      role !== lastRole ||
      (role === 'customer' && loggedIn !== lastLoggedIn) ||
      (should && !navExists)
    );
    lastShouldRender = should;
    lastRole = role;
    lastLoggedIn = loggedIn;
    if (needsRender) {
      render();
    } else if (should) {
      updateActive();
    }
  }

  // Speil in-page badges til bottom-nav-badges. Brukes for meldinger
  // (msgUnreadBadge), bookinger (bookingsPendingBadge) og admin-moderering
  // (chatReportsBadge). Genererisk så det er enkelt å legge til flere.
  function mirrorBadge(srcId, dstId) {
    var src = document.getElementById(srcId);
    var dst = document.getElementById(dstId);
    if (!dst) return;
    if (!src) { dst.hidden = true; return; }
    var count = (src.textContent || '').trim();
    if (count && count !== '0' && !src.hidden) {
      dst.textContent = count;
      dst.hidden = false;
    } else {
      dst.hidden = true;
    }
  }
  function syncAllBadges() {
    mirrorBadge('msgUnreadBadge',       'bnMsgBadge');
    mirrorBadge('bookingsPendingBadge', 'bnBookingsBadge');
    mirrorBadge('chatReportsBadge',     'bnModBadge');
    // «Alerts»-dot på profil-item: lyser hvis noen av handlingene har badge
    syncAlertsDot();
  }
  function syncAlertsDot() {
    var dot = document.getElementById('bnAlertsBadge');
    if (!dot) return;
    var any = ['msgUnreadBadge', 'bookingsPendingBadge', 'chatReportsBadge']
      .some(function (id) {
        var el = document.getElementById(id);
        return el && !el.hidden && (el.textContent || '').trim() && (el.textContent || '').trim() !== '0';
      });
    dot.hidden = !any;
  }
  // Bakoverkompatibelt alias
  function syncMsgBadge() { syncAllBadges(); }

  function observeBadge() {
    ['msgUnreadBadge', 'bookingsPendingBadge', 'chatReportsBadge'].forEach(function (id) {
      var src = document.getElementById(id);
      if (!src) return;
      new MutationObserver(syncAllBadges).observe(src, {
        attributes: true, childList: true, characterData: true, subtree: true,
      });
    });
  }

  // Hent /me/actions så bottom-nav-badges fungerer på enhver side (ikke
  // bare på sidene som har in-page badge-elementer). Polles hvert minutt.
  function setBadge(dstId, count) {
    var dst = document.getElementById(dstId);
    if (!dst) return;
    if (count > 0) {
      dst.textContent = count > 99 ? '99+' : String(count);
      dst.hidden = false;
    } else {
      dst.hidden = true;
    }
  }
  function applyActionsToBadges(c) {
    if (!c) return;
    setBadge('bnMsgBadge', c.messages || 0);
    setBadge('bnBookingsBadge', c.salon_bookings_pending || 0);
    setBadge('bnModBadge', c.chat_reports_pending || 0);
    syncAlertsDot();
  }
  function fetchActionsAndApply() {
    if (!isLoggedIn() || !window.NailedAuth || !NailedAuth.api) return;
    NailedAuth.api('/api/v1/me/actions').then(function (res) {
      if (!res.ok) return;
      return res.json();
    }).then(function (data) {
      if (data) applyActionsToBadges(data);
    }).catch(function () {});
  }
  setInterval(fetchActionsAndApply, 60 * 1000);

  // ---------------------------------------------------------------------------
  // Profil-sheet: åpnes når man trykker «Min profil» / «Profil» i bottom-nav.
  // Viser navn + e-post + raske paneler-snarveier + logg ut. Animert slide-up.
  // ---------------------------------------------------------------------------
  var sheetUser = null;

  function ensureSheet() {
    if (document.getElementById('bnProfileSheet')) return;
    var backdrop = '<div class="bn-sheet-backdrop" id="bnProfileBackdrop" data-spa-persist="true"></div>';
    var sheet =
      '<div class="bn-sheet" id="bnProfileSheet" data-spa-persist="true" role="dialog" aria-modal="true" aria-labelledby="bnProfileName" hidden>' +
        '<div class="bn-sheet__grabber"></div>' +
        '<div class="bn-sheet__head">' +
          '<div class="bn-sheet__avatar" id="bnProfileAvatar">?</div>' +
          '<div class="bn-sheet__info">' +
            '<div class="bn-sheet__name" id="bnProfileName">—</div>' +
            '<div class="bn-sheet__email" id="bnProfileEmail">—</div>' +
          '</div>' +
        '</div>' +
        '<div class="bn-sheet__actions">' +
          '<a class="bn-sheet__action" href="/kunde-panel#tab-profil" data-bn-action="nav">' +
            '<i data-lucide="user"></i><span>Kundeprofil</span>' +
          '</a>' +
          '<a class="bn-sheet__action" href="/salong-panel" id="bnGoSalon" data-bn-action="nav" hidden>' +
            '<i data-lucide="store"></i><span>Salongprofil</span>' +
          '</a>' +
          '<a class="bn-sheet__action" href="/admin/" id="bnGoAdmin" data-bn-action="nav" hidden>' +
            '<i data-lucide="shield"></i><span>Adminpanel</span>' +
          '</a>' +
          '<button class="bn-sheet__action bn-sheet__action--danger" type="button" id="bnLogout">' +
            '<i data-lucide="log-out"></i><span>Logg ut</span>' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', backdrop + sheet);

    document.getElementById('bnProfileBackdrop').addEventListener('click', closeSheet);
    document.getElementById('bnLogout').addEventListener('click', async function () {
      try { await window.NailedAuth.logout(); } catch (_) {}
      window.location.replace('/');
    });
    // Lukk når en av navigasjonslenkene klikkes (sheet'en glir ned før page-bytte)
    document.querySelectorAll('#bnProfileSheet [data-bn-action="nav"]').forEach(function (a) {
      a.addEventListener('click', function () { closeSheet(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });

    // Swipe-down-to-dismiss: dra hvor som helst på sheet'en nedover for å lukke.
    // Aktiveres etter > 8 px bevegelse så vanlige tapps på knapper ikke fanges.
    (function attachDrag() {
      var sheet = document.getElementById('bnProfileSheet');
      var backdrop = document.getElementById('bnProfileBackdrop');
      if (!sheet) return;
      var startY = 0;
      var delta = 0;
      var dragging = false;

      function onStart(e) {
        if (!sheet.classList.contains('bn-sheet--open')) return;
        startY = (e.touches ? e.touches[0].clientY : e.clientY);
        delta = 0;
        dragging = false;
      }
      function onMove(e) {
        if (startY === 0 && !dragging) return;
        var y = (e.touches ? e.touches[0].clientY : e.clientY);
        var d = y - startY;
        if (!dragging) {
          if (d > 8) {
            dragging = true;
            sheet.style.transition = 'none';
            backdrop.style.transition = 'none';
          } else if (d < -8) {
            // Trekk oppover — ignorér helt
            startY = 0;
            return;
          } else {
            return;
          }
        }
        if (d < 0) d = 0; // ingen oppovertrekk
        delta = d;
        sheet.style.transform = 'translateY(' + d + 'px)';
        var maxDelta = sheet.offsetHeight || 400;
        var opacity = Math.max(0, 1 - d / maxDelta);
        backdrop.style.opacity = String(opacity);
      }
      function onEnd() {
        if (!dragging) { startY = 0; return; }
        dragging = false;
        startY = 0;
        sheet.style.transition = '';
        backdrop.style.transition = '';
        backdrop.style.opacity = '';
        var threshold = Math.max(100, sheet.offsetHeight * 0.25);
        if (delta > threshold) {
          // Lukk — fjern inline transform så CSS-overgangen kan ta over
          sheet.style.transform = '';
          closeSheet();
        } else {
          // Sprett tilbake
          sheet.style.transform = '';
        }
        delta = 0;
      }

      sheet.addEventListener('touchstart', onStart, { passive: true });
      sheet.addEventListener('touchmove',  onMove,  { passive: true });
      sheet.addEventListener('touchend',   onEnd);
      sheet.addEventListener('touchcancel', onEnd);
    })();

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (_) {}
    }
  }

  async function openSheet() {
    ensureSheet();
    var sheet = document.getElementById('bnProfileSheet');
    var backdrop = document.getElementById('bnProfileBackdrop');
    if (!sheet || !backdrop) return;

    // Hent brukerinfo (én gang per sidelevetid; oppdater på nytt åpning hvis blank).
    if (!sheetUser && window.NailedAuth && window.NailedAuth.api) {
      try {
        var res = await window.NailedAuth.api('/api/v1/me');
        if (res.ok) {
          var data = await res.json();
          sheetUser = data.user || null;
        }
      } catch (_) { /* ignore */ }
    }

    var u = sheetUser || {};
    document.getElementById('bnProfileName').textContent  = u.name  || 'Du';
    document.getElementById('bnProfileEmail').textContent = u.email || '';
    var initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    document.getElementById('bnProfileAvatar').textContent = initial || '?';

    var role = u.role || (window.NailedAuth && window.NailedAuth.getRole && window.NailedAuth.getRole()) || 'customer';
    document.getElementById('bnGoSalon').hidden = !(role === 'salon_owner' || role === 'admin');
    document.getElementById('bnGoAdmin').hidden = role !== 'admin';

    // Vis først (hidden → false), så på neste frame trigger transition.
    sheet.hidden = false;
    requestAnimationFrame(function () {
      backdrop.classList.add('bn-sheet-backdrop--open');
      sheet.classList.add('bn-sheet--open');
    });
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    var sheet = document.getElementById('bnProfileSheet');
    var backdrop = document.getElementById('bnProfileBackdrop');
    if (!sheet || !backdrop) return;
    sheet.classList.remove('bn-sheet--open');
    backdrop.classList.remove('bn-sheet-backdrop--open');
    document.body.style.overflow = '';
    // Etter transition: skjul helt så fokus ikke ligger fanget.
    setTimeout(function () {
      if (!sheet.classList.contains('bn-sheet--open')) sheet.hidden = true;
    }, 280);
  }

  // Fang klikk på «Profil»-item — kun når innlogget. Utlogget → la /login-lenken navigere.
  document.addEventListener('click', function (e) {
    var item = e.target.closest && e.target.closest('.bottom-nav__item[data-key="profil"]');
    if (!item) return;
    if (!isLoggedIn()) return; // ulogget → href=/login
    e.preventDefault();
    openSheet();
  });

  // Tøm cachet brukerinfo ved logg ut / token-bytte, slik at neste åpning re-fetcher.
  window.addEventListener('storage', function (e) {
    if (e.key === 'nailed.accessToken') sheetUser = null;
  });

  if (document.readyState !== 'loading') {
    syncOrRender();
    observeBadge();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      syncOrRender();
      observeBadge();
    });
  }

  window.addEventListener('hashchange', syncOrRender);
  window.addEventListener('spa:navigated', function () {
    syncOrRender();
    observeBadge();
  });
  window.addEventListener('storage', function (e) {
    if (e.key === 'nailed.accessToken' || e.key === 'nailed.role') syncOrRender();
  });
  // Når nav.js har lastet brukerdata, oppdater label på profil-item så
  // den viser fornavn i stedet for «Min profil».
  window.addEventListener('nailed:user', function () { render(); });
})();
