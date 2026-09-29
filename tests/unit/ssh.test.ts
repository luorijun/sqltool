import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SSHConfig } from "ssh-config"
import { readExpandedSshConfig } from "../../src/main/database/drivers/ssh"

test("SSH includes preserve quoted paths, multiple files and nested includes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sqltool-ssh-"))
  try {
    await mkdir(path.join(dir, "my configs"))
    await writeFile(
      path.join(dir, "config"),
      'Include "my configs/first" "my configs/second"\n',
    )
    await writeFile(
      path.join(dir, "my configs/first"),
      'Include "nested config"\n',
    )
    await writeFile(
      path.join(dir, "my configs/nested config"),
      "Host first\n  HostName first.example\n",
    )
    await writeFile(
      path.join(dir, "my configs/second"),
      "Host second\n  HostName second.example\n",
    )

    const text = await readExpandedSshConfig(
      path.join(dir, "config"),
      new Set(),
    )
    const config = SSHConfig.parse(text)
    expect(config.compute("first").HostName).toBe("first.example")
    expect(config.compute("second").HostName).toBe("second.example")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
