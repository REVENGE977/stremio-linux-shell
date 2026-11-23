import { PlaybackStats } from '../types';
import { escapeHtml, postEnhancedMessage } from '../utils/dom';
import { modalManager } from '../components/modals/modalManager';
import { getActiveShaderPresetName, toggleShaderPopover } from './shaderControls';

interface ServerStreamStats {
    peers?: number;
    downloadSpeed?: number;
    swarmConnections?: number;
}

const POLL_INTERVAL_MS = 500;
const MAX_SPEED_SAMPLES = 30;

let statsVisible = false;
let initialized = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let hudEl: HTMLDivElement | null = null;
let lastStats: PlaybackStats | null = null;
let lastServerStats: ServerStreamStats | null = null;
const speedHistory: number[] = [];

const pendingStatsRequests = new Map<string, (stats: PlaybackStats) => void>();

function isPlayerRoute(): boolean {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/player') || hash.includes('/player/')) return true;
    return document.querySelector('[class*="player-container"]') !== null;
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function formatBitrate(bps?: number | null): string {
    if (!bps || !Number.isFinite(bps) || bps <= 0) return 'N/A';
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
    return `${Math.round(bps / 1000)} kbps`;
}

function formatRate(bytesPerSec?: number | null): string {
    if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
    if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(2)} MiB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KiB/s`;
    return `${Math.round(bytesPerSec)} B/s`;
}

function formatFps(fps?: number | null): string {
    if (!fps || !Number.isFinite(fps) || fps <= 0) return '—';
    return fps.toFixed(2);
}

function getResolutionBadge(w?: number | null, h?: number | null): string {
    if (!w || !h) return 'VIDEO';
    if (h >= 2100 || w >= 3800) return '4K UHD';
    if (h >= 1400 || w >= 2500) return '1440p';
    if (h >= 1050 || w >= 1900) return '1080p';
    if (h >= 700 || w >= 1200) return '720p';
    return `${w}x${h}`;
}

function isHdrStream(stats: PlaybackStats): boolean {
    const gamma = (stats.colorGamma || '').toLowerCase();
    const primaries = (stats.colorPrimaries || '').toLowerCase();
    return gamma === 'pq' || gamma === 'hlg' || gamma.includes('2084') || primaries.includes('2020');
}

function buildSparklineSvg(samples: number[]): string {
    const width = 260;
    const height = 28;
    if (samples.length < 2) {
        return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;opacity:0.35;"><line x1="0" y1="${height - 4}" x2="${width}" y2="${height - 4}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/></svg>`;
    }

    const maxVal = Math.max(1024, ...samples);
    const points = samples.map((val, idx) => {
        const x = (idx / (MAX_SPEED_SAMPLES - 1)) * width;
        const y = height - 3 - ((Math.max(0, val) / maxVal) * (height - 6));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
            <polyline fill="none" stroke="#8b74ff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${points.join(' ')}" />
        </svg>
    `;
}

function computeVideoScaleFactor(stats: PlaybackStats): number | null {
    const srcW = stats.dwidth || stats.width;
    const srcH = stats.dheight || stats.height;
    const outW = stats.outputWidth;
    const outH = stats.outputHeight;
    if (!srcW || !srcH || !outW || !outH || srcW <= 0 || srcH <= 0 || outW <= 0 || outH <= 0) {
        return null;
    }
    return Math.min(outW / srcW, outH / srcH);
}

interface ShaderActivityStatus {
    badgeText: string;
    badgeBg: string;
    badgeColor: string;
    detail: string;
}

function getShaderActivityStatus(stats: PlaybackStats, scale: number | null): ShaderActivityStatus | null {
    const shaders = stats.activeShaders || [];
    if (shaders.length === 0) return null;

    let alwaysOnCount = 0;
    let upscalerCount = 0;
    let firingUpscalers = 0;
    let minUpscalerThreshold = Infinity;

    for (const file of shaders) {
        const lower = file.toLowerCase();
        if (lower.includes('fsrcnnx') || lower.includes('artcnn')) {
            upscalerCount++;
            minUpscalerThreshold = Math.min(minUpscalerThreshold, 1.3);
            if (scale !== null && scale > 1.3) firingUpscalers++;
        } else if (lower.includes('anime4k_upscale')) {
            upscalerCount++;
            minUpscalerThreshold = Math.min(minUpscalerThreshold, 1.2);
            if (scale !== null && scale > 1.2) firingUpscalers++;
        } else if (lower.includes('autodownscale')) {
            // Conditional pre-downscale pass
        } else {
            alwaysOnCount++;
        }
    }

    const scaleStr = scale !== null ? `${scale.toFixed(2)}x` : '?';

    if (upscalerCount > 0 && scale !== null) {
        if (firingUpscalers > 0) {
            return {
                badgeText: `Firing (${scaleStr})`,
                badgeBg: 'rgba(34,197,94,0.22)',
                badgeColor: '#86efac',
                detail: `Upscaler active at ${scaleStr} scale`
            };
        }
        if (alwaysOnCount > 0) {
            return {
                badgeText: `1:1 Active (${scaleStr})`,
                badgeBg: 'rgba(56,189,248,0.22)',
                badgeColor: '#7dd3fc',
                detail: `1:1 restore/sharpen pass active; upscaler needs >${minUpscalerThreshold.toFixed(1)}x scale`
            };
        }
        return {
            badgeText: `Bypassed (${scaleStr} <= ${minUpscalerThreshold.toFixed(1)}x)`,
            badgeBg: 'rgba(245,158,11,0.24)',
            badgeColor: '#fcd34d',
            detail: `Upscaler skipped until output exceeds ${minUpscalerThreshold.toFixed(1)}x source size`
        };
    }

    return {
        badgeText: alwaysOnCount > 0 ? `Active (${scaleStr})` : 'Loaded',
        badgeBg: 'rgba(34,197,94,0.22)',
        badgeColor: '#86efac',
        detail: 'Running at native resolution'
    };
}

function formatPlainDiagnostics(stats: PlaybackStats): string {
    const res = stats.width && stats.height ? `${stats.width}x${stats.height}` : 'Unknown';
    const outRes = stats.outputWidth && stats.outputHeight
        ? `${stats.outputWidth}x${stats.outputHeight}`
        : (stats.dwidth && stats.dheight ? `${stats.dwidth}x${stats.dheight}` : res);
    const scale = computeVideoScaleFactor(stats);
    const scaleLabel = scale !== null ? ` (${scale.toFixed(2)}x)` : '';
    const hdr = isHdrStream(stats) ? 'HDR' : 'SDR';
    const shaders = stats.activeShaders && stats.activeShaders.length > 0 ? stats.activeShaders.join(', ') : 'None';
    const shaderStatus = getShaderActivityStatus(stats, scale);
    return [
        `Title: ${stats.mediaTitle || 'N/A'}`,
        `Video: ${stats.videoCodec || 'N/A'} | ${res} -> ${outRes}${scaleLabel} | ${formatFps(stats.estimatedVfFps || stats.containerFps)} fps | ${formatBitrate(stats.videoBitrate)}`,
        `Color/HDR: ${hdr} (${stats.colorPrimaries || '?'} / ${stats.colorGamma || '?'} / ${stats.pixelFormat || '?'})`,
        `HWDEC: ${stats.hwdecCurrent || 'software'} | Display FPS: ${formatFps(stats.displayFps)}`,
        `Audio: ${stats.audioCodec || 'N/A'} | ${stats.audioChannels || '?'} | ${stats.audioSampleRate ? `${(stats.audioSampleRate / 1000).toFixed(1)} kHz` : '?'} | ${formatBitrate(stats.audioBitrate)}`,
        `Sync/Drops: A/V ${stats.avsync !== null && stats.avsync !== undefined ? `${(stats.avsync * 1000).toFixed(1)} ms` : 'N/A'} | Dropped ${stats.droppedFrames ?? 0} (dec ${stats.decoderDroppedFrames ?? 0})`,
        `Buffer: ${stats.cacheDuration !== null && stats.cacheDuration !== undefined ? `${stats.cacheDuration.toFixed(1)}s` : 'N/A'} | Speed ${formatRate(stats.cacheSpeed)}`,
        `Shaders (${getActiveShaderPresetName()}${shaderStatus ? ` - ${shaderStatus.badgeText}` : ''}): ${shaders}`
    ].join('\n');
}

function renderHud(stats: PlaybackStats): void {
    if (!hudEl || !statsVisible) return;

    const hdr = isHdrStream(stats);
    const resBadge = getResolutionBadge(stats.width, stats.height);
    const resText = stats.width && stats.height ? `${stats.width}x${stats.height}` : '—';
    const outText = stats.outputWidth && stats.outputHeight
        ? `${stats.outputWidth}x${stats.outputHeight}`
        : (stats.dwidth && stats.dheight ? `${stats.dwidth}x${stats.dheight}` : resText);
    const scale = computeVideoScaleFactor(stats);
    const scaleText = scale !== null ? ` (${scale.toFixed(2)}x)` : '';
    const hwdec = stats.hwdecCurrent || 'sw (none)';
    const shaderLabel =
        stats.activeShaders && stats.activeShaders.length > 0
            ? `${getActiveShaderPresetName()} (${stats.activeShaders.length})`
            : 'Off';
    const shaderStatus = getShaderActivityStatus(stats, scale);
    const shaderBadgeHtml = shaderStatus
        ? `<span style="margin-left:6px;padding:1px 6px;border-radius:999px;font-size:0.68rem;font-weight:700;background:${shaderStatus.badgeBg};color:${shaderStatus.badgeColor};white-space:nowrap;" title="${escapeHtml(shaderStatus.detail)}">${escapeHtml(shaderStatus.badgeText)}</span>`
        : '';

    const cacheSec =
        stats.cacheDuration !== null && stats.cacheDuration !== undefined
            ? `${stats.cacheDuration.toFixed(1)} s`
            : '—';
    const cacheRate = formatRate(lastServerStats?.downloadSpeed ?? stats.cacheSpeed);
    const peersInfo =
        lastServerStats && typeof lastServerStats.peers === 'number'
            ? ` • ${lastServerStats.peers} peers`
            : '';

    const avsync =
        stats.avsync !== null && stats.avsync !== undefined
            ? `${(stats.avsync * 1000).toFixed(1)} ms`
            : '—';

    const bodyEl = hudEl.querySelector<HTMLElement>('#stremio-enhanced-stats-body');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
            <span style="padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:rgba(123,91,245,0.28);border:1px solid rgba(139,116,255,0.45);color:#d8cfff;">${escapeHtml(resBadge)}</span>
            <span style="padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:${hdr ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.09)'};color:${hdr ? '#fcd34d' : '#d4d4d8'};">${hdr ? 'HDR' : 'SDR'}</span>
            <span style="padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:rgba(255,255,255,0.09);color:#e4e4e7;">${escapeHtml((stats.videoCodec || 'unknown').toUpperCase())}</span>
            <span style="padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;background:${stats.hwdecCurrent ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.09)'};color:${stats.hwdecCurrent ? '#86efac' : '#d4d4d8'};">HWDEC: ${escapeHtml(hwdec)}</span>
        </div>

        <div style="display:grid;grid-template-columns:88px 1fr;gap:4px 10px;font-size:0.79rem;line-height:1.45;font-variant-numeric:tabular-nums;">
            <div style="color:rgba(255,255,255,0.52);">Video</div>
            <div>${escapeHtml(resText)} &rarr; ${escapeHtml(outText)}${escapeHtml(scaleText)} &bull; ${formatFps(stats.estimatedVfFps || stats.containerFps)}/${formatFps(stats.displayFps)} fps &bull; ${escapeHtml(formatBitrate(stats.videoBitrate))}</div>

            <div style="color:rgba(255,255,255,0.52);">Color</div>
            <div>${escapeHtml(stats.colorPrimaries || '—')} / ${escapeHtml(stats.colorGamma || '—')} / ${escapeHtml(stats.pixelFormat || '—')}${stats.sigPeak ? ` (${stats.sigPeak.toFixed(1)}x)` : ''}</div>

            <div style="color:rgba(255,255,255,0.52);">Audio</div>
            <div>${escapeHtml(stats.audioCodec || '—')} &bull; ${escapeHtml(stats.audioChannels || '—')}${stats.audioSampleRate ? ` &bull; ${(stats.audioSampleRate / 1000).toFixed(1)} kHz` : ''} &bull; ${escapeHtml(formatBitrate(stats.audioBitrate))}</div>

            <div style="color:rgba(255,255,255,0.52);">Drops / Sync</div>
            <div>VO: ${stats.droppedFrames ?? 0} &bull; Dec: ${stats.decoderDroppedFrames ?? 0} &bull; Mistimed: ${stats.mistimedFrames ?? 0} &bull; A/V: ${escapeHtml(avsync)}</div>

            <div style="color:rgba(255,255,255,0.52);">Shaders</div>
            <div style="display:flex;align-items:center;min-width:0;" title="${escapeHtml(((stats.activeShaders || []).join(', ')) + (shaderStatus ? ` — ${shaderStatus.detail}` : ''))}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(shaderLabel)}</span>${shaderBadgeHtml}</div>

            <div style="color:rgba(255,255,255,0.52);">Cache</div>
            <div>${escapeHtml(cacheSec)} &bull; ${escapeHtml(cacheRate)}${escapeHtml(peersInfo)}${stats.pausedForCache ? ' <span style="color:#fbbf24;">(Buffering)</span>' : ''}</div>
        </div>

        <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:0.7rem;color:rgba(255,255,255,0.48);">Cache I/O</span>
            ${buildSparklineSvg(speedHistory)}
        </div>
    `;
}

async function pollOnce(): Promise<void> {
    if (!statsVisible || !isPlayerRoute()) {
        toggleStatsOverlay(false);
        return;
    }

    const id = 'st_' + Math.random().toString(36).substring(2, 9);
    const stats = await new Promise<PlaybackStats | null>(resolve => {
        const timer = setTimeout(() => {
            pendingStatsRequests.delete(id);
            resolve(null);
        }, 1200);
        pendingStatsRequests.set(id, s => {
            clearTimeout(timer);
            resolve(s);
        });
        postEnhancedMessage('getPlaybackStats', { id });
    });

    if (!stats || !statsVisible) return;
    lastStats = stats;

    // Opportunistically query local streaming server stats when playing a local torrent/stream URL
    const path = stats.path || '';
    const match = path.match(/^(https?:\/\/127\.0\.0\.1:11470\/[^/]+\/\d+)/);
    if (match) {
        try {
            const ctrl = new AbortController();
            const abortId = setTimeout(() => ctrl.abort(), 700);
            const res = await fetch(`${match[1]}/stats.json`, { signal: ctrl.signal });
            clearTimeout(abortId);
            if (res.ok) {
                lastServerStats = await res.json();
            }
        } catch (_) {
            lastServerStats = null;
        }
    } else {
        lastServerStats = null;
    }

    const rateVal = Number(lastServerStats?.downloadSpeed ?? stats.cacheSpeed ?? 0);
    if (Number.isFinite(rateVal) && rateVal >= 0) {
        speedHistory.push(rateVal);
        if (speedHistory.length > MAX_SPEED_SAMPLES) {
            speedHistory.shift();
        }
    }

    renderHud(stats);
}

function ensureHudElement(): void {
    if (!hudEl) {
        hudEl = document.createElement('div');
        hudEl.id = 'stremio-enhanced-stats-hud';
        Object.assign(hudEl.style, {
            position: 'fixed',
            top: '64px',
            left: '20px',
            width: '360px',
            maxWidth: 'calc(100vw - 40px)',
            zIndex: '2147483100',
            backgroundColor: 'rgba(11, 11, 18, 0.86)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '12px',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(14px)',
            color: '#f4f4f5',
            padding: '12px 14px',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            display: 'none',
            userSelect: 'text'
        });

        hudEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.09);">
                <div style="font-weight:700;font-size:0.9rem;letter-spacing:0.01em;">Stats for Nerds <span style="font-weight:400;font-size:0.74rem;color:rgba(255,255,255,0.5);">[I]</span></div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button type="button" id="stremio-stats-shaders-btn"
                        style="background:rgba(123,91,245,0.28);border:1px solid rgba(139,116,255,0.45);color:#e9e4ff;border-radius:6px;padding:3px 8px;font-size:0.74rem;font-weight:600;cursor:pointer;">Shaders</button>
                    <button type="button" id="stremio-stats-copy-btn"
                        style="background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:6px;padding:3px 8px;font-size:0.74rem;font-weight:600;cursor:pointer;">Copy</button>
                    <button type="button" id="stremio-stats-close-btn"
                        style="background:rgba(255,255,255,0.09);border:none;color:#fff;width:22px;height:22px;border-radius:999px;cursor:pointer;font-size:0.95rem;line-height:1;">&times;</button>
                </div>
            </div>
            <div id="stremio-enhanced-stats-body" style="font-size:0.8rem;color:rgba(255,255,255,0.8);">Collecting playback telemetry...</div>
        `;

        hudEl.querySelector('#stremio-stats-shaders-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            toggleShaderPopover();
        });

        hudEl.querySelector('#stremio-stats-copy-btn')?.addEventListener('click', async e => {
            e.stopPropagation();
            if (!lastStats) return;
            try {
                await navigator.clipboard.writeText(formatPlainDiagnostics(lastStats));
                modalManager.showToast('stats-copied', 'Copied', 'Playback telemetry copied to clipboard.', 'success');
            } catch (_) {}
        });

        hudEl.querySelector('#stremio-stats-close-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            toggleStatsOverlay(false);
        });
    }

    const parent = document.querySelector<HTMLElement>('[class*="player-container"]') || document.body;
    if (parent && hudEl.parentElement !== parent) {
        parent.appendChild(hudEl);
    }
}

export function isStatsOverlayVisible(): boolean {
    return statsVisible;
}

export function toggleStatsOverlay(force?: boolean): void {
    const next = force !== undefined ? force : !statsVisible;
    if (next && !isPlayerRoute()) return;

    statsVisible = next;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    if (!statsVisible) {
        speedHistory.length = 0;
        if (hudEl) hudEl.style.display = 'none';
        return;
    }

    ensureHudElement();
    if (hudEl) hudEl.style.display = 'block';
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

export function setupStatsOverlay(): void {
    if (initialized) return;
    initialized = true;

    (window as any).__receivePlaybackStats = function (id: string, stats: PlaybackStats) {
        const resolver = pendingStatsRequests.get(id);
        if (resolver) {
            pendingStatsRequests.delete(id);
            resolver(stats);
        }
    };

    window.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (!isPlayerRoute() || isEditableTarget(e.target)) return;
            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                e.stopPropagation();
                toggleStatsOverlay();
            }
        },
        true
    );

    const onRoute = () => {
        if (!isPlayerRoute() && statsVisible) {
            toggleStatsOverlay(false);
        }
    };
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('popstate', onRoute);
}
