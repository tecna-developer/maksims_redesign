#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE_ORIGIN = new URL(CONFIG.siteUrl).origin;
const mode = process.argv[2] || 'all';

if (!['all', 'html', 'links'].includes(mode)) {
  console.error('Usage: node scripts/check-site.mjs [html|links|all]');
  process.exit(2);
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist. Run "npm run build" first.');
  process.exit(1);
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const slash = value => value.split(path.sep).join('/');
const relative = file => slash(path.relative(DIST, file));
const htmlFiles = walk(DIST).filter(file => file.endsWith('.html'));
const htmlByRelativePath = new Map(
  htmlFiles.map(file => [relative(file), fs.readFileSync(file, 'utf8')]),
);
const errors = [];

const fail = (file, message) => errors.push(`${relative(file)}: ${message}`);
const count = (text, expression) => [...text.matchAll(expression)].length;
const stripComments = html => html.replace(/<!--[\s\S]*?-->/g, '');
const stripTags = html => html.replace(/<[^>]*>/g, '').trim();
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? match[2] : null;
};

const idsByFile = new Map();
for (const file of htmlFiles) {
  const html = stripComments(htmlByRelativePath.get(relative(file)));
  const ids = [...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2]);
  idsByFile.set(relative(file), new Set(ids));
}

function expectedLanguage(file) {
  const rel = relative(file);
  if (rel.startsWith('ru/')) return 'ru';
  if (rel.startsWith('en/')) return 'en';
  return 'et';
}

