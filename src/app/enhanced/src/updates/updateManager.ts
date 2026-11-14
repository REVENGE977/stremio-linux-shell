import { EnhancedData, MetaData, PluginUiData, ThemeUiData } from '../types';
import { fetchRegistry } from '../marketplace/marketplaceManager';
import { modalManager } from '../components/modals/modalManager';
import { postEnhancedMessage } from '../utils/dom';

let currentEnhancedData: EnhancedData = { plugins: [], themes: [], activeTheme: null };

export const DEFAULT_CLIENT_VERSION = '1.2.2-enhanced.3';
export const CLIENT_RELEASES_URL = 'https://github.com/REVENGE977/stremio-linux-shell/releases/latest';

const CLIENT_VERSION_SOURCES: { url: string; releaseUrl: string }[] = [
    {
        url: 'https://raw.githubusercontent.com/REVENGE977/stremio-linux-shell/refs/heads/main/Cargo.toml',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell/releases/latest'
    },
    {
        url: 'https://raw.githubusercontent.com/REVENGE977/stremio-linux-shell/refs/heads/main/VERSION',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell/releases/latest'
    },
    {
        url: 'https://raw.githubusercontent.com/REVENGE977/stremio-linux-shell-enhanced/refs/heads/main/Cargo.toml',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell-enhanced/releases/latest'
    },
    {
        url: 'https://raw.githubusercontent.com/REVENGE977/stremio-linux-shell-enhanced/refs/heads/main/VERSION',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell-enhanced/releases/latest'
    }
];

const CLIENT_RELEASE_SOURCES: { apiUrl: string; releaseUrl: string }[] = [
    {
        apiUrl: 'https://api.github.com/repos/REVENGE977/stremio-linux-shell/releases/latest',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell/releases/latest'
    },
    {
        apiUrl: 'https://api.github.com/repos/REVENGE977/stremio-linux-shell-enhanced/releases/latest',
        releaseUrl: 'https://github.com/REVENGE977/stremio-linux-shell-enhanced/releases/latest'
    }
];

let latestClientVersionCache: { version: string; releaseUrl: string } | null = null;
let clientUpdateCheckInProgress = false;

export function updateUpdateManagerData(data: EnhancedData): void {
    currentEnhancedData = data;
}

export function getCurrentClientVersion(): string {
    return (
        currentEnhancedData.clientVersion ||
        (window as any).__INITIAL_ENHANCED_DATA__?.clientVersion ||
        DEFAULT_CLIENT_VERSION
    );
}

export function getLatestClientVersion(): { version: string; releaseUrl: string } | null {
    return latestClientVersionCache;
}

/**
 * Parse a two-part client version string (e.g. "1.2.2-enhanced.3") into
 * numeric base version segments ([1, 2, 2]) and enhanced build segments ([3]).
 */
export function parseClientVersion(version: string): { base: number[]; enhanced: number[] } {
    const cleaned = version.trim().replace(/^v/i, '');
    const [basePart, ...rest] = cleaned.split(/-enhanced\.?/i);
    const base = (basePart || '')
        .split('-')[0]
        .split('.')
        .map(n => parseInt(n, 10) || 0);

    let enhanced: number[] = [0];
    if (rest.length > 0 && rest[0]) {
        enhanced = rest[0]
            .split('.')
            .map(n => parseInt(n, 10) || 0);
    } else {
        const dashMatch = cleaned.match(/-(\d+(?:\.\d+)*)$/);
        if (dashMatch && dashMatch[1]) {
            enhanced = dashMatch[1].split('.').map(n => parseInt(n, 10) || 0);
        }
    }

    return { base, enhanced };
}

/**
 * Compare two semantic / two-part Enhanced version strings (e.g. "1.2.2-enhanced.3").
 * Returns true if version1 > version2.
 */
