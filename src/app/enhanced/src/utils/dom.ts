export function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function waitForElement<T extends Element = HTMLElement>(selector: string, timeout = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
        const elm = document.querySelector<T>(selector);
        if (elm) return resolve(elm);

        const observer = new MutationObserver(() => {
            const found = document.querySelector<T>(selector);
            if (found) {
                observer.disconnect();
                resolve(found);
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timeout waiting for: ' + selector));
        }, timeout);
    });
}

export function postEnhancedMessage(action: string, payload: Record<string, any> = {}): void {
    try {
        const msg = JSON.stringify({ action, ...payload });
        if ((window as any).webkit?.messageHandlers?.enhanced?.postMessage) {
            (window as any).webkit.messageHandlers.enhanced.postMessage(msg);
        } else if ((window as any).webkit?.messageHandlers?.enhancedIpc?.postMessage) {
            (window as any).webkit.messageHandlers.enhancedIpc.postMessage(msg);
        } else if ((window as any).ipc?.postMessage) {
            (window as any).ipc.postMessage(msg);
        }
    } catch (e) {
        console.warn('[Enhanced] Failed to post enhanced IPC message:', e);
    }
}

export function injectFallbackStyles(): void {
    if (document.getElementById('stremio-enhanced-injected-styles')) return;
    const style = document.createElement('style');
    style.id = 'stremio-enhanced-injected-styles';
    style.textContent = `
        #enhanced-nav-btn {
            user-select: none;
            font-size: 1.1rem !important;
        }
        #enhanced > .label-wXG3e, #enhanced > [class*="label-"] {
            font-size: 1.8rem !important;
            font-weight: 700 !important;
            line-height: 3.4rem !important;
            margin-bottom: 2rem !important;
        }
        .theme-apply-btn, .plugin-toggle, #openthemesfolderBtn, #openpluginsfolderBtn, #browsePluginsThemesBtn, .modActionBtn, .marketplace-repo-btn {
            transition: all 0.2s ease-in-out;
        }
        .modActionBtn {
            cursor: pointer;
            user-select: none;
        }
        .marketplace-item-card {
            transition: border-color 0.2s, background-color 0.2s;
        }
        .marketplace-item-card:hover {
            border-color: rgba(255, 255, 255, 0.16) !important;
            background-color: rgba(255, 255, 255, 0.06) !important;
        }
        .marketplace-title {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: unset !important;
            word-break: break-word !important;
            max-width: none !important;
        }
        .marketplace-repo-btn:hover {
            background: rgba(255, 255, 255, 0.16) !important;
            color: #fff !important;
        }
        #marketplace-back-btn:hover {
            background: rgba(255, 255, 255, 0.16) !important;
        }
        .marketplace-tab-view {
            position: absolute !important;
            top: 0 !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 0 !important;
            max-height: 100% !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-y: contain !important;
            box-sizing: border-box !important;
            scrollbar-width: thin !important;
            scrollbar-color: rgba(255, 255, 255, 0.25) transparent !important;
        }
        .marketplace-tab-view::-webkit-scrollbar {
            width: 8px !important;
            display: block !important;
        }
        .marketplace-tab-view::-webkit-scrollbar-track {
            background: transparent !important;
        }
        .marketplace-tab-view::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.25) !important;
            border-radius: 4px !important;
        }
        .marketplace-tab-view::-webkit-scrollbar-thumb:hover {
            background-color: var(--primary-accent-color, #735bf2) !important;
        }
        .logo-WrsGF {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .plugin-toggle, .plugin-setting-toggle {
            cursor: pointer;
        }
        .theme-apply-btn.install-button-container-yfcq5 {
            background-color: var(--primary-accent-color, #735bf2);
            color: #fff;
        }
        .theme-apply-btn.install-button-container-yfcq5:hover {
            filter: brightness(1.1);
        }
        .theme-apply-btn.uninstall-button-container-oV4Yo {
            background-color: rgba(255, 255, 255, 0.15);
            color: #fff;
        }
        .theme-apply-btn.uninstall-button-container-oV4Yo.disabled {
            opacity: 0.85;
            cursor: default;
        }
    `;
    (document.head || document.documentElement || document.body).appendChild(style);
}
