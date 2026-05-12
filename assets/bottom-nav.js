// Bottom navigation for mobile (< 720px). Kundens primær-navigasjon.
//
// Auto-injiserer en <nav class="bottom-nav"> i bunnen av <body>. Skipper
// fokuserte sider (login, auth-complete, confirmation, bli-salong, admin/*)
// hvor en persistent nav stjeler oppmerksomhet fra én konkret handling.
//
// Aktiv state matches på pathname + hash. Re-render kjøres på spa:navigated
// (pjax-nav) og hashchange (tab-bytte i kunde-panel).
//
// Vis: legges på via CSS — vises kun under 720 px.

(function () {
  if (window.__nailedBottomNav) return;
  window.__nailedBottomNav = true;

  // Sider hvor vi IKKE viser bottom-nav. Match på pathname (uten ledende slash
  // og .html-suffiks).
  var HIDE_ON = [
    'login',
    'auth-complete',
    'confirmation',
    'bli-salong',
  ];

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

  // Bottom-nav items. requiresAuth gjør at item bare vises for innloggede brukere
  // — gjelder Bookinger og Meldinger, som er meningsløse uten konto.
  var ITEMS = [
    {
      key: 'utforsk',
      label: 'Utforsk',
      href: '/utforsk',
      svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    },
    {
      key: 'favoritter',
      label: 'Favoritter',
      href: '/favoritter',
      svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    },
    {
      key: 'bookinger',
      label: 'Bookinger',
      href: '/kunde-panel#tab-bookinger',
      requiresAuth: true,
      svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    },
    {
      key: 'meldinger',
      label: 'Meldinger',
      href: '/kunde-panel#tab-meldinger',
      requiresAuth: true,
      svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    },
    {
      key: 'profil',
      label: 'Profil',
      // Når innlogget → kunde-panel profil-tab. Når utlogget → login.
      href: '/kunde-panel#tab-profil',
      svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    },
  ];

  function visibleItems() {
    var loggedIn = isLoggedIn();
    return ITEMS.filter(function (it) { return !it.requiresAuth || loggedIn; }).map(function (it) {
      // Profil → /login når utlogget (mer direkte enn å gå via kunde-panel's requireAuth-redirect)
      if (it.key === 'profil' && !loggedIn) {
        return Object.assign({}, it, { href: '/login', label: 'Logg inn' });
      }
      return it;
    });
  }

  function activeKey() {
    var page = currentPage();
    var hash = location.hash;
    if (page === 'utforsk') return 'utforsk';
    if (page === 'favoritter') return 'favoritter';
    if (page === 'kunde-panel') {
      if (hash === '#tab-meldinger') return 'meldinger';
      if (hash === '#tab-favoritter') return 'favoritter';
      if (hash === '#tab-profil' || hash === '#tab-innstillinger') return 'profil';
      // dashboard, bookinger og default → Bookinger
      return 'bookinger';
    }
    // index, salon, om-oss, kontakt osv. — ingen tab er "aktiv"
    return null;
  }

  function html() {
    var active = activeKey();
    var items = visibleItems().map(function (item) {
      var cls = 'bottom-nav__item' + (item.key === active ? ' bottom-nav__item--active' : '');
      var badge = '';
      if (item.key === 'meldinger') {
        // Plassholder span — kunde-panel oppdaterer count direkte i denne
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

  // Speil in-page meldinger-badge (kunde-panel) til bottom-nav-badge.
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

  // Observer kunde-panel sin badge så bottom-nav følger med uten polling.
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
  // Re-render hvis innloggingsstatus endres i en annen fane (logout/login).
  window.addEventListener('storage', function (e) {
    if (e.key === 'nailed.accessToken') render();
  });
})();
