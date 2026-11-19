import { PermanentCore } from '../core/permanentCore';
import { postEnhancedMessage } from '../utils/dom';
import { EnhancedData } from '../types';

interface ThumbnailPayload {
    time: number;
    dataUrl: string;
    width: number;
    height: number;
}

interface CachedThumbnail {
    dataUrl: string;
    width: number;
    height: number;
}

const MAX_JS_CACHE_ENTRIES = 150;
const REQUEST_THROTTLE_MS = 80;
const NORMAL_PREVIEW_WIDTH = 240;
const PIP_PREVIEW_WIDTH = 160;

let previewEnabled = true;
let initialized = false;
let currentStreamKey = '';
const thumbCache = new Map<string, CachedThumbnail>();

let previewEl: HTMLDivElement | null = null;
let frameWrapEl: HTMLDivElement | null = null;
let imgEl: HTMLImageElement | null = null;
let timeEl: HTMLDivElement | null = null;

let isVisible = false;
let draggingSlider: HTMLElement | null = null;
let lastHoveredTime = -1;
let lastPreviewWidth = NORMAL_PREVIEW_WIDTH;
let lastRequestSentAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTrailingRequest: { time: number; maxWidth: number } | null = null;
let lastDisplayFrameSize: { width: number; height: number } | null = null;

export function isThumbnailPreviewEnabled(): boolean {
    return previewEnabled;
}

export function updateThumbnailPreviewData(data: EnhancedData): void {
    if (typeof data.thumbnailPreview === 'boolean') {
        previewEnabled = data.thumbnailPreview;
        if (!previewEnabled) {
            hidePreview();
            thumbCache.clear();
        }
        syncThumbnailPreviewToggle();
    }
}

export function syncThumbnailPreviewToggle(): void {
    const toggle = document.getElementById('thumbnailpreviewToggle');
    if (!toggle) return;
    toggle.classList.toggle('checked', previewEnabled);
    toggle.setAttribute('aria-checked', previewEnabled ? 'true' : 'false');
}

function getDurationSeconds(): number {
    const coreDur = Number(PermanentCore.getState?.('player')?.duration || 0) / 1000;
    if (Number.isFinite(coreDur) && coreDur > 0) return coreDur;
    const bridge = document.getElementById('stremio-shell-bridge-video') as HTMLVideoElement | null;
    const bridgeDur = Number(bridge?.duration || 0);
    return Number.isFinite(bridgeDur) && bridgeDur > 0 ? bridgeDur : 0;
}

function getCurrentStreamKey(): string {
    const state = PermanentCore.getState?.('player');
    const coreUrl = state?.selected?.stream?.url;
    if (coreUrl) return String(coreUrl);
    const bridge = document.getElementById('stremio-shell-bridge-video') as HTMLVideoElement | null;
    return bridge?.getAttribute('src') || '';
}

function ensureStreamCacheScope(): string {
    const key = getCurrentStreamKey();
    if (key && key !== currentStreamKey) {
        currentStreamKey = key;
        thumbCache.clear();
        lastDisplayFrameSize = null;
        if (imgEl) {
            imgEl.removeAttribute('src');
            imgEl.style.opacity = '0';
        }
    }
    return currentStreamKey;
}

function quantizeTime(timeSec: number, duration: number): number {
    const step = duration > 0 && duration <= 120 ? 0.5 : 1;
    return Math.round(timeSec / step) * step;
}

function makeCacheKey(streamKey: string, qTime: number, maxWidth: number): string {
    return `${streamKey}|${qTime.toFixed(1)}|${maxWidth}`;
}