export function isNewerVersion(version1?: string, version2?: string): boolean {
    if (!version1 || !version2) return false;
    const v1 = parseClientVersion(version1);
    const v2 = parseClientVersion(version2);

    const maxBaseLength = Math.max(v1.base.length, v2.base.length);
    for (let i = 0; i < maxBaseLength; i++) {
        const a = v1.base[i] ?? 0;
        const b = v2.base[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
    }

    const maxEnhancedLength = Math.max(v1.enhanced.length, v2.enhanced.length);
    for (let i = 0; i < maxEnhancedLength; i++) {
        const a = v1.enhanced[i] ?? 0;
        const b = v2.enhanced[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
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

/**
 * Extract a client version token (e.g. "1.2.2-enhanced.3") from a string like a release name or tag.
 */
export function extractVersionToken(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.trim().match(/\bv?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9._-]+)?)\b/i);
    return match && match[1] ? match[1] : null;
}

/**
 * Extract version from either a Cargo.toml file, JSON payload (or GitHub release), or plain version file.
 */
export function extractClientVersionFromRemote(content: string): string | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    // 1. Check if content is Cargo.toml with [package] section
    const pkgSectionMatch = trimmed.match(/\[package\]([\s\S]*?)(?:\r?\n\s*\[|$)/);
    if (pkgSectionMatch) {
        const verMatch = pkgSectionMatch[1].match(/^\s*version\s*=\s*"([^"]+)"/m);
        if (verMatch && verMatch[1]) {
            return verMatch[1].trim().replace(/^v/i, '');
        }
    }

    // 2. Check if content is JSON (custom version JSON or GitHub Release JSON)
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            const fromVersion = extractVersionToken(typeof parsed.version === 'string' ? parsed.version : null);
            if (fromVersion) return fromVersion;

            const fromReleaseName = extractVersionToken(typeof parsed.name === 'string' ? parsed.name : null);
            if (fromReleaseName) return fromReleaseName;

            const fromTagName = extractVersionToken(typeof parsed.tag_name === 'string' ? parsed.tag_name : null);
            if (fromTagName) return fromTagName;
        } catch (_) {}
    }

    // 3. Plain text version file (first non-comment line matching version format)
    for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('#')) continue;
        if (/^v?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9._-]+)?$/.test(l)) {
            return l.replace(/^v/i, '');
        }
    }

    return null;
}

/**
 * Fetch the latest client version from the GitHub repository (Cargo.toml / VERSION),
 * falling back to the latest GitHub release name (then tag_name) if no version file
 * exists or if the version file does not report a newer version than currentVersion.
 */
export async function fetchLatestClientVersion(currentVersion?: string): Promise<{ version: string; releaseUrl: string } | null> {
    let bestCandidate: { version: string; releaseUrl: string } | null = null;
    const compareAgainst = currentVersion || getCurrentClientVersion();

    for (const source of CLIENT_VERSION_SOURCES) {
        try {
            const res = await fetch(source.url, { cache: 'no-store' });
            if (!res.ok) continue;
            const text = await res.text();
            const version = extractClientVersionFromRemote(text);
            if (version) {
                if (!bestCandidate || isNewerVersion(version, bestCandidate.version)) {
                    bestCandidate = { version, releaseUrl: source.releaseUrl };
                }
                if (isNewerVersion(version, compareAgainst)) {
                    latestClientVersionCache = bestCandidate;
                    return latestClientVersionCache;
                }
                break;
            }
        } catch (err) {
            console.warn(`[Enhanced Client Update] Failed to fetch ${source.url}:`, err);
        }
    }

    for (const source of CLIENT_RELEASE_SOURCES) {
        try {
            const res = await fetch(source.apiUrl, { cache: 'no-store' });
            if (!res.ok) continue;
            const data = await res.json();
            if (!data || data.draft) continue;

            const version =
                extractVersionToken(typeof data.name === 'string' ? data.name : null) ||
                extractVersionToken(typeof data.tag_name === 'string' ? data.tag_name : null);
            if (version) {
                const releaseUrl =
                    typeof data.html_url === 'string' && data.html_url.trim()
                        ? data.html_url.trim()
                        : source.releaseUrl;
                if (!bestCandidate || isNewerVersion(version, bestCandidate.version)) {
                    bestCandidate = { version, releaseUrl };
                }
                break;
            }
        } catch (err) {
            console.warn(`[Enhanced Client Update] Failed to fetch latest release from ${source.apiUrl}:`, err);
        }
    }

    if (bestCandidate) {
        latestClientVersionCache = bestCandidate;
    }
    return bestCandidate;
}

