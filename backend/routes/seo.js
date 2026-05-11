const express = require('express');
const { query } = require('../db');
const { asyncRoute } = require('../lib/util');
const config = require('../config');

const router = express.Router();

// Static public pages that should appear in the sitemap. Excludes
// /salong-panel.html, /kunde-panel.html, /admin/*, /auth-complete.html —
// those are user-area / fulfilment pages, not entry points.
const STATIC_PAGES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/utforsk', changefreq: 'daily', priority: '0.9' },
  { path: '/for-salonger', changefreq: 'weekly', priority: '0.7' },
  { path: '/last-ned-app', changefreq: 'monthly', priority: '0.5' },
  { path: '/personvern', changefreq: 'yearly', priority: '0.3' },
  { path: '/vilkar', changefreq: 'yearly', priority: '0.3' },
  { path: '/cookies', changefreq: 'yearly', priority: '0.3' },
];

function baseUrl() {
  // Strip trailing slash so we never emit double slashes in <loc>.
  return (config.publicBaseUrl || 'http://localhost:3000').replace(/\/+$/, '');
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// GET /sitemap.xml — static pages plus every active salon as /salon.html?slug=…
router.get('/sitemap.xml', asyncRoute(async (_req, res) => {
  const root = baseUrl();

  let salons = [];
  try {
    salons = await query(
      `SELECT slug, updated_at FROM salons WHERE status = 'active' ORDER BY id ASC`
    );
  } catch (_e) {
    // If the DB isn't reachable we still return a sitemap with static pages —
    // empty sitemap is worse for SEO than a partial one.
    salons = [];
  }

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const page of STATIC_PAGES) {
    lines.push('  <url>');
    lines.push(`    <loc>${xmlEscape(root + page.path)}</loc>`);
    lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
    lines.push(`    <priority>${page.priority}</priority>`);
    lines.push('  </url>');
  }

  for (const s of salons) {
    if (!s.slug) continue;
    const loc = `${root}/salon?slug=${encodeURIComponent(s.slug)}`;
    lines.push('  <url>');
    lines.push(`    <loc>${xmlEscape(loc)}</loc>`);
    if (s.updated_at) {
      const d = s.updated_at instanceof Date ? s.updated_at : new Date(s.updated_at);
      if (!isNaN(d.getTime())) {
        lines.push(`    <lastmod>${d.toISOString().slice(0, 10)}</lastmod>`);
      }
    }
    lines.push('    <changefreq>weekly</changefreq>');
    lines.push('    <priority>0.8</priority>');
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  res.type('application/xml').send(lines.join('\n'));
}));

// GET /robots.txt — open crawling except panels/admin/api.
router.get('/robots.txt', (_req, res) => {
  const root = baseUrl();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /salong-panel',
    'Disallow: /kunde-panel',
    'Disallow: /auth-complete',
    'Disallow: /api/',
    '',
    `Sitemap: ${root}/sitemap.xml`,
    '',
  ].join('\n');
  res.type('text/plain').send(body);
});

module.exports = router;
