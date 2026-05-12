// Felles chat-UI for kunde-panel og salong-panel.
//
// NailedChat.mount({ root, badgeEl, pollMs }) — bygger en to-kolonne-layout
// (tråd-liste + meldinger) inn i `root` og polller for nye meldinger.

(function (global) {
  if (global.NailedChat) return;

  function ensureStyles() {
    if (document.getElementById('nailed-chat-styles')) return;
    var css = [
      '.nc-wrap { display: grid; grid-template-columns: 320px 1fr; gap: 16px; height: 70vh; min-height: 480px; }',
      '@media (max-width: 720px) { .nc-wrap { grid-template-columns: 1fr; } .nc-wrap.has-active .nc-list { display: none; } .nc-wrap:not(.has-active) .nc-pane { display: none; } }',
      '.nc-list { background: var(--cream-50); border: 1px solid var(--stone-200); border-radius: var(--radius-lg); overflow-y: auto; }',
      '.nc-list__empty { padding: 24px; text-align: center; color: var(--fg-muted); font-size: 14px; }',
      '.nc-thread { display: flex; gap: 10px; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid var(--stone-100); align-items: flex-start; }',
      '.nc-thread:hover { background: var(--cream-100); }',
      '.nc-thread.is-active { background: var(--rouge-50); }',
      '.nc-thread__avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--rouge-100); color: var(--rouge-700); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px; }',
      '.nc-thread__main { flex: 1; min-width: 0; }',
      '.nc-thread__name { font-weight: 600; font-size: 14px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.nc-thread__preview { font-size: 12px; color: var(--fg-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.nc-thread__time { font-size: 11px; color: var(--fg-muted); margin-left: 6px; flex-shrink: 0; }',
      '.nc-thread__unread { width: 8px; height: 8px; border-radius: 50%; background: var(--rouge-500); margin-top: 6px; }',
      '.nc-pane { display: flex; flex-direction: column; background: var(--cream-50); border: 1px solid var(--stone-200); border-radius: var(--radius-lg); overflow: hidden; }',
      '.nc-pane__empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--fg-muted); font-size: 14px; padding: 24px; text-align: center; }',
      '.nc-head { padding: 14px 18px; border-bottom: 1px solid var(--stone-200); display: flex; align-items: center; gap: 10px; }',
      '.nc-head__back { display: none; background: none; border: 0; cursor: pointer; color: var(--fg-muted); padding: 4px; }',
      '@media (max-width: 720px) { .nc-head__back { display: inline-flex; } }',
      '.nc-head__title { font-weight: 600; font-size: 15px; color: var(--ink); margin: 0; }',
      '.nc-body { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }',
      '.nc-msg { max-width: 70%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.45; word-wrap: break-word; }',
      '.nc-msg--mine { align-self: flex-end; background: var(--rouge-500); color: #fff; border-bottom-right-radius: 4px; }',
      '.nc-msg--theirs { align-self: flex-start; background: var(--cream-100); color: var(--ink); border-bottom-left-radius: 4px; }',
      '.nc-msg__time { font-size: 10px; opacity: 0.7; margin-top: 4px; display: block; }',
      '.nc-form { padding: 12px; border-top: 1px solid var(--stone-200); display: flex; gap: 8px; }',
      '.nc-form textarea { flex: 1; resize: none; padding: 10px 12px; border: 1px solid var(--stone-300); border-radius: 10px; font-family: inherit; font-size: 14px; min-height: 44px; max-height: 120px; }',
      '.nc-form button { background: var(--rouge-500); color: #fff; border: 0; border-radius: 10px; padding: 0 18px; cursor: pointer; font-weight: 600; }',
      '.nc-form button:disabled { background: var(--stone-300); cursor: not-allowed; }',
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'nailed-chat-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
  }

  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function mount(opts) {
    ensureStyles();
    var root = opts.root;
    var badgeEl = opts.badgeEl || null;
    var pollMs = opts.pollMs || 12000;
    root.innerHTML =
      '<div class="nc-wrap" id="ncWrap">' +
        '<div class="nc-list" id="ncList"><div class="nc-list__empty">Laster …</div></div>' +
        '<div class="nc-pane" id="ncPane">' +
          '<div class="nc-pane__empty" id="ncPaneEmpty">Velg en samtale fra listen for å se meldinger.</div>' +
        '</div>' +
      '</div>';

    var listEl = root.querySelector('#ncList');
    var paneEl = root.querySelector('#ncPane');
    var wrapEl = root.querySelector('#ncWrap');
    var emptyEl = root.querySelector('#ncPaneEmpty');
    var activeId = null;
    var threads = [];

    function getRoleLabel(t) {
      return t.role === 'customer' ? (t.salon_name || 'Salong') : (t.customer_name || t.customer_email || 'Kunde');
    }

    function renderList() {
      if (!threads.length) {
        listEl.innerHTML = '<div class="nc-list__empty">Ingen samtaler enda. Lag en booking for å starte en chat med salongen.</div>';
        return;
      }
      var html = threads.map(function (t) {
        var name = getRoleLabel(t);
        var preview = t.last_message_preview || (t.last_message_at ? '' : 'Si hei!');
        var time = fmtTime(t.last_message_at);
        return '<div class="nc-thread' + (t.id === activeId ? ' is-active' : '') + '" data-id="' + t.id + '">' +
          '<span class="nc-thread__avatar">' + escapeHtml(initialsOf(name)) + '</span>' +
          '<div class="nc-thread__main">' +
            '<div class="nc-thread__name">' + escapeHtml(name) + '</div>' +
            '<div class="nc-thread__preview">' + escapeHtml(preview) + '</div>' +
          '</div>' +
          (t.unread ? '<span class="nc-thread__unread" title="Ulest"></span>' : '') +
          (time ? '<span class="nc-thread__time">' + escapeHtml(time) + '</span>' : '') +
        '</div>';
      }).join('');
      listEl.innerHTML = html;
      listEl.querySelectorAll('.nc-thread').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = parseInt(el.dataset.id, 10);
          openThread(id);
        });
      });
    }

    async function refreshThreads(opts) {
      try {
        var res = await NailedAuth.api('/api/v1/chat/threads');
        if (!res.ok) return;
        var data = await res.json();
        threads = data.threads || [];
        renderList();
        updateBadge();
        if (opts && opts.autoOpenFirst && !activeId && threads.length) {
          openThread(threads[0].id);
        }
      } catch (_) {}
    }

    function updateBadge() {
      if (!badgeEl) return;
      var n = threads.filter(function (t) { return t.unread; }).length;
      if (n > 0) { badgeEl.textContent = String(n); badgeEl.hidden = false; }
      else { badgeEl.hidden = true; }
    }

    async function openThread(id) {
      activeId = id;
      wrapEl.classList.add('has-active');
      var thread = threads.find(function (t) { return t.id === id; });
      var headerName = thread ? getRoleLabel(thread) : '';
      paneEl.innerHTML =
        '<div class="nc-head">' +
          '<button class="nc-head__back" id="ncBack" type="button" aria-label="Tilbake"><i data-lucide="arrow-left"></i></button>' +
          '<h3 class="nc-head__title">' + escapeHtml(headerName) + '</h3>' +
        '</div>' +
        '<div class="nc-body" id="ncBody"><div style="text-align:center;color:var(--fg-muted);padding:24px;">Laster …</div></div>' +
        '<form class="nc-form" id="ncForm" autocomplete="off">' +
          '<textarea id="ncInput" rows="1" placeholder="Skriv en melding …" maxlength="4000" required></textarea>' +
          '<button type="submit" id="ncSend">Send</button>' +
        '</form>';
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      var backBtn = paneEl.querySelector('#ncBack');
      if (backBtn) backBtn.addEventListener('click', function () {
        activeId = null;
        wrapEl.classList.remove('has-active');
        paneEl.innerHTML = '<div class="nc-pane__empty">Velg en samtale fra listen for å se meldinger.</div>';
        renderList();
      });

      // Last meldinger
      var bodyEl = paneEl.querySelector('#ncBody');
      var formEl = paneEl.querySelector('#ncForm');
      var inputEl = paneEl.querySelector('#ncInput');
      var sendBtn = paneEl.querySelector('#ncSend');
      var meId = thread && thread.role === 'customer' ? thread.customer_id : null;

      async function loadMessages() {
        try {
          var res = await NailedAuth.api('/api/v1/chat/threads/' + id + '/messages');
          if (!res.ok) {
            bodyEl.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:24px;">Kunne ikke laste meldinger.</div>';
            return;
          }
          var data = await res.json();
          var msgs = data.messages || [];
          if (!msgs.length) {
            bodyEl.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:24px;font-size:13px;">Ingen meldinger ennå. Si hei!</div>';
          } else {
            bodyEl.innerHTML = msgs.map(function (m) {
              var mine = m.sender_role === data.thread.role;
              return '<div class="nc-msg ' + (mine ? 'nc-msg--mine' : 'nc-msg--theirs') + '">' +
                escapeHtml(m.body).replace(/\n/g, '<br>') +
                '<span class="nc-msg__time">' + escapeHtml(fmtTime(m.sent_at)) + '</span>' +
              '</div>';
            }).join('');
            bodyEl.scrollTop = bodyEl.scrollHeight;
          }
          // Marker tråd som lest i state
          var t = threads.find(function (t) { return t.id === id; });
          if (t) t.unread = false;
          updateBadge();
        } catch (_) {}
      }

      formEl.addEventListener('submit', async function (e) {
        e.preventDefault();
        var body = (inputEl.value || '').trim();
        if (!body) return;
        sendBtn.disabled = true;
        try {
          var res = await NailedAuth.api('/api/v1/chat/threads/' + id + '/messages', {
            method: 'POST',
            body: { body: body },
          });
          if (!res.ok) {
            sendBtn.disabled = false;
            return;
          }
          inputEl.value = '';
          await loadMessages();
          await refreshThreads();
        } finally {
          sendBtn.disabled = false;
        }
      });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          formEl.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      });

      await loadMessages();
    }

    // Poll for nye meldinger og uleste counts.
    var pollHandle = setInterval(function () {
      refreshThreads();
      if (activeId) {
        // Force-reload av aktiv tråd så nye meldinger fra motparten dukker opp.
        var bodyEl = paneEl.querySelector('#ncBody');
        if (bodyEl) {
          NailedAuth.api('/api/v1/chat/threads/' + activeId + '/messages').then(function (r) {
            return r.ok ? r.json() : null;
          }).then(function (data) {
            if (!data) return;
            var t = threads.find(function (t) { return t.id === activeId; });
            var role = (t && t.role) || (data.thread && data.thread.role);
            var msgs = data.messages || [];
            var atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 30;
            bodyEl.innerHTML = msgs.length
              ? msgs.map(function (m) {
                  var mine = m.sender_role === role;
                  return '<div class="nc-msg ' + (mine ? 'nc-msg--mine' : 'nc-msg--theirs') + '">' +
                    escapeHtml(m.body).replace(/\n/g, '<br>') +
                    '<span class="nc-msg__time">' + escapeHtml(fmtTime(m.sent_at)) + '</span>' +
                  '</div>';
                }).join('')
              : '<div style="text-align:center;color:var(--fg-muted);padding:24px;font-size:13px;">Ingen meldinger ennå. Si hei!</div>';
            if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
          }).catch(function () {});
        }
      }
    }, pollMs);

    // Init
    refreshThreads({ autoOpenFirst: true });

    return {
      destroy: function () { clearInterval(pollHandle); },
      refresh: function () { return refreshThreads(); },
    };
  }

  global.NailedChat = { mount: mount };
})(window);
