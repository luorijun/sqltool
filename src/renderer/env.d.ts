import type { MainBridge } from "@/preload/bridge"

declare global {
  interface Window {
    main: MainBridge
  }
}
