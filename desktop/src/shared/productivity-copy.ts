export const PRODUCTIVITY_COPY = {
  en: {
    completionNotifications: "Answer completion notifications",
    completionNotificationsDescription: "Show a system notification when an answer finishes or fails while PolyAsk is in the background. Notifications never include prompts or answers.",
    localPreference: "Saved only on this device",
    completionNotificationComplete: "{site} finished answering",
    completionNotificationFailed: "{site} needs attention",
    updatePageOpened: "Opened the latest PolyAsk release in your browser",
    updatePageFailed: "Could not open the PolyAsk release page",
  },
  zhCN: {
    completionNotifications: "回答完成通知",
    completionNotificationsDescription: "PolyAsk 位于后台时，在回答完成或失败后显示系统通知。通知不会包含提问或回答正文。",
    localPreference: "仅保存在这台设备",
    completionNotificationComplete: "{site} 已完成回答",
    completionNotificationFailed: "{site} 的回答需要处理",
    updatePageOpened: "已在浏览器中打开 PolyAsk 最新版本页面",
    updatePageFailed: "无法打开 PolyAsk 版本页面",
  },
  zhTW: {
    completionNotifications: "回答完成通知",
    completionNotificationsDescription: "PolyAsk 位於背景時，在回答完成或失敗後顯示系統通知。通知不會包含提問或回答正文。",
    localPreference: "僅儲存在這部裝置",
    completionNotificationComplete: "{site} 已完成回答",
    completionNotificationFailed: "{site} 的回答需要處理",
    updatePageOpened: "已在瀏覽器中開啟 PolyAsk 最新版本頁面",
    updatePageFailed: "無法開啟 PolyAsk 版本頁面",
  }
} as const;
