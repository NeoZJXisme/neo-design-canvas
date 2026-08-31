import { App, Button, Drawer, Input, InputNumber, Segmented, Select, Space } from "antd";
import { ListPlus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { pingChannel } from "@/services/api/channel-api";
import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel, type ModelPriceUnit, type PriceCurrency } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type PingResult = { latency: number; modelCount: number } | null;

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [testing, setTesting] = useState(false);
    const [pingResult, setPingResult] = useState<PingResult>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));
    const priceUnitOptions: Array<{ label: string; value: ModelPriceUnit }> = ["per_call", "per_output", "per_second"].map((value) => ({ label: t(`config.channelEditor.priceUnits.${value}`), value: value as ModelPriceUnit }));
    const currencyOptions: Array<{ label: string; value: PriceCurrency }> = (["USD", "CNY"] as const).map((value) => ({ label: value, value }));

    useEffect(() => {
        if (open && channel) {
            setDraft(channel);
            setPingResult(null);
        }
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => {
        setPingResult(null);
        setDraft((current) => (current ? { ...current, ...value } : current));
    };
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setPricing = (name: string, patch: Pick<ChannelModel, "unitPrice" | "priceUnit">) => setModels(draft.models.map((model) => (model.name === name ? { ...model, ...patch } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const testConnection = async () => {
        if (!draft.baseUrl.trim()) {
            message.error(t("apiErrors.baseUrlRequired"));
            return;
        }
        if (!draft.apiKey.trim()) {
            message.error(t("apiErrors.apiKeyRequired"));
            return;
        }
        setTesting(true);
        setPingResult(null);
        try {
            const result = await pingChannel(draft);
            setPingResult({ latency: result.latency, modelCount: result.models.length });
            message.success(`API OK · ${result.latency} ms · ${result.models.length} models`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "API connection failed");
        } finally {
            setTesting(false);
        }
    };

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.provider")}</span>
                    <Input value={draft.provider || ""} onChange={(event) => patch({ provider: event.target.value })} placeholder={t("config.channelEditor.providerPlaceholder")} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.currency")}</span>
                    <Select className="w-full" value={draft.currency || "USD"} options={currencyOptions} onChange={(currency) => patch({ currency })} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/30">
                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={testing} onClick={() => void testConnection()}>
                    Ping API
                </Button>
                <span className="text-xs text-stone-500">
                    {pingResult ? `Connected · ${pingResult.latency} ms · ${pingResult.modelCount} models` : "Test Base URL + API Key before adding models"}
                </span>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <InputNumber size="small" className="w-24" min={0} precision={6} value={model.unitPrice} placeholder={t("config.channelEditor.unitPrice")} onChange={(unitPrice) => setPricing(model.name, { unitPrice: unitPrice && unitPrice > 0 ? unitPrice : undefined, priceUnit: model.priceUnit || "per_call" })} />
                                <Select size="small" className="w-28" value={model.priceUnit || "per_call"} options={priceUnitOptions} onChange={(priceUnit) => setPricing(model.name, { unitPrice: model.unitPrice, priceUnit })} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
