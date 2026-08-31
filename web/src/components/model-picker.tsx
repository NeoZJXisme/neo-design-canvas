import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { guessModelProvider, modelProviderIcon, providerSortRank, type ModelProvider } from "@/lib/model-taxonomy";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

type ProviderGroup = {
    provider: ModelProvider;
    models: string[];
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const groups = useMemo(() => groupModelsByProvider(options), [options]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-[28rem] max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {groups.length ? (
                    groups.map((group) => (
                        <SelectGroup key={group.provider.key}>
                            <SelectLabel className="sticky top-0 z-10 flex items-center gap-2 rounded-md bg-popover/95 px-2 py-1.5 font-medium backdrop-blur">
                                <ProviderIcon provider={group.provider} />
                                <span>{group.provider.label}</span>
                                <span className="ml-auto text-[10px] font-normal text-muted-foreground">{group.models.length}</span>
                            </SelectLabel>
                            {group.models.map((model) => (
                                <SelectItem key={model} value={model} textValue={`${group.provider.label} ${modelOptionLabel(config, model)}`}>
                                    <ModelLabel config={config} model={model} />
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function groupModelsByProvider(models: string[]): ProviderGroup[] {
    const map = new Map<string, ProviderGroup>();
    for (const model of models) {
        const provider = guessModelProvider(modelOptionName(model));
        const existing = map.get(provider.key);
        if (existing) existing.models.push(model);
        else map.set(provider.key, { provider, models: [model] });
    }
    return Array.from(map.values())
        .map((group) => ({ ...group, models: group.models.sort((a, b) => modelOptionName(a).localeCompare(modelOptionName(b))) }))
        .sort((a, b) => providerSortRank(a.provider) - providerSortRank(b.provider) || a.provider.label.localeCompare(b.provider.label));
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ProviderIcon({ provider }: { provider: ModelProvider }) {
    const icon = modelProviderIcon(provider);
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function ModelIcon({ model }: { model: string }) {
    const provider = guessModelProvider(modelOptionName(model));
    return <ProviderIcon provider={provider} />;
}
