import { ChapterInfo, EnhancedData } from '../types';
import { PermanentCore } from '../core/permanentCore';
import { postEnhancedMessage } from '../utils/dom';
import { modalManager } from '../components/modals/modalManager';

let chapters: ChapterInfo[] = [];
let chapterMarkersEnabled = true;
let initialized = false;
let observer: MutationObserver | null = null;
let renderScheduled = false;

function isPlayerRoute(): boolean {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/player') || hash.includes('/player/')) return true;
    return Boolean(document.documentElement?.classList.contains('stremio-player-active'));
}

function syncChapterObserver(): void {
    const shouldObserve = isPlayerRoute() && chapterMarkersEnabled && chapters.length > 0;
    if (shouldObserve) {
        if (observer || !document.body) return;
        const target = document.getElementById('app') || document.body;
        observer = new MutationObserver(() => {
            if (isPlayerRoute() && chapterMarkersEnabled && chapters.length > 0) {
                scheduleRenderChapterTicks();
            } else {
                syncChapterObserver();
            }
        });
        observer.observe(target, { childList: true, subtree: true });
    } else if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function getDurationSeconds(): number {
    const coreDur = Number(PermanentCore.getState?.('player')?.duration || 0) / 1000;
    if (Number.isFinite(coreDur) && coreDur > 0) return coreDur;
    const bridge = document.getElementById('stremio-shell-bridge-video') as HTMLVideoElement | null;
    const bridgeDur = Number(bridge?.duration || 0);
    return Number.isFinite(bridgeDur) && bridgeDur > 0 ? bridgeDur : 0;
}

function getCurrentTimeSeconds(): number {
    const bridge = document.getElementById('stremio-shell-bridge-video') as HTMLVideoElement | null;
    const bridgeTime = Number(bridge?.currentTime || 0);
    if (Number.isFinite(bridgeTime) && bridgeTime >= 0) return bridgeTime;
    const coreTime = Number(PermanentCore.getState?.('player')?.time || 0) / 1000;
    return Number.isFinite(coreTime) && coreTime >= 0 ? coreTime : 0;
}

export function isChapterMarkersEnabled(): boolean {
    return chapterMarkersEnabled;
}

export function getChapters(): ChapterInfo[] {
    return chapters;
}

export function getChapterAtTime(timeSec: number): ChapterInfo | null {
    if (!chapterMarkersEnabled || chapters.length === 0 || !Number.isFinite(timeSec)) {
        return null;
    }
    let active: ChapterInfo | null = null;
    for (const ch of chapters) {
        if (ch.time <= timeSec + 0.25) {
            active = ch;
        } else {
            break;
        }
    }
    return active;
}

export function updateChapterMarkersData(data: EnhancedData): void {
    if (typeof data.chapterMarkers === 'boolean') {
        chapterMarkersEnabled = data.chapterMarkers;
        syncChapterMarkersToggle();
        syncChapterObserver();
        scheduleRenderChapterTicks();
    }
}

export function syncChapterMarkersToggle(): void {
    const toggle = document.getElementById('chaptermarkersToggle');
    if (!toggle) return;
    toggle.classList.toggle('checked', chapterMarkersEnabled);
    toggle.setAttribute('aria-checked', chapterMarkersEnabled ? 'true' : 'false');
}

function scheduleRenderChapterTicks(): void {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        renderChapterTicks();
    });
}

function renderChapterTicks(): void {
    const existingOverlay = document.getElementById('stremio-enhanced-chapter-overlay');
    if (!chapterMarkersEnabled || chapters.length === 0 || !isPlayerRoute()) {
        existingOverlay?.remove();
        return;
    }

    const slider = document.querySelector<HTMLElement>(
        '[class*="seek-bar-container-"] [class*="slider-container-"]'
    );
    if (!slider) return;

    const seekContainer = slider.closest('[class*="seek-bar-container-"]');
    if (
        slider.classList.contains('disabled') ||
        seekContainer?.querySelector('[class*="live-badge-layer-"]')
    ) {
        existingOverlay?.remove();
        return;
    }

    const duration = getDurationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) {
        existingOverlay?.remove();
        return;
    }

    if (window.getComputedStyle(slider).position === 'static') {
        slider.style.position = 'relative';
    }

    let overlay = slider.querySelector<HTMLDivElement>('#stremio-enhanced-chapter-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'stremio-enhanced-chapter-overlay';
        Object.assign(overlay.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '4',
            overflow: 'visible'
        });
        slider.appendChild(overlay);
    }

    const signature = `${duration.toFixed(1)}|${chapters.map(c => `${c.time.toFixed(2)}:${c.title}`).join(',')}`;
    if (overlay.dataset.signature === signature) return;
    overlay.dataset.signature = signature;
    overlay.innerHTML = '';

    for (const chapter of chapters) {
        if (chapter.time <= 0.5 || chapter.time >= duration - 0.5) continue;
        const pct = Math.min(99.5, Math.max(0.5, (chapter.time / duration) * 100));
        const tick = document.createElement('div');
        tick.className = 'stremio-enhanced-chapter-tick';
        Object.assign(tick.style, {
            position: 'absolute',
            left: `${pct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '2px',
            height: '10px',
            borderRadius: '1px',
            background: 'rgba(255, 255, 255, 0.78)',
            boxShadow: '0 0 3px rgba(0, 0, 0, 0.75)',
            pointerEvents: 'none'
        });
        overlay.appendChild(tick);
    }
}

function jumpChapter(direction: -1 | 1): void {
    if (!chapterMarkersEnabled || chapters.length === 0) return;
    const now = getCurrentTimeSeconds();
    let target: ChapterInfo | null = null;

    if (direction > 0) {
        target = chapters.find(c => c.time > now + 1.0) || null;
    } else {
        for (let i = chapters.length - 1; i >= 0; i--) {
            if (chapters[i].time < now - 2.0) {
                target = chapters[i];
                break;
            }
        }
        if (!target && chapters.length > 0) {
            target = chapters[0];
        }
    }

    if (!target) return;

    try {
        (window as any).ipc?.postMessage?.(
            JSON.stringify({
                type: 6,
                args: ['mpv-command', ['seek', String(target.time), 'absolute']]
            })
        );
        modalManager.showToast('chapter-jump', 'Chapter', target.title, 'info');
    } catch (_) {}
}

export function setupChapterMarkers(): void {
    if (initialized) return;
    initialized = true;

    (window as any).__receiveChapters = function (list: ChapterInfo[]) {
        chapters = Array.isArray(list)
            ? list
                  .filter(c => c && typeof c.time === 'number' && Number.isFinite(c.time))
                  .map(c => ({ title: String(c.title || 'Chapter'), time: c.time }))
                  .sort((a, b) => a.time - b.time)
            : [];
        const overlay = document.getElementById('stremio-enhanced-chapter-overlay');
        if (overlay) delete overlay.dataset.signature;
        syncChapterObserver();
        scheduleRenderChapterTicks();
    };

    window.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (!isPlayerRoute() || !chapterMarkersEnabled || isEditableTarget(e.target)) return;
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    e.stopPropagation();
                    jumpChapter(1);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    e.stopPropagation();
                    jumpChapter(-1);
                }
            }
        },
        true
    );

    const onRouteChange = () => {
        if (isPlayerRoute()) {
            postEnhancedMessage('getChapters');
            syncChapterObserver();
            scheduleRenderChapterTicks();
        } else {
            chapters = [];
            syncChapterObserver();
            document.getElementById('stremio-enhanced-chapter-overlay')?.remove();
        }
    };
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);

    if (isPlayerRoute()) {
        postEnhancedMessage('getChapters');
    }
}
