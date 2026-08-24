import type { PolyAskDesktopApi } from "../preload/shell";

declare global {
  interface Window {
    polyask: PolyAskDesktopApi;
  }
}

export {};
