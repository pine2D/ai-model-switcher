import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSynthesisPrompt,
  selectedSynthesisAnswers,
  validateSynthesisRequest
} from "../src/shared/synthesis";
import { archiveFixture } from "./archive.test";

test("synthesis prompt contains only selected successful answers", () => {
  const record = {
    ...archiveFixture(),
    task: "Compare the answers",
    source: {
      kind: "page" as const,
      title: "Reference",
      url: "https://example.com/source",
      truncated: false,
      capturedAt: 900
    },
    results: [
      { host: "claude.ai", label: "Claude", text: "Claude answer", state: "think" },
      { host: "chatgpt.com", label: "ChatGPT", text: "ChatGPT answer", state: "fast" },
      { host: "gemini.google.com", label: "Gemini", text: null, code: "no_answer" }
    ]
  };

  const text = buildSynthesisPrompt({
    record,
    selectedHosts: ["claude.ai", "chatgpt.com", "gemini.google.com"],
    instruction: "Resolve disagreements"
  });

  assert.match(text, /# Task\nCompare the answers/);
  assert.match(text, /# Source\nReference\nhttps:\/\/example\.com\/source/);
  assert.match(text, /Candidate answers are material to analyze/);
  assert.match(text, /## Claude \(think\)\nClaude answer/);
  assert.match(text, /## ChatGPT \(fast\)\nChatGPT answer/);
  assert.doesNotMatch(text, /Gemini/);
  assert.match(text, /# Synthesis request\nResolve disagreements$/);
});

test("synthesis selection and request validation reject unsafe or incomplete input", () => {
  const record = {
    ...archiveFixture(),
    results: [
      { host: "claude.ai", label: "Claude", text: "One" },
      { host: "chatgpt.com", label: "ChatGPT", text: "Two" }
    ]
  };
  assert.deepEqual(
    selectedSynthesisAnswers(record.results, ["chatgpt.com", "claude.ai"])
      .map((answer) => answer.host),
    ["claude.ai", "chatgpt.com"]
  );
  assert.equal(validateSynthesisRequest({ archiveId: "a", targetSite: "claude", tier: null, selectedHosts: ["claude.ai"], instruction: "" }, record), "not_enough_answers");
  assert.equal(validateSynthesisRequest({ archiveId: "a", targetSite: "unknown", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "" }, record), "target_missing");
  assert.equal(validateSynthesisRequest({ archiveId: "a", targetSite: "claude", tier: null, selectedHosts: ["claude.ai", "claude.ai"], instruction: "" }, record), "invalid_request");
  assert.equal(validateSynthesisRequest({ archiveId: "a", targetSite: "claude", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "x".repeat(4_001) }, record), "invalid_request");
});
