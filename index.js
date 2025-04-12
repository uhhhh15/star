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
    timestampToMoment,
    waitUntilCondition, // *** 关键：为优化方案添加导入 ***
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
            sendDateString = message.send_date;
        } else {
            sendDateString = '[时间未知]';
        }

        if (message.mes) {
            previewText = message.mes;
            try {
                 previewText = messageFormatting(previewText, favItem.sender, false,
                                                favItem.role === 'user', null, {}, false);
            } catch (e) {
                 console.error(`${pluginName}: Error formatting message preview:`, e);
                 previewText = message.mes;
            }
        } else {
            previewText = '[消息内容为空]';
        }

    } else {
        previewText = '[消息内容不可用或已删除]';
        sendDateString = '[时间不可用]';
        deletedClass = 'deleted';
    }

    // --- 新增：格式化 mesid ---
    const formattedMesid = `# ${favItem.messageId}`; // 直接从 favItem 获取并格式化

    // --- 修改返回的 HTML 结构 ---
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
    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
                ${totalFavorites > 0 ? `<button class="menu_button preview-favorites-btn" title="在新聊天中预览所有收藏的消息">预览</button>` : ''}
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;
    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            contentHtml += renderFavoriteItem(favItem, startIndex + index);
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
                <!-- 清理无效收藏按钮已根据要求移除 -->
                <!-- 关闭按钮已根据要求移除 -->
            </div>
        </div>
    `;
    try {
        favoritesPopup.content.innerHTML = contentHtml;
        console.log(`${pluginName}: Popup content updated using innerHTML.`);
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
                    cancelButton: false,
                    allowVerticalScrolling: true
                }
            );
            console.log(`${pluginName}: Popup instance created successfully.`);
            $(favoritesPopup.content).on('click', function(event) {
                const target = $(event.target);
                if (target.hasClass('pagination-prev')) {
                    if (currentPage > 1) {
                        currentPage--;
                        updateFavoritesPopup();
                    }
                } else if (target.hasClass('pagination-next')) {
                    const chatMetadata = ensureFavoritesArrayExists();
                    const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                    if (currentPage < totalPages) {
                        currentPage++;
                        updateFavoritesPopup();
                    }
                }
                else if (target.hasClass('preview-favorites-btn')) {
                    handlePreviewButtonClick(); // 调用预览功能
                    if (favoritesPopup) {
                        favoritesPopup.hide();
                        console.log(`${pluginName}: 点击预览按钮，关闭收藏夹弹窗。`);
                    }
                }
                // --- 已移除处理 .close-popup 的 else if 分支 ---
                // else if (target.hasClass('close-popup')) {
                //     favoritesPopup.hide();
                // }
                else if (target.hasClass('clear-invalid')) { // <-- 这个分支仍然保留
                    handleClearInvalidFavorites();         // <-- 对应的函数调用也保留
                }
                else if (target.hasClass('fa-pencil')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         handleEditNote(favId);
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                else if (target.hasClass('fa-trash')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                        const favId = favItem.data('fav-id');
                        const msgId = favItem.data('msg-id');
                        handleDeleteFavoriteFromPopup(favId, msgId);
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
            });
        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null;
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
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
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);
    if (confirmResult === POPUP_RESULT.YES) {
        if (removeFavoriteById(favId)) {
            updateFavoritesPopup();
            const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    }
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
        updateFavoritesPopup();
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
    if (confirmResult === POPUP_RESULT.YES) {
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

// --- 新增：设置预览UI (隐藏输入框, 添加返回按钮) ---
function setupPreviewUI(targetPreviewChatId) {
    console.log(`${pluginName}: setupPreviewUI - Setting up UI for preview chat ${targetPreviewChatId}`);
    previewState.isActive = true;
    previewState.previewChatId = targetPreviewChatId;

    // 隐藏输入表单
    $('#send_form').hide();
    console.log(`${pluginName}: setupPreviewUI - Hidden #send_form.`);

    // 移除可能存在的旧按钮
    $(`#${returnButtonId}`).remove();

    // 创建返回按钮
    const returnButton = $('<button></button>')
        .attr('id', returnButtonId)
        .addClass('menu_button') // 使用现有样式
        .text('返回至原聊天')
        .attr('title', '点击返回到预览前的聊天')
        .on('click', triggerReturnNavigation); // 添加点击事件处理器

    // 将按钮添加到聊天区域之后 (或者其他你认为合适的位置)
    $('#chat').after(returnButton);
    console.log(`${pluginName}: setupPreviewUI - Added return button.`);
}

