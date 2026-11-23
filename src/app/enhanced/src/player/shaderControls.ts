import { EnhancedData, ShaderPresetUiData } from '../types';
import { escapeHtml, postEnhancedMessage } from '../utils/dom';
import { modalManager } from '../components/modals/modalManager';

let currentShaderPreset = 'off';
let shaderPresets: ShaderPresetUiData[] = [];
let applyingPresetId: string | null = null;
let initialized = false;

let popoverEl: HTMLDivElement | null = null;
let osdEl: HTMLDivElement | null = null;
let osdTimer: ReturnType<typeof setTimeout> | null = null;

const pendingShaderRequests = new Map<
    string,
    (res: { success: boolean; preset: string; error?: string | null }) => void
>();

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

export function getActiveShaderPreset(): string {
    return currentShaderPreset;
}

export function getActiveShaderPresetName(): string {
    const found = shaderPresets.find(p => p.id === currentShaderPreset);
    return found ? found.name : currentShaderPreset === 'off' ? 'Off (Default)' : currentShaderPreset;
}

export function getShaderPresets(): ShaderPresetUiData[] {
    return shaderPresets;
}

export function updateShaderControlsData(data: EnhancedData): void {
    if (typeof data.shaderPreset === 'string' && data.shaderPreset) {
        currentShaderPreset = data.shaderPreset;
    }
    if (Array.isArray(data.shaderPresets)) {
        shaderPresets = data.shaderPresets;
    }
    syncShaderSettingsUI();
    renderShaderPopover();
}

function showPlayerOsd(text: string): void {
    const container = document.querySelector<HTMLElement>('[class*="player-container"]') || document.body;
    if (!container) return;

    if (!osdEl) {
        osdEl = document.createElement('div');
        osdEl.id = 'stremio-enhanced-shader-osd';
        Object.assign(osdEl.style, {
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: '2147483200',
            padding: '8px 14px',
            borderRadius: '10px',
            backgroundColor: 'rgba(14, 13, 22, 0.88)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            color: '#fff',
            fontSize: '0.88rem',
            fontWeight: '600',
            boxShadow: '0 8px 28px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(12px)',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 0.18s ease'
        });
    }

    if (osdEl.parentElement !== container) {
        container.appendChild(osdEl);
    }

    osdEl.textContent = text;
    osdEl.style.opacity = '1';

    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
        if (osdEl) osdEl.style.opacity = '0';
    }, 2400);
}

export async function applyShaderPreset(presetId: string): Promise<boolean> {
    if (applyingPresetId) return false;
    applyingPresetId = presetId;
    syncShaderSettingsUI();
    renderShaderPopover();

    const preset = shaderPresets.find(p => p.id === presetId);
    if (preset && preset.id !== 'off' && !preset.installed) {
        modalManager.showToast(
            'shader-downloading',
            'Downloading Shaders',
            `Installing ${preset.name} GLSL shader(s)...`,
            'info'
        );
        if (isPlayerRoute()) {
            showPlayerOsd(`Downloading ${preset.name}...`);
        }
    }

    const result = await new Promise<{ success: boolean; preset: string; error?: string | null }>(resolve => {
        const id = 'sh_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            if (pendingShaderRequests.has(id)) {
                pendingShaderRequests.delete(id);
                resolve({ success: false, preset: presetId, error: 'Timed out while applying shader preset.' });
            }
        }, 120000);

        pendingShaderRequests.set(id, res => {
            clearTimeout(timer);
            resolve(res);
        });

        postEnhancedMessage('setShaderPreset', { id, preset: presetId });
    });

    applyingPresetId = null;
    if (result.success) {
        currentShaderPreset = result.preset;
        const name = getActiveShaderPresetName();
        if (isPlayerRoute()) {
            showPlayerOsd(`Shader: ${name}`);
        } else {
            modalManager.showToast('shader-applied', 'Shader Applied', `Active upscaling preset: ${name}`, 'success');
        }
    } else {
        modalManager.showToast(
            'shader-error',
            'Shader Error',
            result.error || 'Failed to download or apply shader preset.',
            'fail'
        );
    }

    syncShaderSettingsUI();
    renderShaderPopover();
    return result.success;
}

