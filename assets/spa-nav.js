// SPA-style navigation: intercept same-origin link clicks, fetch destination,
// swap content between header.top-nav and footer.footer, keep header in DOM.
//
// Each page is still its own HTML document on the server — this is a pjax-
// style enhancement layer. Browsers without JS or with the script blocked
// fall back to normal navigation.
//
// Boundaries: only swap pages that share the standard public shell
// (header.top-nav + footer.footer). Pages without these markers (login,
// admin, OAuth callbacks) fall through to a regular browser load.

(function () {
  if (!window.history || !window.history.pushState || !window.fetch) return;

  // Tag the current document as SPA-managed so destination scripts can
  // detect they're loading into an already-initialized shell.
  document.documentElement.setAttribute('data-spa', '1');

  function getShell(root) {
    var header = root.querySelector('header.top-nav');
    var footer = root.querySelector('footer.footer');
    if (!header || !footer) return null;
    // Sibling order: anything between header and footer is page content.
    if (header.parentNode !== footer.parentNode) return null;
    var nodes = [];
    var n = header.nextSibling;
    while (n && n !== footer) {
      nodes.push(n);
      n = n.nextSibling;
    }
    return { header: header, footer: footer, nodes: nodes };
  }

  function shouldHandle(url, anchor) {
    if (url.origin !== location.origin) return false;
    if (anchor && anchor.target && anchor.target !== '_self') return false;
    if (anchor && anchor.hasAttribute('download')) return false;
    if (anchor && anchor.dataset.spa === 'false') return false;
    var p = url.pathname;
    // API + auth + admin + file-likes go full-load.
    if (p.indexOf('/api/') === 0) return false;
    if (p.indexOf('/auth') === 0) return false;
    if (p.indexOf('/admin') === 0) return false;
    if (p === '/login' || p === '/login.html') return false;
    if (p === '/logg-ut' || p === '/logout') return false;
    if (p.match(/\.(pdf|zip|png|jpe?g|webp|svg|gif|ico|mp4|mov|css|js|map|txt|xml)$/i)) return false;
    return true;
  }

  // Adopt new <style> tags from destination head — only those not already
  // present (compare textContent hash via length+head heuristic to avoid
  // O(n²) full-text comparisons).
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

  // Re-execute <script> tags in the swapped region. We CLONE the node and
  // re-insert so the browser runs it; the original parsed copy from
  // DOMParser is inert.
  function execScripts(scope) {
    var scripts = Array.prototype.slice.call(scope.querySelectorAll('script'));
    scripts.forEach(function (old) {
      var fresh = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        var a = old.attributes[i];
        fresh.setAttribute(a.name, a.value);
      }
      fresh.textContent = old.textContent;
      old.parentNode.replaceChild(fresh, old);
    });
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
    try {
      saveScroll(location.pathname + location.search);

      var res;
      try {
        res = await fetch(href, { headers: { 'Accept': 'text/html' }, credentials: 'same-origin' });
      } catch (err) {
        // Network failure — fall through to full load so user gets an error page.
        location.href = href;
        return;
      }
      if (!res.ok) {
        location.href = href;
        return;
      }
      var html = await res.text();
      var doc;
      try { doc = new DOMParser().parseFromString(html, 'text/html'); }
      catch (_) { location.href = href; return; }

      var newShell = getShell(doc);
      var curShell = getShell(document);
      if (!newShell || !curShell) {
        // Destination doesn't have the standard shell (e.g. login.html) — full load.
        location.href = href;
        return;
      }

      // Update title & meta description before swapping content so the
      // browser tab updates feel instant.
      if (doc.title) document.title = doc.title;
      var newDesc = doc.querySelector('meta[name="description"]');
      var curDesc = document.querySelector('meta[name="description"]');
      if (newDesc && curDesc) curDesc.setAttribute('content', newDesc.getAttribute('content') || '');

      adoptHeadStyles(doc);

      // Update history before DOM swap so popstate timing is predictable.
      if (opts.replace) {
        history.replaceState({ spa: true }, '', href);
      } else {
        history.pushState({ spa: true }, '', href);
      }

      // Remove current content nodes, then insert new ones before the footer.
      curShell.nodes.forEach(function (n) { n.parentNode.removeChild(n); });
      var frag = document.createDocumentFragment();
      newShell.nodes.forEach(function (n) { frag.appendChild(n); });
      curShell.footer.parentNode.insertBefore(frag, curShell.footer);

      // Re-init lucide icons that came in with the new markup.
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

      // Re-execute the destination's inline + external scripts now that
      // they're in the live DOM. External scripts will be deduped by the
      // browser when src matches a previously-loaded one (most cases).
      execScripts(curShell.footer.parentNode);

      // Scroll: top for new navs, restore for back/forward.
      if (opts.restoreScroll) {
        restoreScroll(location.pathname + location.search);
      } else {
        window.scrollTo(0, 0);
      }

      // Notify any listeners that page content changed (analytics, etc).
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

    // Same-page hash: let browser handle.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });

  window.addEventListener('popstate', function () {
    var url = new URL(location.href);
    if (!shouldHandle(url, null)) {
      location.reload();
      return;
    }
    navigate(url.pathname + url.search + url.hash, { replace: true, restoreScroll: true });
  });
})();
