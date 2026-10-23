import settingsSectionTemplate from './settings-section.html';
import { TemplateCache } from '../../utils/templateCache';
import { waitForElement, postEnhancedMessage } from '../../utils/dom';
import { THEME_ICON, PLUGIN_ICON, MARKETPLACE_ICON, SERVER_ICON } from '../../utils/icons';
import { renderThemesList } from '../../themes/themeManager';
import { renderPluginsList } from '../../plugins/pluginManager';
import { browseMarketplace } from '../../marketplace/marketplaceManager';
import { openStreamingServerFolder, checkServerJsUpdateAndSetup, getCurrentServerStatus, getServerStatus, startStreamingServer, reloadToLocalStreamingServer } from '../../server/serverManager';

export function checkSettings(): void {
    if (!location.href.includes('#/settings')) return;
    if (document.getElementById('enhanced')) return;

    waitForElement('[class*="sections-container"]', 10000).then(sectionsContainer => {
        if (document.getElementById('enhanced')) return;

        // Fetch fresh list from Rust
        postEnhancedMessage('getData');

        injectNav();
        injectSection(sectionsContainer);
    }).catch(err => {
        console.warn('[Enhanced] Waiting for sections container:', err);
    });
}

function injectNav(): void {
    waitForElement('[title="Shortcuts"]', 5000).then(shortcutsNav => {
        if (document.getElementById('enhanced-nav-btn')) return;
        const menu = shortcutsNav.parentElement;
        if (!menu) return;

        const enhancedNav = document.createElement('div');
        enhancedNav.className = shortcutsNav.className;
        enhancedNav.setAttribute('tabindex', '0');
        enhancedNav.setAttribute('title', 'Enhanced');
        enhancedNav.setAttribute('data-section', 'enhanced');
        enhancedNav.id = 'enhanced-nav-btn';
        enhancedNav.textContent = 'Enhanced';
        enhancedNav.style.cursor = 'pointer';
        enhancedNav.style.outline = 'none';
        enhancedNav.style.fontSize = '1.1rem';

        enhancedNav.addEventListener('click', () => {
            const target = document.getElementById('enhanced');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveNav(enhancedNav);
            }
        });

        shortcutsNav.insertAdjacentElement('afterend', enhancedNav);

        const targetSection = document.getElementById('enhanced');
        if (targetSection) {
            setupScrollObserver(enhancedNav, targetSection);
        }
    }).catch(err => {
        console.warn('[Enhanced] Shortcuts nav item not found:', err);
    });
}

function setActiveNav(navBtn: HTMLElement): void {
    const menu = navBtn.parentElement;
    if (!menu) return;
    let selectedClass = 'selected-S7SeK';
    menu.querySelectorAll('*').forEach(el => {
        el.classList.forEach(cls => {
            if (cls.includes('selected')) {
                selectedClass = cls;
                el.classList.remove(cls);
            }
        });
    });
    navBtn.classList.add(selectedClass);
}

function setupScrollObserver(navBtn: HTMLElement, section: HTMLElement): void {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setActiveNav(navBtn);
            } else {
                navBtn.classList.forEach(cls => {
                    if (cls.includes('selected')) navBtn.classList.remove(cls);
                });
            }
        });
    }, { threshold: 0.1 });
    observer.observe(section);
}

function injectSection(sectionsContainer: Element): void {
    const html = TemplateCache.render(settingsSectionTemplate, {
        themeIcon: THEME_ICON,
        pluginIcon: PLUGIN_ICON,
        marketplaceIcon: MARKETPLACE_ICON,
        serverIcon: SERVER_ICON
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const sectionDiv = wrapper.firstElementChild as HTMLElement;

    // Adapt class names from sibling sections if available
    const sampleSection = document.querySelector('[class*="section-"]');
    if (sampleSection) {
        sectionDiv.className = sampleSection.className;
        const sampleLabel = sampleSection.querySelector(':scope > [class*="label-"]');
        const titleDiv = sectionDiv.querySelector('.label-wXG3e') as HTMLElement;
        if (titleDiv) {
            if (sampleLabel) {
                titleDiv.className = sampleLabel.className;
            }
            titleDiv.style.fontSize = '1.8rem';
            titleDiv.style.fontWeight = '700';
            titleDiv.style.lineHeight = '3.4rem';
            titleDiv.style.marginBottom = '2rem';
        }
    }

    const openThemesBtn = sectionDiv.querySelector<HTMLElement>('#openthemesfolderBtn');
    if (openThemesBtn) {
        openThemesBtn.onclick = () => {
            (window as any).StremioEnhancedAPI.openThemesFolder();
        };
    }

    const openPluginsBtn = sectionDiv.querySelector<HTMLElement>('#openpluginsfolderBtn');
    if (openPluginsBtn) {
        openPluginsBtn.onclick = () => {
            (window as any).StremioEnhancedAPI.openPluginsFolder();
        };
    }

    const browseMarketplaceBtn = sectionDiv.querySelector<HTMLElement>('#browsePluginsThemesBtn');
    if (browseMarketplaceBtn) {
        browseMarketplaceBtn.onclick = () => {
            browseMarketplace();
        };
    }

    const openServerFolderBtn = sectionDiv.querySelector<HTMLElement>('#openserverfolderBtn');
    if (openServerFolderBtn) {
        openServerFolderBtn.onclick = () => {
            openStreamingServerFolder();
        };
    }

    const checkServerUpdatesBtn = sectionDiv.querySelector<HTMLElement>('#checkserverupdatesBtn');
    if (checkServerUpdatesBtn) {
        checkServerUpdatesBtn.onclick = () => {
            checkServerJsUpdateAndSetup(true).then(() => {
                const updated = getCurrentServerStatus();
                if (serverStatusInfo) renderServerInfo(updated);
            });
        };
    }

    const serverStatusInfo = sectionDiv.querySelector<HTMLElement>('#enhanced-server-status-info');
    const renderServerInfo = (status: any) => {
        if (!serverStatusInfo) return;
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

    if (serverStatusInfo) {
        renderServerInfo(getCurrentServerStatus());
        getServerStatus().then(renderServerInfo);
    }

    sectionsContainer.appendChild(sectionDiv);

    renderThemesList((fileName) => {
        (window as any).StremioEnhancedAPI.applyTheme(fileName);
    });
    renderPluginsList((fileName, enabled) => {
        (window as any).StremioEnhancedAPI.togglePlugin(fileName, enabled);
    });

    const navBtn = document.getElementById('enhanced-nav-btn');
    if (navBtn) {
        setupScrollObserver(navBtn, sectionDiv);
    }
}
