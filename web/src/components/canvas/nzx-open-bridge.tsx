import { useCallback, useEffect, useRef } from "react";
import { App } from "antd";
import { useNavigate } from "react-router-dom";

import { readNzxProjectArchive } from "@/lib/canvas/nzx-project";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export const NZX_OPEN_REQUEST_EVENT = "neo:nzx-open-request";

export function dispatchNzxOpenRequest(payload: { path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }) {
    window.dispatchEvent(new CustomEvent(NZX_OPEN_REQUEST_EVENT, { detail: payload }));
}

export function NzxOpenBridge() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const queuedRef = useRef<Array<{ path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }>>([]);

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
                if (payload.path) sessionStorage.setItem(`neo:nzx:path:${id}`, payload.path);
                if (savedProject?.updatedAt) sessionStorage.setItem(`neo:nzx:savedAt:${id}`, savedProject.updatedAt);
                navigate(`/canvas/${id}`);
                message.success(`已打开 ${payload.fileName || "NZX 项目"}`);
            } catch (error) {
                console.error(error);
                message.error("NZX 项目打开失败，请确认文件没有损坏");
            }
        },
        [hydrated, message, navigate],
    );

    useEffect(() => {
        const desktop = window.neoDesktop;
        const requestListener = (event: Event) => void openPayload((event as CustomEvent<{ path: string; fileName: string; bytes: Uint8Array | ArrayBuffer }>).detail);
        window.addEventListener(NZX_OPEN_REQUEST_EVENT, requestListener);
        const unsubscribe = desktop?.onOpenNzx((payload) => void openPayload(payload));
        if (desktop) void desktop.takePendingNzx().then((payload) => payload && openPayload(payload));
        return () => {
            window.removeEventListener(NZX_OPEN_REQUEST_EVENT, requestListener);
            unsubscribe?.();
        };
    }, [openPayload]);

    useEffect(() => {
        if (!hydrated || !queuedRef.current.length) return;
        const queued = queuedRef.current.splice(0);
        queued.forEach((payload) => void openPayload(payload));
    }, [hydrated, openPayload]);

    return null;
}
