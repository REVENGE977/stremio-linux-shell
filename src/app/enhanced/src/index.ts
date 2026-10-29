import { setupPermanentCore } from './core/permanentCore';
import { setupLogger } from './utils/logger';
import { setupFetchInterceptor } from './network/fetchInterceptor';
import { setupEnhancedApi, updateApiData, syncLocalStorage } from './api/stremioEnhancedApi';
import { setupVideoBridge, ensureBridgeVideo } from './bridge/videoBridge';
import { setupTransparencyBridge } from './bridge/transparencyBridge';
import { setupMediaCapabilitiesBridge } from './bridge/mediaCapabilitiesBridge';
import { injectFallbackStyles, postEnhancedMessage } from './utils/dom';
import { updateThemeManagerData, applyThemeUI, ensureActiveTheme, renderThemesList } from './themes/themeManager';
import { updatePluginManagerData, loadEnabledPlugins, renderPluginsList } from './plugins/pluginManager';
import { updateMarketplaceData } from './marketplace/marketplaceManager';
import { updateUpdateManagerData, checkForAllUpdates } from './updates/updateManager';
import { checkSettings } from './components/settings/settingsInjector';
import { setupServerManager, updateServerManagerData, checkServerJsUpdateAndSetup } from './server/serverManager';
import { EnhancedData } from './types';

(function () {
    'use strict';

    if ((window as any).__STREMIO_ENHANCED_INITIALIZED__) return;
    (window as any).__STREMIO_ENHANCED_INITIALIZED__ = true;

    (window as any).__STREMIO_SHELL__ = true;

    console.log('[Enhanced] Stremio Enhanced initialized.');

    // Initialize subsystems
    setupPermanentCore();
    setupLogger();
    setupFetchInterceptor();
    setupEnhancedApi();
    setupServerManager();
    setupMediaCapabilitiesBridge();
    setupTransparencyBridge();
    setupVideoBridge();
    injectFallbackStyles();

    let currentData: EnhancedData = {
        plugins: [],
        themes: [],
        activeTheme: null
    };

    function updateAllSubsystemData(data: EnhancedData) {
        currentData = data;
        updateApiData(data);
        updateThemeManagerData(data);
        updatePluginManagerData(data);
        updateMarketplaceData(data);
        updateUpdateManagerData(data);
        if (data.serverStatus) {
            updateServerManagerData(data.serverStatus);
        }
    }

    // Data Handler from Rust
    (window as any).__receiveEnhancedData = function (data: EnhancedData) {
        if (!data) return;
        updateAllSubsystemData(data);

        // Auto-apply active theme
        if (currentData.activeTheme) {
            applyThemeUI(currentData.activeTheme);
        } else {
            applyThemeUI('Default');
        }

        // Auto-load all enabled plugins
        loadEnabledPlugins();

        syncLocalStorage();

        renderThemesList((fileName) => {
            (window as any).StremioEnhancedAPI.applyTheme(fileName);
        });
        renderPluginsList((fileName, enabled) => {
            (window as any).StremioEnhancedAPI.togglePlugin(fileName, enabled);
        });

        if (document.getElementById('enhanced')) {
            checkForAllUpdates(false);
        }
    };

    // Check if initial enhanced data was provided by Rust at startup
    if ((window as any).__INITIAL_ENHANCED_DATA__) {
        updateAllSubsystemData((window as any).__INITIAL_ENHANCED_DATA__);
        if (currentData.activeTheme) {
            applyThemeUI(currentData.activeTheme);
        }
        syncLocalStorage();
    }

    // Intercept pushState & replaceState to catch client-side routing changes
    (['pushState', 'replaceState'] as const).forEach(method => {
        const original = history[method];
        history[method] = function (...args: any[]) {
            const result = original.apply(this, args);
            window.dispatchEvent(new Event('hashchange'));
            return result;
        };
    });

    window.addEventListener('hashchange', () => {
        ensureBridgeVideo();
        checkSettings();
    });
    window.addEventListener('popstate', () => {
        ensureBridgeVideo();
        checkSettings();
    });
    window.addEventListener('DOMContentLoaded', () => {
        ensureBridgeVideo();
        ensureActiveTheme();
        loadEnabledPlugins();
        checkSettings();
    });
    window.addEventListener('load', () => {
        ensureBridgeVideo();
        ensureActiveTheme();
        loadEnabledPlugins();
        checkSettings();
    });

    // Request fresh data from Rust immediately on startup
    postEnhancedMessage('getData');

    ensureBridgeVideo();
    checkSettings();

    // Check for streaming server availability and updates shortly after launch
    setTimeout(() => {
        checkServerJsUpdateAndSetup(false);
    }, 1200);
})();
