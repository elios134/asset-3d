import { contextBridge } from "electron";

// Le pont réel est câblé en Task 3.
contextBridge.exposeInMainWorld("api", {});
