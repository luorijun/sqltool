import { spyOn } from "bun:test"

export function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// Each suite runs in an isolated Bun context; restore the real clock after each test.
export function clock() {
  let now = 0
  let id = 0
  const timers = new Map<
    number,
    { at: number; interval: number; run: () => void }
  >()
  const add = (run: () => void, ms = 0, interval = 0) => {
    const key = ++id
    timers.set(key, { at: now + ms, interval, run })
    return key as unknown as ReturnType<typeof setTimeout>
  }
  const spies = [
    spyOn(globalThis, "setTimeout").mockImplementation(((
      run: () => void,
      ms?: number,
    ) => add(run, ms)) as typeof setTimeout),
    spyOn(globalThis, "setInterval").mockImplementation(((
      run: () => void,
      ms = 0,
    ) => add(run, ms, ms)) as typeof setInterval),
    spyOn(globalThis, "clearTimeout").mockImplementation((key) => {
      timers.delete(Number(key))
    }),
    spyOn(globalThis, "clearInterval").mockImplementation((key) => {
      timers.delete(Number(key))
    }),
  ]
  return {
    async advance(ms: number) {
      const end = now + ms
      await drain()
      while (true) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [key, timer] = next
        now = timer.at
        if (timer.interval) timer.at += timer.interval
        else timers.delete(key)
        timer.run()
        await drain()
      }
      now = end
    },
    restore() {
      timers.clear()
      for (const spy of spies) spy.mockRestore()
    },
  }
}
