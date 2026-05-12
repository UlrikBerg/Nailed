// Shared form helpers used by all panels.
//   NailedForms.enhanceUrlInputs(rootEl) — auto-prefixes "https://" to
//     <input type="url"> values on blur, so users can type "domain.no".
//   NailedForms.toast(msg, opts) — slides in a confirmation toast in the
//     bottom-right; opts.type ∈ 'success' | 'error' | 'info' (default 'success').
//
// CSS for the toast is injected once at runtime so panels don't need to import
// anything extra.

(function (global) {
  function enhanceUrlInputs(root) {
    var scope = root || document;
    var inputs = scope.querySelectorAll('input[type="url"]');
    inputs.forEach(function (input) {
      if (input.dataset.nailedUrlEnhanced === '1') return;
      input.dataset.nailedUrlEnhanced = '1';
      input.addEventListener('blur', function () {
        var v = (this.value || '').trim();
        if (!v) { this.value = ''; return; }
        if (!/^https?:\/\//i.test(v)) {
          this.value = 'https://' + v;
        }
      });
    });
  }

  function ensureToastStyles() {
    if (document.getElementById('nailed-toast-styles')) return;
    var style = document.createElement('style');
    style.id = 'nailed-toast-styles';
    style.textContent = [
      // Posisjon: høyre-bunn på desktop, midt-bunn på mobil + over bottom-nav.
      '.nailed-toast-host{position:fixed;right:24px;bottom:24px;display:flex;flex-direction:column;gap:10px;z-index:9999;pointer-events:none;align-items:flex-end;max-width:calc(100vw - 48px);}',
      '@media (max-width:720px){.nailed-toast-host{left:12px;right:12px;bottom:calc(56px + env(safe-area-inset-bottom) + 12px);align-items:stretch;}}',
      'body.has-kb .nailed-toast-host{bottom:calc(12px + var(--kb-inset,0px));}',
      '.nailed-toast{pointer-events:auto;display:inline-flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;font-family:var(--font-body,system-ui,sans-serif);font-weight:600;font-size:14px;color:#fff;background:#1B1218;box-shadow:0 12px 28px rgba(27,18,24,0.22);transform:translateY(20px);opacity:0;transition:transform 0.22s cubic-bezier(.22,.61,.36,1),opacity 0.22s ease-out;}',
      '.nailed-toast.is-in{transform:translateY(0);opacity:1;}',
      '.nailed-toast.is-out{transform:translateY(20px);opacity:0;}',
      '.nailed-toast--success{background:#3D7A4A;}',
      '.nailed-toast--error{background:#C8324A;}',
      '.nailed-toast--info{background:#1B1218;}',
      '.nailed-toast__icon{width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,0.18);display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}',
      '.nailed-toast__text{flex:1;min-width:0;}',
      '.nailed-toast__action{background:rgba(255,255,255,0.2);color:#fff;border:0;border-radius:8px;padding:6px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;margin-left:4px;flex-shrink:0;}',
      '.nailed-toast__action:hover{background:rgba(255,255,255,0.32);}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function getHost() {
    var host = document.querySelector('.nailed-toast-host');
    if (host) return host;
    host = document.createElement('div');
    host.className = 'nailed-toast-host';
    document.body.appendChild(host);
    return host;
  }

  // Type-spesifikke ikon-glyf-er (Unicode, ingen ekstern font kreves).
  var ICONS = { success: '✓', error: '!', info: 'i' };

  function toast(message, opts) {
    ensureToastStyles();
    opts = opts || {};
    var type = opts.type || 'success';
    // Errors får lengre varighet så brukeren rekker å lese dem.
    var duration = opts.duration || (type === 'error' ? 5000 : 2800);
    var actionLabel = opts.action && opts.action.label;
    var actionFn = opts.action && opts.action.onClick;

    var el = document.createElement('div');
    el.className = 'nailed-toast nailed-toast--' + type;

    var icon = document.createElement('span');
    icon.className = 'nailed-toast__icon';
    icon.textContent = ICONS[type] || '•';
    el.appendChild(icon);

    var text = document.createElement('span');
    text.className = 'nailed-toast__text';
    text.textContent = message;
    el.appendChild(text);

    var timeoutId;
    function remove() {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 240);
    }

    if (actionLabel && typeof actionFn === 'function') {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nailed-toast__action';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () {
        clearTimeout(timeoutId);
        try { actionFn(); } catch (_) {}
        remove();
      });
      el.appendChild(btn);
    }

    var host = getHost();
    host.appendChild(el);

    requestAnimationFrame(function () { el.classList.add('is-in'); });
    timeoutId = setTimeout(remove, duration);
  }

  global.NailedForms = {
    enhanceUrlInputs: enhanceUrlInputs,
    toast: toast,
  };
})(window);
