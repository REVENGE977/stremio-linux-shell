import pluginSettingsModalTemplate from './plugin-settings-modal.html';
import promptModalTemplate from './prompt-modal.html';
import alertModalTemplate from './alert-modal.html';
import toastTemplate from './toast.html';
import { TemplateCache } from '../../utils/templateCache';
import { escapeHtml } from '../../utils/dom';
import { SettingSchemaItem } from '../../types';

export const modalManager = {
    openPluginSettingsModal: (
        pluginFileName: string,
        displayNameOrSchema: string | SettingSchemaItem[],
        schemaOrCurrentValues: SettingSchemaItem[] | Record<string, any>,
        currentValuesOrOnSave?: Record<string, any> | ((newSettings: Record<string, any>) => void),
        onSaveCallback?: (newSettings: Record<string, any>) => void
    ): void => {
        let displayName: string;
        let schema: SettingSchemaItem[];
        let currentValues: Record<string, any>;
        let onSave: (newSettings: Record<string, any>) => void;

        if (typeof displayNameOrSchema === 'string') {
            displayName = displayNameOrSchema;
            schema = (schemaOrCurrentValues as SettingSchemaItem[]) || [];
            currentValues = (currentValuesOrOnSave as Record<string, any>) || {};
            onSave = onSaveCallback || (() => {});
        } else {
            displayName = pluginFileName.replace(/\.plugin\.js$/, '').replace(/\.js$/, '');
            schema = (displayNameOrSchema as SettingSchemaItem[]) || [];
            currentValues = (schemaOrCurrentValues as Record<string, any>) || {};
            onSave = (currentValuesOrOnSave as (newSettings: Record<string, any>) => void) || (() => {});
        }

        const modalId = `${pluginFileName.replace(/[^a-zA-Z0-9]/g, '')}-settings-modal`;
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        let settingsHtml = '';
        schema.forEach(setting => {
            const currentValue = currentValues[setting.key] ?? setting.defaultValue ?? '';
            if (setting.type === 'toggle') {
                settingsHtml += modalManager._buildToggle(setting, currentValue);
            } else if (setting.type === 'input') {
                settingsHtml += modalManager._buildInput(setting, currentValue);
            } else if (setting.type === 'select') {
                settingsHtml += modalManager._buildSelect(setting, currentValue);
            }
        });

        let cleanDisplayName = displayName.trim();
        if (/settings$/i.test(cleanDisplayName) && cleanDisplayName.length > 8) {
            cleanDisplayName = cleanDisplayName.replace(/\s*settings$/i, '').trim();
        }

        const modalHtml = TemplateCache.render(pluginSettingsModalTemplate, {
            modalId,
            pluginName: escapeHtml(cleanDisplayName),
            settingsHtml
        });

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalElement = document.getElementById(modalId);
        if (!modalElement) return;

        // Toggle clicks
        const toggles = modalElement.querySelectorAll('.plugin-setting-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('checked');
            });
        });

        const handleCloseAndSave = () => {
            const newValues: Record<string, any> = {};
            schema.forEach(setting => {
                const element = modalElement.querySelector(`[data-key="${setting.key}"]`);
                if (!element) return;

                if (setting.type === 'toggle') {
                    newValues[setting.key] = element.classList.contains('checked');
                } else if (setting.type === 'input' || setting.type === 'select') {
                    newValues[setting.key] = (element as HTMLInputElement | HTMLSelectElement).value;
                }
            });

            modalElement.remove();
            onSave(newValues);
        };

        modalElement.querySelector(`#${modalId}-close-x`)?.addEventListener('click', handleCloseAndSave);
        modalElement.querySelector(`#${modalId}-close-btn`)?.addEventListener('click', handleCloseAndSave);

        // Backdrop click to close & save
        modalElement.addEventListener('click', (e) => {
            if (e.target === modalElement) {
                handleCloseAndSave();
            }
        });

        // Escape key to close
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                window.removeEventListener('keydown', keyHandler);
                handleCloseAndSave();
            }
        };
        window.addEventListener('keydown', keyHandler);
    },

    _buildToggle: (setting: SettingSchemaItem, currentValue: any): string => {
        const isChecked = currentValue === true || currentValue === 'true';
        const checkedClass = isChecked ? 'checked' : '';
        const label = setting.title || (setting as any).label || setting.key;

        return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ''}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0;">
                <div tabindex="0" class="toggle-container-lZfHP button-container-zVLH6 plugin-setting-toggle ${checkedClass}" data-key="${escapeHtml(setting.key)}" style="outline: none; cursor: pointer;">
                    <div class="toggle-toOWM"></div>
                </div>
            </div>
        </div>`;
    },

    _buildInput: (setting: SettingSchemaItem, currentValue: any): string => {
        const label = setting.title || (setting as any).label || setting.key;
        return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ''}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0; width: 50%; max-width: 300px;">
                <label class="search-bar-k7MXd search-bar-container-p4tSt" style="width: 100%; padding: 0; margin: 0; display: block;">
                    <input data-key="${escapeHtml(setting.key)}" size="1" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" tabindex="0" class="search-input-bAgAh text-input-hnLiz plugin-setting-input" type="text" placeholder="${escapeHtml(label)}" value="${escapeHtml(currentValue)}" style="width: 100%; box-sizing: border-box; height: 42px; padding: 0 15px; background-color: rgba(255, 255, 255, 0.08); color: white; border: 1px solid transparent; border-radius: 0.35rem; outline: none;">
                </label>
            </div>
        </div>`;
    },

    _buildSelect: (setting: SettingSchemaItem, currentValue: any): string => {
        const label = setting.title || (setting as any).label || setting.key;
        let optionsHtml = '';
        if (setting.options) {
            setting.options.forEach(opt => {
                const selected = String(opt.value) === String(currentValue) ? 'selected' : '';
                optionsHtml += `<option value="${escapeHtml(opt.value)}" ${selected} style="background-color: #1a1a1a; color: white;">${escapeHtml(opt.label)}</option>`;
            });
        }

        return `
        <div class="option-vFOAS" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-sizing: border-box;">
            <div class="heading-dYMDt" style="flex: 1; padding-right: 20px; min-width: 0;">
                <div class="label-qI6Vh" style="font-size: 1.05rem; font-weight: 600; color: #fff; line-height: 1.4;">${escapeHtml(label)}</div>
                ${setting.description ? `<div style="font-size: 0.85rem; color: #a0a0a0; margin-top: 4px; line-height: 1.4;">${escapeHtml(setting.description)}</div>` : ''}
            </div>
            <div class="content-P2T0i" style="flex-shrink: 0; width: 50%; max-width: 300px;">
                <select data-key="${escapeHtml(setting.key)}" class="search-input-bAgAh text-input-hnLiz plugin-setting-select" style="width: 100%; padding: 0 15px; cursor: pointer; background-color: rgba(255, 255, 255, 0.08); color: white; border: 1px solid transparent; border-radius: 0.35rem; outline: none; appearance: auto; box-sizing: border-box; height: 42px;">
                    ${optionsHtml}
                </select>
            </div>
        </div>`;
    },

    showPrompt: (promptId: string, title: string, message: string, defaultValue = ''): Promise<string | null> => {
        return new Promise((resolve) => {
            const modalId = `prompt-modal-${promptId.replace(/[^a-zA-Z0-9]/g, '')}`;
            document.getElementById(modalId)?.remove();

            const html = TemplateCache.render(promptModalTemplate, {
                modalId,
                title: escapeHtml(title),
                message: escapeHtml(message),
                defaultValue: escapeHtml(defaultValue)
            });

            document.body.insertAdjacentHTML('beforeend', html);

            const modal = document.getElementById(modalId);
            const input = document.getElementById(`${modalId}-input`) as HTMLInputElement;
            const cancelBtn = document.getElementById(`${modalId}-cancel`);
            const saveBtn = document.getElementById(`${modalId}-save`);

            if (!modal || !input) {
                resolve(null);
                return;
            }

            input.focus();

            const closeAndRespond = (value: string | null) => {
                modal.remove();
                resolve(value);
            };

            cancelBtn?.addEventListener('click', () => closeAndRespond(null));
            saveBtn?.addEventListener('click', () => closeAndRespond(input.value));

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') closeAndRespond(input.value);
                if (e.key === 'Escape') closeAndRespond(null);
            });
        });
    },

    showAlert: (alertType: string, title: string, message: string, buttons: string[] = ['OK']): Promise<number> => {
        return new Promise((resolve) => {
            const modalId = `alert-modal-${Math.random().toString(36).substring(2, 9)}`;
            document.getElementById(modalId)?.remove();

            const btnList = Array.isArray(buttons) && buttons.length > 0 ? buttons : ['OK'];
            let buttonsHtml = '';
            btnList.forEach((btnText, index) => {
                const isPrimary = index === 0;
                const bgStyle = isPrimary ? 'background-color: var(--primary-accent-color, #735bf2); color: white;' : 'background-color: rgba(255,255,255,0.1); color: #ccc;';
                buttonsHtml += `
                    <div tabindex="0" class="button-container-zVLH6 alert-dialog-btn" data-index="${index}" style="cursor: pointer; padding: 10px 22px; border-radius: 4px; font-weight: 600; ${bgStyle}">
                        <div class="label-wbfsE">${escapeHtml(btnText)}</div>
                    </div>
                `;
            });

            const html = TemplateCache.render(alertModalTemplate, {
                modalId,
                title: escapeHtml(title),
                message: escapeHtml(message),
                buttonsHtml
            });

            document.body.insertAdjacentHTML('beforeend', html);
            const modal = document.getElementById(modalId);
            if (!modal) {
                resolve(-1);
                return;
            }

            const closeWithResult = (resIndex: number) => {
                modal.remove();
                resolve(resIndex);
            };

            modal.querySelectorAll('.alert-dialog-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.getAttribute('data-index')) || 0;
                    closeWithResult(idx);
                });
            });

            const keyHandler = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    window.removeEventListener('keydown', keyHandler);
                    closeWithResult(btnList.length > 1 ? 1 : 0);
                }
            };
            window.addEventListener('keydown', keyHandler);
        });
    },

    showToast: (id: string, title: string, message: string, status: 'success' | 'fail' | 'info' = 'success'): void => {
        let container = document.querySelector('.toasts-container-oKECy') as HTMLElement;
        if (!container) {
            container = document.createElement('div');
            container.className = 'toasts-container-oKECy';
            Object.assign(container.style, {
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                zIndex: '9999999',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                pointerEvents: 'none'
            });
            document.body.appendChild(container);
        }

        const toastId = `toast-${id || Math.random().toString(36).substring(2, 9)}`;
        document.getElementById(toastId)?.remove();

        const html = TemplateCache.render(toastTemplate, {
            id: toastId,
            title: escapeHtml(title),
            message: escapeHtml(message),
            status: status === 'fail' ? 'error-quyOd' : status === 'info' ? 'info-KEWq8' : 'success-eIDTa'
        });

        const temp = document.createElement('div');
        temp.innerHTML = html.trim();
        const toastEl = temp.firstElementChild as HTMLElement;
        if (!toastEl) return;
        toastEl.style.pointerEvents = 'auto';

        container.appendChild(toastEl);

        setTimeout(() => {
            toastEl.style.opacity = '0';
            toastEl.style.transform = 'translateY(10px)';
            setTimeout(() => toastEl.remove(), 300);
        }, 4000);
    }
};
