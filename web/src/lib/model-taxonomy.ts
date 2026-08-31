export type ModelProvider = {
    key: string;
    label: string;
};

const PROVIDERS: Array<ModelProvider & { keywords: string[] }> = [
    { key: "openai", label: "OpenAI", keywords: ["gpt-", "chatgpt", "codex", "dall-e", "dalle", "sora"] },
    { key: "google", label: "Google", keywords: ["gemini", "imagen", "veo", "banana"] },
    { key: "anthropic", label: "Anthropic", keywords: ["claude"] },
    { key: "deepseek", label: "DeepSeek", keywords: ["deepseek", "janus"] },
    { key: "xai", label: "xAI · Grok", keywords: ["grok"] },
    { key: "alibaba", label: "Alibaba · Qwen / Wan", keywords: ["qwen", "qwq", "wan2", "wan-", "wan_", "tongyi"] },
    { key: "bytedance", label: "ByteDance · Seedream / Seedance", keywords: ["seedream", "seedance", "doubao", "jimeng", "dreamina"] },
    { key: "minimax", label: "MiniMax · Hailuo", keywords: ["minimax", "hailuo"] },
    { key: "kuaishou", label: "Kuaishou · Kling / Kolors", keywords: ["kling", "kolors"] },
    { key: "zhipu", label: "Zhipu AI", keywords: ["glm", "cogview", "cogvideo", "chatglm"] },
    { key: "tencent", label: "Tencent · Hunyuan", keywords: ["hunyuan"] },
    { key: "moonshot", label: "Moonshot · Kimi", keywords: ["kimi", "moonshot"] },
    { key: "xiaomi", label: "Xiaomi · MiMo", keywords: ["mimo"] },
    { key: "meta", label: "Meta · Llama", keywords: ["llama"] },
    { key: "mistral", label: "Mistral", keywords: ["mistral", "codestral", "pixtral", "ministral"] },
    { key: "cohere", label: "Cohere", keywords: ["command-r", "command-a", "cohere"] },
    { key: "perplexity", label: "Perplexity", keywords: ["sonar", "perplexity"] },
    { key: "amazon", label: "Amazon · Nova", keywords: ["amazon-nova", "nova-"] },
    { key: "microsoft", label: "Microsoft · Phi", keywords: ["phi-"] },
    { key: "baidu", label: "Baidu · ERNIE", keywords: ["ernie"] },
    { key: "stepfun", label: "StepFun", keywords: ["step-"] },
    { key: "bfl", label: "Black Forest Labs · Flux", keywords: ["flux"] },
    { key: "midjourney", label: "Midjourney", keywords: ["midjourney", "mj-"] },
    { key: "ideogram", label: "Ideogram", keywords: ["ideogram"] },
    { key: "recraft", label: "Recraft", keywords: ["recraft"] },
    { key: "adobe", label: "Adobe · Firefly", keywords: ["firefly"] },
    { key: "stability", label: "Stability AI", keywords: ["stable-diffusion", "stability", "sdxl", "stable-image"] },
    { key: "runway", label: "Runway", keywords: ["runway", "gen-3", "gen3", "gen-4", "gen4"] },
    { key: "luma", label: "Luma AI", keywords: ["luma", "dream-machine", "ray2"] },
    { key: "pika", label: "Pika", keywords: ["pika"] },
    { key: "pixverse", label: "PixVerse", keywords: ["pixverse"] },
    { key: "higgsfield", label: "Higgsfield", keywords: ["higgsfield"] },
    { key: "vidu", label: "Vidu", keywords: ["vidu"] },
    { key: "topaz", label: "Topaz", keywords: ["topaz"] },
    { key: "suno", label: "Suno", keywords: ["suno", "chirp-"] },
    { key: "riffusion", label: "Riffusion", keywords: ["riffusion"] },
    { key: "elevenlabs", label: "ElevenLabs", keywords: ["elevenlabs", "eleven-"] },
    { key: "cartesia", label: "Cartesia", keywords: ["cartesia", "sonic-"] },
    { key: "fishaudio", label: "Fish Audio", keywords: ["fish-speech", "fish-audio"] },
];

const PROVIDER_ALIASES: Record<string, ModelProvider> = {
    openai: { key: "openai", label: "OpenAI" },
    google: { key: "google", label: "Google" },
    anthropic: { key: "anthropic", label: "Anthropic" },
    deepseek: { key: "deepseek", label: "DeepSeek" },
    xai: { key: "xai", label: "xAI · Grok" },
    alibaba: { key: "alibaba", label: "Alibaba · Qwen / Wan" },
    bytedance: { key: "bytedance", label: "ByteDance · Seedream / Seedance" },
    minimax: { key: "minimax", label: "MiniMax · Hailuo" },
};

export function guessModelProvider(modelName: string, upstreamProvider?: string): ModelProvider {
    const name = modelName.trim().toLowerCase();
    const upstream = (upstreamProvider || "").trim().toLowerCase();

    if (upstream && !["system", "openai", "unknown", "default"].includes(upstream)) {
        const direct = PROVIDER_ALIASES[upstream.replace(/[^a-z0-9]/g, "")];
        if (direct) return direct;
    }

    const matched = PROVIDERS.find((provider) => provider.keywords.some((keyword) => name.includes(keyword)));
    if (matched) return { key: matched.key, label: matched.label };

    if (upstream && upstream !== "system" && upstream !== "unknown" && upstream !== "default") {
        const readable = upstreamProvider!.trim();
        return { key: `upstream:${upstream}`, label: readable };
    }
    return { key: "other", label: "Other / 其他" };
}

export function providerSortRank(provider: ModelProvider) {
    const index = PROVIDERS.findIndex((item) => item.key === provider.key);
    return index >= 0 ? index : provider.key === "other" ? 10_000 : 9_000;
}

export function modelProviderIcon(provider: ModelProvider) {
    if (provider.key === "openai") return "/icons/openai.svg";
    if (provider.key === "google") return "/icons/gemini.svg";
    if (provider.key === "anthropic") return "/icons/claude.svg";
    if (provider.key === "deepseek") return "/icons/deepseek.svg";
    if (provider.key === "xai") return "/icons/grok.svg";
    if (provider.key === "zhipu") return "/icons/glm.svg";
    return "";
}
