import { postEnhancedMessage } from '../utils/dom';
import { EnhancedData, SettingSchemaItem } from '../types';
import { applyThemeUI } from '../themes/themeManager';
import { loadPlugin, unloadPlugin, showReloadWarning } from '../plugins/pluginManager';
import { modalManager } from '../components/modals/modalManager';
import { openStreamingServerFolder, checkServerJsUpdateAndSetup, getServerStatus, startStreamingServer, reloadToLocalStreamingServer } from '../server/serverManager';

let currentEnhancedData: EnhancedData = { plugins: [], themes: [], activeTheme: null };

export function updateApiData(data: EnhancedData): void {
    currentEnhancedData = data;
}

export function syncLocalStorage(): void {
    try {
        const installedPlugins = (currentEnhancedData.plugins || []).map(p => p.fileName);
        localStorage.setItem('installedPlugins', JSON.stringify(installedPlugins));

        const enabledPluginsList: string[] = [];
        (currentEnhancedData.plugins || []).forEach(p => {
            if (p.enabled) {
                enabledPluginsList.push(p.fileName);
                const baseName = p.fileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
                if (baseName && !enabledPluginsList.includes(baseName)) {
                    enabledPluginsList.push(baseName);
                }
            }
        });
        localStorage.setItem('enabledPlugins', JSON.stringify(enabledPluginsList));

        if (currentEnhancedData.activeTheme) {
            localStorage.setItem('currentTheme', currentEnhancedData.activeTheme);
        } else {
            localStorage.setItem('currentTheme', 'Default');
        }
    } catch (_) {}
}

