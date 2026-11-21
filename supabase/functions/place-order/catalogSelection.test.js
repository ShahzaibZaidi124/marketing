import assert from "node:assert/strict";
import test from "node:test";
import { resolveOrderCatalogSelection } from "./catalogSelection.js";

const activeService = {
  id: "service-a",
  is_active: true,
  base_price: null,
  currency: "PKR",
};

test("accepts a package only when it belongs to the selected active service", () => {
  const result = resolveOrderCatalogSelection({
    service: activeService,
    packageId: "basic",
    servicePackage: {
      id: "basic",
      service_id: "service-a",
      name: "Basic",
      price: "5000.00",
      currency: "PKR",
      is_active: true,
    },
  });
  assert.deepEqual(result.value, { packageName: "Basic", price: 5000, currency: "PKR" });
});

test("rejects packages belonging to another service or inactive packages", () => {
  const otherServicePackage = resolveOrderCatalogSelection({
    service: activeService,
    packageId: "premium",
    servicePackage: {
      service_id: "service-b",
      name: "Premium",
      price: 10000,
      currency: "PKR",
      is_active: true,
    },
  });
  assert.equal(otherServicePackage.status, 404);

  const inactivePackage = resolveOrderCatalogSelection({
    service: activeService,
    packageId: "basic",
    servicePackage: {
      service_id: "service-a",
      name: "Basic",
      price: 5000,
      currency: "PKR",
      is_active: false,
    },
  });
  assert.equal(inactivePackage.status, 404);
});

test("rejects inactive services and missing package selection", () => {
  assert.equal(resolveOrderCatalogSelection({
    service: { ...activeService, is_active: false },
    packageId: null,
  }).status, 404);

  assert.equal(resolveOrderCatalogSelection({
    service: activeService,
    packageId: null,
    activePackageExists: true,
  }).status, 400);
});

test("uses a service base price only when no active package is required", () => {
  const result = resolveOrderCatalogSelection({
    service: { ...activeService, base_price: "1200.50" },
    packageId: null,
    activePackageExists: false,
  });
  assert.deepEqual(result.value, { packageName: null, price: 1200.5, currency: "PKR" });
});

test("rejects a service with no configured price instead of treating it as free", () => {
  const result = resolveOrderCatalogSelection({
    service: activeService,
    packageId: null,
    activePackageExists: false,
  });
  assert.equal(result.status, 400);
  assert.equal(result.value, null);
});
