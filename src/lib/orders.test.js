import assert from "node:assert/strict";
import test from "node:test";
import {
  filterClientOrders,
  formatClientOrderDate,
  formatClientOrderPrice,
  formatClientOrderStatus,
  getOrderLoadErrorMessage,
} from "./orders.js";

const orders = [
  { id: "1", status: "pending" },
  { id: "2", status: "active" },
  { id: "3", status: "completed" },
];

test("filters client orders by supported statuses without changing all orders", () => {
  assert.deepEqual(filterClientOrders(orders, "all"), orders);
  assert.deepEqual(filterClientOrders(orders, "pending"), [orders[0]]);
  assert.deepEqual(filterClientOrders(orders, "active"), [orders[1]]);
  assert.deepEqual(filterClientOrders(orders, "completed"), [orders[2]]);
});

test("formats order status, date, and optional price for display", () => {
  assert.equal(formatClientOrderStatus("in_progress"), "In Progress");
  assert.equal(formatClientOrderStatus(""), "Status unavailable");
  assert.equal(formatClientOrderDate("not-a-date"), "Date unavailable");
  assert.equal(formatClientOrderPrice(null), "Price not available");
  assert.equal(formatClientOrderPrice(12500), "PKR 12,500");
});

test("explains when the orders table migration has not been applied", () => {
  assert.match(
    getOrderLoadErrorMessage({ code: "PGRST205" }),
    /Apply the NexTech client orders migration/,
  );
  assert.match(
    getOrderLoadErrorMessage(new Error("network unavailable")),
    /network unavailable/,
  );
});
