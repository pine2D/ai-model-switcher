#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = () => fs.readFileSync("content/generation.js", "utf8");
const rect = (top = 500) => ({ width: 40, height: 40, top, bottom: top + 40, left: 600, right: 640 });

function run(host, adapter, controls = []) {
  const composer = { getBoundingClientRect: () => rect(600) };
  const document = {
    querySelectorAll: () => controls,
  };
  const context = {
    document,
    innerHeight: 900,
    innerWidth: 1200,
    location: { hostname: host },
    window: {
      __AMS: {
        adapters: { [host]: adapter },
        findComposer: () => composer,
      },
    },
  };
  vm.runInNewContext(source(), context);
  return adapter;
}

test("generation probe reports only a visible nearby stop control as generating", () => {
  const visible = {
    matches: () => true,
    getBoundingClientRect: () => rect(540),
  };
  const hidden = {
    matches: () => true,
    getBoundingClientRect: () => ({ ...rect(540), width: 0, height: 0 }),
  };
  assert.equal(run("claude.ai", { answer: () => ({}) }, [visible]).generation(), "generating");
  assert.equal(run("claude.ai", { answer: () => ({}) }, [hidden]).generation(), "complete");
});

test("generation probe reports completion from the existing read-only answer hook", () => {
  assert.equal(run("gemini.google.com", { answer: () => ({}) }).generation(), "complete");
  assert.equal(run("gemini.google.com", { answer: () => null }).generation(), "idle");
});

test("unknown sites and adapter failures stay unsupported", () => {
  assert.equal(run("example.com", { answer: () => ({}) }).generation, undefined);
  assert.equal(run("chatgpt.com", { answer: () => { throw new Error("changed"); } }).generation(), null);
});

test("generation wrapper is idempotent", () => {
  const adapter = run("kimi.com", { answer: () => null });
  const first = adapter.generation;
  const context = {
    document: { querySelectorAll: () => [] },
    innerHeight: 900,
    innerWidth: 1200,
    location: { hostname: "kimi.com" },
    window: { __AMS: { adapters: { "kimi.com": adapter }, findComposer: () => null } },
  };
  vm.runInNewContext(source(), context);
  assert.equal(adapter.generation, first);
});
