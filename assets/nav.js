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
      if (/(^|\/)login\.html(\?|$|#)/.test(href)) return anchors[i];
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

    function menuLink(href, iconName, label) {
      var a = document.createElement('a');
      a.className = 'user-pill__menu-item';
      a.setAttribute('role', 'menuitem');
      a.href = href;
      var ic = document.createElement('i');
      ic.setAttribute('data-lucide', iconName);
      a.appendChild(ic);
      a.appendChild(document.createTextNode(' ' + label));
      return a;
    }

    menu.appendChild(menuLink('/kunde-panel', 'user-round', 'Min profil'));
    if (user.role === 'salon_owner') {
      menu.appendChild(menuLink('/salong-panel', 'store', 'Salongprofil'));
    }
    menu.appendChild(menuLink('/kunde-panel#tab-bookinger', 'calendar', 'Mine bookinger'));
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

  async function render() {
    var actions = document.querySelector('.top-nav__actions');
    if (!actions) return;

    if (!NailedAuth.isLoggedIn()) return; // Anon — leave default "Logg inn" alone.

    var res = await NailedAuth.api('/api/v1/me');
    if (!res.ok) {
      // Token invalid or revoked — clear and let default UI show.
      NailedAuth.clearTokens();
      return;
    }
    var data = await res.json();
    var user = data.user || {};
    var home = homeForRole(user.role);

    var pill = buildPill(user, home);

    var loginLink = findLoginLink(actions);
    if (loginLink) {
      loginLink.parentNode.replaceChild(pill, loginLink);
    } else {
      actions.appendChild(pill);
    }

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  ready(function () {
    render().catch(function (err) {
      // Don't break the page if anything goes wrong here.
      console.warn('[nav]', err);
    });
  });
})();