// --- 新增：恢复正常聊天UI (显示输入框, 移除返回按钮) ---
function restoreNormalChatUI() {
    console.log(`${pluginName}: restoreNormalChatUI - Restoring normal UI.`);
    // 移除返回按钮
    $(`#${returnButtonId}`).remove();
    // 显示输入表单
    $('#send_form').show();
    console.log(`${pluginName}: restoreNormalChatUI - Removed return button and shown #send_form.`);
}

// --- 新增：触发返回导航的函数 ---
async function triggerReturnNavigation() {
    console.log(`${pluginName}: triggerReturnNavigation - Return button clicked.`);
    if (!previewState.originalContext) {
        console.error(`${pluginName}: triggerReturnNavigation - Original context not found! Cannot return.`);
        toastr.error('无法找到原始聊天上下文，无法返回。');
        // 即使无法导航，也尝试恢复UI
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
        return;
    }

    const { characterId, groupId, chatId } = previewState.originalContext;
    console.log(`${pluginName}: triggerReturnNavigation - Returning to context:`, previewState.originalContext);

    // 清理原始上下文，防止重复点击或其他问题
    // previewState.originalContext = null; // 移动到 CHAT_CHANGED 处理

    try {
        toastr.info('正在返回原聊天...');
        if (groupId) {
            // 对于群聊聊天，需要群聊ID和聊天ID
            console.log(`${pluginName}: Navigating back to Group Chat: groupId=${groupId}, chatId=${chatId}`);
            await openGroupChat(groupId, chatId);
        } else if (characterId !== undefined) { // 确保 characterId 存在 (即使是 null 或 0)
            // 对于角色聊天，只需要聊天ID (文件名)
             console.log(`${pluginName}: Navigating back to Character Chat: characterId=${characterId}, chatId=${chatId}`);
            await openCharacterChat(chatId);
        } else {
            console.error(`${pluginName}: triggerReturnNavigation - Invalid original context. Cannot determine navigation type.`);
            toastr.error('无法确定原始聊天类型，无法返回。');
            restoreNormalChatUI(); // 尝试恢复 UI
            previewState.isActive = false;
        }
        // 导航成功后，CHAT_CHANGED 事件会触发，那里的处理器会清理UI和状态
    } catch (error) {
        console.error(`${pluginName}: triggerReturnNavigation - Error during navigation back:`, error);
        toastr.error(`返回原聊天时出错: ${error.message}`);
        // 即使导航失败，也尝试恢复UI并重置状态
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null; // 清理状态
        previewState.previewChatId = null;
    }
}

/**
 * 处理预览按钮点击 (Optimized Version 7.0 - No Rename - With UI Changes)
 * 创建或切换到预览聊天，并批量填充收藏的消息，隐藏输入框，添加返回按钮。
 */
