import { createPluginCard } from '../components/plugin-item/pluginItem';
import { PluginUiData, EnhancedData } from '../types';
import { checkForItemUpdatesUI } from '../updates/updateManager';

let currentEnhancedData: EnhancedData = { plugins: [], themes: [], activeTheme: null };

export function updatePluginManagerData(data: EnhancedData): void {
    currentEnhancedData = data;
}

export function loadPlugin(fileName: string): void {
    const scriptId = `plugin-${fileName}`;
    if (document.getElementById(scriptId)) return;

    if (!document.body) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => loadPlugin(fileName), { once: true });
        } else {
            window.addEventListener('load', () => loadPlugin(fileName), { once: true });
        }
        return;
    }

    const pluginsList = (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0)
        ? currentEnhancedData.plugins
        : (((window as any).__INITIAL_ENHANCED_DATA__?.plugins) || []);

    const plugin = pluginsList.find((p: PluginUiData) => p.fileName === fileName);
    if (!plugin || !plugin.content) {
        console.warn('[Enhanced] Cannot load plugin, content missing for:', fileName);
        return;
    }

    const pluginBaseName = fileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
    const scopedScript = `
(function() {
    const StremioEnhancedAPI = window.__createScopedPluginAPI ? window.__createScopedPluginAPI('${pluginBaseName}') : window.StremioEnhancedAPI;
    try {
        ${plugin.content}
        console.log('[Enhanced] Plugin loaded successfully: ${fileName}');
    } catch (err) {
        console.error('[Enhanced] Plugin crashed: ${fileName}', err);
        const badScript = document.getElementById('${scriptId}');
        if (badScript) badScript.remove();
    }
})();
    `;

    const script = document.createElement('script');
    script.id = scriptId;
    script.textContent = scopedScript;
    document.body.appendChild(script);
    console.log('[Enhanced] Injected plugin script: ' + fileName);
}

export function unloadPlugin(fileName: string): void {
    const scriptId = `plugin-${fileName}`;
    const el = document.getElementById(scriptId);
    if (el) {
        el.remove();
        console.log('[Enhanced] Removed plugin script element: ' + fileName);
    }
}

export function loadEnabledPlugins(): void {
    const pluginsList = (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0)
        ? currentEnhancedData.plugins
        : (((window as any).__INITIAL_ENHANCED_DATA__?.plugins) || []);

    pluginsList.forEach((plugin: PluginUiData) => {
        if (plugin.enabled) {
            loadPlugin(plugin.fileName);
        }
    });
}

export function showReloadWarning(): void {
    if (document.getElementById('plugin-reload-warning')) return;
    const pluginsCat = document.getElementById('enhanced-plugins-category');
    if (!pluginsCat) return;

    const p = document.createElement('p');
    p.id = 'plugin-reload-warning';
    p.style.cssText = 'color: white; margin-top: 1rem; font-size: 0.95rem; line-height: 1.4;';

    p.appendChild(document.createTextNode('Reload is required to disable plugins. Click '));

    const link = document.createElement('a');
    link.style.cssText = 'color: var(--primary-accent-color, #735bf2); cursor: pointer; font-weight: bold; text-decoration: underline;';
    link.textContent = 'here';
    link.onclick = function () { location.reload(); };
    p.appendChild(link);

    p.appendChild(document.createTextNode(' to reload.'));
    pluginsCat.appendChild(p);
}

export function renderPluginsList(onTogglePlugin: (fileName: string, enabled: boolean) => void): void {
    const listContainer = document.getElementById('enhanced-plugins-list');
    if (!listContainer) return;

    const existingToggles = listContainer.querySelectorAll('.plugin-toggle');
    const expectedCount = currentEnhancedData.plugins ? currentEnhancedData.plugins.length : 0;
    if (existingToggles.length > 0 && expectedCount > 0 && existingToggles.length === expectedCount) {
        currentEnhancedData.plugins.forEach(plugin => {
            const pluginBaseName = plugin.fileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
            const schemas = (window as any).__pluginSchemas || {};
            const schema = schemas[plugin.fileName] || schemas[pluginBaseName];
            const settingsBtn = document.getElementById(`${plugin.fileName}-settings`);
            if (settingsBtn) {
                settingsBtn.style.display = (schema && Array.isArray(schema) && schema.length > 0) ? 'flex' : 'none';
            }

            const card = listContainer.querySelector(`[name="${plugin.fileName}-box"]`);
            if (card) {
                const versionEl = card.querySelector('.version-container-zdPyN');
                if (versionEl && plugin.version) {
                    versionEl.textContent = plugin.version;
                    versionEl.setAttribute('title', plugin.version);
                }
            }

            existingToggles.forEach(toggle => {
                if (toggle.getAttribute('data-plugin') === plugin.fileName) {
                    if (plugin.enabled) {
                        toggle.classList.add('checked');
                    } else {
                        toggle.classList.remove('checked');
                    }
                }
            });

            checkForItemUpdatesUI(plugin.fileName, 'plugin');
        });
        return;
    }

    listContainer.innerHTML = '';

    if (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0) {
        currentEnhancedData.plugins.forEach(plugin => {
            listContainer.appendChild(createPluginCard(plugin.fileName, plugin, !!plugin.enabled, onTogglePlugin));
            checkForItemUpdatesUI(plugin.fileName, 'plugin');
        });
    } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'color: rgba(255, 255, 255, 0.5); padding: 1rem 0; font-style: italic;';
        emptyMsg.textContent = "No plugins installed yet. Click 'Open Plugins Folder' to add plugins.";
        listContainer.appendChild(emptyMsg);
    }
}
