const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const trigger = { textContent: "Qwen3.8-Max", children: [], getAttribute: () => null };
const label = { textContent: "思考" };
const thinkButton = { className: "text-theme", textContent: "思考", querySelectorAll: () => [label] };
const document = { querySelectorAll(selector) {
  if (selector === '[aria-haspopup="dialog"]') return [trigger];
  if (selector === "button") return [thinkButton];
  return [];
} };
const helpers = { waitFor() {}, findByText() {}, openMenu() {}, clickEl() {}, sleep: () => Promise.resolve(), escMenus() {} };
const context = { document, t: (key) => key, window: { __AMS: { ...helpers, adapters: {} } }, console };
vm.runInNewContext(fs.readFileSync("content/adapters-cn.js", "utf8"), context);

const qwen = context.window.__AMS.adapters["qianwen.com"];
assert.equal(qwen.state(), "think", "正式版开启思考时应识别为 think");
thinkButton.className = "text-primary";
assert.equal(qwen.state(), "fast", "正式版关闭思考时应识别为 fast");
trigger.textContent = "Qwen3.8-Max-Preview";
assert.equal(qwen.state(), null, "Preview 不得冒充正式版档位");

(async () => {
  let selected;
  qwen._selectModel = async (re) => { selected = re; };
  qwen._setThink = async () => {};
  await qwen.think();
  assert.equal(selected.test("Qwen3.8-Max"), true);
  assert.equal(selected.test("Qwen3.8-Max-Preview"), false, "思考档不得回退 Preview");
  await qwen.fast();
  assert.equal(selected.test("Qwen3.8-Max"), true);
  assert.equal(selected.test("Qwen3.8-Max-Preview"), false, "快速档不得回退 Preview");
  console.log("Qwen adapter checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