async function handlePreviewButtonClick() {
    console.log(`${pluginName}: 预览按钮被点击 (包含UI修改)`);
    toastr.info('正在准备预览聊天...');

    // --- 新增：保存原始上下文 ---
    const initialContext = getContext();
    previewState.originalContext = {
        characterId: initialContext.characterId,
        groupId: initialContext.groupId,
        chatId: initialContext.chatId, // 存储进入预览前的 chatId
    };
    // 重置状态，确保每次点击都是干净的开始 (CHAT_CHANGED 会处理旧状态)
    previewState.isActive = false;
    previewState.previewChatId = null;
    restoreNormalChatUI(); // 以防万一之前的状态没清理干净

    console.log(`${pluginName}: 保存的原始上下文:`, previewState.originalContext);


    try {
        // const initialContext = getContext(); // 移到前面获取
        if (!initialContext.groupId && initialContext.characterId === undefined) {
            console.error(`${pluginName}: 错误: 没有选择角色或群聊`);
            toastr.error('请先选择一个角色或群聊');
            previewState.originalContext = null; // 清除无效的上下文
            return;
        }

        const { characterId, groupId } = ensurePreviewData();
        const chatMetadata = ensureFavoritesArrayExists();

        if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
            toastr.warning('没有收藏的消息可以预览');
             previewState.originalContext = null; // 清除上下文
            return;
        }
        console.log(`${pluginName}: 当前聊天收藏消息数量: ${chatMetadata.favorites.length}`);

        const originalChat = JSON.parse(JSON.stringify(initialContext.chat || []));
        console.log(`${pluginName}: 原始聊天总消息数: ${originalChat.length}`);

        const previewKey = groupId ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[pluginName].previewChats[previewKey];
        let targetPreviewChatId = existingPreviewChatId;

        // --- 步骤 1: 切换或创建聊天 ---
        if (existingPreviewChatId) {
            console.log(`${pluginName}: 发现现有预览聊天ID: ${existingPreviewChatId}`);
             if (initialContext.chatId === existingPreviewChatId) {
                console.log(`${pluginName}: 已在目标预览聊天 (${existingPreviewChatId})，无需切换。`);
                targetPreviewChatId = initialContext.chatId; // 确认目标ID
            } else {
                console.log(`${pluginName}: 正在切换到预览聊天...`);
                if (groupId) {
                    await openGroupChat(groupId, existingPreviewChatId);
                } else {
                    await openCharacterChat(existingPreviewChatId);
                }
                // 切换后，等待 CHAT_CHANGED 事件确认 targetPreviewChatId
            }
        } else {
            console.log(`${pluginName}: 未找到预览聊天ID，将创建新聊天`);
            await doNewChat({ deleteCurrentChat: false });
            const newContextAfterCreation = getContext();
            targetPreviewChatId = newContextAfterCreation.chatId;
            if (!targetPreviewChatId) {
                console.error(`${pluginName}: 创建新聊天后无法获取聊天ID`);
                throw new Error('创建预览聊天失败，无法获取新的 Chat ID');
            }
            console.log(`${pluginName}: 新聊天ID: ${targetPreviewChatId}`);
            extension_settings[pluginName].previewChats[previewKey] = targetPreviewChatId;
            saveMetadataDebounced();
        }

        // --- 步骤 2: 等待聊天切换/创建完成 (事件驱动) ---
        const currentContextAfterSwitchAttempt = getContext();
        if (currentContextAfterSwitchAttempt.chatId !== targetPreviewChatId) {
             console.log(`${pluginName}: Waiting for CHAT_CHANGED event to confirm switch to ${targetPreviewChatId}...`);
             try {
                // 使用 Promise 包装事件监听器
                targetPreviewChatId = await new Promise((resolve, reject) => {
                     const timeout = setTimeout(() => {
                        eventSource.off(event_types.CHAT_CHANGED, listener);
                        reject(new Error(`Waiting for CHAT_CHANGED to ${targetPreviewChatId} timed out after 5 seconds`));
                    }, 5000);

                    const listener = (receivedChatId) => {
                        if (receivedChatId === targetPreviewChatId) {
                             console.log(`${pluginName}: Received expected CHAT_CHANGED event for chatId: ${receivedChatId}`);
                            clearTimeout(timeout);
                            requestAnimationFrame(() => resolve(receivedChatId)); // 确认是这个 ID
                        } else {
                            console.log(`${pluginName}: Received CHAT_CHANGED for unexpected chatId ${receivedChatId}, could be intermediate state or error.`);
                             // 如果 targetPreviewChatId 是新创建的，接收到的可能是旧的 chatId
                             // 如果 targetPreviewChatId 是已存在的，接收到的可能是旧的 chatId
                             // 这里需要更健壮的逻辑，或者依赖后续的 getContext 检查
                             // 为简单起见，我们假设最终会切换到 targetPreviewChatId
                             // 严格来说，应该在这里继续等待或处理错误
                        }
                    };
                    // 使用 once 确保只监听一次
                    eventSource.once(event_types.CHAT_CHANGED, listener);
                });
                 console.log(`${pluginName}: CHAT_CHANGED event processed. Confirmed target chatId: ${targetPreviewChatId}. UI should be stable.`);
            } catch (error) {
                console.error(`${pluginName}: Error or timeout waiting for CHAT_CHANGED:`, error);
                toastr.error('切换到预览聊天时出错或超时，请重试');
                previewState.originalContext = null; // 清理状态
                return; // 中断执行
            }
        } else {
            console.log(`${pluginName}: Already in the target chat or switch completed instantly. Target chatId: ${targetPreviewChatId}`);
            await new Promise(resolve => requestAnimationFrame(resolve)); // 等待一帧确保UI稳定
        }


        // --- 步骤 3: 清空当前聊天 ---
        console.log(`${pluginName}: 清空当前 (预览) 聊天 (ID: ${targetPreviewChatId})...`);
        clearChat(); // 清空界面和内部 chat 数组

        // --- 步骤 4: 等待聊天 DOM 清空 (条件驱动) ---
        console.log(`${pluginName}: Waiting for chat DOM to clear...`);
        try {
            await waitUntilCondition(() => document.querySelectorAll('#chat .mes').length === 0, 2000, 50);
            console.log(`${pluginName}: Chat DOM cleared successfully.`);
        } catch (error) {
            console.error(`${pluginName}: Waiting for chat clear timed out:`, error);
            toastr.warning('清空聊天时可能超时，继续尝试填充消息...');
        }

        // --- 新增：步骤 4.5: 设置预览模式 UI ---
        // 确保我们确实在目标预览聊天中
        const contextBeforeFill = getContext();
        if (contextBeforeFill.chatId !== targetPreviewChatId) {
            console.error(`${pluginName}: Error: Context switched unexpectedly BEFORE setting up UI. Expected ${targetPreviewChatId}, got ${contextBeforeFill.chatId}. Aborting.`);
            toastr.error('无法确认预览聊天环境，操作中止。请重试。');
            previewState.originalContext = null; // 清理状态
            restoreNormalChatUI(); // 尝试恢复UI
            return;
        }
        setupPreviewUI(targetPreviewChatId); // * * * 执行UI修改 * * *


        // --- 步骤 5: 准备收藏消息 (健壮查找) ---
        console.log(`${pluginName}: 正在准备收藏消息以填充预览聊天...`);
        const messagesToFill = [];
        for (const favItem of chatMetadata.favorites) {
            const messageIdStr = favItem.messageId;
            const messageIndex = parseInt(messageIdStr, 10);
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
                messagesToFill.push({
                    message: messageCopy,
                    mesid: messageIndex
                });
            } else {
                console.warn(`${pluginName}: Warning: Favorite message with original mesid ${messageIdStr} not found in original chat snapshot (length ${originalChat.length}). Skipping.`);
            }
        }
        messagesToFill.sort((a, b) => a.mesid - b.mesid);
        console.log(`${pluginName}: 找到 ${messagesToFill.length} 条有效收藏消息可以填充`);

        // --- 步骤 6: 批量填充消息 ---
        const finalContext = getContext(); // 获取填充操作开始时的最终上下文
        // *** 再次检查，确保还在预览聊天中 ***
        if (finalContext.chatId !== targetPreviewChatId) {
             console.error(`${pluginName}: Error: Context switched unexpectedly during preparation. Expected ${targetPreviewChatId}, got ${finalContext.chatId}. Aborting fill.`);
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             restoreNormalChatUI(); // 清理UI
             previewState.isActive = false; // 重置状态
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return; // 中断执行
        }
        console.log(`${pluginName}: Confirmed context for chatId ${finalContext.chatId}. Starting batch fill...`);

        let addedCount = 0;
        const BATCH_SIZE = 20;
        for (let i = 0; i < messagesToFill.length; i += BATCH_SIZE) {
            const batch = messagesToFill.slice(i, i + BATCH_SIZE);
            console.log(`${pluginName}: Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messagesToFill.length / BATCH_SIZE)} (${batch.length} messages)`);
            for (const item of batch) {
                try {
                    const message = item.message;
                    const originalMesid = item.mesid;
                    await finalContext.addOneMessage(message, {
                        scroll: false,
                        forceId: originalMesid
                    });
                    addedCount++;
                } catch (error) {
                    console.error(`${pluginName}: Error adding message (original mesid=${item.mesid}):`, error);
                }
            }
            if (i + BATCH_SIZE < messagesToFill.length) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        }
        console.log(`${pluginName}: All batches processed. Total messages added: ${addedCount}`);

        // --- 步骤 7: 完成与最终处理 ---
        if (addedCount > 0) {
            console.log(`${pluginName}: Preview population complete. UI is in preview mode.`);
            toastr.success(`已在预览模式下显示 ${addedCount} 条收藏消息`);
        } else if (messagesToFill.length > 0) {
             console.warn(`${pluginName}: No messages were successfully added, although ${messagesToFill.length} were prepared.`);
             toastr.warning('准备了收藏消息，但未能成功添加到预览中。请检查控制台。');
             // 即使添加失败，UI 仍然处于预览模式，用户可以通过返回按钮退出
        } else {
             // 没有消息可添加，但 UI 仍然进入了预览模式（虽然是空的）
             toastr.info('收藏夹为空，已进入（空的）预览模式。点击下方按钮返回。');
        }

    } catch (error) {
        console.error(`${pluginName}: Error during preview generation:`, error);
        const errorMsg = (error instanceof Error && error.message) ? error.message : '请查看控制台获取详细信息';
        toastr.error(`创建预览时出错: ${errorMsg}`);
        // 出错时尝试恢复UI和状态
        restoreNormalChatUI();
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
    }
}


