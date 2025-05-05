// Import from the core script
import {
    eventSource,
    event_types,
    messageFormatting,
    chat,                     // 用于访问聊天记录
    clearChat,                // 用于清空聊天
    doNewChat,                // 用于创建新聊天
    openCharacterChat,        // 用于打开角色聊天
    renameChat,               // 用于重命名聊天
    // addOneMessage,         // 不直接导入, 使用 context.addOneMessage
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced
} from '../../../extensions.js';

// Import from the Popup utility script
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import for group chats
import { openGroupChat } from "../../../group-chats.js";

// Import from the general utility script
import {
    uuidv4,
    timestampToMoment, // <--- 确保 timestampToMoment 已导入，导出功能需要它
    waitUntilCondition,
} from '../../../utils.js';



// Define plugin folder name (important for consistency)
const pluginName = 'star'; // 保持文件夹名称一致

// Initialize plugin settings if they don't exist
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}

// --- 新增：预览状态管理 ---
const previewState = {
    isActive: false,
    originalContext: null, // { characterId: string|null, groupId: string|null, chatId: string }
    previewChatId: null,   // 预览聊天的 ID
};
const returnButtonId = 'favorites-return-button'; // 返回按钮的 ID

// Define HTML for the favorite toggle icon
const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// Store reference to the favorites popup
let favoritesPopup = null;
// Current pagination state
let currentPage = 1;
const itemsPerPage = 5;

/**
 * Ensures the favorites array exists in the current chat metadata accessed via getContext()
 * @returns {object | null} The chat metadata object if available and favorites array is ensured, null otherwise.
 */
function ensureFavoritesArrayExists() {
    let context;
    try {
        context = getContext();
        if (!context || !context.chatMetadata) {
            console.error(`${pluginName}: ensureFavoritesArrayExists - context or context.chatMetadata is not available!`);
            return null;
        }
    } catch (e) {
        console.error(`${pluginName}: ensureFavoritesArrayExists - Error calling getContext():`, e);
        return null;
    }
    const chatMetadata = context.chatMetadata;
    if (!Array.isArray(chatMetadata.favorites)) {
        console.log(`${pluginName}: Initializing chatMetadata.favorites array.`);
        chatMetadata.favorites = [];
    }
    return chatMetadata;
}


