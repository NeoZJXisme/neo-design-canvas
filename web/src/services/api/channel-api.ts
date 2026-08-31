import axios from "axios";

import { buildApiUrl, guessCapability, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

const CREATIVE_IMAGE_KEYWORDS = [
    "banana",
    "qwen-image",
    "qwen_image",
    "wan-image",
    "wan_image",
    "ideogram",
    "recraft",
    "firefly",
    "kolors",
    "hidream",
    "jimeng",
    "doubao-image",
];

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

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/**
 * OpenAI-compatible gateways are not perfectly consistent about the /models
 * response envelope. Accept the common shapes used by relays and aggregators.
 */
function extractModelNames(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const result = record?.result && typeof record.result === "object" && !Array.isArray(record.result) ? (record.result as Record<string, unknown>) : null;
    const candidates = [
        ...arrayValue(payload),
        ...arrayValue(record?.data),
        ...arrayValue(record?.models),
        ...arrayValue(record?.items),
        ...arrayValue(result?.data),
        ...arrayValue(result?.models),
        ...arrayValue(result?.items),
    ];
    return Array.from(new Set(candidates.map(modelName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function geminiModelsUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    const root = lower.endsWith("/v1") || lower.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
    return `${root}/models`;
}

export function guessCompatibleCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (CREATIVE_IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return guessCapability(name);
}

export async function fetchCompatibleChannelModels(channel: ModelChannel) {
    if (channel.apiFormat === "gemini") {
        const response = await axios.get(geminiModelsUrl(channel.baseUrl), {
            headers: { "x-goog-api-key": channel.apiKey },
        });
        return extractModelNames(response.data);
    }

    const response = await axios.get(buildApiUrl(channel.baseUrl, "/models"), {
        headers: { Authorization: `Bearer ${channel.apiKey}` },
    });
    return extractModelNames(response.data);
}

export async function pingChannel(channel: ModelChannel) {
    const startedAt = performance.now();
    const models = await fetchCompatibleChannelModels(channel);
    return {
        latency: Math.max(1, Math.round(performance.now() - startedAt)),
        models,
    };
}
