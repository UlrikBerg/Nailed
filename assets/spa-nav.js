// SPA-style navigation: intercept same-origin link clicks, fetch destination,
// swap everything in <body> except the top-nav header. Header DOM persists so
// the user-pill doesn't rerender between navigations.
//
// Boundaries: only swap pages that share the standard public shell
// (header.top-nav present). Pages without it (admin, OAuth callbacks) fall
// through to a regular browser load.

(function () {
  if (window.__nailedSpaNav) return;
  window.__nailedSpaNav = true;
  if (!window.history || !window.history.pushState || !window.fetch) return;

  document.documentElement.setAttribute('data-spa', '1');

  function getShell(root) {
    var body = root.body || root;
    var header = body.querySelector('header.top-nav');
    if (!header) return null;
    var swappable = [];
    var kids = body.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== header) swappable.push(kids[i]);
    }
    return { body: body, header: header, swappable: swappable };
  }

  function shouldHandle(url, anchor) {
    if (url.origin !== location.origin) return false;
    if (anchor && anchor.target && anchor.target !== '_self') return false;
    if (anchor && anchor.hasAttribute('download')) return false;
    if (anchor && anchor.dataset.spa === 'false') return false;
    var p = url.pathname;
    if (p.indexOf('/api/') === 0) return false;
    if (p.indexOf('/auth') === 0) return false;
    if (p.indexOf('/admin') === 0) return false;
    if (p === '/login' || p === '/login.html') return false;
    if (p === '/logg-ut' || p === '/logout') return false;
    if (p.match(/\.(pdf|zip|png|jpe?g|webp|svg|gif|ico|mp4|mov|css|js|map|txt|xml)$/i)) return false;
    return true;
  }

  // Adopt new <style> tags from destination head — only those not already
  // present (keyed by id+length so we avoid duplicates).
  function adoptHeadStyles(srcDoc) {
    var have = {};
    document.head.querySelectorAll('style[data-spa-key]').forEach(function (s) {
      have[s.getAttribute('data-spa-key')] = true;
    });
    srcDoc.head.querySelectorAll('style').forEach(function (s) {
      var key = (s.id || '') + '|' + (s.textContent.length || 0);
      if (have[key]) return;
      var clone = s.cloneNode(true);
      clone.setAttribute('data-spa-key', key);
      document.head.appendChild(clone);
    });
  }

  // Re-execute <script> tags in the swapped region. Cloning a parsed-but-
  // inert script element triggers the browser's execution path.
  //
  // Viktig: vi MÅ vente på at hvert src-script har lastet ferdig før neste
  // inline-script kjører, ellers risikerer vi at inline-koden refererer til
  // globaler som ennå ikke er definert (f.eks. initFavorites fra favorites.js).
  // Default for dynamisk-innsatte src-scripts er async-load — så vi awaiter
  // load/error eksplisitt.
  async function execScripts(scope) {
    var newScripts = Array.prototype.slice.call(scope.querySelectorAll('script'));
    var newSet = new Set(newScripts);
    var loaded = {};
    document.querySelectorAll('script[src]').forEach(function (s) {
      if (newSet.has(s)) return;
      loaded[s.src] = true;
    });
    for (var i = 0; i < newScripts.length; i++) {
      var old = newScripts[i];
      var src = old.getAttribute('src');
      if (src) {
        var resolved = new URL(src, location.href).href;
        if (loaded[resolved]) {
          old.parentNode.removeChild(old);
          continue;
        }
        loaded[resolved] = true;
      }
      var fresh = document.createElement('script');
      for (var j = 0; j < old.attributes.length; j++) {
        var a = old.attributes[j];
        fresh.setAttribute(a.name, a.value);
      }
      fresh.textContent = old.textContent;
      if (src) {
        await new Promise(function (resolve) {
          fresh.onload = function () { resolve(); };
          fresh.onerror = function () { resolve(); };
          old.parentNode.replaceChild(fresh, old);
        });
      } else {
        old.parentNode.replaceChild(fresh, old);
      }
    }
  }

  function saveScroll(url) {
    try { sessionStorage.setItem('nailed.spa.scroll:' + url, String(window.scrollY)); } catch (_) {}
  }
  function restoreScroll(url) {
    try {
      var y = sessionStorage.getItem('nailed.spa.scroll:' + url);
      window.scrollTo(0, y ? parseInt(y, 10) : 0);
    } catch (_) { window.scrollTo(0, 0); }
  }

  var navigating = false;
  async function navigate(href, opts) {
    if (navigating) return;
    opts = opts || {};
    navigating = true;
    window.dispatchEvent(new CustomEvent('spa:loading', { detail: { url: href } }));
    try {
      saveScroll(location.pathname + location.search);

      var res;
      try {
        res = await fetch(href, { headers: { 'Accept': 'text/html' }, credentials: 'same-origin' });
      } catch (err) {
        location.href = href;
        return;
      }
      if (!res.ok) { location.href = href; return; }
      var html = await res.text();
      var doc;
      try { doc = new DOMParser().parseFromString(html, 'text/html'); }
      catch (_) { location.href = href; return; }

      var newShell = getShell(doc);
      var curShell = getShell(document);
      if (!newShell || !curShell) {
        location.href = href;
        return;
      }

      if (doc.title) document.title = doc.title;
      var newDesc = doc.querySelector('meta[name="description"]');
      var curDesc = document.querySelector('meta[name="description"]');
      if (newDesc && curDesc) curDesc.setAttribute('content', newDesc.getAttribute('content') || '');

      adoptHeadStyles(doc);

      if (opts.replace) {
        history.replaceState({ spa: true }, '', href);
      } else {
        history.pushState({ spa: true }, '', href);
      }

      // Remove all current swappable nodes (everything except header).
      curShell.swappable.forEach(function (n) { n.parentNode.removeChild(n); });

      // Insert new swappable nodes in the same order — after the header.
      var frag = document.createDocumentFragment();
      newShell.swappable.forEach(function (n) { frag.appendChild(n); });
      curShell.header.parentNode.appendChild(frag);

      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

      // Re-execute scripts now in the live DOM. Await så src-scripts har
      // lastet før vi proklamerer ferdig — ellers kan onclicks osv refere
      // til ennå-udefinerte globaler.
      await execScripts(document.body);

      if (opts.restoreScroll) {
        restoreScroll(location.pathname + location.search);
      } else {
        window.scrollTo(0, 0);
      }

      window.dispatchEvent(new CustomEvent('spa:navigated', { detail: { url: href } }));
    } finally {
      navigating = false;
    }
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button != null && e.button !== 0) return;
    var anchor = e.target.closest && e.target.closest('a[href]');
    if (!anchor) return;

    var url;
    try { url = new URL(anchor.href, location.href); } catch (_) { return; }
    if (!shouldHandle(url, anchor)) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });

  window.addEventListener('popstate', function () {
    var url = new URL(location.href);
    if (!shouldHandle(url, null)) { location.reload(); return; }
    navigate(url.pathname + url.search + url.hash, { replace: true, restoreScroll: true });
  });

  // Eksponér navigate() så onclick="location.href=..."-mønstre kan bytte over
  // til SPA-nav. shouldHandle() filtrerer fortsatt eksterne URLer / file
  // downloads og faller tilbake til full-load.
  window.NailedSpaNav = {
    navigate: function (href) {
      var url;
      try { url = new URL(href, location.href); } catch (_) { location.href = href; return; }
      if (!shouldHandle(url, null)) { location.href = href; return; }
      navigate(url.pathname + url.search + url.hash);
    }
  };
})();
