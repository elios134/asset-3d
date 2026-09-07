import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/types";

const api: Api = {
  analyze: () => ipcRenderer.invoke("analyze"),
  prereqs: () => ipcRenderer.invoke("prereqs"),
  getThumbnail: (name) => ipcRenderer.invoke("thumbnail", name),
  updateData: () => ipcRenderer.invoke("updateData"),
  startExtract: (items) => ipcRenderer.invoke("extract:start", items),
  cancelExtract: () => ipcRenderer.invoke("extract:cancel"),
  onExtractEvent: (cb) => {
    const h = (_e: unknown, evt: unknown) => cb(evt as Parameters<typeof cb>[0]);
    ipcRenderer.on("extract:event", h);
    return () => { ipcRenderer.removeListener("extract:event", h); };
  },
  startQa: () => ipcRenderer.invoke("qa:start"),
  onQaEvent: (cb) => {
    const h = (_e: unknown, evt: unknown) => cb(evt as Parameters<typeof cb>[0]);
    ipcRenderer.on("qa:event", h);
    return () => { ipcRenderer.removeListener("qa:event", h); };
  },
};

contextBridge.exposeInMainWorld("api", api);
