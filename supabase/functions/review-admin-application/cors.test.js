import assert from "node:assert/strict";
import test from "node:test";
import { getReviewAdminApplicationCors } from "./cors.js";

test("allows only explicitly listed localhost origins without wildcard access", () => {
  const cors = getReviewAdminApplicationCors("http://localhost:5173");
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.notEqual(cors.headers["Access-Control-Allow-Origin"], "*");
});

test("allows a configured production origin", () => {
  const cors = getReviewAdminApplicationCors(
    "https://nextech5.vercel.app",
    "https://nextech5.vercel.app",
  );
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], "https://nextech5.vercel.app");
});

test("rejects unconfigured origins and invalid origin configuration", () => {
  const cors = getReviewAdminApplicationCors(
    "https://attacker.example",
    "https://nextech5.vercel.app/path, *",
  );
  assert.equal(cors.allowed, false);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], undefined);
});

test("allows non-browser requests without treating CORS as authentication", () => {
  const cors = getReviewAdminApplicationCors(null, "https://nextech5.vercel.app");
  assert.equal(cors.allowed, true);
  assert.equal(cors.headers["Access-Control-Allow-Origin"], undefined);
});
