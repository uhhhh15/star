// SillyTavern/public/scripts/extensions/third-party/remove-br-tags-extension/index.js
'use strict';

// --- 更新导入路径 ---
import {
    eventSource,
    event_types,
} from '../../../script.js'; // 路径更新：向上三级到 public/scripts/script.js

let renderExtensionTemplateAsync_imported, extension_settings_imported;
try {
    // 路径更新：向上两级到 public/scripts/extensions/extensions.js (假设文件名为 extensions.js)
    const extensionsModule = await import('../../extensions.js');
    renderExtensionTemplateAsync_imported = extensionsModule.renderExtensionTemplateAsync;
    extension_settings_imported = extensionsModule.extension_settings;
    console.log(`[remove-br-tags-extension] Successfully imported from '../../extensions.js':`, { // 日志中的路径也更新
        renderExtensionTemplateAsync_type: typeof renderExtensionTemplateAsync_imported,
        extension_settings_type: typeof extension_settings_imported
    });
} catch (importError) {
    console.error(`[remove-br-tags-extension] Failed to import from '../../extensions.js':`, importError); // 日志中的路径也更新
}
// --- 导入路径更新结束 ---


const pluginName = 'remove-br-tags-extension';

if (extension_settings_imported && !extension_settings_imported[pluginName]) {
    extension_settings_imported[pluginName] = {
        hideChatBr: false,
        hideAllBr: false
    };
}

