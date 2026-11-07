import { ServerStatusUiData } from '../types';
import { modalManager } from '../components/modals/modalManager';
import { postEnhancedMessage } from '../utils/dom';
import { isNewerVersion } from '../updates/updateManager';

export const DEFAULT_SERVER_JS_URL = 'https://dl.strem.io/server/v4.21.1/desktop/server.js';
export const CARGO_TOML_URL = 'https://raw.githubusercontent.com/Stremio/stremio-service/refs/heads/master/Cargo.toml';

let currentServerStatus: ServerStatusUiData = {
    exists: false,
    running: false,
    serverDir: '',
    serverPath: '',
    currentVersion: null,
    skippedVersion: null
};

let isCheckingServer = false;
let hasPromptedInitialSetup = false;
export let latestServerJsUrl: string = DEFAULT_SERVER_JS_URL;

const pendingServerStatusRequests = new Map<string, (status: ServerStatusUiData) => void>();
const pendingServerStartRequests = new Map<string, (success: boolean) => void>();
const pendingFfmpegRequests = new Map<string, (success: boolean) => void>();

export function setupServerManager(): void {
    (window as any).__receiveServerStatus = function (id: string, status: ServerStatusUiData) {
        if (status) {
            currentServerStatus = status;
        }
        const resolver = pendingServerStatusRequests.get(id);
        if (resolver) {
            pendingServerStatusRequests.delete(id);
            resolver(status);
        }
    };

    (window as any).__receiveServerStartResult = function (id: string, success: boolean) {
        if (currentServerStatus) {
            currentServerStatus.running = !!success;
        }
        const resolver = pendingServerStartRequests.get(id);
        if (resolver) {
            pendingServerStartRequests.delete(id);
            resolver(success);
        }
    };

    (window as any).__receiveFfmpegResult = function (id: string, success: boolean) {
        if (currentServerStatus && success) {
            currentServerStatus.ffmpegInstalled = true;
        }
        const resolver = pendingFfmpegRequests.get(id);
        if (resolver) {
            pendingFfmpegRequests.delete(id);
            resolver(success);
        }
    };

    if ((window as any).__INITIAL_ENHANCED_DATA__?.serverStatus) {
        currentServerStatus = (window as any).__INITIAL_ENHANCED_DATA__.serverStatus;
    }
}

export function updateServerManagerData(status: ServerStatusUiData): void {
    if (status) {
        currentServerStatus = status;
    }
}

export function getCurrentServerStatus(): ServerStatusUiData {
    return currentServerStatus;
}

export function getServerStatus(): Promise<ServerStatusUiData> {
    return new Promise((resolve) => {
        const id = 'srv_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            if (pendingServerStatusRequests.has(id)) {
                pendingServerStatusRequests.delete(id);
                resolve(currentServerStatus);
            }
        }, 10000);

        pendingServerStatusRequests.set(id, (status) => {
            clearTimeout(timer);
            resolve(status);
        });

        postEnhancedMessage('getServerStatus', { id });
    });
}

let isReloadingToLocal = false;

export function reloadToLocalStreamingServer(): void {
    if (isReloadingToLocal) return;

    if (window.location.hostname === '127.0.0.1') {
        try {
            (window as any).core?.dispatch?.({ action: 'StreamingServer', args: { action: 'Reload' } });
        } catch (_) {}
        return;
    }

    isReloadingToLocal = true;
    const hash = window.location.hash || '#/';
    const targetUrl = `http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fweb.stremio.com/${hash}`;
    console.log('[Enhanced Server] Streaming server running. Reloading from web.stremio.com to local proxy:', targetUrl);

    setTimeout(() => {
        postEnhancedMessage('loadUrl', { url: targetUrl });
        try {
            window.location.replace(targetUrl);
        } catch (_) {
            window.location.href = targetUrl;
        }
    }, 500);
}

export function startStreamingServer(autoReload = true): Promise<boolean> {
    return new Promise((resolve) => {
        const id = 'start_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            if (pendingServerStartRequests.has(id)) {
                pendingServerStartRequests.delete(id);
                resolve(false);
            }
        }, 15000);

        pendingServerStartRequests.set(id, (success) => {
            clearTimeout(timer);
            if (autoReload && success && window.location.hostname !== '127.0.0.1') {
                reloadToLocalStreamingServer();
            }
            resolve(success);
        });

        postEnhancedMessage('startStreamingServer', { id });
    });
}

export function openStreamingServerFolder(): void {
    postEnhancedMessage('openStreamingServerFolder');
}

