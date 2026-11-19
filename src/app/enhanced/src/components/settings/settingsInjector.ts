import { SETTINGS_STYLES, SETTINGS_STYLE_ID } from './settingsStyles';
import { escapeHtml, waitForElement, postEnhancedMessage } from '../../utils/dom';
import { THEME_ICON, PLUGIN_ICON, MARKETPLACE_ICON, SERVER_ICON, UPDATE_ICON, PLAYER_ICON } from '../../utils/icons';
import { renderThemesList } from '../../themes/themeManager';
import { renderPluginsList, toggleAllPlugins } from '../../plugins/pluginManager';
import { renderMarketplaceInline } from '../../marketplace/marketplaceManager';
import { isThumbnailPreviewEnabled, syncThumbnailPreviewToggle } from '../../player/thumbnailPreview';
import {
    openStreamingServerFolder,
    checkServerJsUpdateAndSetup,
    getCurrentServerStatus,
    getServerStatus,
    startStreamingServer,
    reloadToLocalStreamingServer
} from '../../server/serverManager';
import {
    checkClientUpdate,
    fetchLatestClientVersion,
    getCurrentClientVersion,
    getLatestClientVersion,
    isNewerVersion,
    CLIENT_RELEASES_URL
} from '../../updates/updateManager';

// Settings page (Stremio Web 5.1+): a sidebar of link groups next to a pane showing one page.
// Matched by class-name prefix, because the hash suffixes change with every Stremio Web build.
const SELECTORS = {
    SETTINGS_CONTENT: '[class*="settings-content-"]',
    NAV_MENU: '[class*="settings-content-"] > nav',
    NAV_GROUP: '[class*="settings-content-"] > nav > div[class*="group-"]',
    SETTINGS_PANE: '[class*="settings-content-"] > [class*="pane-"]',
    SETTINGS_PAGE_CONTAINER: '[class*="settings-content-"] > [class*="pane-"] > [class*="page-container-"]',
    SETTINGS_PAGE: '[class*="settings-content-"] > [class*="pane-"] > [class*="page-container-"] > [class*="page-"]',
    SETTINGS_GROUP: '[class*="page-container-"] > [class*="page-"] > section[class*="group-"]',
} as const;

const ENHANCED_ROUTE = '#/settings/enhanced';
const DEFAULT_SELECTED_CLASS = 'selected-S7SeK';

interface NavItem {
    id: string;
    label: string;
    icon: string;
}

const classOf = (el: Element | null | undefined): string => el?.getAttribute('class') ?? '';

function selectedClass(): string {
    for (const item of Array.from(document.querySelectorAll(`${SELECTORS.NAV_MENU} a`))) {
        const found = Array.from(item.classList).find(c => c.startsWith('selected-'));
        if (found) return found;
    }
    return DEFAULT_SELECTED_CLASS;
}

