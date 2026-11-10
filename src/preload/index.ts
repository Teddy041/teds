import { contextBridge, ipcRenderer } from "electron";
import type { PublicState } from "../shared/types";

// A safe bridge for the interface: only calls to "api:*" channels and listening for updates.

contextBridge.exposeInMainWorld("teds", {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args),
  onFrame: (fn: (f: unknown) => void) => {
    const h = (_e: unknown, f: unknown) => fn(f);
    ipcRenderer.on("screen-frame", h);
    return () => ipcRenderer.removeListener("screen-frame", h);
  },
  onState: (fn: (s: PublicState) => void) => {
    const h = (_e: unknown, s: PublicState) => fn(s);
    ipcRenderer.on("state", h);
    return () => ipcRenderer.removeListener("state", h);
  },
});
