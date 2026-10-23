import themeItemTemplate from './theme-item.html';
import { TemplateCache } from '../../utils/templateCache';
import { escapeHtml } from '../../utils/dom';
import { ThemeUiData, MetaData } from '../../types';

export function createThemeCard(
    fileName: string,
    meta: ThemeUiData | MetaData,
    isApplied: boolean,
    onApply: (fileName: string) => void
): HTMLElement {
    const buttonClass = isApplied ? 'uninstall-button-container-oV4Yo disabled' : 'install-button-container-yfcq5';
    const label = isApplied ? 'Applied' : 'Apply';

    const descriptionBlock = meta.description ? `<b>Description:</b> ${escapeHtml(meta.description)}<br>` : '';
    const authorBlock = meta.author ? `<b>Author:</b> ${escapeHtml(meta.author)}` : '';

    const html = TemplateCache.render(themeItemTemplate, {
        fileName: escapeHtml(fileName),
        name: escapeHtml(meta.name),
        version: escapeHtml(meta.version || ''),
        descriptionBlock,
        authorBlock,
        buttonClass,
        label
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const card = wrapper.firstElementChild as HTMLElement;

    const applyBtn = card.querySelector<HTMLElement>('.theme-apply-btn');
    if (applyBtn) {
        applyBtn.onclick = function () {
            if (applyBtn.classList.contains('disabled')) return;
            onApply(fileName);
        };
    }

    return card;
}
