export {};

type NeoNzxPayload = {
    path: string;
    fileName: string;
    bytes: Uint8Array | ArrayBuffer;
};

type NeoNzxSaveResult = {
    canceled: boolean;
    path?: string;
    fileName?: string;
};

declare global {
    interface Window {
        neoDesktop?: {
            isDesktop: true;
            saveNzx: (payload: { bytes: Uint8Array | ArrayBuffer; suggestedName: string; path?: string; saveAs?: boolean }) => Promise<NeoNzxSaveResult>;
            openNzxDialog: () => Promise<NeoNzxPayload | null>;
            takePendingNzx: () => Promise<NeoNzxPayload | null>;
            onOpenNzx: (listener: (payload: NeoNzxPayload) => void) => () => void;
            clearNzxPath: () => Promise<boolean>;
        };
    }
}
