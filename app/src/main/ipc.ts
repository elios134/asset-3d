import { ipcMain } from "electron";
import { createServices } from "./services";

export function registerIpc(repoRoot: string): void {
  const svc = createServices(repoRoot);
  ipcMain.handle("analyze", () => svc.analyze());
  ipcMain.handle("prereqs", () => svc.prereqs());
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
