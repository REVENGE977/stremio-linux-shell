import { getMarketplaceTabHtml } from '../components/marketplace-tab/marketplaceTab';
import { createMarketplaceCard } from '../components/marketplace-item/marketplaceItem';
import { EnhancedData, MarketplaceMod, MarketplaceRegistry } from '../types';
import { postEnhancedMessage } from '../utils/dom';

const REGISTRY_URL = 'https://raw.githubusercontent.com/REVENGE977/stremio-enhanced-registry/refs/heads/main/registry.json';

let currentEnhancedData: EnhancedData = {
    plugins: [],
    themes: [],
    activeTheme: null
};

let cachedRegistry: MarketplaceRegistry | null = null;

export function updateMarketplaceData(data: EnhancedData): void {
    currentEnhancedData = data;
    syncMarketplaceInstalledState();
}

export function getFileNameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/');
        return parts[parts.length - 1] || '';
    } catch (_) {
        const clean = url.split('?')[0].split('#')[0];
        return clean.substring(clean.lastIndexOf('/') + 1);
    }
}

export function isPluginInstalled(fileName: string): boolean {
    const fn = fileName.toLowerCase();
    return (currentEnhancedData.plugins || []).some(p => (p.fileName || '').toLowerCase() === fn);
}

export function isThemeInstalled(fileName: string): boolean {
    const fn = fileName.toLowerCase();
    return (currentEnhancedData.themes || []).some(t => (t.fileName || '').toLowerCase() === fn);
}