// --- 新增：处理聊天切换事件，用于在离开预览时恢复UI ---
function handleChatChangeForPreview(newChatId) {
    // 检查是否正处于预览模式
    if (previewState.isActive) {
         console.log(`${pluginName}: CHAT_CHANGED detected. Current chat ID: ${newChatId}. Preview state active (Preview Chat ID: ${previewState.previewChatId}).`);
        // 检查新的聊天ID是否与我们记录的预览聊天ID不同
        if (newChatId !== previewState.previewChatId) {
            console.log(`${pluginName}: Left preview chat (${previewState.previewChatId}). Restoring normal UI.`);
            restoreNormalChatUI();
            // 重置预览状态
            previewState.isActive = false;
            previewState.originalContext = null;
            previewState.previewChatId = null;
        } else {
             console.log(`${pluginName}: CHAT_CHANGED event for the preview chat itself. No UI change needed.`);
             // 可能是在预览聊天内部发生了某些更新，不需要恢复UI
        }
    }
    // 如果不是预览模式，则忽略此事件
}


/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // Inject CSS styles
        const styleElement = document.createElement('style');
        styleElement.innerHTML = `
            /* ... (原有的 Popup 和 Icon 样式) ... */
            #favorites-popup-content {
                padding: 10px;
                max-height: 70vh;
                overflow-y: visible;
            }
            #favorites-popup-content .favorites-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 10px;
            }
            #favorites-popup-content .favorites-header h3 {
                /* 可以根据需要调整标题样式，比如限制最大宽度 */
                 margin-right: 10px; /* 给标题和按钮之间加点间距 */
                 flex-grow: 1; /* 让标题占据多余空间，有助于按钮靠右 */
                 text-align: left; /* 如果希望标题靠左 */
            }
            #favorites-popup-content .favorites-divider {
                height: 1px;
                background-color: #ccc;
                margin: 10px 0;
            }
            #favorites-popup-content .favorites-list {
                margin: 10px 0;
            }
            #favorites-popup-content .favorites-empty {
                text-align: center;
                color: #888;
                padding: 20px;
            }
            #favorites-popup-content .favorite-item {
                border-radius: 8px;
                margin-bottom: 10px;
                padding: 10px;
                background-color: rgba(0, 0, 0, 0.2);
                position: relative;
            }
            #favorites-popup-content .fav-meta {
                font-size: 0.8em;
                color: #aaa;
                text-align: right;      /* 确保文本在自己的空间内右对齐 */
                margin-bottom: 5px;
                margin-top: 0;
                flex-grow: 1;           /* 允许元信息占据多余空间 (有助于右对齐) - 可选 */
                min-width: 0;           /* 与 flex-grow:1 配合，防止溢出问题 - 可选 */
            }
            #favorites-popup-content .fav-note {
                background-color: rgba(255, 255, 0, 0.1);
                padding: 5px;
                border-left: 3px solid #ffcc00;
                margin-bottom: 5px;
                font-style: italic;
                text-align: left;
            }
            #favorites-popup-content .fav-preview {
                margin-bottom: 5px;
                line-height: 1.4;
                max-height: 200px;
                overflow-y: auto;
                word-wrap: break-word;
                white-space: pre-wrap;
                text-align: left;
            }
            #favorites-popup-content .fav-preview.deleted {
                color: #ff3a3a;
                font-style: italic;
            }
            #favorites-popup-content .fav-actions {
                text-align: right;
            }
            #favorites-popup-content .fav-actions i {
                cursor: pointer;
                margin-left: 10px;
                padding: 5px;
                border-radius: 50%;
                transition: background-color 0.2s;
            }
            #favorites-popup-content .fav-actions i:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }
            #favorites-popup-content .fav-actions .fa-pencil {
                color: #3a87ff;
            }
            #favorites-popup-content .fav-actions .fa-trash {
                color: #ff3a3a;
            }
            .favorite-toggle-icon {
                cursor: pointer;
            }
            .favorite-toggle-icon i.fa-regular {
                color: #999;
            }
            .favorite-toggle-icon i.fa-solid {
                color: #ffcc00;
            }
            #favorites-popup-content .favorites-pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-top: 10px;
                gap: 10px;
            }
            #favorites-popup-content .favorites-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 15px;
                padding-top: 10px;
            }


            #favorites-popup-content .fav-preview pre {
                display: block;         /* 确保是块级元素 */
                width: 100%;            /* 强制宽度为100% */
                box-sizing: border-box; /* 让 padding 和 border 包含在 width 内 */
                overflow-x: auto;       /* 如果代码过长，允许水平滚动 */
                white-space: pre-wrap;  /* 保持格式，但允许自动换行 */
                /* 你可能还需要根据你的代码高亮库调整这里的背景色和内边距， */
                /* 例如： */
                /* background-color: #222; /* 假设这是你的代码块背景色 */ */
                /* padding: 10px;          /* 示例内边距 */ */
                margin-bottom: 5px; /* 与普通文本保持一致的下边距 (可选) */
            }


            #favorites-popup-content .menu_button { /* <--- 更通用的选择器 */
                width: auto; /* 推荐：让浏览器根据内容自动决定宽度 */
                /* flex-shrink: 0; */ /* 可选：防止按钮在空间紧张时被压缩，如果 auto 不够的话可以试试 */
            }

            #favorites-popup-content .fav-send-date {
                font-size: 0.75em;
                color: #bbb;
                text-align: left;
                font-style: italic;
                display: inline-flex; /* 让内部的 span 和文本表现得更像一行 */
                flex-shrink: 0;         /* 防止日期被过度压缩 (可选) */
                align-items: baseline;
            }

            #favorites-popup-content .fav-send-date .fav-mesid { /* 选择器：目标是 fav-mesid span */
                margin-left: 8px;       /* 在日期和 mesid 之间添加一些水平间距 */
                color: #999;           /* 设置稍浅的颜色以区分 */
                font-size: 0.9em;       /* 可以让它比日期稍微小一点 (可选) */
                font-style: italic; */ /* 可选：斜体 */
                /* font-weight: bold; */ /* 可选：粗体 */
                /* background-color: rgba(255, 255, 255, 0.05); */ /* 可选：添加微弱背景 */
                /* padding: 1px 4px; */  /* 可选：添加内边距 */
                border-radius: 3px; */ /* 可选：圆角 */
            }

            #favorites-popup-content .fav-header-info {
                display: flex;              /* 使用 Flexbox 布局 */
                justify-content: space-between; /* 两端对齐 */
                align-items: baseline;       
                margin-bottom: 8px;         /* 和下面内容的间距 */
                flex-wrap: wrap;            /* 允许换行 */
                gap: 10px;                  /* 元素间距 */
            }

            /* --- 新增：返回按钮样式 --- */
            #${returnButtonId} {
                display: inline-block; /* 让按钮占据一行 */ 
                width: auto;
                margin: 10px; /* 上下边距10px，左右自动居中 */
                padding: 8px 15px; /* 内边距 */
                /* 可以根据需要添加更多样式，例如背景色、边框等 */
                background-color: var(--SmartThemeBtnBg);
                color: var(--SmartThemeBtnFg);
                border: 1px solid var(--SmartThemeBtnBorder);
                border-radius: 5px;
            }
            #${returnButtonId}:hover {
                 background-color: var(--SmartThemeBtnBgHover);
                 color: var(--SmartThemeBtnFgHover);
            }
        `;
        document.head.appendChild(styleElement);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);
            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings to extension settings
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#extensions_settings').append(settingsHtml);
            console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Set up event delegation for favorite toggle icon
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for current chat on load
        ensureFavoritesArrayExists();

        // Initial UI setup
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();
        // --- 新增：确保初始状态 UI 正常 ---
        restoreNormalChatUI(); // 确保加载时输入框可见，无返回按钮

        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, (newChatId) => { // <--- 修改：接收 newChatId
            console.log(`${pluginName}: 聊天已更改，更新收藏图标...`);
            ensureFavoritesArrayExists();
            // --- 新增：调用聊天切换处理函数 ---
            handleChatChangeForPreview(newChatId); // <--- 新增调用
            // ---
            setTimeout(() => {
                addFavoriteIconsToMessages();
                refreshFavoriteIconsInView();
            }, 150);
        });

        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIndex) => {
            const deletedMessageId = String(deletedMessageIndex);
            console.log(`${pluginName}: 检测到消息删除事件, 索引: ${deletedMessageIndex}`);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);
            if (favIndex !== -1) {
                console.log(`${pluginName}: 消息索引 ${deletedMessageIndex} (ID: ${deletedMessageId}) 被删除，移除对应的收藏项`);
                chatMetadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced();
                if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
                    currentPage = 1;
                    updateFavoritesPopup();
                }
            } else {
                 console.log(`${pluginName}: 未找到引用已删除消息索引 ${deletedMessageIndex} (ID: ${deletedMessageId}) 的收藏项`);
            }
             setTimeout(refreshFavoriteIconsInView, 100);
        });

        const handleNewMessage = () => {
             setTimeout(() => {
                 addFavoriteIconsToMessages();
             }, 150);
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SWIPED, () => {
            setTimeout(refreshFavoriteIconsInView, 150);
        });
        eventSource.on(event_types.MESSAGE_UPDATED, () => {
             setTimeout(refreshFavoriteIconsInView, 150);
        });
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: 加载了更多消息，更新图标...`);
             setTimeout(() => {
                 addFavoriteIconsToMessages();
                 refreshFavoriteIconsInView();
             }, 150);
        });

        // MutationObserver (unchanged)
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                            needsIconAddition = true;
                        }
                    });
                }
            }
            if (needsIconAddition) {
                 setTimeout(addFavoriteIconsToMessages, 200);
            }
        });
        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true,
                subtree: true
            });
             console.log(`${pluginName}: MutationObserver 已启动，监视 #chat 的变化`);
        } else {
             console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`);
        }

        console.log(`${pluginName}: 插件加载完成! (已应用预览UI修改)`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
