import { SETTINGS_STYLES, SETTINGS_STYLE_ID } from './settingsStyles';
import { escapeHtml, waitForElement, postEnhancedMessage } from '../../utils/dom';
import { THEME_ICON, PLUGIN_ICON, MARKETPLACE_ICON, SERVER_ICON, UPDATE_ICON, PLAYER_ICON, PREFERENCES_ICON, TWO_COLUMNS_ICON, ONE_COLUMN_ICON, WIDE_LIST_ICON, NARROW_LIST_ICON } from '../../utils/icons';
import { renderThemesList } from '../../themes/themeManager';
import { renderPluginsList, toggleAllPlugins } from '../../plugins/pluginManager';
import { renderMarketplaceInline } from '../../marketplace/marketplaceManager';
import { isThumbnailPreviewEnabled, syncThumbnailPreviewToggle } from '../../player/thumbnailPreview';
import { isChapterMarkersEnabled, syncChapterMarkersToggle } from '../../player/chapterMarkers';
import { syncShaderSettingsUI } from '../../player/shaderControls';
import { modalManager } from '../modals/modalManager';
import { EnhancedData, ShellPreferencesUiData } from '../../types';
import {
    openStreamingServerFolder,
    checkServerJsUpdateAndSetup,
    getCurrentServerStatus,
    getServerStatus,
    startStreamingServer,
    reloadToLocalStreamingServer
} from '../../server/serverManager';
import {
    canSelfUpdateAppImage,
    checkClientUpdate,
    fetchLatestClientVersion,
    getCurrentClientVersion,
    getInstallInfo,
    getLatestClientVersion,
    isNewerVersion,
    renderPatchNotesMarkdown,
    showPatchNotesModal,
    startAppImageSelfUpdate,
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

const LIST_COLUMNS_STORAGE_KEY = 'enhanced_list_columns';
const LIST_WIDTH_STORAGE_KEY = 'enhanced_list_width';
const LIST_LAYOUT_CATEGORIES = new Set(['themes', 'plugins', 'marketplace']);

let listColumns: '1' | '2' = (() => {
    try {
        return localStorage.getItem(LIST_COLUMNS_STORAGE_KEY) === '1' ? '1' : '2';
    } catch (_) {
        return '2';
    }
})();

let listWidth: 'narrow' | 'wide' = (() => {
    try {
        return localStorage.getItem(LIST_WIDTH_STORAGE_KEY) === 'wide' ? 'wide' : 'narrow';
    } catch (_) {
        return 'narrow';
    }
})();

function syncListLayoutUI(activeCategory?: string): void {
    const page = document.getElementById('enhanced');
    if (page) {
        page.setAttribute('data-list-columns', listColumns);
    }

    const current = activeCategory ?? page?.getAttribute('data-show') ?? '';
    const container = document.querySelector('.enhanced-page-container');
    if (container) {
        container.classList.toggle(
            'enhanced-wide-layout',
            listWidth === 'wide' && LIST_LAYOUT_CATEGORIES.has(current)
        );
    }

    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('.enhanced-columns-toggle-btn'))) {
        btn.innerHTML = listColumns === '2' ? TWO_COLUMNS_ICON : ONE_COLUMN_ICON;
        const label = listColumns === '2' ? 'Switch to 1 column' : 'Switch to 2 columns';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', listColumns === '1' ? 'true' : 'false');
        btn.classList.toggle('active', listColumns === '1');
    }

    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('.enhanced-width-toggle-btn'))) {
        btn.innerHTML = listWidth === 'wide' ? NARROW_LIST_ICON : WIDE_LIST_ICON;
        const label = listWidth === 'wide' ? 'Switch to narrow list' : 'Switch to wide list';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', listWidth === 'wide' ? 'true' : 'false');
        btn.classList.toggle('active', listWidth === 'wide');
    }
}

