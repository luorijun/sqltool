import { constants } from "node:fs"
import { access, glob, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Duplex, type Duplex as DuplexStream } from "node:stream"
import { LineType, SSHConfig } from "ssh-config"
import { Client as SshClient } from "ssh2"
import type { SshConfig, SshPrivateKeyAuth } from "."
import { parsePort } from "./driver"

const DEFAULT_PRIVATE_KEY_FILES = [
  "id_ed25519",
  "id_rsa",
  "id_ecdsa",
  "id_dsa",
] as const

interface ResolvedSshConnectConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  agent?: string
  agentForward?: boolean
  tryKeyboard?: boolean
}

interface LocalSshConfigMatch {
  host?: string
  port?: string
  username?: string
  privateKeyPaths?: string[]
  agent?: string
  agentForward?: boolean
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") {
    return homedir()
  }

  if (filePath.startsWith("~/")) {
    return path.join(homedir(), filePath.slice(2))
  }

  return filePath
}

async function resolveLocalSshConfig(
  ssh: SshConfig,
): Promise<LocalSshConfigMatch> {
  const configPath = path.join(homedir(), ".ssh", "config")
  if (!(await canReadFile(configPath))) {
    return {}
  }

  const configText = await readExpandedSshConfig(configPath, new Set())
  if (!configText.trim()) {
    return {}
  }

  let computed: Record<string, string | string[]>

  try {
    const config = SSHConfig.parse(configText)
    computed = config.compute(ssh.host, { ignoreCase: true })
  } catch {
    throw new Error("SSH 配置解析失败")
  }

  const pickText = (
    value: string | string[] | undefined,
  ): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const trimmed = item.trim()
        if (trimmed) {
          return trimmed
        }
      }

      return undefined
    }

    const trimmed = value?.trim()
    return trimmed || undefined
  }

  const privateKeyPaths: string[] = []
  const identityFiles = Array.isArray(computed.identityfile)
    ? computed.identityfile
    : computed.identityfile
      ? [computed.identityfile]
      : []

  for (const identityFile of identityFiles) {
    for (const segment of identityFile.split(/\s+/)) {
      const filePath = expandHomePath(segment.trim())
      if (filePath) {
        privateKeyPaths.push(filePath)
      }
    }
  }

  const host = pickText(computed.hostname)
  const port = pickText(computed.port)
  const username = pickText(computed.user)
  const identityAgent = pickText(computed.identityagent)
  const forwardAgentText = pickText(computed.forwardagent)
  let agentForward: boolean | undefined

  if (forwardAgentText) {
    const value = forwardAgentText.toLowerCase()

    if (["yes", "true", "on"].includes(value)) {
      agentForward = true
    } else if (["no", "false", "off"].includes(value)) {
      agentForward = false
    }
  }

  return {
    host,
    port,
    username,
    privateKeyPaths: privateKeyPaths.length > 0 ? privateKeyPaths : undefined,
    agent:
      identityAgent && identityAgent.toLowerCase() !== "none"
        ? expandHomePath(identityAgent)
        : undefined,
    agentForward,
  }
}

async function readExpandedSshConfig(
  entryPath: string,
  visited: Set<string>,
): Promise<string> {
  const resolvedPath = path.resolve(expandHomePath(entryPath))
  if (visited.has(resolvedPath) || !(await canReadFile(resolvedPath))) {
    return ""
  }

  visited.add(resolvedPath)

  const fileText = await readFile(resolvedPath, "utf8")
  let parsed: SSHConfig

  try {
    parsed = SSHConfig.parse(fileText)
  } catch {
    throw new Error(`SSH 配置文件解析失败: ${resolvedPath}`)
  }

  const baseDir = path.dirname(resolvedPath)
  let output = ""

  for (const line of parsed) {
    if (
      line.type === LineType.DIRECTIVE &&
      line.param.toLowerCase() === "include"
    ) {
      const patterns = (
        typeof line.value === "string"
          ? line.value
          : line.value.map((item) => item.val).join(" ")
      )
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)

      for (const rawPattern of patterns) {
        const pattern = expandHomePath(rawPattern)
        const absolutePattern = path.isAbsolute(pattern)
          ? pattern
          : path.resolve(baseDir, pattern)
        const includePaths: string[] = []

        for await (const match of glob(absolutePattern)) {
          includePaths.push(path.resolve(match))
        }

        includePaths.sort((a, b) => a.localeCompare(b))

        for (const includePath of includePaths) {
          output += await readExpandedSshConfig(includePath, visited)
        }
      }

      continue
    }

    const fragment = new SSHConfig()
    fragment.push(line)
    output += SSHConfig.stringify(fragment)
  }

  return output
}

async function canReadFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolvePrivateKeyAuth(
  auth: SshPrivateKeyAuth,
  localConfig: LocalSshConfigMatch,
): Promise<
  Pick<
    ResolvedSshConnectConfig,
    "privateKey" | "passphrase" | "agent" | "agentForward"
  >
> {
  const agent = localConfig.agent || process.env.SSH_AUTH_SOCK?.trim()
  const privateKeyCandidates = [...(localConfig.privateKeyPaths ?? [])]
  const sshDir = path.join(homedir(), ".ssh")

  for (const fileName of DEFAULT_PRIVATE_KEY_FILES) {
    privateKeyCandidates.push(path.join(sshDir, fileName))
  }

  let privateKeyPath = ""

  for (const filePath of privateKeyCandidates) {
    if (await canReadFile(filePath)) {
      privateKeyPath = filePath
      break
    }
  }

  if (!privateKeyPath && !agent) {
    throw new Error("未找到可用的 SSH 私钥或 agent")
  }

  let privateKey: string | undefined

  if (privateKeyPath) {
    try {
      privateKey = await readFile(privateKeyPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        throw new Error("私钥文件不存在")
      }

      throw new Error("私钥文件不可读取")
    }
  }

  return {
    privateKey,
    passphrase: auth.passphrase?.trim() || undefined,
    agent: agent || undefined,
    agentForward: localConfig.agentForward,
  }
}

