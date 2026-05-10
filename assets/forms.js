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
      '.nailed-toast-host{position:fixed;right:24px;bottom:24px;display:flex;flex-direction:column;gap:10px;z-index:9999;pointer-events:none;}',
      '.nailed-toast{pointer-events:auto;display:inline-flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;font-family:var(--font-body,system-ui,sans-serif);font-weight:600;font-size:14px;color:#fff;background:#1B1218;box-shadow:0 12px 28px rgba(27,18,24,0.18);transform:translateY(20px);opacity:0;transition:transform 0.18s ease-out,opacity 0.18s ease-out;}',
      '.nailed-toast.is-in{transform:translateY(0);opacity:1;}',
      '.nailed-toast.is-out{transform:translateY(20px);opacity:0;}',
      '.nailed-toast--success{background:#3D7A4A;}',
      '.nailed-toast--error{background:#C8324A;}',
      '.nailed-toast--info{background:#1B1218;}',
      '.nailed-toast__dot{width:8px;height:8px;border-radius:999px;background:rgba(255,255,255,0.85);flex-shrink:0;}',
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

  function toast(message, opts) {
    ensureToastStyles();
    opts = opts || {};
    var type = opts.type || 'success';
    var duration = opts.duration || 2400;

    var el = document.createElement('div');
    el.className = 'nailed-toast nailed-toast--' + type;
    var dot = document.createElement('span');
    dot.className = 'nailed-toast__dot';
    el.appendChild(dot);
    var text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    var host = getHost();
    host.appendChild(el);

    // Force layout, then animate in.
    requestAnimationFrame(function () {
      el.classList.add('is-in');
    });

    setTimeout(function () {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 220);
    }, duration);
  }

  global.NailedForms = {
    enhanceUrlInputs: enhanceUrlInputs,
    toast: toast,
  };
})(window);
