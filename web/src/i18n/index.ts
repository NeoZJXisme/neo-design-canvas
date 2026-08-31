import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
    },
    lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

i18n.addResourceBundle(
    "zh-CN",
    "translation",
    {
        canvas: {
            nzx: {
                open: "打开 .NZX",
                save: "保存 .NZX",
                saveAs: "另存为 .NZX",
                portableHint: "项目已关联便携 .NZX 文件；Ctrl+S 会直接写回文件",
                localHint: "当前仅自动保存到本机，建议 Ctrl+S 创建 .NZX 项目文件",
                status: { autosaved: "自动保存", modified: "已修改", saving: "保存中", saved: "已保存", error: "保存失败" },
            },
        },
    },
    true,
    true,
);

i18n.addResourceBundle(
    "en-US",
    "translation",
    {
        canvas: {
            nzx: {
                open: "Open .NZX",
                save: "Save .NZX",
                saveAs: "Save .NZX As",
                portableHint: "This project is linked to a portable .NZX file. Ctrl+S writes directly to it.",
                localHint: "Currently auto-saved locally only. Press Ctrl+S to create a portable .NZX project file.",
                status: { autosaved: "Auto-saved", modified: "Modified", saving: "Saving", saved: "Saved", error: "Save failed" },
            },
        },
    },
    true,
    true,
);

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
