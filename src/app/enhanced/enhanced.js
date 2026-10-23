(() => {
  // src/core/permanentCore.ts
  var PermanentCore = {
    getState: null,
    dispatch: null
  };
  var originalServices = window.services;
  var originalCore = window.core;
  function isOurWrapper(fn) {
    return !!(fn && fn.__isEnhancedWrapper === true);
  }
  function captureCore(coreObj) {
    if (!coreObj) return;
    if (coreObj.transport && typeof coreObj.transport.getState === "function" && !isOurWrapper(coreObj.transport.getState)) {
      PermanentCore.getState = coreObj.transport.getState.bind(coreObj.transport);
    } else if (typeof coreObj.getState === "function" && !isOurWrapper(coreObj.getState)) {
      PermanentCore.getState = coreObj.getState.bind(coreObj);
    }
    if (coreObj.transport && typeof coreObj.transport.dispatch === "function" && !isOurWrapper(coreObj.transport.dispatch)) {
      PermanentCore.dispatch = coreObj.transport.dispatch.bind(coreObj.transport);
    } else if (typeof coreObj.dispatch === "function" && !isOurWrapper(coreObj.dispatch)) {
      PermanentCore.dispatch = coreObj.dispatch.bind(coreObj);
    }
  }
  function getActiveGetState() {
    if (originalServices && originalServices.core) {
      const t = originalServices.core.transport;
      if (t && typeof t.getState === "function" && !isOurWrapper(t.getState)) {
        return t.getState.bind(t);
      }
      const g = originalServices.core.getState;
      if (typeof g === "function" && !isOurWrapper(g)) {
        return g.bind(originalServices.core);
      }
    }
    if (originalCore) {
      const t = originalCore.transport;
      if (t && typeof t.getState === "function" && !isOurWrapper(t.getState)) {
        return t.getState.bind(t);
      }
      const g = originalCore.getState;
      if (typeof g === "function" && !isOurWrapper(g)) {
        return g.bind(originalCore);
      }
    }
    return PermanentCore.getState && !isOurWrapper(PermanentCore.getState) ? PermanentCore.getState : null;
  }
  function getActiveDispatch() {
    if (originalServices && originalServices.core) {
      const t = originalServices.core.transport;
      if (t && typeof t.dispatch === "function" && !isOurWrapper(t.dispatch)) {
        return t.dispatch.bind(t);
      }
      const d = originalServices.core.dispatch;
      if (typeof d === "function" && !isOurWrapper(d)) {
        return d.bind(originalServices.core);
      }
    }
    if (originalCore) {
      const t = originalCore.transport;
      if (t && typeof t.dispatch === "function" && !isOurWrapper(t.dispatch)) {
        return t.dispatch.bind(t);
      }
      const d = originalCore.dispatch;
      if (typeof d === "function" && !isOurWrapper(d)) {
        return d.bind(originalCore);
      }
    }
    return PermanentCore.dispatch && !isOurWrapper(PermanentCore.dispatch) ? PermanentCore.dispatch : null;
  }
  function createGetStateWrapper() {
    const fn = function(m) {
      const target = getActiveGetState();
      if (target && !isOurWrapper(target)) {
        return target(m);
      }
      return null;
    };
    fn.__isEnhancedWrapper = true;
    return fn;
  }
  function createDispatchWrapper() {
    const fn = function(a) {
      const target = getActiveDispatch();
      if (target && !isOurWrapper(target)) {
        return target(a);
      }
      return null;
    };
    fn.__isEnhancedWrapper = true;
    return fn;
  }
  function setupPermanentCore() {
    try {
      if (originalServices && originalServices.core) {
        captureCore(originalServices.core);
      }
      if (originalCore) {
        captureCore(originalCore);
      }
      Object.defineProperty(window, "services", {
        get() {
          if (!originalServices) originalServices = {};
          if (!originalServices.core) originalServices.core = {};
          if (!originalServices.core.transport) originalServices.core.transport = {};
          if (!originalServices.core.getState || isOurWrapper(originalServices.core.getState)) {
            originalServices.core.getState = createGetStateWrapper();
          }
          if (!originalServices.core.dispatch || isOurWrapper(originalServices.core.dispatch)) {
            originalServices.core.dispatch = createDispatchWrapper();
          }
          if (!originalServices.core.transport.getState || isOurWrapper(originalServices.core.transport.getState)) {
            originalServices.core.transport.getState = createGetStateWrapper();
          }
          if (!originalServices.core.transport.dispatch || isOurWrapper(originalServices.core.transport.dispatch)) {
            originalServices.core.transport.dispatch = createDispatchWrapper();
          }
          return originalServices;
        },
        set(val) {
          originalServices = val;
          if (val && val.core) {
            captureCore(val.core);
          }
        },
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(window, "core", {
        get() {
          if (!originalCore) originalCore = {};
          if (!originalCore.transport) originalCore.transport = {};
          if (!originalCore.getState || isOurWrapper(originalCore.getState)) {
            originalCore.getState = createGetStateWrapper();
          }
          if (!originalCore.dispatch || isOurWrapper(originalCore.dispatch)) {
            originalCore.dispatch = createDispatchWrapper();
          }
          if (!originalCore.transport.getState || isOurWrapper(originalCore.transport.getState)) {
            originalCore.transport.getState = createGetStateWrapper();
          }
          if (!originalCore.transport.dispatch || isOurWrapper(originalCore.transport.dispatch)) {
            originalCore.transport.dispatch = createDispatchWrapper();
          }
          return originalCore;
        },
        set(val) {
          originalCore = val;
          captureCore(val);
        },
        configurable: true,
        enumerable: true
      });
      const captureInterval = setInterval(() => {
        if (window.services && window.services.core) {
          captureCore(window.services.core);
        }
        if (window.core) {
          captureCore(window.core);
        }
        if (PermanentCore.getState && PermanentCore.dispatch) {
          clearInterval(captureInterval);
        }
      }, 500);
      window.PermanentCore = PermanentCore;
    } catch (e) {
      console.warn("[Enhanced] Failed to initialize PermanentCore interceptor:", e);
    }
  }

  // src/utils/dom.ts
  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function waitForElement(selector, timeout = 1e4) {
    return new Promise((resolve, reject) => {
      const elm = document.querySelector(selector);
      if (elm) return resolve(elm);
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
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
        reject(new Error("Timeout waiting for: " + selector));
      }, timeout);
    });
  }
  function postEnhancedMessage(action, payload = {}) {
    try {
      const msg = JSON.stringify({ action, ...payload });
      if (window.webkit?.messageHandlers?.enhanced?.postMessage) {
        window.webkit.messageHandlers.enhanced.postMessage(msg);
      } else if (window.webkit?.messageHandlers?.enhancedIpc?.postMessage) {
        window.webkit.messageHandlers.enhancedIpc.postMessage(msg);
      } else if (window.ipc?.postMessage) {
        window.ipc.postMessage(msg);
      }
    } catch (e) {
      console.warn("[Enhanced] Failed to post enhanced IPC message:", e);
    }
  }
  function injectFallbackStyles() {
    if (document.getElementById("stremio-enhanced-injected-styles")) return;
    const style = document.createElement("style");
    style.id = "stremio-enhanced-injected-styles";
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
        .toggle-container-lZfHP {
            width: 2.6rem;
            height: 1.4rem;
            border-radius: 0.7rem;
            background-color: rgba(255, 255, 255, 0.2);
            position: relative;
            cursor: pointer;
            transition: background-color 0.2s ease;
            display: inline-block;
        }
        .toggle-container-lZfHP.checked {
            background-color: var(--primary-accent-color, #735bf2);
        }
        .toggle-container-lZfHP .toggle-toOWM {
            width: 1.1rem;
            height: 1.1rem;
            border-radius: 50%;
            background-color: #ffffff;
            position: absolute;
            top: 0.15rem;
            left: 0.15rem;
            transition: transform 0.2s ease;
        }
        .toggle-container-lZfHP.checked .toggle-toOWM {
            transform: translateX(1.2rem);
        }
        .install-button-container-yfcq5 {
            background-color: var(--primary-accent-color, #735bf2);
            color: #fff;
        }
        .install-button-container-yfcq5:hover {
            filter: brightness(1.1);
        }
        .uninstall-button-container-oV4Yo {
            background-color: rgba(255, 255, 255, 0.15);
            color: #fff;
        }
        .uninstall-button-container-oV4Yo.disabled {
            opacity: 0.85;
            cursor: default;
        }
    `;
    (document.head || document.documentElement || document.body).appendChild(style);
  }

  // src/utils/logger.ts
  function setupLogger() {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    function formatConsoleArgs(args) {
      return Array.from(args).map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) {
          return arg.stack || `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === "object" && arg !== null) {
          if (arg.message) return `${arg.name || "Error"}: ${arg.message}`;
          try {
            const json = JSON.stringify(arg);
            return json === "{}" ? String(arg) : json;
          } catch (_) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(" ");
    }
    console.log = function(...args) {
      origLog(...args);
      const msg = formatConsoleArgs(args);
      if (msg.includes("[TheIntroDB]") || msg.includes("[Enhanced]") || msg.includes("[Plugin]") || msg.includes("Episode ID:") || msg.includes("[Aptabase]")) {
        postEnhancedMessage("log", { level: "info", message: msg });
      }
    };
    console.warn = function(...args) {
      origWarn(...args);
      const msg = formatConsoleArgs(args);
      if (msg.includes("[TheIntroDB]") || msg.includes("[Enhanced]") || msg.includes("[Plugin]") || msg.includes("[Aptabase]")) {
        postEnhancedMessage("log", { level: "warn", message: msg });
      }
    };
    console.error = function(...args) {
      origError(...args);
      const msg = formatConsoleArgs(args);
      postEnhancedMessage("log", { level: "error", message: msg });
    };
    window.addEventListener("error", (event) => {
      postEnhancedMessage("log", {
        level: "error",
        message: `Uncaught JS error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
      });
    });
  }

  // src/network/fetchInterceptor.ts
  var pendingHttpRequests = /* @__PURE__ */ new Map();
  function setupFetchInterceptor() {
    window.__receiveHttpResponse = function(id, status, bodyText) {
      const resolver = pendingHttpRequests.get(id);
      if (resolver) {
        pendingHttpRequests.delete(id);
        resolver({ status, bodyText });
      }
    };
    function rustFetch(url) {
      return new Promise((resolve) => {
        const reqId = "req_" + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
          if (pendingHttpRequests.has(reqId)) {
            pendingHttpRequests.delete(reqId);
            resolve({ status: 504, bodyText: "Gateway Timeout" });
          }
        }, 3e4);
        pendingHttpRequests.set(reqId, ({ status, bodyText }) => {
          clearTimeout(timer);
          resolve({ status, bodyText });
        });
        postEnhancedMessage("httpGet", { id: reqId, url });
      });
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(resource, init) {
      let cleanInit = init;
      if (init && init.headers) {
        let headers = init.headers;
        if (headers instanceof Headers) {
          headers = new Headers(headers);
          headers.delete("User-Agent");
          headers.delete("user-agent");
          cleanInit = { ...init, headers };
        } else if (Array.isArray(headers)) {
          cleanInit = {
            ...init,
            headers: headers.filter(([k]) => k.toLowerCase() !== "user-agent")
          };
        } else if (typeof headers === "object") {
          const copy = { ...headers };
          delete copy["User-Agent"];
          delete copy["user-agent"];
          cleanInit = {
            ...init,
            headers: copy
          };
        }
      }
      const url = typeof resource === "string" ? resource : resource?.url;
      const isGet = !init || !init.method || init.method.toUpperCase() === "GET";
      const isHttp = url && (url.startsWith("http://") || url.startsWith("https://"));
      try {
        const res = await originalFetch(resource, cleanInit);
        if (isHttp && isGet && (res.status >= 300 && res.status < 400 || res.status === 403)) {
          console.log(`[Enhanced Fetch] Direct fetch returned status ${res.status} for ${url}, trying Rust proxy fallback...`);
          try {
            const { status, bodyText } = await rustFetch(url);
            return new Response(bodyText, {
              status: status || 200,
              statusText: status === 200 ? "OK" : "Error",
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
          } catch (proxyErr) {
            console.error("[Enhanced Fetch] Proxy fallback failed:", proxyErr);
          }
        }
        return res;
      } catch (fetchErr) {
        if (isHttp && isGet) {
          console.log(`[Enhanced Fetch] Direct fetch failed for ${url}, trying Rust proxy fallback... (${fetchErr?.message || fetchErr})`);
          try {
            const { status, bodyText } = await rustFetch(url);
            return new Response(bodyText, {
              status: status || 200,
              statusText: status === 200 ? "OK" : "Error",
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
          } catch (proxyErr) {
            console.error("[Enhanced Fetch] Proxy fallback failed:", proxyErr);
          }
        }
        throw fetchErr;
      }
    };
  }

  // src/components/theme-item/theme-item.html
  var theme_item_default = '<div name="{{ fileName }}-box" tabindex="0" class="addon-whmdO animation-fade-in addon-container-lC5KN button-container-zVLH6" style="margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; padding: 1.25rem; border-radius: 0.5rem; background-color: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); transition: border-color 0.2s;">\n    <div class="info-container-AdMB6" style="flex: 1; min-width: 0; padding-right: 1.5rem;">\n        <div class="name-container-qIAg8" title="{{ name }}" style="font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 0.2rem;">{{ name }}</div>\n        <div class="version-container-zdPyN" title="{{ version }}" style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); margin-bottom: 0.4rem;">{{ version }}</div>\n        <div class="description-container-v7Jhe" style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.7); line-height: 1.4;">\n            {{ descriptionBlock }}\n            {{ authorBlock }}\n        </div>\n    </div>\n    <div class="buttons-container-g0xXr" style="width: auto; flex-shrink: 0;">\n        <div class="action-buttons-container-xMVmz" style="display: flex; align-items: center;">\n            <div tabindex="-1" class="install-button-container-yfcq5 button-container-zVLH6 theme-update-btn" style="background-color: #f5bf42; color: #16152b; display: none; margin-right: 1rem; cursor: pointer; user-select: none; padding: 0.5rem 1.1rem; border-radius: 0.35rem; font-weight: 700;" id="{{ fileName }}-update" title="Update available">\n                <div class="label-OnWh2" style="color: #16152b; font-weight: bold;">Update</div>\n            </div>\n\n            <div tabindex="-1" class="{{ buttonClass }} button-container-zVLH6 theme-apply-btn" data-theme="{{ fileName }}" id="theme-btn-{{ fileName }}" style="cursor: pointer; user-select: none; min-width: 6.5rem; text-align: center; padding: 0.5rem 1.25rem; border-radius: 0.35rem; font-weight: 700;">\n                <div class="label-OnWh2" style="color: white; font-weight: bold;">{{ label }}</div>\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/utils/templateCache.ts
  var TemplateCache = class {
    /**
     * Replaces placeholders formatted as {{ key }} with values from the data map.
     */
    static render(template, data) {
      let result = template;
      for (const [key, val] of Object.entries(data)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
        result = result.replace(regex, val !== null && val !== void 0 ? String(val) : "");
      }
      return result;
    }
  };

  // src/components/theme-item/themeItem.ts
  function createThemeCard(fileName, meta, isApplied, onApply) {
    const buttonClass = isApplied ? "uninstall-button-container-oV4Yo disabled" : "install-button-container-yfcq5";
    const label = isApplied ? "Applied" : "Apply";
    const descriptionBlock = meta.description ? `<b>Description:</b> ${escapeHtml(meta.description)}<br>` : "";
    const authorBlock = meta.author ? `<b>Author:</b> ${escapeHtml(meta.author)}` : "";
    const html = TemplateCache.render(theme_item_default, {
      fileName: escapeHtml(fileName),
      name: escapeHtml(meta.name),
      version: escapeHtml(meta.version || ""),
      descriptionBlock,
      authorBlock,
      buttonClass,
      label
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const card = wrapper.firstElementChild;
    const applyBtn = card.querySelector(".theme-apply-btn");
    if (applyBtn) {
      applyBtn.onclick = function() {
        if (applyBtn.classList.contains("disabled")) return;
        onApply(fileName);
      };
    }
    return card;
  }

  // src/components/marketplace-tab/marketplace-tab.html
  var marketplace_tab_default = '<div class="marketplace-tab-view" tabindex="0" style="position: absolute; top: 0; bottom: 0; left: 0; right: 0; width: 100%; height: 100%; min-height: 0 !important; max-height: 100% !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; box-sizing: border-box; outline: none;">\n    <div style="width: 100%; max-width: 920px; margin: 0 auto; padding: 2rem 2.5rem 4rem 2.5rem; box-sizing: border-box;">\n        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">\n            <div id="marketplace-back-btn" style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.2rem; border-radius: 0.35rem; background: rgba(255, 255, 255, 0.08); user-select: none; transition: background 0.2s;">\n                <svg viewBox="0 0 512 512" style="width: 1rem; height: 1rem; fill: currentcolor;">\n                    <path d="M328.61 106.469L185.08 243.358l143.53 136.889" style="stroke: currentcolor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 48; fill: none;"></path>\n                </svg>\n                <span style="font-weight: 600; font-size: 0.95rem; color: #fff;">Back to Settings</span>\n            </div>\n        </div>\n\n        <div style="margin-bottom: 1.25rem;">\n            <label title="Search themes/plugins" style="display: flex; align-items: center; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.4rem; padding: 0.65rem 1rem; width: 100%; box-sizing: border-box;">\n                <input size="1" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" tabindex="0" class="search-input-bAgAh" type="text" placeholder="Search themes and plugins..." value="" style="flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 1rem;">\n                <svg viewBox="0 0 512 512" style="width: 1.2rem; height: 1.2rem; fill: rgba(255, 255, 255, 0.6); margin-left: 0.5rem; flex-shrink: 0;">\n                    <path d="M456.882 415.7999999999997l-93.791-89.45c22.605-28.67 34.784-63.57 34.686-99.44 0-91.54-78.142-166.07-174.125-166.07s-174.125 74.53-174.125 166.17c0 91.54 78.142 166.07 174.125 166.07 37.586 0 74.161-11.61 104.256-33.08l93.79 89.45c3.535 3.04 7.91 5.05 12.604 5.79 4.696 0.74 9.515 0.18 13.887-1.61 4.374-1.79 8.117-4.74 10.788-8.49 2.671-3.76 4.157-8.17 4.284-12.7 0.108-6.11-2.165-12.04-6.379-16.64m-357.62-188.79c-0.01-29.43 11.453-57.8 32.162-79.61 20.709-21.82 49.183-35.49 79.884-38.39 30.7-2.9 61.433 5.2 86.221 22.72 24.787 17.52 41.858 43.2 47.891 72.05 6.034 28.86 0.598 58.83-15.249 84.07s-40.972 43.96-70.489 52.53c-29.518 8.55-61.317 6.33-89.213-6.24s-49.895-34.57-61.718-61.75c-6.258-14.38-9.483-29.81-9.488-45.38" style="fill: currentcolor;"></path>\n                </svg>\n            </label>\n        </div>\n\n        <div tabindex="0" title="Submit your themes and plugins here" style="margin-bottom: 1.75rem; text-align: center;">\n            <a href="https://github.com/REVENGE977/stremio-enhanced-registry" target="_blank" rel="noreferrer" style="display: inline-block; padding: 0.6rem 1.25rem; border-radius: 0.35rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.85); text-decoration: none; font-weight: 500; font-size: 0.9rem; transition: all 0.2s;">\n                Submit your themes and plugins here\n            </a>\n        </div>\n\n        <div id="mods-list" style="display: flex; flex-direction: column; gap: 1rem; width: 100%; box-sizing: border-box;">\n            <div id="marketplace-loading" style="padding: 2.5rem; text-align: center; color: rgba(255, 255, 255, 0.7); font-size: 1.05rem;">\n                Loading community plugins &amp; themes...\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/components/marketplace-tab/marketplaceTab.ts
  function getMarketplaceTabHtml() {
    return TemplateCache.render(marketplace_tab_default, {});
  }

  // src/components/marketplace-item/marketplace-item.html
  var marketplace_item_default = '<div name="{{ name }}-box" tabindex="0" class="marketplace-item-card animation-fade-in" style="width: 100%; box-sizing: border-box; margin: 0 0 1rem 0; display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-radius: 0.5rem; background-color: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); transition: border-color 0.2s, background-color 0.2s;">\n    <div class="marketplace-logo-box" style="width: 4.5rem; height: 4.5rem; flex-shrink: 0; margin-right: 1.25rem; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); border-radius: 0.4rem; overflow: hidden; padding: 0.25rem; box-sizing: border-box;">\n        {{ logoBlock }}\n    </div>\n\n    <div class="marketplace-info-container" style="flex: 1; min-width: 0; padding-right: 1.5rem; box-sizing: border-box;">\n        <div style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.4rem;">\n            <span class="marketplace-title" title="{{ name }}" style="font-size: 1.2rem; font-weight: 700; color: #fff; line-height: 1.35; white-space: normal !important; overflow: visible !important; text-overflow: unset !important; word-break: break-word !important;">{{ name }}</span>\n            <span style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); font-weight: 500; white-space: nowrap;">v{{ version }}</span>\n            <span style="font-size: 0.725rem; text-transform: uppercase; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 0.25rem; background: rgba(115, 91, 242, 0.25); color: #b4a2f8; border: 1px solid rgba(115, 91, 242, 0.4); white-space: nowrap;">{{ type }}</span>\n        </div>\n        <div style="font-size: 0.875rem; color: rgba(255, 255, 255, 0.75); line-height: 1.45; word-break: break-word;">\n            <div style="margin-bottom: 0.25rem;"><b>Description:</b> {{ description }}</div>\n            <div><b>Author:</b> {{ author }}</div>\n        </div>\n    </div>\n    <div class="marketplace-buttons-container" style="width: auto; flex-shrink: 0; display: flex; align-items: center; gap: 0.75rem; margin-left: 1rem;">\n        <div class="action-buttons-container-xMVmz">\n            <div tabindex="-1" title="{{ actionbtnTitle }}" class="{{ actionbtnClass }} modActionBtn" data-link="{{ download }}" data-type="{{ type }}" style="cursor: pointer; user-select: none; min-width: 6.5rem; text-align: center; padding: 0.55rem 1.25rem; border-radius: 0.35rem; font-weight: 700; font-size: 0.9rem; transition: all 0.2s ease;">\n                <div class="label-OnWh2" style="color: white; font-weight: bold;">{{ actionbtnTitle }}</div>\n            </div>\n        </div>\n        {{ repoBlock }}\n    </div>\n</div>\n';

  // src/components/marketplace-item/marketplaceItem.ts
  function createMarketplaceCard(mod, type, isInstalled, onAction) {
    let logoBlock = "";
    if (mod.preview) {
      logoBlock = `
            <a href="${escapeHtml(mod.preview)}" target="_blank" rel="noreferrer" style="cursor: zoom-in; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <img class="logo-WrsGF" src="${escapeHtml(mod.preview)}" alt="${escapeHtml(mod.name)} Preview" loading="lazy" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;">
            </a>`;
    } else if (type === "Theme") {
      logoBlock = `
            <svg viewBox="0 0 24 24" style="width: 2.2rem; height: 2.2rem; fill: currentcolor;">
                <path d="M4 3h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 9h6a1 1 0 0 1 1 1v3h1v6h-4v-6h1v-2H5a1 1 0 0 1-1-1v-2h2v1zm11.732 1.732l1.768-1.768 1.768 1.768a2.5 2.5 0 1 1-3.536 0z"></path>
            </svg>`;
    } else {
      logoBlock = `
            <svg viewBox="0 0 24 24" style="width: 2.2rem; height: 2.2rem; fill: currentcolor;">
                <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.49 0 2.7-1.21 2.7-2.7s-1.21-2.7-2.7-2.7z"></path>
            </svg>`;
    }
    let repoBlock = "";
    if (mod.repo) {
      repoBlock = `
            <a href="${escapeHtml(mod.repo)}" target="_blank" rel="noreferrer" class="marketplace-repo-btn" style="cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; padding: 0.55rem 1rem; border-radius: 0.35rem; background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.85); font-size: 0.85rem; font-weight: 500; transition: background 0.2s;">
                <svg viewBox="0 0 24 24" style="width: 1.15rem; height: 1.15rem; fill: currentcolor; margin-right: 0.4rem; flex-shrink: 0;">
                    <path d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z" />
                </svg>
                <span>Open repository</span>
            </a>`;
    }
    const actionbtnTitle = isInstalled ? "Uninstall" : "Install";
    const actionbtnClass = isInstalled ? "uninstall-button-container-oV4Yo" : "install-button-container-yfcq5";
    const html = TemplateCache.render(marketplace_item_default, {
      name: escapeHtml(mod.name),
      version: escapeHtml(mod.version || "1.0.0"),
      type,
      description: escapeHtml(mod.description),
      author: escapeHtml(mod.author),
      actionbtnTitle,
      actionbtnClass,
      download: escapeHtml(mod.download),
      logoBlock,
      repoBlock
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const card = wrapper.querySelector(".marketplace-item-card") || wrapper.firstElementChild;
    const btn = card.querySelector(".modActionBtn");
    if (btn) {
      btn.onclick = async () => {
        const currentTitle = btn.getAttribute("title");
        const willInstall = currentTitle === "Install";
        await onAction(mod, type, willInstall, btn);
      };
    }
    return card;
  }

  // src/components/settings/settings-section.html
  var settings_section_default = '<div id="enhanced" class="section-dFpS9" style="margin-bottom: 2rem;">\n    <div class="label-wXG3e" style="font-size: 1.8rem; font-weight: 700; line-height: 3.4rem; margin-bottom: 2rem;">Enhanced</div>\n\n    <!-- Themes Category -->\n    <div id="enhanced-themes-category" class="category-GP0hI" style="margin-bottom: 2rem;">\n        <div class="heading-XePFl" style="display: flex; align-items: center; margin-bottom: 1.25rem;">\n            <span style="display: flex; align-items: center;">{{ themeIcon }}</span>\n            <div class="label-N_O2v" style="margin-left: 0.5rem;">Themes</div>\n        </div>\n        <div class="option-vFOAS option" style="margin-bottom: 1.25rem;">\n            <div class="content-P2T0i content" style="display: flex; align-items: center;">\n                <div tabindex="0" title="Open Themes Folder" class="button-DNmYL button-container-zVLH6 button" id="openthemesfolderBtn" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; font-weight: 600; border-radius: 0.35rem; transition: background 0.2s;">\n                    Open Themes Folder\n                </div>\n            </div>\n        </div>\n        <div id="enhanced-themes-list"></div>\n    </div>\n\n    <!-- Plugins Category -->\n    <div id="enhanced-plugins-category" class="category-GP0hI" style="margin-bottom: 2rem;">\n        <div class="heading-XePFl" style="display: flex; align-items: center; margin-bottom: 1.25rem;">\n            <span style="display: flex; align-items: center;">{{ pluginIcon }}</span>\n            <div class="label-N_O2v" style="margin-left: 0.5rem;">Plugins</div>\n        </div>\n        <div class="option-vFOAS option" style="margin-bottom: 1.25rem;">\n            <div class="content-P2T0i content" style="display: flex; align-items: center;">\n                <div tabindex="0" title="Open Plugins Folder" class="button-DNmYL button-container-zVLH6 button" id="openpluginsfolderBtn" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; font-weight: 600; border-radius: 0.35rem; transition: background 0.2s;">\n                    Open Plugins Folder\n                </div>\n            </div>\n        </div>\n        <div id="enhanced-plugins-list"></div>\n    </div>\n\n    <!-- Community Marketplace Category -->\n    <div id="enhanced-marketplace-category" class="category-GP0hI" style="margin-bottom: 2rem;">\n        <div class="heading-XePFl" style="display: flex; align-items: center; margin-bottom: 1.25rem;">\n            <span style="display: flex; align-items: center;">{{ marketplaceIcon }}</span>\n            <div class="label-N_O2v" style="margin-left: 0.5rem;">Community Marketplace</div>\n        </div>\n        <div class="option-vFOAS option" style="margin-bottom: 1.25rem;">\n            <div class="content-P2T0i content" style="display: flex; align-items: center;">\n                <div tabindex="0" title="Browse Plugins & Themes" class="button-DNmYL button-container-zVLH6 button" id="browsePluginsThemesBtn" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; font-weight: 600; border-radius: 0.35rem; transition: background 0.2s;">\n                    Browse Community Marketplace\n                </div>\n            </div>\n        </div>\n    </div>\n\n    <!-- Streaming Server Category -->\n    <div id="enhanced-server-category" class="category-GP0hI" style="margin-bottom: 2rem;">\n        <div class="heading-XePFl" style="display: flex; align-items: center; margin-bottom: 1.25rem;">\n            <span style="display: flex; align-items: center;">{{ serverIcon }}</span>\n            <div class="label-N_O2v" style="margin-left: 0.5rem;">Streaming Server</div>\n        </div>\n        <div class="option-vFOAS option" style="margin-bottom: 1.25rem;">\n            <div class="content-P2T0i content" style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">\n                <div tabindex="0" title="Open Streaming Server Folder" class="button-DNmYL button-container-zVLH6 button" id="openserverfolderBtn" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; font-weight: 600; border-radius: 0.35rem; transition: background 0.2s;">\n                    Open Server Folder\n                </div>\n                <div tabindex="0" title="Check for Server Updates" class="button-DNmYL button-container-zVLH6 button" id="checkserverupdatesBtn" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; font-weight: 600; border-radius: 0.35rem; transition: background 0.2s;">\n                    Check for Server Updates\n                </div>\n            </div>\n        </div>\n        <div id="enhanced-server-status-info" style="font-size: 0.9rem; color: #a0a0a0; margin-left: 0.2rem;"></div>\n    </div>\n</div>\n\n';

  // src/utils/icons.ts
  var THEME_ICON = `<svg class="icon-TzPrK" style="width: 1.25rem; height: 1.25rem; fill: currentcolor;" viewBox="0 0 512 512">
    <path d="M204.3 5C104.9 24.4 24.4 104.9 5 204.3c-26.1 133.4 75.3 247.9 203 247.9 24.3 0 44-19.7 44-44 0-11.4-4.3-21.8-11.4-29.6-7-7.8-11.6-18.1-11.6-29.4 0-24.3 19.7-44 44-44h52.8c97 0 175.2-78.2 175.2-175.2C501 77.2 360.5-25.3 204.3 5zM112 256c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32zm64-96c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32zm128 0c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32zm64 96c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32z"></path>
</svg>`;
  var PLUGIN_ICON = `<svg class="icon-TzPrK" style="width: 1.25rem; height: 1.25rem; fill: currentcolor;" viewBox="0 0 24 24">
    <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.49 0 2.7-1.21 2.7-2.7s-1.21-2.7-2.7-2.7z"></path>
</svg>`;
  var MARKETPLACE_ICON = `<svg class="icon-TzPrK" style="width: 1.25rem; height: 1.25rem; fill: currentcolor;" viewBox="0 0 24 24">
    <path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm7 17H5V8h14v12zm-7-8c-1.66 0-3-1.34-3-3H7c0 2.76 2.24 5 5 5s5-2.24 5-5h-2c0 1.66-1.34 3-3 3z"></path>
</svg>`;
  var SERVER_ICON = `<svg class="icon-TzPrK" style="width: 1.25rem; height: 1.25rem; fill: currentcolor;" viewBox="0 0 24 24">
    <path d="M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zm-1 5h-2v-2h2v2zm-4 0h-2v-2h2v2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zm-1 5h-2V6h2v2zm-4 0h-2V6h2v2z"></path>
</svg>`;

  // src/components/plugin-item/plugin-item.html
  var plugin_item_default = '<div name="{{ fileName }}-box" tabindex="0" class="addon-whmdO animation-fade-in addon-container-lC5KN button-container-zVLH6" style="margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; padding: 1.25rem; border-radius: 0.5rem; background-color: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); transition: border-color 0.2s;">\n    <div class="info-container-AdMB6" style="flex: 1; min-width: 0; padding-right: 1.5rem;">\n        <div class="name-container-qIAg8" title="{{ name }}" style="font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 0.2rem;">{{ name }}</div>\n        <div class="version-container-zdPyN" title="{{ version }}" style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); margin-bottom: 0.4rem;">{{ version }}</div>\n        <div class="description-container-v7Jhe" style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.7); line-height: 1.4;">\n            {{ descriptionBlock }}\n            {{ authorBlock }}\n        </div>\n    </div>\n    <div class="buttons-container-g0xXr" style="width: auto; flex-shrink: 0;">\n        <div class="action-buttons-container-xMVmz" style="display: flex; align-items: center;">\n            <div tabindex="-1" class="install-button-container-yfcq5 button-container-zVLH6 plugin-update-btn" style="background-color: #f5bf42; color: #16152b; display: none; margin-right: 1.2rem; cursor: pointer; user-select: none; padding: 0.5rem 1.1rem; border-radius: 0.35rem; font-weight: 700;" id="{{ fileName }}-update" title="Update available">\n                <div class="label-OnWh2" style="color: #16152b; font-weight: bold;">Update</div>\n            </div>\n\n            <div tabindex="-1" id="{{ fileName }}-settings" title="Plugin settings" class="nav-tab-button-tW6qT nav-tab-button-container-dYhs0 button-container-zVLH6 plugin-settings-btn" style="display: {{ settingsDisplay }}; cursor: pointer; margin-right: 1.2rem; align-items: center; justify-content: center; width: 2.2rem; height: 2.2rem; border-radius: 50%; background-color: rgba(255, 255, 255, 0.08); transition: background-color 0.2s;">\n                <svg class="icon-TzPrK" style="width: 1.15rem; height: 1.15rem; fill: currentcolor;" viewBox="0 0 512 512">\n                    <path d="M464 250c0-2.7-1-5-3-7l-6-3-26-4-3-2-2-3-1-9v-4l2-2 23-13 5-5v-8l-4-11c-.7-2-2.3-3.7-5-5-2-1.3-4.3-1.7-7-.7l-25 5-4-1-2-2-5-8c-.6-1.1-.8-2.4-.6-3.7.2-1.3.7-2.4 1.6-3.3l17-19 2-7c.7-2.7 0-5-2-7l-7-9c-1.6-2.1-4-3.5-6.6-3.9-2.6-.4-5.3.3-7.4 1.9l-22 13c-.9.9-2.2 1.4-3.5 1.4s-2.6-.5-3.5-1.4l-7-7-2-2v-4l9-24c1.1-2.3 1.3-4.9.6-7.3-.8-2.4-2.4-4.4-4.6-5.7l-10-6c-2-2-4.3-2.3-7-1-2.7.7-5 2-7 4l-16 20-2 2h-4l-9-4-3-2-1-3v-26c.7-2.7 0-5-2-7-1.3-2.7-3.3-4-6-4l-12-2c-2-.7-4.3-.4-7 1l-4 6-9 25-2 3h-13c-1.3.7-2.3.4-3-1l-2-2-9-25c0-2-1.3-4-4-6l-7-1-12 2c-2.7 0-4.7 1.3-6 4-2 2-2.7 4.3-2 7v26l-1 3-3 2-9 4c-2.7.7-4.7 0-6-2l-17-20c-.7-2-2.7-3.3-6-4-2-.7-4.3-.3-7 1l-10 6-5 5v8l10 24v3c0 2-.7 3-2 3l-7 6c-.4.5-.9 1-1.5 1.3-.6.3-1.2.6-1.8.7-.7.1-1.3.1-2-.1-.6-.2-1.2-.5-1.7-.8l-22-14-7-1-7 3-7 9c-1.8 1.9-2.9 4.4-2.9 7s1 5.1 2.9 7l18 20 1 3-1 3-5 9-2 2h-4l-25-4c-2.4-.7-4.9-.4-7.2.7s-3.9 3.1-4.8 5.3l-4 11v7c1.3 3.3 3 5.3 5 6l23 13 2 2v5l-2 8-1 3-3 2-26 4c-2.5.2-4.8 1.4-6.4 3.3-1.7 1.8-2.6 4.3-2.6 6.7v12c0 2.5.9 4.9 2.6 6.7s3.9 3.1 6.4 3.3l26 4 3 2 1 3 2 9v4l-2 2-23 13-5 5v8l4 11c.7 2 2.3 3.7 5 5 2 1.3 4.3 1.7 7 .7l25-5 4 1 2 2 5 8c.7 1.1 1.1 2.3 1.1 3.6 0 1.3-.4 2.5-1.1 3.5l-17 20c-1.7 1.7-2.7 3.9-2.9 6.3-.2 2.4.5 4.8 1.9 6.7l7 9c1.6 2.1 4 3.5 6.6 3.9 2.6.4 5.3-.4 7.4-2l22-13c1.1-.8 2.4-1.1 3.7-.9 1.3.2 2.5.9 3.3 1.9l7 6 2 3v3l-9 24c-1.1 2.3-1.3 4.9-.5 7.3.7 2.4 2.4 4.4 4.5 5.7l10 6c1.1.7 2.4 1.2 3.7 1.5 1.3.2 2.7.2 4-.1 1.3-.3 2.6-.8 3.6-1.6 1.1-.8 2-1.7 2.7-2.8l16-20 5-2 10 4 3 2 1 3v26c-.7 2.7 0 5 2 7 1.3 2.7 3.3 4 6 4l12 2c2.3.2 4.7-.4 6.6-1.7 2-1.3 3.5-3.1 4.4-5.3l9-25 2-2c1.3-1.3 2.3-1.7 3-1.3h10l3 1 2 2 9 25c.7 2 2 3.7 4 5 1.9 1.3 4.3 1.9 6.7 1.7l12-2c2.7-.7 4.7-2 6-4.7.7-2.7.7-5.3.7-7.3v-26l1-3 3-2 9-3c3.3-.7 5.3-.3 6 1.3l17 20c1.4 2 3.5 3.4 5.9 4 2.4.6 4.9.2 7.1-1l10-6 5-5v-8l-10-24v-3l2-3 7-6 4-2 3 1 22 13c2.7 1.3 5 1 7-1l7-9c1-1.3 1.7-2.7 2-4.3.3-1.6.2-3.3-.4-4.8l-17-20-2-3 1-4 5-9 3-2 3-1 25 5c1.2.5 2.6.7 3.9.7 1.3 0 2.6-.4 3.8-1 1.2-.6 2.3-1.4 3.2-2.3.9-1 1.6-2.1 2.1-3.4l3-11v-8l-5-5-23-13-3-2v-5l2-8 1-3 3-2 26-4c2.5-.2 4.8-1.4 6.5-3.3 1.6-1.8 2.5-4.3 2.5-6.7v-12zm-282 94c-1.3 2-3.3 3.7-6 5-2 1.4-4.3 2.3-6.8 2.6-2.4.3-4.9 0-7.2-.8l-6-4c-22.7-24.9-35.3-57.3-35.3-91s12.6-66.1 35.3-91l7-4 7-1c2.5.3 4.9 1.2 7 2.6 2.1 1.4 3.8 3.3 4.9 5.4l46 80c1.4 2.4 2.1 5.2 2.1 8s-.7 5.6-2.1 8l-46 80zm74 47c-10 0-19.3-1-28-3-3.7-.7-7-2.7-9.4-5.6-2.4-2.9-3.7-6.6-3.6-10.3l2-7 46-80 6-6 8-2h92c2.5-.1 5 .4 7.2 1.5s4.2 2.6 5.8 4.6l3 7 1 7c-17 55-68 94-128 94zm7-164l-45-80-2-7c-1.1-3.6 0-7.2 2.2-10.1 2.2-2.9 5.3-5 8.8-5.9 32.7-6.8 66.7-1.2 95.5 15.6 28.8 16.8 50.4 43.7 60.5 75.5l1 7c-.7 3.7-2.7 7-5.6 9.4-2.9 2.4-6.6 3.7-10.4 3.7h-92c-2.7.7-5.3 0-8-2l-6-6.2z"></path>\n                </svg>\n            </div>\n\n            <div tabindex="-1" class="toggle-container-lZfHP button-container-zVLH6 plugin-toggle {{ checkedClass }}" data-plugin="{{ fileName }}" style="outline: none; cursor: pointer;">\n                <div class="toggle-toOWM"></div>\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/components/modals/plugin-settings-modal.html
  var plugin_settings_modal_default = '<div data-focus-lock-disabled="false" class="addon-details-modal-container-aBFaQ modal-container-OuxEF modal-container" id="{{ modalId }}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999999; display: flex; justify-content: center; align-items: center; background-color: rgba(0, 0, 0, 0.75); box-sizing: border-box;">\n    <div class="modal-dialog-container-DZMKq" style="width: 50%; max-width: 800px; height: auto; max-height: 85vh; display: flex; flex-direction: column; background: #16152b; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); position: relative; box-sizing: border-box;">\n        <div class="modal-dialog-background-vZpB_"></div>\n        \n        <div tabindex="0" title="Close" class="close-button-container-cmxAp button-container-zVLH6" id="{{ modalId }}-close-x" style="position: absolute; top: 15px; right: 15px; cursor: pointer; z-index: 10; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">\n            <svg class="icon-OYzlV" style="width: 18px; height: 18px; fill: currentcolor;" viewBox="0 0 512 512"><path d="M289.9 256l95-95c4.5-4.5 7-10.6 7.1-17 0-6.4-2.5-12.5-7-17s-10.6-7.1-17-7.1c-3.2 0-6.3.6-9.2 1.8s-5.6 3-7.8 5.2l-95 95-95-95c-3.4-3.3-7.6-5.6-12.3-6.5-4.6-.9-9.4-.4-13.8 1.4-4.4 1.8-8.1 4.9-10.8 8.8-2.6 3.9-4 8.6-4 13.3-.1 3.2.5 6.3 1.7 9.2 1.2 2.9 3 5.6 5.2 7.8l95 95-95 95c-2.8 2.8-4.8 6.2-6 10-1.1 3.8-1.3 7.8-.5 11.6.8 3.9 2.5 7.5 5 10.5 2.5 3.1 5.8 5.4 9.4 6.9 4.4 1.8 9.2 2.3 13.8 1.4 4.7-.9 8.9-3.2 12.3-6.5l95-95 95 95c3.4 3.3 7.6 5.6 12.3 6.5 4.6.9 9.4.4 13.8-1.4 4.4-1.8 8.1-4.9 10.8-8.8 2.6-3.9 4-8.6 4-13.3.1-3.2-.5-6.3-1.7-9.2-1.2-2.9-3-5.6-5.2-7.8z"></path></svg>\n        </div>\n        \n        <div class="modal-dialog-content-Xgv7Z" style="display: flex; flex-direction: column; max-height: 85vh; padding: 25px 25px 20px 25px; box-sizing: border-box; min-height: 0; flex: 1 1 auto; overflow: hidden;">\n            <div class="title-container-v2mmF" title="{{ pluginName }} Settings" style="font-size: 1.3rem; font-weight: bold; margin-bottom: 20px; color: white; flex-shrink: 0;">{{ pluginName }} Settings</div>\n            \n            <div class="body-container-H80dD" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 12px; box-sizing: border-box;">\n                <div class="addon-details-container-VdGrt" style="width: 100%; box-sizing: border-box;">\n                    <div class="section-container-N6QHW" style="width: 100%; line-height: 1.5; padding-bottom: 35px; box-sizing: border-box;">\n                        {{ settingsHtml }}\n                    </div>\n                </div>\n            </div>\n            \n            <div class="buttons-container-e_JoR" style="margin-top: 15px; display: flex; justify-content: flex-end; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; box-sizing: border-box;">\n                <div tabindex="0" title="Close & Save" class="action-button-eprQG button-container-zVLH6 install-button-container-yfcq5" id="{{ modalId }}-close-btn" style="cursor: pointer; padding: 10px 24px; border-radius: 4px; font-weight: bold; background-color: var(--primary-accent-color, #735bf2);">\n                    <div class="label-wbfsE" style="color: white;">Close</div>\n                </div>\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/components/modals/prompt-modal.html
  var prompt_modal_default = '<div data-focus-lock-disabled="false" class="addon-details-modal-container-aBFaQ modal-container-OuxEF modal-container" id="{{ modalId }}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999999; display: flex; justify-content: center; align-items: center; background-color: rgba(0, 0, 0, 0.75);">\n    <div class="modal-dialog-container-DZMKq" style="width: 50%; max-width: 600px; height: auto; max-height: 80vh; display: flex; flex-direction: column; background: #16152b; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1);">\n        <div class="modal-dialog-content-Xgv7Z" style="display: flex; flex-direction: column; padding: 25px;">\n            <div class="title-container-v2mmF" style="font-size: 1.3rem; font-weight: bold; margin-bottom: 8px; color: white;">{{ title }}</div>\n            <div style="font-size: 0.95rem; color: #a0a0a0; margin-bottom: 20px; line-height: 1.4;">{{ message }}</div>\n            \n            <label class="search-bar-k7MXd search-bar-container-p4tSt" style="width: 100%; padding: 0; margin: 0; display: block;">\n                <input id="{{ modalId }}-input" size="1" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" tabindex="0" class="search-input-bAgAh text-input-hnLiz" type="text" value="{{ defaultValue }}" style="width: 100%; box-sizing: border-box; height: 42px; padding: 0 15px; background-color: rgba(255, 255, 255, 0.08); color: white; border: 1px solid transparent; border-radius: 0.35rem; outline: none;">\n            </label>\n            \n            <div class="buttons-container-e_JoR" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 15px;">\n                <div tabindex="0" title="Cancel" class="cancel-button-zuUX6 action-button-eprQG button-container-zVLH6" id="{{ modalId }}-cancel" style="cursor: pointer; padding: 10px 20px; border-radius: 4px; background-color: rgba(255,255,255,0.1);">\n                    <div class="label-wbfsE" style="color: #ccc;">Cancel</div>\n                </div>\n                <div tabindex="0" title="Submit" class="action-button-eprQG button-container-zVLH6 install-button-container-yfcq5" id="{{ modalId }}-save" style="cursor: pointer; padding: 10px 24px; border-radius: 4px; background-color: var(--primary-accent-color, #735bf2);">\n                    <div class="label-wbfsE" style="color: white; font-weight: bold;">Submit</div>\n                </div>\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/components/modals/alert-modal.html
  var alert_modal_default = '<div data-focus-lock-disabled="false" class="addon-details-modal-container-aBFaQ modal-container-OuxEF modal-container" id="{{ modalId }}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999999; display: flex; justify-content: center; align-items: center; background-color: rgba(0, 0, 0, 0.75);">\n    <div class="modal-dialog-container-DZMKq" style="width: 50%; max-width: 550px; height: auto; max-height: 80vh; display: flex; flex-direction: column; background: #16152b; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1);">\n        <div class="modal-dialog-content-Xgv7Z" style="display: flex; flex-direction: column; padding: 25px;">\n            <div class="title-container-v2mmF" style="font-size: 1.3rem; font-weight: bold; margin-bottom: 12px; color: white;">{{ title }}</div>\n            <div style="font-size: 0.95rem; color: #ddd; margin-bottom: 25px; line-height: 1.5; white-space: pre-wrap;">{{ message }}</div>\n            \n            <div class="buttons-container-e_JoR" style="display: flex; justify-content: flex-end; gap: 12px;">\n                {{ buttonsHtml }}\n            </div>\n        </div>\n    </div>\n</div>\n';

  // src/components/modals/toast.html
  var toast_default = '<div tabindex="-1" class="toast-item-container-nG0uk button-container-zVLH6 {{ status }}" id="{{ id }}" style="margin-bottom: 10px; display: flex; align-items: center; padding: 12px 18px; border-radius: 6px; background-color: #1f1d36; color: white; box-shadow: 0 4px 15px rgba(0,0,0,0.4); border-left: 4px solid var(--primary-accent-color, #735bf2); transition: all 0.3s ease;">\n    <div class="icon-container-rjAiH" style="margin-right: 12px; display: flex; align-items: center;">\n        <svg class="icon-Y4I_O" style="width: 20px; height: 20px; fill: none; stroke: currentcolor; stroke-width: 50;" viewBox="0 0 512 512">\n            <path d="M421 128 197 384l-96-96" style="stroke-linecap: round; stroke-linejoin: round;"></path>\n        </svg>\n    </div>\n    <div class="info-container-xD9V6">\n        <div class="title-container-VFReJ" style="font-weight: bold; font-size: 0.95rem;">{{ title }}</div>\n        <div class="message-container-znkCj" style="font-size: 0.85rem; color: #bbb; margin-top: 2px;">{{ message }}</div>\n    </div>\n</div>\n';

  // src/components/modals/modalManager.ts
  var modalManager = {
    openPluginSettingsModal: (pluginFileName, displayNameOrSchema, schemaOrCurrentValues, currentValuesOrOnSave, onSaveCallback) => {
      let displayName;
      let schema;
      let currentValues;
      let onSave;
      if (typeof displayNameOrSchema === "string") {
        displayName = displayNameOrSchema;
        schema = schemaOrCurrentValues || [];
        currentValues = currentValuesOrOnSave || {};
        onSave = onSaveCallback || (() => {
        });
      } else {
        displayName = pluginFileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
        schema = displayNameOrSchema || [];
        currentValues = schemaOrCurrentValues || {};
        onSave = currentValuesOrOnSave || (() => {
        });
      }
      const modalId = `${pluginFileName.replace(/[^a-zA-Z0-9]/g, "")}-settings-modal`;
      const existing = document.getElementById(modalId);
      if (existing) existing.remove();
      let settingsHtml = "";
      schema.forEach((setting) => {
        const currentValue = currentValues[setting.key] ?? setting.defaultValue ?? "";
        if (setting.type === "toggle") {
          settingsHtml += modalManager._buildToggle(setting, currentValue);
        } else if (setting.type === "input") {
          settingsHtml += modalManager._buildInput(setting, currentValue);
        } else if (setting.type === "select") {
          settingsHtml += modalManager._buildSelect(setting, currentValue);
        }
      });
      let cleanDisplayName = displayName.trim();
      if (/settings$/i.test(cleanDisplayName) && cleanDisplayName.length > 8) {
        cleanDisplayName = cleanDisplayName.replace(/\s*settings$/i, "").trim();
      }
      const modalHtml = TemplateCache.render(plugin_settings_modal_default, {
        modalId,
        pluginName: escapeHtml(cleanDisplayName),
        settingsHtml
      });
      document.body.insertAdjacentHTML("beforeend", modalHtml);
      const modalElement = document.getElementById(modalId);
      if (!modalElement) return;
      const toggles = modalElement.querySelectorAll(".plugin-setting-toggle");
      toggles.forEach((toggle) => {
        toggle.addEventListener("click", () => {
          toggle.classList.toggle("checked");
        });
      });
      const handleCloseAndSave = () => {
        const newValues = {};
        schema.forEach((setting) => {
          const element = modalElement.querySelector(`[data-key="${setting.key}"]`);
          if (!element) return;
          if (setting.type === "toggle") {
            newValues[setting.key] = element.classList.contains("checked");
          } else if (setting.type === "input" || setting.type === "select") {
            newValues[setting.key] = element.value;
          }
        });
        modalElement.remove();
        onSave(newValues);
      };
      modalElement.querySelector(`#${modalId}-close-x`)?.addEventListener("click", handleCloseAndSave);
      modalElement.querySelector(`#${modalId}-close-btn`)?.addEventListener("click", handleCloseAndSave);
      modalElement.addEventListener("click", (e) => {
        if (e.target === modalElement) {
          handleCloseAndSave();
        }
      });
      const keyHandler = (e) => {
        if (e.key === "Escape") {
          window.removeEventListener("keydown", keyHandler);
          handleCloseAndSave();
        }
      };
      window.addEventListener("keydown", keyHandler);
    },
    _buildToggle: (setting, currentValue) => {
      const isChecked = currentValue === true || currentValue === "true";
      const checkedClass = isChecked ? "checked" : "";
      const label = setting.title || setting.label || setting.key;
      return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ""}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0;">
                <div tabindex="0" class="toggle-container-lZfHP button-container-zVLH6 plugin-setting-toggle ${checkedClass}" data-key="${escapeHtml(setting.key)}" style="outline: none; cursor: pointer;">
                    <div class="toggle-toOWM"></div>
                </div>
            </div>
        </div>`;
    },
    _buildInput: (setting, currentValue) => {
      const label = setting.title || setting.label || setting.key;
      return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ""}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0; width: 50%; max-width: 300px;">
                <label class="search-bar-k7MXd search-bar-container-p4tSt" style="width: 100%; padding: 0; margin: 0; display: block;">
                    <input data-key="${escapeHtml(setting.key)}" size="1" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" tabindex="0" class="search-input-bAgAh text-input-hnLiz plugin-setting-input" type="text" placeholder="${escapeHtml(label)}" value="${escapeHtml(currentValue)}" style="width: 100%; box-sizing: border-box; height: 42px; padding: 0 15px; background-color: rgba(255, 255, 255, 0.08); color: white; border: 1px solid transparent; border-radius: 0.35rem; outline: none;">
                </label>
            </div>
        </div>`;
    },
    _buildSelect: (setting, currentValue) => {
      const label = setting.title || setting.label || setting.key;
      let optionsHtml = "";
      if (setting.options) {
        setting.options.forEach((opt) => {
          const selected = String(opt.value) === String(currentValue) ? "selected" : "";
          optionsHtml += `<option value="${escapeHtml(opt.value)}" ${selected} style="background-color: #1a1a1a; color: white;">${escapeHtml(opt.label)}</option>`;
        });
      }
      return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ""}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0; width: 50%; max-width: 300px;">
                <select data-key="${escapeHtml(setting.key)}" class="search-input-bAgAh text-input-hnLiz plugin-setting-select" style="width: 100%; padding: 0 15px; cursor: pointer; background-color: rgba(255, 255, 255, 0.08); color: white; border: 1px solid transparent; border-radius: 0.35rem; outline: none; appearance: auto; box-sizing: border-box; height: 42px;">
                    ${optionsHtml}
                </select>
            </div>
        </div>`;
    },
    showPrompt: (promptId, title, message, defaultValue = "") => {
      return new Promise((resolve) => {
        const modalId = `prompt-modal-${promptId.replace(/[^a-zA-Z0-9]/g, "")}`;
        document.getElementById(modalId)?.remove();
        const html = TemplateCache.render(prompt_modal_default, {
          modalId,
          title: escapeHtml(title),
          message: escapeHtml(message),
          defaultValue: escapeHtml(defaultValue)
        });
        document.body.insertAdjacentHTML("beforeend", html);
        const modal = document.getElementById(modalId);
        const input = document.getElementById(`${modalId}-input`);
        const cancelBtn = document.getElementById(`${modalId}-cancel`);
        const saveBtn = document.getElementById(`${modalId}-save`);
        if (!modal || !input) {
          resolve(null);
          return;
        }
        input.focus();
        const closeAndRespond = (value) => {
          modal.remove();
          resolve(value);
        };
        cancelBtn?.addEventListener("click", () => closeAndRespond(null));
        saveBtn?.addEventListener("click", () => closeAndRespond(input.value));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") closeAndRespond(input.value);
          if (e.key === "Escape") closeAndRespond(null);
        });
      });
    },
    showAlert: (alertType, title, message, buttons = ["OK"]) => {
      return new Promise((resolve) => {
        const modalId = `alert-modal-${Math.random().toString(36).substring(2, 9)}`;
        document.getElementById(modalId)?.remove();
        const btnList = Array.isArray(buttons) && buttons.length > 0 ? buttons : ["OK"];
        let buttonsHtml = "";
        btnList.forEach((btnText, index) => {
          const isPrimary = index === 0;
          const bgStyle = isPrimary ? "background-color: var(--primary-accent-color, #735bf2); color: white;" : "background-color: rgba(255,255,255,0.1); color: #ccc;";
          buttonsHtml += `
                    <div tabindex="0" class="button-container-zVLH6 alert-dialog-btn" data-index="${index}" style="cursor: pointer; padding: 10px 22px; border-radius: 4px; font-weight: 600; ${bgStyle}">
                        <div class="label-wbfsE">${escapeHtml(btnText)}</div>
                    </div>
                `;
        });
        const html = TemplateCache.render(alert_modal_default, {
          modalId,
          title: escapeHtml(title),
          message: escapeHtml(message),
          buttonsHtml
        });
        document.body.insertAdjacentHTML("beforeend", html);
        const modal = document.getElementById(modalId);
        if (!modal) {
          resolve(-1);
          return;
        }
        const closeWithResult = (resIndex) => {
          modal.remove();
          resolve(resIndex);
        };
        modal.querySelectorAll(".alert-dialog-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-index")) || 0;
            closeWithResult(idx);
          });
        });
        const keyHandler = (e) => {
          if (e.key === "Escape") {
            window.removeEventListener("keydown", keyHandler);
            closeWithResult(btnList.length > 1 ? 1 : 0);
          }
        };
        window.addEventListener("keydown", keyHandler);
      });
    },
    showToast: (id, title, message, status = "success") => {
      let container = document.querySelector(".toasts-container-oKECy");
      if (!container) {
        container = document.createElement("div");
        container.className = "toasts-container-oKECy";
        Object.assign(container.style, {
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: "9999999",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          pointerEvents: "none"
        });
        document.body.appendChild(container);
      }
      const toastId = `toast-${id || Math.random().toString(36).substring(2, 9)}`;
      document.getElementById(toastId)?.remove();
      const html = TemplateCache.render(toast_default, {
        id: toastId,
        title: escapeHtml(title),
        message: escapeHtml(message),
        status: status === "fail" ? "error-quyOd" : status === "info" ? "info-KEWq8" : "success-eIDTa"
      });
      const temp = document.createElement("div");
      temp.innerHTML = html.trim();
      const toastEl = temp.firstElementChild;
      if (!toastEl) return;
      toastEl.style.pointerEvents = "auto";
      container.appendChild(toastEl);
      setTimeout(() => {
        toastEl.style.opacity = "0";
        toastEl.style.transform = "translateY(10px)";
        setTimeout(() => toastEl.remove(), 300);
      }, 4e3);
    }
  };

  // src/components/plugin-item/pluginItem.ts
  function createPluginCard(fileName, meta, isEnabled, onToggle) {
    const checkedClass = isEnabled ? "checked" : "";
    const pluginBaseName = fileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
    const pluginDisplayName = meta && meta.name && meta.name.trim().length > 0 ? meta.name.trim() : pluginBaseName;
    const schemas = window.__pluginSchemas || {};
    const schema = schemas[fileName] || schemas[pluginBaseName] || null;
    const settingsDisplay = schema && Array.isArray(schema) && schema.length > 0 ? "flex" : "none";
    const descriptionBlock = meta.description ? `<b>Description:</b> ${escapeHtml(meta.description)}<br>` : "";
    const authorBlock = meta.author ? `<b>Author:</b> ${escapeHtml(meta.author)}` : "";
    const html = TemplateCache.render(plugin_item_default, {
      fileName: escapeHtml(fileName),
      name: escapeHtml(meta.name),
      version: escapeHtml(meta.version || ""),
      descriptionBlock,
      authorBlock,
      checkedClass,
      settingsDisplay
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const card = wrapper.firstElementChild;
    const toggle = card.querySelector(".plugin-toggle");
    if (toggle) {
      toggle.onclick = function() {
        toggle.classList.toggle("checked");
        const newEnabled = toggle.classList.contains("checked");
        onToggle(fileName, newEnabled);
      };
    }
    const settingsBtn = card.querySelector(`#${fileName}-settings`) || card.querySelector(".plugin-settings-btn");
    if (settingsBtn) {
      settingsBtn.onclick = async function(e) {
        e.stopPropagation();
        const activeSchema = window.__pluginSchemas?.[fileName] || window.__pluginSchemas?.[pluginBaseName];
        if (!activeSchema || !Array.isArray(activeSchema)) return;
        const currentValues = {};
        for (const item of activeSchema) {
          const storageKey = `plugin_setting:${pluginBaseName}:${item.key}`;
          const rawVal = localStorage.getItem(storageKey);
          if (rawVal !== null && rawVal !== void 0) {
            try {
              currentValues[item.key] = JSON.parse(rawVal);
            } catch (_) {
              currentValues[item.key] = rawVal;
            }
          } else {
            currentValues[item.key] = item.defaultValue;
          }
        }
        modalManager.openPluginSettingsModal(fileName, pluginDisplayName, activeSchema, currentValues, (newValues) => {
          for (const [key, val] of Object.entries(newValues)) {
            const storageKey = `plugin_setting:${pluginBaseName}:${key}`;
            try {
              localStorage.setItem(storageKey, JSON.stringify(val));
            } catch (_) {
              localStorage.setItem(storageKey, String(val));
            }
          }
          const listeners = window.__pluginSettingListeners?.[fileName] || window.__pluginSettingListeners?.[pluginBaseName] || [];
          listeners.forEach((cb) => {
            try {
              cb(newValues);
            } catch (err) {
              console.error("[Enhanced] Error in onSettingsSaved:", err);
            }
          });
        });
      };
    }
    return card;
  }

  // src/plugins/pluginManager.ts
  var currentEnhancedData = { plugins: [], themes: [], activeTheme: null };
  function updatePluginManagerData(data) {
    currentEnhancedData = data;
  }
  function loadPlugin(fileName) {
    const scriptId = `plugin-${fileName}`;
    if (document.getElementById(scriptId)) return;
    if (!document.body) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => loadPlugin(fileName), { once: true });
      } else {
        window.addEventListener("load", () => loadPlugin(fileName), { once: true });
      }
      return;
    }
    const pluginsList = currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0 ? currentEnhancedData.plugins : window.__INITIAL_ENHANCED_DATA__?.plugins || [];
    const plugin = pluginsList.find((p) => p.fileName === fileName);
    if (!plugin || !plugin.content) {
      console.warn("[Enhanced] Cannot load plugin, content missing for:", fileName);
      return;
    }
    const pluginBaseName = fileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
    const scopedScript = `
(function() {
    const StremioEnhancedAPI = window.__createScopedPluginAPI ? window.__createScopedPluginAPI('${pluginBaseName}') : window.StremioEnhancedAPI;
    try {
        ${plugin.content}
        console.log('[Enhanced] Plugin loaded successfully: ${fileName}');
    } catch (err) {
        console.error('[Enhanced] Plugin crashed: ${fileName}', err);
        const badScript = document.getElementById('${scriptId}');
        if (badScript) badScript.remove();
    }
})();
    `;
    const script = document.createElement("script");
    script.id = scriptId;
    script.textContent = scopedScript;
    document.body.appendChild(script);
    console.log("[Enhanced] Injected plugin script: " + fileName);
  }
  function unloadPlugin(fileName) {
    const scriptId = `plugin-${fileName}`;
    const el = document.getElementById(scriptId);
    if (el) {
      el.remove();
      console.log("[Enhanced] Removed plugin script element: " + fileName);
    }
  }
  function loadEnabledPlugins() {
    const pluginsList = currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0 ? currentEnhancedData.plugins : window.__INITIAL_ENHANCED_DATA__?.plugins || [];
    pluginsList.forEach((plugin) => {
      if (plugin.enabled) {
        loadPlugin(plugin.fileName);
      }
    });
  }
  function showReloadWarning() {
    if (document.getElementById("plugin-reload-warning")) return;
    const pluginsCat = document.getElementById("enhanced-plugins-category");
    if (!pluginsCat) return;
    const p = document.createElement("p");
    p.id = "plugin-reload-warning";
    p.style.cssText = "color: white; margin-top: 1rem; font-size: 0.95rem; line-height: 1.4;";
    p.appendChild(document.createTextNode("Reload is required to disable plugins. Click "));
    const link = document.createElement("a");
    link.style.cssText = "color: var(--primary-accent-color, #735bf2); cursor: pointer; font-weight: bold; text-decoration: underline;";
    link.textContent = "here";
    link.onclick = function() {
      location.reload();
    };
    p.appendChild(link);
    p.appendChild(document.createTextNode(" to reload."));
    pluginsCat.appendChild(p);
  }
  function renderPluginsList(onTogglePlugin) {
    const listContainer = document.getElementById("enhanced-plugins-list");
    if (!listContainer) return;
    const existingToggles = listContainer.querySelectorAll(".plugin-toggle");
    const expectedCount = currentEnhancedData.plugins ? currentEnhancedData.plugins.length : 0;
    if (existingToggles.length > 0 && expectedCount > 0 && existingToggles.length === expectedCount) {
      currentEnhancedData.plugins.forEach((plugin) => {
        const pluginBaseName = plugin.fileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
        const schemas = window.__pluginSchemas || {};
        const schema = schemas[plugin.fileName] || schemas[pluginBaseName];
        const settingsBtn = document.getElementById(`${plugin.fileName}-settings`);
        if (settingsBtn) {
          settingsBtn.style.display = schema && Array.isArray(schema) && schema.length > 0 ? "flex" : "none";
        }
        const card = listContainer.querySelector(`[name="${plugin.fileName}-box"]`);
        if (card) {
          const versionEl = card.querySelector(".version-container-zdPyN");
          if (versionEl && plugin.version) {
            versionEl.textContent = plugin.version;
            versionEl.setAttribute("title", plugin.version);
          }
        }
        existingToggles.forEach((toggle) => {
          if (toggle.getAttribute("data-plugin") === plugin.fileName) {
            if (plugin.enabled) {
              toggle.classList.add("checked");
            } else {
              toggle.classList.remove("checked");
            }
          }
        });
        checkForItemUpdatesUI(plugin.fileName, "plugin");
      });
      return;
    }
    listContainer.innerHTML = "";
    if (currentEnhancedData.plugins && currentEnhancedData.plugins.length > 0) {
      currentEnhancedData.plugins.forEach((plugin) => {
        listContainer.appendChild(createPluginCard(plugin.fileName, plugin, !!plugin.enabled, onTogglePlugin));
        checkForItemUpdatesUI(plugin.fileName, "plugin");
      });
    } else {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.cssText = "color: rgba(255, 255, 255, 0.5); padding: 1rem 0; font-style: italic;";
      emptyMsg.textContent = "No plugins installed yet. Click 'Open Plugins Folder' to add plugins.";
      listContainer.appendChild(emptyMsg);
    }
  }

  // src/server/serverManager.ts
  var DEFAULT_SERVER_JS_URL = "https://dl.strem.io/server/v4.21.1/desktop/server.js";
  var CARGO_TOML_URL = "https://raw.githubusercontent.com/Stremio/stremio-service/refs/heads/master/Cargo.toml";
  var currentServerStatus = {
    exists: false,
    running: false,
    serverDir: "",
    serverPath: "",
    currentVersion: null,
    skippedVersion: null
  };
  var isCheckingServer = false;
  var hasPromptedInitialSetup = false;
  var latestServerJsUrl = DEFAULT_SERVER_JS_URL;
  var pendingServerStatusRequests = /* @__PURE__ */ new Map();
  var pendingServerStartRequests = /* @__PURE__ */ new Map();
  function setupServerManager() {
    window.__receiveServerStatus = function(id, status) {
      if (status) {
        currentServerStatus = status;
      }
      const resolver = pendingServerStatusRequests.get(id);
      if (resolver) {
        pendingServerStatusRequests.delete(id);
        resolver(status);
      }
    };
    window.__receiveServerStartResult = function(id, success) {
      if (currentServerStatus) {
        currentServerStatus.running = !!success;
      }
      const resolver = pendingServerStartRequests.get(id);
      if (resolver) {
        pendingServerStartRequests.delete(id);
        resolver(success);
      }
    };
    if (window.__INITIAL_ENHANCED_DATA__?.serverStatus) {
      currentServerStatus = window.__INITIAL_ENHANCED_DATA__.serverStatus;
    }
  }
  function updateServerManagerData(status) {
    if (status) {
      currentServerStatus = status;
    }
  }
  function getCurrentServerStatus() {
    return currentServerStatus;
  }
  function getServerStatus() {
    return new Promise((resolve) => {
      const id = "srv_" + Math.random().toString(36).substring(2, 9);
      const timer = setTimeout(() => {
        if (pendingServerStatusRequests.has(id)) {
          pendingServerStatusRequests.delete(id);
          resolve(currentServerStatus);
        }
      }, 1e4);
      pendingServerStatusRequests.set(id, (status) => {
        clearTimeout(timer);
        resolve(status);
      });
      postEnhancedMessage("getServerStatus", { id });
    });
  }
  var isReloadingToLocal = false;
  function reloadToLocalStreamingServer() {
    if (isReloadingToLocal) return;
    if (window.location.hostname === "127.0.0.1") {
      try {
        window.core?.dispatch?.({ action: "StreamingServer", args: { action: "Reload" } });
      } catch (_) {
      }
      return;
    }
    isReloadingToLocal = true;
    const hash = window.location.hash || "#/";
    const targetUrl = `http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fweb.stremio.com/${hash}`;
    console.log("[Enhanced Server] Streaming server running. Reloading from web.stremio.com to local proxy:", targetUrl);
    setTimeout(() => {
      postEnhancedMessage("loadUrl", { url: targetUrl });
      try {
        window.location.replace(targetUrl);
      } catch (_) {
        window.location.href = targetUrl;
      }
    }, 500);
  }
  function startStreamingServer() {
    return new Promise((resolve) => {
      const id = "start_" + Math.random().toString(36).substring(2, 9);
      const timer = setTimeout(() => {
        if (pendingServerStartRequests.has(id)) {
          pendingServerStartRequests.delete(id);
          resolve(false);
        }
      }, 15e3);
      pendingServerStartRequests.set(id, (success) => {
        clearTimeout(timer);
        if (success && window.location.hostname !== "127.0.0.1") {
          reloadToLocalStreamingServer();
        }
        resolve(success);
      });
      postEnhancedMessage("startStreamingServer", { id });
    });
  }
  function openStreamingServerFolder() {
    postEnhancedMessage("openStreamingServerFolder");
  }
  async function fetchLatestServerVersion() {
    try {
      const res = await window.fetch(CARGO_TOML_URL);
      if (!res.ok) {
        console.warn("[Enhanced Server] Failed to fetch Cargo.toml:", res.status);
        return null;
      }
      const text = await res.text();
      const match = text.match(/\[package\.metadata\.server\][\s\S]*?version\s*=\s*"([^"]+)"/);
      if (!match || !match[1]) {
        console.warn("[Enhanced Server] Could not find server version in Cargo.toml");
        return null;
      }
      let ver = match[1].trim();
      if (!ver.startsWith("v")) {
        ver = "v" + ver;
      }
      const downloadUrl = `https://dl.strem.io/server/${ver}/desktop/server.js`;
      return { version: ver, downloadUrl };
    } catch (e) {
      console.warn("[Enhanced Server] Error fetching latest server version:", e);
      return null;
    }
  }
  async function showMissingServerInstructions(downloadUrl, serverDir) {
    let serverJsFound = false;
    while (!serverJsFound) {
      const result = await modalManager.showAlert(
        "info",
        "Streaming Server Setup Required",
        `To enable video playback, you need to download the Stremio streaming server file (server.js).

1. Download server.js from:
${downloadUrl}

2. Right click the page and select "Save As" and save it as "server.js".

3. Place it in:
${serverDir}

Click "Open Folder" to open the destination folder, or "Download" to open the download link in your browser. Click "Close" when you have placed the file in the correct location and the streaming server will start.`,
        ["Open Folder", "Download", "Close"]
      );
      if (result === 0) {
        openStreamingServerFolder();
      } else if (result === 1) {
        window.open(downloadUrl, "_blank");
      } else {
        const freshStatus = await getServerStatus();
        if (freshStatus && freshStatus.exists) {
          serverJsFound = true;
          console.log("[Enhanced Server] server.js found after user action. Starting streaming server...");
          const started = await startStreamingServer();
          if (started) {
            await modalManager.showAlert(
              "info",
              "Streaming Server Setup Complete",
              "The streaming server has been set up successfully. The application will now reload to use the local streaming server (127.0.0.1).",
              ["OK"]
            );
            reloadToLocalStreamingServer();
          }
          return true;
        } else {
          const warnResult = await modalManager.showAlert(
            "warning",
            "File Not Found",
            `server.js was not found in:
${serverDir}

Please download the file and place it in the correct location. Do you want to try again?`,
            ["Try Again", "Close"]
          );
          if (warnResult === 1) {
            serverJsFound = true;
            return false;
          }
        }
      }
    }
    return false;
  }
  async function checkServerJsUpdateAndSetup(isManual = false) {
    if (isCheckingServer) return;
    isCheckingServer = true;
    if (isManual) {
      modalManager.showToast(
        "checking-server-update",
        "Checking Server",
        "Checking for streaming server updates...",
        "info"
      );
    }
    try {
      const status = await getServerStatus();
      const serverDir = status.serverDir;
      const remote = await fetchLatestServerVersion();
      const latestVersion = remote?.version || "v4.21.1";
      const downloadUrl = remote?.downloadUrl || DEFAULT_SERVER_JS_URL;
      latestServerJsUrl = downloadUrl;
      if (!status.exists) {
        console.log("[Enhanced Server] server.js not found. Showing download instructions to user...");
        hasPromptedInitialSetup = true;
        await showMissingServerInstructions(downloadUrl, serverDir);
      } else {
        if (!status.running) {
          console.log("[Enhanced Server] server.js exists but is not running. Starting streaming server...");
          const started = await startStreamingServer();
          if (started && window.location.hostname !== "127.0.0.1") {
            reloadToLocalStreamingServer();
            return;
          }
        } else if (window.location.hostname !== "127.0.0.1") {
          console.log("[Enhanced Server] Streaming server is running. Switching from web.stremio.com to 127.0.0.1...");
          reloadToLocalStreamingServer();
          return;
        }
        const currentVer = status.currentVersion;
        const skippedVer = status.skippedVersion;
        const isDifferent = remote && currentVer && (isNewerVersion(latestVersion, currentVer) || latestVersion !== currentVer);
        if (isDifferent && latestVersion !== skippedVer) {
          const promptMessage = `A new version of the Stremio local server (${latestVersion}) is available. Do you want to update it now?`;
          const response = await modalManager.showAlert(
            "question",
            "Server Update",
            promptMessage,
            ["Yes", "No", "No and don't ask again"]
          );
          if (response === 0) {
            postEnhancedMessage("prepareServerUpdate", { version: latestVersion });
            await showMissingServerInstructions(downloadUrl, serverDir);
          } else if (response === 2) {
            postEnhancedMessage("skipServerVersion", { version: latestVersion });
          }
        } else if (isManual) {
          modalManager.showToast(
            "server-up-to-date",
            "Server Up to Date",
            `Streaming server is up to date (${currentVer || latestVersion}).`,
            "info"
          );
        }
      }
    } catch (e) {
      console.error("[Enhanced Server] Error during server check:", e);
      if (isManual) {
        modalManager.showToast(
          "server-check-error",
          "Check Failed",
          `Failed to check for server updates: ${e?.message || e}`,
          "fail"
        );
      }
    } finally {
      isCheckingServer = false;
    }
  }

  // src/components/settings/settingsInjector.ts
  function checkSettings() {
    if (!location.href.includes("#/settings")) return;
    if (document.getElementById("enhanced")) return;
    waitForElement('[class*="sections-container"]', 1e4).then((sectionsContainer) => {
      if (document.getElementById("enhanced")) return;
      postEnhancedMessage("getData");
      injectNav();
      injectSection(sectionsContainer);
    }).catch((err) => {
      console.warn("[Enhanced] Waiting for sections container:", err);
    });
  }
  function injectNav() {
    waitForElement('[title="Shortcuts"]', 5e3).then((shortcutsNav) => {
      if (document.getElementById("enhanced-nav-btn")) return;
      const menu = shortcutsNav.parentElement;
      if (!menu) return;
      const enhancedNav = document.createElement("div");
      enhancedNav.className = shortcutsNav.className;
      enhancedNav.setAttribute("tabindex", "0");
      enhancedNav.setAttribute("title", "Enhanced");
      enhancedNav.setAttribute("data-section", "enhanced");
      enhancedNav.id = "enhanced-nav-btn";
      enhancedNav.textContent = "Enhanced";
      enhancedNav.style.cursor = "pointer";
      enhancedNav.style.outline = "none";
      enhancedNav.style.fontSize = "1.1rem";
      enhancedNav.addEventListener("click", () => {
        const target = document.getElementById("enhanced");
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          setActiveNav(enhancedNav);
        }
      });
      shortcutsNav.insertAdjacentElement("afterend", enhancedNav);
      const targetSection = document.getElementById("enhanced");
      if (targetSection) {
        setupScrollObserver(enhancedNav, targetSection);
      }
    }).catch((err) => {
      console.warn("[Enhanced] Shortcuts nav item not found:", err);
    });
  }
  function setActiveNav(navBtn) {
    const menu = navBtn.parentElement;
    if (!menu) return;
    let selectedClass = "selected-S7SeK";
    menu.querySelectorAll("*").forEach((el) => {
      el.classList.forEach((cls) => {
        if (cls.includes("selected")) {
          selectedClass = cls;
          el.classList.remove(cls);
        }
      });
    });
    navBtn.classList.add(selectedClass);
  }
  function setupScrollObserver(navBtn, section) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveNav(navBtn);
        } else {
          navBtn.classList.forEach((cls) => {
            if (cls.includes("selected")) navBtn.classList.remove(cls);
          });
        }
      });
    }, { threshold: 0.1 });
    observer.observe(section);
  }
  function injectSection(sectionsContainer) {
    const html = TemplateCache.render(settings_section_default, {
      themeIcon: THEME_ICON,
      pluginIcon: PLUGIN_ICON,
      marketplaceIcon: MARKETPLACE_ICON,
      serverIcon: SERVER_ICON
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const sectionDiv = wrapper.firstElementChild;
    const sampleSection = document.querySelector('[class*="section-"]');
    if (sampleSection) {
      sectionDiv.className = sampleSection.className;
      const sampleLabel = sampleSection.querySelector(':scope > [class*="label-"]');
      const titleDiv = sectionDiv.querySelector(".label-wXG3e");
      if (titleDiv) {
        if (sampleLabel) {
          titleDiv.className = sampleLabel.className;
        }
        titleDiv.style.fontSize = "1.8rem";
        titleDiv.style.fontWeight = "700";
        titleDiv.style.lineHeight = "3.4rem";
        titleDiv.style.marginBottom = "2rem";
      }
    }
    const openThemesBtn = sectionDiv.querySelector("#openthemesfolderBtn");
    if (openThemesBtn) {
      openThemesBtn.onclick = () => {
        window.StremioEnhancedAPI.openThemesFolder();
      };
    }
    const openPluginsBtn = sectionDiv.querySelector("#openpluginsfolderBtn");
    if (openPluginsBtn) {
      openPluginsBtn.onclick = () => {
        window.StremioEnhancedAPI.openPluginsFolder();
      };
    }
    const browseMarketplaceBtn = sectionDiv.querySelector("#browsePluginsThemesBtn");
    if (browseMarketplaceBtn) {
      browseMarketplaceBtn.onclick = () => {
        browseMarketplace();
      };
    }
    const openServerFolderBtn = sectionDiv.querySelector("#openserverfolderBtn");
    if (openServerFolderBtn) {
      openServerFolderBtn.onclick = () => {
        openStreamingServerFolder();
      };
    }
    const checkServerUpdatesBtn = sectionDiv.querySelector("#checkserverupdatesBtn");
    if (checkServerUpdatesBtn) {
      checkServerUpdatesBtn.onclick = () => {
        checkServerJsUpdateAndSetup(true).then(() => {
          const updated = getCurrentServerStatus();
          if (serverStatusInfo) renderServerInfo(updated);
        });
      };
    }
    const serverStatusInfo = sectionDiv.querySelector("#enhanced-server-status-info");
    const renderServerInfo = (status) => {
      if (!serverStatusInfo) return;
      if (!status || !status.exists) {
        serverStatusInfo.innerHTML = `<span style="color: #ff6b6b; font-weight: 600;">Status:</span> Not installed / missing (server.js required)`;
      } else {
        const ver = status.currentVersion ? `v${status.currentVersion.replace(/^v/, "")}` : "Installed";
        const runningBadge = status.running ? '<span style="color: #51cf66;">\u25CF Running</span>' : '<span style="color: #fcc419;">\u25CF Stopped</span>';
        const actionBtn = status.running && window.location.hostname !== "127.0.0.1" ? `<button id="enhanced-switch-to-local-btn" style="margin-left: 0.8rem; cursor: pointer; padding: 0.3rem 0.8rem; background: #5c7cfa; color: #fff; border: none; border-radius: 4px; font-weight: 600;">Switch to Local Server (127.0.0.1)</button>` : !status.running ? `<button id="enhanced-start-server-btn" style="margin-left: 0.8rem; cursor: pointer; padding: 0.3rem 0.8rem; background: #51cf66; color: #111; border: none; border-radius: 4px; font-weight: 600;">Start Server</button>` : "";
        serverStatusInfo.innerHTML = `<span style="color: #ddd; font-weight: 600;">Status:</span> ${ver} (${runningBadge}) &bull; <span style="color: #888; font-size: 0.85rem;">${status.serverDir}</span>${actionBtn}`;
        const startBtn = serverStatusInfo.querySelector("#enhanced-start-server-btn");
        if (startBtn) {
          startBtn.onclick = async () => {
            startBtn.textContent = "Starting...";
            await startStreamingServer();
            const updated = await getServerStatus();
            renderServerInfo(updated);
          };
        }
        const switchLocalBtn = serverStatusInfo.querySelector("#enhanced-switch-to-local-btn");
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
      window.StremioEnhancedAPI.applyTheme(fileName);
    });
    renderPluginsList((fileName, enabled) => {
      window.StremioEnhancedAPI.togglePlugin(fileName, enabled);
    });
    const navBtn = document.getElementById("enhanced-nav-btn");
    if (navBtn) {
      setupScrollObserver(navBtn, sectionDiv);
    }
  }

  // src/marketplace/marketplaceManager.ts
  var REGISTRY_URL = "https://raw.githubusercontent.com/REVENGE977/stremio-enhanced-registry/refs/heads/main/registry.json";
  var currentEnhancedData2 = {
    plugins: [],
    themes: [],
    activeTheme: null
  };
  var cachedRegistry = null;
  function updateMarketplaceData(data) {
    currentEnhancedData2 = data;
  }
  function getFileNameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || "";
    } catch (_) {
      const clean = url.split("?")[0].split("#")[0];
      return clean.substring(clean.lastIndexOf("/") + 1);
    }
  }
  function isPluginInstalled(fileName) {
    const fn = fileName.toLowerCase();
    return (currentEnhancedData2.plugins || []).some((p) => (p.fileName || "").toLowerCase() === fn);
  }
  function isThemeInstalled(fileName) {
    const fn = fileName.toLowerCase();
    return (currentEnhancedData2.themes || []).some((t) => (t.fileName || "").toLowerCase() === fn);
  }
  async function fetchRegistry() {
    if (cachedRegistry) return cachedRegistry;
    console.log("[Enhanced Marketplace] Fetching registry from:", REGISTRY_URL);
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch marketplace registry: HTTP ${response.status}`);
    }
    const text = await response.text();
    const data = JSON.parse(text);
    cachedRegistry = {
      plugins: Array.isArray(data.plugins) ? data.plugins : [],
      themes: Array.isArray(data.themes) ? data.themes : []
    };
    console.log(`[Enhanced Marketplace] Loaded registry with ${cachedRegistry.plugins.length} plugins and ${cachedRegistry.themes.length} themes.`);
    return cachedRegistry;
  }
  function setupSearchBar() {
    const searchInput = document.querySelector(".search-input-bAgAh");
    const modsList = document.getElementById("mods-list");
    if (!searchInput || !modsList) return;
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      const items = modsList.querySelectorAll(".marketplace-item-card, .addon-container-lC5KN");
      items.forEach((item) => {
        const name = (item.querySelector(".marketplace-title") || item.querySelector(".name-container-qIAg8"))?.textContent?.toLowerCase() || "";
        const desc = item.textContent?.toLowerCase() || "";
        const matches = !query || name.includes(query) || desc.includes(query);
        item.style.display = matches ? "" : "none";
      });
    });
  }
  function goBackToSettings() {
    location.hash = "#/";
    setTimeout(() => {
      location.hash = "#/settings";
      setTimeout(() => {
        checkSettings();
      }, 100);
    }, 50);
  }
  async function browseMarketplace() {
    const settingsContent = document.querySelector('[class*="settings-content-"]') || document.querySelector('[class*="sections-container"]')?.parentElement;
    if (!settingsContent) {
      console.warn("[Enhanced Marketplace] Settings content container not found.");
      return;
    }
    if (settingsContent.parentElement) {
      settingsContent.parentElement.style.height = "100%";
      settingsContent.parentElement.style.overflow = "hidden";
    }
    settingsContent.style.position = "relative";
    settingsContent.style.height = "100%";
    settingsContent.style.width = "100%";
    settingsContent.style.overflow = "hidden";
    settingsContent.innerHTML = getMarketplaceTabHtml();
    const scrollContainer = document.querySelector(".marketplace-tab-view");
    if (scrollContainer) {
      scrollContainer.focus();
    }
    const backBtn = document.getElementById("marketplace-back-btn");
    if (backBtn) {
      backBtn.onclick = goBackToSettings;
    }
    const horizontalNavs = document.querySelectorAll('[class*="horizontal-nav-bar"]');
    if (horizontalNavs.length > 1) {
      const targetNav = horizontalNavs[1];
      targetNav.innerHTML = `
            <div tabindex="-1" class="button-container-xT9_L back-button-container-lDB1N button-container-zVLH6" id="back-btn" style="cursor: pointer;">
                <svg class="icon-T8MU6" viewBox="0 0 512 512" style="width: 1.2rem; height: 1.2rem;">
                    <path d="M328.61 106.469L185.08 243.358l143.53 136.889" style="stroke: currentcolor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 48; fill: none;"></path>
                </svg>
            </div>
        `;
      document.getElementById("back-btn")?.addEventListener("click", goBackToSettings);
    }
    setupSearchBar();
    const modsList = document.getElementById("mods-list");
    if (!modsList) return;
    try {
      const registry = await fetchRegistry();
      modsList.innerHTML = "";
      if ((!registry.plugins || registry.plugins.length === 0) && (!registry.themes || registry.themes.length === 0)) {
        modsList.innerHTML = `
                <div style="padding: 2.5rem; text-align: center; color: rgba(255,255,255,0.7); font-size: 1.05rem;">
                    No plugins or themes found in the community registry.
                </div>
            `;
        return;
      }
      const handleAction = async (mod, type, willInstall, btn) => {
        const fileName = getFileNameFromUrl(mod.download);
        const label = btn.querySelector(".label-OnWh2") || btn;
        if (willInstall) {
          const prevText = label.textContent;
          label.textContent = "Installing...";
          btn.style.pointerEvents = "none";
          try {
            const res = await fetch(mod.download);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const content = await res.text();
            postEnhancedMessage("installMod", {
              modType: type.toLowerCase(),
              fileName,
              content
            });
            btn.classList.remove("install-button-container-yfcq5");
            btn.classList.add("uninstall-button-container-oV4Yo");
            btn.setAttribute("title", "Uninstall");
            label.textContent = "Uninstall";
          } catch (err) {
            console.error("[Enhanced Marketplace] Install failed:", err);
            alert(`Failed to install ${mod.name}: ${err?.message || err}`);
            label.textContent = prevText;
          } finally {
            btn.style.pointerEvents = "";
          }
        } else {
          const prevText = label.textContent;
          label.textContent = "Uninstalling...";
          btn.style.pointerEvents = "none";
          try {
            postEnhancedMessage("deleteMod", {
              modType: type.toLowerCase(),
              fileName
            });
            btn.classList.remove("uninstall-button-container-oV4Yo");
            btn.classList.add("install-button-container-yfcq5");
            btn.setAttribute("title", "Install");
            label.textContent = "Install";
          } catch (err) {
            console.error("[Enhanced Marketplace] Uninstall failed:", err);
            alert(`Failed to uninstall ${mod.name}: ${err?.message || err}`);
            label.textContent = prevText;
          } finally {
            btn.style.pointerEvents = "";
          }
        }
      };
      for (const plugin of registry.plugins) {
        const fileName = getFileNameFromUrl(plugin.download);
        const installed = isPluginInstalled(fileName);
        const card = createMarketplaceCard(plugin, "Plugin", installed, handleAction);
        modsList.appendChild(card);
      }
      for (const theme of registry.themes) {
        const fileName = getFileNameFromUrl(theme.download);
        const installed = isThemeInstalled(fileName);
        const card = createMarketplaceCard(theme, "Theme", installed, handleAction);
        modsList.appendChild(card);
      }
    } catch (err) {
      console.error("[Enhanced Marketplace] Failed to load registry:", err);
      modsList.innerHTML = `
            <div style="padding: 2.5rem; text-align: center; color: #ff6b6b; font-size: 1rem;">
                Failed to load community marketplace: ${err?.message || err}<br><br>
                <button id="marketplace-retry-btn" style="padding: 0.5rem 1rem; border-radius: 4px; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; border: none;">
                    Retry
                </button>
            </div>
        `;
      document.getElementById("marketplace-retry-btn")?.addEventListener("click", () => {
        cachedRegistry = null;
        browseMarketplace();
      });
    }
  }

  // src/updates/updateManager.ts
  var currentEnhancedData3 = { plugins: [], themes: [], activeTheme: null };
  function updateUpdateManagerData(data) {
    currentEnhancedData3 = data;
  }
  function isNewerVersion(version1, version2) {
    if (!version1 || !version2) return false;
    const normalize = (v) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const v1Parts = normalize(version1);
    const v2Parts = normalize(version2);
    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    for (let i = 0; i < maxLength; i++) {
      const v1 = v1Parts[i] ?? 0;
      const v2 = v2Parts[i] ?? 0;
      if (v1 > v2) return true;
      if (v1 < v2) return false;
    }
    return false;
  }
  function extractMetadataFromText(content) {
    const blockMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
    if (!blockMatch) return null;
    const result = {};
    const tagRegex = /@(\w+)\s+([^\n\r]+)/g;
    for (const match of blockMatch[1].matchAll(tagRegex)) {
      const rawKey = match[1];
      const rawValue = match[2];
      const keyLower = rawKey.toLowerCase();
      let key = rawKey;
      if (keyLower === "updateurl") key = "updateUrl";
      else if (keyLower === "name") key = "name";
      else if (keyLower === "description") key = "description";
      else if (keyLower === "version") key = "version";
      else if (keyLower === "author") key = "author";
      if (result[key] === void 0) {
        result[key] = rawValue.trim();
      }
    }
    if (!result.name || !result.version) {
      return null;
    }
    return {
      name: result.name,
      description: result.description || "",
      version: result.version || "1.0.0",
      author: result.author || "Unknown",
      updateUrl: result.updateUrl
    };
  }
  async function getRegistryModVersion(itemFile, type) {
    try {
      const registry = await fetchRegistry();
      const list = type === "plugin" ? registry.plugins : registry.themes;
      const fnLower = itemFile.toLowerCase();
      const baseName = fnLower.replace(/\.plugin\.js$/, "").replace(/\.theme\.css$/, "").replace(/\.js$/, "");
      const found = list.find((m) => {
        const dl = (m.download || "").toLowerCase();
        return dl.endsWith(fnLower) || dl.includes(`/${baseName}.`);
      });
      if (found && found.version && found.download) {
        return { version: found.version, download: found.download };
      }
    } catch (err) {
      console.warn("[Enhanced Update] Failed to check registry version:", err);
    }
    return null;
  }
  async function checkUpdateData(itemFile, type) {
    const plugins = currentEnhancedData3.plugins && currentEnhancedData3.plugins.length > 0 ? currentEnhancedData3.plugins : window.__INITIAL_ENHANCED_DATA__?.plugins || [];
    const themes = currentEnhancedData3.themes && currentEnhancedData3.themes.length > 0 ? currentEnhancedData3.themes : window.__INITIAL_ENHANCED_DATA__?.themes || [];
    const list = type === "plugin" ? plugins : themes;
    const installed = list.find((i) => (i.fileName || "").toLowerCase() === itemFile.toLowerCase());
    if (!installed) return null;
    let installedVersion = installed.version || "1.0.0";
    let updateUrl = installed.updateUrl || installed.update_url;
    const content = type === "plugin" ? installed.content : installed.css;
    if ((!updateUrl || updateUrl === "none") && content) {
      const parsed = extractMetadataFromText(content);
      if (parsed?.updateUrl && parsed.updateUrl !== "none") {
        updateUrl = parsed.updateUrl;
      }
      if (parsed?.version) {
        installedVersion = parsed.version;
      }
    }
    if (updateUrl && updateUrl !== "none") {
      try {
        console.log(`[Enhanced Update] Checking updateUrl for ${itemFile}: ${updateUrl}`);
        const res = await fetch(updateUrl);
        if (res.ok) {
          const responseText = await res.text();
          const newMeta = extractMetadataFromText(responseText);
          if (newMeta && newMeta.version && isNewerVersion(newMeta.version, installedVersion)) {
            console.log(`[Enhanced Update] Found newer version for ${itemFile}: ${installedVersion} -> ${newMeta.version}`);
            const regInfo = await getRegistryModVersion(itemFile, type);
            return {
              hasUpdate: true,
              newContent: responseText,
              newMetaData: newMeta,
              installedMetaData: installed,
              registryVersion: regInfo?.version || null,
              updateUrl
            };
          }
          const trimmed = responseText.trim();
          if (/^v?\d+(\.\d+)+$/.test(trimmed) && isNewerVersion(trimmed, installedVersion)) {
            console.log(`[Enhanced Update] Found newer version text for ${itemFile}: ${installedVersion} -> ${trimmed}`);
            const regInfo = await getRegistryModVersion(itemFile, type);
            if (regInfo?.download) {
              const dlRes = await fetch(regInfo.download);
              if (dlRes.ok) {
                const newContent = await dlRes.text();
                const newMeta2 = extractMetadataFromText(newContent) || {
                  name: installed.name,
                  version: trimmed,
                  description: installed.description,
                  author: installed.author
                };
                return {
                  hasUpdate: true,
                  newContent,
                  newMetaData: newMeta2,
                  installedMetaData: installed,
                  registryVersion: regInfo.version,
                  updateUrl: regInfo.download
                };
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[Enhanced Update] Error checking updateUrl for ${itemFile}:`, err);
      }
    }
    try {
      const regInfo = await getRegistryModVersion(itemFile, type);
      if (regInfo && isNewerVersion(regInfo.version, installedVersion)) {
        console.log(`[Enhanced Update] Found newer version in registry for ${itemFile}: ${installedVersion} -> ${regInfo.version}`);
        const dlRes = await fetch(regInfo.download);
        if (dlRes.ok) {
          const newContent = await dlRes.text();
          const newMeta = extractMetadataFromText(newContent) || {
            name: installed.name,
            version: regInfo.version,
            description: installed.description,
            author: installed.author
          };
          return {
            hasUpdate: true,
            newContent,
            newMetaData: newMeta,
            installedMetaData: installed,
            registryVersion: regInfo.version,
            updateUrl: regInfo.download
          };
        }
      }
    } catch (err) {
      console.warn(`[Enhanced Update] Error checking registry for ${itemFile}:`, err);
    }
    return { hasUpdate: false, installedMetaData: installed };
  }
  var inFlightChecks = /* @__PURE__ */ new Set();
  async function checkForItemUpdatesUI(itemFile, type) {
    const updateButton = document.getElementById(`${itemFile}-update`);
    if (!updateButton) return false;
    if (inFlightChecks.has(itemFile)) return false;
    inFlightChecks.add(itemFile);
    try {
      const updateData = await checkUpdateData(itemFile, type);
      if (!updateData || !updateData.hasUpdate || !updateData.newContent || !updateData.newMetaData) {
        updateButton.style.display = "none";
        return false;
      }
      updateButton.style.display = "inline-flex";
      updateButton.setAttribute("title", `Update available: v${updateData.newMetaData.version}`);
      const label = updateButton.querySelector(".label-OnWh2") || updateButton;
      label.textContent = `Update (v${updateData.newMetaData.version})`;
      updateButton.onclick = async (e) => {
        e.stopPropagation();
        if (type === "plugin" && updateData.registryVersion !== updateData.newMetaData.version) {
          const result = await modalManager.showAlert(
            "warning",
            "Confirm Update",
            `This update for ${updateData.installedMetaData?.name || itemFile} (v${updateData.newMetaData.version}) isn't submitted to the registry (Community Marketplace) yet, and thus has not been confirmed safe.

Are you sure you want to update? It's recommended to read the source code of the update before updating.`,
            ["Yes", "No", "View Source Code"]
          );
          if (result === 0) {
            await applyUpdate(type, itemFile, updateData.newContent, updateData.newMetaData);
          } else if (result === 2 && updateData.updateUrl) {
            try {
              window.open(updateData.updateUrl, "_blank");
            } catch (_) {
            }
          }
        } else {
          await applyUpdate(type, itemFile, updateData.newContent, updateData.newMetaData);
        }
      };
      return true;
    } catch (err) {
      console.error(`[Enhanced Update] Error updating UI for ${itemFile}:`, err);
      return false;
    } finally {
      inFlightChecks.delete(itemFile);
    }
  }
  async function applyUpdate(type, itemFile, newContent, newMetaData) {
    const updateButton = document.getElementById(`${itemFile}-update`);
    const label = updateButton?.querySelector(".label-OnWh2") || updateButton;
    if (label) label.textContent = "Updating...";
    if (updateButton) updateButton.style.pointerEvents = "none";
    try {
      postEnhancedMessage("installMod", {
        modType: type,
        fileName: itemFile,
        content: newContent
      });
      if (updateButton) {
        updateButton.style.display = "none";
        updateButton.style.pointerEvents = "";
      }
      const card = document.querySelector(`[name="${itemFile}-box"]`);
      if (card) {
        const versionEl = card.querySelector(".version-container-zdPyN");
        if (versionEl && newMetaData.version) {
          versionEl.textContent = newMetaData.version;
          versionEl.setAttribute("title", newMetaData.version);
        }
      }
      if (type === "theme") {
        const currentActive = currentEnhancedData3.activeTheme ? currentEnhancedData3.activeTheme.toLowerCase() : null;
        if (currentActive === itemFile.toLowerCase()) {
          window.StremioEnhancedAPI?.applyTheme(itemFile);
        }
      }
      modalManager.showToast(
        "update-success",
        "Update Successful",
        `Updated ${newMetaData.name || itemFile} to v${newMetaData.version || ""}${type === "plugin" ? ". Reload may be required for some plugin changes." : ""}`,
        "success"
      );
    } catch (err) {
      console.error(`[Enhanced Update] Failed to apply update for ${itemFile}:`, err);
      if (label) label.textContent = "Update";
      if (updateButton) updateButton.style.pointerEvents = "";
      alert(`Failed to update ${itemFile}: ${err?.message || err}`);
    }
  }
  async function checkForAllUpdates(isManual = false) {
    if (isManual) {
      modalManager.showToast(
        "check-updates-progress",
        "Checking for Updates",
        "Checking for plugin and theme updates...",
        "info"
      );
    }
    const checkBtn = document.getElementById("checkforupdatesBtn");
    if (checkBtn) {
      checkBtn.style.pointerEvents = "none";
      checkBtn.textContent = "Checking...";
    }
    let updateCount = 0;
    try {
      const plugins = currentEnhancedData3.plugins && currentEnhancedData3.plugins.length > 0 ? currentEnhancedData3.plugins : window.__INITIAL_ENHANCED_DATA__?.plugins || [];
      for (const p of plugins) {
        const hasUp = await checkForItemUpdatesUI(p.fileName, "plugin");
        if (hasUp) updateCount++;
      }
      const themes = currentEnhancedData3.themes && currentEnhancedData3.themes.length > 0 ? currentEnhancedData3.themes : window.__INITIAL_ENHANCED_DATA__?.themes || [];
      for (const t of themes) {
        const hasUp = await checkForItemUpdatesUI(t.fileName, "theme");
        if (hasUp) updateCount++;
      }
      if (isManual) {
        if (updateCount > 0) {
          modalManager.showToast(
            "check-updates-result",
            "Updates Available",
            `Found ${updateCount} update(s). Look for the yellow Update buttons.`,
            "success"
          );
        } else {
          modalManager.showToast(
            "check-updates-result",
            "Up to Date",
            "All installed plugins and themes are up to date.",
            "info"
          );
        }
      }
    } finally {
      if (checkBtn) {
        checkBtn.style.pointerEvents = "";
        checkBtn.textContent = "Check for Updates";
      }
    }
  }

  // src/themes/themeManager.ts
  var headMutationObserver = null;
  var currentEnhancedData4 = { plugins: [], themes: [], activeTheme: null };
  function updateThemeManagerData(data) {
    currentEnhancedData4 = data;
  }
  function applyThemeCSS(fileName) {
    let activeStyle = document.getElementById("activeTheme");
    if (fileName === "Default" || !fileName) {
      if (activeStyle) activeStyle.remove();
      try {
        localStorage.setItem("currentTheme", "Default");
      } catch (_) {
      }
      return;
    }
    const targetName = fileName.toLowerCase();
    const themesList = currentEnhancedData4.themes && currentEnhancedData4.themes.length > 0 ? currentEnhancedData4.themes : window.__INITIAL_ENHANCED_DATA__?.themes || [];
    const foundTheme = themesList.find((t) => (t.fileName || "").toLowerCase() === targetName);
    if (!foundTheme || !foundTheme.css) {
      console.warn("[Enhanced] Theme CSS not found for:", fileName);
      return;
    }
    try {
      localStorage.setItem("currentTheme", foundTheme.fileName);
    } catch (_) {
    }
    if (!activeStyle) {
      activeStyle = document.createElement("style");
      activeStyle.id = "activeTheme";
    }
    if (activeStyle.textContent !== foundTheme.css) {
      activeStyle.textContent = foundTheme.css;
    }
    attachThemeToHead(activeStyle);
  }
  function attachThemeToHead(styleEl) {
    const activeStyle = styleEl || document.getElementById("activeTheme");
    if (!activeStyle) return;
    if (document.head) {
      if (activeStyle.parentElement !== document.head || document.head.lastElementChild !== activeStyle) {
        document.head.appendChild(activeStyle);
      }
      setupHeadObserver();
    } else if (document.documentElement) {
      if (activeStyle.parentElement !== document.documentElement) {
        document.documentElement.appendChild(activeStyle);
      }
      setupDocObserver();
    }
  }
  function setupDocObserver() {
    if (window.__enhancedDocObserver) return;
    window.__enhancedDocObserver = new MutationObserver(() => {
      if (document.head) {
        window.__enhancedDocObserver.disconnect();
        window.__enhancedDocObserver = null;
        attachThemeToHead();
      }
    });
    window.__enhancedDocObserver.observe(document.documentElement, { childList: true });
  }
  function setupHeadObserver() {
    if (headMutationObserver) return;
    if (!document.head) return;
    headMutationObserver = new MutationObserver(() => {
      const activeStyle = document.getElementById("activeTheme");
      if (!activeStyle) return;
      if (document.head.lastElementChild !== activeStyle) {
        headMutationObserver?.disconnect();
        document.head.appendChild(activeStyle);
        headMutationObserver?.observe(document.head, { childList: true });
      }
    });
    headMutationObserver.observe(document.head, { childList: true });
  }
  function ensureActiveTheme() {
    if (!currentEnhancedData4.activeTheme || currentEnhancedData4.activeTheme === "Default") return;
    applyThemeCSS(currentEnhancedData4.activeTheme);
  }
  function applyThemeUI(fileName) {
    currentEnhancedData4.activeTheme = fileName === "Default" ? null : fileName;
    const listContainer = document.getElementById("enhanced-themes-list");
    if (listContainer) {
      const currentActive = currentEnhancedData4.activeTheme ? currentEnhancedData4.activeTheme.toLowerCase() : null;
      listContainer.querySelectorAll(".theme-apply-btn").forEach((btn) => {
        const targetTheme = (btn.getAttribute("data-theme") || "").toLowerCase();
        const isThisApplied = !currentActive && targetTheme === "default" || currentActive && targetTheme === currentActive;
        if (isThisApplied) {
          btn.className = "uninstall-button-container-oV4Yo disabled button-container-zVLH6 theme-apply-btn";
          const lbl = btn.querySelector(".label-OnWh2");
          if (lbl) lbl.textContent = "Applied";
        } else {
          btn.className = "install-button-container-yfcq5 button-container-zVLH6 theme-apply-btn";
          const lbl = btn.querySelector(".label-OnWh2");
          if (lbl) lbl.textContent = "Apply";
        }
      });
    }
    applyThemeCSS(fileName);
    try {
      localStorage.setItem("currentTheme", fileName);
    } catch (_) {
    }
  }
  function renderThemesList(onApplyTheme) {
    const listContainer = document.getElementById("enhanced-themes-list");
    if (!listContainer) return;
    const currentActive = currentEnhancedData4.activeTheme ? currentEnhancedData4.activeTheme.toLowerCase() : null;
    const existingBtns = listContainer.querySelectorAll(".theme-apply-btn");
    const expectedCount = (currentEnhancedData4.themes ? currentEnhancedData4.themes.length : 0) + 1;
    if (existingBtns.length > 0 && existingBtns.length === expectedCount) {
      currentEnhancedData4.themes?.forEach((theme) => {
        const card = listContainer.querySelector(`[name="${theme.fileName}-box"]`);
        if (card) {
          const versionEl = card.querySelector(".version-container-zdPyN");
          if (versionEl && theme.version) {
            versionEl.textContent = theme.version;
            versionEl.setAttribute("title", theme.version);
          }
        }
        checkForItemUpdatesUI(theme.fileName, "theme");
      });
      existingBtns.forEach((btn) => {
        const targetTheme = (btn.getAttribute("data-theme") || "").toLowerCase();
        const isThisApplied = !currentActive && targetTheme === "default" || currentActive && targetTheme === currentActive;
        if (isThisApplied) {
          btn.className = "uninstall-button-container-oV4Yo disabled button-container-zVLH6 theme-apply-btn";
          const lbl = btn.querySelector(".label-OnWh2");
          if (lbl) lbl.textContent = "Applied";
        } else {
          btn.className = "install-button-container-yfcq5 button-container-zVLH6 theme-apply-btn";
          const lbl = btn.querySelector(".label-OnWh2");
          if (lbl) lbl.textContent = "Apply";
        }
      });
      return;
    }
    listContainer.innerHTML = "";
    const isDefaultActive = !currentActive || currentActive === "default";
    listContainer.appendChild(createThemeCard("Default", {
      name: "Default",
      version: "Built-in",
      author: "Stremio",
      description: "Default Stremio theme"
    }, isDefaultActive, onApplyTheme));
    if (currentEnhancedData4.themes && currentEnhancedData4.themes.length > 0) {
      currentEnhancedData4.themes.forEach((theme) => {
        const isApplied = currentActive === (theme.fileName || "").toLowerCase();
        listContainer.appendChild(createThemeCard(theme.fileName, theme, isApplied, onApplyTheme));
        checkForItemUpdatesUI(theme.fileName, "theme");
      });
    }
  }

  // src/api/stremioEnhancedApi.ts
  var currentEnhancedData5 = { plugins: [], themes: [], activeTheme: null };
  function updateApiData(data) {
    currentEnhancedData5 = data;
  }
  function syncLocalStorage() {
    try {
      const installedPlugins = (currentEnhancedData5.plugins || []).map((p) => p.fileName);
      localStorage.setItem("installedPlugins", JSON.stringify(installedPlugins));
      const enabledPluginsList = [];
      (currentEnhancedData5.plugins || []).forEach((p) => {
        if (p.enabled) {
          enabledPluginsList.push(p.fileName);
          const baseName = p.fileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
          if (baseName && !enabledPluginsList.includes(baseName)) {
            enabledPluginsList.push(baseName);
          }
        }
      });
      localStorage.setItem("enabledPlugins", JSON.stringify(enabledPluginsList));
      if (currentEnhancedData5.activeTheme) {
        localStorage.setItem("currentTheme", currentEnhancedData5.activeTheme);
      } else {
        localStorage.setItem("currentTheme", "Default");
      }
    } catch (_) {
    }
  }
  function setupEnhancedApi() {
    window.__pluginSchemas = window.__pluginSchemas || {};
    window.__pluginSettingListeners = window.__pluginSettingListeners || {};
    function getPluginBaseName(name) {
      return name ? name.replace(/\.plugin\.js$/, "").replace(/\.js$/, "") : "global";
    }
    async function internalGetSetting(pluginName, key) {
      const baseName = getPluginBaseName(pluginName);
      const storageKey = `plugin_setting:${baseName}:${key}`;
      const val = localStorage.getItem(storageKey);
      if (val === null || val === void 0) {
        const schema = window.__pluginSchemas[baseName] || window.__pluginSchemas[pluginName];
        if (schema && Array.isArray(schema)) {
          const opt = schema.find((s) => s.key === key);
          if (opt && opt.defaultValue !== void 0) return opt.defaultValue;
        }
        return null;
      }
      try {
        return JSON.parse(val);
      } catch (_) {
        return val;
      }
    }
    async function internalGetSettings(pluginName) {
      const baseName = getPluginBaseName(pluginName);
      const schema = window.__pluginSchemas[baseName] || window.__pluginSchemas[pluginName] || [];
      const result = {};
      for (const item of schema) {
        result[item.key] = await internalGetSetting(baseName, item.key);
      }
      return result;
    }
    async function internalSaveSetting(pluginName, key, value) {
      const baseName = getPluginBaseName(pluginName);
      const storageKey = `plugin_setting:${baseName}:${key}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch (e) {
        localStorage.setItem(storageKey, String(value));
      }
      const notifyPayload = { [key]: value };
      const listeners = window.__pluginSettingListeners[baseName] || window.__pluginSettingListeners[pluginName] || [];
      listeners.forEach((cb) => {
        try {
          cb(notifyPayload);
        } catch (err) {
          console.error("[Enhanced] Error in onSettingsSaved:", err);
        }
      });
      return true;
    }
    function internalRegisterSettings(pluginName, schema) {
      if (!Array.isArray(schema)) {
        console.error("[Enhanced] Invalid settings schema provided for:", pluginName);
        return Promise.reject(new Error("Invalid settings schema. Expected array."));
      }
      const baseName = getPluginBaseName(pluginName);
      window.__pluginSchemas[baseName] = schema;
      window.__pluginSchemas[pluginName] = schema;
      console.log(`[Enhanced] Registered settings schema for ${baseName}:`, schema);
      const optBtn = document.getElementById(`${baseName}.plugin.js-settings`) || document.getElementById(`${baseName}-settings`) || document.getElementById(`${pluginName}-settings`);
      if (optBtn) optBtn.style.display = "flex";
      return Promise.resolve(true);
    }
    window.__createScopedPluginAPI = function(pluginBaseName) {
      return {
        logger: {
          info: function(message) {
            console.log(`[${pluginBaseName}]`, message);
          },
          warn: function(message) {
            console.warn(`[${pluginBaseName}]`, message);
          },
          error: function(message) {
            console.error(`[${pluginBaseName}]`, message);
          }
        },
        getSetting: async function(key) {
          return internalGetSetting(pluginBaseName, key);
        },
        getSettings: async function() {
          return internalGetSettings(pluginBaseName);
        },
        saveSetting: async function(key, value) {
          return internalSaveSetting(pluginBaseName, key, value);
        },
        registerSettings: async function(schema) {
          return internalRegisterSettings(pluginBaseName, schema);
        },
        getRegisteredSettings: function() {
          return window.__pluginSchemas[pluginBaseName] || null;
        },
        clearRegisteredSettings: function() {
          delete window.__pluginSchemas[pluginBaseName];
          return true;
        },
        onSettingsSaved: function(callback) {
          if (!window.__pluginSettingListeners[pluginBaseName]) {
            window.__pluginSettingListeners[pluginBaseName] = [];
          }
          window.__pluginSettingListeners[pluginBaseName].push(callback);
        },
        showAlert: function(alertType, title, message, buttons) {
          return modalManager.showAlert(alertType, title, message, buttons);
        },
        showPrompt: function(promptIdOrTitle, titleOrMsg, messageOrDefault, defaultValue) {
          if (defaultValue !== void 0) {
            return modalManager.showPrompt(promptIdOrTitle, titleOrMsg || "", messageOrDefault || "", defaultValue);
          } else if (messageOrDefault !== void 0) {
            return modalManager.showPrompt(pluginBaseName, promptIdOrTitle, titleOrMsg || "", messageOrDefault);
          }
          return modalManager.showPrompt(pluginBaseName, promptIdOrTitle, titleOrMsg || "", "");
        },
        showToast: function(id, title, message, status) {
          modalManager.showToast(id, title, message, status);
        },
        toast: function(id, title, message, status) {
          modalManager.showToast(id, title, message, status);
        }
      };
    };
    window.StremioEnhancedAPI = {
      openThemesFolder: function() {
        postEnhancedMessage("openThemesFolder");
      },
      openPluginsFolder: function() {
        postEnhancedMessage("openPluginsFolder");
      },
      openStreamingServerFolder: function() {
        openStreamingServerFolder();
      },
      checkServerUpdates: function() {
        return checkServerJsUpdateAndSetup(true);
      },
      getServerStatus: function() {
        return getServerStatus();
      },
      startStreamingServer: function() {
        return startStreamingServer();
      },
      reloadToLocalStreamingServer: function() {
        reloadToLocalStreamingServer();
      },
      applyTheme: function(fileName) {
        applyThemeUI(fileName);
        postEnhancedMessage("applyTheme", { fileName });
      },
      togglePlugin: function(fileName, enabled) {
        const plugin = (currentEnhancedData5.plugins || []).find((p) => p.fileName === fileName);
        if (plugin) {
          plugin.enabled = enabled;
        }
        if (enabled) {
          loadPlugin(fileName);
        } else {
          unloadPlugin(fileName);
          showReloadWarning();
        }
        let enabledPlugins = [];
        try {
          const raw = localStorage.getItem("enabledPlugins");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) enabledPlugins = parsed;
          }
        } catch (_) {
        }
        const baseName = fileName.replace(/\.plugin\.js$/, "").replace(/\.js$/, "");
        if (enabled) {
          if (!enabledPlugins.includes(fileName)) enabledPlugins.push(fileName);
          if (baseName && !enabledPlugins.includes(baseName)) enabledPlugins.push(baseName);
        } else {
          enabledPlugins = enabledPlugins.filter((name) => name !== fileName && name !== baseName);
        }
        localStorage.setItem("enabledPlugins", JSON.stringify(enabledPlugins));
        syncLocalStorage();
        postEnhancedMessage("togglePlugin", { fileName, enabled });
      },
      refresh: function() {
        postEnhancedMessage("getData");
      },
      // Logger methods (supports both StremioEnhancedAPI.info(msg) and StremioEnhancedAPI.info(pluginName, msg))
      logger: {
        info: (pluginNameOrMsg, maybeMsg) => {
          if (maybeMsg !== void 0) console.log(`[${pluginNameOrMsg}]`, maybeMsg);
          else console.log("[Plugin]", pluginNameOrMsg);
        },
        warn: (pluginNameOrMsg, maybeMsg) => {
          if (maybeMsg !== void 0) console.warn(`[${pluginNameOrMsg}]`, maybeMsg);
          else console.warn("[Plugin]", pluginNameOrMsg);
        },
        error: (pluginNameOrMsg, maybeMsg) => {
          if (maybeMsg !== void 0) console.error(`[${pluginNameOrMsg}]`, maybeMsg);
          else console.error("[Plugin]", pluginNameOrMsg);
        }
      },
      info: (pluginName, message) => console.log(`[${pluginName}]`, message),
      warn: (pluginName, message) => console.warn(`[${pluginName}]`, message),
      error: (pluginName, message) => console.error(`[${pluginName}]`, message),
      // Settings API methods
      getSetting: async (pluginOrKey, maybeKey) => {
        if (maybeKey !== void 0) {
          return internalGetSetting(pluginOrKey, maybeKey);
        }
        return internalGetSetting("global", pluginOrKey);
      },
      getSettings: async (pluginName) => {
        return internalGetSettings(pluginName);
      },
      saveSetting: async (pluginOrKey, keyOrVal, maybeVal) => {
        if (maybeVal !== void 0) {
          return internalSaveSetting(pluginOrKey, keyOrVal, maybeVal);
        }
        return internalSaveSetting("global", pluginOrKey, keyOrVal);
      },
      registerSettings: async (pluginOrSchema, maybeSchema) => {
        if (maybeSchema !== void 0) {
          return internalRegisterSettings(pluginOrSchema, maybeSchema);
        }
        return internalRegisterSettings("global", pluginOrSchema);
      },
      getRegisteredSettings: (pluginFileName) => {
        const baseName = getPluginBaseName(pluginFileName);
        return window.__pluginSchemas[baseName] || window.__pluginSchemas[pluginFileName] || null;
      },
      clearRegisteredSettings: (pluginFileName) => {
        const baseName = getPluginBaseName(pluginFileName);
        delete window.__pluginSchemas[baseName];
        delete window.__pluginSchemas[pluginFileName];
        return true;
      },
      onSettingsSaved: (pluginOrCallback, maybeCallback) => {
        const plugin = typeof pluginOrCallback === "string" ? pluginOrCallback : "global";
        const baseName = getPluginBaseName(plugin);
        const cb = typeof pluginOrCallback === "function" ? pluginOrCallback : maybeCallback;
        if (!window.__pluginSettingListeners[baseName]) {
          window.__pluginSettingListeners[baseName] = [];
        }
        window.__pluginSettingListeners[baseName].push(cb);
      },
      // Alert, Prompt, and Toast Modal APIs
      showAlert: async (alertType, title, message, buttons) => {
        return modalManager.showAlert(alertType, title, message, buttons);
      },
      showPrompt: async (promptId, title, message, defaultValue) => {
        return modalManager.showPrompt(promptId, title, message, defaultValue);
      },
      showToast: (id, title, message, status) => {
        modalManager.showToast(id, title, message, status);
      },
      toast: (id, title, message, status) => {
        modalManager.showToast(id, title, message, status);
      }
    };
  }

  // src/bridge/videoBridge.ts
  var bridgeHost = null;
  var bridgeVideo = null;
  var currentTimeVal = 0;
  var durationVal = 0;
  var pausedVal = false;
  var seekingVal = false;
  var endedVal = false;
  var speedVal = 1;
  var volumeVal = 1;
  var mutedVal = false;
  var srcVal = "";
  var videoWidthVal = 1920;
  var videoHeightVal = 1080;
  function createTimeRanges(start, end) {
    return {
      length: end > start ? 1 : 0,
      start(i) {
        if (i === 0 && end > start) return start;
        throw new DOMException("IndexSizeError");
      },
      end(i) {
        if (i === 0 && end > start) return end;
        throw new DOMException("IndexSizeError");
      }
    };
  }
  function mountBridgeHost() {
    if (!bridgeHost) return;
    if (document.body && bridgeHost.parentElement !== document.body) {
      document.body.appendChild(bridgeHost);
      console.log("[Enhanced] Mounted bridge video host to document.body");
    }
  }
  function ensureBridgeVideo() {
    mountBridgeHost();
    const dur = durationVal > 0 ? durationVal : PermanentCore.getState?.("player")?.duration / 1e3 || 0;
    if (dur > 0 && bridgeVideo) {
      bridgeVideo.dispatchEvent(new Event("loadedmetadata"));
      bridgeVideo.dispatchEvent(new Event("durationchange"));
    }
  }
  function setupVideoBridge() {
    bridgeHost = document.getElementById("stremio-enhanced-bridge-host");
    if (!bridgeHost) {
      bridgeHost = document.createElement("div");
      bridgeHost.id = "stremio-enhanced-bridge-host";
      Object.assign(bridgeHost.style, {
        position: "fixed",
        top: "0px",
        left: "0px",
        width: "0px",
        height: "0px",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "-9999",
        overflow: "hidden"
      });
    }
    bridgeVideo = document.getElementById("stremio-shell-bridge-video");
    if (!bridgeVideo) {
      bridgeVideo = document.createElement("video");
      bridgeVideo.id = "stremio-shell-bridge-video";
      bridgeVideo.className = "stremio-shell-bridge-video";
      bridgeVideo.setAttribute("playsinline", "");
      bridgeVideo.setAttribute("muted", "");
      bridgeHost.appendChild(bridgeVideo);
    }
    bridgeVideo.closest = function(selector) {
      if (typeof selector === "string" && selector.includes("player-container")) {
        return document.querySelector('[class*="player-container"]') || document.querySelector(".player-container") || document.body;
      }
      return Element.prototype.closest.call(this, selector);
    };
    try {
      Object.defineProperty(bridgeVideo, "currentTime", {
        get() {
          if (currentTimeVal > 0) return currentTimeVal;
          const coreTime = PermanentCore.getState?.("player")?.time;
          if (coreTime && coreTime > 0) return coreTime / 1e3;
          return 0;
        },
        set(val) {
          const targetTime = Math.max(0, Number(val) || 0);
          currentTimeVal = targetTime;
          console.log(`[Enhanced BridgeVideo] Seeking to ${targetTime}s`);
          try {
            if (window.ipc?.postMessage) {
              window.ipc.postMessage(JSON.stringify({
                type: 6,
                args: ["mpv-command", ["seek", String(targetTime), "absolute"]]
              }));
            }
          } catch (e) {
            console.error("[Enhanced BridgeVideo] Failed to post seek IPC:", e);
          }
          bridgeVideo.dispatchEvent(new Event("seeking"));
          bridgeVideo.dispatchEvent(new Event("timeupdate"));
          setTimeout(() => {
            bridgeVideo?.dispatchEvent(new Event("seeked"));
            bridgeVideo?.dispatchEvent(new Event("timeupdate"));
          }, 50);
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "duration", {
        get() {
          if (durationVal > 0) return durationVal;
          const coreDur = PermanentCore.getState?.("player")?.duration;
          if (coreDur && coreDur > 0) return coreDur / 1e3;
          return 0;
        },
        set(val) {
          const newDuration = Math.max(0, Number(val) || 0);
          if (durationVal !== newDuration) {
            durationVal = newDuration;
            bridgeVideo.dispatchEvent(new Event("durationchange"));
            bridgeVideo.dispatchEvent(new Event("loadedmetadata"));
          }
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "paused", {
        get() {
          return pausedVal;
        },
        set(val) {
          pausedVal = Boolean(val);
          try {
            if (window.ipc?.postMessage) {
              window.ipc.postMessage(JSON.stringify({
                type: 6,
                args: ["mpv-set-prop", ["pause", pausedVal]]
              }));
            }
          } catch (_) {
          }
          bridgeVideo.dispatchEvent(new Event(pausedVal ? "pause" : "play"));
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "seeking", {
        get() {
          return seekingVal;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "ended", {
        get() {
          return endedVal;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "playbackRate", {
        get() {
          return speedVal;
        },
        set(val) {
          speedVal = Number(val) || 1;
          try {
            if (window.ipc?.postMessage) {
              window.ipc.postMessage(JSON.stringify({
                type: 6,
                args: ["mpv-set-prop", ["speed", speedVal]]
              }));
            }
          } catch (_) {
          }
          bridgeVideo.dispatchEvent(new Event("ratechange"));
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "volume", {
        get() {
          return volumeVal;
        },
        set(val) {
          volumeVal = Number(val) || 1;
          try {
            if (window.ipc?.postMessage) {
              window.ipc.postMessage(JSON.stringify({
                type: 6,
                args: ["mpv-set-prop", ["volume", volumeVal * 100]]
              }));
            }
          } catch (_) {
          }
          bridgeVideo.dispatchEvent(new Event("volumechange"));
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "muted", {
        get() {
          return mutedVal;
        },
        set(val) {
          mutedVal = Boolean(val);
          try {
            if (window.ipc?.postMessage) {
              window.ipc.postMessage(JSON.stringify({
                type: 6,
                args: ["mpv-set-prop", ["mute", mutedVal]]
              }));
            }
          } catch (_) {
          }
          bridgeVideo.dispatchEvent(new Event("volumechange"));
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "src", {
        get() {
          const s = srcVal || PermanentCore.getState?.("player")?.selected?.stream?.url || "";
          if (s && bridgeVideo.getAttribute("src") !== s) {
            bridgeVideo.setAttribute("src", s);
          }
          return s;
        },
        set(val) {
          srcVal = String(val || "");
          bridgeVideo.setAttribute("src", srcVal);
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "currentSrc", {
        get() {
          const s = srcVal || PermanentCore.getState?.("player")?.selected?.stream?.url || "";
          if (s && bridgeVideo.getAttribute("src") !== s) {
            bridgeVideo.setAttribute("src", s);
          }
          return s;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "readyState", {
        get() {
          const dur = durationVal > 0 ? durationVal : PermanentCore.getState?.("player")?.duration / 1e3 || 0;
          const s = srcVal || PermanentCore.getState?.("player")?.selected?.stream?.url || "";
          return dur > 0 || s !== "" ? 4 : 0;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "videoWidth", {
        get() {
          return videoWidthVal;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "videoHeight", {
        get() {
          return videoHeightVal;
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "buffered", {
        get() {
          const dur = durationVal > 0 ? durationVal : PermanentCore.getState?.("player")?.duration / 1e3 || 0;
          return createTimeRanges(0, dur);
        },
        configurable: true
      });
      Object.defineProperty(bridgeVideo, "seekable", {
        get() {
          const dur = durationVal > 0 ? durationVal : PermanentCore.getState?.("player")?.duration / 1e3 || 0;
          return createTimeRanges(0, dur);
        },
        configurable: true
      });
      bridgeVideo.play = function() {
        pausedVal = false;
        try {
          if (window.ipc?.postMessage) {
            window.ipc.postMessage(JSON.stringify({ type: 6, args: ["mpv-set-prop", ["pause", false]] }));
          }
        } catch (_) {
        }
        bridgeVideo.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
      bridgeVideo.pause = function() {
        pausedVal = true;
        try {
          if (window.ipc?.postMessage) {
            window.ipc.postMessage(JSON.stringify({ type: 6, args: ["mpv-set-prop", ["pause", true]] }));
          }
        } catch (_) {
        }
        bridgeVideo.dispatchEvent(new Event("pause"));
      };
    } catch (e) {
      console.warn("[Enhanced] Failed to define bridgeVideo properties:", e);
    }
    if (window.ipc?.addEventListener) {
      window.ipc.addEventListener("message", (event) => {
        try {
          let msg = event.data;
          if (typeof msg === "string") {
            msg = JSON.parse(msg);
          }
          if (!msg || !msg.args || !Array.isArray(msg.args)) return;
          const [action, payload] = msg.args;
          if (action === "mpv-prop-change" && payload) {
            const { name, data } = payload;
            if (name === "time-pos") {
              const newTime = Number(data);
              if (Number.isFinite(newTime) && Math.abs(currentTimeVal - newTime) > 0.01) {
                currentTimeVal = newTime;
                bridgeVideo.dispatchEvent(new Event("timeupdate"));
              }
            } else if (name === "duration") {
              const newDuration = Number(data);
              if (Number.isFinite(newDuration) && newDuration > 0 && durationVal !== newDuration) {
                durationVal = newDuration;
                bridgeVideo.dispatchEvent(new Event("durationchange"));
                bridgeVideo.dispatchEvent(new Event("loadedmetadata"));
              }
            } else if (name === "pause") {
              const newPaused = Boolean(data);
              if (pausedVal !== newPaused) {
                pausedVal = newPaused;
                bridgeVideo.dispatchEvent(new Event(pausedVal ? "pause" : "play"));
              }
            } else if (name === "seeking") {
              seekingVal = Boolean(data);
              if (seekingVal) {
                bridgeVideo.dispatchEvent(new Event("seeking"));
              } else {
                bridgeVideo.dispatchEvent(new Event("seeked"));
                bridgeVideo.dispatchEvent(new Event("timeupdate"));
              }
            } else if (name === "path") {
              if (data) {
                srcVal = String(data);
                endedVal = false;
                bridgeVideo.setAttribute("src", srcVal);
                bridgeVideo.dispatchEvent(new Event("loadstart"));
                bridgeVideo.dispatchEvent(new Event("loadedmetadata"));
              }
            } else if (name === "speed") {
              speedVal = Number(data) || 1;
              bridgeVideo.dispatchEvent(new Event("ratechange"));
            } else if (name === "volume") {
              volumeVal = (Number(data) || 100) / 100;
              bridgeVideo.dispatchEvent(new Event("volumechange"));
            } else if (name === "mute") {
              mutedVal = Boolean(data);
              bridgeVideo.dispatchEvent(new Event("volumechange"));
            } else if (name === "video-params") {
              try {
                const params = typeof data === "string" ? JSON.parse(data) : data;
                if (params && params.w && params.h) {
                  videoWidthVal = Number(params.w) || 1920;
                  videoHeightVal = Number(params.h) || 1080;
                }
              } catch (_) {
              }
            }
          } else if (action === "mpv-event-ended") {
            endedVal = true;
            bridgeVideo.dispatchEvent(new Event("ended"));
          }
        } catch (_) {
        }
      });
    }
    if (document.body) {
      mountBridgeHost();
    } else {
      document.addEventListener("DOMContentLoaded", mountBridgeHost, { once: true });
      window.addEventListener("load", mountBridgeHost, { once: true });
    }
    setInterval(() => {
      mountBridgeHost();
      const dur = durationVal > 0 ? durationVal : PermanentCore.getState?.("player")?.duration / 1e3 || 0;
      const cur = currentTimeVal > 0 ? currentTimeVal : PermanentCore.getState?.("player")?.time / 1e3 || 0;
      if (!pausedVal && (dur > 0 || cur > 0) && bridgeVideo) {
        bridgeVideo.dispatchEvent(new Event("timeupdate"));
      }
    }, 250);
    return bridgeVideo;
  }

  // src/index.ts
  (function() {
    "use strict";
    if (window.__STREMIO_ENHANCED_INITIALIZED__) return;
    window.__STREMIO_ENHANCED_INITIALIZED__ = true;
    console.log("[Enhanced] Stremio Enhanced initialized.");
    setupPermanentCore();
    setupLogger();
    setupFetchInterceptor();
    setupEnhancedApi();
    setupServerManager();
    setupVideoBridge();
    injectFallbackStyles();
    let currentData = {
      plugins: [],
      themes: [],
      activeTheme: null
    };
    function updateAllSubsystemData(data) {
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
    window.__receiveEnhancedData = function(data) {
      if (!data) return;
      updateAllSubsystemData(data);
      if (currentData.activeTheme) {
        applyThemeUI(currentData.activeTheme);
      } else {
        applyThemeUI("Default");
      }
      loadEnabledPlugins();
      syncLocalStorage();
      renderThemesList((fileName) => {
        window.StremioEnhancedAPI.applyTheme(fileName);
      });
      renderPluginsList((fileName, enabled) => {
        window.StremioEnhancedAPI.togglePlugin(fileName, enabled);
      });
      if (document.getElementById("enhanced")) {
        checkForAllUpdates(false);
      }
    };
    if (window.__INITIAL_ENHANCED_DATA__) {
      updateAllSubsystemData(window.__INITIAL_ENHANCED_DATA__);
      if (currentData.activeTheme) {
        applyThemeUI(currentData.activeTheme);
      }
      syncLocalStorage();
    }
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("hashchange"));
        return result;
      };
    });
    window.addEventListener("hashchange", () => {
      ensureBridgeVideo();
      checkSettings();
    });
    window.addEventListener("popstate", () => {
      ensureBridgeVideo();
      checkSettings();
    });
    window.addEventListener("DOMContentLoaded", () => {
      ensureBridgeVideo();
      ensureActiveTheme();
      loadEnabledPlugins();
      checkSettings();
    });
    window.addEventListener("load", () => {
      ensureBridgeVideo();
      ensureActiveTheme();
      loadEnabledPlugins();
      checkSettings();
    });
    postEnhancedMessage("getData");
    ensureBridgeVideo();
    checkSettings();
    setTimeout(() => {
      checkServerJsUpdateAndSetup(false);
    }, 1200);
  })();
})();
