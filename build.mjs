#!/usr/bin/env node
// Static site generator for maksims.ee.
//
// Renders src/pages/*.html once per language into dist/, so every language gets
// its own crawlable URL with the text baked into the HTML. The header and footer
// live in src/partials/ and are shared — duplicating them across pages is what
// let the footer's third column drift out of sync and render empty.
//
// The build FAILS on a placeholder that no locale can fill. That check is the
// point of this script: it makes "translated on one page, missing on another"
// impossible to ship.
//
// Usage:  node build.mjs [--serve]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const { siteUrl, defaultLang, langs, company } = config;

// id -> output filename. The Estonian slugs are kept in every language so the
// live Estonian URLs keep working and no redirect map is needed.
const PAGES = [
  { id: 'index', file: 'index.html', priority: '1.0' },
  { id: 'teenused', file: 'teenused.html', priority: '0.9' },
  { id: 'ettevottest', file: 'ettevottest.html', priority: '0.7' },
  { id: 'uudised', file: 'uudised.html', priority: '0.4' },
  { id: 'kontakt', file: 'kontakt.html', priority: '0.9' },
  { id: 'privaatsus', file: 'privaatsus.html', priority: '0.2' },
];

const STATIC_ASSETS = [
  'styles.css', 'app.js',
  'logo-maksims-burgundy.svg', 'logo-maksims-light.svg',
  'favicon.svg',
];

// Copied when present; their absence downgrades the meta tags rather than
// pointing them at a 404.
const OPTIONAL_ASSETS = ['og-maksims.png', 'apple-touch-icon.png'];

const OG_LOCALE = { et: 'et_EE', ru: 'ru_RU', en: 'en_GB' };

const locales = Object.fromEntries(langs.map(l =>
  [l, JSON.parse(fs.readFileSync(path.join(SRC, 'locales', `${l}.json`), 'utf8'))]));

const partials = Object.fromEntries(
  fs.readdirSync(path.join(SRC, 'partials'))
    .filter(f => f.endsWith('.html'))
    .map(f => [path.basename(f, '.html'), fs.readFileSync(path.join(SRC, 'partials', f), 'utf8')]));

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ---------------------------------------------------------------- URL helpers

/** Where a page lives, relative to the site root. */
const pathFor = (lang, file) => (lang === defaultLang ? file : `${lang}/${file}`);

/** Prefix that gets you from a page back to the site root. */
const assetPrefix = lang => (lang === defaultLang ? '' : '../');

/** Link from a page in `fromLang` to the same page in `toLang`. */
const crossLink = (fromLang, toLang, file) =>
  assetPrefix(fromLang) + pathFor(toLang, file);

// ------------------------------------------------------------------ rendering

/**
 * Resolve `{{key}}` / `{{{key}}}` / `{{> partial}}` against `ctx`.
 * Runs repeatedly so values may themselves contain placeholders (the consent
 * copy embeds {{privacyUrl}}, for instance). Anything still unresolved after
 * the final pass is collected and reported as a build error.
 */
function render(tpl, ctx, missing, where) {
  let out = tpl;

  // Partials first, so their placeholders take part in the same resolution.
  for (let i = 0; i < 5 && out.includes('{{>'); i++) {
    out = out.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (m, name) => {
      if (!partials[name]) { missing.push(`${where}: unknown partial "${name}"`); return ''; }
      return partials[name];
    });
  }

  const lookup = key => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);

  for (let pass = 0; pass < 5; pass++) {
    const before = out;
    out = out.replace(/\{\{\{\s*([\w.$-]+)\s*\}\}\}/g, (m, key) => {
      const v = lookup(key);
      return v === undefined ? m : String(v);
    });
    out = out.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, key) => {
      const v = lookup(key);
      return v === undefined ? m : esc(v);
    });
    if (out === before) break;
  }

  // Placeholders inside HTML comments are parked markup, not omissions — they
  // pair with the `_archive` locale entries. Uncomment the block and the key
  // becomes live, at which point a missing translation does fail the build.
  const live = out.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of live.matchAll(/\{\{\{?\s*([\w.$-]+)\s*\}?\}\}/g))
    missing.push(`${where}: no value for "${m[1]}"`);

  return out;
}

// ------------------------------------------------------------------- fragments

function langSwitch(lang, file, dict) {
  const label = { et: 'EST', ru: 'RUS', en: 'ENG' };
  const items = langs.map(l => {
    const current = l === lang;
    // A real link, so it works without JS and search engines can follow it.
    return `      <a class="lang-btn" href="${esc(crossLink(lang, l, file))}" hreflang="${l}" lang="${l}"` +
      (current ? ' aria-current="true"' : '') +
      `>${label[l]}</a>`;
  }).join('\n');
  return `<div class="lang-switch" role="group" aria-label="${esc(dict.aria_lang_switch)}">\n${items}\n    </div>`;
}