function injectSettingsStyles(): void {
    if (document.getElementById(SETTINGS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SETTINGS_STYLE_ID;
    style.textContent = SETTINGS_STYLES;
    (document.head || document.documentElement).appendChild(style);
}

function applyRouteState(): boolean {
    const content = document.querySelector(SELECTORS.SETTINGS_CONTENT);
    if (!content) return false;

    const match = location.hash.match(/^#\/settings\/enhanced(?:\/([a-z]+))?/);
    const current = match ? (match[1] || 'themes') : '';
    const selected = selectedClass();

    content.classList.toggle('enhanced-open', !!match);
    const page = document.getElementById('enhanced');
    if (page) page.setAttribute('data-show', current);

    for (const link of Array.from(document.querySelectorAll('[data-enhanced-item]'))) {
        link.classList.toggle(selected, link.getAttribute('data-enhanced-item') === current);
    }

    // Stremio shows its first page for addresses it doesn't know; unhighlight its item.
    if (match) {
        for (const link of Array.from(document.querySelectorAll(`${SELECTORS.NAV_MENU} a:not([data-enhanced-item])`))) {
            link.classList.remove(selected);
        }
        if (current === 'marketplace') {
            renderMarketplaceInline();
        }
    }

    return !!match;
}

export function updateRoute(): void {
    const isEnhancedRoute = applyRouteState();
    if (isEnhancedRoute) {
        // Re-sync after Stremio's React render pass so it doesn't re-highlight its first sidebar item.
        requestAnimationFrame(() => {
            applyRouteState();
        });
    }
}

function createCategory(id: string, categoryKey: string, title: string, sampleGroup: Element | null): HTMLElement {
    const category = document.createElement('div');
    category.id = id;
    category.className = `${classOf(sampleGroup)} enhanced-category`.trim();
    category.setAttribute('data-category', categoryKey);

    const heading = document.createElement('div');
    heading.className = classOf(sampleGroup?.firstElementChild);

    const headingTitle = document.createElement('h2');
    headingTitle.className = classOf(sampleGroup?.querySelector('h2'));
    headingTitle.textContent = title;
    heading.appendChild(headingTitle);

    category.appendChild(heading);
    return category;
}

function createOptionButton(id: string, title: string): HTMLElement {
    const btn = document.createElement('div');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('title', title);
    btn.className = 'enhanced-button button-container-zVLH6 button';
    btn.id = id;
    btn.textContent = title;
    return btn;
}

function createOptionRow(buttons: HTMLElement[]): HTMLElement {
    const option = document.createElement('div');
    option.className = 'enhanced-option';

    const content = document.createElement('div');
    content.className = 'enhanced-option-content';
    buttons.forEach(btn => content.appendChild(btn));

    option.appendChild(content);
    return option;
}

function buildNavGroup(): Promise<void> {
    return waitForElement(SELECTORS.NAV_GROUP, 10000)
        .then(() => {
            if (!location.href.includes('#/settings')) return;
            if (document.querySelector('[data-enhanced-nav]')) return;

            const nav = document.querySelector(SELECTORS.NAV_MENU);
            const groups = Array.from(document.querySelectorAll(SELECTORS.NAV_GROUP));
            const sampleGroup = groups[0];
            const sampleItem = sampleGroup?.querySelector('a');
            if (!nav || !sampleGroup || !sampleItem) return;

            const group = document.createElement('div');
            group.className = classOf(sampleGroup);
            group.setAttribute('data-enhanced-nav', '');

            const label = document.createElement('div');
            label.className = classOf(sampleGroup.firstElementChild);
            label.textContent = 'Stremio Enhanced';
            group.appendChild(label);

            const itemClass = Array.from(sampleItem.classList)
                .filter(c => !c.startsWith('selected-'))
                .join(' ');
            const iconClass = classOf(sampleItem.querySelector('svg'));
            const labelClass = classOf(sampleItem.querySelector('div'));

            const items: NavItem[] = [
                { id: 'themes', label: 'Themes', icon: THEME_ICON },
                { id: 'plugins', label: 'Plugins', icon: PLUGIN_ICON },
                { id: 'marketplace', label: 'Marketplace', icon: MARKETPLACE_ICON },
                { id: 'player', label: 'Player', icon: PLAYER_ICON },
                { id: 'server', label: 'Streaming Server', icon: SERVER_ICON },
                { id: 'updates', label: 'Client Updates', icon: UPDATE_ICON },
            ];

            for (const item of items) {
                const link = document.createElement('a');
                link.className = itemClass;
                link.href = `${ENHANCED_ROUTE}/${item.id}`;
                link.setAttribute('data-enhanced-item', item.id);
                link.innerHTML = item.icon;

                const svg = link.querySelector('svg');
                if (svg) {
                    if (iconClass) svg.setAttribute('class', iconClass);
                    svg.style.removeProperty('width');
                    svg.style.removeProperty('height');
                }

                const text = document.createElement('div');
                text.className = labelClass;
                text.textContent = item.label;
                link.appendChild(text);

                group.appendChild(link);
            }

            nav.insertBefore(group, groups[groups.length - 1]);
            updateRoute();
        })
        .catch(err => {
            console.warn('[Enhanced] Failed to add settings nav group:', err);
        });
}

function buildSettingsPage(): Promise<void> {
    return waitForElement(SELECTORS.SETTINGS_PAGE, 10000)
        .then(() => {
            if (!location.href.includes('#/settings')) return;
            if (document.getElementById('enhanced')) return;

            injectSettingsStyles();

            const pane = document.querySelector(SELECTORS.SETTINGS_PANE);
            const stremioContainer = document.querySelector(SELECTORS.SETTINGS_PAGE_CONTAINER);
            const stremioPage = document.querySelector(SELECTORS.SETTINGS_PAGE);
            if (!pane || !stremioPage) return;

            const stremioHead = stremioPage.firstElementChild;
            const sampleGroup = document.querySelector(SELECTORS.SETTINGS_GROUP);

            const container = document.createElement('div');
            container.className = `${classOf(stremioContainer)} enhanced-page-container`.trim();

            const page = document.createElement('div');
            page.className = classOf(stremioPage);
            page.id = 'enhanced';

            const head = document.createElement('div');
            head.className = classOf(stremioHead);
            const heading = document.createElement('h1');
            heading.className = classOf(stremioHead?.querySelector('h1'));
            heading.textContent = 'Stremio Enhanced';
            head.appendChild(heading);
            page.appendChild(head);

            // Themes Category
            const themesCategory = createCategory('enhanced-themes-category', 'themes', 'Themes', sampleGroup);
            const openThemesBtn = createOptionButton('openthemesfolderBtn', 'Open Themes Folder');
            openThemesBtn.onclick = () => {
                (window as any).StremioEnhancedAPI.openThemesFolder();
            };
            themesCategory.appendChild(createOptionRow([openThemesBtn]));
            const themesList = document.createElement('div');
            themesList.id = 'enhanced-themes-list';
            themesCategory.appendChild(themesList);
            page.appendChild(themesCategory);

            // Plugins Category
            const pluginsCategory = createCategory('enhanced-plugins-category', 'plugins', 'Plugins', sampleGroup);
            const openPluginsBtn = createOptionButton('openpluginsfolderBtn', 'Open Plugins Folder');
            openPluginsBtn.onclick = () => {
                (window as any).StremioEnhancedAPI.openPluginsFolder();
            };
            const toggleAllPluginsBtn = createOptionButton('toggleallpluginsBtn', 'Toggle All Plugins');
            toggleAllPluginsBtn.onclick = () => {
                toggleAllPlugins();
            };
            pluginsCategory.appendChild(createOptionRow([openPluginsBtn, toggleAllPluginsBtn]));
            const pluginsList = document.createElement('div');
            pluginsList.id = 'enhanced-plugins-list';
            pluginsCategory.appendChild(pluginsList);
            page.appendChild(pluginsCategory);

            // Community Marketplace Category (rendered directly inside settings)
            const marketplaceCategory = createCategory('enhanced-marketplace-category', 'marketplace', 'Community Marketplace', sampleGroup);
            const marketplaceContent = document.createElement('div');
            marketplaceContent.id = 'enhanced-marketplace-content';
            marketplaceCategory.appendChild(marketplaceContent);
            page.appendChild(marketplaceCategory);

            // Player Category (ThumbFast Thumbnail Preview)
            const playerCategory = createCategory('enhanced-player-category', 'player', 'Player', sampleGroup);
            const thumbOption = document.createElement('div');
            thumbOption.className = 'enhanced-option';

            const thumbHeading = document.createElement('div');
            thumbHeading.className = 'enhanced-option-heading';
            const thumbLabel = document.createElement('div');
            thumbLabel.className = 'enhanced-option-label';
            thumbLabel.textContent = 'Thumbnail Preview (ThumbFast)';
            const thumbDesc = document.createElement('div');
            thumbDesc.style.cssText = 'font-size: 0.85rem; color: rgba(255, 255, 255, 0.55); margin-top: 0.25rem;';
            thumbDesc.textContent = 'Show frame preview thumbnails when hovering or scrubbing the seek bar.';
            thumbHeading.appendChild(thumbLabel);
            thumbHeading.appendChild(thumbDesc);

            const thumbContent = document.createElement('div');
            thumbContent.className = 'enhanced-option-content';

            const thumbToggle = document.createElement('div');
            thumbToggle.id = 'thumbnailpreviewToggle';
            thumbToggle.setAttribute('tabindex', '0');
            thumbToggle.setAttribute('role', 'switch');
            thumbToggle.setAttribute('title', 'Thumbnail Preview (ThumbFast)');
            thumbToggle.className = `toggle-container-lZfHP button-container-zVLH6${isThumbnailPreviewEnabled() ? ' checked' : ''}`;
            thumbToggle.setAttribute('aria-checked', isThumbnailPreviewEnabled() ? 'true' : 'false');
            thumbToggle.style.cssText = 'outline: none; cursor: pointer;';

            const thumbKnob = document.createElement('div');
            thumbKnob.className = 'toggle-toOWM';
            thumbToggle.appendChild(thumbKnob);

            const onToggleThumbPreview = () => {
                const next = !isThumbnailPreviewEnabled();
                thumbToggle.classList.toggle('checked', next);
                thumbToggle.setAttribute('aria-checked', next ? 'true' : 'false');
                postEnhancedMessage('setThumbnailPreview', { enabled: next });
            };
            thumbToggle.addEventListener('click', onToggleThumbPreview);
            thumbToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleThumbPreview();
                }
            });

            thumbContent.appendChild(thumbToggle);
            thumbOption.appendChild(thumbHeading);
            thumbOption.appendChild(thumbContent);
            playerCategory.appendChild(thumbOption);
            page.appendChild(playerCategory);

            // Streaming Server Category
            const serverCategory = createCategory('enhanced-server-category', 'server', 'Streaming Server', sampleGroup);
            const openServerBtn = createOptionButton('openserverfolderBtn', 'Open Server Folder');
            openServerBtn.setAttribute('title', 'Open Streaming Server Folder');
            const checkServerUpdatesBtn = createOptionButton('checkserverupdatesBtn', 'Check for Server Updates');

            const serverStatusInfo = document.createElement('div');
            serverStatusInfo.id = 'enhanced-server-status-info';
            serverStatusInfo.style.cssText = 'font-size: 0.9rem; color: #a0a0a0; margin-top: 0.5rem; margin-left: 0.2rem;';

            const renderServerInfo = (status: any) => {
                if (!status || !status.exists) {
                    serverStatusInfo.innerHTML = `<span style="color: #ff6b6b; font-weight: 600;">Status:</span> Not installed / missing (server.js required)`;
                } else {
                    const ver = status.currentVersion ? `v${status.currentVersion.replace(/^v/, '')}` : 'Installed';
                    const runningBadge = status.running
                        ? '<span style="color: #51cf66;">● Running</span>'
                        : '<span style="color: #fcc419;">● Stopped</span>';
                    const actionBtn = (status.running && window.location.hostname !== '127.0.0.1')
                        ? `<button id="enhanced-switch-to-local-btn" style="margin-left: 0.8rem; cursor: pointer; padding: 0.3rem 0.8rem; background: #5c7cfa; color: #fff; border: none; border-radius: 4px; font-weight: 600;">Switch to Local Server (127.0.0.1)</button>`
                        : (!status.running)
                        ? `<button id="enhanced-start-server-btn" style="margin-left: 0.8rem; cursor: pointer; padding: 0.3rem 0.8rem; background: #51cf66; color: #111; border: none; border-radius: 4px; font-weight: 600;">Start Server</button>`
                        : '';
                    serverStatusInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Status:</span> ${ver} (${runningBadge}) &bull; <span style="color: #888; font-size: 0.85rem;">${status.serverDir}</span>${actionBtn}`;

                    const startBtn = serverStatusInfo.querySelector<HTMLElement>('#enhanced-start-server-btn');
                    if (startBtn) {
                        startBtn.onclick = async () => {
                            startBtn.textContent = 'Starting...';
                            await startStreamingServer();
                            const updated = await getServerStatus();
                            renderServerInfo(updated);
                        };
                    }
                    const switchLocalBtn = serverStatusInfo.querySelector<HTMLElement>('#enhanced-switch-to-local-btn');
                    if (switchLocalBtn) {
                        switchLocalBtn.onclick = () => {
                            reloadToLocalStreamingServer();
                        };
                    }
                }
            };

            openServerBtn.onclick = () => {
                openStreamingServerFolder();
            };
            checkServerUpdatesBtn.onclick = () => {
                checkServerJsUpdateAndSetup(true).then(() => {
                    renderServerInfo(getCurrentServerStatus());
                });
            };

            serverCategory.appendChild(createOptionRow([openServerBtn, checkServerUpdatesBtn]));
            serverCategory.appendChild(serverStatusInfo);
            page.appendChild(serverCategory);

            // Client Updates Category
            const updatesCategory = createCategory('enhanced-updates-category', 'updates', 'Client Updates', sampleGroup);
            const checkClientUpdatesBtn = createOptionButton('checkclientupdatesBtn', 'Check for Client Updates');
            const openClientReleasesBtn = createOptionButton('openclientreleasesBtn', 'View Releases');
            openClientReleasesBtn.setAttribute('title', 'View Releases on GitHub');

            const clientVersionInfo = document.createElement('div');
            clientVersionInfo.id = 'enhanced-client-version-info';
            clientVersionInfo.style.cssText = 'font-size: 0.9rem; color: #a0a0a0; margin-top: 0.5rem; margin-left: 0.2rem;';

            const renderClientVersionInfo = () => {
                const currentVer = getCurrentClientVersion();
                const latest = getLatestClientVersion();
                if (!latest) {
                    clientVersionInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Installed Version:</span> v${escapeHtml(currentVer)}`;
                    return;
                }
                const hasUpdate = isNewerVersion(latest.version, currentVer);
                const badge = hasUpdate
                    ? `<span style="color: #fcc419; font-weight: 600;">● Update available: v${escapeHtml(latest.version)}</span>`
                    : `<span style="color: #51cf66;">● Up to date (v${escapeHtml(latest.version)})</span>`;
                clientVersionInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Installed Version:</span> v${escapeHtml(currentVer)} &bull; ${badge}`;
            };

            checkClientUpdatesBtn.onclick = async () => {
                await checkClientUpdate(true);
                renderClientVersionInfo();
            };

            openClientReleasesBtn.onclick = () => {
                const url = getLatestClientVersion()?.releaseUrl || CLIENT_RELEASES_URL;
                try {
                    window.open(url, '_blank');
                } catch (_) {}
            };

            updatesCategory.appendChild(createOptionRow([checkClientUpdatesBtn, openClientReleasesBtn]));
            updatesCategory.appendChild(clientVersionInfo);
            page.appendChild(updatesCategory);

            container.appendChild(page);
            pane.appendChild(container);

            renderServerInfo(getCurrentServerStatus());
            getServerStatus().then(renderServerInfo);

            renderClientVersionInfo();
            if (!getLatestClientVersion()) {
                fetchLatestClientVersion().then(() => renderClientVersionInfo());
            }

            renderThemesList((fileName) => {
                (window as any).StremioEnhancedAPI.applyTheme(fileName);
            });
            renderPluginsList((fileName, enabled) => {
                (window as any).StremioEnhancedAPI.togglePlugin(fileName, enabled);
            });
            syncThumbnailPreviewToggle();

            updateRoute();
        })
        .catch(err => {
            console.warn('[Enhanced] Waiting for settings page:', err);
        });
}

// The pages are built asynchronously (they wait for Stremio's settings page to render), so a second
// hashchange arriving meanwhile must not start another build.
let isBuilding = false;
let buildStartedAt = 0;

export function checkSettings(): void {
    if (!location.href.includes('#/settings')) {
        isBuilding = false;
        return;
    }

    updateRoute();

    if (document.getElementById('enhanced') && document.querySelector('[data-enhanced-nav]')) return;
    if (isBuilding && Date.now() - buildStartedAt < 10000) return;
    isBuilding = true;
    buildStartedAt = Date.now();

    // Stremio rebuilt its settings page (or this is the first visit): drop anything of ours that's left.
    document.getElementById('enhanced')?.closest('.enhanced-page-container')?.remove();
    document.querySelector('[data-enhanced-nav]')?.remove();

    // Fetch fresh list from Rust
    postEnhancedMessage('getData');

    Promise.allSettled([buildSettingsPage(), buildNavGroup()]).finally(() => {
        isBuilding = false;
    });
}