function formatTimestamp(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    if (hrs > 0) {
        return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
}

function ensurePreviewElement(): void {
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'stremio-enhanced-thumb-preview';
        Object.assign(previewEl.style, {
            position: 'fixed',
            left: '0px',
            bottom: '0px',
            display: 'none',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
            zIndex: '2147483000',
            backgroundColor: 'rgba(12, 11, 17, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderRadius: '10px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
            userSelect: 'none'
        });

        frameWrapEl = document.createElement('div');
        Object.assign(frameWrapEl.style, {
            width: `${NORMAL_PREVIEW_WIDTH}px`,
            height: `${Math.round((NORMAL_PREVIEW_WIDTH * 9) / 16)}px`,
            backgroundColor: '#09090d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative'
        });

        imgEl = document.createElement('img');
        imgEl.alt = 'Thumbnail preview';
        Object.assign(imgEl.style, {
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: '0',
            transition: 'opacity 0.1s ease'
        });

        timeEl = document.createElement('div');
        Object.assign(timeEl.style, {
            width: '100%',
            textAlign: 'center',
            padding: '5px 8px',
            fontSize: '0.85rem',
            fontWeight: '600',
            fontVariantNumeric: 'tabular-nums',
            color: 'rgba(255, 255, 255, 0.95)',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            boxSizing: 'border-box',
            lineHeight: '1.2'
        });
        timeEl.textContent = '0:00';

        frameWrapEl.appendChild(imgEl);
        previewEl.appendChild(frameWrapEl);
        previewEl.appendChild(timeEl);
    }

    const playerContainer = document.querySelector<HTMLElement>('[class*="player-container"]');
    const targetParent = playerContainer || document.body;
    if (targetParent && previewEl.parentElement !== targetParent) {
        targetParent.appendChild(previewEl);
    }
}

function applyThumbToDom(thumb: CachedThumbnail): void {
    if (!imgEl || !frameWrapEl) return;
    lastDisplayFrameSize = { width: thumb.width, height: thumb.height };
    frameWrapEl.style.width = `${thumb.width}px`;
    frameWrapEl.style.height = `${thumb.height}px`;
    if (imgEl.src !== thumb.dataUrl) {
        imgEl.src = thumb.dataUrl;
    }
    imgEl.style.opacity = '1';
}

function hidePreview(): void {
    isVisible = false;
    lastHoveredTime = -1;
    pendingTrailingRequest = null;
    if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
    }
    if (previewEl) {
        previewEl.style.display = 'none';
    }
}

function dispatchThumbnailRequest(time: number, maxWidth: number): void {
    const now = Date.now();
    const elapsed = now - lastRequestSentAt;

    if (elapsed >= REQUEST_THROTTLE_MS) {
        lastRequestSentAt = now;
        pendingTrailingRequest = null;
        if (trailingTimer) {
            clearTimeout(trailingTimer);
            trailingTimer = null;
        }
        postEnhancedMessage('requestThumbnail', { time, maxWidth });
        return;
    }

    pendingTrailingRequest = { time, maxWidth };
    if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
            trailingTimer = null;
            if (!isVisible || !previewEnabled || !pendingTrailingRequest) return;
            const req = pendingTrailingRequest;
            pendingTrailingRequest = null;
            lastRequestSentAt = Date.now();
            postEnhancedMessage('requestThumbnail', { time: req.time, maxWidth: req.maxWidth });
        }, REQUEST_THROTTLE_MS - elapsed);
    }
}

function findSeekSlider(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('[class*="seek-bar-container-"] [class*="slider-container-"]');
}

function isLiveSeekBar(slider: HTMLElement): boolean {
    if (slider.classList.contains('disabled')) return true;
    const seekContainer = slider.closest('[class*="seek-bar-container-"]');
    if (!seekContainer) return true;
    return seekContainer.querySelector('[class*="live-badge-layer-"]') !== null;
}

