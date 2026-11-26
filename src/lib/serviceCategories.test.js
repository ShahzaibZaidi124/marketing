// Tests for the service-categories data layer.
//
// Two read paths exist on purpose:
//   * the customer-facing service editor reads ACTIVE categories straight from
//     public.categories (RLS also hides inactive rows from ordinary users);
//   * the Admin Categories section reads every category, including inactive ones,
//     through the read-only public.admin_service_categories() RPC, which
//     authorizes the caller server-side with has_admin_access().
//
// Every write (create / update / delete / reassign) is a has_admin_access()-gated
// RPC. The browser never sends a row id when creating — the server derives it.
//
// Run: node --experimental-test-module-mocks --test src/lib/serviceCategories.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const rpcCalls = [];
let rpcResponder = () => ({ data: null, error: null });

const tableReads = [];
let tableResponder = () => ({ data: null, error: null });

function makeQueryBuilder(table) {
  const state = { table, columns: null, filters: [], order: [] };
  const builder = {
    select(columns) { state.columns = columns; return builder; },
    eq(column, value) { state.filters.push([column, value]); return builder; },
    order(column, options) {
      state.order.push([column, options]);
      tableReads.push(state);
      return Promise.resolve(tableResponder(state));
    },
  };
  return builder;
}

// Stands in for supabase-js: records the RPC/table calls and resolves like a real
// request. Nothing here touches the network.
mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({
      rpc(name, args) {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResponder(name, args));
      },
      from(table) {
        return makeQueryBuilder(table);
      },
    }),
  },
});

const {
  createServiceCategory,
  deleteServiceCategory,
  duplicateCategoryNameError,
  filterServiceCategories,
  getActiveServiceCategories,
  getAdminServiceCategories,
  getDeleteCategoryErrorMessage,
  getSaveCategoryErrorMessage,
  getServiceCategoriesErrorMessage,
  isMissingServiceCategoriesError,
  normalizeActiveCategories,
  normalizeServiceCategories,
  readServiceCount,
  reassignServiceCategory,
  serviceCategoriesNotConfiguredMessage,
  updateServiceCategory,
  validateCategoryDraft,
} = await import("./serviceCategories.js");

const adminRows = [
  {
    id: "business-websites",
    name: "Business Websites",
    description: "Company sites",
    icon_name: "Building2",
    is_active: true,
    service_count: 3,
    created_at: "2026-11-25T09:00:00Z",
  },
  {
    id: "legacy-sites",
    name: "Legacy Sites",
    description: "Retired offering",
    icon_name: "",
    is_active: false,
    service_count: 0,
    created_at: "2026-10-01T09:00:00Z",
  },
];

test("the owner/admin loads every category, including inactive, through the RPC", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: adminRows, error: null });

  const categories = await getAdminServiceCategories();

  assert.equal(categories.length, 2);
  assert.equal(categories[0].name, "Business Websites");
  assert.equal(categories[0].iconName, "Building2");
  assert.equal(categories[0].serviceCount, 3);
  assert.equal(categories[1].active, false);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_service_categories");
  // No role, id or owner flag is ever sent: the server decides who is allowed.
  assert.equal(rpcCalls[0].args, undefined);
});

test("the customer service editor reads active categories from the table", async () => {
  tableReads.length = 0;
  tableResponder = () => ({ data: adminRows, error: null });

  const categories = await getActiveServiceCategories();

  // The inactive row is dropped even before RLS would hide it.
  assert.deepEqual(categories.map((category) => category.id), ["business-websites"]);
  assert.equal(tableReads.length, 1);
  assert.equal(tableReads[0].table, "categories");
  assert.deepEqual(tableReads[0].filters, [["is_active", true]]);
  assert.equal(tableReads[0].order[0][0], "name");
});

test("an empty or malformed category payload is an error, not a silent empty success", async () => {
  tableResponder = () => ({ data: { categories: adminRows }, error: null });
  await assert.rejects(() => getActiveServiceCategories());

  rpcResponder = () => ({ data: { categories: adminRows }, error: null });
  await assert.rejects(() => getAdminServiceCategories());
});

