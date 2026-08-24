export const SITE_KEYS = [
  "claude",
  "chatgpt",
  "gemini",
  "doubao",
  "deepseek",
  "qianwen",
  "kimi",
  "yuanbao",
  "chatglm"
] as const;

export type SiteKey = (typeof SITE_KEYS)[number];

export interface SiteDefinition {
  readonly key: SiteKey;
  readonly host: string;
  readonly label: string;
  readonly url: string;
  readonly authHosts: readonly string[];
}

export interface ViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewPlacement {
  readonly key: SiteKey;
  readonly bounds: ViewBounds;
}

export type LayoutOptions =
  | { readonly mode: "overview"; readonly gap?: number }
  | {
      readonly mode: "focus";
      readonly focused: SiteKey;
      readonly gap?: number;
    };