export async function fetchLatestServerVersion(): Promise<{ version: string; downloadUrl: string } | null> {
    try {
        const res = await window.fetch(CARGO_TOML_URL);
        if (!res.ok) {
            console.warn('[Enhanced Server] Failed to fetch Cargo.toml:', res.status);
            return null;
        }
        const text = await res.text();
        const match = text.match(/\[package\.metadata\.server\][\s\S]*?version\s*=\s*"([^"]+)"/);
        if (!match || !match[1]) {
            console.warn('[Enhanced Server] Could not find server version in Cargo.toml');
            return null;
        }

        let ver = match[1].trim();
        if (!ver.startsWith('v')) {
            ver = 'v' + ver;
        }
        const downloadUrl = `https://dl.strem.io/server/${ver}/desktop/server.js`;
        return { version: ver, downloadUrl };
    } catch (e) {
        console.warn('[Enhanced Server] Error fetching latest server version:', e);
        return null;
    }
}

let activeFfmpegDownload: Promise<boolean> | null = null;

export function downloadFfmpeg(): Promise<boolean> {
    if (activeFfmpegDownload) return activeFfmpegDownload;

    modalManager.showToast(
        'ffmpeg-downloading',
        'FFmpeg Setup',
        'Downloading and extracting FFmpeg for streaming server. Please wait...',
        'info'
    );

    activeFfmpegDownload = new Promise((resolve) => {
        const id = 'ff_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            activeFfmpegDownload = null;
            pendingFfmpegRequests.delete(id);
            resolve(false);
        }, 300000); // 5 min timeout

        pendingFfmpegRequests.set(id, (success) => {
            clearTimeout(timer);
            activeFfmpegDownload = null;
            if (success) {
                if (currentServerStatus) {
                    currentServerStatus.ffmpegInstalled = true;
                }
                modalManager.showToast(
                    'ffmpeg-ready',
                    'FFmpeg Ready',
                    'FFmpeg was installed successfully into the streaming server folder.',
                    'info'
                );
            } else {
                modalManager.showToast(
                    'ffmpeg-failed',
                    'FFmpeg Error',
                    'Failed to download FFmpeg automatically.',
                    'fail'
                );
            }
            resolve(success);
        });

        postEnhancedMessage('downloadFfmpeg', { id });
    });

    return activeFfmpegDownload;
}

/**
 * Displays the download/setup instructions modal loop until the streaming server is ready or the user cancels.
 * Guides the user on either downloading server.js directly or running Stremio Service.
 */
export async function showMissingServerInstructions(downloadUrl: string, serverDir: string): Promise<boolean> {
    let serverReady = false;

    while (!serverReady) {
        const result = await modalManager.showAlert(
            'info',
            'Streaming Server Setup Required',
            `To enable video playback and add-on streaming, a local streaming server is required.\n` +
            `(Note: Due to licensing restrictions, server.js cannot be redistributed directly with this shell).\n\n` +
            `You can choose either of the following setup options:\n\n` +
            `OPTION 1: Use server.js directly (Standalone)\n` +
            `1. Click "Download server.js" (or download from: ${downloadUrl}).\n` +
            `2. Save the file as "server.js" and place it in:\n   ${serverDir}\n` +
            `   (Click "Open Folder" below to open this directory).\n\n` +
            `OPTION 2: Use Stremio Service\n` +
            `If you already have Stremio Service installed, simply start Stremio Service so port 11470 is active. You can also download it from the official Stremio website.\n\n` +
            `When ready, click "Done / Check".`,
            ['Open Folder', 'Download server.js', 'Stremio Service', 'Done / Check']
        );

        if (result === 0) {
            openStreamingServerFolder();
        } else if (result === 1) {
            window.open(downloadUrl, '_blank');
            if (!currentServerStatus?.ffmpegInstalled) {
                downloadFfmpeg();
            }
        } else if (result === 2) {
            window.open('https://www.stremio.com/download-service', '_blank');
        } else {
            // User clicked Done / Check - check status
            const freshStatus = await getServerStatus();
            if (freshStatus && (freshStatus.running || freshStatus.exists)) {
                serverReady = true;
                if (!freshStatus.running && freshStatus.exists) {
                    if (!freshStatus.ffmpegInstalled) {
                        modalManager.showToast(
                            'ffmpeg-setup',
                            'FFmpeg Setup',
                            'Ensuring FFmpeg is installed before starting...',
                            'info'
                        );
                        await downloadFfmpeg();
                    }
                    console.log('[Enhanced Server] server.js found. Starting streaming server...');
                    const started = await startStreamingServer(false);
                    if (started) {
                        await modalManager.showAlert(
                            'info',
                            'Streaming Server Setup Complete',
                            'The streaming server has started successfully. The application will now connect to the local streaming server.',
                            ['OK']
                        );
                        reloadToLocalStreamingServer();
                        return true;
                    }
                } else if (freshStatus.running) {
                    await modalManager.showAlert(
                        'info',
                        'Streaming Server Connected',
                        'Local streaming server (Stremio Service) is online! The application will now connect to the local server.',
                        ['OK']
                    );
                    reloadToLocalStreamingServer();
                    return true;
                }
            } else {
                const warnResult = await modalManager.showAlert(
                    'warning',
                    'Streaming Server Not Detected',
                    `Neither server.js was found in:\n${serverDir}\n\nnor is Stremio Service running on port 11470.\n\nPlease place server.js in the folder or start Stremio Service. Would you like to try again?`,
                    ['Try Again', 'Cancel']
                );

                if (warnResult === 1) {
                    serverReady = true;
                    return false;
                }
            }
        }
    }

    return false;
}