/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    console.log(`${pluginName}: addFavorite 函数开始执行，接收到的 messageInfo:`, messageInfo);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata) {
         console.error(`${pluginName}: addFavorite - 获取 chatMetadata 失败，退出`);
         return;
    }
    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId,
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };
    if (!Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: addFavorite - chatMetadata.favorites 不是数组，无法添加！`);
        return;
    }
    console.log(`${pluginName}: 添加前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    chatMetadata.favorites.push(item);
    console.log(`${pluginName}: 添加后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced();
    console.log(`${pluginName}: Added favorite:`, item);
    if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
        updateFavoritesPopup();
    }
}

/**
 * Removes a favorite by its ID
 * @param {string} favoriteId The ID of the favorite to remove
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteById(favoriteId) {
    console.log(`${pluginName}: removeFavoriteById - 尝试删除 ID: ${favoriteId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        console.warn(`${pluginName}: removeFavoriteById - chatMetadata 无效或 favorites 数组为空`);
        return false;
    }
    const indexToRemove = chatMetadata.favorites.findIndex(fav => fav.id === favoriteId);
    if (indexToRemove !== -1) {
        console.log(`${pluginName}: 删除前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
        chatMetadata.favorites.splice(indexToRemove, 1);
        console.log(`${pluginName}: 删除后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存删除...`);
        saveMetadataDebounced();
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        return true;
    }
    console.warn(`${pluginName}: Favorite with id ${favoriteId} not found.`);
    return false;
}

/**
 * Removes a favorite by the message ID it references
 * @param {string} messageId The message ID (from mesid attribute)
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    console.log(`${pluginName}: removeFavoriteByMessageId - 尝试删除 messageId: ${messageId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: removeFavoriteByMessageId - chatMetadata 无效或 favorites 数组为空`);
         return false;
    }
    const favItem = chatMetadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
        return removeFavoriteById(favItem.id);
    }
    console.warn(`${pluginName}: Favorite for messageId ${messageId} not found.`);
    return false;
}

/**
 * Updates the note for a favorite item
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 */
function updateFavoriteNote(favoriteId, note) {
    console.log(`${pluginName}: updateFavoriteNote - 尝试更新 ID: ${favoriteId} 的备注`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: updateFavoriteNote - chatMetadata 无效或 收藏夹为空`);
         return;
    }
    const favorite = chatMetadata.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        favorite.note = note;
        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存备注更新...`);
        saveMetadataDebounced();
        console.log(`${pluginName}: Updated note for favorite ${favoriteId}`);
    } else {
        console.warn(`${pluginName}: updateFavoriteNote - Favorite with id ${favoriteId} not found.`);
    }
}

/**
 * Handles the toggle of favorite status when clicking the star icon
 * @param {Event} event The click event
 */
function handleFavoriteToggle(event) {
    console.log(`${pluginName}: handleFavoriteToggle - 开始执行`);
    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) {
        console.log(`${pluginName}: handleFavoriteToggle - 退出：未找到 .favorite-toggle-icon`);
        return;
    }
    const messageElement = target.closest('.mes');
    if (!messageElement || !messageElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：无法找到父级 .mes 元素`);
        return;
    }
    const messageIdString = messageElement.attr('mesid');
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：未找到 mesid 属性`);
        return;
    }
    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：mesid 解析为 NaN: ${messageIdString}`);
        return;
    }
    console.log(`${pluginName}: handleFavoriteToggle - 获取 context 和消息对象 (索引: ${messageIndex})`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat) {
            console.error(`${pluginName}: handleFavoriteToggle - 退出：getContext() 返回无效或缺少 chat 属性`);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：调用 getContext() 时出错:`, e);
        return;
    }
    const message = context.chat[messageIndex];
    if (!message) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在索引 ${messageIndex} 未找到消息对象 (来自 mesid ${messageIdString})`);
        return;
    }
    console.log(`${pluginName}: handleFavoriteToggle - 成功获取消息对象:`, message);
    const iconElement = target.find('i');
    if (!iconElement || !iconElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在 .favorite-toggle-icon 内未找到 i 元素`);
        return;
    }
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');
    console.log(`${pluginName}: handleFavoriteToggle - 更新 UI，当前状态 (isFavorited): ${isCurrentlyFavorited}`);
    if (isCurrentlyFavorited) {
        iconElement.removeClass('fa-solid').addClass('fa-regular');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：取消收藏 (regular icon)`);
    } else {
        iconElement.removeClass('fa-regular').addClass('fa-solid');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：收藏 (solid icon)`);
    }
    if (!isCurrentlyFavorited) {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 addFavorite`);
        const messageInfo = {
            messageId: messageIdString,
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
        };
        console.log(`${pluginName}: handleFavoriteToggle - addFavorite 参数:`, messageInfo);
        try {
            addFavorite(messageInfo);
            console.log(`${pluginName}: handleFavoriteToggle - addFavorite 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 addFavorite 时出错:`, e);
        }
    } else {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 removeFavoriteByMessageId`);
        console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 参数: ${messageIdString}`);
        try {
            removeFavoriteByMessageId(messageIdString);
            console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 removeFavoriteByMessageId 时出错:`, e);
        }
    }
    console.log(`${pluginName}: handleFavoriteToggle - 执行完毕`);
}

/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 */
function addFavoriteIconsToMessages() {
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取有效的 chatMetadata 或 favorites 数组`);
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }
    addFavoriteIconsToMessages(); // 确保结构存在
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid');
        if (messageId) {
            const isFavorited = chatMetadata.favorites.some(fav => fav.messageId === messageId);
            const iconElement = messageElement.find('.favorite-toggle-icon i');
            if (iconElement.length) {
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination, relative to sorted array)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    if (!favItem) return '';
    const context = getContext();
    const messageIndex = parseInt(favItem.messageId, 10);
    let message = null;
    let previewText = '';
    let deletedClass = '';
    let sendDateString = '';

    if (!isNaN(messageIndex) && context.chat && context.chat[messageIndex]) {
         message = context.chat[messageIndex];
    }

    if (message) {
        if (message.send_date) {
            try {
                sendDateString = timestampToMoment(message.send_date).format('YYYY-MM-DD HH:mm:ss');
            } catch(e) {
                console.warn(`[${pluginName}] renderFavoriteItem: Failed to format timestamp ${message.send_date}`, e);
                sendDateString = message.send_date; // 回退到原始字符串
            }
        } else {
            sendDateString = '[时间未知]';
        }

        if (message.mes) {
            previewText = message.mes;
            try {
                 // 使用 try-catch 包裹 messageFormatting，防止潜在错误中断渲染
                 previewText = messageFormatting(previewText, favItem.sender, false,
                                                favItem.role === 'user', null, {}, false);
            } catch (e) {
                 console.error(`${pluginName}: Error formatting message preview for favId ${favItem.id} (msgId ${favItem.messageId}):`, e);
                 // 格式化失败时显示原始文本，并添加提示
                 previewText = `[格式化失败] ${message.mes}`;
            }
        } else {
            previewText = '[消息内容为空]';
        }

    } else {
        previewText = '[消息内容不可用或已删除]';
        sendDateString = '[时间不可用]';
        deletedClass = 'deleted';
    }

    const formattedMesid = `# ${favItem.messageId}`;

    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-header-info">
                <div class="fav-send-date">
                    ${sendDateString}
                    <span class="fav-mesid" title="原始消息索引 (mesid)">${formattedMesid}</span>
                </div>
                <div class="fav-meta">${favItem.sender}</div>
            </div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">${favItem.note || ''}</div>
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!favoritesPopup || !chatMetadata) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready or chatMetadata missing.`);
        return;
    }
    if (!favoritesPopup.content) {
        console.error(`${pluginName}: updateFavoritesPopup - favoritesPopup.content is null or undefined! Cannot update.`);
        return;
    }
    const context = getContext();
    const chatName = context.characterId ? context.name2 : `群聊: ${context.groups?.find(g => g.id === context.groupId)?.name || '未命名群聊'}`;
    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId)) : [];
    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    // --- 修改: 添加 JSON 世界书导出选项 ---
    let exportButtonHtml = '';
    if (totalFavorites > 0) {
        exportButtonHtml = `
            <div class="favorites-export-dropdown">
                <button id="export-favorites-trigger-btn" class="menu_button" title="选择导出格式">
                    导出收藏 <i class="fa-solid fa-caret-down"></i>
                </button>
                <ul id="favorites-export-menu" class="favorites-export-options" style="display: none;">
                    <li id="export-favorites-txt-item" class="favorites-export-item">导出为 TXT</li>
                    <li id="export-favorites-jsonl-item" class="favorites-export-item">导出为 JSONL</li>
                    <li id="export-favorites-worldbook-item" class="favorites-export-item">导出为世界书 (JSON)</li> <!-- 新增：世界书导出项 -->
                </ul>
            </div>
        `;
    }
    // --- 修改结束 ---

    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
                <div class="favorites-header-buttons">
                    ${exportButtonHtml}
                    ${totalFavorites > 0 ? `<button class="menu_button preview-favorites-btn" title="在新聊天中预览所有收藏的消息">预览</button>` : ''}
                </div>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            if(favItem) {
                contentHtml += renderFavoriteItem(favItem, startIndex + index);
            } else {
                console.warn(`[${pluginName}] updateFavoritesPopup: Found null/undefined favorite item at index ${startIndex + index} in currentPageItems.`);
            }
        });
        if (totalPages > 1) {
            contentHtml += `<div class="favorites-pagination">`;
            contentHtml += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            contentHtml += `<span>${currentPage} / ${totalPages}</span>`;
            contentHtml += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            contentHtml += `</div>`;
        }
    }
    contentHtml += `
            </div>
            <div class="favorites-footer">
            </div>
        </div>
    `;
    try {
        favoritesPopup.content.innerHTML = contentHtml;
        console.log(`${pluginName}: Popup content updated using innerHTML (including World Book export option).`);
    } catch (error) {
         console.error(`${pluginName}: Error setting popup innerHTML:`, error);
    }
}

/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>',
                POPUP_TYPE.TEXT,
                '',
                {
                    title: '收藏管理',
                    wide: true,
                    okButton: false,
                    cancelButton: true,
                    allowVerticalScrolling: true
                }
            );
            console.log(`${pluginName}: Popup instance created successfully.`);

            // --- 修改: 事件监听逻辑，增加处理世界书导出菜单项 ---
            $(favoritesPopup.content).on('click', function(event) {
                console.log(`[${pluginName}] Popup content click detected. Target element:`, event.target);

                const target = $(event.target);
                const closestButton = target.closest('button');
                const closestMenuItem = target.closest('.favorites-export-item');

                // 处理导出下拉菜单的显示/隐藏
                if (closestButton.length && closestButton.attr('id') === 'export-favorites-trigger-btn') {
                    console.log(`[${pluginName}] Matched #export-favorites-trigger-btn click.`);
                    const menu = $('#favorites-export-menu');
                    menu.toggle();
                    return;
                }

                // 处理导出菜单项点击
                if (closestMenuItem.length) {
                    const menuItemId = closestMenuItem.attr('id');
                     $('#favorites-export-menu').hide(); // 点击菜单项后隐藏菜单

                    if (menuItemId === 'export-favorites-txt-item') {
                        console.log(`[${pluginName}] Matched #export-favorites-txt-item click.`);
                        handleExportFavorites(); // TXT
                    } else if (menuItemId === 'export-favorites-jsonl-item') {
                        console.log(`[${pluginName}] Matched #export-favorites-jsonl-item click.`);
                        handleExportFavoritesJsonl(); // JSONL
                    } else if (menuItemId === 'export-favorites-worldbook-item') { // 新增：处理世界书导出点击
                        console.log(`[${pluginName}] Matched #export-favorites-worldbook-item click.`);
                        handleExportFavoritesWorldbook(); // 调用新的世界书导出函数
                    }
                    return;
                }
                // --- 新增结束 ---

                // 点击外部区域隐藏菜单
                if (!target.closest('.favorites-export-dropdown').length) {
                     $('#favorites-export-menu').hide();
                }

                // 处理其他按钮点击 (保持不变)
                if (closestButton.length) {
                    if (closestButton.hasClass('pagination-prev')) {
                        // ... (pagination logic) ...
                         if (currentPage > 1) {
                            currentPage--;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('pagination-next')) {
                        // ... (pagination logic) ...
                        const chatMetadata = ensureFavoritesArrayExists();
                        const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                        const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                        if (currentPage < totalPages) {
                            currentPage++;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('preview-favorites-btn')) {
                        // ... (preview logic) ...
                        handlePreviewButtonClick();
                        if (favoritesPopup) {
                            favoritesPopup.completeCancelled();
                            console.log(`${pluginName}: 点击预览按钮，关闭收藏夹弹窗 (使用 completeCancelled)。`);
                        }
                    } else if (closestButton.hasClass('clear-invalid')) {
                        // ... (clear invalid logic) ...
                        handleClearInvalidFavorites();
                    }
                }
                // 处理图标点击 (保持不变)
                else if (target.hasClass('fa-pencil')) {
                    // ... (edit note logic) ...
                     const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         try {
                            handleEditNote(favId);
                         } catch(e) {
                             console.error(`[${pluginName}] Pencil: Error calling handleEditNote:`, e);
                         }
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                else if (target.hasClass('fa-trash')) {
                    // ... (delete favorite logic) ...
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         const msgId = favItem.data('msg-id');
                         try {
                             handleDeleteFavoriteFromPopup(favId, msgId);
                         } catch(e) {
                             console.error(`[${pluginName}] Trash: Error calling handleDeleteFavoriteFromPopup:`, e);
                         }
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
                else {
                     // 其他点击情况
                    if (target.closest('.menu_button, .favorite-item, .pagination-prev, .pagination-next, .preview-favorites-btn, .favorites-export-dropdown, .fa-pencil, .fa-trash').length === 0) {
                         $('#favorites-export-menu').hide(); // 点击弹窗其他区域也隐藏导出菜单
                    } else {
                         console.log(`[${pluginName}] Click did not match any specific handler in the popup or was handled. Target:`, event.target);
                    }
                }
            });
             // --- 事件监听逻辑修改结束 ---

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null;
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
         $('#favorites-export-menu').hide();
    }
    currentPage = 1;
    updateFavoritesPopup();
    if (favoritesPopup) {
        try {
            favoritesPopup.show();
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
        }
    }
}


