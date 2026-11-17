import themeItemTemplate from './theme-item.html';
import { TemplateCache } from '../../utils/templateCache';
import { escapeHtml, postEnhancedMessage } from '../../utils/dom';
import { ThemeUiData, MetaData } from '../../types';
import { modalManager } from '../modals/modalManager';
import { applyThemeUI } from '../../themes/themeManager';

export function createThemeCard(
    fileName: string,
    meta: ThemeUiData | MetaData,
    isApplied: boolean,
    onApply: (fileName: string) => void
): HTMLElement {
    const buttonClass = isApplied ? 'uninstall-button-container-oV4Yo disabled' : 'install-button-container-yfcq5';
    const label = isApplied ? 'Applied' : 'Apply';
    const deleteDisplay = fileName.toLowerCase() === 'default' ? 'none' : 'flex';
    const themeDisplayName = (meta && meta.name && meta.name.trim().length > 0) ? meta.name.trim() : fileName;

    const descriptionBlock = meta.description ? `<b>Description:</b> ${escapeHtml(meta.description)}<br>` : '';
    const authorBlock = meta.author ? `<b>Author:</b> ${escapeHtml(meta.author)}` : '';

    const html = TemplateCache.render(themeItemTemplate, {
        fileName: escapeHtml(fileName),
        name: escapeHtml(meta.name),
        version: escapeHtml(meta.version || ''),
        descriptionBlock,
        authorBlock,
        buttonClass,
        label,
        deleteDisplay
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

    const deleteBtn = card.querySelector<HTMLElement>('.theme-delete-btn');
    if (deleteBtn && fileName.toLowerCase() !== 'default') {
        const handleDelete = async (e: Event) => {
            e.stopPropagation();
            const result = await modalManager.showAlert(
                'danger',
                'Delete Theme',
                `Are you sure you want to delete "${themeDisplayName}" (${fileName})?\n\nThis will permanently remove the theme file from your themes folder.`,
                ['Delete', 'Cancel']
            );
            if (result !== 0) return;

            if (applyBtn?.classList.contains('disabled')) {
                applyThemeUI('Default');
            }

            postEnhancedMessage('deleteMod', {
                modType: 'theme',
                fileName
            });

            card.remove();
            modalManager.showToast(
                'theme-deleted',
                'Theme Deleted',
                `Deleted ${themeDisplayName}.`,
                'info'
            );
        };

        deleteBtn.onclick = handleDelete;
        deleteBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleDelete(e);
            }
        });
    }

    return card;
}
