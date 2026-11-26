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
        } else if ((window as any).enhancedIpc?.postMessage) {
            (window as any).enhancedIpc.postMessage(msg);
        } else if ((window as any).chrome?.webview?.postMessage) {
            (window as any).chrome.webview.postMessage(msg);
        } else if ((window as any).ipc?.postMessage) {
            (window as any).ipc.postMessage(msg);
        }
    } catch (e) {
        console.warn('[Enhanced] Failed to post enhanced IPC message:', e);
    }
}

const PLAYER_FALLBACK_STYLE_ID = 'stremio-enhanced-player-styles';
const PIP_FALLBACK_STYLE_ID = 'stremio-enhanced-pip-styles';

function mountScopedStyle(id: string, css: string, active: boolean): void {
    const existing = document.getElementById(id);
    if (!active) {
        if (existing) existing.remove();
        return;
    }
    if (existing) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    const target = document.head || document.documentElement || document.body;
    if (target) {
        target.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (!document.getElementById(id)) {
                (document.head || document.documentElement || document.body)?.appendChild(style);
            }
        }, { once: true });
    }
}

export function setPlayerFallbackStyles(active: boolean): void {
    mountScopedStyle(
        PLAYER_FALLBACK_STYLE_ID,
        `
        html.stremio-player-active,
        html.stremio-player-active body,
        html.stremio-player-active #app,
        html.stremio-player-active [class*="player-container"],
        html.stremio-player-active [class*="video-container"],
        html.stremio-player-active [class*="video-layer"] {
            background: transparent !important;
            background-color: transparent !important;
        }
        `,
        active
    );
}

export function setPipFallbackStyles(active: boolean): void {
    mountScopedStyle(
        PIP_FALLBACK_STYLE_ID,
        `
        html.stremio-pip-mode [class*="player-container"] [class*="control-bar-container"] {
            zoom: 0.72;
            padding-left: 1rem !important;
            padding-right: 1rem !important;
        }
        html.stremio-pip-mode [class*="player-container"] [class*="nav-bar-container"] {
            zoom: 0.72;
        }
        html.stremio-pip-mode .pip-plugin-button {
            color: var(--accent-color, var(--primary-accent-color, #7b5bf5)) !important;
        }
        html.stremio-pip-mode[data-pip-cursor="nwse-resize"],
        html.stremio-pip-mode[data-pip-cursor="nwse-resize"] * {
            cursor: nwse-resize !important;
        }
        html.stremio-pip-mode[data-pip-cursor="nesw-resize"],
        html.stremio-pip-mode[data-pip-cursor="nesw-resize"] * {
            cursor: nesw-resize !important;
        }
        html.stremio-pip-mode[data-pip-cursor="ew-resize"],
        html.stremio-pip-mode[data-pip-cursor="ew-resize"] * {
            cursor: ew-resize !important;
        }
        html.stremio-pip-mode[data-pip-cursor="ns-resize"],
        html.stremio-pip-mode[data-pip-cursor="ns-resize"] * {
            cursor: ns-resize !important;
        }
        `,
        active
    );
}

export function injectFallbackStyles(): void {
    if (document.getElementById('stremio-enhanced-injected-styles')) return;
    const style = document.createElement('style');
    style.id = 'stremio-enhanced-injected-styles';
    style.textContent = `
        .theme-apply-btn, .plugin-toggle, #toggleallpluginsBtn, #openthemesfolderBtn, #openpluginsfolderBtn, #openserverfolderBtn, #checkserverupdatesBtn, .modActionBtn, .marketplace-repo-btn {
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
        .logo-WrsGF {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .plugin-toggle, .plugin-setting-toggle {
            cursor: pointer;
        }
        .plugin-settings-btn:hover {
            background-color: rgba(255, 255, 255, 0.16) !important;
        }
        .plugin-delete-btn:hover,
        .theme-delete-btn:hover {
            background-color: rgba(220, 38, 38, 0.22) !important;
            color: #ff6b6b !important;
        }
        .theme-apply-btn.install-button-container-yfcq5 {
            background-color: var(--action-background-color, var(--action-color, var(--accent-color, var(--primary-accent-color, #735bf2))));
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
    const target = document.head || document.documentElement || document.body;
    if (target) {
        target.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            (document.head || document.documentElement || document.body)?.appendChild(style);
        }, { once: true });
    }
}
