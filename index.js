// SillyTavern/data/your_user_handle/extensions/remove-br-tags-extension/index.js
'use strict';

// 从核心脚本导入
import {
    eventSource,
    event_types,
} from '../../../../script.js'; // 确认此相对路径对 data/ 目录下的扩展是正确的

// 从扩展助手脚本导入
import {
    getContext, // 如果需要其他上下文信息
    renderExtensionTemplateAsync,
    extension_settings, // SillyTavern 用于存储所有扩展设置的对象
    // saveSettingsDebounced, // 通常由 settings_display.html 中的脚本通过 SillyTavern.saveSettingsDebounced 调用
} from '../../../extensions.js'; // 确认此相对路径对 data/ 目录下的扩展是正确的

// 插件文件夹名称 (必须与实际文件夹名称完全一致)
const pluginName = 'remove-br-tags-extension';

// 初始化此插件的设置对象 (如果尚不存在)
// settings_display.html 中的脚本也会做类似的检查和初始化
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {
        hideChatBr: false,
        hideAllBr: false
    };
}

// 使用jQuery的DOM ready事件来确保SillyTavern核心和jQuery本身已加载
(function ($) {
    $(async function() { // 异步函数，因为我们要用 await
        console.log(`${pluginName}: DOM ready. Initializing BR Tags Visibility plugin.`);

        // --- 插件核心逻辑变量 ---
        // CSS类名，与 style.css 中定义的保持一致
        const CSS_CLASS_HIDE_CHAT_BR = 'ext-hide-chat-br-tags';
        const CSS_CLASS_HIDE_ALL_BR = 'ext-hide-all-br-tags';

        // --- getSettings 函数: 从共享的 extension_settings 对象中获取本插件的设置 ---
        function getPluginSettingsFromSharedState() {
            const defaultSettings = {
                hideChatBr: false,
                hideAllBr: false
            };
            // 确保模块在 extension_settings 中初始化
            if (!extension_settings[pluginName]) {
                extension_settings[pluginName] = { ...defaultSettings };
            } else {
                // 确保所有键都存在 (以防插件更新增加了新的默认设置)
                 for (const key in defaultSettings) {
                    if (typeof extension_settings[pluginName][key] === 'undefined') {
                        extension_settings[pluginName][key] = defaultSettings[key];
                    }
                }
            }
            return extension_settings[pluginName];
        }

        // --- applyBrVisibility 函数: 根据设置切换body上的CSS类 ---
        function applyBrVisibilityStyle() {
            const settings = getPluginSettingsFromSharedState();
            // console.log(`[${pluginName}] Applying visibility. Settings:`, settings);
            const body = $('body'); //缓存jQuery对象

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

        // --- 将 applyBrVisibilityStyle 函数暴露给 settings_display.html ---
        // 这样 settings_display.html 中的脚本可以在用户更改设置时立即调用它
        if (!window.extensions) {
            window.extensions = {};
        }
        // 使用插件文件夹名作为键，以确保全局命名空间的唯一性
        if (!window.extensions[pluginName]) {
            window.extensions[pluginName] = {};
        }
        window.extensions[pluginName].applyVisibility = function(currentSettings) {
            // console.log(`[${pluginName}] applyVisibility called directly by settings_display.html with:`, currentSettings);
            const body = $('body');
            // 直接使用从 settings_display.html 传来的 currentSettings 对象来更新UI
            // 这是因为 extension_settings 可能由于 saveSettingsDebounced 的异步性而尚未完全同步
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
        // （可选）如果 settings_display.html 需要 PLUGIN_FOLDER_NAME，也可以在这里暴露，
        // 但通常 settings_display.html 可以直接硬编码或通过其他方式获取。
        // window.extensions[pluginName].PLUGIN_FOLDER_NAME = pluginName;


        // --- 加载并注入 settings_display.html ---
        try {
            // 确保 renderExtensionTemplateAsync 函数是从导入中获得的
            if (typeof renderExtensionTemplateAsync !== 'function') {
                const errorMsg = `${pluginName}: renderExtensionTemplateAsync function is not available from imports. Cannot load settings UI.`;
                console.error(errorMsg);
                throw new Error(errorMsg); // 抛出错误以停止执行并进入catch块
            }

            console.log(`${pluginName}: Attempting to load settings UI template 'settings_display' for 'third-party/${pluginName}'...`);
            const settingsHtmlString = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');

            if (settingsHtmlString && typeof settingsHtmlString === 'string') {
                const settingsContainer = $('#extensions_settings'); // SillyTavern 中所有扩展设置的总容器
                if (settingsContainer.length) {
                    // 为这个特定扩展的设置创建一个包装器，方便管理和可能的清理
                    const $extensionSpecificContainer = $(`<div class="extension-settings-container" data-extension="${pluginName}"></div>`);
                    $extensionSpecificContainer.html(settingsHtmlString); // 将HTML内容填入包装器
                    settingsContainer.append($extensionSpecificContainer); // 将包装器追加到总容器
                    console.log(`${pluginName}: Settings UI for '${pluginName}' injected into #extensions_settings.`);
                } else {
                    console.error(`${pluginName}: Target container #extensions_settings not found in the DOM.`);
                }
            } else {
                console.error(`${pluginName}: Loaded settings HTML for 'settings_display' is empty or not a string.`);
            }
        } catch (error) {
            console.error(`${pluginName}: Critical error - Failed to load or inject settings_display.html:`, error);
            // 可以在这里向用户界面添加一个错误提示，如果可能的话
            const settingsContainer = $('#extensions_settings');
            if (settingsContainer.length) {
                settingsContainer.append(`<div style="color: red; padding: 10px; border: 1px solid red;">Error loading settings UI for ${pluginName}: ${error.message || 'Unknown error'}. Check console.</div>`);
            }
        }

        // --- 事件监听：当任何扩展的设置被保存后，SillyTavern会触发此事件 ---
        eventSource.on(event_types.SETTINGS_UPDATED, function() {
            // console.log(`[${pluginName}] Event: SETTINGS_UPDATED received.`);
            // 当事件触发时，从共享的 extension_settings 重新获取本插件的最新设置并应用
            applyBrVisibilityStyle();
        });

        // --- 初始应用 ---
        // 在插件加载完成时，根据当前存储的设置应用一次样式
        applyBrVisibilityStyle();

        console.log(`${pluginName}: BR Tags Visibility plugin initialized successfully.`);

    }); // 结束 $(async function() { ... })
})(jQuery); // 立即调用此匿名函数，并传入 jQuery
