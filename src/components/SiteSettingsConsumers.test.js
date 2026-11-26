// Static review of the public website wiring to the saved platform settings. The
// project has no DOM test runner installed, so — like the other review tests —
// these assertions pin the source-level guarantees that matter:
//
//   * the app is wrapped in SiteSettingsProvider, which loads the public settings
//     once (and only the four displayed values, via the curated projection RPC);
//   * the header brand, footer and contact page read those values instead of the
//     old hardcoded copy, while keeping the existing layout (the styled trailing
//     period, the same mailto slots);
//   * the shipped defaults remain the fallback, so the design never blanks.
//
// Run: node --test src/components/SiteSettingsConsumers.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(join(here, ...segments), "utf8");

const mainSource = read("..", "main.jsx");
const contextSource = read("..", "context", "SiteSettingsContext.jsx");
const headerSource = read("Header.jsx");
const footerSource = read("Footer.jsx");
const infoSource = read("..", "pages", "InfoPages.jsx");

test("the app is wrapped in SiteSettingsProvider", () => {
  assert.match(mainSource, /import \{ SiteSettingsProvider \} from "\.\/context\/SiteSettingsContext\.jsx"/);
  assert.match(mainSource, /<SiteSettingsProvider>[\s\S]*<App \/>[\s\S]*<\/SiteSettingsProvider>/);
});

test("the provider loads the public settings once and exposes a safe value", () => {
  assert.match(contextSource, /import \{ defaultPlatformSettings, getPublicSiteSettings \} from "\.\.\/lib\/platformSettings\.js"/);
  assert.match(contextSource, /getPublicSiteSettings\(\)/);
  // Loaded in a mount-only effect (empty dependency list = once).
  assert.match(contextSource, /\}, \[\]\);/);
  // Defaults are the starting state and the failure fallback.
  assert.match(contextSource, /useState\(defaultPlatformSettings\)/);
  assert.match(contextSource, /setSettings\(\{ \.\.\.defaultPlatformSettings \}\)/);
  // The hook throws without a provider rather than silently returning undefined.
  assert.match(contextSource, /useSiteSettings must be used within a SiteSettingsProvider/);
});

test("the header wordmark is driven by the saved website name, design intact", () => {
  assert.match(headerSource, /import \{ useSiteSettings \} from "\.\.\/context\/SiteSettingsContext\.jsx"/);
  assert.match(headerSource, /import \{ brandNameWithoutTrailingPeriod \} from "\.\.\/lib\/platformSettings\.js"/);
  assert.match(headerSource, /const brandName = brandNameWithoutTrailingPeriod\(settings\.websiteName\)/);
  // The single styled period is still rendered separately, so the mark looks the same.
  assert.match(headerSource, /<span>\{brandName\}<span className="brand-period">\.<\/span><\/span>/);
  // The old hardcoded wordmark is gone.
  assert.doesNotMatch(headerSource, /<span>NexTech<span className="brand-period">/);
});

test("the footer renders the saved description and email addresses", () => {
  assert.match(footerSource, /import \{ useSiteSettings \} from "\.\.\/context\/SiteSettingsContext\.jsx"/);
  assert.match(footerSource, /const description = settings\.websiteDescription/);
  assert.match(footerSource, /const contactEmail = settings\.contactEmail/);
  // The support address falls back to the contact address so the link is never blank.
  assert.match(footerSource, /const supportEmail = settings\.supportEmail \|\| contactEmail/);
  assert.match(footerSource, /<p>\{description\}<\/p>/);
  assert.match(footerSource, /href=\{`mailto:\$\{supportEmail\}`\}/);
  assert.match(footerSource, /href=\{`mailto:\$\{contactEmail\}`\}/);
  assert.match(footerSource, /href=\{`mailto:\$\{contactEmail\}\?subject=Privacy%20policy%20request`\}/);
  // The styled brand period and the copyright line are preserved.
  assert.match(footerSource, /<span>\{brandName\}<span className="brand-period">\.<\/span><\/span>/);
  assert.match(footerSource, /© \{new Date\(\)\.getFullYear\(\)\} \{brandName\}\. Connecting ideas with developers\./);
  // No hardcoded contact address remains.
  assert.doesNotMatch(footerSource, /hello@techstudio\.pk/);
});

test("the contact page uses the saved contact address", () => {
  assert.match(infoSource, /import \{ useSiteSettings \} from "\.\.\/context\/SiteSettingsContext\.jsx"/);
  assert.match(infoSource, /href=\{`mailto:\$\{settings\.contactEmail\}`\}/);
  assert.match(infoSource, /\{settings\.contactEmail\} <ArrowUpRight size=\{17\} \/>/);
  assert.doesNotMatch(infoSource, /hello@techstudio\.pk/);
});