function updatePreviewAtPointer(slider: HTMLElement, clientX: number): void {
    if (!previewEnabled || isLiveSeekBar(slider)) {
        hidePreview();
        return;
    }

    const duration = getDurationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) {
        hidePreview();
        return;
    }

    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0) {
        hidePreview();
        return;
    }

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;

    const isPip = document.documentElement.classList.contains('stremio-pip-mode');
    const previewW = isPip ? PIP_PREVIEW_WIDTH : NORMAL_PREVIEW_WIDTH;
    lastPreviewWidth = previewW;
    lastHoveredTime = targetTime;

    ensurePreviewElement();
    if (!previewEl || !frameWrapEl || !imgEl || !timeEl) return;

    const streamKey = ensureStreamCacheScope();
    const qTime = quantizeTime(targetTime, duration);
    const cacheKey = makeCacheKey(streamKey, qTime, previewW);
    const cached = thumbCache.get(cacheKey);

    if (cached) {
        applyThumbToDom(cached);
    } else {
        const defaultH = lastDisplayFrameSize
            ? Math.round((previewW * lastDisplayFrameSize.height) / lastDisplayFrameSize.width)
            : Math.round((previewW * 9) / 16);
        frameWrapEl.style.width = `${previewW}px`;
        frameWrapEl.style.height = `${defaultH}px`;
        if (!imgEl.getAttribute('src')) {
            imgEl.style.opacity = '0';
        }
        dispatchThumbnailRequest(targetTime, previewW);
    }

    timeEl.textContent = formatTimestamp(targetTime);

    const cardWidth = Number.parseFloat(frameWrapEl.style.width) || previewW;
    const clampedLeft = Math.min(
        window.innerWidth - cardWidth - 12,
        Math.max(12, clientX - cardWidth / 2)
    );
    const bottomOffset = Math.max(12, window.innerHeight - rect.top + 14);

    previewEl.style.left = `${Math.round(clampedLeft)}px`;
    previewEl.style.bottom = `${Math.round(bottomOffset)}px`;
    previewEl.style.display = 'flex';
    isVisible = true;
}

export function setupThumbnailPreview(): void {
    if (initialized) return;
    initialized = true;

    (window as any).__receiveThumbnailPreview = function (payload: ThumbnailPayload) {
        if (!payload || !payload.dataUrl || !Number.isFinite(payload.time)) return;

        const duration = getDurationSeconds();
        const streamKey = ensureStreamCacheScope();
        const widthKey = payload.width || lastPreviewWidth || NORMAL_PREVIEW_WIDTH;
        const qTime = quantizeTime(payload.time, duration);
        const cacheKey = makeCacheKey(streamKey, qTime, widthKey);

        if (thumbCache.size >= MAX_JS_CACHE_ENTRIES && !thumbCache.has(cacheKey)) {
            const oldest = thumbCache.keys().next().value;
            if (oldest !== undefined) thumbCache.delete(oldest);
        }
        const entry: CachedThumbnail = {
            dataUrl: payload.dataUrl,
            width: payload.width || NORMAL_PREVIEW_WIDTH,
            height: payload.height || Math.round((NORMAL_PREVIEW_WIDTH * 9) / 16)
        };
        thumbCache.set(cacheKey, entry);

        if (isVisible && previewEnabled && lastHoveredTime >= 0) {
            const delta = Math.abs(payload.time - lastHoveredTime);
            const maxTolerance = Math.max(2.5, duration * 0.015);
            if (delta <= maxTolerance || !imgEl?.getAttribute('src')) {
                applyThumbToDom(entry);
            }
        }
    };

    document.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return;
        const slider = findSeekSlider(e.target);
        if (slider) {
            draggingSlider = slider;
            updatePreviewAtPointer(slider, e.clientX);
        }
    }, true);

    document.addEventListener('pointermove', (e: PointerEvent) => {
        if (!previewEnabled) {
            if (isVisible) hidePreview();
            return;
        }

        if (draggingSlider) {
            if (!document.body.contains(draggingSlider)) {
                draggingSlider = null;
                hidePreview();
                return;
            }
            updatePreviewAtPointer(draggingSlider, e.clientX);
            return;
        }

        const slider = findSeekSlider(e.target);
        if (slider) {
            updatePreviewAtPointer(slider, e.clientX);
        } else if (isVisible) {
            hidePreview();
        }
    }, true);

    window.addEventListener('pointerup', (e: PointerEvent) => {
        if (!draggingSlider) return;
        const hovered = findSeekSlider(e.target);
        draggingSlider = null;
        if (!hovered) {
            hidePreview();
        }
    }, true);

    document.addEventListener('mouseleave', () => {
        if (!draggingSlider && isVisible) {
            hidePreview();
        }
    });

    window.addEventListener('blur', () => {
        draggingSlider = null;
        hidePreview();
    });

    const onRouteChange = () => {
        const inPlayer =
            window.location.hash.startsWith('#/player') ||
            document.querySelector('[class*="player-container"]') !== null;
        if (!inPlayer) {
            draggingSlider = null;
            hidePreview();
        }
    };
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
}
