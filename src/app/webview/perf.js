/*
 * WebKitGTK UI responsiveness optimizations for Stremio Web.
 *
 * Why this is needed on Linux (WebKitGTK) while Windows (WebView2/Chromium) is unaffected:
 * 1. Stremio Web's global reset sets `* { overflow: hidden; }`. In WebKit, every
 *    `overflow: hidden` box creates a full RenderLayer + RenderLayerScrollableArea,
 *    producing 1,000+ RenderLayers even in a single viewport. Overriding the universal
 *    reset at equal (0,0,0) specificity with `* { overflow: clip; }` preserves all
 *    explicit `overflow: visible/auto/scroll/hidden` class rules while eliminating
 *    non-scrollable RenderLayers across the entire DOM.
 * 2. Logged-in accounts with many addons render 40-100+ catalog rows on Board
 *    (600-2,000+ posters) or hundreds of cards in Library. Virtualizing off-screen
 *    rows/Spotlight (Board/Search) and large poster grids (Library) via
 *    IntersectionObserver keeps the live DOM/layer tree O(1).
 * 3. Inside each visible poster, negative z-index children (-3/-2/-1) force WebKit's
 *    RenderLayerCompositor into foreground-layer splits whenever a child is composited,
 *    and `transition: transform` on `.poster-image-layer-*` promotes/demotes GPU
 *    GraphicsLayers on every hover. Shifting poster children to non-negative z-indexes,
 *    containing paint on `.poster-container-*`, and disabling hover/press transitions
 *    keeps poster zoom (`scale(1.05)`) instant with zero GraphicsLayer thrash.
 * 4. Isolating `.vertical-nav-bar-container-*` on its own tiny compositing layer and
 *    containing `.board-content-*` prevents sidebar hovers from repainting the Board.
 * 5. Replacing the Board Spotlight's 60fps `width` keyframe with a composited `scaleX`
 *    keyframe and disabling expensive `backdrop-filter: blur(...)` passes eliminates
 *    per-frame main-thread layout and GPU readback stalls on integrated GPUs.
 * 6. Exact hashed class names are discovered once per StyleSheet (cached in a WeakSet)
 *    so injected CSS uses O(1) class selectors instead of `[class*="..."]`.
 * 7. Synchronous full-viewport `document.startViewTransition` snapshots are disabled
 *    so menu navigation renders immediately without blocking input.
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
    const ROOT_MARGIN = '150px 0px 150px 0px';

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
        'progress-bar-layer-',
        'new-videos-',
        'watched-icon-layer-',
        'channel-badge-',
        'menu-label-container-',
        'button-container-',
        'nav-tab-button-container-',
        'vertical-nav-bar-container-',
        'board-content-',
        'menu-toggle-',
        'spotlight-',
        'sentinel-',
        'backdrop-',
        'image-',
    ];

    // Disable hover/press transitions that allocate and tear down WebKit GraphicsLayers
    // on every mouseenter/mouseleave (while preserving static hover visuals like scale(1.05)).
    const NO_TRANSITION_PREFIXES = [
        'meta-item-container-',
        'poster-container-',
        'poster-image-layer-',
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

    const backdropFilterSelectors = new Set();
    const spotlightFillSelectors = new Set();
    const posterHoverRules = new Set();
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

    function recordClass(cls) {
        for (let p = 0; p < PREFIXES.length; p++) {
            const prefix = PREFIXES[p];
            if (cls.startsWith(prefix)) {
                // Keep board-content-<hash> separate from board-content-container-<hash>
                if (prefix === 'board-content-' && cls.startsWith('board-content-container-')) {
                    continue;
                }
                if (!discovered[prefix].has(cls)) {
                    discovered[prefix].add(cls);
                    return true;
                }
                return false;
            }
        }
        return false;
    }

    function collectClassesFromString(text) {
        if (!text) return false;
        const matches = text.match(/[a-zA-Z][a-zA-Z0-9_-]{4,}/g);
        if (!matches) return false;
        let found = false;
        for (let i = 0; i < matches.length; i++) {
            if (recordClass(matches[i])) found = true;
        }
        return found;
    }

    function discoverExactClasses() {
        let foundNew = false;
        try {
            const sheets = document.styleSheets;
            for (let i = 0; i < sheets.length; i++) {
                const sheet = sheets[i];
                if (scannedSheets.has(sheet)) continue;
                if (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID) {
                    scannedSheets.add(sheet);
                    continue;
                }
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
                    const rule = rules[j];
                    const sel = rule.selectorText;
                    if (!sel) continue;

                    const style = rule.style;
                    if (style) {
                        const bf = style.backdropFilter || style.webkitBackdropFilter;
                        if (bf && bf !== 'none' && !sel.includes('[')) {
                            if (!backdropFilterSelectors.has(sel)) {
                                backdropFilterSelectors.add(sel);
                                foundNew = true;
                            }
                        }
                        if (
                            style.animationName &&
                            style.animationName !== 'none' &&
                            sel.includes('.segment-') &&
                            sel.includes('.fill-')
                        ) {
                            if (!spotlightFillSelectors.has(sel)) {
                                spotlightFillSelectors.add(sel);
                                foundNew = true;
                            }
                        }
                        if (sel.includes('.meta-item-container-') && sel.includes('.hovered')) {
                            const parts = sel.split(',');
                            const hoverParts = [];
                            for (let p = 0; p < parts.length; p++) {
                                const part = parts[p].trim();
                                if (part.includes('.hovered')) {
                                    hoverParts.push(part.replace(/\.hovered\b/g, ':hover'));
                                }
                            }
                            if (hoverParts.length > 0 && style.cssText) {
                                const hoverRule = `${hoverParts.join(', ')} { ${style.cssText} }`;
                                if (!posterHoverRules.has(hoverRule)) {
                                    posterHoverRules.add(hoverRule);
                                    foundNew = true;
                                }
                            }
                        }
                    }

                    const matches = sel.match(/\.[a-zA-Z0-9_-]+/g);
                    if (!matches) continue;
                    for (let k = 0; k < matches.length; k++) {
                        if (recordClass(matches[k].slice(1))) {
                            foundNew = true;
                        }
                    }
                }
            }
        } catch (_) {}

        // Fallback: if stylesheets were cross-origin or not yet parsed, sample live DOM once.
        if (discovered['meta-row-container-'].size === 0 && discovered['meta-item-container-'].size === 0) {
            const sample = document.querySelectorAll('[class*="meta-row-"], [class*="meta-item-"], [class*="button-container-"]');
            for (let i = 0; i < sample.length && i < 80; i++) {
                if (collectClassesFromString(sample[i].getAttribute('class'))) {
                    foundNew = true;
                }
            }
        }

        return foundNew;
    }

    function toSelector(set) {
        if (!set || set.size === 0) return '';
        const arr = [];
        for (const c of set) arr.push('.' + c);
        return arr.join(',');
    }

    function ensureExactPerfCss() {
        discoverExactClasses();

        const rowClasses = [
            ...discovered['meta-row-container-'],
            ...discovered['meta-row-placeholder-container-'],
            ...discovered['spotlight-'],
        ];
        const noTransClasses = [];
        for (let i = 0; i < NO_TRANSITION_PREFIXES.length; i++) {
            for (const c of discovered[NO_TRANSITION_PREFIXES[i]]) {
                noTransClasses.push(c);
            }
        }
        const posterContainerSel = toSelector(discovered['poster-container-']);
        const posterImgLayerSel = toSelector(discovered['poster-image-layer-']);
        const posterImgSel = toSelector(discovered['poster-image-']);
        const metaItemSel = toSelector(discovered['meta-item-container-']);
        const menuLabelSel = toSelector(discovered['menu-label-container-']);
        const vNavSel = toSelector(discovered['vertical-nav-bar-container-']);
        const boardContentSel = toSelector(discovered['board-content-']);
        const sentinelClasses = [...discovered['sentinel-']];
        const spotlightClasses = [...discovered['spotlight-']];
        const backdropClasses = [...discovered['backdrop-']];
        const imageClasses = [...discovered['image-']];

        const z1Classes = [
            ...discovered['dismiss-icon-layer-'],
            ...discovered['play-icon-layer-'],
            ...discovered['channel-badge-'],
        ];
        const z2Classes = [
            ...discovered['progress-bar-layer-'],
            ...discovered['new-videos-'],
        ];
        const z3Sel = toSelector(discovered['watched-icon-layer-']);

        if (rowClasses.length === 0 && noTransClasses.length === 0) return;

        rowSelector = rowClasses.map((c) => '.' + c).join(',');
        itemSelector = metaItemSel;

        const key = `${rowClasses.length}|${noTransClasses.length}|${discovered['poster-image-'].size}|${spotlightClasses.length}|${backdropFilterSelectors.size}|${spotlightFillSelectors.size}|${posterHoverRules.size}|${discovered['vertical-nav-bar-container-'].size}|${discovered['board-content-'].size}`;
        const existingStyle = document.getElementById(STYLE_ID);
        if (key === lastStyleKey && existingStyle) return;
        lastStyleKey = key;

        const rules = [];

        // Override Stremio's `* { overflow: hidden; }` reset at identical (0,0,0) specificity
        // so non-scrollable elements clip without allocating WebKit RenderLayers.
        rules.push('* { overflow: clip; }');

        if (rowClasses.length > 0) {
            const nonSpotlightRows = [
                ...discovered['meta-row-container-'],
                ...discovered['meta-row-placeholder-container-'],
            ];
            if (nonSpotlightRows.length > 0) {
                rules.push(`${nonSpotlightRows.map((c) => '.' + c).join(',')} { contain: layout style; }`);
            }
        }
        if (metaItemSel) {
            rules.push(`${metaItemSel} { contain: style; }`);
        }
        if (posterContainerSel) {
            rules.push(`${posterContainerSel} { contain: layout style paint; }`);
        }
        // Eliminate negative z-index children inside poster-container to avoid WebKit
        // foreground-layer splits while preserving exact visual paint stacking order.
        if (posterImgLayerSel) {
            rules.push(`${posterImgLayerSel} { z-index: 0 !important; }`);
        }
        if (z1Classes.length > 0) {
            rules.push(`${z1Classes.map((c) => '.' + c).join(',')} { z-index: 1 !important; }`);
        }
        if (z2Classes.length > 0) {
            rules.push(`${z2Classes.map((c) => '.' + c).join(',')} { z-index: 2 !important; }`);
        }
        if (z3Sel) {
            rules.push(`${z3Sel} { z-index: 3 !important; }`);
        }
        // Replace `right: 1rem; transform: translateX(1rem)` on the 3-dot menu trigger
        // with equivalent layout offset so it doesn't allocate a RenderLayer per poster.
        if (menuLabelSel) {
            rules.push(`${menuLabelSel} { right: 0 !important; transform: none !important; }`);
        }
        // Isolate the left sidebar on its own tiny GPU layer and contain the Board scroll
        // area so hovering sidebar tabs never invalidates or repaints Board posters.
        if (vNavSel) {
            rules.push(`${vNavSel} { contain: layout style paint; transform: translateZ(0); }`);
        }
        if (boardContentSel) {
            rules.push(`${boardContentSel} { contain: layout style paint; }`);
        }

        rules.push(`.${OFFSCREEN_CLASS} { box-sizing: border-box !important; }`);
        if (sentinelClasses.length > 0) {
            const notSentinel = sentinelClasses.map((c) => `:not(.${c})`).join('');
            rules.push(`.${OFFSCREEN_CLASS} > *${notSentinel} { display: none !important; }`);
        } else {
            rules.push(`.${OFFSCREEN_CLASS} > * { display: none !important; }`);
        }

        // Mirror MetaItem `.hovered` rules onto native CSS `:hover` so poster hovering
        // runs entirely in WebKit C++ without React `useHover` setState re-renders.
        if (posterHoverRules.size > 0) {
            for (const ruleStr of posterHoverRules) {
                rules.push(ruleStr);
            }
        }

        if (noTransClasses.length > 0) {
            rules.push(`${noTransClasses.map((c) => '.' + c).join(',')} { transition: none !important; }`);
        }
        // Avoid creating an extra WebKit RenderLayer per poster image for opacity: 0.9
        if (posterImgSel) {
            rules.push(`${posterImgSel} { opacity: 1 !important; }`);
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
        // Replace the Spotlight pager's 60fps main-thread `width` animation with a
        // compositor-driven `scaleX` keyframe (identical look & 8s animationend timing).
        if (spotlightFillSelectors.size > 0) {
            rules.push('@keyframes stremio-linux-fill-scale { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }');
            rules.push(`${[...spotlightFillSelectors].join(',')} { width: 100% !important; transform-origin: left center !important; animation-name: stremio-linux-fill-scale !important; }`);
        }
        // Disable expensive backdrop-filter blur passes that trigger GPU readbacks in Skia.
        if (backdropFilterSelectors.size > 0) {
            rules.push(`${[...backdropFilterSelectors].join(',')} { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`);
        }

        let style = existingStyle;
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            const head = document.head || document.documentElement;
            const activeTheme = document.getElementById('activeTheme');
            if (activeTheme && activeTheme.parentNode === head) {
                head.insertBefore(style, activeTheme);
            } else {
                head.appendChild(style);
            }
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

    function isGridRoute() {
        const h = window.location.hash || '';
        return h.startsWith('#/library') || h.startsWith('#/discover');
    }

    function isVirtualizedRoute() {
        return isRowRoute() || isGridRoute();
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
        } else if (isGridRoute() && itemSelector) {
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

    // Short-circuit React's `@react-aria/interactions` `useHover` (which only toggles `.hovered`
    // on MetaItem via `pointerover`/`pointerout` -> `setState` -> full component re-render).
    // Native CSS `:hover` rules above handle all poster hover visuals with zero JS/React overhead.
    function blockPosterReactHover(e) {
        if (e.buttons !== 0 || e.pointerType === 'touch') return;
        if (!itemSelector || posterHoverRules.size === 0) return;
        const t = e.target;
        const el = t && t.nodeType === 1 ? t : t && t.parentElement;
        if (el && el.closest && el.closest(itemSelector)) {
            e.stopPropagation();
        }
    }
    document.addEventListener('pointerover', blockPosterReactHover, true);
    document.addEventListener('pointerout', blockPosterReactHover, true);

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
