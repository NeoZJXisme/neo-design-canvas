import { useCallback, useEffect, useMemo, useRef } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { useLocation, useNavigate } from "react-router-dom";

import { createNzxProjectArchive, nzxFileName, readNzxProjectArchive } from "@/lib/canvas/nzx-project";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useNzxFileStore } from "@/stores/use-nzx-file-store";

export const NZX_OPEN_REQUEST_EVENT = "neo:nzx-open-request";
export const NZX_OPEN_DIALOG_EVENT = "neo:nzx-open-dialog";
export const NZX_SAVE_REQUEST_EVENT = "neo:nzx-save";
export const NZX_SAVE_AS_REQUEST_EVENT = "neo:nzx-save-as";

export function dispatchNzxOpenRequest(payload: { path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }) {
    window.dispatchEvent(new CustomEvent(NZX_OPEN_REQUEST_EVENT, { detail: payload }));
}

export function NzxOpenBridge() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projectId = useMemo(() => location.pathname.match(/^\/canvas\/([^/]+)/)?.[1] || "", [location.pathname]);
    const projectUpdatedAt = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.updatedAt || "");
    const queuedRef = useRef<Array<{ path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }>>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const openPayload = useCallback(
        async (payload: { path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }) => {
            if (!hydrated) {
                queuedRef.current.push(payload);
                return;
            }
            try {
                const bytes = payload.bytes instanceof ArrayBuffer ? new Uint8Array(payload.bytes) : new Uint8Array(payload.bytes);
                const imported = await readNzxProjectArchive(new Blob([bytes], { type: "application/octet-stream" }));
                const id = useCanvasStore.getState().importProject(imported.project);
                const savedProject = useCanvasStore.getState().projects.find((project) => project.id === id);
                useNzxFileStore.getState().markSaved(id, payload.path || "", savedProject?.updatedAt || "");
                navigate(`/canvas/${id}`);
                message.success(`已打开 ${payload.fileName || "NZX 项目"}`);
            } catch (error) {
                console.error(error);
                useNzxFileStore.getState().markError();
                message.error("NZX 项目打开失败，请确认文件没有损坏");
            }
        },
        [hydrated, message, navigate],
    );

    const openDialog = useCallback(async () => {
        const desktop = window.neoDesktop;
        if (desktop) {
            const payload = await desktop.openNzxDialog();
            if (payload) await openPayload(payload);
            return;
        }
        inputRef.current?.click();
    }, [openPayload]);

    const saveProject = useCallback(
        async (saveAsRequested: boolean) => {
            if (!projectId) return;
            const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
            if (!project) return message.error("未找到当前画布");
            const fileState = useNzxFileStore.getState();
            fileState.markSaving();
            try {
                const archive = await createNzxProjectArchive(project);
                const desktop = window.neoDesktop;
                let savedPath = fileState.path;
                if (desktop) {
                    const result = await desktop.saveNzx({
                        bytes: new Uint8Array(await archive.blob.arrayBuffer()),
                        suggestedName: nzxFileName(project.title),
                        path: fileState.path || undefined,
                        saveAs: saveAsRequested || !fileState.path,
                    });
                    if (result.canceled) {
                        fileState.markModified();
                        return;
                    }
                    savedPath = result.path || savedPath;
                } else {
                    saveAs(archive.blob, nzxFileName(project.title));
                }
                fileState.markSaved(projectId, savedPath || "", project.updatedAt);
                if (archive.missingAssets.length) message.warning(`已保存 .NZX，但有 ${archive.missingAssets.length} 个本地媒体文件已丢失`);
                else message.success(`已保存 ${nzxFileName(project.title)}`);
            } catch (error) {
                console.error(error);
                fileState.markError();
                message.error("NZX 项目保存失败");
            }
        },
        [message, projectId],
    );

    useEffect(() => {
        useNzxFileStore.getState().setProject(projectId);
    }, [projectId]);

    useEffect(() => {
        if (!projectId || !projectUpdatedAt) return;
        const state = useNzxFileStore.getState();
        if (state.projectId !== projectId) return;
        if (state.path && state.savedUpdatedAt && projectUpdatedAt !== state.savedUpdatedAt && state.status !== "saving") state.markModified();
    }, [projectId, projectUpdatedAt]);

    useEffect(() => {
        const desktop = window.neoDesktop;
        const openRequestListener = (event: Event) => void openPayload((event as CustomEvent<{ path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }>).detail);
        const openDialogListener = () => void openDialog();
        const saveListener = () => void saveProject(false);
        const saveAsListener = () => void saveProject(true);
        window.addEventListener(NZX_OPEN_REQUEST_EVENT, openRequestListener);
        window.addEventListener(NZX_OPEN_DIALOG_EVENT, openDialogListener);
        window.addEventListener(NZX_SAVE_REQUEST_EVENT, saveListener);
        window.addEventListener(NZX_SAVE_AS_REQUEST_EVENT, saveAsListener);
        const unsubscribe = desktop?.onOpenNzx((payload) => void openPayload(payload));
        if (desktop) void desktop.takePendingNzx().then((payload) => payload && openPayload(payload));
        return () => {
            window.removeEventListener(NZX_OPEN_REQUEST_EVENT, openRequestListener);
            window.removeEventListener(NZX_OPEN_DIALOG_EVENT, openDialogListener);
            window.removeEventListener(NZX_SAVE_REQUEST_EVENT, saveListener);
            window.removeEventListener(NZX_SAVE_AS_REQUEST_EVENT, saveAsListener);
            unsubscribe?.();
        };
    }, [openDialog, openPayload, saveProject]);

    useEffect(() => {
        const shortcut = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === "s") {
                if (!projectId) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                void saveProject(event.shiftKey);
                return;
            }
            if (key === "o") {
                event.preventDefault();
                event.stopImmediatePropagation();
                void openDialog();
            }
        };
        window.addEventListener("keydown", shortcut, true);
        return () => window.removeEventListener("keydown", shortcut, true);
    }, [openDialog, projectId, saveProject]);

    useEffect(() => {
        if (!hydrated || !queuedRef.current.length) return;
        const queued = queuedRef.current.splice(0);
        queued.forEach((payload) => void openPayload(payload));
    }, [hydrated, openPayload]);

    return (
        <input
            ref={inputRef}
            type="file"
            accept=".NZX,.nzx,application/zip"
            className="hidden"
            onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.arrayBuffer().then((bytes) => openPayload({ path: "", fileName: file.name, bytes }));
                event.currentTarget.value = "";
            }}
        />
    );
}
