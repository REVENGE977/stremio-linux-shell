/*
 * WebKitGTK UI responsiveness optimizations for Stremio Web.
 *
 * Why this is needed on Linux (WebKitGTK) while Windows (WebView2/Chromium) is unaffected:
 * 1. Logged-in Stremio accounts with many addons render 40-100+ catalog rows on
 *    Board (600-2,000+ posters) or hundreds of cards in Library. Each poster
 *    creates 8-10 WebKit RenderLayers (negative z-index stacking layers +
 *    opacity < 1). On every hover or click (even on the left sidebar), WebKit's
 *    RenderLayerCompositor walks all live layers through
 *    OverlapMapContainer::overlapsLayers and CoordinatedSceneState::commitPendingLayers
 *    (O(N*M)), stalling hover/click to 200-400ms+ while compositor-threaded
 *    scrolling remains unaffected.
 * 2. Virtualizing off-screen catalog rows (Board/Search) and large poster grids
 *    (Library) via IntersectionObserver — using a 350px pre-render margin inside
 *    the actual scroll container and locking height from
 *    entry.boundingClientRect.height (zero forced synchronous layout) — keeps
 *    WebKit's active RenderLayer tree O(1) (~4-5 rows) regardless of how many
 *    addons are installed.
 * 3. Exact hashed class names are discovered once per StyleSheet (cached in a
 *    WeakSet) so injected CSS uses O(1) class selectors instead of [class*="..."]
 *    substring matching (which burns CPU in WTF::StringImpl::find).
 * 4. Press/click layer-churn transitions (:active scale) and the Spotlight's
 *    continuous 14s masked Ken Burns zoom are disabled, while smooth poster
 *    hover zoom is preserved now that Skia + damage tracking + virtualization
 *    keep active layers small.
 * 5. Synchronous full-viewport document.startViewTransition snapshots are
 *    disabled so menu navigation renders immediately without blocking input.
 */
