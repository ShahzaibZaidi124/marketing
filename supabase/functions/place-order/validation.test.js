import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaceOrderBody } from "./validation.js";

test("validates and normalizes required order fields", () => {
  const result = parsePlaceOrderBody({
    service_id: " site-build ",
    package_id: " basic ",
    project_name: " New website ",
    order_description: " Build a responsive site. ",
    requirements: " Mobile first ",
  });

  assert.equal(result.error, "");
  assert.deepEqual(result.value, {
    serviceId: "site-build",
    packageId: "basic",
    projectName: "New website",
    orderDescription: "Build a responsive site.",
    requirements: "Mobile first",
  });
});

test("rejects malformed or oversized order data", () => {
  assert.match(parsePlaceOrderBody([]).error, /request is invalid/);
  assert.match(parsePlaceOrderBody({ service_id: "bad id" }).error, /available service/);
  assert.match(parsePlaceOrderBody({
    service_id: "service",
    project_name: "Project",
    order_description: "Description",
    requirements: "x".repeat(10001),
  }).error, /10,000 characters or fewer/);
});

test("ignores client-supplied ownership, price, and status", () => {
  const result = parsePlaceOrderBody({
    service_id: "service",
    package_id: null,
    project_name: "Project",
    order_description: "Description",
    client_id: "another-user",
    price: 0.01,
    status: "completed",
  });

  assert.equal(result.error, "");
  assert.deepEqual(Object.keys(result.value).sort(), [
    "orderDescription",
    "packageId",
    "projectName",
    "requirements",
    "serviceId",
  ]);
});
