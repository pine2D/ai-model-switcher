import type { SiteDefinition } from "../shared/contracts";

export const SITES = Object.freeze([
  { key: "claude", host: "claude.ai", label: "Claude", url: "https://claude.ai/new", authHosts: ["accounts.google.com", "appleid.apple.com"], image: true, intl: true },
  { key: "chatgpt", host: "chatgpt.com", label: "ChatGPT", url: "https://chatgpt.com/", authHosts: ["auth.openai.com", "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com"], image: true, intl: true },
  { key: "gemini", host: "gemini.google.com", label: "Gemini", url: "https://gemini.google.com/app", authHosts: ["accounts.google.com"], image: false, intl: true },
  { key: "deepseek", host: "chat.deepseek.com", label: "DeepSeek", url: "https://chat.deepseek.com/", authHosts: [], image: true, intl: false },
  { key: "doubao", host: "www.doubao.com", label: "豆包", url: "https://www.doubao.com/chat/", authHosts: ["passport.douyin.com"], image: true, intl: false },
  { key: "qianwen", host: "www.qianwen.com", label: "千问", url: "https://www.qianwen.com/", authHosts: ["passport.aliyun.com"], image: false, intl: false },
  { key: "kimi", host: "www.kimi.com", label: "Kimi", url: "https://www.kimi.com/", authHosts: [], image: true, intl: false },
  { key: "yuanbao", host: "yuanbao.tencent.com", label: "元宝", url: "https://yuanbao.tencent.com/chat/", authHosts: [], image: true, intl: false },
  { key: "chatglm", host: "chatglm.cn", label: "智谱", url: "https://chatglm.cn/main/alltoolsdetail", authHosts: ["open.bigmodel.cn"], image: false, intl: false }
] satisfies readonly SiteDefinition[]);
