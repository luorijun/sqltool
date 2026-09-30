import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

// DOM assertions in an isolated hidden window; no server or screenshots.
const dir = path.resolve("node_modules/.tmp/editor-events")
await mkdir(dir, { recursive: true })
const build = await Bun.build({
  entrypoints: [path.resolve("tests/interaction/editor.fixture.ts")],
  outdir: dir,
  target: "browser",
})
if (!build.success) throw new AggregateError(build.logs, "Fixture build failed")
await writeFile(
  path.join(dir, "index.html"),
  '<!doctype html><html><body><script type="module" src="./editor.fixture.js"></script></body></html>',
)
await writeFile(
  path.join(dir, "main.cjs"),
  `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { offscreen: true } });
  let code = 0;
  try {
    await win.loadFile(${JSON.stringify(path.join(dir, "index.html"))});
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    console.log(await win.webContents.executeJavaScript('window.runTests().catch(error => { throw new Error(error.stack) })'));
  } catch (error) { console.error(error); code = 1; }
  finally { win.destroy(); app.exit(code); }
});
`,
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const electron = (await import("electron")).default as unknown as string
const child = Bun.spawn([electron, path.join(dir, "main.cjs")], {
  env,
  stdout: "inherit",
  stderr: "inherit",
})
const timeout = setTimeout(() => child.kill(), 30000)
const code = await child.exited
clearTimeout(timeout)
if (code !== 0) throw new Error(`Editor interaction tests failed (${code})`)
