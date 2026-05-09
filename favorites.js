// Nailed — Favorites (cookie-based)

function getFavorites() {
  var match = document.cookie.match(/nailed_favs=([^;]+)/);
  if (!match) return [];
  try { return JSON.parse(decodeURIComponent(match[1])); } catch(e) { return []; }
}

function saveFavorites(favs) {
  var d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  document.cookie = 'nailed_favs=' + encodeURIComponent(JSON.stringify(favs)) + ';path=/;expires=' + d.toUTCString();
}

function toggleFavorite(salonId) {
  var favs = getFavorites();
  var idx = favs.indexOf(salonId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(salonId);
  }
  saveFavorites(favs);
  return favs.indexOf(salonId) >= 0;
}

function isFavorite(salonId) {
  return getFavorites().indexOf(salonId) >= 0;
}

function initFavorites() {
  var favs = getFavorites();

  // Style all heart buttons based on saved state
  document.querySelectorAll('[data-fav]').forEach(function(btn) {
    var id = btn.getAttribute('data-fav');
    var icon = btn.querySelector('i');
    if (favs.indexOf(id) >= 0 && icon) {
      icon.style.color = 'var(--rouge-500)';
      icon.style.fill = 'var(--rouge-500)';
    }
  });

  // Bind click events
  document.querySelectorAll('[data-fav]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var id = btn.getAttribute('data-fav');
      var isNowFav = toggleFavorite(id);
      var icon = btn.querySelector('i');
      if (icon) {
        icon.style.color = isNowFav ? 'var(--rouge-500)' : '';
        icon.style.fill = isNowFav ? 'var(--rouge-500)' : '';
      }
    });
  });

  // Nav heart icon — show count
  updateNavHeart();
}

function updateNavHeart() {
  var navHeart = document.querySelector('.btn-icon [data-lucide="heart"]');
  if (!navHeart) return;
  var btn = navHeart.closest('.btn-icon');
  if (!btn) return;
  var count = getFavorites().length;
  var badge = btn.querySelector('.fav-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'fav-badge';
      badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:var(--rouge-500);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;';
      btn.style.position = 'relative';
      btn.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
}
