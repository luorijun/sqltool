import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

// Runs DOM events in an isolated, hidden Electron window. No server or screenshots.
const dir = path.resolve("node_modules/.tmp/table-area-events")
await mkdir(dir, { recursive: true })
const build = await Bun.build({
  entrypoints: [path.resolve("tests/interaction/table-area.fixture.tsx")],
  outdir: dir,
  target: "browser",
  define: { "process.env.NODE_ENV": '"test"' },
})
if (!build.success) throw new AggregateError(build.logs, "Fixture build failed")
await writeFile(
  path.join(dir, "index.html"),
  `<!doctype html><html><head><meta charset="UTF-8"><style>svg{width:16px;height:16px;pointer-events:none}button{user-select:none}li{list-style:none}</style></head><body><div id="root"></div><script type="module" src="./table-area.fixture.js"></script></body></html>`,
)
await writeFile(
  path.join(dir, "main.cjs"),
  `
process.on('uncaughtException', error => { console.error(error); process.exit(1) });
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
    const point = await win.webContents.executeJavaScript('window.prepareDrag()');
    const cdp = (method, args) => win.webContents.debugger.sendCommand(method, args);
    await cdp('Input.setInterceptDrags', { enabled: true });
    const intercepted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native dragstart was not triggered')), 3000);
      win.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Input.dragIntercepted') { clearTimeout(timer); resolve(params.data); }
      });
    });
    for (const [type, x, y, buttons] of [
      ['mouseMoved', point.x, point.y, 0],
      ['mousePressed', point.x, point.y, 1],
      ['mouseMoved', point.x + 15, point.y, 1],
      ['mouseMoved', point.targetX, point.targetY, 1],
    ]) {
      await cdp('Input.dispatchMouseEvent', { type, x, y, buttons, button: 'left', clickCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const data = await intercepted;
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp('Input.dispatchDragEvent', { type, x: point.targetX, y: point.targetY, data });
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.targetX, y: point.targetY, button: 'left', buttons: 0 });
    await win.webContents.executeJavaScript('window.finishDrag()');
    console.log('PASS: native mouse drag on the actual sort handle');
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
if (code !== 0) throw new Error(`Interaction tests failed (${code})`)
