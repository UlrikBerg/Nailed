// Bildevariant-håndtering. Nye opplastinger lagres som «salons/{id}/v2/{hash}.webp»
// pluss tre størrelser «v2/{hash}-400.webp», «-800», «-1600». Gamle bilder uten
// «/v2/» har bare full-size — det er greit, frontend bruker srcset bare når
// variants finnes.
//
// Eksport:
//   - VARIANT_SIZES — array av piksler vi genererer
//   - hasVariants(key) — boolean
//   - variantKey(baseKey, size) — utleder f.eks. «foo-400.webp» fra «foo.webp»
//   - variantUrls(key, publicUrl) — { url, url_400, url_800, url_1600 } eller bare { url }

const VARIANT_SIZES = [400, 800, 1600];

function hasVariants(key) {
  return typeof key === 'string' && key.indexOf('/v2/') !== -1;
}

function variantKey(baseKey, size) {
  return baseKey.replace(/\.webp$/, `-${size}.webp`);
}

function variantUrls(key, publicUrl) {
  const base = { url: publicUrl(key) };
  if (!hasVariants(key)) return base;
  return Object.assign(base, {
    url_400:  publicUrl(variantKey(key, 400)),
    url_800:  publicUrl(variantKey(key, 800)),
    url_1600: publicUrl(variantKey(key, 1600)),
  });
}

module.exports = { VARIANT_SIZES, hasVariants, variantKey, variantUrls };
