// Curated list of common Norwegian beauty-service / treatment names used by
// the treatment autocomplete on the homepage hero search. The data is
// hand-curated and shipped statically — no runtime network dependency.
//
// Exposes:
//   window.NailedTreatments.catalog → Array<{ name, category }>
//   window.NailedTreatments.search(query, limit) → ranked matches
//   window.NailedTreatments.attachTypeahead(input, opts) → wires keyboard/mouse UX
//
// The typeahead is permissive: free text is allowed (the user can type
// anything and submit). Selecting a suggestion just fills the input.

(function (global) {

  // -- Static catalog -----------------------------------------------------
  // Categories mirror the existing salon-data taxonomy (Vipper, Bryn, Negler,
  // Hud, Voksing/hårfjerning, Makeup/Bryllup) plus a few sensible additions.
  var CATALOG = [
    // Vipper
    { name: 'Vippeløft',                       category: 'Vipper' },
    { name: 'Vippeløft + farge',               category: 'Vipper' },
    { name: 'Klassiske vippeextensions',       category: 'Vipper' },
    { name: 'Volumvipper',                     category: 'Vipper' },
    { name: 'Hybrid-vipper',                   category: 'Vipper' },
    { name: 'Vippepåfyll',                     category: 'Vipper' },
    { name: 'Henna-farging vipper',            category: 'Vipper' },
    { name: 'Tinting vipper',                  category: 'Vipper' },
    { name: 'Fjerning av vippeextensions',     category: 'Vipper' },

    // Bryn
    { name: 'Brynsforming',                    category: 'Bryn' },
    { name: 'Brynsforming + farge',            category: 'Bryn' },
    { name: 'Brynsfarge',                      category: 'Bryn' },
    { name: 'Henna bryn',                      category: 'Bryn' },
    { name: 'Brynslaminering',                 category: 'Bryn' },
    { name: 'Microblading',                    category: 'Bryn' },
    { name: 'Microblading touch-up',           category: 'Bryn' },
    { name: 'Brynsfjerning',                   category: 'Bryn' },

    // Negler
    { name: 'Manikyr',                         category: 'Negler' },
    { name: 'Gellakk-manikyr',                 category: 'Negler' },
    { name: 'Gellakk-fjerning',                category: 'Negler' },
    { name: 'Akrylnegler',                     category: 'Negler' },
    { name: 'Akrylfyll',                       category: 'Negler' },
    { name: 'Pedikyr',                         category: 'Negler' },
    { name: 'Gellakk-pedikyr',                 category: 'Negler' },
    { name: 'Spa-pedikyr',                     category: 'Negler' },
    { name: 'Fransk manikyr',                  category: 'Negler' },
    { name: 'Neglekunst',                      category: 'Negler' },

    // Hud
    { name: 'Ansiktsbehandling',               category: 'Hud' },
    { name: 'Klassisk ansiktsbehandling',      category: 'Hud' },
    { name: 'Dypvask',                         category: 'Hud' },
    { name: 'Peeling',                         category: 'Hud' },
    { name: 'Mikrodermabrasjon',               category: 'Hud' },
    { name: 'BB-glow',                         category: 'Hud' },

    // Voksing / hårfjerning
    { name: 'Voksing overleppe',               category: 'Voksing' },
    { name: 'Voksing bryn',                    category: 'Voksing' },
    { name: 'Voksing legger',                  category: 'Voksing' },
    { name: 'Voksing armer',                   category: 'Voksing' },
    { name: 'Voksing bikinilinje',             category: 'Voksing' },
    { name: 'Brazilian voksing',               category: 'Voksing' },
    { name: 'Sukkervoksing',                   category: 'Voksing' },
    { name: 'IPL',                             category: 'Voksing' },

    // Makeup / Bryllup
    { name: 'Brudemakeup',                     category: 'Makeup' },
    { name: 'Festmakeup',                      category: 'Makeup' },
    { name: 'Selvbruning',                     category: 'Makeup' },
    { name: 'Tannbleking',                     category: 'Makeup' }
  ];

  // -- Search -------------------------------------------------------------
  // Case-insensitive substring match with a prefix bonus. Returns up to
  // `limit` (default 8) entries, ordered by best match.

  function normalize(s) {
    return String(s || '').toLowerCase().trim();
  }

  function search(query, limit) {
    limit = limit || 8;
    var q = normalize(query);
    if (!q) return [];
    var matches = [];
    CATALOG.forEach(function (e) {
      var n = normalize(e.name);
      var idx = n.indexOf(q);
      if (idx < 0) {
        // Allow category match (e.g. "negler" surfaces all Negler entries).
        if (normalize(e.category).indexOf(q) === 0) {
          matches.push({ entry: e, score: 1000 + n.length });
        }
        return;
      }
      // Prefix match scores best (idx=0). Mid-word adds a per-character
      // penalty. Ties broken by shorter names first.
      var score = idx * 10 + n.length;
      matches.push({ entry: e, score: score });
    });
    matches.sort(function (a, b) { return a.score - b.score; });
    return matches.slice(0, limit).map(function (m) { return m.entry; });
  }

  // -- attachTypeahead(input, opts) — wires UX onto an existing <input> --
  // Same wrapper-and-dropdown pattern as no-places.js so the two helpers
  // feel identical. Permissive: free text allowed (selecting a suggestion
  // fills the input but we never reject typed values on blur).

  function ensureStyles() {
    if (document.getElementById('nailed-treatments-styles')) return;
    var css = [
      '.nailed-treatments-wrap{position:relative;display:block;width:100%;}',
      '.nailed-treatments-wrap > input{width:100%;box-sizing:border-box;}',
      '.nailed-treatments-dropdown{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:var(--cream-50,#fff);border:1px solid var(--stone-200,#e3dcd5);border-radius:12px;box-shadow:0 12px 32px rgba(27,18,24,0.12);max-height:280px;max-width:320px;overflow-y:auto;z-index:1000;display:none;font-family:var(--font-body,system-ui,sans-serif);}',
      '.nailed-treatments-dropdown.is-open{display:block;}',
      '.nailed-treatments-item{padding:10px 14px;cursor:pointer;font-size:14px;color:var(--ink,#1B1218);display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--stone-100,#efeae5);}',
      '.nailed-treatments-item:last-child{border-bottom:0;}',
      '.nailed-treatments-item:hover,.nailed-treatments-item.is-active{background:var(--cream-100,#f5efe9);}',
      '.nailed-treatments-name{font-weight:500;}',
      '.nailed-treatments-meta{font-size:12px;color:var(--fg-muted,#7a6f68);text-transform:lowercase;}',
      '.nailed-treatments-empty{padding:12px 14px;color:var(--fg-muted,#7a6f68);font-size:13px;font-style:italic;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'nailed-treatments-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function attachTypeahead(input, opts) {
    if (!input || input.dataset.nailedTreatmentsAttached === '1') return;
    input.dataset.nailedTreatmentsAttached = '1';
    ensureStyles();

    opts = opts || {};

    // Wrap the input in a positioned container so the dropdown can absolute-
    // position relative to it.
    var wrap = document.createElement('div');
    wrap.className = 'nailed-treatments-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var dropdown = document.createElement('div');
    dropdown.className = 'nailed-treatments-dropdown';
    dropdown.setAttribute('role', 'listbox');
    wrap.appendChild(dropdown);

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var activeIdx = -1;
    var currentResults = [];

    function renderResults(results) {
      currentResults = results;
      activeIdx = results.length ? 0 : -1;
      if (!results.length) {
        dropdown.innerHTML = '<div class="nailed-treatments-empty">Ingen treff. Du kan likevel søke på det du har skrevet.</div>';
        dropdown.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      var html = '';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        html += '<div class="nailed-treatments-item' + (i === 0 ? ' is-active' : '') +
          '" role="option" data-idx="' + i + '">' +
          '<span class="nailed-treatments-name">' + escapeHtml(r.name) + '</span>' +
          '<span class="nailed-treatments-meta">' + escapeHtml(r.category) + '</span>' +
          '</div>';
      }
      dropdown.innerHTML = html;
      dropdown.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      dropdown.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      activeIdx = -1;
    }

    function pick(entry) {
      input.value = entry.name;
      close();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setActive(i) {
      var items = dropdown.querySelectorAll('.nailed-treatments-item');
      items.forEach(function (el) { el.classList.remove('is-active'); });
      if (i >= 0 && i < items.length) {
        items[i].classList.add('is-active');
        var el = items[i];
        var top = el.offsetTop, bottom = top + el.offsetHeight;
        if (top < dropdown.scrollTop) dropdown.scrollTop = top;
        else if (bottom > dropdown.scrollTop + dropdown.clientHeight) {
          dropdown.scrollTop = bottom - dropdown.clientHeight;
        }
      }
      activeIdx = i;
    }

    input.addEventListener('input', function () {
      var q = input.value;
      if (!q.trim()) { close(); return; }
      var results = search(q, 8);
      renderResults(results);
    });

    input.addEventListener('focus', function () {
      var q = input.value;
      if (q.trim()) {
        var results = search(q, 8);
        renderResults(results);
      }
    });

    input.addEventListener('keydown', function (e) {
      var isOpen = dropdown.classList.contains('is-open');
      if (e.key === 'ArrowDown') {
        if (!isOpen) {
          var r = search(input.value || '', 8);
          if (r.length) renderResults(r);
          return;
        }
        e.preventDefault();
        if (currentResults.length) setActive((activeIdx + 1) % currentResults.length);
      } else if (e.key === 'ArrowUp') {
        if (!isOpen) return;
        e.preventDefault();
        if (currentResults.length) setActive((activeIdx - 1 + currentResults.length) % currentResults.length);
      } else if (e.key === 'Enter') {
        // Permissive: if the user has highlighted a suggestion, fill it but
        // DO NOT swallow the Enter — let the form submit. If they haven't
        // highlighted one, just let the form submit with their free text.
        if (isOpen && currentResults.length && activeIdx >= 0) {
          // Only pick (without preventing default) if the active suggestion
          // is meaningfully different from the typed text. This way Enter
          // submits the visible value either way.
          var picked = currentResults[activeIdx];
          if (normalize(input.value) !== normalize(picked.name)) {
            input.value = picked.name;
          }
        }
        close();
      } else if (e.key === 'Escape') {
        if (isOpen) { e.preventDefault(); close(); }
      }
    });

    dropdown.addEventListener('mousedown', function (e) {
      // mousedown (not click) so blur doesn't fire first and clear results.
      var target = e.target.closest('.nailed-treatments-item');
      if (!target) return;
      e.preventDefault();
      var idx = parseInt(target.getAttribute('data-idx'), 10);
      if (currentResults[idx]) pick(currentResults[idx]);
    });

    input.addEventListener('blur', function () {
      // Defer so click on dropdown lands first. Permissive — never reject
      // the typed value, just close the dropdown.
      setTimeout(close, 120);
    });
  }

  global.NailedTreatments = {
    catalog: CATALOG,
    search: search,
    attachTypeahead: attachTypeahead
  };
})(window);
