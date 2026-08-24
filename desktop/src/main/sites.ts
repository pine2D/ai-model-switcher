import type { SiteDefinition } from "../shared/contracts";

export const SITES = Object.freeze([
  { key: "claude", host: "claude.ai", label: "Claude", url: "https://claude.ai/new", authHosts: ["accounts.google.com", "appleid.apple.com"] },
  { key: "chatgpt", host: "chatgpt.com", label: "ChatGPT", url: "https://chatgpt.com/", authHosts: ["auth.openai.com", "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com"] },
  { key: "gemini", host: "gemini.google.com", label: "Gemini", url: "https://gemini.google.com/app", authHosts: ["accounts.google.com"] },
  { key: "doubao", host: "www.doubao.com", label: "豆包", url: "https://www.doubao.com/chat/", authHosts: ["passport.douyin.com"] },
  { key: "deepseek", host: "chat.deepseek.com", label: "DeepSeek", url: "https://chat.deepseek.com/", authHosts: [] },
  { key: "qianwen", host: "www.qianwen.com", label: "千问", url: "https://www.qianwen.com/", authHosts: ["passport.aliyun.com"] },
  { key: "kimi", host: "www.kimi.com", label: "Kimi", url: "https://www.kimi.com/", authHosts: [] },
  { key: "yuanbao", host: "yuanbao.tencent.com", label: "元宝", url: "https://yuanbao.tencent.com/chat/", authHosts: [] },
  { key: "chatglm", host: "chatglm.cn", label: "智谱", url: "https://chatglm.cn/main/alltoolsdetail", authHosts: ["open.bigmodel.cn"] }
] satisfies readonly SiteDefinition[]);