export function syncShaderSettingsUI(): void {
    const container = document.getElementById('enhanced-shaders-grid');
    if (!container) return;

    if (shaderPresets.length === 0) {
        container.innerHTML = `<div class="enhanced-option-description">Loading shader presets...</div>`;
        return;
    }

    const categoryOrder = ['Default', 'Sharpening (1:1)', 'Anime4K', 'FSRCNNX', 'ArtCNN'];
    const grouped = new Map<string, ShaderPresetUiData[]>();
    for (const cat of categoryOrder) grouped.set(cat, []);
    for (const preset of shaderPresets) {
        if (!grouped.has(preset.category)) grouped.set(preset.category, []);
        grouped.get(preset.category)!.push(preset);
    }

    let html = '';
    for (const [category, list] of grouped.entries()) {
        if (list.length === 0) continue;
        html += `<div class="enhanced-shader-group-title">${escapeHtml(category)}</div>`;
        html += `<div class="enhanced-shader-grid">`;
        for (const preset of list) {
            const isActive = preset.id === currentShaderPreset;
            const isLoading = preset.id === applyingPresetId;
            const badgeText = isLoading
                ? 'Installing...'
                : preset.id === 'off'
                    ? 'Bypass'
                    : preset.installed
                        ? 'Ready'
                        : 'Download';
            const badgeClass = isLoading
                ? 'loading'
                : preset.installed || preset.id === 'off'
                    ? 'ready'
                    : 'download';

            html += `
                <button type="button"
                    class="enhanced-shader-card${isActive ? ' active' : ''}${isLoading ? ' loading' : ''}"
                    data-shader-preset="${escapeHtml(preset.id)}"
                    ${applyingPresetId ? 'disabled' : ''}>
                    <div class="enhanced-shader-card-top">
                        <span class="enhanced-shader-card-name">${escapeHtml(preset.name)}</span>
                        <span class="enhanced-shader-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
                    </div>
                    <div class="enhanced-shader-card-desc">${escapeHtml(preset.description)}</div>
                </button>
            `;
        }
        html += `</div>`;
    }

    container.innerHTML = html;
    container.querySelectorAll<HTMLButtonElement>('[data-shader-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-shader-preset');
            if (id) applyShaderPreset(id);
        });
    });
}

function renderShaderPopover(): void {
    if (!popoverEl || popoverEl.style.display === 'none') return;

    const categoryOrder = ['Default', 'Sharpening (1:1)', 'Anime4K', 'FSRCNNX', 'ArtCNN'];
    const grouped = new Map<string, ShaderPresetUiData[]>();
    for (const cat of categoryOrder) grouped.set(cat, []);
    for (const p of shaderPresets) {
        if (!grouped.has(p.category)) grouped.set(p.category, []);
        grouped.get(p.category)!.push(p);
    }

    let itemsHtml = '';
    for (const [cat, list] of grouped.entries()) {
        if (list.length === 0) continue;
        itemsHtml += `<div style="font-size:0.7rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin:10px 4px 4px;">${escapeHtml(cat)}</div>`;
        for (const preset of list) {
            const active = preset.id === currentShaderPreset;
            const loading = preset.id === applyingPresetId;
            const tag = loading ? 'Installing...' : preset.id === 'off' ? 'Bypass' : preset.installed ? 'Ready' : 'Download';
            itemsHtml += `
                <button type="button" data-popover-shader="${escapeHtml(preset.id)}" ${applyingPresetId ? 'disabled' : ''}
                    style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;margin-bottom:4px;border-radius:8px;border:1px solid ${active ? 'var(--accent-color, #7b5bf5)' : 'rgba(255,255,255,0.08)'};background:${active ? 'rgba(123,91,245,0.25)' : 'rgba(255,255,255,0.04)'};color:#fff;cursor:${applyingPresetId ? 'wait' : 'pointer'};text-align:left;font-size:0.86rem;">
                    <span style="font-weight:${active ? '700' : '500'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preset.name)}</span>
                    <span style="font-size:0.72rem;padding:2px 7px;border-radius:999px;background:${active ? 'rgba(123,91,245,0.45)' : 'rgba(255,255,255,0.1)'};color:rgba(255,255,255,0.88);flex-shrink:0;">${escapeHtml(tag)}</span>
                </button>
            `;
        }
    }

    const bodyEl = popoverEl.querySelector<HTMLElement>('#stremio-enhanced-shader-popover-body');
    if (bodyEl) {
        bodyEl.innerHTML = itemsHtml;
        bodyEl.querySelectorAll<HTMLButtonElement>('[data-popover-shader]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.getAttribute('data-popover-shader');
                if (id) applyShaderPreset(id);
            });
        });
    }
}

