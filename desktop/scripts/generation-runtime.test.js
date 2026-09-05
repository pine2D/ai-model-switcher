#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = () => fs.readFileSync(require("node:path").join(__dirname, "../src/site-runtime/generation.js"), "utf8");
const rect = (top = 500) => ({ width: 40, height: 40, top, bottom: top + 40, left: 600, right: 640 });

// Each control carries the selector fragments it answers to, so a stop button
// that the site never labels stays invisible to the probe — the stub must not
// hand back matches the real selector list would miss.
function matchesSelector(control, selector) {
  const fragments = selector.split(",").map((part) => part.trim()).filter(Boolean);
  return fragments.some((fragment) => (control.selectors || []).includes(fragment));
}

function run(host, adapter, controls = []) {
  const composer = { getBoundingClientRect: () => rect(600) };
  const document = {
    querySelectorAll: (selector) => controls.filter((control) => matchesSelector(control, selector)),
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
    selectors: ['[data-testid="stop-button"]'],
    getBoundingClientRect: () => rect(540),
  };
  const hidden = {
    selectors: ['[data-testid="stop-button"]'],
    getBoundingClientRect: () => ({ ...rect(540), width: 0, height: 0 }),
  };
  assert.equal(run("claude.ai", { answer: () => ({}) }, [visible]).generation(), "generating");
  assert.equal(run("claude.ai", { answer: () => ({}) }, [hidden]).generation(), "complete");

  // Claude 的停止键 testid 是 chat-input-stop（同族 chat-input / chat-input-send / chat-input-attach
  // 均已真机核实）；stop-button 是 ChatGPT 的形状，Claude 上零命中。只剩 aria-label 兜底时，
  // 界面一切成非英文就会把「生成中」误判成已完成。
  const selectors = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/site-runtime/generation.js"), "utf8");
  const claudeLine = selectors.split("\n").find((line) => line.includes('"claude.ai":'));
  assert.ok(claudeLine && claudeLine.includes('[data-testid="chat-input-stop"]'),
    "claude.ai 的停止键选择子必须含 chat-input-stop");
});

test("a stop control the selector list cannot name stays unseen", () => {
  const unlabelled = {
    selectors: [".ds-button--primary"],
    getBoundingClientRect: () => rect(540),
  };
  assert.equal(run("deepseek.com", { answer: () => ({}) }, [unlabelled]).generation(), "complete");
  const labelled = {
    selectors: ['[aria-label*="stop" i]'],
    getBoundingClientRect: () => rect(540),
  };
  assert.equal(run("deepseek.com", { answer: () => ({}) }, [labelled]).generation(), "generating");
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
