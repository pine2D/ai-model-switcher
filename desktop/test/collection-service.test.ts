import assert from "node:assert/strict";
import test from "node:test";

import { CollectionService } from "../src/main/collection-service";
import { SITES } from "../src/main/sites";

test("collection preserves product order and reports missing answers", async () => {
  const deadlines: number[] = [];
  const service = new CollectionService(
    SITES,
    async (site, deadline) => {
      deadlines.push(deadline);
      return site === "claude"
        ? { text: "Claude answer", state: "think" }
        : { code: "no_answer" };
    },
    () => 1_000
  );

  const results = await service.collect(["kimi", "claude"], "run-1");

  assert.deepEqual(results.map((item) => item.site), ["claude", "kimi"]);
  assert.deepEqual(results.map((item) => item.host), ["claude.ai", "www.kimi.com"]);
  assert.equal(results[0].text, "Claude answer");
  assert.equal(results[0].state, "think");
  assert.equal(results[1].text, null);
  assert.equal(results[1].code, "no_answer");
  assert.deepEqual(deadlines, [9_000, 9_000]);
});

test("collection converts transport failures to stable codes without raw reasons", async () => {
  const service = new CollectionService(
    SITES,
    async () => { throw new Error("private adapter reason"); },
    () => 2_000
  );

  const [result] = await service.collect(["chatgpt"], null);

  assert.equal(result.text, null);
  assert.equal(result.code, "not_ready");
  assert.equal("reason" in result, false);
});
