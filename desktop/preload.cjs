const { contextBridge, ipcRenderer } = require("electron");

let pendingOpen = null;
const listeners = new Set();

ipcRenderer.on("nzx:open-file", (_event, payload) => {
  pendingOpen = payload;
  for (const listener of listeners) listener(payload);
});

contextBridge.exposeInMainWorld("neoDesktop", {
  isDesktop: true,
  saveNzx: (payload) => ipcRenderer.invoke("nzx:save", payload),
  openNzxDialog: () => ipcRenderer.invoke("nzx:open-dialog"),
  takePendingNzx: async () => {
    if (pendingOpen) {
      const value = pendingOpen;
      pendingOpen = null;
      return value;
    }
    return ipcRenderer.invoke("nzx:take-pending");
  },
  onOpenNzx: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  clearNzxPath: () => ipcRenderer.invoke("nzx:clear-path"),
});