/**
 * Handles the deletion of a favorite from the popup (with simplified logging)
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    console.log(`[${pluginName}] Attempting to delete favorite: favId=${favId}, messageId=${messageId}`);
    try {
        if (typeof POPUP_TYPE?.CONFIRM === 'undefined' || typeof POPUP_RESULT?.AFFIRMATIVE === 'undefined') {
             console.error(`[${pluginName}] Error: POPUP_TYPE.CONFIRM or POPUP_RESULT.AFFIRMATIVE is undefined. Check imports from popup.js.`);
             return;
        }
        const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);
        if (confirmResult === POPUP_RESULT.AFFIRMATIVE) {
            const removed = removeFavoriteById(favId);
            if (removed) {
                updateFavoritesPopup(); // 刷新弹窗列表
                const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                if (messageElement.length) {
                    const iconElement = messageElement.find('.favorite-toggle-icon i');
                    if (iconElement.length) {
                        iconElement.removeClass('fa-solid').addClass('fa-regular');
                    }
                }
            } else {
                 console.warn(`[${pluginName}] removeFavoriteById('${favId}') returned false.`);
            }
        } else {
            console.log(`[${pluginName}] User cancelled favorite deletion.`);
        }
    } catch (error) {
        console.error(`[${pluginName}] Error during favorite deletion process (favId: ${favId}):`, error);
    }
    console.log(`[${pluginName}] handleDeleteFavoriteFromPopup finished for favId: ${favId}`);
}

/**
 * Handles editing the note for a favorite
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) return;
    const favorite = chatMetadata.favorites.find(fav => fav.id === favId);
    if (!favorite) return;
    const result = await callGenericPopup('为这条收藏添加备注:', POPUP_TYPE.INPUT, favorite.note || '');
    if (result !== null && result !== POPUP_RESULT.CANCELLED) {
        updateFavoriteNote(favId, result);
        updateFavoritesPopup(); // 刷新弹窗以显示更新后的备注
    }
}

/**
 * Clears invalid favorites (those referencing deleted/non-existent messages)
 */
async function handleClearInvalidFavorites() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        toastr.info('当前没有收藏项可清理。');
        return;
    }
    const context = getContext();
    if (!context || !context.chat) {
         toastr.error('无法获取当前聊天信息以清理收藏。');
         return;
    }
    const invalidFavoritesIds = [];
    const validFavorites = [];
    chatMetadata.favorites.forEach(fav => {
        const messageIndex = parseInt(fav.messageId, 10);
        let messageExists = false;
        if (!isNaN(messageIndex) && messageIndex >= 0 && context.chat[messageIndex]) {
            messageExists = true;
        }
        if (messageExists) {
            validFavorites.push(fav);
        } else {
            invalidFavoritesIds.push(fav.id);
            console.log(`${pluginName}: Found invalid favorite referencing non-existent message index: ${fav.messageId}`);
        }
    });
    if (invalidFavoritesIds.length === 0) {
        toastr.info('没有找到无效的收藏项。');
        return;
    }
    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavoritesIds.length} 条引用无效或已删除消息的收藏项。确定要删除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM
    );
    if (confirmResult === POPUP_RESULT.AFFIRMATIVE) {
        chatMetadata.favorites = validFavorites;
        saveMetadataDebounced();
        toastr.success(`已成功清理 ${invalidFavoritesIds.length} 条无效收藏。`);
        currentPage = 1;
        updateFavoritesPopup();
    }
}


/**
 * 确保预览聊天的数据存在
 * @returns {object} 包含当前聊天和角色/群聊信息
 */
function ensurePreviewData() {
    const context = getContext();
    const characterId = context.characterId;
    const groupId = context.groupId;
    if (!extension_settings[pluginName].previewChats) {
        extension_settings[pluginName].previewChats = {};
    }
    return {
        characterId,
        groupId
    };
}

// --- 设置预览UI ---
function setupPreviewUI(targetPreviewChatId) {
    // ... (代码保持不变) ...
    console.log(`${pluginName}: setupPreviewUI - Setting up UI for preview chat ${targetPreviewChatId}`);
    previewState.isActive = true;
    previewState.previewChatId = targetPreviewChatId;

    $('#send_form').hide();
    console.log(`${pluginName}: setupPreviewUI - Hidden #send_form.`);

    $(`#${returnButtonId}`).remove();

    const returnButton = $('<button></button>')
        .attr('id', returnButtonId)
        .addClass('menu_button')
        .text('返回至原聊天')
        .attr('title', '点击返回到预览前的聊天')
        .on('click', triggerReturnNavigation);

    $('#chat').after(returnButton);
    console.log(`${pluginName}: setupPreviewUI - Added return button.`);
}

