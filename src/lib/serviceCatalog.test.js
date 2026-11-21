import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaceOrderRequest,
  getCatalogLoadErrorMessage,
  validateOrderDraft,
} from "./serviceCatalog.js";

test("validates required order fields and trims values", () => {
  assert.deepEqual(validateOrderDraft({
    projectName: "   ",
    orderDescription: "",
    requirements: "",
  }), {
    projectName: "Enter a project name.",
    orderDescription: "Describe what you need for this order.",
  });

  assert.deepEqual(validateOrderDraft({
    projectName: "  Website refresh ",
    orderDescription: " Build a small website. ",
    requirements: "  Mobile first  ",
  }), {});
});

test("enforces order field length limits", () => {
  assert.deepEqual(validateOrderDraft({
    projectName: "p".repeat(121),
    orderDescription: "d".repeat(5001),
    requirements: "r".repeat(10001),
  }), {
    projectName: "Project name must be 120 characters or fewer.",
    orderDescription: "Order description must be 5,000 characters or fewer.",
    requirements: "Requirements must be 10,000 characters or fewer.",
  });
});

test("request contains only user-editable fields and never accepts price, status, or client id", () => {
  assert.deepEqual(buildPlaceOrderRequest({
    serviceId: "business-website",
    packageId: "standard",
    projectName: "  Website refresh ",
    orderDescription: "  Redesign our site. ",
    requirements: "  Responsive pages  ",
    clientId: "attacker-id",
    status: "completed",
    price: 1,
  }), {
    service_id: "business-website",
    package_id: "standard",
    project_name: "Website refresh",
    order_description: "Redesign our site.",
    requirements: "Responsive pages",
  });
});

test("explains when the trusted service catalog migration has not been applied", () => {
  assert.match(
    getCatalogLoadErrorMessage({ code: "PGRST205" }),
    /Apply its migration and add real services and packages/,
  );
  assert.equal(getCatalogLoadErrorMessage(new Error("network unavailable")), "network unavailable");
});
