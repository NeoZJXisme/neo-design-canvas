import { create } from "zustand";

export type NzxFileStatus = "autosaved" | "modified" | "saving" | "saved" | "error";

type NzxFileStore = {
    projectId: string;
    path: string;
    savedUpdatedAt: string;
    status: NzxFileStatus;
    setProject: (projectId: string) => void;
    markSaving: () => void;
    markSaved: (projectId: string, path: string, updatedAt: string) => void;
    markModified: () => void;
    markError: () => void;
    clearFile: (projectId?: string) => void;
};

const pathKey = (projectId: string) => `neo:nzx:path:${projectId}`;
const savedAtKey = (projectId: string) => `neo:nzx:savedAt:${projectId}`;

export const useNzxFileStore = create<NzxFileStore>((set, get) => ({
    projectId: "",
    path: "",
    savedUpdatedAt: "",
    status: "autosaved",
    setProject: (projectId) => {
        const previousProjectId = get().projectId;
        if (!projectId) {
            if (previousProjectId) void window.neoDesktop?.clearNzxPath();
            return set({ projectId: "", path: "", savedUpdatedAt: "", status: "autosaved" });
        }
        if (previousProjectId === projectId) return;
        if (previousProjectId) void window.neoDesktop?.clearNzxPath();
        const path = sessionStorage.getItem(pathKey(projectId)) || "";
        const savedUpdatedAt = sessionStorage.getItem(savedAtKey(projectId)) || "";
        set({ projectId, path, savedUpdatedAt, status: path ? "saved" : "autosaved" });
    },
    markSaving: () => set({ status: "saving" }),
    markSaved: (projectId, path, updatedAt) => {
        if (path) sessionStorage.setItem(pathKey(projectId), path);
        if (updatedAt) sessionStorage.setItem(savedAtKey(projectId), updatedAt);
        set({ projectId, path, savedUpdatedAt: updatedAt, status: "saved" });
    },
    markModified: () => set((state) => (state.path ? { status: "modified" } : { status: "autosaved" })),
    markError: () => set({ status: "error" }),
    clearFile: (projectId = get().projectId) => {
        if (projectId) {
            sessionStorage.removeItem(pathKey(projectId));
            sessionStorage.removeItem(savedAtKey(projectId));
        }
        void window.neoDesktop?.clearNzxPath();
        set({ projectId, path: "", savedUpdatedAt: "", status: "autosaved" });
    },
}));