// --- 恢复正常聊天UI ---
function restoreNormalChatUI() {
    // ... (代码保持不变) ...
    console.log(`${pluginName}: restoreNormalChatUI - Restoring normal UI.`);
    $(`#${returnButtonId}`).remove();
    $('#send_form').show();
    console.log(`${pluginName}: restoreNormalChatUI - Removed return button and shown #send_form.`);
}

// --- 触发返回导航的函数 ---
async function triggerReturnNavigation() {
    // ... (代码保持不变) ...
     console.log(`${pluginName}: triggerReturnNavigation - 返回按钮被点击。`);
    if (!previewState.originalContext) {
        console.error(`${pluginName}: triggerReturnNavigation - 未找到原始上下文！无法返回。`);
        toastr.error('无法找到原始聊天上下文，无法返回。');
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
        return;
    }

    const { characterId, groupId, chatId } = previewState.originalContext;
    console.log(`${pluginName}: triggerReturnNavigation - 准备返回至上下文:`, previewState.originalContext);

    try {
        toastr.info('正在返回原聊天...');
        let navigationSuccess = false;

        if (groupId) {
            console.log(`${pluginName}: 导航返回至群组聊天: groupId=${groupId}, chatId=${chatId}`);
            await openGroupChat(groupId, chatId);
            navigationSuccess = true;
             toastr.success('已成功返回原群组聊天！', '返回成功', { timeOut: 2000 });
        } else if (characterId !== undefined) {
            console.log(`${pluginName}: 导航返回至角色聊天: characterId=${characterId}, chatId=${chatId}`);
            await openCharacterChat(chatId);
            navigationSuccess = true;
            toastr.success('已成功返回原角色聊天！', '返回成功', { timeOut: 2000 });
        } else {
            console.error(`${pluginName}: triggerReturnNavigation - 无效的原始上下文。无法确定导航类型。`);
            toastr.error('无法确定原始聊天类型，无法返回。');
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null;
            previewState.previewChatId = null;
        }
    } catch (error) {
        console.error(`${pluginName}: triggerReturnNavigation - 导航返回时出错:`, error);
        toastr.error(`返回原聊天时出错: ${error.message || '未知错误'}`);
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
    }
}

/**
 * 处理预览按钮点击 (包含UI修改和聊天重命名)
 */
