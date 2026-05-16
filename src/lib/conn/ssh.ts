import { constants } from "node:fs"
import { access, glob, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Duplex, type Duplex as DuplexStream } from "node:stream"
import SSHConfig, { type Directive, LineType } from "ssh-config"
import type { ConnectConfig } from "ssh2"
import { Client as SshClient } from "ssh2"
import type { SshConfig, SshPasswordAuth, SshPrivateKeyAuth } from "."
import { parsePort } from "./driver"

type DirectiveValue = Directive["value"]

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
  privateKeyPaths?: string[]
  agent?: string
  agentForward?: boolean
}

function getSshConfigPath(): string {
  return path.join(homedir(), ".ssh", "config")
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
  const configPath = getSshConfigPath()
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

  const privateKeyPaths = toStringList(computed.identityfile)
    .map((value) => expandHomePath(value))
    .filter(Boolean)
  const identityAgent = toSingleValue(computed.identityagent)
  const forwardAgent = toBooleanValue(computed.forwardagent)

  return {
    privateKeyPaths: privateKeyPaths.length > 0 ? privateKeyPaths : undefined,
    agent:
      identityAgent && identityAgent.toLowerCase() !== "none"
        ? expandHomePath(identityAgent)
        : undefined,
    agentForward: forwardAgent,
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

  let output = ""

  for (const line of parsed) {
    if (line.type !== LineType.DIRECTIVE || !isIncludeDirective(line)) {
      output += stringifySshConfigLine(line)
      continue
    }

    for (const pattern of splitDirectiveValues(line.value)) {
      const includePaths = await resolveIncludeMatches(
        pattern,
        path.dirname(resolvedPath),
      )

      for (const includePath of includePaths) {
        output += await readExpandedSshConfig(includePath, visited)
      }
    }
  }

  return output
}

function isIncludeDirective(line: Directive): boolean {
  return line.param.toLowerCase() === "include"
}

async function resolveIncludeMatches(
  rawPattern: string,
  baseDir: string,
): Promise<string[]> {
  const pattern = expandHomePath(rawPattern)
  const absolutePattern = path.isAbsolute(pattern)
    ? pattern
    : path.resolve(baseDir, pattern)
  const matches: string[] = []

  for await (const match of glob(absolutePattern)) {
    matches.push(path.resolve(match))
  }

  return matches.sort((a, b) => a.localeCompare(b))
}

function stringifySshConfigLine(line: SSHConfig[number]): string {
  const fragment = new SSHConfig()
  fragment.push(line)
  return SSHConfig.stringify(fragment)
}

function normalizeDirectiveValue(value: DirectiveValue): string {
  if (typeof value === "string") {
    return value
  }

  return value.map((item) => item.val).join(" ")
}

function splitDirectiveValues(value: DirectiveValue): string[] {
  return normalizeDirectiveValue(value)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toSingleValue(
  value: string | string[] | undefined,
): string | undefined {
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

function toStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitDirectiveValues(item))
  }

  return value ? splitDirectiveValues(value) : []
}

function toBooleanValue(
  value: string | string[] | undefined,
): boolean | undefined {
  const text = toSingleValue(value)?.toLowerCase()
  if (!text) {
    return undefined
  }

  if (["yes", "true", "on"].includes(text)) {
    return true
  }

  if (["no", "false", "off"].includes(text)) {
    return false
  }

  return undefined
}

function getPreferredTextValue(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) {
      return trimmed
    }
  }

  return ""
}

async function canReadFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolveDefaultPrivateKeyPath(): Promise<string> {
  const sshDir = path.join(homedir(), ".ssh")

  for (const fileName of DEFAULT_PRIVATE_KEY_FILES) {
    const filePath = path.join(sshDir, fileName)
    if (await canReadFile(filePath)) {
      return filePath
    }
  }

  throw new Error("未找到默认私钥文件")
}

async function readPrivateKey(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error("私钥文件不存在")
    }

    throw new Error("私钥文件不可读取")
  }
}

function resolvePasswordAuth(
  auth: SshPasswordAuth,
): Pick<ResolvedSshConnectConfig, "password" | "tryKeyboard"> {
  const password = auth.password.trim()
  if (!password) {
    throw new Error("SSH 密码不能为空")
  }

  return {
    password,
    tryKeyboard: true,
  }
}

async function resolvePrivateKeyAuth(
  auth: SshPrivateKeyAuth,
  localConfig: Awaited<ReturnType<typeof resolveLocalSshConfig>>,
): Promise<
  Pick<
    ResolvedSshConnectConfig,
    "privateKey" | "passphrase" | "agent" | "agentForward"
  >
> {
  const agent = localConfig.agent?.trim() || process.env.SSH_AUTH_SOCK?.trim()
  const privateKeyPath = await resolveReadablePrivateKeyPath(
    localConfig.privateKeyPaths,
  ).catch(async () => {
    return resolveDefaultPrivateKeyPath().catch(() => "")
  })

  if (!privateKeyPath && !agent) {
    throw new Error("未找到可用的 SSH 私钥或 agent")
  }

  return {
    privateKey: privateKeyPath
      ? await readPrivateKey(privateKeyPath)
      : undefined,
    passphrase: auth.passphrase?.trim() || undefined,
    agent: agent || undefined,
    agentForward: localConfig.agentForward,
  }
}

async function resolveReadablePrivateKeyPath(
  filePaths: string[] | undefined,
): Promise<string> {
  for (const filePath of filePaths ?? []) {
    if (await canReadFile(filePath)) {
      return filePath
    }
  }

  throw new Error("SSH 私钥文件不可读取")
}

function toSshConnectConfig(config: ResolvedSshConnectConfig): ConnectConfig {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    privateKey: config.privateKey,
    passphrase: config.passphrase,
    agent: config.agent,
    agentForward: config.agentForward,
    tryKeyboard: config.tryKeyboard,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    readyTimeout: 20_000,
  }
}

export async function resolveSshConnectConfig(
  ssh: SshConfig,
): Promise<ResolvedSshConnectConfig> {
  const localConfig = await resolveLocalSshConfig(ssh)

  const host = getPreferredTextValue(ssh.host)
  if (!host) {
    throw new Error("SSH 主机不能为空")
  }

  const portText = getPreferredTextValue(ssh.port, "22")
  const username = getPreferredTextValue(ssh.username)
  if (!username) {
    throw new Error("SSH 账号不能为空")
  }

  const authConfig =
    ssh.auth.type === "password"
      ? resolvePasswordAuth(ssh.auth)
      : await resolvePrivateKeyAuth(ssh.auth, localConfig)

  return {
    host,
    port: parsePort(portText, "SSH 端口"),
    username,
    ...authConfig,
  }
}

export function connectSshClient(ssh: SshConfig): Promise<SshClient> {
  return new Promise(async (resolve, reject) => {
    let config: ResolvedSshConnectConfig

    try {
      config = await resolveSshConnectConfig(ssh)
    } catch (error) {
      reject(error)
      return
    }

    const client = new SshClient()
    let settled = false

    const cleanup = () => {
      client.removeAllListeners("ready")
      client.removeAllListeners("error")
      client.removeAllListeners("keyboard-interactive")
    }

    if (ssh.auth.type === "password") {
      const password = ssh.auth.password.trim()

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
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    })

    try {
      client.connect(toSshConnectConfig(config))
    } catch (error) {
      cleanup()
      reject(error)
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

      this.emit("connect")
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
