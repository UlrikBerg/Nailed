// Client-side auth helper. Used by login.html, auth-complete.html, and panels.
// Stores access + refresh tokens in localStorage, attaches Bearer to fetches,
// and silently refreshes the access token when it expires.
(function (global) {
  var ACCESS_KEY  = 'nailed.accessToken';
  var REFRESH_KEY = 'nailed.refreshToken';
  var ROLE_KEY    = 'nailed.role';

  function setTokens(t) {
    if (t.accessToken) localStorage.setItem(ACCESS_KEY, t.accessToken);
    if (t.refreshToken) localStorage.setItem(REFRESH_KEY, t.refreshToken);
    if (t.role) localStorage.setItem(ROLE_KEY, t.role);
  }
  function getAccess()  { return localStorage.getItem(ACCESS_KEY); }
  function getRefresh() { return localStorage.getItem(REFRESH_KEY); }
  function getRole()    { return localStorage.getItem(ROLE_KEY); }
  function clearTokens() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ROLE_KEY);
  }

  function isLoggedIn() { return Boolean(getAccess()); }

  async function refresh() {
    var rt = getRefresh();
    if (!rt) return false;
    var res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    var data = await res.json();
    localStorage.setItem(ACCESS_KEY, data.accessToken);
    return true;
  }

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {});
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    var token = getAccess();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    var res = await fetch(path, opts);
    if (res.status === 401 && getRefresh()) {
      // Try a single refresh + retry.
      var ok = await refresh();
      if (ok) {
        opts.headers['Authorization'] = 'Bearer ' + getAccess();
        res = await fetch(path, opts);
      }
    }
    return res;
  }

  async function logout() {
    var rt = getRefresh();
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
    } catch (_) {}
    clearTokens();
  }

  // Redirect helper for panel pages.
  async function requireAuth(redirectTo) {
    if (!isLoggedIn()) {
      window.location.replace('/login.html?next=' + encodeURIComponent(window.location.pathname));
      return null;
    }
    var res = await api('/api/v1/me');
    if (!res.ok) {
      clearTokens();
      window.location.replace('/login.html?next=' + encodeURIComponent(window.location.pathname));
      return null;
    }
    var data = await res.json();
    if (redirectTo && data.user.role !== redirectTo && data.user.role !== 'admin') {
      // Wrong panel for this role — send to their home.
      var home = data.user.role === 'salon_owner' ? '/salong-panel.html'
               : data.user.role === 'admin' ? '/admin/'
               : '/kunde-panel.html';
      window.location.replace(home);
      return null;
    }
    return data.user;
  }

  global.NailedAuth = {
    setTokens: setTokens,
    getAccess: getAccess,
    getRefresh: getRefresh,
    getRole: getRole,
    clearTokens: clearTokens,
    isLoggedIn: isLoggedIn,
    refresh: refresh,
    api: api,
    logout: logout,
    requireAuth: requireAuth,
  };
})(window);