function hreflang(file) {
  const rows = langs.map(l =>
    `<link rel="alternate" hreflang="${l}" href="${siteUrl}/${pathFor(l, file)}" />`);
  rows.push(`<link rel="alternate" hreflang="x-default" href="${siteUrl}/${pathFor(defaultLang, file)}" />`);
  return rows.join('\n');
}

function jsonLd(lang, pageId, dict) {
  const org = {
    '@context': 'https://schema.org',
    '@type': 'AccountingService',
    '@id': `${siteUrl}/#organization`,
    name: company.displayName,
    legalName: company.legalName,
    url: `${siteUrl}/${pathFor(lang, 'index.html')}`,
    email: company.email,
    telephone: company.phone,
    foundingDate: company.founded,
    image: `${siteUrl}/og-maksims.png`,
    logo: `${siteUrl}/logo-maksims-burgundy.svg`,
    description: dict.meta_description,
    address: {
      '@type': 'PostalAddress',
      streetAddress: company.street,
      postalCode: company.postalCode,
      addressLocality: company.city,
      addressRegion: company.region,
      addressCountry: company.country,
    },
    geo: { '@type': 'GeoCoordinates', latitude: company.latitude, longitude: company.longitude },
    areaServed: { '@type': 'Country', name: 'Estonia' },
    availableLanguage: ['et', 'ru', 'en', 'fi'],
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: company.opens,
      closes: company.closes,
    }],
  };
  if (company.regCode) org.identifier = company.regCode;
  if (company.vatNumber) org.vatID = company.vatNumber;

  const blocks = [org];

  if (pageId === 'index') {
    const faq = [1, 2, 3, 4, 5]
      .filter(n => dict[`faq${n}_q`] && dict[`faq${n}_a`])
      .map(n => ({
        '@type': 'Question',
        name: dict[`faq${n}_q`],
        acceptedAnswer: { '@type': 'Answer', text: dict[`faq${n}_a`] },
      }));
    if (faq.length) blocks.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq });
  }

  return blocks
    .map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join('\n');
}

function requisites(dict) {
  const rows = [];
  if (company.regCode) rows.push(`<li><span>${esc(dict.footer_reg)}: ${esc(company.regCode)}</span></li>`);
  if (company.vatNumber) rows.push(`<li><span>${esc(dict.footer_vat)}: ${esc(company.vatNumber)}</span></li>`);
  return rows.join('\n          ');
}

function requisitesCard(dict) {
  if (!company.regCode && !company.vatNumber) return '';
  const rows = [];
  if (company.regCode) rows.push(`<dt>${esc(dict.footer_reg)}</dt><dd>${esc(company.regCode)}</dd>`);
  if (company.vatNumber) rows.push(`<dt>${esc(dict.footer_vat)}</dt><dd>${esc(company.vatNumber)}</dd>`);
  return `<div class="contact-card">\n            <h3>${esc(dict.legalName || company.legalName)}</h3>\n            <dl>${rows.join('')}</dl>\n          </div>`;
}

// ----------------------------------------------------------------- build pass

const missing = [];
const warnings = [];
let written = 0;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

if (!config.formEndpoint)
  warnings.push(
    'site.config.json -> formEndpoint is empty.\n' +
    '    The quote form falls back to opening the visitor\'s mail client (mailto:) so no\n' +
    '    enquiry is lost, but that is a degraded path. Set a real POST endpoint before go-live.');

