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
            // 尝试使用 timestampToMoment 格式化时间，如果失败则回退
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
                 previewText = messageFormatting(previewText, favItem.sender, false,
                                                favItem.role === 'user', null, {}, false);
            } catch (e) {
                 console.error(`${pluginName}: Error formatting message preview:`, e);
                 previewText = message.mes; // 格式化失败则显示原始文本
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

    // --- 修改: 在头部添加按钮容器和导出按钮 ---
    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
                <div class="favorites-header-buttons"> <!-- 新增：包裹按钮的容器 -->
                    ${totalFavorites > 0 ? `<button id="export-favorites-btn" class="menu_button" title="将所有收藏导出为 .txt 文件">导出收藏</button>` : ''} <!-- 新增：导出按钮 -->
                    ${totalFavorites > 0 ? `<button class="menu_button preview-favorites-btn" title="在新聊天中预览所有收藏的消息">预览</button>` : ''} <!-- 原有的预览按钮 -->
                </div>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;
    // --- 修改结束 ---

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            // 在调用 renderFavoriteItem 之前确保 favItem 有效
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
                <!-- 清理无效收藏按钮已根据要求移除 -->
                <!-- 关闭按钮已根据要求移除 -->
            </div>
        </div>
    `;
    try {
        favoritesPopup.content.innerHTML = contentHtml;
        console.log(`${pluginName}: Popup content updated using innerHTML (including export button).`); // 更新日志
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
                '<div class="spinner"></div>', // 初始加载状态
                POPUP_TYPE.TEXT,
                '', // 没有默认文本内容，将由 updateFavoritesPopup 填充
                {
                    title: '收藏管理',
                    wide: true,
                    okButton: false,     // 不需要 OK 按钮
                    cancelButton: true,  // 保留 Cancel 按钮（通常显示为“关闭”）
                    allowVerticalScrolling: true // 允许内容垂直滚动
                }
            );
            console.log(`${pluginName}: Popup instance created successfully.`);

            // --- 修改: 事件监听逻辑 ---
            $(favoritesPopup.content).on('click', function(event) {
                // ---> 在这里添加第一个日志 <---
                console.log(`[${pluginName}] Popup content click detected. Target element:`, event.target);

                const target = $(event.target);
                const closestButton = target.closest('button'); // 查找最近的按钮元素

                // 优先处理按钮点击
                if (closestButton.length) {
                    if (closestButton.hasClass('pagination-prev')) {
                        console.log(`[${pluginName}] Matched .pagination-prev click.`);
                        if (currentPage > 1) {
                            currentPage--;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('pagination-next')) {
                        console.log(`[${pluginName}] Matched .pagination-next click.`);
                        const chatMetadata = ensureFavoritesArrayExists();
                        const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                        const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                        if (currentPage < totalPages) {
                            currentPage++;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('preview-favorites-btn')) {
                        console.log(`[${pluginName}] Matched .preview-favorites-btn click.`);
                        handlePreviewButtonClick(); // 调用预览功能
                        if (favoritesPopup) {
                            favoritesPopup.completeCancelled(); // 正确关闭弹窗
                            console.log(`${pluginName}: 点击预览按钮，关闭收藏夹弹窗 (使用 completeCancelled)。`);
                        }
                    }
                    // --- 新增：处理导出按钮点击 ---
                    else if (closestButton.attr('id') === 'export-favorites-btn') {
                        console.log(`[${pluginName}] Matched #export-favorites-btn click.`); // 日志：确认导出按钮分支
                        handleExportFavorites(); // 调用新的导出处理函数
                        // 导出通常不需要关闭弹窗，用户可能想继续浏览
                    }
                    // --- 新增结束 ---
                    else if (closestButton.hasClass('clear-invalid')) { // 这个分支可能已移除，但保留以防万一
                        console.log(`[${pluginName}] Matched .clear-invalid click.`);
                        handleClearInvalidFavorites();
                    }
                }
                // 如果点击的不是按钮，再检查是否是图标
                else if (target.hasClass('fa-pencil')) {
                    console.log(`[${pluginName}] Matched .fa-pencil click. Target:`, target[0]);
                    const favItem = target.closest('.favorite-item');
                    console.log(`[${pluginName}] Pencil: Found parent .favorite-item:`, favItem ? favItem[0] : 'null');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         console.log(`[${pluginName}] Pencil: Extracted favId: ${favId}. Attempting to call handleEditNote...`);
                         try {
                            handleEditNote(favId);
                             console.log(`[${pluginName}] Pencil: handleEditNote call completed without throwing immediate error.`);
                         } catch(e) {
                             console.error(`[${pluginName}] Pencil: Error calling handleEditNote:`, e);
                         }
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                else if (target.hasClass('fa-trash')) {
                    console.log(`[${pluginName}] Matched .fa-trash click. Target:`, target[0]);
                    const favItem = target.closest('.favorite-item');
                    console.log(`[${pluginName}] Trash: Found parent .favorite-item:`, favItem ? favItem[0] : 'null');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         const msgId = favItem.data('msg-id');
                         console.log(`[${pluginName}] Trash: Extracted favId: ${favId}, msgId: ${msgId}. Attempting to call handleDeleteFavoriteFromPopup...`);
                         try {
                             handleDeleteFavoriteFromPopup(favId, msgId);
                             console.log(`[${pluginName}] Trash: handleDeleteFavoriteFromPopup call initiated without throwing immediate error.`);
                         } catch(e) {
                             console.error(`[${pluginName}] Trash: Error calling handleDeleteFavoriteFromPopup:`, e);
                         }
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
                // ---> 添加一个日志，以防以上条件都未匹配 <---
                else {
                    // 检查被点击元素本身或其父元素是否是我们关心的某个可交互元素的一部分
                    if (target.closest('.menu_button, .favorite-item, .pagination-prev, .pagination-next, .preview-favorites-btn, #export-favorites-btn, .clear-invalid, .fa-pencil, .fa-trash').length === 0) {
                         // 如果点击的不是任何已知可交互元素或其子元素，则不打印，减少干扰
                    } else {
                         console.log(`[${pluginName}] Click did not match any specific handler in the popup. Target element class:`, event.target.className, 'Target element:', event.target);
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
    }
    currentPage = 1; // 每次打开时重置到第一页
    updateFavoritesPopup(); // 填充或更新内容
    if (favoritesPopup) {
        try {
            favoritesPopup.show(); // 显示弹窗
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
                // 更新聊天界面中的对应图标
                const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                if (messageElement.length) {
                    const iconElement = messageElement.find('.favorite-toggle-icon i');
                    if (iconElement.length) {
                        iconElement.removeClass('fa-solid').addClass('fa-regular');
                    }
                }
            } else {
                 console.warn(`[${pluginName}] removeFavoriteById('${favId}') returned false. Favorite might not have been found in metadata.`);
            }
        } else {
            console.log(`[${pluginName}] User cancelled favorite deletion (popup result: ${confirmResult}).`);
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
    // 使用 POPUP_RESULT.AFFIRMATIVE 而不是 YES (根据 popup.js 定义)
    if (confirmResult === POPUP_RESULT.AFFIRMATIVE) {
        chatMetadata.favorites = validFavorites;
        saveMetadataDebounced();
        toastr.success(`已成功清理 ${invalidFavoritesIds.length} 条无效收藏。`);
        currentPage = 1; // 清理后重置到第一页
        updateFavoritesPopup(); // 刷新弹窗
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
            console.log(`${pluginName}: openGroupChat 调用完成 (groupId: ${groupId}, chatId: ${chatId})`);
            navigationSuccess = true;
             toastr.success('已成功返回原群组聊天！', '返回成功', { timeOut: 2000 });
        } else if (characterId !== undefined) {
            console.log(`${pluginName}: 导航返回至角色聊天: characterId=${characterId}, chatId=${chatId}`);
            await openCharacterChat(chatId);
            console.log(`${pluginName}: openCharacterChat 调用完成 (chatId: ${chatId})`);
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
        // 导航成功后，CHAT_CHANGED 事件会触发后续的 UI 清理 (handleChatChangeForPreview)
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
 * 创建或切换到预览聊天，重命名聊天，并批量填充收藏的消息，隐藏输入框，添加返回按钮。
 */
async function handlePreviewButtonClick() {
    console.log(`${pluginName}: 预览按钮被点击 (包含UI修改和重命名)`);
    toastr.info('正在准备预览聊天...');

    // --- 保存原始上下文 ---
    const initialContext = getContext();
    previewState.originalContext = {
        characterId: initialContext.characterId,
        groupId: initialContext.groupId,
        chatId: initialContext.chatId, // 存储进入预览前的 chatId
    };
    // 重置状态
    previewState.isActive = false;
    previewState.previewChatId = null;
    restoreNormalChatUI(); // 清理旧UI状态

    console.log(`${pluginName}: 保存的原始上下文:`, previewState.originalContext);

    try {
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
        let needsRename = false; // <--- 新增：标记是否需要重命名

        // --- 步骤 1: 切换或创建聊天 ---
        if (existingPreviewChatId) {
            console.log(`${pluginName}: 发现现有预览聊天ID: ${existingPreviewChatId}`);
            if (initialContext.chatId === existingPreviewChatId) {
                console.log(`${pluginName}: 已在目标预览聊天 (${existingPreviewChatId})，无需切换。`);
                targetPreviewChatId = initialContext.chatId; // 确认目标ID
                needsRename = true; // 即使已在，也检查并确保名称正确
            } else {
                console.log(`${pluginName}: 正在切换到预览聊天...`);
                needsRename = true; // 切换过去后需要检查并重命名
                if (groupId) {
                    await openGroupChat(groupId, existingPreviewChatId);
                } else {
                    await openCharacterChat(existingPreviewChatId);
                }
                // 等待 CHAT_CHANGED
            }
        } else {
            console.log(`${pluginName}: 未找到预览聊天ID，将创建新聊天`);
            await doNewChat({ deleteCurrentChat: false });
            const newContextAfterCreation = getContext(); // 创建后立即获取上下文
            targetPreviewChatId = newContextAfterCreation.chatId;
            if (!targetPreviewChatId) {
                console.error(`${pluginName}: 创建新聊天后无法获取聊天ID`);
                throw new Error('创建预览聊天失败，无法获取新的 Chat ID');
            }
            console.log(`${pluginName}: 新聊天ID: ${targetPreviewChatId}`);
            extension_settings[pluginName].previewChats[previewKey] = targetPreviewChatId;
            saveMetadataDebounced(); // 保存新的预览聊天ID映射
            needsRename = true; // 新创建的聊天肯定需要命名
        }

        // --- 步骤 2: 等待聊天切换/创建完成 (事件驱动) ---
        const currentContextAfterSwitchAttempt = getContext();
        if (currentContextAfterSwitchAttempt.chatId !== targetPreviewChatId) {
            console.log(`${pluginName}: Waiting for CHAT_CHANGED event to confirm switch to ${targetPreviewChatId}...`);
            try {
                targetPreviewChatId = await new Promise((resolve, reject) => {
                     const timeout = setTimeout(() => {
                        eventSource.off(event_types.CHAT_CHANGED, listener);
                        reject(new Error(`Waiting for CHAT_CHANGED to ${targetPreviewChatId} timed out after 5 seconds`));
                    }, 5000); // 5秒超时

                    const listener = (receivedChatId) => {
                        if (receivedChatId === targetPreviewChatId) {
                             console.log(`${pluginName}: Received expected CHAT_CHANGED event for chatId: ${receivedChatId}`);
                            clearTimeout(timeout);
                            eventSource.off(event_types.CHAT_CHANGED, listener); // 移除监听器
                            requestAnimationFrame(() => resolve(receivedChatId)); // 等待下一帧再 resolve
                        } else {
                             console.log(`${pluginName}: Received CHAT_CHANGED for unexpected chatId ${receivedChatId}, waiting...`);
                        }
                    };
                    eventSource.on(event_types.CHAT_CHANGED, listener); // 使用 on 监听
                });
                console.log(`${pluginName}: CHAT_CHANGED event processed. Confirmed target chatId: ${targetPreviewChatId}.`);
            } catch (error) {
                console.error(`${pluginName}: Error or timeout waiting for CHAT_CHANGED:`, error);
                toastr.error('切换到预览聊天时出错或超时，请重试');
                previewState.originalContext = null;
                return;
            }
        } else {
            console.log(`${pluginName}: Already in the target chat or switch completed instantly. Target chatId: ${targetPreviewChatId}`);
            await new Promise(resolve => requestAnimationFrame(resolve)); // 等待一帧确保UI稳定
        }

        // --- 新增：步骤 2.5: 重命名聊天 (如果需要) ---
        const contextForRename = getContext();
        if (contextForRename.chatId === targetPreviewChatId && needsRename) {
            const oldFileName = contextForRename.chatId; // 使用 chatId 作为旧文件名

            if (!oldFileName || typeof oldFileName !== 'string') {
                console.error(`${pluginName}: 无法获取有效的旧聊天文件名 (chatId)，跳过重命名。`);
                toastr.warning('无法获取当前聊天名称，跳过重命名。');
            } else {
                console.log(`${pluginName}: 准备重命名预览聊天 ${targetPreviewChatId}. 旧文件名/ID: ${oldFileName}`);
                const previewPrefix = "[收藏预览] ";

                // 尝试获取当前聊天名称 (可能来自 context.chatName 或派生)
                let currentChatName = contextForRename.chatName;
                if (!currentChatName) {
                    if (contextForRename.groupId) {
                        const group = contextForRename.groups?.find(g => g.id === contextForRename.groupId);
                        currentChatName = group ? group.name : '群聊';
                    } else if (contextForRename.characterId !== undefined) {
                        currentChatName = contextForRename.name2 || '角色聊天';
                    } else {
                        currentChatName = '新聊天';
                    }
                    console.log(`${pluginName}: 未直接获取到 chatName，使用派生名称: ${currentChatName}`);
                }

                let newName = currentChatName;

                if (typeof currentChatName === 'string' && !currentChatName.startsWith(previewPrefix)) {
                    newName = previewPrefix + currentChatName;
                } else if (typeof currentChatName !== 'string'){
                     console.warn(`${pluginName}: currentChatName 不是字符串 (${typeof currentChatName})，无法安全添加前缀。使用默认名称。`);
                     newName = previewPrefix + '未命名预览';
                     currentChatName = '未命名预览'; // 确保后续比较能进行
                }

                const finalNewName = typeof newName === 'string' ? newName.trim() : '';

                // 只有在需要添加前缀时才重命名
                if (finalNewName && typeof currentChatName === 'string' && !currentChatName.startsWith(previewPrefix)) {
                    console.log(`${pluginName}: 应用前缀，最终重命名为 "${finalNewName}" (从 "${oldFileName}")`);
                    try {
                        // 使用 renameChat 函数进行重命名
                        await renameChat(oldFileName, finalNewName);
                        console.log(`${pluginName}: 预览聊天已成功重命名为 "${finalNewName}"`);

                        // --- 更新 targetPreviewChatId 和 extension_settings ---
                        console.log(`${pluginName}: 重命名成功，将 targetPreviewChatId 从 ${targetPreviewChatId} 更新为 ${finalNewName}`);
                        targetPreviewChatId = finalNewName; // 更新追踪变量为新的文件名

                        const currentPreviewKey = contextForRename.groupId ? `group_${contextForRename.groupId}` : `char_${contextForRename.characterId}`;
                        if (extension_settings[pluginName].previewChats && currentPreviewKey in extension_settings[pluginName].previewChats) {
                             // 如果旧的 key (可能基于 characterId/groupId) 存在，更新其映射值
                            extension_settings[pluginName].previewChats[currentPreviewKey] = targetPreviewChatId; // 存入新的文件名
                            saveMetadataDebounced();
                            console.log(`${pluginName}: 更新 extension_settings 中的预览映射: ${currentPreviewKey} -> ${targetPreviewChatId}`);
                        } else {
                            console.warn(`${pluginName}: 无法在 extension_settings 中找到 previewKey ${currentPreviewKey} 来更新映射，或 previewChats 未定义`);
                             // 即使映射更新失败，也要继续，因为 targetPreviewChatId 已更新
                        }
                        // --- 更新结束 ---

                    } catch(renameError) {
                        console.error(`${pluginName}: 重命名预览聊天失败 (尝试从 "${oldFileName}" 重命名为: "${finalNewName}"):`, renameError);
                        toastr.error('重命名预览聊天失败，请检查控制台');
                        // 重命名失败，targetPreviewChatId 保持旧值 (oldFileName)
                        targetPreviewChatId = oldFileName;
                    }
                } else if (typeof currentChatName === 'string' && currentChatName.startsWith(previewPrefix)) {
                    console.log(`${pluginName}: 聊天名称已包含前缀，无需重命名: "${currentChatName}" (文件: ${oldFileName})`);
                    targetPreviewChatId = oldFileName; // 确保 ID 正确 (仍然是旧文件名/ID)
                } else {
                    console.warn(`${pluginName}: 计算出的新名称无效或为空 ("${finalNewName}")，或者原始名称不是字符串，跳过重命名。原始名称: "${currentChatName}", 文件: ${oldFileName}`);
                    targetPreviewChatId = oldFileName; // 确保 ID 正确 (仍然是旧文件名/ID)
                }
            }
        } else if (needsRename) {
             console.warn(`${pluginName}: 上下文不匹配或不需要重命名，跳过重命名步骤。Context ChatId: ${contextForRename.chatId}, Target: ${targetPreviewChatId}`);
             targetPreviewChatId = contextForRename.chatId; // 确保 ID 正确
        } else {
            targetPreviewChatId = contextForRename.chatId; // 确保 ID 正确
            console.log(`${pluginName}: 不需要重命名，确认 targetPreviewChatId 为 ${targetPreviewChatId}`);
        }

        // --- 步骤 3: 清空当前聊天 ---
        console.log(`${pluginName}: 清空当前 (预览) 聊天 (ID: ${targetPreviewChatId})...`); // 使用确认/更新后的 ID
        clearChat();

        // --- 步骤 4: 等待聊天 DOM 清空 ---
        console.log(`${pluginName}: Waiting for chat DOM to clear...`);
        try {
            await waitUntilCondition(() => document.querySelectorAll('#chat .mes').length === 0, 2000, 50);
            console.log(`${pluginName}: Chat DOM cleared successfully.`);
        } catch (error) {
            console.error(`${pluginName}: Waiting for chat clear timed out:`, error);
            toastr.warning('清空聊天时可能超时，继续尝试填充消息...');
        }

        // --- 步骤 4.5: 设置预览模式 UI ---
        const contextBeforeFill = getContext();
        if (contextBeforeFill.chatId !== targetPreviewChatId) {
            console.error(`${pluginName}: Error: Context switched unexpectedly BEFORE setting up UI. Expected ${targetPreviewChatId}, got ${contextBeforeFill.chatId}. Aborting.`);
            toastr.error('无法确认预览聊天环境，操作中止。请重试。');
            previewState.originalContext = null;
            restoreNormalChatUI();
            return;
        }
        setupPreviewUI(targetPreviewChatId); // * * * 执行UI修改 * * *

        // --- 步骤 5: 准备收藏消息 (健壮查找) ---
        console.log(`${pluginName}: 正在准备收藏消息以填充预览聊天...`);
        const messagesToFill = [];
        const sortedFavoritesForFill = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId)); // 按原始顺序排序

        for (const favItem of sortedFavoritesForFill) { // 使用排序后的列表
            const messageIdStr = favItem.messageId;
            const messageIndex = parseInt(messageIdStr, 10);
            let foundMessage = null;
            if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChat.length) {
                if (originalChat[messageIndex]) {
                    foundMessage = originalChat[messageIndex];
                }
            }
            if (foundMessage) {
                // 创建消息的深拷贝以避免修改原始快照
                const messageCopy = JSON.parse(JSON.stringify(foundMessage));
                // 确保 extra 和 swipes 存在 (某些旧消息可能没有)
                if (!messageCopy.extra) messageCopy.extra = {};
                if (!messageCopy.extra.swipes) messageCopy.extra.swipes = [];

                messagesToFill.push({
                    message: messageCopy, // 使用拷贝
                    mesid: messageIndex   // 保留原始索引用于可能的调试或排序
                });
            } else {
                console.warn(`${pluginName}: Warning: Favorite message with original mesid ${messageIdStr} not found in original chat snapshot (length ${originalChat.length}). Skipping.`);
            }
        }
        // messagesToFill 已经是按原始 mesid 排序的了
        console.log(`${pluginName}: 找到 ${messagesToFill.length} 条有效收藏消息可以填充`);


        // --- 步骤 6: 批量填充消息 ---
        const finalContextForFill = getContext(); // 获取填充操作开始时的最终上下文
        // *** 再次检查上下文是否仍然是目标预览聊天 ***
        if (finalContextForFill.chatId !== targetPreviewChatId) {
             console.error(`${pluginName}: Error: Context switched unexpectedly during preparation. Expected ${targetPreviewChatId}, got ${finalContextForFill.chatId}. Aborting fill.`);
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             restoreNormalChatUI();
             previewState.isActive = false;
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return;
        }
        console.log(`${pluginName}: Confirmed context for chatId ${finalContextForFill.chatId}. Starting batch fill...`);

        let addedCount = 0;
        const BATCH_SIZE = 20; // 每批处理的消息数量

        for (let i = 0; i < messagesToFill.length; i += BATCH_SIZE) {
            const batch = messagesToFill.slice(i, i + BATCH_SIZE);
            console.log(`${pluginName}: Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messagesToFill.length / BATCH_SIZE)} (${batch.length} messages)`);

            // 尝试批量添加（注意：addOneMessage 内部可能是异步的，但这里循环是同步的）
            // 使用 Promise.all 等待一个批次内的所有 addOneMessage 调用完成（虽然它们可能内部是顺序执行的）
            const addPromises = batch.map(item => {
                return (async () => { // 包装在 async IIFE 中以处理可能的异步和错误
                    try {
                        // 使用 finalContextForFill.addOneMessage 添加消息
                        await finalContextForFill.addOneMessage(item.message, { scroll: false });
                        addedCount++;
                    } catch (error) {
                        console.error(`${pluginName}: Error adding message (original index=${item.mesid}):`, error);
                    }
                })();
            });

            await Promise.all(addPromises); // 等待当前批次所有添加操作（或错误）完成

            // 在批次之间添加小的延迟，允许 UI 渲染
            if (i + BATCH_SIZE < messagesToFill.length) {
                 await new Promise(resolve => setTimeout(resolve, 50)); // 短暂延迟 50ms
            }
        }

        console.log(`${pluginName}: All batches processed. Total messages added: ${addedCount}`);


        // --- 步骤 7: 完成与最终处理 ---
        if (addedCount > 0) {
            // 滚动到聊天顶部，以便用户看到第一条收藏
            $('#chat').scrollTop(0);
            console.log(`${pluginName}: Preview population complete. Scrolled to top. UI is in preview mode.`);
            toastr.success(`已在预览模式下显示 ${addedCount} 条收藏消息`);
        } else if (messagesToFill.length > 0) {
             console.warn(`${pluginName}: No messages were successfully added, although ${messagesToFill.length} were prepared.`);
             toastr.warning('准备了收藏消息，但未能成功添加到预览中。请检查控制台。');
        } else {
             // 如果收藏夹本身是空的
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
    if (previewState.isActive) {
         console.log(`${pluginName}: CHAT_CHANGED detected. Current chat ID: ${newChatId}. Preview state active (Preview Chat ID: ${previewState.previewChatId}).`);
        if (newChatId !== previewState.previewChatId) {
            console.log(`${pluginName}: Left preview chat (${previewState.previewChatId}). Restoring normal UI.`);
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null;
            previewState.previewChatId = null;
        } else {
             console.log(`${pluginName}: CHAT_CHANGED event for the preview chat itself. No UI change needed.`);
        }
    }
}


// --- 新增：处理收藏导出的函数 ---
/**
 * Handles exporting the favorited messages to a text file.
 */
async function handleExportFavorites() {
    // 函数开始，记录日志
    console.log(`${pluginName}: handleExportFavorites - 开始导出收藏`);
    // 获取当前上下文和收藏元数据
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

    // 检查是否有收藏项或者上下文是否有效
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        toastr.warning('没有收藏的消息可以导出。'); // 提示用户
        console.log(`${pluginName}: handleExportFavorites - 没有收藏，导出中止`);
        return; // 中止导出
    }
    if (!context || !context.chat) {
        toastr.error('无法获取当前聊天记录以导出收藏。'); // 错误提示
        console.error(`${pluginName}: handleExportFavorites - 无法获取 context.chat`);
        return; // 中止导出
    }

    // 提示用户正在进行导出
    toastr.info('正在准备导出收藏...', '导出中');

    try {
        // 再次确认时间格式化函数可用 (虽然顶部已导入，但做个检查)
        if (typeof timestampToMoment !== 'function') {
            console.error(`${pluginName}: timestampToMoment function is not available. Check imports.`);
            toastr.error('导出功能所需的时间格式化工具不可用。');
            return;
        }

        // 将收藏项按其原始消息 ID (messageId，即索引) 排序，确保导出顺序与聊天记录一致
        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));

        // 初始化一个数组来存储导出的每一行文本
        const exportLines = [];
        // 获取当前聊天对象的名称 (角色名或群组名)
        const chatName = context.characterId ? context.name2 : (context.groups?.find(g => g.id === context.groupId)?.name || '群聊');
        // 使用 Moment.js 获取当前时间并格式化，用于文件名
        const exportDate = timestampToMoment(Date.now()).format('YYYYMMDD_HHmmss');

        // --- 文件头信息 ---
        exportLines.push(`收藏夹导出`); // 文件标题
        exportLines.push(`聊天对象: ${chatName}`); // 记录聊天对象
        exportLines.push(`导出时间: ${timestampToMoment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}`); // 记录导出操作的时间
        exportLines.push(`总收藏数: ${sortedFavorites.length}`); // 记录总共导出了多少条
        exportLines.push('---'); // 添加分隔符
        exportLines.push(''); // 添加一个空行，使格式更清晰

        // --- 遍历已排序的收藏项 ---
        for (const favItem of sortedFavorites) {
            // 尝试从 context.chat 中获取原始消息对象
            const messageIndex = parseInt(favItem.messageId, 10);
            const message = (!isNaN(messageIndex) && context.chat[messageIndex]) ? context.chat[messageIndex] : null;

            // 添加该条收藏的开始分隔符，并包含原始消息 ID
            exportLines.push(`--- 消息 #${favItem.messageId} ---`);

            if (message) {
                // 如果原始消息存在
                // 确定发送者名称
                const sender = favItem.sender || (message.is_user ? (context.userAlias || 'You') : (message.name || 'Character')); // 优先用收藏里的，然后判断用户/角色，最后用消息里的 name
                let timestampStr = '[时间未知]'; // 默认时间戳
                if (message.send_date) {
                    try {
                        // 尝试用 Moment.js 格式化时间戳
                        timestampStr = timestampToMoment(message.send_date).format('YYYY-MM-DD HH:mm:ss');
                    } catch (e) {
                        // 如果格式化失败，记录警告并使用原始时间戳字符串
                        console.warn(`${pluginName}: Error formatting timestamp for message ${favItem.messageId}:`, e);
                        timestampStr = String(message.send_date); // 转换为字符串以防万一
                    }
                }

                // 添加格式化的发送者和时间
                exportLines.push(`发送者: ${sender}`);
                exportLines.push(`时间: ${timestampStr}`);
                // 如果有备注，添加备注
                if (favItem.note) {
                    exportLines.push(`备注: ${favItem.note}`);
                }
                // 添加消息内容标签
                exportLines.push(`内容:`);
                // 添加原始消息文本，保留换行符等格式
                exportLines.push(message.mes || '[消息内容为空]'); // 如果消息内容为空，则显示提示

            } else {
                // 如果原始消息不存在 (可能已被删除或索引无效)
                exportLines.push(`[原始消息内容不可用或已删除]`); // 添加提示
                // 即使消息没了，也尝试显示收藏时记录的发送者和备注
                 if (favItem.sender) {
                     exportLines.push(`原始发送者: ${favItem.sender}`);
                 }
                if (favItem.note) {
                    exportLines.push(`备注: ${favItem.note}`);
                }
            }
            // 添加该条收藏的结束分隔符
            exportLines.push(`--- 结束消息 #${favItem.messageId} ---`);
            exportLines.push(''); // 在每条收藏之间添加空行
        }

        // --- 生成并下载文件 ---
        // 将存储行的数组用换行符连接成一个完整的文本字符串
        const exportedText = exportLines.join('\n');

        // 创建一个 Blob 对象，用于承载文本数据
        // 指定 MIME 类型为纯文本，并使用 UTF-8 编码
        const blob = new Blob([exportedText], { type: 'text/plain;charset=utf-8' });

        // 生成文件名：将聊天名称中的非法字符替换为下划线，并添加“收藏”标识和导出日期
        const safeChatName = String(chatName).replace(/[\\/:*?"<>|]/g, '_'); // 确保 chatName 是字符串并替换非法字符
        const filename = `${safeChatName}_收藏_${exportDate}.txt`;

        // 创建一个隐藏的 <a> 标签来触发下载
        const link = document.createElement('a');
        // 将 Blob 数据转换为对象 URL 并赋给链接的 href
        link.href = URL.createObjectURL(blob);
        // 设置下载文件的名称
        link.download = filename;
        // 将链接添加到文档主体中（某些浏览器需要这样才能触发下载）
        document.body.appendChild(link);
        // 模拟用户点击链接
        link.click();
        // 下载触发后，从文档中移除链接
        document.body.removeChild(link);
        // 释放之前创建的对象 URL，以节省内存
        URL.revokeObjectURL(link.href);

        // 记录成功日志并提示用户
        console.log(`${pluginName}: handleExportFavorites - 成功导出 ${sortedFavorites.length} 条收藏到 ${filename}`);
        toastr.success(`已成功导出 ${sortedFavorites.length} 条收藏到文件 "${filename}"`, '导出完成');

    } catch (error) {
        // 如果导出过程中发生任何错误
        console.error(`${pluginName}: handleExportFavorites - 导出过程中发生错误:`, error);
        toastr.error(`导出收藏时发生错误: ${error.message || '未知错误'}`); //向用户显示错误信息
    }
}
// --- 导出函数结束 ---


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
                max-height: 70vh; /* 限制最大高度 */
                overflow-y: auto;   /* 超出时显示滚动条 */
                 /* overflow-y: visible; */ /* 旧代码，可能导致内容溢出弹窗 */
            }

            /* --- 新增/修改：收藏夹弹窗头部样式 --- */
            #favorites-popup-content .favorites-header {
                display: flex;              /* 使用 Flexbox 布局 */
                justify-content: space-between; /* 标题居左，按钮容器居右 */
                align-items: center;        /* 垂直居中对齐 */
                padding: 0 10px;            /* 左右内边距 */
                flex-wrap: wrap;            /* 如果空间不足则换行 */
                gap: 10px;                  /* 标题和按钮容器之间的间距 */
                margin-bottom: 10px;        /* 与下方分隔线的间距 */
            }
            #favorites-popup-content .favorites-header h3 {
                 margin: 0;                 /* 移除默认的 margin */
                 flex-grow: 1;             /* 让标题占据多余空间 */
                 text-align: left;         /* 标题左对齐 */
                 white-space: nowrap;      /* 防止标题换行 */
                 overflow: hidden;         /* 隐藏溢出部分 */
                 text-overflow: ellipsis;  /* 用省略号表示溢出 */
                 min-width: 0;             /* 配合 flex-grow 防止溢出 */
            }
            #favorites-popup-content .favorites-header .favorites-header-buttons {
                 display: flex;             /* 让按钮水平排列 */
                 gap: 8px;                  /* 按钮之间的间距 */
                 flex-shrink: 0;           /* 防止按钮容器在空间紧张时被压缩 */
            }
            /* --- 头部样式结束 --- */

            #favorites-popup-content .favorites-divider {
                height: 1px;
                background-color: var(--SmartThemeBorderColor, #ccc); /* 使用主题变量或默认灰色 */
                margin: 10px 0;
            }
            #favorites-popup-content .favorites-list {
                margin: 10px 0;
            }
            #favorites-popup-content .favorites-empty {
                text-align: center;
                color: var(--SmartThemeFgMuted, #888); /* 使用主题变量或默认灰色 */
                padding: 20px;
            }
            #favorites-popup-content .favorite-item {
                border-radius: 8px;
                margin-bottom: 10px;
                padding: 10px;
                background-color: rgba(0, 0, 0, 0.2); /* 半透明黑色背景 */
                position: relative;
                border: 1px solid var(--SmartThemeBorderColor, #444); /* 添加边框 */
            }
            #favorites-popup-content .fav-meta {
                font-size: 0.8em;
                color: #aaa;
                text-align: right;      /* 确保文本在自己的空间内右对齐 */
                margin-bottom: 5px;
                margin-top: 0;
                flex-grow: 1;           /* 允许元信息占据多余空间 (有助于右对齐) - 可选 */
                min-width: 0;           /* 与 flex-grow:1 配合，防止溢出问题 - 可选 */
                 white-space: nowrap;      /* 防止发送者名称换行 */
                 overflow: hidden;         /* 隐藏溢出 */
                 text-overflow: ellipsis;  /* 省略号 */
            }
            #favorites-popup-content .fav-note {
                background-color: rgba(255, 255, 0, 0.1);
                padding: 5px 8px;
                border-left: 3px solid #ffcc00;
                margin-bottom: 8px; /* 增加与下方内容的间距 */
                font-style: italic;
                text-align: left;
                font-size: 0.9em; /* 可以让备注字号小一点 */
                word-wrap: break-word; /* 允许长备注换行 */
            }
            #favorites-popup-content .fav-preview {
                margin-bottom: 8px; /* 增加与下方动作按钮的间距 */
                line-height: 1.4;
                max-height: 200px; /* 限制最大高度 */
                overflow-y: auto;  /* 超出时显示滚动条 */
                word-wrap: break-word;
                white-space: pre-wrap; /* 保留格式并允许换行 */
                text-align: left;
                background-color: rgba(255, 255, 255, 0.05); /* 微弱背景区分 */
                padding: 5px 8px; /* 内边距 */
                border-radius: 4px; /* 轻微圆角 */
            }
            #favorites-popup-content .fav-preview.deleted {
                color: #ff3a3a;
                font-style: italic;
                background-color: rgba(255, 58, 58, 0.1); /* 红色背景提示 */
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
                font-size: 1.1em; /* 稍微增大图标 */
                vertical-align: middle; /* 图标垂直居中 */
            }
            #favorites-popup-content .fav-actions i:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }
            #favorites-popup-content .fav-actions .fa-pencil {
                color: var(--SmartThemeLinkColor, #3a87ff); /* 使用主题链接颜色或默认蓝色 */
            }
            #favorites-popup-content .fav-actions .fa-trash {
                color: var(--SmartThemeDangerColor, #ff3a3a); /* 使用主题危险颜色或默认红色 */
            }
            .favorite-toggle-icon {
                cursor: pointer;
            }
            .favorite-toggle-icon i.fa-regular {
                color: var(--SmartThemeIconColorMuted, #999); /* 使用主题变量或默认灰色 */
            }
            .favorite-toggle-icon i.fa-solid {
                color: var(--SmartThemeAccentColor, #ffcc00); /* 使用主题强调色或默认黄色 */
            }
            #favorites-popup-content .favorites-pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-top: 15px; /* 增加与列表的间距 */
                gap: 10px;
            }
            #favorites-popup-content .favorites-footer {
                display: flex;
                justify-content: space-between; /* 如果有多个按钮，两端对齐 */
                align-items: center;
                margin-top: 15px;
                padding-top: 10px;
                border-top: 1px solid var(--SmartThemeBorderColor, #444); /* 顶部加分隔线 */
            }

            /* 预览中的代码块样式 */
            #favorites-popup-content .fav-preview pre {
                display: block;
                width: 100%;
                box-sizing: border-box;
                overflow-x: auto;
                white-space: pre; /* 代码块通常不自动换行 */
                background-color: rgba(0, 0, 0, 0.3); /* 深色背景 */
                padding: 10px;
                border-radius: 4px;
                margin-top: 5px; /* 与上方文本的间距 */
                margin-bottom: 5px;
                font-family: monospace; /* 使用等宽字体 */
            }

            /* 弹窗内的通用按钮样式 */
            #favorites-popup-content .menu_button {
                width: auto;
                padding: 5px 10px; /* 调整内边距 */
                font-size: 0.9em; /* 按钮字号稍小 */
            }

            #favorites-popup-content .fav-send-date {
                font-size: 0.75em;
                color: #bbb;
                text-align: left;
                /* font-style: italic; */ /* 移除斜体，让时间更清晰 */
                display: inline-flex;
                flex-shrink: 0;
                align-items: baseline;
                white-space: nowrap; /* 防止日期换行 */
            }

            #favorites-popup-content .fav-send-date .fav-mesid {
                margin-left: 8px;
                color: #999;
                font-size: 0.9em;
                /* font-style: italic; */ /* 移除斜体 */
                 /* background-color: rgba(255, 255, 255, 0.05); */
                 /* padding: 1px 4px; */
                 /* border-radius: 3px; */
            }

            #favorites-popup-content .fav-header-info {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                margin-bottom: 8px;
                flex-wrap: wrap; /* 允许换行 */
                gap: 10px; /* 日期和发送者之间的间距 */
            }

            /* --- 新增：返回预览按钮样式 --- */
            #${returnButtonId} {
                display: block; /* 块级元素，占据一行 */
                width: fit-content; /* 宽度自适应内容 */
                margin: 15px auto; /* 上下边距15px，左右自动居中 */
                padding: 8px 15px;
                background-color: var(--SmartThemeBtnBg);
                color: var(--SmartThemeBtnFg);
                border: 1px solid var(--SmartThemeBtnBorder);
                border-radius: 5px;
                cursor: pointer; /* 添加手型光标 */
                text-align: center;
            }
            #${returnButtonId}:hover {
                 background-color: var(--SmartThemeBtnBgHover);
                 color: var(--SmartThemeBtnFgHover);
                 border-color: var(--SmartThemeBtnBorderHover); /* 悬停时边框也变化 */
            }
        `;
        document.head.appendChild(styleElement);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);
            $('#favorites_button').on('click', () => {
                showFavoritesPopup(); // 点击图标按钮打开收藏夹弹窗
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings to extension settings (如果需要设置界面)
        // try {
        //     const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
        //     $('#extensions_settings').append(settingsHtml);
        //     console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
        // } catch (error) {
        //     console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        // }

        // Set up event delegation for favorite toggle icon
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for current chat on load
        ensureFavoritesArrayExists();

        // Initial UI setup
        addFavoriteIconsToMessages(); // 为现有消息添加图标（如果缺少）
        refreshFavoriteIconsInView(); // 根据元数据更新图标状态
        restoreNormalChatUI(); // 确保加载时 UI 正常 (无预览状态)

        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, (newChatId) => {
            console.log(`${pluginName}: 聊天已更改，新 Chat ID: ${newChatId}`);

            // 1. 处理从活动预览模式切换离开的逻辑 (恢复UI)
            handleChatChangeForPreview(newChatId);

            // 2. 确保新聊天的收藏夹元数据数组存在
            ensureFavoritesArrayExists();

            // 3. 新增：检查是否手动切换回了 *曾经* 的预览聊天
            if (!previewState.isActive) {
                const previewChatsMap = extension_settings[pluginName]?.previewChats;
                if (previewChatsMap && Object.keys(previewChatsMap).length > 0) {
                    const knownPreviewChatIds = Object.values(previewChatsMap);
                    if (knownPreviewChatIds.includes(newChatId)) {
                        console.log(`${pluginName}: 检测到用户手动切换回之前的预览聊天 (${newChatId})，准备显示提示。`);
                        toastr.info(
                            `注意：当前聊天 "${newChatId}" 是收藏预览聊天。此聊天仅用于预览收藏消息，内容会在每次<预览>前清空。请勿在此聊天中发送消息。`, // 修改提示文本
                            '进入收藏预览聊天',
                            {
                                timeOut: 8000, // 增加显示时间
                                extendedTimeOut: 4000,
                                preventDuplicates: true,
                                positionClass: 'toast-top-center'
                            }
                        );
                    }
                }
            } else {
                console.log(`${pluginName}: 当前处于活动预览状态 (isActive: true)，跳过“手动切换回预览聊天”的检查。`);
            }

            // 4. 延迟刷新聊天界面中的收藏图标状态
            setTimeout(() => {
                console.log(`${pluginName}: CHAT_CHANGED 后延迟执行图标刷新 (Chat ID: ${newChatId})`);
                addFavoriteIconsToMessages(); // 确保新加载的消息（如果有）有图标结构
                refreshFavoriteIconsInView(); // 根据当前聊天的元数据更新图标的 solid/regular 状态
            }, 150); // 150ms 延迟，给 DOM 更新留出时间
        });

        // 监听消息删除事件
        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIndex) => {
            const deletedMessageId = String(deletedMessageIndex);
            console.log(`${pluginName}: 检测到消息删除事件, 索引: ${deletedMessageIndex}`);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;
            // 查找并移除引用了该消息 ID 的收藏项
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);
            if (favIndex !== -1) {
                console.log(`${pluginName}: 消息索引 ${deletedMessageIndex} (ID: ${deletedMessageId}) 被删除，移除对应的收藏项`);
                chatMetadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced(); // 保存更改
                // 如果收藏夹弹窗是打开的，刷新它
                if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.hasAttribute('open')) {
                    currentPage = 1; // 重置到第一页
                    updateFavoritesPopup(); // 更新弹窗内容
                }
                 // 同时也要刷新当前聊天视图中的图标（可能被删除的消息就在视图里）
                 setTimeout(refreshFavoriteIconsInView, 100);
            } else {
                 console.log(`${pluginName}: 未找到引用已删除消息索引 ${deletedMessageIndex} (ID: ${deletedMessageId}) 的收藏项`);
            }
        });

        // 监听新消息到达或发送
        const handleNewMessage = () => {
             // 延迟添加图标结构，确保 DOM 更新完成
             setTimeout(() => {
                 addFavoriteIconsToMessages();
                 // 新消息默认不收藏，通常不需要 refreshFavoriteIconsInView
             }, 150);
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);

        // 监听消息滑动或更新
        const handleMessageUpdateOrSwipe = () => {
             // 延迟刷新图标状态，因为滑动或更新可能改变了视图中的消息
             setTimeout(refreshFavoriteIconsInView, 150);
        };
        eventSource.on(event_types.MESSAGE_SWIPED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MESSAGE_UPDATED, handleMessageUpdateOrSwipe);

        // 监听加载更多历史消息
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: 加载了更多消息，更新图标...`);
             // 延迟添加结构并刷新状态
             setTimeout(() => {
                 addFavoriteIconsToMessages();
                 refreshFavoriteIconsInView();
             }, 150);
        });

        // --- MutationObserver (监视聊天 DOM 变化) ---
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        // 检查新增节点本身是否是消息，或者其子节点中是否包含消息
                        if (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                            needsIconAddition = true;
                            break; // 找到一个就够了
                        }
                    }
                }
                if (needsIconAddition) break; // 如果已确认需要，则停止检查当前批次的 mutation
            }
            if (needsIconAddition) {
                 // 监听到 DOM 变化（可能有新消息渲染），延迟添加图标结构
                 // 使用 requestAnimationFrame 或稍长延迟确保渲染完成
                 // setTimeout(addFavoriteIconsToMessages, 200);
                 requestAnimationFrame(addFavoriteIconsToMessages);
            }
        });
        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true, // 监视直接子节点的添加/删除
                subtree: true    // 监视所有后代节点的添加/删除
            });
             console.log(`${pluginName}: MutationObserver 已启动，监视 #chat 的变化`);
        } else {
             console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`);
        }

        console.log(`${pluginName}: 插件加载完成! (包含导出和预览功能)`); // 更新日志
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
