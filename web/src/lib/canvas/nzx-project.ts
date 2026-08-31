import { nanoid } from "nanoid";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export const NZX_EXTENSION = ".NZX";
export const NZX_FORMAT_VERSION = 1;

export type NzxAssetManifest = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
    kind: "image" | "media";
};

export type NzxManifest = {
    format: "NZX";
    version: 1;
    app: "neo-canvas";
    savedAt: string;
    projectId: string;
    projectTitle: string;
    assets: NzxAssetManifest[];
    missingAssets?: string[];
};

export type NzxArchiveResult = {
    blob: Blob;
    assetCount: number;
    missingAssets: string[];
};

export type NzxImportedProject = {
    project: CanvasProject;
    manifest: NzxManifest;
};

export async function createNzxProjectArchive(project: CanvasProject): Promise<NzxArchiveResult> {
    const zipFiles: Array<{ name: string; data: BlobPart }> = [];
    const assets: NzxAssetManifest[] = [];
    const missingAssets: string[] = [];
    const storageKeys = collectStorageKeys(project);

    for (const [index, storageKey] of storageKeys.entries()) {
        const isImage = storageKey.startsWith("image:");
        const blob = isImage ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob) {
            missingAssets.push(storageKey);
            continue;
        }
        const extension = fileExtension(blob.type, storageKey);
        const path = `media/${String(index + 1).padStart(4, "0")}-${safeFileName(storageKey)}.${extension}`;
        assets.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size, kind: isImage ? "image" : "media" });
        zipFiles.push({ name: path, data: blob });
    }

    const manifest: NzxManifest = {
        format: "NZX",
        version: NZX_FORMAT_VERSION,
        app: "neo-canvas",
        savedAt: new Date().toISOString(),
        projectId: project.id,
        projectTitle: project.title,
        assets,
        ...(missingAssets.length ? { missingAssets } : {}),
    };

    const blob = await createZip([
        { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
        { name: "project.json", data: JSON.stringify(project, null, 2) },
        ...zipFiles,
    ]);

    return { blob, assetCount: assets.length, missingAssets };
}

export async function readNzxProjectArchive(file: Blob): Promise<NzxImportedProject> {
    const zip = await readZip(file);
    const manifestFile = zip.get("manifest.json");
    const projectFile = zip.get("project.json");
    if (!manifestFile || !projectFile) throw new Error("Invalid NZX project: manifest.json or project.json is missing.");

    const manifest = JSON.parse(await manifestFile.text()) as NzxManifest;
    if (manifest?.format !== "NZX" || manifest?.app !== "neo-canvas" || manifest?.version !== NZX_FORMAT_VERSION || !Array.isArray(manifest.assets)) {
        throw new Error("Unsupported NZX project format.");
    }

    const sourceProject = JSON.parse(await projectFile.text()) as CanvasProject;
    if (!sourceProject || !Array.isArray(sourceProject.nodes) || !Array.isArray(sourceProject.connections)) throw new Error("Invalid NZX project data.");

    const replacements = new Map<string, { storageKey: string; url: string }>();
    for (const asset of manifest.assets) {
        const packed = zip.get(asset.path);
        if (!packed) continue;
        const typedBlob = new Blob([await packed.arrayBuffer()], { type: asset.mimeType || "application/octet-stream" });
        if (asset.kind === "image" || asset.storageKey.startsWith("image:")) {
            const storageKey = `image:${nanoid()}`;
            const url = await setImageBlob(storageKey, typedBlob);
            replacements.set(asset.storageKey, { storageKey, url });
        } else {
            const prefix = safeStoragePrefix(asset.storageKey);
            const storageKey = `${prefix}:${nanoid()}`;
            const url = await setMediaBlob(storageKey, typedBlob);
            replacements.set(asset.storageKey, { storageKey, url });
        }
    }

    return { project: rewriteProjectStorage(sourceProject, replacements), manifest };
}

export function nzxFileName(title: string) {
    const base = safeFileName(title.trim() || "Neo Canvas Project") || "Neo Canvas Project";
    return `${base}${NZX_EXTENSION}`;
}

function rewriteProjectStorage(project: CanvasProject, replacements: Map<string, { storageKey: string; url: string }>) {
    return rewriteValue(project, replacements) as CanvasProject;
}

function rewriteValue(value: unknown, replacements: Map<string, { storageKey: string; url: string }>): unknown {
    if (typeof value === "string") return replacements.get(value)?.storageKey || value;
    if (Array.isArray(value)) return value.map((item) => rewriteValue(item, replacements));
    if (!value || typeof value !== "object") return value;

    const source = value as Record<string, unknown>;
    const replacement = typeof source.storageKey === "string" ? replacements.get(source.storageKey) : undefined;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) output[key] = rewriteValue(item, replacements);

    if (replacement) {
        output.storageKey = replacement.storageKey;
        for (const key of ["content", "url", "dataUrl"] as const) {
            const current = source[key];
            if (typeof current === "string" && (!/^https?:\/\//i.test(current) || current.startsWith("blob:"))) output[key] = replacement.url;
        }
    }
    return output;
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function safeStoragePrefix(storageKey: string) {
    const prefix = storageKey.split(":", 1)[0]?.replace(/[^a-z0-9_-]/gi, "") || "file";
    return prefix === "image" ? "file" : prefix;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("quicktime")) return "mov";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("flac")) return "flac";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
