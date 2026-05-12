// Lett pageview-tracking. Setter cookie nailed.visitor (UUID v4) første gang,
// sender POST /api/v1/track/pageview ved hver sidelast og hver SPA-nav.
//
// Best-effort: aldri feile, aldri kaste i konsoll, aldri blokkere noe.

(function () {
  if (window.__nailedTrack) return;
  window.__nailedTrack = true;

  function uuid4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getVisitorId() {
    var m = document.cookie.match(/(?:^|; )nailed\.visitor=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    var id = uuid4();
    var d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    document.cookie = 'nailed.visitor=' + encodeURIComponent(id) +
      '; path=/; expires=' + d.toUTCString() + '; samesite=lax';
    return id;
  }

  function send() {
    try {
      var body = {
        visitor_id: getVisitorId(),
        path: location.pathname + location.search,
        referrer: document.referrer ? document.referrer.slice(0, 255) : null,
      };
      // Bruk fetch hvis tilgjengelig — keepalive så vi rekker å sende selv
      // om bruker navigerer bort umiddelbart.
      if (window.fetch) {
        fetch('/api/v1/track/pageview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
          keepalive: true,
        }).catch(function () {});
      }
    } catch (_) {}
  }

  // Første sidelast
  if (document.readyState !== 'loading') {
    send();
  } else {
    document.addEventListener('DOMContentLoaded', send);
  }

  // SPA-navigasjon: lytt på custom-event som spa-nav.js dispatcher.
  window.addEventListener('spa:navigated', send);
})();
