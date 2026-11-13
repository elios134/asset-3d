import { ipcMain, dialog, BrowserWindow } from "electron";
import { createServices } from "./services";
import type { ConfigKey } from "../shared/types";

// Filtre de fichier par clé pour la fenêtre « Parcourir… ».
function dialogFilters(key: ConfigKey): Electron.FileFilter[] {
  if (key === "p4k") return [{ name: "Archive Star Citizen", extensions: ["p4k"] }];
  if (process.platform === "win32") return [{ name: "Exécutable", extensions: ["exe"] }];
  return [{ name: "Tous les fichiers", extensions: ["*"] }];
}

export function registerIpc(repoRoot: string): void {
  const svc = createServices(repoRoot);
  ipcMain.handle("analyze", () => svc.analyze());
  ipcMain.handle("game:scan", () => svc.scanGame());
  ipcMain.handle("prereqs", () => svc.prereqs());
  ipcMain.handle("config:get", () => svc.getConfig());
  ipcMain.handle("config:detect", () => svc.detectPaths());
  ipcMain.handle("config:set", (_e, key: ConfigKey, value: string) => svc.setConfigPath(key, value));
  ipcMain.handle("config:pick", async (e, key: ConfigKey) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const title = key === "p4k" ? "Choisir le fichier Data.p4k de Star Citizen"
      : key === "starbreaker" ? "Choisir starbreaker.exe" : "Choisir blender.exe";
    const res = await dialog.showOpenDialog(win!, { title, properties: ["openFile"], filters: dialogFilters(key) });
    if (res.canceled || res.filePaths.length === 0) return svc.getConfig(); // inchangé
    return svc.setConfigPath(key, res.filePaths[0]!.replace(/\\/g, "/"));
  });
  ipcMain.handle("index:entries", () => svc.indexEntries());
  ipcMain.handle("exclusions:get", () => svc.getExclusions());
  ipcMain.handle("exclusions:set", (_e, keys: string[]) => svc.setExclusions(keys));
  ipcMain.handle("thumbnail", (_e, name: string) => svc.getThumbnail(name));
  ipcMain.handle("updateData", () => svc.updateData());
  ipcMain.handle("extract:start", (e, items) => svc.startExtract(e.sender, items));
  ipcMain.handle("extract:cancel", () => svc.cancelExtract());
  ipcMain.handle("qa:start", (e) => svc.startQa(e.sender));
  ipcMain.handle("fp:start", (e) => svc.startFingerprintScan(e.sender));
  ipcMain.handle("publish:start", (e, opts) => svc.startPublish(e.sender, opts));
}
