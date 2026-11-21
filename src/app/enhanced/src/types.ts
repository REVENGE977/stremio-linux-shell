export interface MetaData {
    name: string;
    description?: string;
    version?: string;
    author?: string;
    updateUrl?: string;
}

export interface PluginUiData {
    fileName: string;
    name: string;
    description: string;
    version: string;
    author: string;
    updateUrl?: string;
    content: string;
    enabled: boolean;
}

export interface ThemeUiData {
    fileName: string;
    name: string;
    description: string;
    version: string;
    author: string;
    updateUrl?: string;
    css: string;
    isActive?: boolean;
}

export interface ServerStatusUiData {
    exists: boolean;
    running: boolean;
    ffmpegInstalled?: boolean;
    serverDir: string;
    serverPath: string;
    currentVersion: string | null;
    skippedVersion: string | null;
}

export interface ShellPreferencesUiData {
    rememberWindowState: boolean;
    noWindowDecorations: boolean;
    nativeTitlebar: boolean;
    systemTheme: boolean;
    kdeTheme: boolean;
    isDesktopKde: boolean;
    mpvConfigLocation: string;
}

export interface EnhancedData {
    plugins: PluginUiData[];
    themes: ThemeUiData[];
    activeTheme: string | null;
    serverStatus?: ServerStatusUiData;
    clientVersion?: string;
    skippedClientVersion?: string | null;
    thumbnailPreview?: boolean;
    shellPreferences?: ShellPreferencesUiData;
}

export interface SettingSchemaItem {
    key: string;
    type?: string;
    title?: string;
    description?: string;
    defaultValue?: any;
    options?: { label: string; value: any }[];
}

export interface MarketplaceMod {
    name: string;
    description: string;
    author: string;
    version?: string;
    preview?: string;
    download: string;
    repo?: string;
}

export interface MarketplaceRegistry {
    plugins: MarketplaceMod[];
    themes: MarketplaceMod[];
}

