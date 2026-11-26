import { setPlayerFallbackStyles } from '../utils/dom';

let isTransparent = false;
let isEnforcing = false;
const modifiedElements = new Set<HTMLElement>();
let observer: MutationObserver | null = null;
let rafId: number | null = null;

function isPlayerHash(): boolean {
    const hash = window.location.hash || '';
    return hash.startsWith('#/player') || hash.includes('/player/');
}

export function isPlayerRoute(): boolean {
    if (isPlayerHash()) return true;
    return Boolean(document.documentElement?.classList.contains('stremio-player-active'));
}

function stopTransparencyObserver(): void {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function startTransparencyObserver(): void {
    if (observer) return;
    const target = document.getElementById('app') || document.body;
    if (!target) return;

    observer = new MutationObserver(() => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (isPlayerHash() || isTransparent) {
                enforceTransparency();
            }
        });
    });

    observer.observe(target, {
        childList: true,
        subtree: true
    });
}

export function enforceTransparency(force?: boolean): void {
    if (isEnforcing) return;
    isEnforcing = true;

    try {
        const shouldBeTransparent = force !== undefined ? force : isPlayerHash();
        const html = document.documentElement;
        const body = document.body;
        const app = document.getElementById('app');

        if (html && html.classList.contains('stremio-player-active') !== shouldBeTransparent) {
            html.classList.toggle('stremio-player-active', shouldBeTransparent);
        }
        setPlayerFallbackStyles(shouldBeTransparent);

        if (shouldBeTransparent) {
            if (!html || !body) return;
            isTransparent = true;

            const makeTransparent = (el: HTMLElement) => {
                if (el.style.getPropertyValue('background-color') !== 'transparent') {
                    el.style.setProperty('background', 'transparent', 'important');
                    el.style.setProperty('background-color', 'transparent', 'important');
                }
                modifiedElements.add(el);
            };

            makeTransparent(html);
            makeTransparent(body);
            if (app) makeTransparent(app);

            const playerContainer = document.querySelector<HTMLElement>('[class*="player-container"]');
            if (playerContainer) {
                makeTransparent(playerContainer);

                let curr = playerContainer.parentElement;
                while (curr && curr !== body && curr !== html) {
                    makeTransparent(curr);
                    curr = curr.parentElement;
                }
            }

            startTransparencyObserver();
        } else {
            stopTransparencyObserver();

            if (isTransparent) {
                isTransparent = false;
                modifiedElements.forEach(el => {
                    try {
                        el.style.removeProperty('background');
                        el.style.removeProperty('background-color');
                    } catch (_) {}
                });
                modifiedElements.clear();

                html?.style.removeProperty('background');
                html?.style.removeProperty('background-color');
                body?.style.removeProperty('background');
                body?.style.removeProperty('background-color');
                app?.style.removeProperty('background');
                app?.style.removeProperty('background-color');
            }
        }
    } finally {
        isEnforcing = false;
    }
}

export function setupTransparencyBridge(): void {
    enforceTransparency();

    const onRouteChange = () => enforceTransparency();
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);

    if (!document.body) {
        document.addEventListener('DOMContentLoaded', onRouteChange, { once: true });
    }
}
