import pluginItemTemplate from './plugin-item.html';
import { TemplateCache } from '../../utils/templateCache';
import { escapeHtml, postEnhancedMessage } from '../../utils/dom';
import { PluginUiData, MetaData } from '../../types';
import { modalManager } from '../modals/modalManager';
import { unloadPlugin, showReloadWarning } from '../../plugins/pluginManager';

export function createPluginCard(
    fileName: string,
    meta: PluginUiData | MetaData,
    isEnabled: boolean,
    onToggle: (fileName: string, enabled: boolean) => void
): HTMLElement {
    const checkedClass = isEnabled ? 'checked' : '';
    const pluginBaseName = fileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
    const pluginDisplayName = (meta && meta.name && meta.name.trim().length > 0) ? meta.name.trim() : pluginBaseName;

    const schemas = (window as any).__pluginSchemas || {};
    const schema = schemas[fileName] || schemas[pluginBaseName] || null;
    const settingsDisplay = (schema && Array.isArray(schema) && schema.length > 0) ? 'flex' : 'none';

    const descriptionBlock = meta.description ? `<b>Description:</b> ${escapeHtml(meta.description)}<br>` : '';
    const authorBlock = meta.author ? `<b>Author:</b> ${escapeHtml(meta.author)}` : '';

    const html = TemplateCache.render(pluginItemTemplate, {
        fileName: escapeHtml(fileName),
        name: escapeHtml(meta.name),
        version: escapeHtml(meta.version || ''),
        descriptionBlock,
        authorBlock,
        checkedClass,
        settingsDisplay
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const card = wrapper.firstElementChild as HTMLElement;

    const toggle = card.querySelector<HTMLElement>('.plugin-toggle');
    if (toggle) {
        toggle.onclick = function () {
            toggle.classList.toggle('checked');
            const newEnabled = toggle.classList.contains('checked');
            onToggle(fileName, newEnabled);
        };
    }

    const settingsBtn = card.querySelector<HTMLElement>('.plugin-settings-btn');
    if (settingsBtn) {
        settingsBtn.onclick = async function (e) {
            e.stopPropagation();
            const activeSchema = (window as any).__pluginSchemas?.[fileName] ||
                                 (window as any).__pluginSchemas?.[pluginBaseName];
            if (!activeSchema || !Array.isArray(activeSchema)) return;

            const currentValues: Record<string, any> = {};
            for (const item of activeSchema) {
                const storageKey = `plugin_setting:${pluginBaseName}:${item.key}`;
                const rawVal = localStorage.getItem(storageKey);
                if (rawVal !== null && rawVal !== undefined) {
                    try {
                        currentValues[item.key] = JSON.parse(rawVal);
                    } catch (_) {
                        currentValues[item.key] = rawVal;
                    }
                } else {
                    currentValues[item.key] = item.defaultValue;
                }
            }

            modalManager.openPluginSettingsModal(fileName, pluginDisplayName, activeSchema, currentValues, (newValues) => {
                for (const [key, val] of Object.entries(newValues)) {
                    const storageKey = `plugin_setting:${pluginBaseName}:${key}`;
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(val));
                    } catch (_) {
                        localStorage.setItem(storageKey, String(val));
                    }
                }

                // Notify plugin listeners
                const listeners = (window as any).__pluginSettingListeners?.[fileName] ||
                                  (window as any).__pluginSettingListeners?.[pluginBaseName] || [];
                listeners.forEach((cb: (evt: Record<string, any>) => void) => {
                    try { cb(newValues); } catch (err) { console.error('[Enhanced] Error in onSettingsSaved:', err); }
                });
            });
        };
    }

    const deleteBtn = card.querySelector<HTMLElement>('.plugin-delete-btn');
    if (deleteBtn) {
        const handleDelete = async (e: Event) => {
            e.stopPropagation();
            const result = await modalManager.showAlert(
                'danger',
                'Delete Plugin',
                `Are you sure you want to delete "${pluginDisplayName}" (${fileName})?\n\nThis will permanently remove the plugin file from your plugins folder.`,
                ['Delete', 'Cancel']
            );
            if (result !== 0) return;

            const wasEnabled = toggle?.classList.contains('checked') ?? isEnabled;
            unloadPlugin(fileName);
            (window as any).StremioEnhancedAPI?.clearRegisteredSettings?.(fileName);
            if (wasEnabled) {
                showReloadWarning();
            }

            postEnhancedMessage('deleteMod', {
                modType: 'plugin',
                fileName
            });

            card.remove();
            modalManager.showToast(
                'plugin-deleted',
                'Plugin Deleted',
                `Deleted ${pluginDisplayName}.`,
                'info'
            );
        };

        deleteBtn.onclick = handleDelete;
        deleteBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleDelete(e);
            }
        });
    }

    return card;
}
