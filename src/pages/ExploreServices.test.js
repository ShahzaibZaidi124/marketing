// Static review of the customer-facing Explore page category wiring. The project
// has no DOM test runner installed, so — like the migration review tests under
// supabase/tests — these tests pin the source-level guarantees that matter:
//
//   * the category chips come from the live data layer, not a hardcoded array;
//   * inactive categories are never offered to customers;
//   * loading, empty and error states are handled;
//   * existing search / sort / filter behaviour is preserved.
//
// Run: node --test src/pages/ExploreServices.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exploreSource = readFileSync(join(here, "ExploreServices.jsx"), "utf8");
const dataSource = readFileSync(join(here, "..", "data", "services.js"), "utf8");

test("the category chips are driven by the live categories data layer", () => {
  // Reads the shared data layer, which itself reads active rows from the DB.
  assert.match(
    exploreSource,
    /import \{ getActiveServiceCategories, getServiceCategoriesErrorMessage \} from "\.\.\/lib\/serviceCategories\.js"/,
  );
  assert.match(exploreSource, /getActiveServiceCategories\(\)/);
  // The chips render from the loaded list, never from a module constant.
  assert.match(exploreSource, /categories\.map\(\(category\) =>/);
  assert.match(exploreSource, /categories\.find\(\(category\) => category\.id === selectedCategory\)/);
});

test("the hardcoded category array is gone and no longer imported", () => {
  // The page must not import the old browser-memory array.
  assert.doesNotMatch(exploreSource, /from "\.\.\/data\/services\.js"/);
  // ...and the constant must not exist anywhere any more.
  assert.doesNotMatch(dataSource, /export const serviceCategories\b/);
  // Unrelated data exports stay intact.
  assert.match(dataSource, /export const servicePackages =/);
  assert.match(dataSource, /export const serviceDetailsByCategory =/);
});

test("inactive categories are never shown to customers", () => {
  // Only the active-only read path is used; the page never queries the table
  // directly and never asks for inactive rows.
  assert.doesNotMatch(exploreSource, /from\("categories"\)/);
  assert.doesNotMatch(exploreSource, /is_active/);
  assert.doesNotMatch(exploreSource, /is_active: false/);
});

test("loading, empty and error states are handled", () => {
  assert.match(exploreSource, /categoriesLoading/);
  assert.match(exploreSource, /categoriesError/);
  assert.match(exploreSource, /Loading categories…/);
  assert.match(exploreSource, /No categories available yet\./);
  assert.match(exploreSource, /getServiceCategoriesErrorMessage\(error\)/);
  // The error notice is announced to assistive tech.
  assert.match(exploreSource, /filter-category-note-error" role="alert"/);
});

test("existing search, sort and filter behaviour is preserved", () => {
  for (const marker of [
    "searchTerm",
    "sortOrder",
    "minPrice",
    "maxPrice",
    "deliveryLimit",
    "sellerInput",
    "filteredServices",
    "chooseCategory",
    "clearFilters",
  ]) {
    assert.match(exploreSource, new RegExp(`\\b${marker}\\b`), `Explore page must keep ${marker}`);
  }
  // A deep link to an unknown or removed category falls back to "all".
  assert.match(exploreSource, /const isKnown = categoryFromUrl === "all" \|\| categories\.some/);
  assert.match(exploreSource, /setSelectedCategory\("all"\)/);
});