test("creating a category sends only name/description/icon and never an id", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: { id: "web-design", name: "Web Design", description: "Sites", icon_name: "Palette", is_active: true }, error: null });

  const created = await createServiceCategory({ name: "  Web Design  ", description: " Sites ", iconName: " Palette " });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "create_service_category");
  assert.deepEqual(rpcCalls[0].args, { p_name: "Web Design", p_description: "Sites", p_icon_name: "Palette" });
  assert.equal("id" in rpcCalls[0].args, false, "the id must be derived on the server, never sent");
  assert.equal(created.id, "web-design");
});

test("creating a category with no name is rejected before any request is made", async () => {
  rpcCalls.length = 0;
  await assert.rejects(() => createServiceCategory({ name: "   " }), /Enter a category name/);
  assert.equal(rpcCalls.length, 0);
});

test("updating a category sends the id, the edited fields and the active flag", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: { id: "business-websites", name: "Business Sites", description: "", icon_name: "", is_active: false, service_count: 1 }, error: null });

  const updated = await updateServiceCategory({ id: "business-websites", name: "Business Sites", active: false });

  assert.equal(rpcCalls[0].name, "update_service_category");
  assert.deepEqual(rpcCalls[0].args, {
    p_id: "business-websites",
    p_name: "Business Sites",
    p_description: "",
    p_icon_name: "",
    p_is_active: false,
  });
  assert.equal(updated.active, false);
});

test("deleting a category sends only its id", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: { deleted_id: "legacy-sites" }, error: null });

  await deleteServiceCategory("legacy-sites");

  assert.equal(rpcCalls[0].name, "delete_service_category");
  assert.deepEqual(rpcCalls[0].args, { p_id: "legacy-sites" });
});

test("reassigning services requires two different categories and sends both ids", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: 4, error: null });

  const moved = await reassignServiceCategory({ fromId: "legacy-sites", toId: "business-websites" });

  assert.equal(moved, 4);
  assert.equal(rpcCalls[0].name, "reassign_service_category");
  assert.deepEqual(rpcCalls[0].args, { p_from_id: "legacy-sites", p_to_id: "business-websites" });

  rpcCalls.length = 0;
  await assert.rejects(() => reassignServiceCategory({ fromId: "a", toId: "a" }), /different category/);
  await assert.rejects(() => reassignServiceCategory({ fromId: "a", toId: "" }), /Choose a category/);
  assert.equal(rpcCalls.length, 0);
});

test("unexpected fields are dropped, never surfaced", () => {
  const [category] = normalizeServiceCategories([{
    id: "business-websites",
    name: "Business Websites",
    description: "Company sites",
    icon_name: "Building2",
    is_active: true,
    service_count: 3,
    created_at: "2026-11-25T09:00:00Z",
    // never expected; must be dropped if a future change ever leaked them
    encrypted_password: "should-never-appear",
    owner: "should-be-ignored",
    updated_at: "2026-11-26T00:00:00Z",
  }]);

  assert.deepEqual(
    Object.keys(category).sort(),
    ["active", "createdAt", "description", "iconName", "id", "name", "serviceCount"],
  );
});

test("active normalization keeps only usable, active categories", () => {
  const active = normalizeActiveCategories([
    { id: "a", name: "Alpha", is_active: true },
    { id: "b", name: "Beta", is_active: false },
    { id: "", name: "No id", is_active: true },
    { id: "c", name: "", is_active: true },
  ]);

  assert.deepEqual(active.map((category) => category.id), ["a"]);
});

test("search matches name, description or icon name, and status uses the real field", async () => {
  rpcResponder = () => ({ data: adminRows, error: null });
  const categories = await getAdminServiceCategories();

  assert.equal(filterServiceCategories(categories, {}).length, 2);
  assert.deepEqual(filterServiceCategories(categories, { query: "business" }).map((c) => c.id), ["business-websites"]);
  assert.deepEqual(filterServiceCategories(categories, { query: "building2" }).map((c) => c.id), ["business-websites"]);
  assert.deepEqual(filterServiceCategories(categories, { status: "inactive" }).map((c) => c.id), ["legacy-sites"]);
  assert.deepEqual(filterServiceCategories(categories, { status: "active" }).map((c) => c.id), ["business-websites"]);
  // a non-status filter word falls back to "all"
  assert.equal(filterServiceCategories(categories, { status: "pending" }).length, 2);
});