(function () {
    'use strict';

    if (window.__STREMIO_LINUX_PERF_INIT__) return;
    window.__STREMIO_LINUX_PERF_INIT__ = true;

    // 1. Disable synchronous full-viewport View Transitions snapshots on route clicks
    if (typeof Document !== 'undefined' && Document.prototype && 'startViewTransition' in Document.prototype) {
        try {
            Object.defineProperty(Document.prototype, 'startViewTransition', {
                value: undefined,
                configurable: true,
                writable: true,
            });
        } catch (_) {}
    }

    const STYLE_ID = 'stremio-linux-perf-style';
    const OFFSCREEN_CLASS = 'stremio-linux-row-offscreen';
    const ROOT_MARGIN = '350px 0px 350px 0px';

    const PREFIXES = [
        'meta-row-container-',
        'meta-row-placeholder-container-',
        'meta-item-container-',
        'poster-container-',
        'poster-image-layer-',
        'poster-image-',
        'dismiss-icon-layer-',
        'play-icon-layer-',
        'play-icon-outer-',
        'play-icon-background-',
        'menu-label-container-',
        'button-container-',
        'nav-tab-button-container-',
        'menu-toggle-',
        'spotlight-',
        'backdrop-',
        'image-',
    ];

    // Remove click/press scale and secondary icon transitions that thrash GPU
    // backing layers, while keeping smooth poster-image-layer hover zoom.
    const NO_TRANSITION_PREFIXES = [
        'meta-item-container-',
        'poster-container-',
        'dismiss-icon-layer-',
        'play-icon-layer-',
        'play-icon-outer-',
        'play-icon-background-',
        'menu-label-container-',
        'button-container-',
        'nav-tab-button-container-',
        'menu-toggle-',
    ];

    const discovered = {};
    for (let i = 0; i < PREFIXES.length; i++) {
        discovered[PREFIXES[i]] = new Set();
    }

    const scannedSheets = new WeakSet();
    let lastStyleKey = '';
    let rowSelector = '';
    let itemSelector = '';
    let domObserver = null;
    let scanTimer = null;

    // Per-scroll-root IntersectionObservers so rootMargin applies inside the
    // actual scrollable container (e.g. .board-content-*) rather than only viewport.
    const observersByRoot = new WeakMap();
    let viewportObserver = null;
    const observedElements = new WeakSet();

    function collectClassesFromString(text) {
        if (!text) return;
        const matches = text.match(/[a-zA-Z][a-zA-Z0-9_-]{4,}/g);
        if (!matches) return;
        for (let i = 0; i < matches.length; i++) {
            const cls = matches[i];
            for (let j = 0; j < PREFIXES.length; j++) {
                const prefix = PREFIXES[j];
                if (cls.startsWith(prefix)) {
                    discovered[prefix].add(cls);
                    break;
                }
            }
        }
    }

    function discoverExactClasses() {
        let foundNew = false;
        try {
            const sheets = document.styleSheets;
            for (let i = 0; i < sheets.length; i++) {
                const sheet = sheets[i];
                if (scannedSheets.has(sheet)) continue;
                let rules;
                try {
                    rules = sheet.cssRules;
                } catch (_) {
                    scannedSheets.add(sheet);
                    continue;
                }
                if (!rules || rules.length === 0) continue;
                scannedSheets.add(sheet);
                for (let j = 0; j < rules.length; j++) {
                    const sel = rules[j].selectorText;
                    if (!sel) continue;
                    const matches = sel.match(/\.[a-zA-Z0-9_-]+/g);
                    if (!matches) continue;
                    for (let k = 0; k < matches.length; k++) {
                        const cls = matches[k].slice(1);
                        for (let p = 0; p < PREFIXES.length; p++) {
                            const prefix = PREFIXES[p];
                            if (cls.startsWith(prefix)) {
                                if (!discovered[prefix].has(cls)) {
                                    discovered[prefix].add(cls);
                                    foundNew = true;
                                }
                                break;
                            }
                        }
                    }
                }
            }
        } catch (_) {}

        // Fallback: if stylesheets were cross-origin or not yet parsed, sample live DOM once.
        if (discovered['meta-row-container-'].size === 0 && discovered['meta-item-container-'].size === 0) {
            const sample = document.querySelectorAll('[class*="meta-row-"], [class*="meta-item-"], [class*="button-container-"]');
            for (let i = 0; i < sample.length && i < 80; i++) {
                collectClassesFromString(sample[i].getAttribute('class'));
            }
            if (discovered['meta-row-container-'].size > 0 || discovered['meta-item-container-'].size > 0) {
                foundNew = true;
            }
        }

        return foundNew;
    }

    function ensureExactPerfCss() {
        discoverExactClasses();

        const rowClasses = [
            ...discovered['meta-row-container-'],
            ...discovered['meta-row-placeholder-container-'],
        ];
        const noTransClasses = [];
        for (let i = 0; i < NO_TRANSITION_PREFIXES.length; i++) {
            for (const c of discovered[NO_TRANSITION_PREFIXES[i]]) {
                noTransClasses.push(c);
            }
        }
        const posterImgClasses = [...discovered['poster-image-']];
        const metaItemClasses = [...discovered['meta-item-container-']];
        const spotlightClasses = [...discovered['spotlight-']];
        const backdropClasses = [...discovered['backdrop-']];
        const imageClasses = [...discovered['image-']];

        if (rowClasses.length === 0 && noTransClasses.length === 0) return;

        rowSelector = rowClasses.map((c) => '.' + c).join(',');
        itemSelector = metaItemClasses.map((c) => '.' + c).join(',');

        const key = `${rowClasses.length}|${noTransClasses.length}|${posterImgClasses.length}|${spotlightClasses.length}`;
        if (key === lastStyleKey && document.getElementById(STYLE_ID)) return;
        lastStyleKey = key;

        const rules = [];
        if (rowClasses.length > 0) {
            rules.push(`${rowSelector} { contain: layout style; }`);
        }
        if (metaItemClasses.length > 0) {
            rules.push(`${itemSelector} { contain: style; }`);
        }
        rules.push(`.${OFFSCREEN_CLASS} { box-sizing: border-box !important; }`);
        rules.push(`.${OFFSCREEN_CLASS} > * { display: none !important; }`);

        if (noTransClasses.length > 0) {
            rules.push(`${noTransClasses.map((c) => '.' + c).join(',')} { transition: none !important; }`);
        }
        // Avoid creating an extra WebKit RenderLayer per poster image for opacity: 0.9
        if (posterImgClasses.length > 0) {
            rules.push(`${posterImgClasses.map((c) => '.' + c).join(',')} { opacity: 1 !important; }`);
        }
        // Stop continuous 14s masked Ken Burns zoom on Board Spotlight hero image
        if (spotlightClasses.length > 0 && backdropClasses.length > 0 && imageClasses.length > 0) {
            const spSels = [];
            for (const s of spotlightClasses) {
                for (const b of backdropClasses) {
                    for (const im of imageClasses) {
                        spSels.push(`.${s} .${b} .${im}`);
                    }
                }
            }
            if (spSels.length > 0 && spSels.length <= 32) {
                rules.push(`${spSels.join(',')} { transform: none !important; transition: none !important; }`);
            }
        }

        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = rules.join('\n');
    }

    function findScrollParent(el) {
        let curr = el.parentElement;
        while (curr && curr !== document.body && curr !== document.documentElement) {
            const style = window.getComputedStyle(curr);
            const oy = style.overflowY;
            if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
                return curr;
            }
            curr = curr.parentElement;
        }
        return null;
    }

    function handleIntersections(entries) {
        // Batch reads (using IntersectionObserver's already-computed boundingClientRect)
        // before DOM mutations to avoid forced synchronous layout thrashing during scroll.
        const toShow = [];
        const toHide = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const el = entry.target;
            if (entry.isIntersecting) {
                if (el.classList.contains(OFFSCREEN_CLASS)) {
                    toShow.push(el);
                }
            } else if (!el.classList.contains(OFFSCREEN_CLASS)) {
                const h = Math.round(entry.boundingClientRect.height);
                if (h >= 40) {
                    toHide.push([el, h]);
                }
            }
        }
        for (let i = 0; i < toShow.length; i++) {
            const el = toShow[i];
            el.classList.remove(OFFSCREEN_CLASS);
            el.style.minHeight = '';
        }
        for (let i = 0; i < toHide.length; i++) {
            const [el, h] = toHide[i];
            el.style.minHeight = h + 'px';
            el.classList.add(OFFSCREEN_CLASS);
        }
    }

    function getObserverForRoot(root) {
        if (!root) {
            if (!viewportObserver) {
                viewportObserver = new IntersectionObserver(handleIntersections, {
                    root: null,
                    rootMargin: ROOT_MARGIN,
                    threshold: 0,
                });
            }
            return viewportObserver;
        }
        let obs = observersByRoot.get(root);
        if (!obs) {
            obs = new IntersectionObserver(handleIntersections, {
                root: root,
                rootMargin: ROOT_MARGIN,
                threshold: 0,
            });
            observersByRoot.set(root, obs);
        }
        return obs;
    }

    function isRowRoute() {
        const h = window.location.hash || '';
        return (
            h === '' ||
            h === '#' ||
            h === '#/' ||
            h.startsWith('#/?') ||
            h.startsWith('#/board') ||
            h.startsWith('#/search')
        );
    }

    function isLibraryRoute() {
        const h = window.location.hash || '';
        return h.startsWith('#/library');
    }

    function isVirtualizedRoute() {
        return isRowRoute() || isLibraryRoute();
    }

    function scanTargets() {
        ensureExactPerfCss();

        if (isRowRoute() && rowSelector) {
            const rows = document.querySelectorAll(rowSelector);
            let cachedRoot;
            let hasCachedRoot = false;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (observedElements.has(row)) continue;
                observedElements.add(row);
                if (!hasCachedRoot) {
                    cachedRoot = findScrollParent(row);
                    hasCachedRoot = true;
                }
                getObserverForRoot(cachedRoot).observe(row);
            }
        } else if (isLibraryRoute() && itemSelector) {
            const items = document.querySelectorAll(itemSelector);
            if (items.length <= 40) return;
            let cachedRoot;
            let hasCachedRoot = false;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (observedElements.has(item)) continue;
                observedElements.add(item);
                if (!hasCachedRoot) {
                    cachedRoot = findScrollParent(item);
                    hasCachedRoot = true;
                }
                getObserverForRoot(cachedRoot).observe(item);
            }
        }
    }

    function scheduleScan(delayMs) {
        if (scanTimer !== null) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanTargets();
        }, delayMs);
    }

    function syncDomObserver() {
        if (!isVirtualizedRoute()) {
            if (domObserver) {
                domObserver.disconnect();
                domObserver = null;
            }
            return;
        }
        if (domObserver) return;
        const target = document.getElementById('app') || document.body;
        if (!target) return;

        domObserver = new MutationObserver((mutations) => {
            for (let i = 0; i < mutations.length; i++) {
                const added = mutations[i].addedNodes;
                for (let j = 0; j < added.length; j++) {
                    if (added[j].nodeType === 1) {
                        scheduleScan(150);
                        return;
                    }
                }
            }
        });
        domObserver.observe(target, { childList: true, subtree: true });
    }

    function onRouteOrLoad() {
        syncDomObserver();
        scheduleScan(100);
        setTimeout(() => {
            syncDomObserver();
            scanTargets();
        }, 600);
    }

    window.addEventListener('hashchange', onRouteOrLoad);
    window.addEventListener('popstate', onRouteOrLoad);
    window.addEventListener('DOMContentLoaded', onRouteOrLoad);
    window.addEventListener('load', onRouteOrLoad);

    // Ensure keyboard/programmatic focus inside an offscreen row/card reveals it immediately
    document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (t && t.closest) {
            const off = t.closest('.' + OFFSCREEN_CLASS);
            if (off) {
                off.classList.remove(OFFSCREEN_CLASS);
                off.style.minHeight = '';
            }
        }
    }, true);

    if (document.readyState !== 'loading') {
        onRouteOrLoad();
    }
})();