(function ($) {
    async function initializePlugin() {
        console.log(`[${pluginName}] DOM ready. initializePlugin called.`);

        if (typeof $ !== 'function') {
            console.error(`[${pluginName}] jQuery ($) is not available even after DOM ready. Aborting.`);
            return;
        }

        const CSS_CLASS_HIDE_CHAT_BR = 'ext-hide-chat-br-tags';
        const CSS_CLASS_HIDE_ALL_BR = 'ext-hide-all-br-tags';

        function getPluginSettingsFromSharedState() {
            if (!extension_settings_imported) {
                console.warn(`[${pluginName}] extension_settings_imported is not available. Using fallback settings.`);
                return { hideChatBr: false, hideAllBr: false };
            }
            const defaultSettings = { hideChatBr: false, hideAllBr: false };
            if (!extension_settings_imported[pluginName]) {
                extension_settings_imported[pluginName] = { ...defaultSettings };
            } else {
                 for (const key in defaultSettings) {
                    if (typeof extension_settings_imported[pluginName][key] === 'undefined') {
                        extension_settings_imported[pluginName][key] = defaultSettings[key];
                    }
                }
            }
            return extension_settings_imported[pluginName];
        }

        function applyBrVisibilityStyle() {
            const settings = getPluginSettingsFromSharedState();
            const body = $('body');
            if (settings.hideAllBr) {
                body.addClass(CSS_CLASS_HIDE_ALL_BR).removeClass(CSS_CLASS_HIDE_CHAT_BR);
            } else {
                body.removeClass(CSS_CLASS_HIDE_ALL_BR);
                if (settings.hideChatBr) {
                    body.addClass(CSS_CLASS_HIDE_CHAT_BR);
                } else {
                    body.removeClass(CSS_CLASS_HIDE_CHAT_BR);
                }
            }
        }

        if (!window.extensions) window.extensions = {};
        if (!window.extensions[pluginName]) window.extensions[pluginName] = {};
        window.extensions[pluginName].applyVisibility = function(currentSettings) {
            const body = $('body');
            if (currentSettings.hideAllBr) {
                body.addClass(CSS_CLASS_HIDE_ALL_BR).removeClass(CSS_CLASS_HIDE_CHAT_BR);
            } else {
                body.removeClass(CSS_CLASS_HIDE_ALL_BR);
                if (currentSettings.hideChatBr) {
                    body.addClass(CSS_CLASS_HIDE_CHAT_BR);
                } else {
                    body.removeClass(CSS_CLASS_HIDE_CHAT_BR);
                }
            }
        };

        let initializeAttempts = 0;
        const maxInitializeAttempts = 30;
        const attemptInterval = 500;

        async function attemptLoadSettingsUI() {
            initializeAttempts++;
            const conditions = {
                renderFuncAvailable: typeof renderExtensionTemplateAsync_imported === 'function',
                settingsContainerExists: $('#extensions_settings').length > 0,
            };

            if (conditions.renderFuncAvailable && conditions.settingsContainerExists) {
                console.log(`[${pluginName}] Core dependencies met after ${initializeAttempts} attempts. Proceeding to load settings UI.`);
                try {
                    // 路径参数 "third-party/${pluginName}" 保持不变，
                    // 因为 renderExtensionTemplateAsync 内部会根据这个格式来解析。
                    // SillyTavern 应该能处理 "third-party/remove-br-tags-extension"
                    // 并找到位于 public/scripts/extensions/third-party/remove-br-tags-extension/settings_display.html 的文件。
                    console.log(`[${pluginName}] Attempting to load settings UI template 'settings_display' for 'third-party/${pluginName}'...`);
                    const settingsHtmlString = await renderExtensionTemplateAsync_imported(`third-party/${pluginName}`, 'settings_display');

                    if (settingsHtmlString && typeof settingsHtmlString === 'string') {
                        const settingsContainer = $('#extensions_settings');
                        const $extensionSpecificContainer = $(`<div class="extension-settings-container" data-extension="${pluginName}"></div>`);
                        $extensionSpecificContainer.html(settingsHtmlString);
                        settingsContainer.append($extensionSpecificContainer);
                        console.log(`[${pluginName}] Settings UI for '${pluginName}' injected into #extensions_settings.`);

                        eventSource.on(event_types.SETTINGS_UPDATED, applyBrVisibilityStyle);
                        applyBrVisibilityStyle();
                        console.log(`[${pluginName}] BR Tags Visibility plugin fully initialized.`);

                    } else {
                        console.error(`[${pluginName}] Loaded settings HTML for 'settings_display' is empty or not a string.`);
                    }
                } catch (error) {
                    console.error(`[${pluginName}] Critical error - Failed to load or inject settings_display.html:`, error);
                    const settingsContainer = $('#extensions_settings');
                    if (settingsContainer.length) {
                         settingsContainer.append(`<div style="color: red; padding: 10px; border: 1px solid red;">Error loading settings UI for ${pluginName}: ${error.message || 'Unknown error'}. Check console.</div>`);
                    }
                }
            } else if (initializeAttempts < maxInitializeAttempts) {
                let missingConditions = [];
                if (!conditions.renderFuncAvailable) missingConditions.push("renderExtensionTemplateAsync_imported is not a function (type: " + typeof renderExtensionTemplateAsync_imported + ")");
                if (!conditions.settingsContainerExists) missingConditions.push("#extensions_settings container not found");

                console.warn(`[${pluginName}] Waiting for core dependencies... Attempt ${initializeAttempts}/${maxInitializeAttempts}. Missing: ${missingConditions.join(', ')}`);
                setTimeout(attemptLoadSettingsUI, attemptInterval);
            } else {
                let finalMissing = [];
                if (typeof renderExtensionTemplateAsync_imported !== 'function') finalMissing.push("renderExtensionTemplateAsync_imported (type: " + typeof renderExtensionTemplateAsync_imported + ")");
                if (!$('#extensions_settings').length) finalMissing.push("#extensions_settings container");

                console.error(`[${pluginName}] Failed to initialize after ${maxInitializeAttempts} attempts. Missing dependencies: ${finalMissing.join('; ')}.`);
                const settingsContainer = $('#extensions_settings');
                if (settingsContainer.length) {
                     settingsContainer.append(`<div style="color: red; padding: 10px; border: 1px solid red;">${pluginName}: Failed to load settings UI. Dependencies not met. Check console.</div>`);
                }
            }
        }

        await attemptLoadSettingsUI();

    }

    $(document).ready(function() {
        if (typeof jQuery === 'undefined' && typeof $ === 'undefined') {
            console.error(`[${pluginName}] jQuery is not defined when document.ready fires. Plugin cannot initialize.`);
            return;
        }
        initializePlugin();
    });

})(jQuery);
