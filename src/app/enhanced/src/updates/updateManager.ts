import { EnhancedData, MetaData, PluginUiData, ThemeUiData } from '../types';
import { fetchRegistry } from '../marketplace/marketplaceManager';
import { modalManager } from '../components/modals/modalManager';
import { postEnhancedMessage } from '../utils/dom';

let currentEnhancedData: EnhancedData = { plugins: [], themes: [], activeTheme: null };

export function updateUpdateManagerData(data: EnhancedData): void {
    currentEnhancedData = data;
}

/**
 * Compare two semantic version strings.
 * Returns true if version1 > version2.
 */
export function isNewerVersion(version1?: string, version2?: string): boolean {
    if (!version1 || !version2) return false;
    const normalize = (v: string): number[] =>
        v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

    const v1Parts = normalize(version1);
    const v2Parts = normalize(version2);
    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
        const v1 = v1Parts[i] ?? 0;
        const v2 = v2Parts[i] ?? 0;
        if (v1 > v2) return true;
        if (v1 < v2) return false;
    }
    return false;
}

/**
 * Parse metadata block from a script/CSS file content.
 */
export function extractMetadataFromText(content: string): MetaData | null {
    const blockMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
    if (!blockMatch) return null;

    const result: Record<string, string> = {};
    const tagRegex = /@(\w+)\s+([^\n\r]+)/g;

    for (const match of blockMatch[1].matchAll(tagRegex)) {
        const rawKey = match[1];
        const rawValue = match[2];
        const keyLower = rawKey.toLowerCase();

        let key = rawKey;
        if (keyLower === 'updateurl') key = 'updateUrl';
        else if (keyLower === 'name') key = 'name';
        else if (keyLower === 'description') key = 'description';
        else if (keyLower === 'version') key = 'version';
        else if (keyLower === 'author') key = 'author';

        if (result[key] === undefined) {
            result[key] = rawValue.trim();
        }
    }

    if (!result.name || !result.version) {
        return null;
    }

    return {
        name: result.name,
        description: result.description || '',
        version: result.version || '1.0.0',
        author: result.author || 'Unknown',
        updateUrl: result.updateUrl
    };
}

export interface UpdateCheckResult {
    hasUpdate: boolean;
    newContent?: string;
    newMetaData?: MetaData;
    installedMetaData?: PluginUiData | ThemeUiData | MetaData;
    registryVersion?: string | null;
    updateUrl?: string;
}

/**
 * Retrieve version of plugin or theme in the community marketplace registry.
 */
export async function getRegistryModVersion(
    itemFile: string,
    type: 'plugin' | 'theme'
): Promise<{ version: string; download: string } | null> {
    try {
        const registry = await fetchRegistry();
        const list = type === 'plugin' ? registry.plugins : registry.themes;
        const fnLower = itemFile.toLowerCase();
        const baseName = fnLower.replace(/\.plugin\.js$/, '').replace(/\.theme\.css$/, '').replace(/\.js$/, '');

        const found = list.find(m => {
            const dl = (m.download || '').toLowerCase();
            return dl.endsWith(fnLower) || dl.includes(`/${baseName}.`);
        });

        if (found && found.version && found.download) {
            return { version: found.version, download: found.download };
        }
    } catch (err) {
        console.warn('[Enhanced Update] Failed to check registry version:', err);
    }
    return null;
}

/**
 * Check if a plugin or theme has an update available.
 */
