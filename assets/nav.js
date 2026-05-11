// Public-page top-nav: replaces the "Logg inn" button with a profile chip +
// logout when the user is signed in. Role determines the home destination:
//   user        → /kunde-panel            label: "Min konto"
//   salon_owner → /salong-panel           label: "Salongpanel"
//   admin       → /admin/                 label: "Admin"
//
// Self-contained: depends on /assets/auth.js for NailedAuth. No new CSS
// classes — uses inline styles for the avatar circle so styles.css stays
// untouched.

(function () {
  if (!window.NailedAuth) return;

  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function homeForRole(role) {
    if (role === 'admin') return { href: '/admin/', label: 'Admin' };
    if (role === 'salon_owner') return { href: '/salong-panel', label: 'Salongpanel' };
    return { href: '/kunde-panel', label: 'Min konto' };
  }

  function avatarHtml(name) {
    var initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return (
      '<span style="display:inline-flex;align-items:center;justify-content:center;' +
      'width:22px;height:22px;border-radius:999px;background:var(--rouge-500);' +
      'color:#fff;font-weight:700;font-size:11px;margin-right:8px;flex-shrink:0;">' +
      escapeHtml(initial) + '</span>'
    );
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

    // Build the profile chip + logout pair.
    var chip = document.createElement('a');
    chip.href = home.href;
    chip.className = 'btn btn-ghost btn-sm';
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.title = (user.name || '') + (user.email ? ' · ' + user.email : '');
    chip.innerHTML = avatarHtml(user.name) + escapeHtml(home.label);

    var logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'btn-icon';
    logout.title = 'Logg ut';
    logout.style.marginLeft = '4px';
    logout.innerHTML = '<i data-lucide="log-out"></i>';
    logout.addEventListener('click', async function () {
      await NailedAuth.logout();
      window.location.replace('/');
    });

    var loginLink = findLoginLink(actions);
    if (loginLink) {
      loginLink.parentNode.replaceChild(chip, loginLink);
      chip.parentNode.insertBefore(logout, chip.nextSibling);
    } else {
      actions.appendChild(chip);
      actions.appendChild(logout);
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
