import axios from "axios";

import type { AiConfig, ModelCapability } from "@/stores/use-config-store";

export type ApilioAdapterId = "apilio-unified-video" | "apilio-kling-video" | "apilio-suno-music";
export type ApilioVideoAdapterId = Extract<ApilioAdapterId, "apilio-unified-video" | "apilio-kling-video">;

export type ApilioVideoCreateParams = {
    seconds: string;
    ratio: string;
    resolution: string;
    watermark: boolean;
};

export type ApilioVideoTask = {
    id: string;
    adapter: ApilioVideoAdapterId;
    mode?: "text" | "image";
};

export type ApilioVideoTaskState =
    | { status: "pending" }
    | { status: "completed"; result: { url: string; mimeType: string } }
    | { status: "failed"; error: string };

type JsonRecord = Record<string, unknown>;
type RequestOptions = { signal?: AbortSignal };

const UNIFIED_VIDEO_MATCHERS = [
    /seedance/i,
    /sdols/i,
    /(^|[\/_-])veo(?:[\/_-]|\d|$)/i,
    /(^|[\/_-])wan(?:2|[\/_-])/i,
    /grok.*video|video.*grok/i,
    /sora(?:2|[\/_-]2)/i,
];

export function isApilioBaseUrl(baseUrl: string) {
    const value = baseUrl.trim();
    if (!value) return false;
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        return host === "api.apilio.ai" || host.endsWith(".apilio.ai") || host.endsWith(".bltcy.ai");
    } catch {
        return /apilio\.ai|bltcy\.ai/i.test(value);
    }
}

export function resolveApilioAdapter(baseUrl: string, model: string, capability: ModelCapability): ApilioAdapterId | null {
    if (!isApilioBaseUrl(baseUrl)) return null;
    const name = model.trim().toLowerCase();
    if (capability === "video") {
        if (name.includes("kling")) return "apilio-kling-video";
        if (UNIFIED_VIDEO_MATCHERS.some((matcher) => matcher.test(name))) return "apilio-unified-video";
    }
    if (capability === "audio" && (name.includes("suno") || name.includes("chirp-"))) return "apilio-suno-music";
    return null;
}

export function apilioApiRoot(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "").replace(/\/(?:v1beta|v1|v2)$/i, "");
}

function apilioUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${apilioApiRoot(config.baseUrl)}${normalizedPath}`;
}

function headers(config: Pick<AiConfig, "apiKey">) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export async function createApilioVideoTask(
    config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">,
    adapter: ApilioVideoAdapterId,
    prompt: string,
    images: string[],
    params: ApilioVideoCreateParams,
    options?: RequestOptions,
): Promise<ApilioVideoTask> {
    if (adapter === "apilio-kling-video") return createKlingVideoTask(config, prompt, images, params, options);
    const body: JsonRecord = {
        prompt,
        model: config.model,
        duration: normalizeDuration(params.seconds),
        watermark: params.watermark,
    };
    const ratio = normalizeRatio(params.ratio);
    const resolution = normalizeResolution(params.resolution);
    if (ratio) body.aspect_ratio = ratio;
    if (resolution) body.resolution = resolution;
    if (images.length) body.images = images;

    const response = await axios.post(apilioUrl(config, "/v2/videos/generations"), body, {
        headers: headers(config),
        signal: options?.signal,
    });
    const id = taskIdFrom(response.data);
    if (!id) throw new Error("Apilio unified video response did not include task_id.");
    return { id, adapter: "apilio-unified-video" };
}

export async function pollApilioVideoTask(
    config: Pick<AiConfig, "baseUrl" | "apiKey">,
    task: ApilioVideoTask,
    options?: RequestOptions,
): Promise<ApilioVideoTaskState> {
    if (task.adapter === "apilio-kling-video") return pollKlingVideoTask(config, task, options);
    const response = await axios.get(apilioUrl(config, `/v2/videos/generations/${encodeURIComponent(task.id)}`), {
        headers: headers(config),
        signal: options?.signal,
    });
    const core = taskRecord(response.data);
    const status = stringValue(core.status).toUpperCase();
    const url = unifiedOutputUrl(core);
    if (url && (status === "SUCCESS" || status === "COMPLETED" || !status)) return completedVideo(url);
    if (["FAILURE", "FAILED", "CANCELLED", "CANCELED"].includes(status)) {
        return { status: "failed", error: failureReason(core) || "Apilio video generation failed." };
    }
    return { status: "pending" };
}

async function createKlingVideoTask(
    config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">,
    prompt: string,
    images: string[],
    params: ApilioVideoCreateParams,
    options?: RequestOptions,
): Promise<ApilioVideoTask> {
    const mode: "text" | "image" = images.length ? "image" : "text";
    const ratio = normalizeRatio(params.ratio) || "16:9";
    const body: JsonRecord = {
        model_name: config.model,
        prompt,
        mode: "std",
        duration: String(normalizeDuration(params.seconds)),
    };
    if (mode === "text") body.aspect_ratio = ratio;
    else {
        body.image = klingImageValue(images[0]);
        if (images[1]) body.image_tail = klingImageValue(images[1]);
    }
    const submitPath = mode === "image" ? "/kling/v1/videos/image2video" : "/kling/v1/videos/text2video";
    const response = await axios.post(apilioUrl(config, submitPath), body, {
        headers: headers(config),
        signal: options?.signal,
    });
    const id = taskIdFrom(response.data);
    if (!id) throw new Error("Kling video response did not include task_id.");
    return { id, adapter: "apilio-kling-video", mode };
}

async function pollKlingVideoTask(
    config: Pick<AiConfig, "baseUrl" | "apiKey">,
    task: ApilioVideoTask,
    options?: RequestOptions,
): Promise<ApilioVideoTaskState> {
    const action = task.mode === "image" ? "image2video" : "text2video";
    const documentedPath = `/kling/v1/images/${action}/${encodeURIComponent(task.id)}`;
    const fallbackPath = `/kling/v1/videos/${action}/${encodeURIComponent(task.id)}`;
    let payload: unknown;
    try {
        payload = (await axios.get(apilioUrl(config, documentedPath), { headers: headers(config), signal: options?.signal })).data;
    } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
        payload = (await axios.get(apilioUrl(config, fallbackPath), { headers: headers(config), signal: options?.signal })).data;
    }
    const core = taskRecord(payload);
    const status = stringValue(core.task_status || core.status).toLowerCase();
    const url = klingOutputUrl(core);
    if (url && (!status || /succeed|success|complete/.test(status))) return completedVideo(url);
    if (/fail|cancel|error/.test(status)) return { status: "failed", error: failureReason(core) || "Kling video generation failed." };
    return { status: "pending" };
}

export async function requestApilioSunoMusic(
    config: Pick<AiConfig, "baseUrl" | "apiKey" | "model">,
    prompt: string,
    options?: RequestOptions,
): Promise<Blob> {
    const response = await axios.post(
        apilioUrl(config, "/suno/submit/music"),
        {
            prompt,
            mv: sunoMvForModel(config.model),
            make_instrumental: false,
        },
        { headers: headers(config), signal: options?.signal },
    );

    const immediate = sunoItems(response.data);
    const ready = firstAudioUrl(immediate);
    if (ready) return fetchAudioBlob(ready, options);

    const clipIds = immediate.map((item) => stringValue(item.id || item.clip_id)).filter(Boolean);
    const taskId = taskIdFrom(response.data);
    if (!clipIds.length && !taskId) throw new Error("Suno response did not include clip IDs or task_id.");

    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await sleep(attempt < 10 ? 3000 : 5000, options?.signal);
        const payload = clipIds.length
            ? (await axios.get(apilioUrl(config, `/suno/feed/${clipIds.map(encodeURIComponent).join(",")}`), { headers: headers(config), signal: options?.signal })).data
            : (await axios.get(apilioUrl(config, `/suno/fetch/${encodeURIComponent(taskId!)}`), { headers: headers(config), signal: options?.signal })).data;
        const items = sunoItems(payload);
        const url = firstAudioUrl(items);
        if (url) return fetchAudioBlob(url, options);
        if (sunoFailed(payload, items)) throw new Error(failureReason(taskRecord(payload)) || "Suno music generation failed.");
    }
    throw new Error("Suno music generation timed out.");
}

function sunoMvForModel(model: string) {
    const value = model.trim().toLowerCase();
    const chirp = value.match(/chirp-[a-z0-9.+_-]+/i)?.[0];
    if (chirp) return chirp;
    if (/5[._-]?5|v5\.5|fenix/.test(value)) return "chirp-fenix";
    if (/v?5(?:$|[^0-9])|crow/.test(value)) return "chirp-crow";
    if (/4[._-]?5\+|bluejay/.test(value)) return "chirp-bluejay";
    if (/4[._-]?5.*(?:all|turbo)|auk-turbo/.test(value)) return "chirp-auk-turbo";
    if (/4[._-]?5|auk/.test(value)) return "chirp-auk";
    if (/3[._-]?5/.test(value)) return "chirp-v3-5";
    if (/v?4(?:$|[^0-9])/.test(value)) return "chirp-v4";
    return "chirp-fenix";
}

function normalizeDuration(value: string) {
    const number = Math.floor(Number(value) || 5);
    return Math.max(1, Math.min(20, number));
}

function normalizeRatio(value: string) {
    const ratio = value.trim();
    return /^\d+:\d+$/.test(ratio) ? ratio : "";
}

function normalizeResolution(value: string) {
    const match = value.trim().match(/(\d{3,4})/);
    return match ? `${match[1]}P` : "";
}

function klingImageValue(value: string) {
    const match = value.match(/^data:[^;]+;base64,(.+)$/s);
    return match?.[1] || value;
}

function taskIdFrom(payload: unknown): string {
    const record = asRecord(payload);
    if (!record) return "";
    const direct = stringValue(record.task_id || record.taskId || record.id);
    if (direct) return direct;
    for (const key of ["data", "result"]) {
        const nested = asRecord(record[key]);
        const id = nested ? stringValue(nested.task_id || nested.taskId || nested.id) : "";
        if (id) return id;
    }
    return "";
}

function taskRecord(payload: unknown): JsonRecord {
    const record = asRecord(payload) || {};
    if (record.status !== undefined || record.task_status !== undefined || record.task_id !== undefined) return record;
    const data = asRecord(record.data);
    if (data && (data.status !== undefined || data.task_status !== undefined || data.task_id !== undefined || data.task_result !== undefined)) return data;
    const result = asRecord(record.result);
    if (result) return result;
    return record;
}

function unifiedOutputUrl(core: JsonRecord) {
    const data = asRecord(core.data) || {};
    const outputs = Array.isArray(data.outputs) ? data.outputs : Array.isArray(core.outputs) ? core.outputs : [];
    return [data.output, core.output, ...outputs].map(stringValue).find(isHttpUrl) || "";
}

function klingOutputUrl(core: JsonRecord) {
    const taskResult = asRecord(core.task_result) || asRecord(asRecord(core.data)?.task_result) || {};
    const videos = Array.isArray(taskResult.videos) ? taskResult.videos : [];
    for (const video of videos) {
        const url = stringValue(asRecord(video)?.url);
        if (isHttpUrl(url)) return url;
    }
    return "";
}

function sunoItems(payload: unknown): JsonRecord[] {
    if (Array.isArray(payload)) return payload.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
    const record = asRecord(payload);
    if (!record) return [];
    for (const candidate of [record.clips, record.data, asRecord(record.data)?.clips, asRecord(record.data)?.data]) {
        if (Array.isArray(candidate)) return candidate.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
    }
    return [];
}

function firstAudioUrl(items: JsonRecord[]) {
    for (const item of items) {
        const url = stringValue(item.audio_url || item.audioUrl);
        if (isHttpUrl(url)) return url;
    }
    return "";
}

function sunoFailed(payload: unknown, items: JsonRecord[]) {
    const core = taskRecord(payload);
    const rootStatus = stringValue(core.status || core.state).toLowerCase();
    if (/fail|error|cancel/.test(rootStatus)) return true;
    if (!items.length) return false;
    const statuses = items.map((item) => stringValue(item.status || item.state).toLowerCase()).filter(Boolean);
    return Boolean(statuses.length && statuses.every((status) => /fail|error|cancel/.test(status)));
}

async function fetchAudioBlob(url: string, options?: RequestOptions) {
    const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
    return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: "audio/mpeg" });
}

function completedVideo(url: string): ApilioVideoTaskState {
    return { status: "completed", result: { url, mimeType: "video/mp4" } };
}

function failureReason(core: JsonRecord) {
    const error = asRecord(core.error);
    return stringValue(core.fail_reason || core.task_status_msg || core.message || core.msg || error?.message);
}

function asRecord(value: unknown): JsonRecord | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
