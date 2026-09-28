import type { FailureKind, TaskSnapshot } from "."

export class ConnError extends Error {
  readonly kind: FailureKind

  constructor(message: string, kind: FailureKind = "error") {
    super(message)
    this.kind = kind
  }
}

export function withTimeout<T>(work: Promise<T>, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("操作超时")), ms)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

interface Task extends TaskSnapshot {
  owner: number
  abort: AbortController
  cancel?: () => Promise<void>
  cancelling?: Promise<void>
  finished?: boolean
  done: Promise<void>
}

export class Tasks {
  private tasks = new Map<string, Task>()
  private lanes = new Map<string, Promise<void>>()

  snapshot(owner: number): TaskSnapshot[] {
    return [...this.tasks.values()]
      .filter((t) => t.owner === owner)
      .map(({ id, sessionId, tabId, status }) => ({
        id,
        sessionId,
        tabId,
        status,
      }))
  }

  run<T>(
    input: { id: string; sessionId: string; owner: number; tabId?: string },
    run: (start: (cancel: () => Promise<void>) => void) => Promise<T>,
  ): Promise<T> {
    if (this.tasks.has(input.id)) throw new Error("重复的请求编号")
    const task: Task = {
      ...input,
      status: "queued",
      abort: new AbortController(),
      done: Promise.resolve(),
    }
    this.tasks.set(task.id, task)
    const previous = this.lanes.get(task.sessionId) ?? Promise.resolve()
    const work = previous.then(async () => {
      task.abort.signal.throwIfAborted()
      task.status = "connecting"
      try {
        return await run((cancel) => {
          task.abort.signal.throwIfAborted()
          task.cancel = cancel
          task.status = "running"
        })
      } finally {
        task.finished = true
        // A late control query must finish before another SQL reaches this connection.
        await task.cancelling?.catch(() => {})
      }
    })
    task.done = work
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.tasks.delete(task.id)
        if (this.lanes.get(task.sessionId) === task.done)
          this.lanes.delete(task.sessionId)
      })
    this.lanes.set(task.sessionId, task.done)
    // Aborting a queued/connecting task returns promptly; its preparation still drains.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(task.abort.signal.reason)
      task.abort.signal.addEventListener("abort", abort, { once: true })
      work
        .then(resolve, reject)
        .finally(() => task.abort.signal.removeEventListener("abort", abort))
    })
  }

  async cancel(id: string, owner: number): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.owner !== owner) throw new Error("无权操作其他窗口的任务")
    if (task.cancelling) return task.cancelling
    if (task.finished) return
    if (task.status === "queued" || task.status === "connecting") {
      task.abort.abort(new ConnError("请求已取消，未执行 SQL", "cancelled"))
      return
    }
    task.status = "cancelling"
    task.cancelling = Promise.resolve()
      .then(() => task.cancel?.())
      .then(() => {})
    try {
      await task.cancelling
    } catch (error) {
      task.cancelling = undefined
      task.status = "running"
      throw error
    }
  }

  async stop(sessionId: string): Promise<void> {
    const tasks = [...this.tasks.values()].filter(
      (t) => t.sessionId === sessionId,
    )
    await Promise.all(tasks.map((t) => this.cancel(t.id, t.owner)))
    await withTimeout(Promise.all(tasks.map((t) => t.done)))
  }

  async stopTab(owner: number, tabId: string): Promise<void> {
    const tasks = [...this.tasks.values()].filter(
      (t) => t.owner === owner && t.tabId === tabId,
    )
    await Promise.all(tasks.map((t) => this.cancel(t.id, owner)))
    await withTimeout(Promise.all(tasks.map((t) => t.done)))
  }

  fail(sessionId: string, message: string): void {
    for (const task of this.tasks.values()) {
      if (task.sessionId !== sessionId) continue
      const sent = task.status === "running" || task.status === "cancelling"
      if (!task.finished)
        task.abort.abort(
          new ConnError(
            sent
              ? `结果未知：${message}。请核实数据库状态，勿直接重试写入。`
              : message,
            sent ? "unknown" : "error",
          ),
        )
      this.tasks.delete(task.id)
    }
    this.lanes.delete(sessionId)
  }
}