export function closeShaderPopover(): void {
    if (popoverEl) {
        popoverEl.style.display = 'none';
    }
}

export function toggleShaderPopover(force?: boolean): void {
    const show = force !== undefined ? force : !(popoverEl && popoverEl.style.display !== 'none');
    if (!show) {
        closeShaderPopover();
        return;
    }

    if (!popoverEl) {
        popoverEl = document.createElement('div');
        popoverEl.id = 'stremio-enhanced-shader-popover';
        Object.assign(popoverEl.style, {
            position: 'fixed',
            top: '64px',
            right: '20px',
            width: '330px',
            maxHeight: '72vh',
            display: 'none',
            flexDirection: 'column',
            zIndex: '2147483150',
            backgroundColor: 'rgba(13, 12, 22, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderRadius: '12px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(16px)',
            color: '#fff',
            overflow: 'hidden',
            userSelect: 'none'
        });

        popoverEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div>
                    <div style="font-weight:700;font-size:0.95rem;">Upscaling &amp; GLSL Shaders</div>
                    <div style="font-size:0.74rem;color:rgba(255,255,255,0.55);margin-top:2px;">Shortcut: Ctrl+Shift+U</div>
                </div>
                <button type="button" id="stremio-enhanced-shader-popover-close"
                    style="background:rgba(255,255,255,0.08);border:none;color:#fff;width:26px;height:26px;border-radius:999px;cursor:pointer;font-size:1rem;line-height:1;">&times;</button>
            </div>
            <div id="stremio-enhanced-shader-popover-body" style="padding:8px 12px 12px;overflow-y:auto;"></div>
        `;

        popoverEl.querySelector('#stremio-enhanced-shader-popover-close')?.addEventListener('click', e => {
            e.stopPropagation();
            closeShaderPopover();
        });
    }

    const parent = document.querySelector<HTMLElement>('[class*="player-container"]') || document.body;
    if (parent && popoverEl.parentElement !== parent) {
        parent.appendChild(popoverEl);
    }

    popoverEl.style.display = 'flex';
    renderShaderPopover();
}

export function setupShaderControls(): void {
    if (initialized) return;
    initialized = true;

    (window as any).__receiveShaderPresetResult = function (
        id: string,
        success: boolean,
        preset: string,
        error?: string | null
    ) {
        const resolver = pendingShaderRequests.get(id);
        if (resolver) {
            pendingShaderRequests.delete(id);
            resolver({ success, preset, error });
        }
    };

    window.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (!isPlayerRoute() || isEditableTarget(e.target)) return;

            if (e.key === 'Escape' && popoverEl && popoverEl.style.display !== 'none') {
                e.preventDefault();
                e.stopPropagation();
                closeShaderPopover();
                return;
            }

            if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'u') {
                e.preventDefault();
                e.stopPropagation();
                toggleShaderPopover();
            }
        },
        true
    );

    document.addEventListener('pointerdown', (e: PointerEvent) => {
        if (!popoverEl || popoverEl.style.display === 'none') return;
        const target = e.target as Node | null;
        if (target && !popoverEl.contains(target)) {
            closeShaderPopover();
        }
    });

    const onRoute = () => {
        if (!isPlayerRoute()) {
            closeShaderPopover();
        }
    };
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('popstate', onRoute);
}