for (const page of PAGES) {
  const tplPath = path.join(SRC, 'pages', `${page.file}`);
  if (!fs.existsSync(tplPath)) { missing.push(`missing template ${tplPath}`); continue; }
  const tpl = fs.readFileSync(tplPath, 'utf8');

  for (const lang of langs) {
    const loc = locales[lang];
    if (!loc.pages[page.id]) { missing.push(`${lang}.json has no pages.${page.id}`); continue; }

    const dict = { ...loc.common, ...loc.pages[page.id] };
    const asset = assetPrefix(lang);

    const ctx = {
      ...dict,
      lang,
      asset,
      siteUrl,
      company,
      privacyUpdated: config.privacyUpdated,
      canonical: `${siteUrl}/${pathFor(lang, page.file)}`,
      ogLocale: OG_LOCALE[lang],
      ogLocaleAlt: langs.filter(l => l !== lang)
        .map(l => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`).join('\n'),
      // Emitted only when the asset actually exists — a 404 og:image makes
      // every shared link render a broken preview card.
      ogImage: fs.existsSync(path.join(ROOT, 'og-maksims.png'))
        ? `<meta property="og:image" content="${siteUrl}/og-maksims.png" />\n` +
          '<meta property="og:image:width" content="1200" />\n' +
          '<meta property="og:image:height" content="630" />\n' +
          '<meta name="twitter:card" content="summary_large_image" />'
        : '<meta name="twitter:card" content="summary" />',
      appleIcon: fs.existsSync(path.join(ROOT, 'apple-touch-icon.png'))
        ? `<link rel="apple-touch-icon" href="${asset}apple-touch-icon.png" />`
        : '',
      hreflang: hreflang(page.file),
      jsonLd: jsonLd(lang, page.id, dict),
      langSwitch: langSwitch(lang, page.file, dict),
      footerRequisites: requisites(dict),
      requisitesCard: requisitesCard(dict),
      privacyUrl: asset + pathFor(lang, 'privaatsus.html'),
      // The policy has to describe what actually happens: with no form service
      // configured the form falls back to mailto and no processor is involved.
      sharingProcessor: company.formProvider ? dict.sharing_provider : dict.sharing_mailto,
      formAction: config.formEndpoint || `mailto:${company.email}`,
      formMode: config.formEndpoint ? 'post' : 'mailto',
    };

    // Page URLs, relative to this page, plus the aria-current marker.
    for (const p of PAGES) {
      ctx[`url_${p.id}`] = p.file;
      ctx[`current_${p.id}`] = p.id === page.id ? 'aria-current="page"' : '';
    }

    const body = render(tpl, ctx, missing, `${page.id}/${lang}`);
    const head = render(partials.head, ctx, missing, `${page.id}/${lang}/head`);

    const html = `<!doctype html>
<html lang="${lang}">

<head>
${head.trim().split('\n').map(l => l ? '  ' + l : l).join('\n')}
</head>

<body>
${body.trim()}
</body>

</html>
`;

    const dest = path.join(OUT, pathFor(lang, page.file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html, 'utf8');
    written++;
  }
}

// Unused locale keys are only noise, not a failure.
for (const lang of langs) {
  const used = new Set();
  for (const p of PAGES) {
    const tplPath = path.join(SRC, 'pages', p.file);
    if (!fs.existsSync(tplPath)) continue;
    const all = fs.readFileSync(tplPath, 'utf8') +
      Object.values(partials).join('\n');
    for (const m of all.matchAll(/\{\{\{?\s*([\w.$-]+)\s*\}?\}\}/g)) used.add(m[1]);
  }
  const declared = new Set([
    ...Object.keys(locales[lang].common),
    ...PAGES.flatMap(p => Object.keys(locales[lang].pages[p.id] || {})),
  ]);
  // Consumed by this script rather than by a template placeholder.
  const usedInBuild = ['meta_title', 'meta_description', 'aria_lang_switch',
    'footer_reg', 'footer_vat', 'legalName', 'sharing_mailto', 'sharing_provider'];
  // `_`-prefixed keys are deliberately parked (see `_archive`): copy kept for
  // markup that is currently commented out. Not an omission, so not reported.
  const unused = [...declared].filter(k =>
    !k.startsWith('_') && !used.has(k) && !usedInBuild.includes(k));
  if (unused.length) warnings.push(`${lang}.json: ${unused.length} unused key(s): ${unused.join(', ')}`);
}

// ------------------------------------------------------------ static + extras

for (const asset of STATIC_ASSETS) {
  const from = path.join(ROOT, asset);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, asset));
  else warnings.push(`asset not found, skipped: ${asset}`);
}

for (const asset of OPTIONAL_ASSETS) {
  const from = path.join(ROOT, asset);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, asset));
  else warnings.push(`optional asset missing: ${asset} — related meta tags omitted`);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${PAGES.flatMap(p => langs.map(lang => `  <url>
    <loc>${siteUrl}/${pathFor(lang, p.file)}</loc>
${langs.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${siteUrl}/${pathFor(l, p.file)}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/${pathFor(defaultLang, p.file)}"/>
    <priority>${p.priority}</priority>
  </url>`)).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap, 'utf8');

fs.writeFileSync(path.join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`, 'utf8');

// ---------------------------------------------------------------------- report

if (warnings.length) {
  console.log('\n  Warnings:');
  for (const w of warnings) console.log('  ! ' + w);
}

if (missing.length) {
  console.error(`\n  BUILD FAILED — ${missing.length} unresolved placeholder(s):\n`);
  for (const m of [...new Set(missing)].slice(0, 40)) console.error('  x ' + m);
  if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);
  console.error('\n  Every {{key}} must exist in all of: ' + langs.join(', ') + '\n');
  process.exit(1);
}

console.log(`\n  Built ${written} pages (${PAGES.length} x ${langs.length}) -> dist/`);
console.log(`  + sitemap.xml, robots.txt, ${STATIC_ASSETS.length} assets\n`);

// ---------------------------------------------------------------- dev server

if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  const port = Number(process.env.PORT) || 4173;
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  };

  createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(OUT, clean);
    // Contain traversal to dist/.
    if (!file.startsWith(OUT)) { res.writeHead(403).end('Forbidden'); return; }
    if (clean.endsWith('/')) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`  Serving dist/ at http://localhost:${port}/\n`));
}
