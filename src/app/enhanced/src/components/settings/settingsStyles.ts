/**
 * Styles for the Stremio Enhanced settings pages.
 *
 * Stremio's own class names carry a build hash (e.g. "group-schEY") that changes whenever Stremio
 * Web updates, which broke these pages before. The page layout copies Stremio's class names at
 * runtime (see settingsInjector), and the option rows and buttons use the stable classes below.
 * Colours use Stremio Web 5.1's variable names, with the older names as fallbacks.
 */
export const SETTINGS_STYLE_ID = 'enhanced-settings-style';

export const SETTINGS_STYLES = `
.enhanced-page-container { display: none; }
.enhanced-open .enhanced-page-container { display: block; }
.enhanced-open .enhanced-settings-pane > :not(.enhanced-page-container) { display: none !important; }

#enhanced[data-show="themes"] > .enhanced-category:not([data-category="themes"]),
#enhanced[data-show="plugins"] > .enhanced-category:not([data-category="plugins"]),
#enhanced[data-show="marketplace"] > .enhanced-category:not([data-category="marketplace"]),
#enhanced[data-show="player"] > .enhanced-category:not([data-category="player"]),
#enhanced[data-show="server"] > .enhanced-category:not([data-category="server"]),
#enhanced[data-show="preferences"] > .enhanced-category:not([data-category="preferences"]),
#enhanced[data-show="updates"] > .enhanced-category:not([data-category="updates"]) { display: none; }

.enhanced-subsection-title {
    color: var(--foreground-color-secondary, rgba(255, 255, 255, 0.6));
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 1.25rem 0 0.6rem 0.2rem;
}
.enhanced-subsection-title:first-of-type { margin-top: 0.25rem; }

.enhanced-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1.1rem;
    margin-bottom: 0.75rem;
    border-radius: var(--border-radius, 0.75rem);
    background: var(--surface-background-color, var(--overlay-color, rgba(255, 255, 255, 0.05)));
    transition: opacity 0.2s;
}
.enhanced-option.enhanced-option-muted { opacity: 0.55; }
.enhanced-option-heading { flex: 1; min-width: 0; }
.enhanced-option-label {
    color: var(--foreground-color-primary, var(--primary-foreground-color, rgba(255, 255, 255, 0.9)));
    font-size: 1rem;
}
.enhanced-option-description {
    font-size: 0.85rem;
    color: var(--foreground-color-secondary, rgba(255, 255, 255, 0.55));
    margin-top: 0.25rem;
    line-height: 1.4;
}
.enhanced-option-content { flex: none; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.enhanced-option-input-group {
    flex: 0 1 24rem;
    min-width: 14rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
}
.enhanced-text-input {
    flex: 1;
    min-width: 0;
    height: 2.4rem;
    padding: 0 0.85rem;
    border-radius: 0.45rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.07);
    color: var(--foreground-color-primary, var(--primary-foreground-color, #fff));
    font-size: 0.9rem;
    outline: none;
    box-sizing: border-box;
}
.enhanced-text-input:focus {
    border-color: var(--accent-color, var(--primary-accent-color, #7b5bf5));
}

.enhanced-option-content .button,
.enhanced-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.55rem 1.2rem;
    border-radius: 2rem;
    background: var(--surface-background-color, var(--overlay-color, rgba(255, 255, 255, 0.08)));
    color: var(--foreground-color-primary, var(--primary-foreground-color, #fff));
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition: background 0.2s;
}
.enhanced-option-content .button:hover,
.enhanced-button:hover { background: var(--accent-color, var(--primary-accent-color, #7b5bf5)); }

.enhanced-link {
    display: block;
    padding: 0.8rem 1rem;
    border-radius: var(--border-radius, 0.75rem);
    background: var(--surface-background-color, var(--overlay-color, rgba(255, 255, 255, 0.05)));
    cursor: pointer;
}
.enhanced-link a { color: inherit; text-decoration: none; }
.enhanced-link-label { color: var(--foreground-color-primary, var(--primary-foreground-color, #fff)); font-weight: 600; }
.enhanced-link:hover { background: var(--accent-color, var(--primary-accent-color, #7b5bf5)); }

.enhanced-shader-group-title {
    color: var(--foreground-color-secondary, rgba(255, 255, 255, 0.6));
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0.9rem 0 0.45rem 0.2rem;
}
.enhanced-shader-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.65rem;
    margin-bottom: 0.5rem;
}
.enhanced-shader-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.85rem 1rem;
    border-radius: var(--border-radius, 0.75rem);
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: var(--surface-background-color, var(--overlay-color, rgba(255, 255, 255, 0.05)));
    color: var(--foreground-color-primary, var(--primary-foreground-color, #fff));
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s, opacity 0.2s;
}
.enhanced-shader-card:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.09);
}
.enhanced-shader-card.active {
    border-color: var(--accent-color, var(--primary-accent-color, #7b5bf5));
    background: rgba(123, 91, 245, 0.18);
}
.enhanced-shader-card:disabled {
    opacity: 0.65;
    cursor: wait;
}
.enhanced-shader-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}
.enhanced-shader-card-name {
    font-weight: 600;
    font-size: 0.94rem;
}
.enhanced-shader-card-desc {
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--foreground-color-secondary, rgba(255, 255, 255, 0.58));
}
.enhanced-shader-badge {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.14rem 0.5rem;
    border-radius: 999px;
    flex-shrink: 0;
}
.enhanced-shader-badge.ready {
    background: rgba(81, 207, 102, 0.18);
    color: #8ce99a;
}
.enhanced-shader-badge.download {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.82);
}
.enhanced-shader-badge.loading {
    background: rgba(252, 196, 25, 0.2);
    color: #ffe066;
}
.enhanced-patch-notes {
    margin-top: 0.9rem;
    padding: 1rem 1.15rem;
    border-radius: var(--border-radius, 0.75rem);
    background: var(--surface-background-color, var(--overlay-color, rgba(255, 255, 255, 0.05)));
    border: 1px solid rgba(255, 255, 255, 0.08);
    max-height: 300px;
    overflow-y: auto;
    font-size: 0.88rem;
    line-height: 1.5;
}
`;