export async function checkUpdateData(
    itemFile: string,
    type: 'plugin' | 'theme'
): Promise<UpdateCheckResult | null> {
    const plugins = (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0)
        ? currentEnhancedData.plugins
        : (((window as any).__INITIAL_ENHANCED_DATA__?.plugins) || []);
    const themes = (currentEnhancedData.themes && currentEnhancedData.themes.length > 0)
        ? currentEnhancedData.themes
        : (((window as any).__INITIAL_ENHANCED_DATA__?.themes) || []);
    const list = type === 'plugin' ? plugins : themes;
    const installed = list.find(i => (i.fileName || '').toLowerCase() === itemFile.toLowerCase());
    if (!installed) return null;

    // Determine installed version and update URL
    let installedVersion = installed.version || '1.0.0';
    let updateUrl = (installed as any).updateUrl || (installed as any).update_url;

    const content = type === 'plugin' ? (installed as PluginUiData).content : (installed as ThemeUiData).css;
    if ((!updateUrl || updateUrl === 'none') && content) {
        const parsed = extractMetadataFromText(content);
        if (parsed?.updateUrl && parsed.updateUrl !== 'none') {
            updateUrl = parsed.updateUrl;
        }
        if (parsed?.version) {
            installedVersion = parsed.version;
        }
    }

    // 1. Try checking the direct updateUrl
    if (updateUrl && updateUrl !== 'none') {
        try {
            console.log(`[Enhanced Update] Checking updateUrl for ${itemFile}: ${updateUrl}`);
            const res = await fetch(updateUrl);
            if (res.ok) {
                const responseText = await res.text();
                const newMeta = extractMetadataFromText(responseText);

                if (newMeta && newMeta.version && isNewerVersion(newMeta.version, installedVersion)) {
                    console.log(`[Enhanced Update] Found newer version for ${itemFile}: ${installedVersion} -> ${newMeta.version}`);
                    const regInfo = await getRegistryModVersion(itemFile, type);
                    return {
                        hasUpdate: true,
                        newContent: responseText,
                        newMetaData: newMeta,
                        installedMetaData: installed,
                        registryVersion: regInfo?.version || null,
                        updateUrl
                    };
                }

                // If the updateUrl returned a raw version number (e.g. "0.1.6")
                const trimmed = responseText.trim();
                if (/^v?\d+(\.\d+)+$/.test(trimmed) && isNewerVersion(trimmed, installedVersion)) {
                    console.log(`[Enhanced Update] Found newer version text for ${itemFile}: ${installedVersion} -> ${trimmed}`);
                    const regInfo = await getRegistryModVersion(itemFile, type);
                    if (regInfo?.download) {
                        const dlRes = await fetch(regInfo.download);
                        if (dlRes.ok) {
                            const newContent = await dlRes.text();
                            const newMeta = extractMetadataFromText(newContent) || {
                                name: installed.name,
                                version: trimmed,
                                description: installed.description,
                                author: installed.author
                            };
                            return {
                                hasUpdate: true,
                                newContent,
                                newMetaData: newMeta,
                                installedMetaData: installed,
                                registryVersion: regInfo.version,
                                updateUrl: regInfo.download
                            };
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`[Enhanced Update] Error checking updateUrl for ${itemFile}:`, err);
        }
    }

    // 2. Fallback: check community marketplace registry
    try {
        const regInfo = await getRegistryModVersion(itemFile, type);
        if (regInfo && isNewerVersion(regInfo.version, installedVersion)) {
            console.log(`[Enhanced Update] Found newer version in registry for ${itemFile}: ${installedVersion} -> ${regInfo.version}`);
            const dlRes = await fetch(regInfo.download);
            if (dlRes.ok) {
                const newContent = await dlRes.text();
                const newMeta = extractMetadataFromText(newContent) || {
                    name: installed.name,
                    version: regInfo.version,
                    description: installed.description,
                    author: installed.author
                };
                return {
                    hasUpdate: true,
                    newContent,
                    newMetaData: newMeta,
                    installedMetaData: installed,
                    registryVersion: regInfo.version,
                    updateUrl: regInfo.download
                };
            }
        }
    } catch (err) {
        console.warn(`[Enhanced Update] Error checking registry for ${itemFile}:`, err);
    }

    return { hasUpdate: false, installedMetaData: installed };
}

const inFlightChecks = new Set<string>();

/**
 * Check updates for a single item and update its UI button if an update is found.
 */
export async function checkForItemUpdatesUI(
    itemFile: string,
    type: 'plugin' | 'theme'
): Promise<boolean> {
    const updateButton = document.getElementById(`${itemFile}-update`);
    if (!updateButton) return false;

    if (inFlightChecks.has(itemFile)) return false;
    inFlightChecks.add(itemFile);

    try {
        const updateData = await checkUpdateData(itemFile, type);
        if (!updateData || !updateData.hasUpdate || !updateData.newContent || !updateData.newMetaData) {
            updateButton.style.display = 'none';
            return false;
        }

        // Show the update button
        updateButton.style.display = 'inline-flex';
        updateButton.setAttribute('title', `Update available: v${updateData.newMetaData.version}`);
        const label = updateButton.querySelector('.label-OnWh2') || updateButton;
        label.textContent = `Update (v${updateData.newMetaData.version})`;

        updateButton.onclick = async (e) => {
            e.stopPropagation();

            // Warn about non-registry updates for plugins
            if (type === 'plugin' && updateData.registryVersion !== updateData.newMetaData!.version) {
                const result = await modalManager.showAlert(
                    'warning',
                    'Confirm Update',
                    `This update for ${updateData.installedMetaData?.name || itemFile} (v${updateData.newMetaData!.version}) isn't submitted to the registry (Community Marketplace) yet, and thus has not been confirmed safe.\n\nAre you sure you want to update? It's recommended to read the source code of the update before updating.`,
                    ['Yes', 'No', 'View Source Code']
                );

                if (result === 0) {
                    await applyUpdate(type, itemFile, updateData.newContent!, updateData.newMetaData!);
                } else if (result === 2 && updateData.updateUrl) {
                    try { window.open(updateData.updateUrl, '_blank'); } catch (_) {}
                }
            } else {
                await applyUpdate(type, itemFile, updateData.newContent!, updateData.newMetaData!);
            }
        };

        return true;
    } catch (err) {
        console.error(`[Enhanced Update] Error updating UI for ${itemFile}:`, err);
        return false;
    } finally {
        inFlightChecks.delete(itemFile);
    }
}

/**
 * Apply the update by sending installMod to Rust and updating the UI.
 */
export async function applyUpdate(
    type: 'plugin' | 'theme',
    itemFile: string,
    newContent: string,
    newMetaData: MetaData
): Promise<void> {
    const updateButton = document.getElementById(`${itemFile}-update`);
    const label = updateButton?.querySelector('.label-OnWh2') || updateButton;
    if (label) label.textContent = 'Updating...';
    if (updateButton) updateButton.style.pointerEvents = 'none';

    try {
        postEnhancedMessage('installMod', {
            modType: type,
            fileName: itemFile,
            content: newContent
        });

        if (updateButton) {
            updateButton.style.display = 'none';
            updateButton.style.pointerEvents = '';
        }

        // Update card in DOM immediately
        const card = document.querySelector(`[name="${itemFile}-box"]`);
        if (card) {
            const versionEl = card.querySelector('.version-container-zdPyN');
            if (versionEl && newMetaData.version) {
                versionEl.textContent = newMetaData.version;
                versionEl.setAttribute('title', newMetaData.version);
            }
        }

        if (type === 'theme') {
            const currentActive = currentEnhancedData.activeTheme ? currentEnhancedData.activeTheme.toLowerCase() : null;
            if (currentActive === itemFile.toLowerCase()) {
                (window as any).StremioEnhancedAPI?.applyTheme(itemFile);
            }
        }

        modalManager.showToast(
            'update-success',
            'Update Successful',
            `Updated ${newMetaData.name || itemFile} to v${newMetaData.version || ''}${type === 'plugin' ? '. Reload may be required for some plugin changes.' : ''}`,
            'success'
        );
    } catch (err: any) {
        console.error(`[Enhanced Update] Failed to apply update for ${itemFile}:`, err);
        if (label) label.textContent = 'Update';
        if (updateButton) updateButton.style.pointerEvents = '';
        alert(`Failed to update ${itemFile}: ${err?.message || err}`);
    }
}

/**
 * Scan all installed plugins and themes for updates.
 */
export async function checkForAllUpdates(isManual = false): Promise<void> {
    if (isManual) {
        modalManager.showToast(
            'check-updates-progress',
            'Checking for Updates',
            'Checking for plugin and theme updates...',
            'info'
        );
    }

    const checkBtn = document.getElementById('checkforupdatesBtn');
    if (checkBtn) {
        checkBtn.style.pointerEvents = 'none';
        checkBtn.textContent = 'Checking...';
    }

    let updateCount = 0;

    try {
        const plugins = (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0)
            ? currentEnhancedData.plugins
            : (((window as any).__INITIAL_ENHANCED_DATA__?.plugins) || []);

        for (const p of plugins) {
            const hasUp = await checkForItemUpdatesUI(p.fileName, 'plugin');
            if (hasUp) updateCount++;
        }

        const themes = (currentEnhancedData.themes && currentEnhancedData.themes.length > 0)
            ? currentEnhancedData.themes
            : (((window as any).__INITIAL_ENHANCED_DATA__?.themes) || []);

        for (const t of themes) {
            const hasUp = await checkForItemUpdatesUI(t.fileName, 'theme');
            if (hasUp) updateCount++;
        }

        if (isManual) {
            if (updateCount > 0) {
                modalManager.showToast(
                    'check-updates-result',
                    'Updates Available',
                    `Found ${updateCount} update(s). Look for the yellow Update buttons.`,
                    'success'
                );
            } else {
                modalManager.showToast(
                    'check-updates-result',
                    'Up to Date',
                    'All installed plugins and themes are up to date.',
                    'info'
                );
            }
        }
    } finally {
        if (checkBtn) {
            checkBtn.style.pointerEvents = '';
            checkBtn.textContent = 'Check for Updates';
        }
    }
}
