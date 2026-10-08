import { ipcRenderer } from "electron"
import {
  LOAD_WORKSPACE,
  SAVE_WORKSPACE,
  type WorkspaceApi,
} from "@/contracts/workspace"

const workspace: WorkspaceApi = {
  load: () => ipcRenderer.invoke(LOAD_WORKSPACE),
  save: (snapshot) => ipcRenderer.invoke(SAVE_WORKSPACE, snapshot),
}

export default workspace