async function handlePreviewButtonClick() {
    // ... (代码保持不变) ...
    console.log(`${pluginName}: 预览按钮被点击 (包含UI修改和重命名)`);
    toastr.info('正在准备预览聊天...');

    const initialContext = getContext();
    previewState.originalContext = {
        characterId: initialContext.characterId,
        groupId: initialContext.groupId,
        chatId: initialContext.chatId,
    };
    previewState.isActive = false;
    previewState.previewChatId = null;
    restoreNormalChatUI();

    console.log(`${pluginName}: 保存的原始上下文:`, previewState.originalContext);

    try {
        if (!initialContext.groupId && initialContext.characterId === undefined) {
            console.error(`${pluginName}: 错误: 没有选择角色或群聊`);
            toastr.error('请先选择一个角色或群聊');
            previewState.originalContext = null;
            return;
        }

        const { characterId, groupId } = ensurePreviewData();
        const chatMetadata = ensureFavoritesArrayExists();

        if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
            toastr.warning('没有收藏的消息可以预览');
             previewState.originalContext = null;
            return;
        }

        const originalChat = JSON.parse(JSON.stringify(initialContext.chat || []));

        const previewKey = groupId ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[pluginName].previewChats[previewKey];
        let targetPreviewChatId = existingPreviewChatId;
        let needsRename = false;

        // --- 步骤 1: 切换或创建聊天 ---
        if (existingPreviewChatId) {
             if (initialContext.chatId === existingPreviewChatId) {
                targetPreviewChatId = initialContext.chatId;
                needsRename = true;
            } else {
                needsRename = true;
                if (groupId) {
                    await openGroupChat(groupId, existingPreviewChatId);
                } else {
                    await openCharacterChat(existingPreviewChatId);
                }
            }
        } else {
            await doNewChat({ deleteCurrentChat: false });
            const newContextAfterCreation = getContext();
            targetPreviewChatId = newContextAfterCreation.chatId;
            if (!targetPreviewChatId) throw new Error('创建预览聊天失败，无法获取新的 Chat ID');
            extension_settings[pluginName].previewChats[previewKey] = targetPreviewChatId;
            saveMetadataDebounced();
            needsRename = true;
        }

        // --- 步骤 2: 等待聊天切换/创建完成 ---
        const currentContextAfterSwitchAttempt = getContext();
        if (currentContextAfterSwitchAttempt.chatId !== targetPreviewChatId) {
            try {
                targetPreviewChatId = await new Promise((resolve, reject) => {
                     const timeout = setTimeout(() => {
                        eventSource.off(event_types.CHAT_CHANGED, listener);
                        reject(new Error(`Waiting for CHAT_CHANGED to ${targetPreviewChatId} timed out after 5 seconds`));
                    }, 5000);
                    const listener = (receivedChatId) => {
                        if (receivedChatId === targetPreviewChatId) {
                            clearTimeout(timeout);
                            eventSource.off(event_types.CHAT_CHANGED, listener);
                            requestAnimationFrame(() => resolve(receivedChatId));
                        }
                    };
                    eventSource.on(event_types.CHAT_CHANGED, listener);
                });
            } catch (error) {
                console.error(`${pluginName}: Error or timeout waiting for CHAT_CHANGED:`, error);
                toastr.error('切换到预览聊天时出错或超时，请重试');
                previewState.originalContext = null;
                return;
            }
        } else {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        // --- 步骤 2.5: 重命名聊天 ---
        const contextForRename = getContext();
        if (contextForRename.chatId === targetPreviewChatId && needsRename) {
            const oldFileName = contextForRename.chatId;
             if (!oldFileName || typeof oldFileName !== 'string') {
                 toastr.warning('无法获取当前聊天名称，跳过重命名。');
             } else {
                const previewPrefix = "[收藏预览] ";
                let currentChatName = contextForRename.chatName;
                if (!currentChatName) { /* ... derive name ... */
                     if (contextForRename.groupId) {
                        const group = contextForRename.groups?.find(g => g.id === contextForRename.groupId);
                        currentChatName = group ? group.name : '群聊';
                    } else if (contextForRename.characterId !== undefined) {
                        currentChatName = contextForRename.name2 || '角色聊天';
                    } else {
                        currentChatName = '新聊天';
                    }
                }
                let newName = currentChatName;
                if (typeof currentChatName === 'string' && !currentChatName.startsWith(previewPrefix)) {
                    newName = previewPrefix + currentChatName;
                } else if (typeof currentChatName !== 'string'){
                     newName = previewPrefix + '未命名预览';
                     currentChatName = '未命名预览';
                }
                const finalNewName = typeof newName === 'string' ? newName.trim() : '';

                if (finalNewName && typeof currentChatName === 'string' && !currentChatName.startsWith(previewPrefix)) {
                     try {
                        await renameChat(oldFileName, finalNewName);
                        targetPreviewChatId = finalNewName;
                        const currentPreviewKey = contextForRename.groupId ? `group_${contextForRename.groupId}` : `char_${contextForRename.characterId}`;
                        if (extension_settings[pluginName].previewChats && currentPreviewKey in extension_settings[pluginName].previewChats) {
                            extension_settings[pluginName].previewChats[currentPreviewKey] = targetPreviewChatId;
                            saveMetadataDebounced();
                        }
                    } catch(renameError) {
                        toastr.error('重命名预览聊天失败，请检查控制台');
                        targetPreviewChatId = oldFileName;
                    }
                } else { // Already has prefix or invalid name
                     targetPreviewChatId = oldFileName;
                }
            }
        } else { // Context mismatch or no rename needed
             targetPreviewChatId = contextForRename.chatId;
        }

        // --- 步骤 3: 清空当前聊天 ---
        clearChat();

        // --- 步骤 4: 等待聊天 DOM 清空 ---
        try {
            await waitUntilCondition(() => document.querySelectorAll('#chat .mes').length === 0, 2000, 50);
        } catch (error) {
            toastr.warning('清空聊天时可能超时，继续尝试填充消息...');
        }

        // --- 步骤 4.5: 设置预览模式 UI ---
        const contextBeforeFill = getContext();
        if (contextBeforeFill.chatId !== targetPreviewChatId) {
            toastr.error('无法确认预览聊天环境，操作中止。请重试。');
            previewState.originalContext = null;
            restoreNormalChatUI();
            return;
        }
        setupPreviewUI(targetPreviewChatId);

        // --- 步骤 5: 准备收藏消息 ---
        const messagesToFill = [];
        const sortedFavoritesForFill = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
        for (const favItem of sortedFavoritesForFill) {
            const messageIndex = parseInt(favItem.messageId, 10);
            let foundMessage = null;
            if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChat.length) {
                if (originalChat[messageIndex]) {
                    foundMessage = originalChat[messageIndex];
                }
            }
            if (foundMessage) {
                 const messageCopy = JSON.parse(JSON.stringify(foundMessage));
                 if (!messageCopy.extra) messageCopy.extra = {};
                 if (!messageCopy.extra.swipes) messageCopy.extra.swipes = [];
                 messagesToFill.push({ message: messageCopy, mesid: messageIndex });
            } else {
                console.warn(`${pluginName}: Warning: Favorite message with original mesid ${favItem.messageId} not found. Skipping.`);
            }
        }

        // --- 步骤 6: 批量填充消息 ---
        const finalContextForFill = getContext();
        if (finalContextForFill.chatId !== targetPreviewChatId) {
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             restoreNormalChatUI();
             previewState.isActive = false;
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return;
        }

        let addedCount = 0;
        const BATCH_SIZE = 20;
        for (let i = 0; i < messagesToFill.length; i += BATCH_SIZE) {
            const batch = messagesToFill.slice(i, i + BATCH_SIZE);
            const addPromises = batch.map(item => {
                return (async () => {
                    try {
                        await finalContextForFill.addOneMessage(item.message, { scroll: false });
                        addedCount++;
                    } catch (error) {
                        console.error(`${pluginName}: Error adding message (original index=${item.mesid}):`, error);
                    }
                })();
            });
            await Promise.all(addPromises);
            if (i + BATCH_SIZE < messagesToFill.length) {
                 await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // --- 步骤 7: 完成与最终处理 ---
        if (addedCount > 0) {
            $('#chat').scrollTop(0);
            toastr.success(`已在预览模式下显示 ${addedCount} 条收藏消息`);
        } else if (messagesToFill.length > 0) {
             toastr.warning('准备了收藏消息，但未能成功添加到预览中。请检查控制台。');
        } else {
             toastr.info('收藏夹为空，已进入（空的）预览模式。点击下方按钮返回。');
        }

    } catch (error) {
        console.error(`${pluginName}: Error during preview generation:`, error);
        const errorMsg = (error instanceof Error && error.message) ? error.message : '请查看控制台获取详细信息';
        toastr.error(`创建预览时出错: ${errorMsg}`);
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
    }
}

// --- 处理聊天切换事件，用于在离开预览时恢复UI ---
function handleChatChangeForPreview(newChatId) {
    if (previewState.isActive) {
        if (newChatId !== previewState.previewChatId) {
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null;
            previewState.previewChatId = null;
        }
    }
}


/**
 * Handles exporting the favorited messages to a text file. (TXT)
 */
async function handleExportFavorites() {
    // ... (代码保持不变) ...
    console.log(`${pluginName}: handleExportFavorites - 开始导出收藏 (TXT)`);
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        toastr.warning('没有收藏的消息可以导出。'); return;
    }
    if (!context || !context.chat) {
        toastr.error('无法获取当前聊天记录以导出收藏。'); return;
    }

    toastr.info('正在准备导出收藏 (TXT)...', '导出中');

    try {
        if (typeof timestampToMoment !== 'function') throw new Error('timestampToMoment function is not available.');

        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
        const exportLines = [];
        const chatName = context.characterId ? context.name2 : (context.groups?.find(g => g.id === context.groupId)?.name || '群聊');
        const exportDate = timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss');

        exportLines.push(`收藏夹导出 (TXT)`);
        exportLines.push(`聊天对象: ${chatName}`);
        exportLines.push(`导出时间: ${timestampToMoment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}`);
        exportLines.push(`总收藏数: ${sortedFavorites.length}`);
        exportLines.push('---');
        exportLines.push('');

        for (const favItem of sortedFavorites) {
            const messageIndex = parseInt(favItem.messageId, 10);
            const message = (!isNaN(messageIndex) && context.chat[messageIndex]) ? context.chat[messageIndex] : null;

            exportLines.push(`--- 消息 #${favItem.messageId} ---`);
            if (message) {
                 const sender = favItem.sender || (message.is_user ? (context.userAlias || 'You') : (message.name || 'Character'));
                 let timestampStr = message.send_date ? timestampToMoment(message.send_date).format('YYYY-MM-DD HH:mm:ss') : '[时间未知]';
                 exportLines.push(`发送者: ${sender}`);
                 exportLines.push(`时间: ${timestampStr}`);
                 if (favItem.note) exportLines.push(`备注: ${favItem.note}`);
                 exportLines.push(`内容:`);
                 exportLines.push(message.mes || '[消息内容为空]');
            } else {
                 exportLines.push(`[原始消息内容不可用或已删除]`);
                 if (favItem.sender) exportLines.push(`原始发送者: ${favItem.sender}`);
                 if (favItem.note) exportLines.push(`备注: ${favItem.note}`);
            }
            exportLines.push(`--- 结束消息 #${favItem.messageId} ---`);
            exportLines.push('');
        }

        const exportedText = exportLines.join('\n');
        const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });
        const safeChatName = String(chatName).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeChatName}_收藏_${exportDate}.txt`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        toastr.success(`已成功导出 ${sortedFavorites.length} 条收藏到文件 "${filename}" (TXT)`, '导出完成');
    } catch (error) {
        console.error(`${pluginName}: handleExportFavorites (TXT) - 导出过程中发生错误:`, error);
        toastr.error(`导出收藏 (TXT) 时发生错误: ${error.message || '未知错误'}`);
    }
}

/**
 * Handles exporting the favorited messages to a JSONL file,
 * mimicking SillyTavern's native format by including a metadata line first.
 * Exports ONLY the favorited messages AFTER the metadata line, maintaining their original relative order.
 */
async function handleExportFavoritesJsonl() {
    // 函数开始
    console.log(`${pluginName}: handleExportFavoritesJsonl - 开始导出收藏 (JSONL, 带元数据行)`);
    // 获取上下文和收藏
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

    // 基础检查...
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        toastr.warning('没有收藏的消息可以导出。'); return;
    }
    if (!context || !context.chat || !Array.isArray(context.chat)) {
        toastr.error('无法获取当前聊天记录以导出收藏。'); return;
    }
    // *** 新增：检查必要的元数据字段是否存在 ***
    if (!context.userName || !context.characterName || !context.chatMetadata) {
         toastr.error('无法获取完整的聊天元数据 (用户名/角色名/元数据对象) 以生成兼容格式。');
         console.error(`${pluginName}: handleExportFavoritesJsonl - Missing userName, characterName, or chatMetadata in context`);
         return;
    }


    toastr.info('正在准备导出收藏 (JSONL)...', '导出中');

    try {
        if (typeof timestampToMoment !== 'function') {
             throw new Error('timestampToMoment function is not available.');
        }

        // 1. 排序收藏项...
        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => {
             const idA = parseInt(a?.messageId, 10); const idB = parseInt(b?.messageId, 10);
             if (isNaN(idA) && isNaN(idB)) return 0; if (isNaN(idA)) return 1; if (isNaN(idB)) return -1;
             return idA - idB;
        });

        // 2. 初始化消息对象数组...
        const exportMessageObjects = []; // 只存储消息对象
        let exportedMessageCount = 0;

        // 3. 遍历并获取消息 (使用深拷贝)...
        for (let i = 0; i < sortedFavorites.length; i++) {
            const favItem = sortedFavorites[i];
            let messageIndex = NaN;
            if (favItem.messageId !== undefined && favItem.messageId !== null) {
                 messageIndex = parseInt(favItem.messageId, 10);
            }
             if (isNaN(messageIndex) || messageIndex < 0) continue; // 跳过无效

            let message = null;
            if (messageIndex < context.chat.length) {
                message = context.chat[messageIndex];
            }

            if (message) {
                try {
                    const messageCopy = JSON.parse(JSON.stringify(message)); // 深拷贝
                    exportMessageObjects.push(messageCopy); // 只添加消息对象
                    exportedMessageCount++;
                } catch (copyError) {
                     console.error(`[${pluginName}] JSONL Export - Error deep copying message index ${messageIndex}:`, copyError);
                     toastr.error(`处理消息 #${messageIndex} 出错。`);
                }
            }
        }

        // 4. 检查是否有消息...
        if (exportedMessageCount === 0) {
            toastr.warning('未能找到任何可导出的收藏消息...'); return;
        }

        // *** 5. 创建元数据对象 ***
        // 注意：我们直接使用当前的 context.chatMetadata。这可能包含旧的/完整的收藏列表，
        // 但这是为了匹配原生格式。如果想让这里的 favorites 只反映导出的消息，需要额外处理。
        // 为了简单和兼容性，先直接用当前的。
        const metadataObject = {
            user_name: context.userName, // 从 context 获取用户名
            character_name: context.characterName, // 从 context 获取角色名
            //create_date: timestampToMoment(Date.now()).format('YYYY-MM-DD@HH[h]mm[m]ss[s]'), // 可选：添加导出时的创建日期
            chat_metadata: context.chatMetadata // 使用当前的 chatMetadata
        };

        // *** 6. 生成最终的 JSONL 文本 ***
        let exportedJsonlText = '';
        try {
            // 第一行：元数据 JSON 字符串
            const metadataLine = JSON.stringify(metadataObject);
            // 后续行：每个收藏消息的 JSON 字符串
            const messageLines = exportMessageObjects.map(obj => JSON.stringify(obj)).join('\n');

            // 组合：元数据行 + 换行符 + 消息行 + 最终换行符
            exportedJsonlText = metadataLine + '\n' + messageLines + '\n';

            console.log(`[${pluginName}] JSONL Export - JSONL text generated successfully (with metadata line).`);
        } catch (stringifyError) {
            console.error(`[${pluginName}] JSONL Export - Error stringifying objects:`, stringifyError);
            toastr.error('生成 JSONL 文件内容时出错。'); return;
        }

        // 7. 创建 Blob 并触发下载...
        const blob = new Blob([exportedJsonlText], { type: 'application/jsonlines;charset=utf-8' });
        const chatName = context.characterId ? context.name2 : (context.groups?.find(g => g.id === context.groupId)?.name || '群聊');
        const exportDate = timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss');
        const safeChatName = String(chatName).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeChatName}_收藏_${exportDate}.jsonl`; // 文件名保持 .jsonl

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        // 8. 完成反馈...
        console.log(`${pluginName}: handleExportFavoritesJsonl - Success: Exported ${exportedMessageCount} messages (with metadata line) to ${filename}`);
        toastr.success(`已成功导出 ${exportedMessageCount} 条收藏消息到文件 "${filename}" (JSONL)`, '导出完成');

    } catch (error) {
        // 9. 错误处理...
        console.error(`${pluginName}: handleExportFavoritesJsonl - Error during export:`, error);
        toastr.error(`导出收藏 (JSONL) 时发生错误: ${error.message || '未知错误'}`);
    }
}
// --- 新增：处理收藏导出为 JSON 世界书格式的函数 ---
/**
 * Handles exporting the favorited messages to a SillyTavern World Book (JSON) file.
 * 每个收藏的消息会转换为一个世界书条目，设置为常驻（蓝灯），按聊天顺序排序，
 * depth 设为 0，并根据消息发送者插入为 @ D0 (position: 4)，
 * role 分别设为 1 (User) 或 2 (Assistant)。
 */
async function handleExportFavoritesWorldbook() {
    // 函数开始，记录日志，标明导出格式
    console.log(`${pluginName}: handleExportFavoritesWorldbook - 开始导出收藏 (世界书 JSON)`);
    // 获取当前上下文和收藏元数据
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

    // 检查是否有收藏项或者上下文/聊天记录是否有效
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        toastr.warning('没有收藏的消息可以导出为世界书。');
        console.log(`${pluginName}: handleExportFavoritesWorldbook - 没有收藏，导出中止`);
        return;
    }
    if (!context || !context.chat) {
        toastr.error('无法获取当前聊天记录以导出为世界书。');
        console.error(`${pluginName}: handleExportFavoritesWorldbook - 无法获取 context.chat`);
        return;
    }

    // 提示用户正在进行世界书导出
    toastr.info('正在准备导出收藏 (世界书 JSON)...', '导出中');

    try {
        // 再次确认时间格式化函数可用
        if (typeof timestampToMoment !== 'function') {
            console.error(`${pluginName}: timestampToMoment function is not available.`);
            toastr.error('导出功能所需的时间格式化工具不可用。');
            return;
        }

        // 将收藏项按其原始消息 ID (messageId，即索引) 排序，确保世界书条目顺序与聊天顺序一致
        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));

        // 初始化世界书的基础结构 { "entries": {} }
        const worldbookData = {
            entries: {}
        };
        // 记录成功转换并添加到世界书的消息数量
        let exportedEntryCount = 0;

        // --- 遍历已排序的收藏项，生成对应的世界书条目 ---
        for (const favItem of sortedFavorites) {
            // 获取原始消息索引
            const messageIndex = parseInt(favItem.messageId, 10);
            // 从 context.chat 中查找原始消息对象
            const message = (!isNaN(messageIndex) && context.chat[messageIndex]) ? context.chat[messageIndex] : null;

            if (message) {
                // 如果找到了原始消息
                exportedEntryCount++; // 计数增加

                // --- 修改：根据用户最新要求设置 depth 和 role ---
                const position = 4; // @ D0 对应的 position 固定为 4
                const roleValue = message.is_user ? 1 : 2; // 用户消息 role=1, AI消息 role=2
                const depthValue = 0; // 明确设置 depth 为 0
                // --- 修改结束 ---

                // 创建世界书条目对象
                const worldEntry = {
                    uid: messageIndex, // 使用消息索引作为 uid
                    key: [], // 常驻条目，关键词列表为空
                    keysecondary: [], // 次要关键词列表为空
                    comment: `收藏消息 #${messageIndex} - ${message.name}`, // 备注，方便识别
                    content: message.mes || "", // 条目内容即消息内容
                    constant: true, // 设置为常驻 (蓝灯)
                    vectorized: false, // 不使用向量匹配
                    selective: false, // 不使用次要关键词逻辑
                    selectiveLogic: 0, // 默认逻辑
                    addMemo: true, // UI 显示备注
                    order: messageIndex, // 使用消息索引作为插入顺序，保证按聊天顺序插入
                    position: position, // 设置为 4，代表 @ D
                    disable: false, // 条目启用
                    excludeRecursion: false, // 允许被递归（对常驻条目影响不大）
                    preventRecursion: true, // 阻止从此条目进一步递归（推荐）
                    delayUntilRecursion: false, // 不延迟
                    probability: 100, // 概率 100%
                    useProbability: false, // 禁用概率（因为是 100%）
                    depth: depthValue, // *** 修改：明确设置为 0 ***
                    group: "", // 不分组
                    groupOverride: false, // 不覆盖组设置
                    groupWeight: 100, // 默认组权重
                    scanDepth: null, // 扫描深度覆盖 (常驻条目不需要扫描，设为 null 或 0 均可)
                    caseSensitive: null, // 使用全局大小写设置
                    matchWholeWords: null, // 使用全局全词匹配设置
                    useGroupScoring: null, // 使用全局组评分设置
                    automationId: "", // 无自动化 ID
                    role: roleValue, // *** 修改：配合 position=4，指定角色 1 (User) 或 2 (Assistant) ***
                    sticky: 0, // 无粘滞
                    cooldown: 0, // 无冷却
                    delay: 0, // 无延迟
                    displayIndex: messageIndex // UI 显示顺序也按消息索引
                };

                // 将创建的条目添加到 worldbookData.entries 对象中，使用消息索引作为键
                worldbookData.entries[messageIndex.toString()] = worldEntry;

            } else {
                // 如果原始消息找不到，记录警告
                console.warn(`${pluginName}: handleExportFavoritesWorldbook - 找不到索引为 ${favItem.messageId} 的原始消息，将跳过此条目的世界书导出。`);
            }
        }

        // 检查是否实际导出了任何条目
        if (exportedEntryCount === 0) {
            toastr.warning('所有收藏项对应的原始消息均无法找到，无法生成世界书文件。');
            console.log(`${pluginName}: handleExportFavoritesWorldbook - 未找到有效的原始消息可导出。`);
            return;
        }

        // --- 将世界书数据序列化为格式化的 JSON 字符串 ---
        const exportedJsonText = JSON.stringify(worldbookData, null, 2);

        // --- 创建 Blob 对象并触发下载 ---
        const blob = new Blob([exportedJsonText], { type: 'application/json;charset=utf-8' });

        // 生成文件名
        const chatName = context.characterId ? context.name2 : (context.groups?.find(g => g.id === context.groupId)?.name || '群聊');
        const exportDate = timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss');
        const safeChatName = String(chatName).replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeChatName}_收藏世界书_${exportDate}.json`;

        // 下载机制
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        // 记录成功日志并提示用户
        console.log(`${pluginName}: handleExportFavoritesWorldbook - 成功导出 ${exportedEntryCount} 条收藏消息到 ${filename} (世界书 JSON)`);
        toastr.success(`已成功导出 ${exportedEntryCount} 条收藏消息到文件 "${filename}" (世界书 JSON)`, '导出完成');

    } catch (error) {
        // 错误处理
        console.error(`${pluginName}: handleExportFavoritesWorldbook - 导出过程中发生错误:`, error);
        toastr.error(`导出收藏 (世界书 JSON) 时发生错误: ${error.message || '未知错误'}`);
    }
}
// --- 世界书导出函数结束 ---
/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // Inject CSS styles
        const styleElement = document.createElement('style');
        // --- 修改：确保下拉菜单样式能容纳新选项 ---
        styleElement.innerHTML = `
            /* ... (大部分原有样式保持不变) ... */
            #favorites-popup-content { padding: 10px; max-height: 70vh; overflow-y: auto; }
            #favorites-popup-content .favorites-header { display: flex; justify-content: space-between; align-items: center; padding: 0 10px; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            #favorites-popup-content .favorites-header h3 { margin: 0; flex-grow: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
            #favorites-popup-content .favorites-header .favorites-header-buttons { display: flex; align-items: center; gap: 8px; flex-shrink: 0; position: relative; }

            /* 导出下拉菜单样式 */
            .favorites-export-dropdown { position: relative; display: inline-block; }
            #export-favorites-trigger-btn { /* 保持 menu_button 基础样式 */ }
            #favorites-export-menu {
                display: none; position: absolute; top: 100%; left: 0;
                background-color: var(--SmartThemeBodyBgDarker, #2a2a2e); border: 1px solid var(--SmartThemeBorderColor, #444);
                border-radius: 4px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
                padding: 5px 0; margin: 2px 0 0 0;
                min-width: 150px; /* 可能需要适当增加最小宽度以容纳更长的文本 */
                z-index: 10; list-style: none;
            }
            .favorites-export-item {
                padding: 8px 12px; cursor: pointer; color: var(--SmartThemeFg);
                font-size: 0.9em; white-space: nowrap;
            }
            .favorites-export-item:hover { background-color: var(--SmartThemeHoverBg, rgba(255, 255, 255, 0.1)); }
            /* --- 下拉菜单样式结束 --- */

            #favorites-popup-content .favorites-divider { height: 1px; background-color: var(--SmartThemeBorderColor, #ccc); margin: 10px 0; }
            #favorites-popup-content .favorites-list { margin: 10px 0; }
            #favorites-popup-content .favorites-empty { text-align: center; color: var(--SmartThemeFgMuted, #888); padding: 20px; }
            #favorites-popup-content .favorite-item { border-radius: 8px; margin-bottom: 10px; padding: 10px; background-color: rgba(0, 0, 0, 0.2); position: relative; border: 1px solid var(--SmartThemeBorderColor, #444); }
            #favorites-popup-content .fav-meta { font-size: 0.8em; color: #aaa; text-align: right; margin-bottom: 5px; margin-top: 0; flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #favorites-popup-content .fav-note { background-color: rgba(255, 255, 0, 0.1); padding: 5px 8px; border-left: 3px solid #ffcc00; margin-bottom: 8px; font-style: italic; text-align: left; font-size: 0.9em; word-wrap: break-word; }
            #favorites-popup-content .fav-preview { margin-bottom: 8px; line-height: 1.4; max-height: 200px; overflow-y: auto; word-wrap: break-word; white-space: pre-wrap; text-align: left; background-color: rgba(255, 255, 255, 0.05); padding: 5px 8px; border-radius: 4px; }
            #favorites-popup-content .fav-preview.deleted { color: #ff3a3a; font-style: italic; background-color: rgba(255, 58, 58, 0.1); }
            #favorites-popup-content .fav-actions { text-align: right; }
            #favorites-popup-content .fav-actions i { cursor: pointer; margin-left: 10px; padding: 5px; border-radius: 50%; transition: background-color 0.2s; font-size: 1.1em; vertical-align: middle; }
            #favorites-popup-content .fav-actions i:hover { background-color: rgba(255, 255, 255, 0.1); }
            #favorites-popup-content .fav-actions .fa-pencil { color: var(--SmartThemeLinkColor, #3a87ff); }
            #favorites-popup-content .fav-actions .fa-trash { color: var(--SmartThemeDangerColor, #ff3a3a); }
            .favorite-toggle-icon { cursor: pointer; }
            .favorite-toggle-icon i.fa-regular { color: var(--SmartThemeIconColorMuted, #999); }
            .favorite-toggle-icon i.fa-solid { color: var(--SmartThemeAccentColor, #ffcc00); }
            #favorites-popup-content .favorites-pagination { display: flex; justify-content: center; align-items: center; margin-top: 15px; gap: 10px; }
            #favorites-popup-content .favorites-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-top: 10px; border-top: 1px solid var(--SmartThemeBorderColor, #444); }
            #favorites-popup-content .fav-preview pre { display: block; width: 100%; box-sizing: border-box; overflow-x: auto; white-space: pre; background-color: rgba(0, 0, 0, 0.3); padding: 10px; border-radius: 4px; margin-top: 5px; margin-bottom: 5px; font-family: monospace; }
            #favorites-popup-content .menu_button { width: auto; padding: 5px 10px; font-size: 0.9em; }
            #favorites-popup-content .fav-send-date { font-size: 0.75em; color: #bbb; text-align: left; display: inline-flex; flex-shrink: 0; align-items: baseline; white-space: nowrap; }
            #favorites-popup-content .fav-send-date .fav-mesid { margin-left: 8px; color: #999; font-size: 0.9em; }
            #favorites-popup-content .fav-header-info { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; flex-wrap: wrap; gap: 10px; }
            #${returnButtonId} { display: block; width: fit-content; margin: 15px auto; padding: 8px 15px; background-color: var(--SmartThemeBtnBg); color: var(--SmartThemeBtnFg); border: 1px solid var(--SmartThemeBtnBorder); border-radius: 5px; cursor: pointer; text-align: center; }
            #${returnButtonId}:hover { background-color: var(--SmartThemeBtnBgHover); color: var(--SmartThemeBtnFgHover); border-color: var(--SmartThemeBtnBorderHover); }
        `;
        document.head.appendChild(styleElement);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            $('#favorites_button').on('click', () => showFavoritesPopup());
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Set up event delegation for favorite toggle icon
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for current chat on load
        ensureFavoritesArrayExists();

        // Initial UI setup
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();
        restoreNormalChatUI();

        // --- Event Listeners (保持不变) ---
        eventSource.on(event_types.CHAT_CHANGED, (newChatId) => {
            handleChatChangeForPreview(newChatId);
            ensureFavoritesArrayExists();
            // Manual switch back check...
             if (!previewState.isActive) { /* ... check logic ... */
                const previewChatsMap = extension_settings[pluginName]?.previewChats;
                if (previewChatsMap && Object.values(previewChatsMap).includes(newChatId)) {
                     toastr.info(/* ... toastr message ... */
                        `注意：当前聊天 "${newChatId}" 是收藏预览聊天。此聊天仅用于预览收藏消息，内容会在每次<预览>前清空。请勿在此聊天中发送消息。`,
                        '进入收藏预览聊天',
                        { timeOut: 8000, extendedTimeOut: 4000, preventDuplicates: true, positionClass: 'toast-top-center' }
                    );
                }
            }
            setTimeout(() => {
                addFavoriteIconsToMessages();
                refreshFavoriteIconsInView();
            }, 150);
        });
        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIndex) => {
            const deletedMessageId = String(deletedMessageIndex);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !chatMetadata.favorites) return;
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);
            if (favIndex !== -1) {
                chatMetadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced();
                if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
                    currentPage = 1;
                    updateFavoritesPopup();
                }
                 setTimeout(refreshFavoriteIconsInView, 100);
            }
        });
        const handleNewMessage = () => { setTimeout(addFavoriteIconsToMessages, 150); };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        const handleMessageUpdateOrSwipe = () => { setTimeout(refreshFavoriteIconsInView, 150); };
        eventSource.on(event_types.MESSAGE_SWIPED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MESSAGE_UPDATED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => { setTimeout(() => { addFavoriteIconsToMessages(); refreshFavoriteIconsInView(); }, 150); });

        // --- MutationObserver (保持不变) ---
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                            needsIconAddition = true; break;
                        }
                    }
                }
                if (needsIconAddition) break;
            }
            if (needsIconAddition) { requestAnimationFrame(addFavoriteIconsToMessages); }
        });
        const chatElement = document.getElementById('chat');
        if (chatElement) { chatObserver.observe(chatElement, { childList: true, subtree: true }); }
        else { console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`); }

        // 修改：更新日志，包含所有导出格式
        console.log(`${pluginName}: 插件加载完成! (包含 TXT/JSONL/世界书 导出和预览功能)`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
