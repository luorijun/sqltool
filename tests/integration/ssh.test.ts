import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync, randomUUID } from "node:crypto"
import net from "node:net"
import { type Connection, Server } from "ssh2"
import {
  pid,
  profile,
  query,
  setup,
  slowSql,
  value,
  waitClosed,
  waitFor,
  waitRunning,
} from "./helpers"

let ssh: Server
let port: number
const transports = new Set<Connection>()
beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  ssh = new Server({ hostKeys: [privateKey] }, (client) => {
    transports.add(client)
    client.on("error", () => {})
    client.on("close", () => transports.delete(client))
    client.on("authentication", (ctx) => {
      if (
        ctx.method === "password" &&
        ctx.username === "sqltool" &&
        ctx.password === "test"
      )
        ctx.accept()
      else ctx.reject()
    })
    client.on("ready", () =>
      client.on("tcpip", (accept, reject, info) => {
        if (
          info.destIP !== "127.0.0.1" ||
          ![15432, 13306].includes(info.destPort)
        ) {
          reject()
          return
        }
        const socket = net.connect(info.destPort, "127.0.0.1")
        client.once("close", () => socket.destroy())
        const failed = () => {
          socket.destroy()
          reject()
        }
        socket.once("error", failed)
        socket.once("connect", () => {
          socket.off("error", failed)
          const channel = accept()
          channel.on("error", () => socket.destroy())
          channel.on("close", () => socket.destroy())
          socket.on("error", () => channel.destroy())
          socket.pipe(channel).pipe(socket)
        })
      }),
    )
  })
  await new Promise<void>((resolve, reject) => {
    ssh.once("error", reject)
    ssh.listen(0, "127.0.0.1", resolve)
  })
  port = (ssh.address() as net.AddressInfo).port
})
afterAll(async () => {
  for (const transport of transports) transport.end()
  if (ssh) await new Promise<void>((resolve) => ssh.close(() => resolve()))
})

describe.each(["postgres", "mysql"] as const)("%s SSH", (driver) => {
  test("tunnel queries can be cancelled, reused and fully closed", async () => {
    const env = await setup({
      ...profile(driver),
      ssh: {
        host: "127.0.0.1",
        port: String(port),
        username: "sqltool",
        auth: { type: "password", password: "test" },
      },
    })
    const { api, admin } = env
    try {
      const session = value(await api.openSession("db", "a"))
      const id = await pid(api, session, driver)
      const request = randomUUID()
      const running = api.query(session, request, slowSql(driver))
      try {
        await waitRunning(admin, driver, id)
        value(await api.cancel(request))
        expect(await running).toMatchObject({ ok: false, kind: "cancelled" })
        expect(
          Number((await query(api, session, "SELECT 42")).rows[0][0]),
        ).toBe(42)
        value(await api.closeTab("a"))
        await waitClosed(admin, driver, id)
        await waitFor(
          () => transports.size === 0,
          "SSH transports were not released",
        )
      } finally {
        await api.closeTab("a")
        await running
      }
    } finally {
      await env.close()
    }
  })

  test("tunnel loss invalidates the session instead of silently reconnecting", async () => {
    const env = await setup({
      ...profile(driver),
      ssh: {
        host: "127.0.0.1",
        port: String(port),
        username: "sqltool",
        auth: { type: "password", password: "test" },
      },
    })
    const { api } = env
    try {
      const session = value(await api.openSession("db", "a"))
      await query(api, session, "SELECT 1")
      for (const transport of transports) transport.end()
      await waitFor(
        async () =>
          (await api.sync()).sessions.find((entry) => entry.id === session)
            ?.status === "failed",
        "Session did not detect SSH loss",
      )
      expect((await api.query(session, randomUUID(), "SELECT 2")).ok).toBe(
        false,
      )
    } finally {
      await env.close()
      await waitFor(
        () => transports.size === 0,
        "SSH transports were not released",
      )
    }
  })
})
