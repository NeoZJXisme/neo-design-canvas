import axios from "axios";

import { guessModelProvider } from "@/lib/model-taxonomy";
import { buildApiUrl, guessCapability, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

const AUDIO_KEYWORDS = [
    "tts",
    "speech",
    "voice",
    "music",
    "audio",
    "suno",
    "chirp-",
    "riffusion",
    "elevenlabs",
    "eleven-",
    "cartesia",
    "sonic-",
    "fish-speech",
    "fish-audio",
    "cosyvoice",
];

const IMAGE_KEYWORDS = [
    "gpt-image",
    "gpt-4o-image",
    "sora_image",
    "dall-e",
    "dalle",
    "imagen",
    "seedream",
    "banana",
    "qwen-image",
    "qwen_image",
    "wan-image",
    "wan_image",
    "ideogram",
    "recraft",
    "firefly",
    "flux",
    "stable-diffusion",
    "stable-image",
    "stability",
    "sdxl",
    "midjourney",
    "kolors",
    "hidream",
    "jimeng",
    "doubao-image",
    "cogview",
    "janus",
    "topaz-image",
];

const VIDEO_KEYWORDS = [
    "video",
    "veo",
    "seedance",
    "kling",
    "wan2",
    "wan-2",
    "wan_video",
    "wan-video",
    "hailuo",
    "runway",
    "gen-3",
    "gen3",
    "gen-4",
    "gen4",
    "luma",
    "dream-machine",
    "ray2",
    "pika",
    "pixverse",
    "higgsfield",
    "vidu",
    "cogvideo",
    "sora",
    "topaz-video",
];

export type DiscoveredChannelModel = {
    name: string;
    provider: string;
    capability: ModelCapability;
};

function modelName(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of ["id", "name", "model", "model_id", "modelId"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim().replace(/^models\//, "");
    }
    return "";
}

function upstreamProvider(value: unknown) {
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of ["provider", "owned_by", "ownedBy", "vendor", "organization", "owner", "company"]) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
}

function metadataHint(value: unknown) {
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["type", "capability", "category", "modalities", "modality", "endpoint", "endpoints", "supported_endpoints", "supportedEndpoints"]) {
        const candidate = record[key];
        if (typeof candidate === "string") parts.push(candidate);
        else if (Array.isArray(candidate)) parts.push(candidate.filter((item) => typeof item === "string").join(" "));
    }
    return parts.join(" ").toLowerCase();
}

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function modelCandidates(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const result = record?.result && typeof record.result === "object" && !Array.isArray(record.result) ? (record.result as Record<string, unknown>) : null;
    return [
        ...arrayValue(payload),
        ...arrayValue(record?.data),
        ...arrayValue(record?.models),
        ...arrayValue(record?.items),
        ...arrayValue(result?.data),
        ...arrayValue(result?.models),
        ...arrayValue(result?.items),
    ];
}

function capabilityFromMetadata(name: string, item: unknown) {
    const hint = metadataHint(item);
    if (/audio|speech|voice|music|tts/.test(hint)) return "audio" as const;
    if (/image|picture|drawing|vision-generation/.test(hint)) return "image" as const;
    if (/video|movie/.test(hint)) return "video" as const;
    return guessCompatibleCapability(name);
}

/**
 * OpenAI-compatible gateways are not perfectly consistent about the /models
 * response envelope. Accept common relay shapes and preserve whatever provider
 * metadata the upstream exposes. Name-based inference is the fallback.
 */
function extractModelCatalog(payload: unknown): DiscoveredChannelModel[] {
    const map = new Map<string, DiscoveredChannelModel>();
    for (const item of modelCandidates(payload)) {
        const name = modelName(item);
        if (!name || map.has(name)) continue;
        const upstream = upstreamProvider(item);
        const provider = guessModelProvider(name, upstream).label;
        map.set(name, { name, provider, capability: capabilityFromMetadata(name, item) });
    }
    return Array.from(map.values()).sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

function geminiModelsUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    const root = lower.endsWith("/v1") || lower.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
    return `${root}/models`;
}

export function guessCompatibleCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    // Specific image aliases must win over broad video family names such as sora.
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    return guessCapability(name);
}

export async function fetchCompatibleChannelCatalog(channel: ModelChannel) {
    if (channel.apiFormat === "gemini") {
        const response = await axios.get(geminiModelsUrl(channel.baseUrl), {
            headers: { "x-goog-api-key": channel.apiKey },
        });
        return extractModelCatalog(response.data);
    }

    const response = await axios.get(buildApiUrl(channel.baseUrl, "/models"), {
        headers: { Authorization: `Bearer ${channel.apiKey}` },
    });
    return extractModelCatalog(response.data);
}

export async function fetchCompatibleChannelModels(channel: ModelChannel) {
    return (await fetchCompatibleChannelCatalog(channel)).map((model) => model.name);
}

export async function pingChannel(channel: ModelChannel) {
    const startedAt = performance.now();
    const catalog = await fetchCompatibleChannelCatalog(channel);
    return {
        latency: Math.max(1, Math.round(performance.now() - startedAt)),
        models: catalog.map((model) => model.name),
        catalog,
    };
}
