import { getMarketplaceTabHtml } from '../components/marketplace-tab/marketplaceTab';
import { createMarketplaceCard } from '../components/marketplace-item/marketplaceItem';
import { EnhancedData, MarketplaceMod, MarketplaceRegistry } from '../types';
import { postEnhancedMessage } from '../utils/dom';
import { checkSettings } from '../components/settings/settingsInjector';

const REGISTRY_URL = 'https://raw.githubusercontent.com/REVENGE977/stremio-enhanced-registry/refs/heads/main/registry.json';

let currentEnhancedData: EnhancedData = {
    plugins: [],
    themes: [],
    activeTheme: null
};

let cachedRegistry: MarketplaceRegistry | null = null;

export function updateMarketplaceData(data: EnhancedData): void {
    currentEnhancedData = data;
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
    const searchInput = document.querySelector<HTMLInputElement>('.search-input-bAgAh');
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

function goBackToSettings(): void {
    location.hash = '#/';
    setTimeout(() => {
        location.hash = '#/settings';
        setTimeout(() => {
            checkSettings();
        }, 100);
    }, 50);
}

export async function browseMarketplace(): Promise<void> {
    const settingsContent = document.querySelector<HTMLElement>('[class*="settings-content-"]') ||
        document.querySelector<HTMLElement>('[class*="sections-container"]')?.parentElement;

    if (!settingsContent) {
        console.warn('[Enhanced Marketplace] Settings content container not found.');
        return;
    }

    if (settingsContent.parentElement) {
        settingsContent.parentElement.style.height = '100%';
        settingsContent.parentElement.style.overflow = 'hidden';
    }
    settingsContent.style.position = 'relative';
    settingsContent.style.height = '100%';
    settingsContent.style.width = '100%';
    settingsContent.style.overflow = 'hidden';

    settingsContent.innerHTML = getMarketplaceTabHtml();

    const scrollContainer = document.querySelector<HTMLElement>('.marketplace-tab-view');
    if (scrollContainer) {
        scrollContainer.focus();
    }

    // Hook up back button in the tab header
    const backBtn = document.getElementById('marketplace-back-btn');
    if (backBtn) {
        backBtn.onclick = goBackToSettings;
    }

    // Hook up horizontal nav back button if available
    const horizontalNavs = document.querySelectorAll('[class*="horizontal-nav-bar"]');
    if (horizontalNavs.length > 1) {
        const targetNav = horizontalNavs[1] as HTMLElement;
        targetNav.innerHTML = `
            <div tabindex="-1" class="button-container-xT9_L back-button-container-lDB1N button-container-zVLH6" id="back-btn" style="cursor: pointer;">
                <svg class="icon-T8MU6" viewBox="0 0 512 512" style="width: 1.2rem; height: 1.2rem;">
                    <path d="M328.61 106.469L185.08 243.358l143.53 136.889" style="stroke: currentcolor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 48; fill: none;"></path>
                </svg>
            </div>
        `;
        document.getElementById('back-btn')?.addEventListener('click', goBackToSettings);
    }

    setupSearchBar();

    const modsList = document.getElementById('mods-list');
    if (!modsList) return;

    try {
        const registry = await fetchRegistry();
        modsList.innerHTML = '';

        if ((!registry.plugins || registry.plugins.length === 0) && (!registry.themes || registry.themes.length === 0)) {
            modsList.innerHTML = `
                <div style="padding: 2.5rem; text-align: center; color: rgba(255,255,255,0.7); font-size: 1.05rem;">
                    No plugins or themes found in the community registry.
                </div>
            `;
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

        // Render plugins
        for (const plugin of registry.plugins) {
            const fileName = getFileNameFromUrl(plugin.download);
            const installed = isPluginInstalled(fileName);
            const card = createMarketplaceCard(plugin, 'Plugin', installed, handleAction);
            modsList.appendChild(card);
        }

        // Render themes
        for (const theme of registry.themes) {
            const fileName = getFileNameFromUrl(theme.download);
            const installed = isThemeInstalled(fileName);
            const card = createMarketplaceCard(theme, 'Theme', installed, handleAction);
            modsList.appendChild(card);
        }
    } catch (err: any) {
        console.error('[Enhanced Marketplace] Failed to load registry:', err);
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
            browseMarketplace();
        });
    }
}