/**
 * Check if a newer version of the Stremio Enhanced Linux client is available on GitHub.
 */
export async function checkClientUpdate(isManual = false): Promise<boolean> {
    if (clientUpdateCheckInProgress) return false;
    clientUpdateCheckInProgress = true;

    const checkBtn = document.getElementById('checkclientupdatesBtn');
    if (checkBtn) {
        checkBtn.style.pointerEvents = 'none';
        checkBtn.textContent = 'Checking...';
    }

    try {
        const currentVersion = getCurrentClientVersion();
        const skippedVersion =
            currentEnhancedData.skippedClientVersion ??
            (window as any).__INITIAL_ENHANCED_DATA__?.skippedClientVersion ??
            null;

        const remote = await fetchLatestClientVersion(currentVersion);
        if (!remote) {
            if (isManual) {
                modalManager.showToast(
                    'client-update-error',
                    'Update Check Failed',
                    'Could not fetch the latest client version from GitHub.',
                    'fail'
                );
            }
            return false;
        }

        const hasUpdate = isNewerVersion(remote.version, currentVersion);
        if (!hasUpdate) {
            if (isManual) {
                modalManager.showToast(
                    'client-up-to-date',
                    'Client Up to Date',
                    `You are running the latest version (v${currentVersion}).`,
                    'info'
                );
            }
            return false;
        }

        if (!isManual && skippedVersion === remote.version) {
            console.log(`[Enhanced Client Update] Skipping v${remote.version} (marked as skipped by user).`);
            return true;
        }

        const curParsed = parseClientVersion(currentVersion);
        const remParsed = parseClientVersion(remote.version);
        const curBaseStr = curParsed.base.join('.');
        const remBaseStr = remParsed.base.join('.');
        const curEnhNum = curParsed.enhanced[0] ?? 0;
        const remEnhNum = remParsed.enhanced[0] ?? 0;

        const details =
            `A new version of Stremio Linux Shell Enhanced is available!\n\n` +
            `Installed Version: v${currentVersion} (Base ${curBaseStr}, Enhanced build #${curEnhNum})\n` +
            `Latest Version: v${remote.version} (Base ${remBaseStr}, Enhanced build #${remEnhNum})\n\n` +
            `Would you like to open the GitHub Releases page to download the update?`;

        const choice = await modalManager.showAlert(
            'info',
            'Client Update Available',
            details,
            ['Download / Open Release Page', 'Skip This Version', 'Later']
        );

        if (choice === 0) {
            try {
                window.open(remote.releaseUrl, '_blank');
            } catch (_) {}
        } else if (choice === 1) {
            currentEnhancedData.skippedClientVersion = remote.version;
            postEnhancedMessage('skipClientVersion', { version: remote.version });
            modalManager.showToast(
                'client-update-skipped',
                'Version Skipped',
                `Skipped client update v${remote.version}.`,
                'info'
            );
        }

        return true;
    } catch (err) {
        console.error('[Enhanced Client Update] Error checking for client updates:', err);
        if (isManual) {
            modalManager.showToast(
                'client-update-error',
                'Update Check Failed',
                'An unexpected error occurred while checking for client updates.',
                'fail'
            );
        }
        return false;
    } finally {
        clientUpdateCheckInProgress = false;
        if (checkBtn) {
            checkBtn.style.pointerEvents = '';
            checkBtn.textContent = 'Check for Client Updates';
        }
    }
}
