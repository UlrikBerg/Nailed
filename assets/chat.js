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
      '@media (max-width: 720px) { .nc-wrap { grid-template-columns: 1fr; gap: 0; height: calc(100dvh - 220px); min-height: 380px; } .nc-wrap.has-active .nc-list { display: none; } .nc-wrap:not(.has-active) .nc-pane { display: none; } }',
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
      '@media (max-width: 720px) { .nc-body { padding: 14px 12px; } .nc-head { padding: 12px 14px; } .nc-form { padding: 10px; } .nc-msg { font-size: 14px; } .nc-row { max-width: 88%; } .nc-thread { padding: 12px; } }',
      '.nc-row { display: flex; gap: 8px; align-items: flex-end; max-width: 80%; }',
      '.nc-row--mine { align-self: flex-end; flex-direction: row-reverse; }',
      '.nc-row--theirs { align-self: flex-start; }',
      '.nc-row__avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--cream-200, #ece4d8); color: var(--ink); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; background-size: cover; background-position: center; }',
      '.nc-row--mine .nc-row__avatar { background: var(--rouge-100); color: var(--rouge-700); }',
      '.nc-msg { padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.45; word-wrap: break-word; }',
      '.nc-row--mine .nc-msg { background: var(--rouge-500); color: #fff; border-bottom-right-radius: 4px; }',
      '.nc-row--theirs .nc-msg { background: var(--cream-100); color: var(--ink); border-bottom-left-radius: 4px; }',
      '.nc-msg__time { font-size: 10px; opacity: 0.7; margin-top: 4px; display: block; }',
      '.nc-readmark { font-size: 10px; color: var(--fg-muted); align-self: flex-end; margin: 2px 38px 4px 0; }',
      '.nc-row--theirs + .nc-readmark { display: none; }',
      '.nc-form { padding: 12px; border-top: 1px solid var(--stone-200); display: flex; gap: 8px; }',
      '.nc-form textarea { flex: 1; resize: none; padding: 10px 12px; border: 1px solid var(--stone-300); border-radius: 10px; font-family: inherit; font-size: 14px; min-height: 44px; max-height: 120px; }',
      '.nc-form button { background: var(--rouge-500); color: #fff; border: 0; border-radius: 10px; padding: 0 18px; cursor: pointer; font-weight: 600; }',
      '.nc-form button:disabled { background: var(--stone-300); cursor: not-allowed; }',
      '.nc-report-btn { background: transparent; border: 0; cursor: pointer; padding: 4px; border-radius: 50%; color: var(--fg-muted); opacity: 0.5; transition: opacity .15s ease; align-self: center; }',
      '.nc-report-btn:hover, .nc-row:hover .nc-report-btn { opacity: 1; color: var(--rouge-500); }',
      '.nc-report-btn i, .nc-report-btn svg { width: 14px; height: 14px; }',
      '.nc-modal-backdrop { position: fixed; inset: 0; background: rgba(27,18,24,0.4); z-index: 1300; display: none; }',
      '.nc-modal-backdrop.open { display: block; }',
      '.nc-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 440px; max-width: calc(100vw - 32px); background: var(--cream-50); border: 1px solid var(--stone-200); border-radius: 14px; box-shadow: 0 24px 60px rgba(40,30,20,0.18); padding: 22px; z-index: 1301; display: none; }',
      '.nc-modal.open { display: block; }',
      '.nc-modal__title { font-family: var(--font-display); font-weight: 700; font-size: 18px; margin: 0 0 6px; color: var(--ink); }',
      '.nc-modal__sub { font-size: 13px; color: var(--fg-muted); margin: 0 0 14px; }',
      '.nc-modal__quote { font-size: 13px; color: var(--ink); background: var(--cream-100); border-radius: 8px; padding: 10px 12px; margin: 0 0 14px; max-height: 90px; overflow-y: auto; white-space: pre-wrap; }',
      '.nc-modal textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--stone-200); border-radius: 8px; font-family: inherit; font-size: 14px; min-height: 70px; resize: vertical; box-sizing: border-box; }',
      '.nc-modal__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }',
      '.nc-modal__actions .btn-ghost, .nc-modal__actions .btn-primary { padding: 9px 16px; font-size: 14px; }',
      '@media (max-width: 720px) { .nc-modal { width: calc(100vw - 24px); padding: 18px; } }',
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

    function avatarHtml(name, imgUrl) {
      // Hvis vi har et bilde (f.eks. salongens cover), bruk det. Ellers
      // navn-deterministisk gradient med initialer (via NailedAvatar).
      var style, text;
      if (imgUrl) {
        style = 'background-image:url(\'' + encodeURI(imgUrl) + '\')';
        text = '';
      } else {
        var grad = (window.NailedAvatar && window.NailedAvatar.gradientFor(name))
          || 'var(--cream-200, #ece4d8)';
        style = 'background:' + grad + ';color:#fff';
        text = escapeHtml(initialsOf(name));
      }
      return '<span class="nc-row__avatar" style="' + style + '">' + text + '</span>';
    }

    function ensureReportModal() {
      if (document.getElementById('ncReportModal')) return;
      var backdrop = document.createElement('div');
      backdrop.className = 'nc-modal-backdrop';
      backdrop.id = 'ncReportBackdrop';
      document.body.appendChild(backdrop);
      var modal = document.createElement('div');
      modal.className = 'nc-modal';
      modal.id = 'ncReportModal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML =
        '<h3 class="nc-modal__title">Rapporter melding</h3>' +
        '<p class="nc-modal__sub">Vi sender denne til moderering. Beskriv kort hvorfor du rapporterer.</p>' +
        '<div class="nc-modal__quote" id="ncReportQuote"></div>' +
        '<textarea id="ncReportReason" maxlength="2000" placeholder="Hva er problemet? (valgfritt)"></textarea>' +
        '<div class="nc-modal__actions">' +
          '<button type="button" class="btn btn-ghost" id="ncReportCancel">Avbryt</button>' +
          '<button type="button" class="btn btn-primary" id="ncReportSubmit">Send rapport</button>' +
        '</div>';
      document.body.appendChild(modal);
      backdrop.addEventListener('click', closeReportModal);
      document.getElementById('ncReportCancel').addEventListener('click', closeReportModal);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeReportModal();
      });
    }
    function openReportModal(messageId, snippet) {
      ensureReportModal();
      var modal = document.getElementById('ncReportModal');
      var backdrop = document.getElementById('ncReportBackdrop');
      var quote = document.getElementById('ncReportQuote');
      var reasonEl = document.getElementById('ncReportReason');
      var submitBtn = document.getElementById('ncReportSubmit');
      if (quote) quote.textContent = snippet || '';
      if (reasonEl) reasonEl.value = '';
      submitBtn.onclick = async function () {
        submitBtn.disabled = true;
        try {
          var reason = (reasonEl.value || '').trim();
          var res = await NailedAuth.api('/api/v1/chat/messages/' + messageId + '/report', {
            method: 'POST',
            body: { reason: reason || null },
          });
          if (res.ok) {
            if (window.NailedForms && NailedForms.toast) NailedForms.toast('Rapport sendt');
            closeReportModal();
          } else {
            if (window.NailedForms && NailedForms.toast) NailedForms.toast('Kunne ikke sende rapport', { type: 'error' });
          }
        } finally {
          submitBtn.disabled = false;
        }
      };
      modal.classList.add('open');
      backdrop.classList.add('open');
      setTimeout(function () { if (reasonEl) reasonEl.focus(); }, 100);
    }
    function closeReportModal() {
      var m = document.getElementById('ncReportModal');
      var b = document.getElementById('ncReportBackdrop');
      if (m) m.classList.remove('open');
      if (b) b.classList.remove('open');
    }

    function buildMessagesHtml(data) {
      var msgs = data.messages || [];
      if (!msgs.length) {
        return '<div style="text-align:center;color:var(--fg-muted);padding:24px;font-size:13px;">Ingen meldinger ennå. Si hei!</div>';
      }
      var role = data.thread.role;
      var customerName = data.thread.customer_name || 'Du';
      var salonName = data.thread.salon_name || 'Salongen';
      var salonCover = data.thread.salon_cover_url || null;
      var lastMineIdx = -1;
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].sender_role === role) { lastMineIdx = i; break; }
      }
      return msgs.map(function (m, idx) {
        var mine = m.sender_role === role;
        var name = m.sender_role === 'customer' ? customerName : salonName;
        var imgUrl = m.sender_role === 'salon' ? salonCover : null;
        var avatar = avatarHtml(name, imgUrl);
        var readMark = '';
        if (mine && idx === lastMineIdx && m.read) {
          readMark = '<div class="nc-readmark">Lest</div>';
        }
        var reportBtn = mine ? '' :
          '<button type="button" class="nc-report-btn" data-report-msg="' + m.id + '" title="Rapporter melding" aria-label="Rapporter melding">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' +
          '</button>';
        return '<div class="nc-row nc-row--' + (mine ? 'mine' : 'theirs') + '">' +
            avatar +
            '<div class="nc-msg" data-msg-id="' + m.id + '">' +
              escapeHtml(m.body).replace(/\n/g, '<br>') +
              '<span class="nc-msg__time">' + escapeHtml(fmtTime(m.sent_at)) + '</span>' +
            '</div>' +
            reportBtn +
          '</div>' + readMark;
      }).join('');
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
        // Tråd-avataren: bruk salon-cover når motparten ER salongen (dvs.
        // viewer er kunden). For salon-eier vises kundens initialer.
        var imgUrl = t.role === 'customer' ? t.salon_cover_url : null;
        var avatar;
        if (imgUrl) {
          avatar = '<span class="nc-thread__avatar" style="background-image:url(\'' + encodeURI(imgUrl) + '\');background-size:cover;background-position:center;"></span>';
        } else {
          var grad = (window.NailedAvatar && window.NailedAvatar.gradientFor(name)) || '';
          var style = grad ? 'background:' + grad + ';color:#fff;' : '';
          avatar = '<span class="nc-thread__avatar" style="' + style + '">' + escapeHtml(initialsOf(name)) + '</span>';
        }
        return '<div class="nc-thread' + (t.id === activeId ? ' is-active' : '') + '" data-id="' + t.id + '">' +
          avatar +
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
          bodyEl.innerHTML = buildMessagesHtml(data);
          // Wire rapport-knapper (én per theirs-melding)
          bodyEl.querySelectorAll('[data-report-msg]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var msgId = parseInt(this.getAttribute('data-report-msg'), 10);
              var msgEl = bodyEl.querySelector('[data-msg-id="' + msgId + '"]');
              var snippet = msgEl ? (msgEl.textContent || '').slice(0, 240) : '';
              openReportModal(msgId, snippet);
            });
          });
          bodyEl.scrollTop = bodyEl.scrollHeight;
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
      // Mobil: scroll til siste melding når tastaturet åpner seg.
      // Liten delay så iOS rekker å resize viewport først.
      inputEl.addEventListener('focus', function () {
        setTimeout(function () { bodyEl.scrollTop = bodyEl.scrollHeight; }, 300);
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
        var bodyEl = paneEl.querySelector('#ncBody');
        if (bodyEl) {
          NailedAuth.api('/api/v1/chat/threads/' + activeId + '/messages').then(function (r) {
            return r.ok ? r.json() : null;
          }).then(function (data) {
            if (!data) return;
            var atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 30;
            bodyEl.innerHTML = buildMessagesHtml(data);
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
