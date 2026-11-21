import assert from "node:assert/strict";
import test from "node:test";
import { getOrderFunctionCors } from "./cors.js";

test("allows only explicitly listed localhost origins without wildcard access", () => {
  const cors = getOrderFunctionCors("http://localhost:5173");
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.notEqual(cors.headers["Access-Control-Allow-Origin"], "*");
});

test("allows a configured production origin", () => {
  const cors = getOrderFunctionCors(
    "https://market.nextech.example",
    "https://market.nextech.example",
  );
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], "https://market.nextech.example");
});

test("rejects unconfigured origins and invalid origin configuration", () => {
  const cors = getOrderFunctionCors(
    "https://attacker.example",
    "https://market.nextech.example/path, *",
  );
  assert.equal(cors.allowed, false);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], undefined);
});

test("allows non-browser requests without treating CORS as authentication", () => {
  const cors = getOrderFunctionCors(null, "https://market.nextech.example");
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], undefined);
});