function createLayoutControls(sectionKey: string): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'enhanced-layout-controls';

    const columnsBtn = createOptionButton(`enhanced-${sectionKey}-columns-btn`, 'Switch to 1 column');
    columnsBtn.classList.add('enhanced-columns-toggle-btn', 'enhanced-icon-button');
    columnsBtn.textContent = '';
    columnsBtn.setAttribute('role', 'button');
    const toggleColumns = () => {
        listColumns = listColumns === '2' ? '1' : '2';
        try {
            localStorage.setItem(LIST_COLUMNS_STORAGE_KEY, listColumns);
        } catch (_) {}
        syncListLayoutUI();
    };
    columnsBtn.addEventListener('click', toggleColumns);
    columnsBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleColumns();
        }
    });

    const widthBtn = createOptionButton(`enhanced-${sectionKey}-width-btn`, 'Switch to wide list');
    widthBtn.classList.add('enhanced-width-toggle-btn', 'enhanced-icon-button');
    widthBtn.textContent = '';
    widthBtn.setAttribute('role', 'button');
    const toggleWidth = () => {
        listWidth = listWidth === 'narrow' ? 'wide' : 'narrow';
        try {
            localStorage.setItem(LIST_WIDTH_STORAGE_KEY, listWidth);
        } catch (_) {}
        syncListLayoutUI();
    };
    widthBtn.addEventListener('click', toggleWidth);
    widthBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleWidth();
        }
    });

    controls.appendChild(columnsBtn);
    controls.appendChild(widthBtn);
    return controls;
}

let currentShellPreferences: ShellPreferencesUiData = {
    rememberWindowState: true,
    noWindowDecorations: false,
    nativeTitlebar: false,
    systemTheme: true,
    kdeTheme: true,
    isDesktopKde: false,
    mpvConfigLocation: '~/.config/mpv/mpv.conf',
};

type BooleanShellPreferenceKey =
    | 'rememberWindowState'
    | 'noWindowDecorations'
    | 'nativeTitlebar'
    | 'systemTheme'
    | 'kdeTheme';

export function updateShellPreferencesData(data: EnhancedData): void {
    if (data.shellPreferences) {
        currentShellPreferences = { ...currentShellPreferences, ...data.shellPreferences };
        syncShellPreferencesUI();
    }
}

