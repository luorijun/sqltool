export type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>
