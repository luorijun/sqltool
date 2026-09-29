import type { MainBridge } from "@/contracts/bridge"
declare global {
  interface Window {
    main: MainBridge
  }
}