export function syncShellPreferencesUI(): void {
    const boolKeys: BooleanShellPreferenceKey[] = [
        'rememberWindowState',
        'nativeTitlebar',
        'systemTheme',
        'kdeTheme',
        'noWindowDecorations',
    ];
    for (const key of boolKeys) {
        const toggle = document.getElementById(`pref-${key}-toggle`);
        if (toggle) {
            const active = Boolean(currentShellPreferences[key]);
            toggle.classList.toggle('checked', active);
            toggle.setAttribute('aria-checked', active ? 'true' : 'false');
        }
    }

    const kdeRow = document.getElementById('pref-kdeTheme-row');
    if (kdeRow) {
        kdeRow.style.display = currentShellPreferences.isDesktopKde ? '' : 'none';
    }

    const csdInactive = currentShellPreferences.nativeTitlebar || currentShellPreferences.noWindowDecorations;
    const sysThemeRow = document.getElementById('pref-systemTheme-row');
    if (sysThemeRow) {
        sysThemeRow.classList.toggle('enhanced-option-muted', csdInactive);
    }
    if (kdeRow) {
        kdeRow.classList.toggle('enhanced-option-muted', csdInactive);
    }
    const nativeRow = document.getElementById('pref-nativeTitlebar-row');
    if (nativeRow) {
        nativeRow.classList.toggle('enhanced-option-muted', currentShellPreferences.noWindowDecorations);
    }

    const mpvInput = document.getElementById('pref-mpvConfigLocation-input') as HTMLInputElement | null;
    if (mpvInput && document.activeElement !== mpvInput) {
        mpvInput.value = currentShellPreferences.mpvConfigLocation || '';
    }
}

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
    const pane = document.querySelector(SELECTORS.SETTINGS_PANE);
    if (pane) pane.classList.add('enhanced-settings-pane');
    const page = document.getElementById('enhanced');
    if (page) page.setAttribute('data-show', current);
    syncListLayoutUI(current);

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
                { id: 'preferences', label: 'Preferences', icon: PREFERENCES_ICON },
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
            pane.classList.add('enhanced-settings-pane');

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
            const themesRow = createOptionRow([openThemesBtn]);
            themesRow.classList.add('enhanced-toolbar-row');
            themesRow.appendChild(createLayoutControls('themes'));
            themesCategory.appendChild(themesRow);
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
            const pluginsRow = createOptionRow([openPluginsBtn, toggleAllPluginsBtn]);
            pluginsRow.classList.add('enhanced-toolbar-row');
            pluginsRow.appendChild(createLayoutControls('plugins'));
            pluginsCategory.appendChild(pluginsRow);
            const pluginsList = document.createElement('div');
            pluginsList.id = 'enhanced-plugins-list';
            pluginsCategory.appendChild(pluginsList);
            page.appendChild(pluginsCategory);

            // Community Marketplace Category (rendered directly inside settings)
            const marketplaceCategory = createCategory('enhanced-marketplace-category', 'marketplace', 'Community Marketplace', sampleGroup);
            const marketplaceRow = document.createElement('div');
            marketplaceRow.className = 'enhanced-option enhanced-toolbar-row';
            const marketplaceLayoutLabel = document.createElement('div');
            marketplaceLayoutLabel.className = 'enhanced-option-heading';
            const marketplaceLayoutTitle = document.createElement('div');
            marketplaceLayoutTitle.className = 'enhanced-option-label';
            marketplaceLayoutTitle.textContent = 'View Layout';
            marketplaceLayoutLabel.appendChild(marketplaceLayoutTitle);
            marketplaceRow.appendChild(marketplaceLayoutLabel);
            marketplaceRow.appendChild(createLayoutControls('marketplace'));
            marketplaceCategory.appendChild(marketplaceRow);
            const marketplaceContent = document.createElement('div');
            marketplaceContent.id = 'enhanced-marketplace-content';
            marketplaceCategory.appendChild(marketplaceContent);
            page.appendChild(marketplaceCategory);

            // Player Category (ThumbFast, Chapter Markers, Stats HUD, GLSL Shaders)
            const playerCategory = createCategory('enhanced-player-category', 'player', 'Player', sampleGroup);

            const createPlayerSubsection = (title: string): HTMLElement => {
                const sub = document.createElement('div');
                sub.className = 'enhanced-subsection-title';
                sub.textContent = title;
                return sub;
            };

            playerCategory.appendChild(createPlayerSubsection('Playback & Overlay'));

            const thumbOption = document.createElement('div');
            thumbOption.className = 'enhanced-option';

            const thumbHeading = document.createElement('div');
            thumbHeading.className = 'enhanced-option-heading';
            const thumbLabel = document.createElement('div');
            thumbLabel.className = 'enhanced-option-label';
            thumbLabel.textContent = 'Thumbnail Preview (ThumbFast)';
            const thumbDesc = document.createElement('div');
            thumbDesc.className = 'enhanced-option-description';
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

            // Chapter Markers toggle
            const chapterOption = document.createElement('div');
            chapterOption.className = 'enhanced-option';

            const chapterHeading = document.createElement('div');
            chapterHeading.className = 'enhanced-option-heading';
            const chapterLabel = document.createElement('div');
            chapterLabel.className = 'enhanced-option-label';
            chapterLabel.textContent = 'Chapter Markers on Seek Bar';
            const chapterDesc = document.createElement('div');
            chapterDesc.className = 'enhanced-option-description';
            chapterDesc.textContent = 'Show chapter ticks on the seek bar, chapter titles in tooltips, and skip chapters with Alt+Left / Alt+Right.';
            chapterHeading.appendChild(chapterLabel);
            chapterHeading.appendChild(chapterDesc);

            const chapterContent = document.createElement('div');
            chapterContent.className = 'enhanced-option-content';

            const chapterToggle = document.createElement('div');
            chapterToggle.id = 'chaptermarkersToggle';
            chapterToggle.setAttribute('tabindex', '0');
            chapterToggle.setAttribute('role', 'switch');
            chapterToggle.setAttribute('title', 'Chapter Markers on Seek Bar');
            chapterToggle.className = `toggle-container-lZfHP button-container-zVLH6${isChapterMarkersEnabled() ? ' checked' : ''}`;
            chapterToggle.setAttribute('aria-checked', isChapterMarkersEnabled() ? 'true' : 'false');
            chapterToggle.style.cssText = 'outline: none; cursor: pointer;';

            const chapterKnob = document.createElement('div');
            chapterKnob.className = 'toggle-toOWM';
            chapterToggle.appendChild(chapterKnob);

            const onToggleChapterMarkers = () => {
                const next = !isChapterMarkersEnabled();
                chapterToggle.classList.toggle('checked', next);
                chapterToggle.setAttribute('aria-checked', next ? 'true' : 'false');
                postEnhancedMessage('setChapterMarkers', { enabled: next });
            };
            chapterToggle.addEventListener('click', onToggleChapterMarkers);
            chapterToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleChapterMarkers();
                }
            });

            chapterContent.appendChild(chapterToggle);
            chapterOption.appendChild(chapterHeading);
            chapterOption.appendChild(chapterContent);
            playerCategory.appendChild(chapterOption);

            // Stats for Nerds shortcut reference
            const statsOption = document.createElement('div');
            statsOption.className = 'enhanced-option';
            const statsHeading = document.createElement('div');
            statsHeading.className = 'enhanced-option-heading';
            const statsLabel = document.createElement('div');
            statsLabel.className = 'enhanced-option-label';
            statsLabel.textContent = 'Stats for Nerds & Quick Shader Menu';
            const statsDesc = document.createElement('div');
            statsDesc.className = 'enhanced-option-description';
            statsDesc.textContent = 'During playback, press I to toggle live codec/HDR/hwdec/cache telemetry, or press Ctrl+Shift+U to switch GLSL shaders live.';
            statsHeading.appendChild(statsLabel);
            statsHeading.appendChild(statsDesc);
            statsOption.appendChild(statsHeading);
            playerCategory.appendChild(statsOption);

            // Upscaling & GLSL Shaders subsection
            playerCategory.appendChild(createPlayerSubsection('Upscaling & GLSL Shaders'));
            const openShadersBtn = createOptionButton('openshadersfolderBtn', 'Open Shaders Folder');
            openShadersBtn.onclick = () => {
                postEnhancedMessage('openShadersFolder');
            };
            playerCategory.appendChild(createOptionRow([openShadersBtn]));

            const shadersGrid = document.createElement('div');
            shadersGrid.id = 'enhanced-shaders-grid';
            playerCategory.appendChild(shadersGrid);

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

            // Preferences Category (Shell Interface & MPV settings)
            const preferencesCategory = createCategory('enhanced-preferences-category', 'preferences', 'Preferences', sampleGroup);

            const createSubsectionTitle = (title: string): HTMLElement => {
                const sub = document.createElement('div');
                sub.className = 'enhanced-subsection-title';
                sub.textContent = title;
                return sub;
            };

            const createShellToggleOption = (
                key: BooleanShellPreferenceKey,
                title: string,
                description: string,
                requiresRestart: boolean
            ): HTMLElement => {
                const option = document.createElement('div');
                option.id = `pref-${key}-row`;
                option.className = 'enhanced-option';

                const optHeading = document.createElement('div');
                optHeading.className = 'enhanced-option-heading';
                const optLabel = document.createElement('div');
                optLabel.className = 'enhanced-option-label';
                optLabel.textContent = title;
                const optDesc = document.createElement('div');
                optDesc.className = 'enhanced-option-description';
                optDesc.textContent = description;
                optHeading.appendChild(optLabel);
                optHeading.appendChild(optDesc);

                const optContent = document.createElement('div');
                optContent.className = 'enhanced-option-content';

                const toggle = document.createElement('div');
                toggle.id = `pref-${key}-toggle`;
                toggle.setAttribute('tabindex', '0');
                toggle.setAttribute('role', 'switch');
                toggle.setAttribute('title', title);
                const initialActive = Boolean(currentShellPreferences[key]);
                toggle.className = `toggle-container-lZfHP button-container-zVLH6${initialActive ? ' checked' : ''}`;
                toggle.setAttribute('aria-checked', initialActive ? 'true' : 'false');
                toggle.style.cssText = 'outline: none; cursor: pointer;';

                const knob = document.createElement('div');
                knob.className = 'toggle-toOWM';
                toggle.appendChild(knob);

                const onToggle = () => {
                    const next = !Boolean(currentShellPreferences[key]);
                    currentShellPreferences[key] = next;
                    syncShellPreferencesUI();
                    postEnhancedMessage('setShellPreference', { key, value: next });
                    if (requiresRestart) {
                        modalManager.showToast(
                            `pref-restart-${key}`,
                            'Restart Required',
                            'Restart Stremio Enhanced Shell for this change to take effect.',
                            'info'
                        );
                    }
                };
                toggle.addEventListener('click', onToggle);
                toggle.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle();
                    }
                });

                optContent.appendChild(toggle);
                option.appendChild(optHeading);
                option.appendChild(optContent);
                return option;
            };

            preferencesCategory.appendChild(createSubsectionTitle('Interface'));
            preferencesCategory.appendChild(createShellToggleOption(
                'rememberWindowState',
                'Remember window state',
                'Save and restore window dimensions, maximized and fullscreen state.',
                false
            ));
            preferencesCategory.appendChild(createShellToggleOption(
                'nativeTitlebar',
                'Native window titlebar (Server-Side / OS frame)',
                'Disable the built-in titlebar (CSD) and let your OS window manager draw a native titlebar (SSD). Best supported on X11; Wayland compositors may still fall back to CSD. Requires restarting the application.',
                true
            ));
            preferencesCategory.appendChild(createShellToggleOption(
                'systemTheme',
                'System theme (Client-Side / GTK4 titlebar)',
                'Apply your system GTK4 theme colors and controls to the built-in client-side titlebar (CSD) instead of Libadwaita. Only applies when Native window titlebar is off.',
                false
            ));
            preferencesCategory.appendChild(createShellToggleOption(
                'kdeTheme',
                'KDE theme (Compact Client-Side titlebar)',
                'Use a slimmer titlebar layout tailored for KDE Plasma when using the built-in titlebar. Requires restarting the application.',
                true
            ));
            preferencesCategory.appendChild(createShellToggleOption(
                'noWindowDecorations',
                'Remove window decorations',
                'Removes the titlebar, rounded corners, and drop shadow completely. Requires restarting the application.',
                true
            ));

            preferencesCategory.appendChild(createSubsectionTitle('MPV'));
            const mpvOption = document.createElement('div');
            mpvOption.id = 'pref-mpvConfigLocation-row';
            mpvOption.className = 'enhanced-option';

            const mpvHeading = document.createElement('div');
            mpvHeading.className = 'enhanced-option-heading';
            const mpvLabel = document.createElement('div');
            mpvLabel.className = 'enhanced-option-label';
            mpvLabel.textContent = 'Configuration file location';
            const mpvDesc = document.createElement('div');
            mpvDesc.className = 'enhanced-option-description';
            mpvDesc.textContent = 'Path to custom mpv.conf file (takes effect after restarting the application).';
            mpvHeading.appendChild(mpvLabel);
            mpvHeading.appendChild(mpvDesc);

            const mpvInputGroup = document.createElement('div');
            mpvInputGroup.className = 'enhanced-option-input-group';

            const mpvInput = document.createElement('input');
            mpvInput.id = 'pref-mpvConfigLocation-input';
            mpvInput.type = 'text';
            mpvInput.className = 'enhanced-text-input';
            mpvInput.placeholder = '~/.config/mpv/mpv.conf';
            mpvInput.spellcheck = false;
            mpvInput.autocomplete = 'off';
            mpvInput.value = currentShellPreferences.mpvConfigLocation || '';

            const commitMpvPath = () => {
                const value = mpvInput.value;
                currentShellPreferences.mpvConfigLocation = value;
                postEnhancedMessage('setShellPreference', { key: 'mpvConfigLocation', value });
            };
            mpvInput.addEventListener('change', commitMpvPath);
            mpvInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitMpvPath();
                    mpvInput.blur();
                }
            });

            const mpvBrowseBtn = createOptionButton('pref-mpvConfigLocation-browse', 'Browse');
            mpvBrowseBtn.onclick = () => {
                postEnhancedMessage('browseMpvConfigFile');
            };

            mpvInputGroup.appendChild(mpvInput);
            mpvInputGroup.appendChild(mpvBrowseBtn);
            mpvOption.appendChild(mpvHeading);
            mpvOption.appendChild(mpvInputGroup);
            preferencesCategory.appendChild(mpvOption);
            page.appendChild(preferencesCategory);

            // Client Updates Category
            const updatesCategory = createCategory('enhanced-updates-category', 'updates', 'Client Updates', sampleGroup);
            const checkClientUpdatesBtn = createOptionButton('checkclientupdatesBtn', 'Check for Client Updates');
            const installClientUpdateBtn = createOptionButton('installclientupdateBtn', 'Download & Install Update');
            installClientUpdateBtn.style.display = 'none';
            installClientUpdateBtn.style.backgroundColor = 'var(--accent-color, var(--primary-accent-color, #7b5bf5))';
            const viewPatchNotesBtn = createOptionButton('viewpatchnotesBtn', 'View Patch Notes');
            const openClientReleasesBtn = createOptionButton('openclientreleasesBtn', 'View Releases');
            openClientReleasesBtn.setAttribute('title', 'View Releases on GitHub');

            const clientVersionInfo = document.createElement('div');
            clientVersionInfo.id = 'enhanced-client-version-info';
            clientVersionInfo.style.cssText = 'font-size: 0.9rem; color: #a0a0a0; margin-top: 0.5rem; margin-left: 0.2rem;';

            const patchNotesContainer = document.createElement('div');
            patchNotesContainer.id = 'enhanced-client-patch-notes';
            patchNotesContainer.className = 'enhanced-patch-notes';
            patchNotesContainer.style.display = 'none';

            const renderClientVersionInfo = () => {
                const currentVer = getCurrentClientVersion();
                const latest = getLatestClientVersion();
                const info = getInstallInfo();
                const installLabel =
                    info.installType === 'appimage'
                        ? (info.canSelfUpdate ? 'AppImage (Auto-Update Ready)' : 'AppImage (Read-Only)')
                        : info.installType === 'flatpak'
                            ? 'Flatpak'
                            : 'Native';
                const installPill = `<span style="margin-left:0.5rem;padding:0.12rem 0.55rem;border-radius:999px;font-size:0.78rem;background:rgba(255,255,255,0.09);color:#d4d4d8;">${escapeHtml(installLabel)}</span>`;

                if (!latest) {
                    clientVersionInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Installed Version:</span> v${escapeHtml(currentVer)}${installPill}`;
                    installClientUpdateBtn.style.display = 'none';
                    patchNotesContainer.style.display = 'none';
                    return;
                }
                const hasUpdate = isNewerVersion(latest.version, currentVer);
                const badge = hasUpdate
                    ? `<span style="color: #fcc419; font-weight: 600;">● Update available: v${escapeHtml(latest.version)}</span>`
                    : `<span style="color: #51cf66;">● Up to date (v${escapeHtml(latest.version)})</span>`;
                clientVersionInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Installed Version:</span> v${escapeHtml(currentVer)} &bull; ${badge}${installPill}`;

                installClientUpdateBtn.style.display = hasUpdate && canSelfUpdateAppImage(latest) ? 'inline-flex' : 'none';

                if (latest.body && latest.body.trim()) {
                    const releaseTitle = latest.releaseName || `Release v${latest.version}`;
                    patchNotesContainer.innerHTML = `
                        <div style="font-weight:700;font-size:0.94rem;color:#fff;margin-bottom:8px;">Latest Release Notes — ${escapeHtml(releaseTitle)}</div>
                        ${renderPatchNotesMarkdown(latest.body)}
                    `;
                    patchNotesContainer.style.display = 'block';
                } else {
                    patchNotesContainer.style.display = 'none';
                }
            };

            checkClientUpdatesBtn.onclick = async () => {
                await checkClientUpdate(true);
                renderClientVersionInfo();
            };

            installClientUpdateBtn.onclick = async () => {
                const latest = getLatestClientVersion() || (await fetchLatestClientVersion());
                if (latest && canSelfUpdateAppImage(latest)) {
                    await startAppImageSelfUpdate(latest);
                }
            };

            viewPatchNotesBtn.onclick = async () => {
                await showPatchNotesModal(getLatestClientVersion());
            };

            openClientReleasesBtn.onclick = () => {
                const url = getLatestClientVersion()?.releaseUrl || CLIENT_RELEASES_URL;
                try {
                    window.open(url, '_blank');
                } catch (_) {}
            };

            updatesCategory.appendChild(
                createOptionRow([checkClientUpdatesBtn, installClientUpdateBtn, viewPatchNotesBtn, openClientReleasesBtn])
            );
            updatesCategory.appendChild(clientVersionInfo);
            updatesCategory.appendChild(patchNotesContainer);
            page.appendChild(updatesCategory);

            container.appendChild(page);
            pane.appendChild(container);
            syncListLayoutUI();

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
            syncChapterMarkersToggle();
            syncShaderSettingsUI();
            syncShellPreferencesUI();

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
        document.getElementById(SETTINGS_STYLE_ID)?.remove();
        return;
    }

    injectSettingsStyles();
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