function checkBalancedTags(file, html) {
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const cleaned = stripComments(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const stack = [];

  for (const match of cleaned.matchAll(/<(\/)?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    const selfClosing = /\/\s*>$/.test(match[0]);
    if (voidElements.has(name) || selfClosing) continue;

    if (!closing) {
      stack.push(name);
      continue;
    }

    const open = stack.pop();
    if (open !== name) {
      fail(file, `tag mismatch: expected </${open || 'none'}>, found </${name}>`);
      return;
    }
  }

  if (stack.length) fail(file, `unclosed tag(s): ${stack.join(', ')}`);
}

function checkHtmlFile(file) {
  const raw = htmlByRelativePath.get(relative(file));
  const html = stripComments(raw);

  if (!/^<!doctype html>/i.test(raw.trimStart())) fail(file, 'missing <!doctype html>');
  if (/\{\{[^}]+\}\}/.test(html)) fail(file, 'contains an unresolved {{placeholder}}');

  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];
  const lang = htmlTag && attribute(htmlTag, 'lang');
  if (!lang) fail(file, '<html> is missing a lang attribute');
  else if (lang !== expectedLanguage(file)) {
    fail(file, `lang="${lang}" does not match the file location (expected ${expectedLanguage(file)})`);
  }

  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1) fail(file, `expected exactly one <title>, found ${titles.length}`);
  else if (!stripTags(titles[0][1])) fail(file, '<title> is empty');

  const descriptions = count(html, /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*>/gi);
  if (descriptions !== 1) fail(file, `expected one meta description, found ${descriptions}`);

  const canonicals = count(html, /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/gi);
  if (canonicals !== 1) fail(file, `expected one canonical link, found ${canonicals}`);

  const h1Count = count(html, /<h1\b[^>]*>/gi);
  if (h1Count !== 1) fail(file, `expected exactly one <h1>, found ${h1Count}`);

  const mainCount = count(html, /<main\b[^>]*>/gi);
  if (mainCount !== 1) fail(file, `expected exactly one <main>, found ${mainCount}`);

  const ids = [...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(file, `duplicate id value(s): ${duplicates.join(', ')}`);

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (attribute(match[0], 'alt') === null) fail(file, `<img> is missing alt: ${match[0].slice(0, 100)}`);
  }

  for (const match of html.matchAll(/<button\b[^>]*>/gi)) {
    if (attribute(match[0], 'type') === null) fail(file, `<button> is missing type: ${match[0].slice(0, 100)}`);
  }

  for (const match of html.matchAll(/\baria-(?:labelledby|describedby|controls)\s*=\s*(["'])(.*?)\1/gi)) {
    for (const id of match[2].trim().split(/\s+/)) {
      if (id && !ids.includes(id)) fail(file, `${match[0]} points to missing id="${id}"`);
    }
  }

  checkBalancedTags(file, raw);
}

function publicPathFor(file) {
  const rel = relative(file);
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel.replace(/\.html$/, '');
}

function fileForPublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const candidates = [];
  if (!decoded) candidates.push('index.html');
  else if (decoded.endsWith('/')) candidates.push(decoded + 'index.html');
  else {
    candidates.push(decoded);
    if (!path.posix.extname(decoded)) {
      candidates.push(decoded + '.html', decoded + '/index.html');
    }
  }
  return candidates.find(candidate => fs.existsSync(path.join(DIST, candidate))) || null;
}

function checkReference(file, value, label) {
  if (!value || /^(?:mailto:|tel:|data:|javascript:)/i.test(value)) return;
  if (value.startsWith('//')) return;

  let target;
  try {
    target = new URL(value.replace(/&amp;/g, '&'), `https://local.test${publicPathFor(file)}`);
  } catch {
    fail(file, `invalid ${label}: ${value}`);
    return;
  }

  if (target.origin !== 'https://local.test' && target.origin !== SITE_ORIGIN) return;

  // Vercel provides platform routes only after deployment; they are not files in dist/.
  if (target.pathname.startsWith('/_vercel/')) return;

  const targetRelative = fileForPublicPath(target.pathname);
  if (!targetRelative) {
    fail(file, `broken ${label}: ${value}`);
    return;
  }

  if (target.hash) {
    const id = decodeURIComponent(target.hash.slice(1));
    if (id && !idsByFile.get(targetRelative)?.has(id)) {
      fail(file, `broken anchor ${value}: id="${id}" does not exist in ${targetRelative}`);
    }
  }
}

function checkLinksInHtml(file) {
  const html = stripComments(htmlByRelativePath.get(relative(file)));

  for (const match of html.matchAll(/\b(href|src)\s*=\s*(["'])(.*?)\2/gi)) {
    checkReference(file, match[3].trim(), match[1].toLowerCase());
  }

  for (const match of html.matchAll(/\bsrcset\s*=\s*(["'])(.*?)\1/gi)) {
    for (const candidate of match[2].split(',')) {
      checkReference(file, candidate.trim().split(/\s+/)[0], 'srcset');
    }
  }
}

function checkCssLinks() {
  for (const name of ['styles.css', 'fonts.css']) {
    const file = path.join(DIST, name);
    if (!fs.existsSync(file)) {
      errors.push(`${name}: missing generated stylesheet`);
      continue;
    }
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      const value = match[2].trim();
      if (!value || /^(?:data:|https?:|\/\/)/i.test(value)) continue;
      const target = path.resolve(path.dirname(file), value.split(/[?#]/)[0]);
      if (!target.startsWith(DIST) || !fs.existsSync(target)) {
        errors.push(`${name}: broken CSS url: ${value}`);
      }
    }
  }
}

function checkSitemap() {
  const sitemapPath = path.join(DIST, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    errors.push('sitemap.xml: file is missing');
    return;
  }

  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  const duplicates = [...new Set(locations.filter((url, index) => locations.indexOf(url) !== index))];
  if (duplicates.length) errors.push(`sitemap.xml: duplicate URL(s): ${duplicates.join(', ')}`);

  for (const location of locations) {
    const url = new URL(location);
    if (url.origin !== SITE_ORIGIN) errors.push(`sitemap.xml: unexpected origin in ${location}`);
    else if (!fileForPublicPath(url.pathname)) errors.push(`sitemap.xml: broken URL ${location}`);
    if (/\/404(?:\.html)?$/.test(url.pathname)) errors.push('sitemap.xml: 404 page must not be indexed');
  }
}

if (mode === 'all' || mode === 'html') {
  for (const file of htmlFiles) checkHtmlFile(file);
  if (!errors.length) console.log(`HTML check passed: ${htmlFiles.length} generated pages.`);
}

if (mode === 'all' || mode === 'links') {
  for (const file of htmlFiles) checkLinksInHtml(file);
  checkCssLinks();
  checkSitemap();
  if (!errors.length) console.log(`Link check passed: ${htmlFiles.length} pages and local assets.`);
}

if (errors.length) {
  console.error(`\nSite check failed with ${errors.length} error(s):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
