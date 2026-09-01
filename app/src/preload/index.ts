import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/types";

const api: Api = {
  analyze: () => ipcRenderer.invoke("analyze"),
  prereqs: () => ipcRenderer.invoke("prereqs"),
  getThumbnail: (name) => ipcRenderer.invoke("thumbnail", name),
  updateData: () => ipcRenderer.invoke("updateData"),
};

contextBridge.exposeInMainWorld("api", api);