test("a missing category migration is reported as not configured, not as empty success", async () => {
  const missingRpc = { code: "PGRST202", message: "Could not find the function public.admin_service_categories" };
  rpcResponder = () => ({ data: null, error: missingRpc });
  await assert.rejects(() => getAdminServiceCategories());
  assert.equal(isMissingServiceCategoriesError(missingRpc), true);
  assert.equal(getServiceCategoriesErrorMessage(missingRpc), serviceCategoriesNotConfiguredMessage);

  const missingTable = { code: "42P01", message: 'relation "public.categories" does not exist' };
  tableResponder = () => ({ data: null, error: missingTable });
  await assert.rejects(() => getActiveServiceCategories());
  assert.equal(getServiceCategoriesErrorMessage(missingTable), serviceCategoriesNotConfiguredMessage);
});

test("an unauthorized caller is rejected by the server with a readable message", async () => {
  const unauthorized = { code: "42501", message: "Only the NexTech owner and approved admins can manage categories." };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => createServiceCategory({ name: "Web Design" }), (error) => error === unauthorized);
  assert.match(getSaveCategoryErrorMessage(unauthorized), /approved admins/);
  assert.match(getDeleteCategoryErrorMessage(unauthorized), /approved admins/);
});

test("a category that still has services cannot be deleted and the server message is kept", async () => {
  const inUse = {
    code: "23503",
    message: "This category still has 3 service(s). Move them to another category before deleting it.",
  };
  rpcResponder = () => ({ data: null, error: inUse });

  await assert.rejects(() => deleteServiceCategory("business-websites"), (error) => error === inUse);
  assert.match(getDeleteCategoryErrorMessage(inUse), /still has 3 service/);
});

test("a duplicate category name surfaces as a clear save error", () => {
  assert.match(
    getSaveCategoryErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" }),
    /already exists/,
  );
  assert.match(getSaveCategoryErrorMessage({ code: "22023", message: "Category names must be 120 characters or fewer." }), /120 characters/);
});

test("duplicate names are caught locally before a request, including a case-only match", () => {
  const categories = [
    { id: "business-websites", name: "Business Websites" },
    { id: "landing-pages", name: "Landing Pages" },
  ];

  assert.equal(duplicateCategoryNameError(categories, { name: "  business websites  " }), "A category with that name already exists.");
  assert.equal(duplicateCategoryNameError(categories, { name: "Business Websites", id: "business-websites" }), "");
  assert.equal(duplicateCategoryNameError(categories, { name: "Blog Websites" }), "");
  assert.equal(duplicateCategoryNameError(null, { name: "Business Websites" }), "");
});

test("a category name with no letter or number is rejected before any request", async () => {
  rpcCalls.length = 0;
  await assert.rejects(() => createServiceCategory({ name: "---" }), /letter or number/);
  assert.equal(rpcCalls.length, 0);
});

test("a numeric service count still blocks a casual delete when it arrives as text", () => {
  assert.equal(readServiceCount("3"), 3);
  assert.equal(readServiceCount(0), 0);
  assert.equal(readServiceCount("3 services"), 0);
  const [category] = normalizeServiceCategories([{ id: "blog-websites", name: "Blog Websites", is_active: true, service_count: "2" }]);
  assert.equal(category.serviceCount, 2);
});

test("category drafts are trimmed and length-checked on the client too", () => {
  assert.deepEqual(validateCategoryDraft({ name: "  Web Design  ", description: " Sites ", iconName: " Palette " }), {
    name: "Web Design",
    description: "Sites",
    iconName: "Palette",
    error: "",
  });

  assert.match(validateCategoryDraft({ name: "" }).error, /Enter a category name/);
  assert.match(validateCategoryDraft({ name: "x".repeat(121) }).error, /120 characters/);
  assert.match(validateCategoryDraft({ name: "Ok", description: "x".repeat(501) }).error, /500 characters/);
  assert.match(validateCategoryDraft({ name: "Ok", iconName: "x".repeat(121) }).error, /120 characters/);
});
