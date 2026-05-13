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

  var HIDE_ON = ['auth-complete', 'confirmation', 'bli-salong'];

  function currentPage() {
    var p = location.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    return p || 'index';
  }

  function shouldRender() {
    var page = currentPage();
    if (page.indexOf('admin') === 0) return false;
    return HIDE_ON.indexOf(page) === -1;
  }

  function isLoggedIn() {
    return !!(window.NailedAuth && window.NailedAuth.isLoggedIn && window.NailedAuth.isLoggedIn());
  }

  // Salong-modus: hvis brukeren er logget inn som salon_owner. Admin og kunde
  // får begge kunde-nav-en.
  function activeRole() {
    if (!isLoggedIn()) return 'customer';
    var r = window.NailedAuth.getRole && window.NailedAuth.getRole();
    return r === 'salon_owner' ? 'salon' : 'customer';
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
    { key: 'favoritter', label: 'Favoritter', href: '/favoritter',                    svg: SVG.heart },
    { key: 'bookinger',  label: 'Bookinger',  href: '/kunde-panel#tab-bookinger',     svg: SVG.calendar, requiresAuth: true },
    { key: 'meldinger',  label: 'Meldinger',  href: '/kunde-panel#tab-meldinger',     svg: SVG.message,  requiresAuth: true },
    { key: 'profil',     label: 'Profil',     href: '/kunde-panel#tab-profil',        svg: SVG.user },
  ];

  var ITEMS_SALON = [
    { key: 'hjem',       label: 'Hjem',       href: '/salong-panel#tab-dashboard',    svg: SVG.home },
    { key: 'bookinger',  label: 'Bookinger',  href: '/salong-panel#tab-bookinger',    svg: SVG.calendar },
    { key: 'kunder',     label: 'Kunder',     href: '/salong-panel#tab-kunder',       svg: SVG.users },
    { key: 'meldinger',  label: 'Meldinger',  href: '/salong-panel#tab-meldinger',    svg: SVG.message },
    { key: 'profil',     label: 'Profil',     href: '/salong-panel#tab-innstillinger', svg: SVG.user },
  ];

  function visibleItems() {
    var role = activeRole();
    if (role === 'salon') return ITEMS_SALON;

    // Kunde-modus: filtrer på auth + omdiriger Profil til login når utlogget
    var loggedIn = isLoggedIn();
    return ITEMS_CUSTOMER.filter(function (it) {
      return !it.requiresAuth || loggedIn;
    }).map(function (it) {
      if (it.key === 'profil' && !loggedIn) {
        return Object.assign({}, it, { href: '/login', label: 'Logg inn' });
      }
      return it;
    });
  }

  function activeKey() {
    var page = currentPage();
    var hash = location.hash;
    var role = activeRole();

    if (role === 'salon') {
      if (page === 'salong-panel') {
        if (hash === '#tab-bookinger') return 'bookinger';
        if (hash === '#tab-kunder')    return 'kunder';
        if (hash === '#tab-meldinger') return 'meldinger';
        if (hash === '#tab-innstillinger' || hash === '#tab-tjenester' ||
            hash === '#tab-analyse' || hash === '#tab-anmeldelser') return 'profil';
        return 'hjem'; // dashboard, default
      }
      return null;
    }

    // Kunde-rute
    if (page === 'utforsk')    return 'utforsk';
    if (page === 'favoritter') return 'favoritter';
    if (page === 'kunde-panel') {
      if (hash === '#tab-meldinger') return 'meldinger';
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
      }
      return (
        '<a class="' + cls + '" href="' + item.href + '" data-key="' + item.key + '">' +
          '<span class="bottom-nav__icon">' + item.svg + badge + '</span>' +
          '<span class="bottom-nav__label">' + item.label + '</span>' +
        '</a>'
      );
    }).join('');
    return '<nav class="bottom-nav" id="bottomNav" aria-label="Hovedmeny">' + items + '</nav>';
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

  // Speil in-page meldinger-badge (#msgUnreadBadge) til bottom-nav-badge.
  function syncMsgBadge() {
    var src = document.getElementById('msgUnreadBadge');
    var dst = document.getElementById('bnMsgBadge');
    if (!src || !dst) return;
    var count = (src.textContent || '').trim();
    if (count && count !== '0' && !src.hidden) {
      dst.textContent = count;
      dst.hidden = false;
    } else {
      dst.hidden = true;
    }
  }

  function observeBadge() {
    var src = document.getElementById('msgUnreadBadge');
    if (!src) return;
    new MutationObserver(syncMsgBadge).observe(src, {
      attributes: true, childList: true, characterData: true, subtree: true,
    });
  }

  if (document.readyState !== 'loading') {
    render();
    observeBadge();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      render();
      observeBadge();
    });
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('spa:navigated', function () {
    render();
    observeBadge();
  });
  window.addEventListener('storage', function (e) {
    if (e.key === 'nailed.accessToken' || e.key === 'nailed.role') render();
  });
})();