export async function fetchRegistry(): Promise<MarketplaceRegistry> {
    if (cachedRegistry) return cachedRegistry;
    console.log('[Enhanced Marketplace] Fetching registry from:', REGISTRY_URL);
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch marketplace registry: HTTP ${response.status}`);
    }
    const text = await response.text();
    const data = JSON.parse(text);
    cachedRegistry = {
        plugins: Array.isArray(data.plugins) ? data.plugins : [],
        themes: Array.isArray(data.themes) ? data.themes : []
    };
    console.log(`[Enhanced Marketplace] Loaded registry with ${cachedRegistry.plugins.length} plugins and ${cachedRegistry.themes.length} themes.`);
    return cachedRegistry;
}

function setupSearchBar(): void {
    const searchInput = document.getElementById('marketplace-search-input') as HTMLInputElement | null;
    const modsList = document.getElementById('mods-list');
    if (!searchInput || !modsList) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        const items = modsList.querySelectorAll<HTMLElement>('.marketplace-item-card, .addon-container-lC5KN');

        items.forEach(item => {
            const name = (item.querySelector('.marketplace-title') || item.querySelector('.name-container-qIAg8'))?.textContent?.toLowerCase() || '';
            const desc = item.textContent?.toLowerCase() || '';

            const matches = !query || name.includes(query) || desc.includes(query);
            item.style.display = matches ? '' : 'none';
        });
    });
}

export function syncMarketplaceInstalledState(): void {
    const modsList = document.getElementById('mods-list');
    if (!modsList) return;

    modsList.querySelectorAll<HTMLElement>('.modActionBtn').forEach(btn => {
        const link = btn.getAttribute('data-link') || '';
        const type = btn.getAttribute('data-type');
        if (!link || !type) return;

        const fileName = getFileNameFromUrl(link);
        const installed = type === 'Plugin' ? isPluginInstalled(fileName) : isThemeInstalled(fileName);
        const label = btn.querySelector('.label-OnWh2') || btn;

        if (installed) {
            btn.classList.remove('install-button-container-yfcq5');
            btn.classList.add('uninstall-button-container-oV4Yo');
            btn.setAttribute('title', 'Uninstall');
            label.textContent = 'Uninstall';
        } else {
            btn.classList.remove('uninstall-button-container-oV4Yo');
            btn.classList.add('install-button-container-yfcq5');
            btn.setAttribute('title', 'Install');
            label.textContent = 'Install';
        }
    });
}

export async function renderMarketplaceInline(forceReload = false): Promise<void> {
    const container = document.getElementById('enhanced-marketplace-content');
    if (!container) return;

    if (!forceReload && container.getAttribute('data-loaded') === 'true') {
        syncMarketplaceInstalledState();
        return;
    }
    if (container.getAttribute('data-loading') === 'true') return;

    container.setAttribute('data-loading', 'true');
    container.removeAttribute('data-loaded');
    container.innerHTML = getMarketplaceTabHtml();

    setupSearchBar();

    const modsList = document.getElementById('mods-list');
    if (!modsList) {
        container.removeAttribute('data-loading');
        return;
    }

    try {
        const registry = await fetchRegistry();
        if (!document.body.contains(modsList)) return;
        modsList.innerHTML = '';

        if ((!registry.plugins || registry.plugins.length === 0) && (!registry.themes || registry.themes.length === 0)) {
            modsList.innerHTML = `
                <div style="padding: 2.5rem; text-align: center; color: rgba(255,255,255,0.7); font-size: 1.05rem;">
                    No plugins or themes found in the community registry.
                </div>
            `;
            container.setAttribute('data-loaded', 'true');
            return;
        }

        const handleAction = async (
            mod: MarketplaceMod,
            type: 'Plugin' | 'Theme',
            willInstall: boolean,
            btn: HTMLElement
        ) => {
            const fileName = getFileNameFromUrl(mod.download);
            const label = btn.querySelector('.label-OnWh2') || btn;

            if (willInstall) {
                const prevText = label.textContent;
                label.textContent = 'Installing...';
                btn.style.pointerEvents = 'none';

                try {
                    const res = await fetch(mod.download);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const content = await res.text();

                    postEnhancedMessage('installMod', {
                        modType: type.toLowerCase(),
                        fileName,
                        content
                    });

                    btn.classList.remove('install-button-container-yfcq5');
                    btn.classList.add('uninstall-button-container-oV4Yo');
                    btn.setAttribute('title', 'Uninstall');
                    label.textContent = 'Uninstall';
                } catch (err: any) {
                    console.error('[Enhanced Marketplace] Install failed:', err);
                    alert(`Failed to install ${mod.name}: ${err?.message || err}`);
                    label.textContent = prevText;
                } finally {
                    btn.style.pointerEvents = '';
                }
            } else {
                const prevText = label.textContent;
                label.textContent = 'Uninstalling...';
                btn.style.pointerEvents = 'none';

                try {
                    postEnhancedMessage('deleteMod', {
                        modType: type.toLowerCase(),
                        fileName
                    });

                    btn.classList.remove('uninstall-button-container-oV4Yo');
                    btn.classList.add('install-button-container-yfcq5');
                    btn.setAttribute('title', 'Install');
                    label.textContent = 'Install';
                } catch (err: any) {
                    console.error('[Enhanced Marketplace] Uninstall failed:', err);
                    alert(`Failed to uninstall ${mod.name}: ${err?.message || err}`);
                    label.textContent = prevText;
                } finally {
                    btn.style.pointerEvents = '';
                }
            }
        };

        for (const plugin of registry.plugins) {
            const fileName = getFileNameFromUrl(plugin.download);
            const installed = isPluginInstalled(fileName);
            const card = createMarketplaceCard(plugin, 'Plugin', installed, handleAction);
            modsList.appendChild(card);
        }

        for (const theme of registry.themes) {
            const fileName = getFileNameFromUrl(theme.download);
            const installed = isThemeInstalled(fileName);
            const card = createMarketplaceCard(theme, 'Theme', installed, handleAction);
            modsList.appendChild(card);
        }

        container.setAttribute('data-loaded', 'true');
    } catch (err: any) {
        console.error('[Enhanced Marketplace] Failed to load registry:', err);
        if (!document.body.contains(modsList)) return;
        modsList.innerHTML = `
            <div style="padding: 2.5rem; text-align: center; color: #ff6b6b; font-size: 1rem;">
                Failed to load community marketplace: ${err?.message || err}<br><br>
                <button id="marketplace-retry-btn" style="padding: 0.5rem 1rem; border-radius: 4px; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; border: none;">
                    Retry
                </button>
            </div>
        `;
        document.getElementById('marketplace-retry-btn')?.addEventListener('click', () => {
            cachedRegistry = null;
            renderMarketplaceInline(true);
        });
    } finally {
        container.removeAttribute('data-loading');
    }
}

export async function browseMarketplace(): Promise<void> {
    if (!location.hash.startsWith('#/settings/enhanced/marketplace')) {
        location.hash = '#/settings/enhanced/marketplace';
    }
    await renderMarketplaceInline();
}