export function setupEnhancedApi(): void {
    (window as any).__pluginSchemas = (window as any).__pluginSchemas || {};
    (window as any).__pluginSettingListeners = (window as any).__pluginSettingListeners || {};

    // Helper to get normalized plugin key
    function getPluginBaseName(name: string): string {
        return name ? name.replace(/\.plugin\.js$/, '').replace(/\.js$/, '') : 'global';
    }

    async function internalGetSetting(pluginName: string, key: string): Promise<any> {
        const baseName = getPluginBaseName(pluginName);
        const storageKey = `plugin_setting:${baseName}:${key}`;
        const val = localStorage.getItem(storageKey);
        if (val === null || val === undefined) {
            const schema = (window as any).__pluginSchemas[baseName] ||
                           (window as any).__pluginSchemas[pluginName];
            if (schema && Array.isArray(schema)) {
                const opt = schema.find((s: SettingSchemaItem) => s.key === key);
                if (opt && opt.defaultValue !== undefined) return opt.defaultValue;
            }
            return null;
        }
        try {
            return JSON.parse(val);
        } catch (_) {
            return val;
        }
    }

    async function internalGetSettings(pluginName: string): Promise<Record<string, any>> {
        const baseName = getPluginBaseName(pluginName);
        const schema = (window as any).__pluginSchemas[baseName] ||
                       (window as any).__pluginSchemas[pluginName] || [];
        const result: Record<string, any> = {};
        for (const item of schema) {
            result[item.key] = await internalGetSetting(baseName, item.key);
        }
        return result;
    }

    async function internalSaveSetting(pluginName: string, key: string, value: any): Promise<boolean> {
        const baseName = getPluginBaseName(pluginName);
        const storageKey = `plugin_setting:${baseName}:${key}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(value));
        } catch (e) {
            localStorage.setItem(storageKey, String(value));
        }

        const notifyPayload = { [key]: value };
        const listeners = (window as any).__pluginSettingListeners[baseName] ||
                          (window as any).__pluginSettingListeners[pluginName] || [];
        listeners.forEach((cb: (evt: Record<string, any>) => void) => {
            try { cb(notifyPayload); } catch (err) { console.error('[Enhanced] Error in onSettingsSaved:', err); }
        });
        return true;
    }

    function internalRegisterSettings(pluginName: string, schema: SettingSchemaItem[]): Promise<boolean> {
        if (!Array.isArray(schema)) {
            console.error('[Enhanced] Invalid settings schema provided for:', pluginName);
            return Promise.reject(new Error('Invalid settings schema. Expected array.'));
        }
        const baseName = getPluginBaseName(pluginName);
        (window as any).__pluginSchemas[baseName] = schema;
        (window as any).__pluginSchemas[pluginName] = schema;
        console.log(`[Enhanced] Registered settings schema for ${baseName}:`, schema);

        // Show gear button in DOM if plugin card is present
        const optBtn = document.getElementById(`${baseName}.plugin.js-settings`) ||
                       document.getElementById(`${baseName}-settings`) ||
                       document.getElementById(`${pluginName}-settings`);
        if (optBtn) optBtn.style.display = 'flex';
        return Promise.resolve(true);
    }

    // Scoped API provided to each plugin
    (window as any).__createScopedPluginAPI = function (pluginBaseName: string) {
        return {
            logger: {
                info: function (message: any) {
                    console.log(`[${pluginBaseName}]`, message);
                },
                warn: function (message: any) {
                    console.warn(`[${pluginBaseName}]`, message);
                },
                error: function (message: any) {
                    console.error(`[${pluginBaseName}]`, message);
                }
            },
            getSetting: async function (key: string) {
                return internalGetSetting(pluginBaseName, key);
            },
            getSettings: async function () {
                return internalGetSettings(pluginBaseName);
            },
            saveSetting: async function (key: string, value: any) {
                return internalSaveSetting(pluginBaseName, key, value);
            },
            registerSettings: async function (schema: SettingSchemaItem[]) {
                return internalRegisterSettings(pluginBaseName, schema);
            },
            getRegisteredSettings: function () {
                return (window as any).__pluginSchemas[pluginBaseName] || null;
            },
            clearRegisteredSettings: function () {
                delete (window as any).__pluginSchemas[pluginBaseName];
                return true;
            },
            onSettingsSaved: function (callback: (evt: Record<string, any>) => void) {
                if (!(window as any).__pluginSettingListeners[pluginBaseName]) {
                    (window as any).__pluginSettingListeners[pluginBaseName] = [];
                }
                (window as any).__pluginSettingListeners[pluginBaseName].push(callback);
            },
            showAlert: function (alertType: string, title: string, message: string, buttons?: string[]) {
                return modalManager.showAlert(alertType, title, message, buttons);
            },
            showPrompt: function (promptIdOrTitle: string, titleOrMsg?: string, messageOrDefault?: string, defaultValue?: string) {
                if (defaultValue !== undefined) {
                    return modalManager.showPrompt(promptIdOrTitle, titleOrMsg || '', messageOrDefault || '', defaultValue);
                } else if (messageOrDefault !== undefined) {
                    return modalManager.showPrompt(pluginBaseName, promptIdOrTitle, titleOrMsg || '', messageOrDefault);
                }
                return modalManager.showPrompt(pluginBaseName, promptIdOrTitle, titleOrMsg || '', '');
            },
            showToast: function (id: string, title: string, message: string, status?: 'success' | 'fail' | 'info') {
                modalManager.showToast(id, title, message, status);
            },
            toast: function (id: string, title: string, message: string, status?: 'success' | 'fail' | 'info') {
                modalManager.showToast(id, title, message, status);
            }
        };
    };

    // Global StremioEnhancedAPI matching stremio-enhanced
    (window as any).StremioEnhancedAPI = {
        openThemesFolder: function () {
            postEnhancedMessage('openThemesFolder');
        },
        openPluginsFolder: function () {
            postEnhancedMessage('openPluginsFolder');
        },
        openStreamingServerFolder: function () {
            openStreamingServerFolder();
        },
        checkServerUpdates: function () {
            return checkServerJsUpdateAndSetup(true);
        },
        getServerStatus: function () {
            return getServerStatus();
        },
        startStreamingServer: function () {
            return startStreamingServer();
        },
        reloadToLocalStreamingServer: function () {
            reloadToLocalStreamingServer();
        },
        applyTheme: function (fileName: string) {
            applyThemeUI(fileName);
            postEnhancedMessage('applyTheme', { fileName: fileName });
        },
        togglePlugin: function (fileName: string, enabled: boolean) {
            const plugin = (currentEnhancedData.plugins || []).find(p => p.fileName === fileName);
            if (plugin) {
                plugin.enabled = enabled;
            }
            if (enabled) {
                loadPlugin(fileName);
            } else {
                unloadPlugin(fileName);
                showReloadWarning();
            }

            // Immediately update enabledPlugins array in localStorage
            let enabledPlugins: string[] = [];
            try {
                const raw = localStorage.getItem('enabledPlugins');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) enabledPlugins = parsed;
                }
            } catch (_) {}

            const baseName = fileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
            if (enabled) {
                if (!enabledPlugins.includes(fileName)) enabledPlugins.push(fileName);
                if (baseName && !enabledPlugins.includes(baseName)) enabledPlugins.push(baseName);
            } else {
                enabledPlugins = enabledPlugins.filter(name => name !== fileName && name !== baseName);
            }
            localStorage.setItem('enabledPlugins', JSON.stringify(enabledPlugins));

            syncLocalStorage();
            postEnhancedMessage('togglePlugin', { fileName: fileName, enabled: enabled });
        },
        refresh: function () {
            postEnhancedMessage('getData');
        },

        // Logger methods (supports both StremioEnhancedAPI.info(msg) and StremioEnhancedAPI.info(pluginName, msg))
        logger: {
            info: (pluginNameOrMsg: any, maybeMsg?: any) => {
                if (maybeMsg !== undefined) console.log(`[${pluginNameOrMsg}]`, maybeMsg);
                else console.log('[Plugin]', pluginNameOrMsg);
            },
            warn: (pluginNameOrMsg: any, maybeMsg?: any) => {
                if (maybeMsg !== undefined) console.warn(`[${pluginNameOrMsg}]`, maybeMsg);
                else console.warn('[Plugin]', pluginNameOrMsg);
            },
            error: (pluginNameOrMsg: any, maybeMsg?: any) => {
                if (maybeMsg !== undefined) console.error(`[${pluginNameOrMsg}]`, maybeMsg);
                else console.error('[Plugin]', pluginNameOrMsg);
            }
        },
        info: (pluginName: string, message: string) => console.log(`[${pluginName}]`, message),
        warn: (pluginName: string, message: string) => console.warn(`[${pluginName}]`, message),
        error: (pluginName: string, message: string) => console.error(`[${pluginName}]`, message),

        // Settings API methods
        getSetting: async (pluginOrKey: string, maybeKey?: string) => {
            if (maybeKey !== undefined) {
                return internalGetSetting(pluginOrKey, maybeKey);
            }
            return internalGetSetting('global', pluginOrKey);
        },
        getSettings: async (pluginName: string) => {
            return internalGetSettings(pluginName);
        },
        saveSetting: async (pluginOrKey: string, keyOrVal: any, maybeVal?: any) => {
            if (maybeVal !== undefined) {
                return internalSaveSetting(pluginOrKey, keyOrVal, maybeVal);
            }
            return internalSaveSetting('global', pluginOrKey, keyOrVal);
        },
        registerSettings: async (pluginOrSchema: any, maybeSchema?: any) => {
            if (maybeSchema !== undefined) {
                return internalRegisterSettings(pluginOrSchema, maybeSchema);
            }
            return internalRegisterSettings('global', pluginOrSchema);
        },
        getRegisteredSettings: (pluginFileName: string) => {
            const baseName = getPluginBaseName(pluginFileName);
            return (window as any).__pluginSchemas[baseName] ||
                   (window as any).__pluginSchemas[pluginFileName] || null;
        },
        clearRegisteredSettings: (pluginFileName: string) => {
            const baseName = getPluginBaseName(pluginFileName);
            delete (window as any).__pluginSchemas[baseName];
            delete (window as any).__pluginSchemas[pluginFileName];
            return true;
        },
        onSettingsSaved: (pluginOrCallback: any, maybeCallback?: any) => {
            const plugin = typeof pluginOrCallback === 'string' ? pluginOrCallback : 'global';
            const baseName = getPluginBaseName(plugin);
            const cb = typeof pluginOrCallback === 'function' ? pluginOrCallback : maybeCallback;
            if (!(window as any).__pluginSettingListeners[baseName]) {
                (window as any).__pluginSettingListeners[baseName] = [];
            }
            (window as any).__pluginSettingListeners[baseName].push(cb);
        },

        // Alert, Prompt, and Toast Modal APIs
        showAlert: async (alertType: string, title: string, message: string, buttons?: string[]) => {
            return modalManager.showAlert(alertType, title, message, buttons);
        },
        showPrompt: async (promptId: string, title: string, message: string, defaultValue?: string) => {
            return modalManager.showPrompt(promptId, title, message, defaultValue);
        },
        showToast: (id: string, title: string, message: string, status?: 'success' | 'fail' | 'info') => {
            modalManager.showToast(id, title, message, status);
        },
        toast: (id: string, title: string, message: string, status?: 'success' | 'fail' | 'info') => {
            modalManager.showToast(id, title, message, status);
        }
    };
}