/**
 * Checks for streaming server availability and updates.
 * Prompts the user with instructions if server.js is missing or if an update is available.
 */
export async function checkServerJsUpdateAndSetup(isManual = false): Promise<void> {
    if (isCheckingServer) return;
    isCheckingServer = true;

    if (isManual) {
        modalManager.showToast(
            'checking-server-update',
            'Checking Server',
            'Checking for streaming server updates...',
            'info'
        );
    }

    try {
        const status = await getServerStatus();
        const serverDir = status.serverDir;

        const remote = await fetchLatestServerVersion();
        const latestVersion = remote?.version || 'v4.21.1';
        const downloadUrl = remote?.downloadUrl || DEFAULT_SERVER_JS_URL;
        latestServerJsUrl = downloadUrl;

        if (!status.exists && !status.running) {
            console.log('[Enhanced Server] Neither server.js nor Stremio Service found running. Showing setup instructions...');
            hasPromptedInitialSetup = true;
            await showMissingServerInstructions(downloadUrl, serverDir);
        } else {
            // If server is already running (via Stremio Service or managed process)
            if (status.running) {
                if (window.location.hostname !== '127.0.0.1') {
                    console.log('[Enhanced Server] Streaming server is running. Switching from web.stremio.com to 127.0.0.1...');
                    reloadToLocalStreamingServer();
                    return;
                }
            } else if (status.exists) {
                if (!status.ffmpegInstalled) {
                    console.log('[Enhanced Server] FFmpeg not installed in streamingserver folder. Downloading FFmpeg first...');
                    await downloadFfmpeg();
                }
                console.log('[Enhanced Server] server.js exists. Starting streaming server...');
                const started = await startStreamingServer(false);
                if (started && window.location.hostname !== '127.0.0.1') {
                    reloadToLocalStreamingServer();
                    return;
                }
            }

            // Server exists - check for update if version is known
            const currentVer = status.currentVersion;
            const skippedVer = status.skippedVersion;

            const isDifferent = remote && currentVer && (isNewerVersion(latestVersion, currentVer) || latestVersion !== currentVer);
            if (isDifferent && latestVersion !== skippedVer) {
                const promptMessage = `A new version of the Stremio local server (${latestVersion}) is available. Do you want to update it now?`;
                const response = await modalManager.showAlert(
                    'question',
                    'Server Update',
                    promptMessage,
                    ['Yes', 'No', "No and don't ask again"]
                );

                if (response === 0) {
                    // User agreed to update
                    postEnhancedMessage('prepareServerUpdate', { version: latestVersion });
                    await showMissingServerInstructions(downloadUrl, serverDir);
                } else if (response === 2) {
                    // Do not ask again for this version
                    postEnhancedMessage('skipServerVersion', { version: latestVersion });
                }
            } else if (isManual) {
                modalManager.showToast(
                    'server-up-to-date',
                    'Server Up to Date',
                    `Streaming server is up to date (${currentVer || latestVersion}).`,
                    'info'
                );
            }
        }
    } catch (e: any) {
        console.error('[Enhanced Server] Error during server check:', e);
        if (isManual) {
            modalManager.showToast(
                'server-check-error',
                'Check Failed',
                `Failed to check for server updates: ${e?.message || e}`,
                'fail'
            );
        }
    } finally {
        isCheckingServer = false;
    }
}
