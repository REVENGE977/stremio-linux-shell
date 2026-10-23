import { createThemeCard } from '../components/theme-item/themeItem';
import { ThemeUiData, EnhancedData } from '../types';
import { postEnhancedMessage } from '../utils/dom';
import { checkForItemUpdatesUI } from '../updates/updateManager';

let headMutationObserver: MutationObserver | null = null;
let currentEnhancedData: EnhancedData = { plugins: [], themes: [], activeTheme: null };

export function updateThemeManagerData(data: EnhancedData): void {
    currentEnhancedData = data;
}

export function applyThemeCSS(fileName: string): void {
    let activeStyle = document.getElementById('activeTheme') as HTMLStyleElement | null;

    if (fileName === 'Default' || !fileName) {
        if (activeStyle) activeStyle.remove();
        try { localStorage.setItem('currentTheme', 'Default'); } catch (_) { }
        return;
    }

    const targetName = fileName.toLowerCase();
    const themesList = (currentEnhancedData.themes && currentEnhancedData.themes.length > 0)
        ? currentEnhancedData.themes
        : (((window as any).__INITIAL_ENHANCED_DATA__?.themes) || []);

    const foundTheme = themesList.find((t: ThemeUiData) => (t.fileName || '').toLowerCase() === targetName);

    if (!foundTheme || !foundTheme.css) {
        console.warn('[Enhanced] Theme CSS not found for:', fileName);
        return;
    }

    try { localStorage.setItem('currentTheme', foundTheme.fileName); } catch (_) { }

    if (!activeStyle) {
        activeStyle = document.createElement('style');
        activeStyle.id = 'activeTheme';
    }

    if (activeStyle.textContent !== foundTheme.css) {
        activeStyle.textContent = foundTheme.css;
    }

    attachThemeToHead(activeStyle);
}

function attachThemeToHead(styleEl?: HTMLStyleElement): void {
    const activeStyle = styleEl || (document.getElementById('activeTheme') as HTMLStyleElement | null);
    if (!activeStyle) return;

    if (document.head) {
        if (activeStyle.parentElement !== document.head || document.head.lastElementChild !== activeStyle) {
            document.head.appendChild(activeStyle);
        }
        setupHeadObserver();
    } else if (document.documentElement) {
        if (activeStyle.parentElement !== document.documentElement) {
            document.documentElement.appendChild(activeStyle);
        }
        setupDocObserver();
    }
}

function setupDocObserver(): void {
    if ((window as any).__enhancedDocObserver) return;
    (window as any).__enhancedDocObserver = new MutationObserver(() => {
        if (document.head) {
            (window as any).__enhancedDocObserver.disconnect();
            (window as any).__enhancedDocObserver = null;
            attachThemeToHead();
        }
    });
    (window as any).__enhancedDocObserver.observe(document.documentElement, { childList: true });
}

function setupHeadObserver(): void {
    if (headMutationObserver) return;
    if (!document.head) return;

    headMutationObserver = new MutationObserver(() => {
        const activeStyle = document.getElementById('activeTheme');
        if (!activeStyle) return;

        if (document.head.lastElementChild !== activeStyle) {
            headMutationObserver?.disconnect();
            document.head.appendChild(activeStyle);
            headMutationObserver?.observe(document.head, { childList: true });
        }
    });
    headMutationObserver.observe(document.head, { childList: true });
}

export function ensureActiveTheme(): void {
    if (!currentEnhancedData.activeTheme || currentEnhancedData.activeTheme === 'Default') return;
    applyThemeCSS(currentEnhancedData.activeTheme);
}

export function applyThemeUI(fileName: string): void {
    currentEnhancedData.activeTheme = (fileName === 'Default') ? null : fileName;

    const listContainer = document.getElementById('enhanced-themes-list');
    if (listContainer) {
        const currentActive = currentEnhancedData.activeTheme ? currentEnhancedData.activeTheme.toLowerCase() : null;
        listContainer.querySelectorAll<HTMLElement>('.theme-apply-btn').forEach(btn => {
            const targetTheme = (btn.getAttribute('data-theme') || '').toLowerCase();
            const isThisApplied = (!currentActive && targetTheme === 'default') || (currentActive && targetTheme === currentActive);

            if (isThisApplied) {
                btn.className = 'uninstall-button-container-oV4Yo disabled button-container-zVLH6 theme-apply-btn';
                const lbl = btn.querySelector('.label-OnWh2');
                if (lbl) lbl.textContent = 'Applied';
            } else {
                btn.className = 'install-button-container-yfcq5 button-container-zVLH6 theme-apply-btn';
                const lbl = btn.querySelector('.label-OnWh2');
                if (lbl) lbl.textContent = 'Apply';
            }
        });
    }

    applyThemeCSS(fileName);
    try {
        localStorage.setItem('currentTheme', fileName);
    } catch (_) {}
}

export function renderThemesList(onApplyTheme: (fileName: string) => void): void {
    const listContainer = document.getElementById('enhanced-themes-list');
    if (!listContainer) return;

    const currentActive = currentEnhancedData.activeTheme ? currentEnhancedData.activeTheme.toLowerCase() : null;

    const existingBtns = listContainer.querySelectorAll('.theme-apply-btn');
    const expectedCount = (currentEnhancedData.themes ? currentEnhancedData.themes.length : 0) + 1;
    if (existingBtns.length > 0 && existingBtns.length === expectedCount) {
        currentEnhancedData.themes?.forEach(theme => {
            const card = listContainer.querySelector(`[name="${theme.fileName}-box"]`);
            if (card) {
                const versionEl = card.querySelector('.version-container-zdPyN');
                if (versionEl && theme.version) {
                    versionEl.textContent = theme.version;
                    versionEl.setAttribute('title', theme.version);
                }
            }
            checkForItemUpdatesUI(theme.fileName, 'theme');
        });

        existingBtns.forEach(btn => {
            const targetTheme = (btn.getAttribute('data-theme') || '').toLowerCase();
            const isThisApplied = (!currentActive && targetTheme === 'default') || (currentActive && targetTheme === currentActive);
            if (isThisApplied) {
                btn.className = 'uninstall-button-container-oV4Yo disabled button-container-zVLH6 theme-apply-btn';
                const lbl = btn.querySelector('.label-OnWh2');
                if (lbl) lbl.textContent = 'Applied';
            } else {
                btn.className = 'install-button-container-yfcq5 button-container-zVLH6 theme-apply-btn';
                const lbl = btn.querySelector('.label-OnWh2');
                if (lbl) lbl.textContent = 'Apply';
            }
        });
        return;
    }

    listContainer.innerHTML = '';

    // Default Theme
    const isDefaultActive = !currentActive || currentActive === 'default';
    listContainer.appendChild(createThemeCard('Default', {
        name: 'Default',
        version: 'Built-in',
        author: 'Stremio',
        description: 'Default Stremio theme'
    }, isDefaultActive, onApplyTheme));

    // Custom Themes
    if (currentEnhancedData.themes && currentEnhancedData.themes.length > 0) {
        currentEnhancedData.themes.forEach(theme => {
            const isApplied = currentActive === (theme.fileName || '').toLowerCase();
            listContainer.appendChild(createThemeCard(theme.fileName, theme, isApplied, onApplyTheme));
            checkForItemUpdatesUI(theme.fileName, 'theme');
        });
    }
}
