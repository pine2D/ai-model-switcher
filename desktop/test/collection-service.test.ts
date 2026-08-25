import assert from "node:assert/strict";
import test from "node:test";

import { CollectionService } from "../src/main/collection-service";
import { SITES } from "../src/main/sites";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

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

  service.beginRun("run-1", ["kimi", "claude"]);
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

test("collection accepts only the active run and its selected sites", async () => {
  const service = new CollectionService(SITES, async () => ({ text: "answer" }));
  const grok = "grok" as import("../src/shared/contracts").SiteKey;

  service.beginRun("run-a", ["claude", "kimi", "gemini", "chatgpt", "deepseek"]);
  service.beginRun("run-a", ["kimi", "gemini"]);
  await service.collect(["claude", "gemini"], "run-a");
  await assert.rejects(() => service.collect([grok], "run-a"), /stale_run/);

  service.beginRun("run-b", [grok]);
  await assert.rejects(() => service.collect(["claude"], "run-a"), /stale_run/);
  service.clearRun();
  await assert.rejects(() => service.collect([grok], "run-b"), /stale_run/);
  await service.collect([grok], null);
});

test("an in-flight collection becomes stale when its run is cleared", async () => {
  const dispatched = deferred<void>();
  const answer = deferred<{ readonly text: string }>();
  const service = new CollectionService(SITES, async () => {
    dispatched.resolve();
    return answer.promise;
  });
  service.beginRun("run-clear", ["claude"]);

  const collecting = service.collect(["claude"], "run-clear");
  await dispatched.promise;
  service.clearRun();
  answer.resolve({ text: "late answer" });

  await assert.rejects(collecting, /stale_run/);
});

test("an in-flight collection becomes stale when another run starts", async () => {
  const dispatched = deferred<void>();
  const answer = deferred<{ readonly text: string }>();
  const service = new CollectionService(SITES, async () => {
    dispatched.resolve();
    return answer.promise;
  });
  service.beginRun("run-old", ["claude"]);

  const collecting = service.collect(["claude"], "run-old");
  await dispatched.promise;
  service.beginRun("run-new", ["kimi"]);
  answer.resolve({ text: "late answer" });

  await assert.rejects(collecting, /stale_run/);
});

test("an in-flight collection becomes stale when the same run id is rebuilt", async () => {
  const dispatched = deferred<void>();
  const answer = deferred<{ readonly text: string }>();
  const service = new CollectionService(SITES, async () => {
    dispatched.resolve();
    return answer.promise;
  });
  service.beginRun("run-rebuilt", ["claude", "kimi"]);

  const collecting = service.collect(["claude"], "run-rebuilt");
  await dispatched.promise;
  service.beginRun("run-rebuilt", ["kimi"]);
  answer.resolve({ text: "late answer" });

  await assert.rejects(collecting, /stale_run/);
  assert.deepEqual(await service.collect(["claude"], "run-rebuilt"), [{
    site: "claude",
    host: "claude.ai",
    label: "Claude",
    text: "late answer"
  }]);
});

test("the active run accepts every non-empty subset size from one through nine", async () => {
  const service = new CollectionService(SITES, async (site) => ({ text: `${site} answer` }));
  const sites = SITES.map((site) => site.key);
  service.beginRun("run-nine", sites);

  for (let count = 1; count <= sites.length; count += 1) {
    const subset = sites.slice(0, count);
    const results = await service.collect(subset, "run-nine");
    assert.deepEqual(results.map((result) => result.site), subset);
  }
});