export async function resolveSshConnectConfig(
  ssh: SshConfig,
): Promise<ResolvedSshConnectConfig> {
  const localConfig = await resolveLocalSshConfig(ssh)

  const host = localConfig.host || ssh.host.trim()
  if (!host) {
    throw new Error("SSH 主机不能为空")
  }

  const portText = localConfig.port || ssh.port.trim() || "22"
  const port = parsePort(portText, "SSH 端口")
  const username = localConfig.username || ssh.username.trim()
  if (!username) {
    throw new Error("SSH 账号不能为空")
  }

  if (ssh.auth.type === "password") {
    const password = ssh.auth.password.trim()
    if (!password) {
      throw new Error("SSH 密码不能为空")
    }

    return {
      host,
      port,
      username,
      password,
      tryKeyboard: true,
    }
  }

  return {
    host,
    port,
    username,
    ...(await resolvePrivateKeyAuth(ssh.auth, localConfig)),
  }
}

export async function connectSshClient(ssh: SshConfig): Promise<SshClient> {
  const config = await resolveSshConnectConfig(ssh)

  return new Promise((resolve, reject) => {
    const client = new SshClient()
    let settled = false

    const cleanup = () => {
      client.removeAllListeners("ready")
      client.removeAllListeners("error")
      client.removeAllListeners("close")
      client.removeAllListeners("end")
      client.removeAllListeners("timeout")
      client.removeAllListeners("keyboard-interactive")
    }

    const rejectPending = (message: string, error?: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      const reason = error instanceof Error ? error : new Error(message)
      reject(reason)
    }

    if (ssh.auth.type === "password") {
      const password = config.password ?? ""

      client.on(
        "keyboard-interactive",
        (_name, _instructions, _lang, prompts, finish) => {
          if (!password) {
            finish([])
            return
          }

          finish(prompts.map(() => password))
        },
      )
    }

    client.once("ready", () => {
      settled = true
      cleanup()
      resolve(client)
    })

    client.once("error", (error) => {
      rejectPending("SSH 连接失败", error)
    })

    client.once("end", () => {
      rejectPending("SSH 连接在完成握手前已结束")
    })

    client.once("close", () => {
      rejectPending("SSH 连接在完成握手前已关闭")
    })

    client.once("timeout", () => {
      rejectPending("SSH 连接超时")
    })

    try {
      client.connect({
        ...config,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        readyTimeout: 20_000,
      })
    } catch (error) {
      rejectPending("SSH 连接初始化失败", error)
    }
  })
}

export class SshTunnelStream extends Duplex {
  #ssh: SshClient
  #channel: DuplexStream | null = null
  #connected = false
  #connecting = false
  #target: { host: string; port: number } | null = null

  constructor(ssh: SshClient) {
    super()
    this.#ssh = ssh
  }

  connect(port: number, host: string): this {
    const target = { host, port }

    if (this.#target) {
      if (this.#target.host !== host || this.#target.port !== port) {
        throw new Error("SSH 隧道已绑定到其他目标")
      }

      if (this.#connecting || this.#connected) {
        return this
      }
    }

    this.#target = target
    this.#connecting = true

    this.#ssh.forwardOut("127.0.0.1", 0, host, port, (error, channel) => {
      if (error) {
        this.#connecting = false
        this.destroy(error)
        return
      }

      if (!channel) {
        this.#connecting = false
        this.destroy(new Error("SSH 隧道创建失败"))
        return
      }

      if (this.destroyed) {
        channel.destroy()
        return
      }

      this.#channel = channel
      this.#connecting = false
      this.#connected = true

      channel.on("data", (chunk) => {
        if (!this.push(chunk)) {
          channel.pause()
        }
      })

      channel.on("end", () => {
        this.push(null)
      })

      channel.on("close", () => {
        this.push(null)
      })

      channel.on("error", (channelError) => {
        this.destroy(channelError)
      })

      process.nextTick(() => {
        if (!this.destroyed) {
          this.emit("connect")
        }
      })
    })

    return this
  }

  _read(): void {
    this.#channel?.resume()
  }

  _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const channel = this.#channel
    if (!channel) {
      callback(new Error("SSH 隧道尚未建立"))
      return
    }

    const drain = () => {
      channel.off("error", onError)
      callback()
    }

    const onError = (error: Error) => {
      channel.off("drain", drain)
      callback(error)
    }

    channel.once("error", onError)
    const writable = channel.write(chunk, encoding)

    if (writable) {
      drain()
      return
    }

    channel.once("drain", drain)
  }

  _final(callback: (error?: Error | null) => void): void {
    const channel = this.#channel
    if (!channel || channel.destroyed || channel.writableEnded) {
      callback()
      return
    }

    channel.once("close", () => {
      callback()
    })
    channel.end()
  }

  _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    const channel = this.#channel
    this.#channel = null
    this.#connecting = false
    this.#connected = false

    if (channel && !channel.destroyed) {
      channel.destroy(error ?? undefined)
    }

    callback(error)
  }

  setNoDelay(): this {
    return this
  }

  setKeepAlive(): this {
    return this
  }

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }
}
