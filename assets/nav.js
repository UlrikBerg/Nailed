// Public-page top-nav: replaces the "Logg inn" button with a compact user pill
// + dropdown when the user is signed in. Role determines the home destination
// used for the role label and as the link target on the pill button:
//   user        → /kunde-panel.html       label: "Min konto"
//   salon_owner → /salong-panel.html      label: "Salongpanel"
//   admin       → /admin/                 label: "Admin"
//
// Depends on /assets/auth.js for NailedAuth. CSS classes (.user-pill*) live in
// styles.css and are shared with every page that includes this script.

(function () {
  if (window.__nailedNav) return;
  window.__nailedNav = true;
  if (!window.NailedAuth) return;

  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  function homeForRole(role) {
    if (role === 'admin') return { href: '/admin/', label: 'Admin' };
    if (role === 'salon_owner') return { href: '/salong-panel.html', label: 'Salongpanel' };
    return { href: '/kunde-panel.html', label: 'Min konto' };
  }

  function findLoginLink(actions) {
    if (!actions) return null;
    var anchors = actions.querySelectorAll('a');
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || '';
      if (/(^|\/)login(\.html)?(\?|$|#)/.test(href)) return anchors[i];
    }
    return null;
  }

  function buildPill(user, home) {
    var initial = ((user.name || '?').trim().charAt(0) || '?').toUpperCase();

    var wrap = document.createElement('div');
    wrap.className = 'user-pill__wrap';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'user-pill';
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'navUserMenu');
    toggle.title = (user.name || '') + (user.email ? ' · ' + user.email : '');

    var avatar = document.createElement('span');
    avatar.className = 'user-pill__avatar';
    avatar.textContent = initial;
    toggle.appendChild(avatar);

    var text = document.createElement('span');
    text.className = 'user-pill__text';
    var nameEl = document.createElement('span');
    nameEl.className = 'user-pill__name';
    nameEl.textContent = user.name || '';
    text.appendChild(nameEl);
    var roleEl = document.createElement('span');
    roleEl.className = 'user-pill__role';
    var roleLabel = document.createElement('span');
    roleLabel.textContent = home.label;
    var chev = document.createElement('i');
    chev.setAttribute('data-lucide', 'chevron-down');
    roleEl.appendChild(roleLabel);
    roleEl.appendChild(chev);
    text.appendChild(roleEl);
    toggle.appendChild(text);

    var menu = document.createElement('div');
    menu.className = 'user-pill__menu';
    menu.id = 'navUserMenu';
    menu.setAttribute('role', 'menu');

    function menuLink(href, iconName, label, badgeKey) {
      var a = document.createElement('a');
      a.className = 'user-pill__menu-item';
      a.setAttribute('role', 'menuitem');
      a.href = href;
      var ic = document.createElement('i');
      ic.setAttribute('data-lucide', iconName);
      a.appendChild(ic);
      a.appendChild(document.createTextNode(' ' + label));
      if (badgeKey) {
        var b = document.createElement('span');
        b.className = 'user-pill__menu-badge';
        b.dataset.badge = badgeKey;
        b.hidden = true;
        a.appendChild(b);
      }
      return a;
    }

    menu.appendChild(menuLink('/kunde-panel', 'user-round', 'Min profil'));
    if (user.role === 'salon_owner' || user.role === 'admin') {
      menu.appendChild(menuLink('/salong-panel', 'store', 'Salongpanel', 'salon'));
    }
    if (user.role === 'admin') {
      menu.appendChild(menuLink('/admin/', 'shield', 'Adminpanel', 'admin'));
    }
    menu.appendChild(menuLink('/favoritter', 'heart', 'Mine favoritter'));

    var divider = document.createElement('div');
    divider.className = 'user-pill__menu-divider';
    divider.setAttribute('role', 'separator');
    menu.appendChild(divider);

    var logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'user-pill__menu-item';
    logoutBtn.setAttribute('role', 'menuitem');
    var logoutIcon = document.createElement('i');
    logoutIcon.setAttribute('data-lucide', 'log-out');
    logoutBtn.appendChild(logoutIcon);
    logoutBtn.appendChild(document.createTextNode(' Logg ut'));
    menu.appendChild(logoutBtn);

    wrap.appendChild(toggle);
    wrap.appendChild(menu);

    function openMenu() {
      menu.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('is-open')) closeMenu(); else openMenu();
    });
    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('is-open')) return;
      if (menu.contains(e.target) || toggle.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMenu();
        toggle.focus();
      }
    });
    logoutBtn.addEventListener('click', async function () {
      closeMenu();
      try { await NailedAuth.logout(); } catch (_) {}
      window.location.replace('/');
    });

    return wrap;
  }

  var USER_CACHE_KEY = 'nailed.user';
  function getCachedUser() {
    try {
      var raw = localStorage.getItem(USER_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function setCachedUser(user) {
    try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)); } catch (_) {}
  }
  function clearCachedUser() {
    try { localStorage.removeItem(USER_CACHE_KEY); } catch (_) {}
  }

  function mountPill(actions, user) {
    var home = homeForRole(user.role);
    var pill = buildPill(user, home);
    var loginLink = findLoginLink(actions);
    if (loginLink) {
      loginLink.parentNode.replaceChild(pill, loginLink);
    } else {
      var existing = actions.querySelector('.user-pill__wrap');
      if (existing) existing.parentNode.replaceChild(pill, existing);
      else actions.appendChild(pill);
    }
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function pillsEqual(a, b) {
    if (!a || !b) return false;
    return a.name === b.name && a.email === b.email && a.role === b.role;
  }

  var ACTIONS_CACHE_KEY = 'nailed.actions';
  function getCachedActions() {
    try {
      var raw = localStorage.getItem(ACTIONS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function setCachedActions(a) {
    try { localStorage.setItem(ACTIONS_CACHE_KEY, JSON.stringify(a)); } catch (_) {}
  }
  function applyActionBadges(counts) {
    if (!counts) return;
    document.querySelectorAll('.user-pill__menu-badge').forEach(function (el) {
      var key = el.dataset.badge;
      var n = counts[key] || 0;
      if (n > 0) {
        el.textContent = String(n);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
    // Alert-dot på selve pillen — total handlinger på tvers av roller.
    var total = (counts.salon || 0) + (counts.admin || 0) + (counts.messages || 0);
    var wrap = document.querySelector('.user-pill__wrap');
    if (!wrap) return;
    var dot = wrap.querySelector('.user-pill__alertDot');
    if (total > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'user-pill__alertDot';
        (wrap.querySelector('.user-pill') || wrap).appendChild(dot);
      }
      dot.title = total + ' handlinger venter';
      dot.textContent = total > 9 ? '9+' : String(total);
    } else if (dot) {
      dot.remove();
    }
  }
  function refreshActions() {
    return NailedAuth.api('/api/v1/me/actions').then(function (res) {
      if (!res.ok) return;
      return res.json().then(function (data) {
        setCachedActions(data);
        applyActionBadges(data);
      });
    }).catch(function () { /* ignore */ });
  }

  function render() {
    var actions = document.querySelector('.top-nav__actions');
    if (!actions) return;

    if (!NailedAuth.isLoggedIn()) {
      clearCachedUser();
      return; // Anon — leave default "Logg inn" alone.
    }

    // Synchronously mount pill from cache BEFORE first paint completes so
    // the header looks identical from one page to the next — no flash from
    // "Logg inn" to user-pill mens /api/v1/me-kallet pågår.
    var cached = getCachedUser();
    if (cached) {
      mountPill(actions, cached);
      applyActionBadges(getCachedActions());
    }

    // Background refresh: validate token + pick up name/email changes. If the
    // server says we're unauthorized, clear and let default UI show on next nav.
    NailedAuth.api('/api/v1/me').then(function (res) {
      if (!res.ok) {
        NailedAuth.clearTokens();
        clearCachedUser();
        // Don't yank the pill mid-session — next page load shows Logg inn.
        return;
      }
      return res.json().then(function (data) {
        var user = data.user || {};
        if (pillsEqual(user, cached)) {
          setCachedUser(user);
          return;
        }
        setCachedUser(user);
        mountPill(actions, user);
        applyActionBadges(getCachedActions());
      });
    }).catch(function (err) {
      console.warn('[nav]', err);
    });

    // Always refresh action counts in background — works even if pill came
    // from cache (which is the common case for SPA navs).
    refreshActions();
  }

  ready(render);
})();
