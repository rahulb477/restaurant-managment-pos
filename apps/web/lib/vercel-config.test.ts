import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));

test("Vercel builds only the web service and its shared types", () => {
  assert.deepEqual(Object.keys(config.services), ["web"]);
  assert.equal(config.services.web.root, "apps/web");
  assert.equal(config.services.web.framework, "nextjs");
  assert.equal(config.services.web.installCommand, "pnpm install --frozen-lockfile --filter web...");
  assert.equal(
    config.services.web.buildCommand,
    "pnpm --filter @nodedr-restaurant/types build && pnpm --filter web build",
  );
  for (const key of ["buildCommand", "installCommand", "framework", "outputDirectory"]) {
    assert.equal(Object.hasOwn(config, key), false, `${key} must be scoped to the service`);
  }
});

test("Vercel routes public pages and API paths to the web service", () => {
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: { service: "web" } }]);
});
