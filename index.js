// 从核心脚本导入
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

// 从扩展助手脚本导入
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced
} from '../../../extensions.js';

// 从 Popup 工具脚本导入
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// 为群组聊天导入
import { openGroupChat } from "../../../group-chats.js";

// 从通用工具脚本导入
import {
    uuidv4,
    timestampToMoment, // <--- 确保 timestampToMoment 已导入，导出功能需要它
    waitUntilCondition,
} from '../../../utils.js';


// 定义插件文件夹名称 (对保持一致性很重要)
const pluginName = 'star'; // 保持文件夹名称一致

// 初始化插件设置 (如果它们不存在)
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}

// --- 新增：html2canvas 加载状态 ---
let html2canvasLoaded = false;
let H2C_LIB_PATH = 'scripts/extensions/third-party/star/lib/html2canvas.min.js'; // 确保这个路径正确！

// --- 新增：预览状态管理 ---
const previewState = {
    isActive: false,
    originalContext: null, // { characterId: string|null, groupId: string|null, chatId: string }
    previewChatId: null,   // 预览聊天的 ID
};
const returnButtonId = 'favorites-return-button'; // 返回按钮的 ID
const screenshotAllPreviewButtonId = 'favorites-preview-screenshot-all-btn'; // 新增：截取所有预览消息按钮 ID

// 定义收藏切换图标的 HTML
const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// 存储对收藏夹弹窗的引用
let favoritesPopup = null;
// 当前分页状态
let currentPage = 1;
const itemsPerPage = 5;

// --- 新增：动态加载脚本的辅助函数 ---
function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            console.log(`${pluginName}: Script ${url} already loaded.`);
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// --- 新增：截图并下载的辅助函数 ---
/**
 * --- 新增：截图并下载的辅助函数 ---
 * @param {HTMLElement} element - 要截图的 DOM 元素
 * @param {string} filename - 下载文件的名称
 * @param {object} options - 传递给 html2canvas 的额外选项
 * @returns {Promise<boolean>} - 返回截图是否成功
 */
// --- 新增：截图并下载的辅助函数 ---
/**
 * --- 新增：截图并下载的辅助函数 ---
 * @param {HTMLElement} element - 要截图的 DOM 元素
 * @param {string} filename - 下载文件的名称
 * @param {object} options - 传递给 html2canvas 的额外选项
 * @returns {Promise<boolean>} - 返回截图是否成功
 */
async function captureAndDownload(element, filename, options = {}) {
    // 检查 html2canvas 是否已加载
    if (!html2canvasLoaded || typeof html2canvas === 'undefined') {
        toastr.error('截图库 (html2canvas) 未加载或加载失败，无法截图。');
        console.error(`${pluginName}: html2canvas is not loaded. Cannot capture screenshot.`);
        return false;
    }
    try {
        // 显示加载提示
        toastr.info(`正在生成截图: ${filename}...`, '请稍候', { timeOut: 3000, extendedTimeOut: 2000 });

        // --- 基础默认选项 ---
        let defaultOptions = {
            backgroundColor: null, // 优先让html2canvas自动检测或使用元素背景
            useCORS: true,         // 处理可能的跨域图片（如头像）
            scale: window.devicePixelRatio || 1, // 使用设备像素比提高清晰度
            logging: true,         // 打开日志进行调试
            // 移除默认的 scrollX/Y 和 x/y，根据目标元素类型设置
        };

        // --- 针对特定元素的选项覆盖 ---
        if (element.classList.contains('favorite-item')) {
            // --- 截取收藏弹窗中的单个收藏项 (.favorite-item) ---
            console.log(`${pluginName}: Capturing a .favorite-item element.`);
            
            // 获取元素自身的计算背景色，如果透明则回退
            let bgColor = getComputedStyle(element).getPropertyValue('background-color').trim();
            if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
                 // 尝试获取父级弹窗的背景色 (通常是 <dialog> 或其容器)
                 const popupContainer = element.closest('.popup, dialog'); // 更通用的选择器
                 if (popupContainer) {
                    bgColor = getComputedStyle(popupContainer).getPropertyValue('background-color').trim();
                 }
                 // 如果弹窗也是透明，则使用更通用的备用色
                 if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
                    // 尝试从 :root 或 body 获取 --SmartThemeBodyBgDarker CSS 变量
                    let bodyBgColor = getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBodyBgDarker').trim() ||
                                      getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyBgDarker').trim();
                    if (bodyBgColor) {
                        bgColor = bodyBgColor;
                    } else {
                        bgColor = '#2a2a2e'; // 最终备用色
                    }
                 }
            }
            defaultOptions.backgroundColor = bgColor;

            // **调整点 1：对于单个元素截图，不再手动设置 x, y, width, height 选项。**
            // 让 html2canvas 直接渲染传入的 `element`，它会尝试捕获该元素的全部内容。
            // 这些属性之前是基于 getBoundingClientRect()，这对于有 transform 的弹窗内元素可能不准确。
            // (由于 defaultOptions 中未预设这些，所以无需 delete，仅作说明。但要确保外部 options 不会覆盖)
            if (options.x !== undefined) delete options.x;
            if (options.y !== undefined) delete options.y;
            if (options.width !== undefined) delete options.width;
            if (options.height !== undefined) delete options.height;


        } else if (element.id === 'chat') {
            // --- 截取 #chat (长截图) ---
            console.log(`${pluginName}: Capturing #chat element (attempting full scroll content).`);

            // 背景色处理
            let chatBgColor = getComputedStyle(element).getPropertyValue('background-color').trim();
            if (!chatBgColor || chatBgColor === 'rgba(0, 0, 0, 0)' || chatBgColor === 'transparent') {
                 // 尝试从 :root 或 body 获取 --main-bg-color CSS 变量
                let mainBgColor = getComputedStyle(document.documentElement).getPropertyValue('--main-bg-color').trim() ||
                                  getComputedStyle(document.body).getPropertyValue('--main-bg-color').trim();
                if (mainBgColor) {
                    chatBgColor = mainBgColor;
                } else {
                    chatBgColor = '#1e1e1e'; // 主题变量或备用色
                }
            }
            defaultOptions.backgroundColor = chatBgColor;

            // **调整点 2：长截图的关键选项**
            // 确保传入的 element 确实是可滚动的容器本身
            defaultOptions.width = element.scrollWidth;           // 画布宽度设为元素内容的总宽度
            defaultOptions.height = element.scrollHeight;          // 画布高度设为元素内容的总高度
            defaultOptions.windowWidth = element.scrollWidth;      // 渲染窗口宽度设为元素内容总宽度
            defaultOptions.windowHeight = element.scrollHeight;     // 渲染窗口高度设为元素内容总高度
            
            // 当直接截取 element 时，x 和 y 通常相对于 element 本身的左上角，所以是 0。
            defaultOptions.x = 0;
            defaultOptions.y = 0;
            
            // 元素自身的滚动位置。对于“完整长截图”，通常是从 (0,0) 开始截取。
            defaultOptions.scrollX = 0; 
            defaultOptions.scrollY = 0;

            // --- 重要提示：关于长截图 ---
            // 为了让 html2canvas 正确捕获 #chat 的全部滚动内容，
            // **调用此函数前**，你需要在调用方执行以下操作：
            //
            // 示例 (在 screenshotAllButton.on('click', ...) 回调中):
            //
            // const chatElement = document.getElementById('chat');
            // if (chatElement) {
            //     const originalStyles = {
            //         height: chatElement.style.height,
            //         overflow: chatElement.style.overflow, // 或 overflowY, overflowX
            //         // 可能还需要保存父容器的样式，如果 #chat 的尺寸受父容器的 overflow:hidden 限制
            //     };
            //
            //     // 1. 展开元素以显示所有内容
            //     chatElement.style.height = chatElement.scrollHeight + 'px';
            //     chatElement.style.overflow = 'visible'; // 重要！确保内容不会被裁剪
            //
            //     // (可选，但推荐) 如果 #chat 的父容器有 overflow:hidden，也需要临时修改
            //     // const parent = chatElement.parentElement;
            //     // if (parent && getComputedStyle(parent).overflow === 'hidden') {
            //     //    originalStyles.parentOverflow = parent.style.overflow;
            //     //    parent.style.overflow = 'visible';
            //     // }
            //
            //     // 等待一帧，确保样式应用和浏览器重绘 (非常重要)
            //     await new Promise(resolve => requestAnimationFrame(resolve)); 
            //
            //     // 2. 调用截图函数
            //     const success = await captureAndDownload(chatElement, filename, { /* h2cOptions */ });
            //
            //     // 3. 恢复原始样式 (无论成功与否)
            //     chatElement.style.height = originalStyles.height;
            //     chatElement.style.overflow = originalStyles.overflow;
            //     // if (originalStyles.parentOverflow && parent) {
            //     //    parent.style.overflow = originalStyles.parentOverflow;
            //     // }
            // }
            //
            // 这个 CSS 修改和恢复的逻辑应该在 captureAndDownload 的调用方处理，
            // 以保持此函数的通用性，并确保样式正确恢复。

        } else {
            // 如果不是 .favorite-item 或 #chat，执行默认截图或报错
             console.warn(`[${pluginName}] captureAndDownload called on unsupported element:`, element);
             // 对于未知元素，尝试使用其getBoundingClientRect来定义截图区域
             // 注意：这对于有 transform 的元素可能仍然不准确
             const rect = element.getBoundingClientRect();
             const fallbackOptions = {
                 ...defaultOptions, // 继承 scale, useCORS 等
                 x: rect.left,
                 y: rect.top,
                 width: rect.width,
                 height: rect.height,
                 // 合并外部传入的 options，外部 options 优先级更高
                 ...options
             };
             // 直接使用合并后的 fallbackOptions
             const h2cOptions = fallbackOptions;
             console.log(`[${pluginName}] html2canvas options for fallback "${filename}":`, h2cOptions, "Element:", element);
             const fallbackCanvas = await html2canvas(element, h2cOptions);
             
             // 下载逻辑 (与下方主逻辑相同)
             const dataUrl = fallbackCanvas.toDataURL('image/png');
             if (!dataUrl || dataUrl === 'data:,') {
                  throw new Error('未能从画布生成数据URL (fallback)。');
             }
             const link = document.createElement('a');
             link.href = dataUrl;
             link.download = filename;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
             URL.revokeObjectURL(link.href);
             toastr.success(`截图已保存 (fallback): ${filename}`, '保存成功');
             return true;
        }
        // --- 选项设置结束 ---


        const h2cOptions = { ...defaultOptions, ...options }; // 合并基础选项和外部传入的特定选项
        console.log(`[${pluginName}] html2canvas options for "${filename}":`, h2cOptions, "Element rect:", element.getBoundingClientRect(), "Element:", element);

        // 执行截图
        const canvas = await html2canvas(element, h2cOptions);
        console.log(`[${pluginName}] Canvas created. Size: ${canvas.width}x${canvas.height}`); 

        // --- 裁剪掉可能多余的底部缓冲区 (如果需要) ---
        // (保持原有裁剪逻辑不变)
        // if (element.id === 'chat' && buffer > 0 && canvas.height > element.scrollHeight * defaultOptions.scale) {
        //     ...
        // }


        // --- 下载逻辑 ---
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,') {
             throw new Error('未能从画布生成数据URL。画布可能为空或过大。(Failed to generate data URL from canvas. Canvas might be empty or too large.)');
        }
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // 释放对象 URL 内存

        // 显示成功提示
        toastr.success(`截图已保存: ${filename}`, '保存成功', { timeOut: 5000 });
        return true; // 返回成功状态

    } catch (error) {
        // --- 修改后的 Catch 块 ---
        console.error(`${pluginName}: Screenshot failed for ${filename}:`, error); // 打印原始错误对象

        let errorMessage = '未知错误 (Unknown error)';
        let errorType = 'Unknown';

        if (error instanceof Error) {
            errorMessage = error.message;
            errorType = error.name;
            // 尝试识别常见错误类型
            if (errorMessage.includes('Maximum call stack size exceeded')) {
                errorMessage = '页面过于复杂或内容过多，截图失败';
            } else if (errorMessage.includes('SecurityError') && errorMessage.includes('tainted')) {
                errorMessage = '页面包含跨域内容，无法安全截图 (Tainted canvas)';
            } else if (errorMessage.includes('IndexSizeError') || errorMessage.includes('dimensions')) {
                 errorMessage = '计算截图尺寸或坐标时出错';
            }
        } else if (error instanceof Event) {
            // 如果捕获到的是 Event 对象
            errorType = 'Event';
            errorMessage = `捕获到意外事件: ${error.type}`;
            console.error(`[${pluginName}] Caught Event details:`, {
                type: error.type,
                target: error.target, // 可能为 null
                currentTarget: error.currentTarget, // 可能为 null
                bubbles: error.bubbles,
                cancelable: error.cancelable,
                // @ts-ignore // error 对象可能不存在于所有 Event 类型上
                error: error.error, // 如果是 ErrorEvent
                // @ts-ignore
                message: error.message // 某些自定义事件可能有
            });
            // 如果是错误事件，尝试获取错误消息
            // @ts-ignore
            if (error.error instanceof Error) {
                 // @ts-ignore
                 errorMessage += ` - 事件错误消息: ${error.error.message}`;
            // @ts-ignore
            } else if (typeof error.message === 'string') { // 有些事件可能有 message 属性
                 // @ts-ignore
                 errorMessage += ` - 事件消息: ${error.message}`;
            }
        } else {
            // 其他未知类型的错误
            try {
                errorMessage = String(error); // 尝试转换为字符串
                errorType = typeof error;
            } catch (e) {
                errorMessage = '无法识别的错误对象';
            }
        }

        console.error(`[${pluginName}] Identified Error Type: ${errorType}, Message: ${errorMessage}`);
        toastr.error(`截图失败: ${errorMessage}`, '操作失败');
        // --- Catch 块修改结束 ---
        return false;
    } finally {
        // --- 注意：这里的恢复逻辑仅对移动DOM的策略有效 ---
        // 对于 #chat 的 CSS 恢复，应该在调用方进行 (如注释中所述)
        console.log(`${pluginName}: Screenshot process finished for ${filename}.`);
    }
}

// --- 新增：生成安全的文件名 ---
function generateSafeFilename(baseName, type, identifier, extension = 'png') {
    const dateStr = timestampToMoment(Date.now()).format('YYYYMMDDHHmmss');
    let safeBase = String(baseName).replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
    let safeId = String(identifier).replace(/[\\/:*?"<>|]/g, '_');
    return `${safeBase}_${type}_${safeId}_${dateStr}.${extension}`;
}


/**
 * 确保通过 getContext() 访问的当前聊天元数据中存在收藏夹数组
 * @returns {object | null} 如果可用且收藏夹数组已确保，则返回聊天元数据对象，否则返回 null。
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
 * 将收藏项添加到当前聊天元数据
 * @param {Object} messageInfo 有关被收藏消息的信息
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
 * 按 ID 删除收藏
 * @param {string} favoriteId 要删除的收藏的 ID
 * @returns {boolean} 如果成功则为 true，否则为 false
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
 * 按其引用的消息 ID 删除收藏
 * @param {string} messageId 消息 ID (来自 mesid 属性)
 * @returns {boolean} 如果成功则为 true，否则为 false
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
 * 更新收藏项的备注
 * @param {string} favoriteId 收藏的 ID
 * @param {string} note 新的备注文本
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
 * 处理点击星形图标时收藏状态的切换
 * @param {Event} event 点击事件
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
 * 将收藏切换图标添加到聊天中所有没有该图标的消息
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
 * 更新当前视图中的所有收藏图标以反映当前状态
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
 * 为弹窗渲染单个收藏项
 * @param {Object} favItem 要渲染的收藏项
 * @param {number} index 项目索引 (用于分页，相对于排序后的数组)
 * @returns {string} 收藏项的 HTML 字符串
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

    // --- 新增：截图按钮 ---
    const screenshotButtonHtml = html2canvasLoaded ?
        `<i class="fa-solid fa-camera favorite-screenshot-icon" title="截图此收藏"></i>` :
        `<i class="fa-solid fa-camera favorite-screenshot-icon-disabled" title="截图功能未加载"></i>`;

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
                ${screenshotButtonHtml} <!-- 新增截图按钮 -->
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * 使用当前数据更新收藏夹弹窗
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
 * 打开或更新收藏夹弹窗
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>', // 初始加载时的微调器
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

            // --- 修改: 事件监听逻辑，增加处理世界书导出菜单项和截图 ---
            $(favoritesPopup.content).on('click', async function(event) { // 添加 async
                console.log(`[${pluginName}] Popup content click detected. Target element:`, event.target);

                const target = $(event.target);
                const closestButton = target.closest('button');
                const closestMenuItem = target.closest('.favorites-export-item');
                const closestFavItemElement = target.closest('.favorite-item'); // 新增

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
                         if (currentPage > 1) {
                            currentPage--;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('pagination-next')) {
                        const chatMetadata = ensureFavoritesArrayExists();
                        const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                        const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                        if (currentPage < totalPages) {
                            currentPage++;
                            updateFavoritesPopup();
                        }
                    } else if (closestButton.hasClass('preview-favorites-btn')) {
                        handlePreviewButtonClick();
                        if (favoritesPopup) {
                            favoritesPopup.completeCancelled();
                            console.log(`${pluginName}: 点击预览按钮，关闭收藏夹弹窗 (使用 completeCancelled)。`);
                        }
                    } else if (closestButton.hasClass('clear-invalid')) {
                        handleClearInvalidFavorites();
                    }
                }
                // 处理图标点击
                else if (target.hasClass('fa-pencil')) {
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
                // --- 新增：处理收藏项截图按钮点击 ---
                else if (target.hasClass('favorite-screenshot-icon') && html2canvasLoaded && closestFavItemElement.length) {
                    const favId = closestFavItemElement.data('fav-id');
                    const msgId = closestFavItemElement.data('msg-id');
                    const currentContext = getContext();
                    const chatName = currentContext.characterId ? currentContext.name2 : (currentContext.groups?.find(g => g.id === currentContext.groupId)?.name || '群聊');
                    const filename = generateSafeFilename(chatName, 'FavMsg', msgId || favId);

                    target.removeClass('fa-camera').addClass('fa-spinner fa-spin'); // 显示加载状态
                    await captureAndDownload(closestFavItemElement.get(0), filename, {
                        backgroundColor: getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyBgDarker').trim() || '#2a2a2e',
                    });
                    target.removeClass('fa-spinner fa-spin').addClass('fa-camera'); // 恢复图标
                }
                else if (target.hasClass('favorite-screenshot-icon-disabled')) {
                    toastr.warning('截图库未加载，无法使用此功能。');
                }
                // --- 截图逻辑结束 ---
                else {
                    if (target.closest('.menu_button, .favorite-item, .pagination-prev, .pagination-next, .preview-favorites-btn, .favorites-export-dropdown, .fa-pencil, .fa-trash, .favorite-screenshot-icon').length === 0) {
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
 * 处理从弹窗中删除收藏项 (简化日志记录)
 * @param {string} favId 收藏 ID
 * @param {string} messageId 消息 ID (mesid 字符串)
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
 * 处理编辑收藏项的备注
 * @param {string} favId 收藏 ID
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
 * 清理无效的收藏项 (那些引用已删除/不存在消息的收藏项)
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
    console.log(`${pluginName}: setupPreviewUI - Setting up UI for preview chat ${targetPreviewChatId}`);
    previewState.isActive = true;
    previewState.previewChatId = targetPreviewChatId;

    $('#send_form').hide();
    console.log(`${pluginName}: setupPreviewUI - Hidden #send_form.`);

    // 移除旧按钮 (如果存在)
    $(`#${returnButtonId}`).remove();
    $(`#${screenshotAllPreviewButtonId}`).remove(); // 新增

    const returnButton = $('<button></button>')
        .attr('id', returnButtonId)
        .addClass('menu_button')
        .text('返回至原聊天')
        .attr('title', '点击返回到预览前的聊天')
        .on('click', triggerReturnNavigation);

    // --- 新增：截取所有预览消息按钮 ---
    const screenshotAllButton = $('<button></button>')
        .attr('id', screenshotAllPreviewButtonId)
        .addClass('menu_button')
        .text('截取所有预览消息')
        .attr('title', '截取当前预览中的所有消息');

    if (html2canvasLoaded) {
        screenshotAllButton.on('click', async () => {
            const chatElement = document.getElementById('chat');
            if (!chatElement) {
                toastr.error('无法找到聊天区域进行截图。');
                return;
            }
            if (!previewState.originalContext) {
                 toastr.error('无法获取原始聊天信息用于文件名。');
                 return;
            }

            const origContext = previewState.originalContext;
            // 使用原始上下文信息生成文件名
            const chatName = origContext.characterId ? (origContext.name2 || '角色')
                                          : (origContext.groupName || '群聊');

            const filename = generateSafeFilename(chatName, 'PreviewAll', 'AllMessages');

            screenshotAllButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 正在截取...');
            await captureAndDownload(chatElement, filename); // 调用截图函数
            screenshotAllButton.prop('disabled', false).text('截取所有预览消息');
        });
    } else {
        screenshotAllButton.prop('disabled', true).attr('title', '截图功能未加载');
    }
    // --- 截图按钮逻辑结束 ---

    // 将按钮添加到聊天区域之后，方便用户看到
    const buttonContainer = $('<div></div>').addClass('favorites-preview-controls').css({
        'display': 'flex',
        'justify-content': 'center',
        'align-items': 'center',
        'gap': '10px',
        'margin-top': '15px',
        'margin-bottom': '15px'
    });
    buttonContainer.append(screenshotAllButton).append(returnButton);
    $('#chat').after(buttonContainer);

    console.log(`${pluginName}: setupPreviewUI - Added return and screenshot all buttons.`);
}

// --- 恢复正常聊天UI ---
function restoreNormalChatUI() {
    console.log(`${pluginName}: restoreNormalChatUI - Restoring normal UI.`);
    $(`#${returnButtonId}`).parent('.favorites-preview-controls').remove(); // 移除整个容器
    $(`#${screenshotAllPreviewButtonId}`).remove(); // 也确保单独移除，以防万一
    $('#send_form').show();
    console.log(`${pluginName}: restoreNormalChatUI - Removed preview buttons and shown #send_form.`);
}

// --- 触发返回导航的函数 ---
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
        }
    } catch (error) {
        console.error(`${pluginName}: triggerReturnNavigation - 导航返回时出错:`, error);
        toastr.error(`返回原聊天时出错: ${error.message || '未知错误'}`);
    } finally { // 确保UI恢复和状态重置
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
    console.log(`${pluginName}: 预览按钮被点击 (包含UI修改和重命名)`);
    toastr.info('正在准备预览聊天...');

    const initialContext = getContext();
    previewState.originalContext = {
        characterId: initialContext.characterId,
        groupId: initialContext.groupId,
        chatId: initialContext.chatId,
        // 保存原始名称，用于截图文件名
        name2: initialContext.name2,
        groupName: initialContext.groups?.find(g => g.id === initialContext.groupId)?.name
    };
    previewState.isActive = false; // 将在此函数成功后设为 true
    previewState.previewChatId = null;
    restoreNormalChatUI(); // 清理可能存在的旧预览UI

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
                targetPreviewChatId = initialContext.chatId; // 已经是预览聊天了
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
            saveMetadataDebounced(); // 保存新的预览聊天ID映射
            needsRename = true;
        }

        // --- 步骤 2: 等待聊天切换/创建完成 ---
        const currentContextAfterSwitchAttempt = getContext();
        if (currentContextAfterSwitchAttempt.chatId !== targetPreviewChatId) {
            try {
                await new Promise((resolve, reject) => { // 使用 await 确保 targetPreviewChatId 被正确赋值
                     const timeout = setTimeout(() => {
                        eventSource.off(event_types.CHAT_CHANGED, listener);
                        reject(new Error(`Waiting for CHAT_CHANGED to ${targetPreviewChatId} timed out after 5 seconds`));
                    }, 5000);
                    const listener = (receivedChatId) => {
                        if (receivedChatId === targetPreviewChatId) {
                            clearTimeout(timeout);
                            eventSource.off(event_types.CHAT_CHANGED, listener);
                            requestAnimationFrame(() => resolve(receivedChatId)); // 确保 DOM 更新后再 resolve
                        }
                    };
                    eventSource.on(event_types.CHAT_CHANGED, listener);
                });
            } catch (error) {
                console.error(`${pluginName}: Error or timeout waiting for CHAT_CHANGED:`, error);
                toastr.error('切换到预览聊天时出错或超时，请重试');
                previewState.originalContext = null; // 重置状态
                return;
            }
        } else {
            // 即使 chatId 相同，也等待一帧确保UI同步
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        // --- 步骤 2.5: 重命名聊天 ---
        const contextForRename = getContext(); // 获取最新的上下文
        if (contextForRename.chatId === targetPreviewChatId && needsRename) {
            const oldFileName = contextForRename.chatId; // 通常是聊天文件名/ID
             if (!oldFileName || typeof oldFileName !== 'string') {
                 toastr.warning('无法获取当前聊天名称，跳过重命名。');
             } else {
                const previewPrefix = "[收藏预览] ";
                let currentChatName = contextForRename.chatName; // 这是显示名
                if (!currentChatName) { // 如果没有显示名，尝试从上下文推断
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
                } else if (typeof currentChatName !== 'string'){ // 兜底
                     newName = previewPrefix + '未命名预览';
                     currentChatName = '未命名预览'; // 更新 currentChatName 以进行比较
                }
                const finalNewName = typeof newName === 'string' ? newName.trim() : '';

                // 只有当名称有效且未被重命名过时才执行重命名
                if (finalNewName && typeof currentChatName === 'string' && !currentChatName.startsWith(previewPrefix)) {
                     try {
                        console.log(`${pluginName}: Renaming chat from "${oldFileName}" to display name "${finalNewName}"`);
                        await renameChat(oldFileName, finalNewName);

                        // 重命名后，chatId 可能会改变。需要获取新的 chatId。
                        const contextAfterRename = getContext();
                        targetPreviewChatId = contextAfterRename.chatId; // 更新 targetPreviewChatId

                        // 更新 previewChats 映射中的 ID
                        const currentPreviewKey = contextAfterRename.groupId ? `group_${contextAfterRename.groupId}` : `char_${contextAfterRename.characterId}`;
                        if (extension_settings[pluginName].previewChats && currentPreviewKey in extension_settings[pluginName].previewChats) {
                            extension_settings[pluginName].previewChats[currentPreviewKey] = targetPreviewChatId; // 使用新的 chatId
                            saveMetadataDebounced();
                        }
                         console.log(`${pluginName}: Chat renamed to "${finalNewName}", new targetPreviewChatId: ${targetPreviewChatId}`);
                    } catch(renameError) {
                        console.error(`${pluginName}: Error renaming preview chat:`, renameError);
                        toastr.error('重命名预览聊天失败，请检查控制台');
                        targetPreviewChatId = oldFileName; // 保持旧 ID
                    }
                } else { // 已经有前缀或名称无效
                     console.log(`${pluginName}: Chat rename skipped. currentChatName: "${currentChatName}", targetPreviewChatId: "${targetPreviewChatId}"`);
                     targetPreviewChatId = oldFileName; // 确保是原始文件名
                }
            }
        } else { // 上下文不匹配或不需要重命名
             targetPreviewChatId = contextForRename.chatId; // 使用当前上下文的 chatId
             console.log(`${pluginName}: Rename check passed or not needed. Target ID remains: ${targetPreviewChatId}`);
        }

        // --- 步骤 3: 清空当前聊天 ---
        clearChat();

        // --- 步骤 4: 等待聊天 DOM 清空 ---
        try {
            await waitUntilCondition(() => document.querySelectorAll('#chat .mes').length === 0, 2000, 50);
        } catch (error) {
            console.warn(`${pluginName}: Timeout waiting for chat to clear. Proceeding.`, error);
            toastr.warning('清空聊天时可能超时，继续尝试填充消息...');
        }

        // --- 步骤 4.5: 设置预览模式 UI ---
        // 再次确认我们处于正确的聊天中
        const contextBeforeFill = getContext();
        if (contextBeforeFill.chatId !== targetPreviewChatId) {
            toastr.error('无法确认预览聊天环境，操作中止。请重试。');
            console.error(`${pluginName}: Context mismatch before filling messages. Expected ${targetPreviewChatId}, got ${contextBeforeFill.chatId}`);
            previewState.originalContext = null;
            restoreNormalChatUI(); // 确保恢复UI
            return;
        }
        setupPreviewUI(targetPreviewChatId); // 设置UI，此时 isActive 变为 true

        // --- 步骤 5: 准备收藏消息 ---
        const messagesToFill = [];
        // 确保按 messageId (即原始索引) 排序
        const sortedFavoritesForFill = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));
        for (const favItem of sortedFavoritesForFill) {
            const messageIndex = parseInt(favItem.messageId, 10);
            let foundMessage = null;
            // 从原始聊天记录中查找
            if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < originalChat.length) {
                if (originalChat[messageIndex]) {
                    foundMessage = originalChat[messageIndex];
                }
            }
            if (foundMessage) {
                 // 创建消息的深拷贝
                 const messageCopy = JSON.parse(JSON.stringify(foundMessage));
                 // 确保 extra 和 swipes 存在
                 if (!messageCopy.extra) messageCopy.extra = {};
                 if (!messageCopy.extra.swipes) messageCopy.extra.swipes = [];
                 messagesToFill.push({ message: messageCopy, mesid: messageIndex }); // 保存原始 mesid 用于调试
            } else {
                console.warn(`${pluginName}: Warning: Favorite message with original mesid ${favItem.messageId} not found in original chat. Skipping.`);
            }
        }

        // --- 步骤 6: 批量填充消息 ---
        // 再次检查上下文
        const finalContextForFill = getContext();
        if (finalContextForFill.chatId !== targetPreviewChatId) {
             toastr.error('预览聊天环境发生意外变化，填充操作中止。请重试。');
             console.error(`${pluginName}: Context mismatch during message filling. Expected ${targetPreviewChatId}, got ${finalContextForFill.chatId}`);
             restoreNormalChatUI();
             previewState.isActive = false; // 确保状态重置
             previewState.originalContext = null;
             previewState.previewChatId = null;
             return;
        }

        let addedCount = 0;
        const BATCH_SIZE = 20; // 每批处理的消息数量
        for (let i = 0; i < messagesToFill.length; i += BATCH_SIZE) {
            const batch = messagesToFill.slice(i, i + BATCH_SIZE);
            const addPromises = batch.map(item => {
                return (async () => { // 确保每个 addOneMessage 都是异步的
                    try {
                        // 使用当前上下文的 addOneMessage
                        await finalContextForFill.addOneMessage(item.message, { scroll: false });
                        addedCount++;
                    } catch (error) {
                        console.error(`${pluginName}: Error adding message (original index=${item.mesid}):`, error);
                    }
                })();
            });
            await Promise.all(addPromises); // 等待当前批次完成
            // 在批次之间稍作停顿
            if (i + BATCH_SIZE < messagesToFill.length) {
                 await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
            }
        }

        // --- 步骤 7: 完成与最终处理 ---
        if (addedCount > 0) {
            $('#chat').scrollTop(0); // 滚动到聊天顶部
            toastr.success(`已在预览模式下显示 ${addedCount} 条收藏消息`);
        } else if (messagesToFill.length > 0) { // 有准备填充的消息但没有成功添加
             toastr.warning('准备了收藏消息，但未能成功添加到预览中。请检查控制台。');
        } else { // 收藏夹为空或所有收藏消息都无效
             toastr.info('收藏夹为空，已进入（空的）预览模式。点击下方按钮返回。');
        }

    } catch (error) {
        console.error(`${pluginName}: Error during preview generation:`, error);
        const errorMsg = (error instanceof Error && error.message) ? error.message : '请查看控制台获取详细信息';
        toastr.error(`创建预览时出错: ${errorMsg}`);
        restoreNormalChatUI(); // 确保在出错时恢复UI
        previewState.isActive = false;
        previewState.originalContext = null;
        previewState.previewChatId = null;
    }
}

// --- 处理聊天切换事件，用于在离开预览时恢复UI ---
function handleChatChangeForPreview(newChatId) {
    if (previewState.isActive) {
        // 如果切换到了非当前预览的聊天
        if (newChatId !== previewState.previewChatId) {
            console.log(`${pluginName}: Chat changed from preview ${previewState.previewChatId} to ${newChatId}. Restoring UI.`);
            restoreNormalChatUI();
            previewState.isActive = false;
            previewState.originalContext = null; // 清除原始上下文
            previewState.previewChatId = null;
        }
    }
}


/**
 * 处理将收藏的消息导出到文本文件 (TXT)
 */
async function handleExportFavorites() {
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
        const filename = generateSafeFilename(chatName, 'Favorites', 'TXTExport', 'txt');
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
 * 处理将收藏的消息导出到 JSONL 文件
 */
async function handleExportFavoritesJsonl() {
    console.log(`${pluginName}: handleExportFavoritesJsonl - 开始导出收藏 (JSONL, 带元数据行)`);
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || chatMetadata.favorites.length === 0) {
        toastr.warning('没有收藏的消息可以导出。'); return;
    }
    if (!context || !context.chat || !Array.isArray(context.chat)) {
        toastr.error('无法获取当前聊天记录以导出收藏。'); return;
    }

    const userName = context.userAlias || context.name1;
    const characterName = context.name2;

    if (!userName || !characterName || !context.chatMetadata) {
         toastr.error('无法获取完整的聊天元数据 (用户名/角色名/元数据对象) 以生成兼容格式。');
         console.error(`${pluginName}: handleExportFavoritesJsonl - Missing userName, characterName, or chatMetadata in context`, { userName, characterName, chatMetadata: context.chatMetadata });
         return;
    }

    toastr.info('正在准备导出收藏 (JSONL)...', '导出中');

    try {
        if (typeof timestampToMoment !== 'function') {
             throw new Error('timestampToMoment function is not available.');
        }

        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => {
             const idA = parseInt(a?.messageId, 10); const idB = parseInt(b?.messageId, 10);
             if (isNaN(idA) && isNaN(idB)) return 0; if (isNaN(idA)) return 1; if (isNaN(idB)) return -1;
             return idA - idB;
        });

        const exportMessageObjects = [];
        let exportedMessageCount = 0;

        for (let i = 0; i < sortedFavorites.length; i++) {
            const favItem = sortedFavorites[i];
            let messageIndex = NaN;
            if (favItem.messageId !== undefined && favItem.messageId !== null) {
                 messageIndex = parseInt(favItem.messageId, 10);
            }
             if (isNaN(messageIndex) || messageIndex < 0 || messageIndex >= context.chat.length) continue; // 添加边界检查

            const message = context.chat[messageIndex];

            if (message) {
                try {
                    const messageCopy = JSON.parse(JSON.stringify(message));
                    exportMessageObjects.push(messageCopy);
                    exportedMessageCount++;
                } catch (copyError) {
                     console.error(`[${pluginName}] JSONL Export - Error deep copying message index ${messageIndex}:`, copyError);
                     toastr.error(`处理消息 #${messageIndex} 出错。`);
                }
            }
        }

        if (exportedMessageCount === 0) {
            toastr.warning('未能找到任何可导出的收藏消息...'); return;
        }

        const metadataObject = {
            user_name: userName,
            character_name: characterName,
            chat_metadata: context.chatMetadata
        };

        let exportedJsonlText = '';
        try {
            const metadataLine = JSON.stringify(metadataObject);
            const messageLines = exportMessageObjects.map(obj => JSON.stringify(obj)).join('\n');
            exportedJsonlText = metadataLine + '\n' + messageLines + '\n'; // 添加尾部换行符
            console.log(`[${pluginName}] JSONL Export - JSONL text generated successfully (with metadata line).`);
        } catch (stringifyError) {
            console.error(`[${pluginName}] JSONL Export - Error stringifying objects:`, stringifyError);
            toastr.error('生成 JSONL 文件内容时出错。'); return;
        }

        const blob = new Blob([exportedJsonlText], { type: 'application/jsonlines;charset=utf-8' });
        const filename = generateSafeFilename(characterName, 'Favorites', 'JSONLExport', 'jsonl');

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        console.log(`${pluginName}: handleExportFavoritesJsonl - Success: Exported ${exportedMessageCount} messages (with metadata line) to ${filename}`);
        toastr.success(`已成功导出 ${exportedMessageCount} 条收藏消息到文件 "${filename}" (JSONL)`, '导出完成');

    } catch (error) {
        console.error(`${pluginName}: handleExportFavoritesJsonl - Error during export:`, error);
        toastr.error(`导出收藏 (JSONL) 时发生错误: ${error.message || '未知错误'}`);
    }
}

// --- 新增：处理收藏导出为 JSON 世界书格式的函数 ---
/**
 * 处理将收藏的消息导出到 SillyTavern 世界书 (JSON) 文件。
 */
async function handleExportFavoritesWorldbook() {
    console.log(`${pluginName}: handleExportFavoritesWorldbook - 开始导出收藏 (世界书 JSON)`);
    const context = getContext();
    const chatMetadata = ensureFavoritesArrayExists();

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

    toastr.info('正在准备导出收藏 (世界书 JSON)...', '导出中');

    try {
        if (typeof timestampToMoment !== 'function') {
            console.error(`${pluginName}: timestampToMoment function is not available.`);
            toastr.error('导出功能所需的时间格式化工具不可用。');
            return;
        }

        const sortedFavorites = [...chatMetadata.favorites].sort((a, b) => parseInt(a.messageId) - parseInt(b.messageId));

        const worldbookData = {
            entries: {}
        };
        let exportedEntryCount = 0;

        for (const favItem of sortedFavorites) {
            const messageIndex = parseInt(favItem.messageId, 10);
            const message = (!isNaN(messageIndex) && context.chat[messageIndex]) ? context.chat[messageIndex] : null;

            if (message) {
                exportedEntryCount++;

                const position = 4; // @ D0 对应的 position 固定为 4
                const roleValue = message.is_user ? 1 : 2; // 用户消息 role=1, AI消息 role=2
                const depthValue = 0; // 明确设置 depth 为 0

                const worldEntry = {
                    uid: messageIndex,
                    key: [],
                    keysecondary: [],
                    comment: `收藏消息 #${messageIndex} - ${message.name}`,
                    content: message.mes || "",
                    constant: true,
                    vectorized: false,
                    selective: false,
                    selectiveLogic: 0,
                    addMemo: true,
                    order: messageIndex,
                    position: position,
                    disable: false,
                    excludeRecursion: false,
                    preventRecursion: true,
                    delayUntilRecursion: false,
                    probability: 100,
                    useProbability: false,
                    depth: depthValue, // *** 修改：明确设置为 0 ***
                    group: "",
                    groupOverride: false,
                    groupWeight: 100,
                    scanDepth: null,
                    caseSensitive: null,
                    matchWholeWords: null,
                    useGroupScoring: null,
                    automationId: "",
                    role: roleValue, // *** 修改：配合 position=4，指定角色 1 (User) 或 2 (Assistant) ***
                    sticky: 0,
                    cooldown: 0,
                    delay: 0,
                    displayIndex: messageIndex
                };
                worldbookData.entries[messageIndex.toString()] = worldEntry;
            } else {
                console.warn(`${pluginName}: handleExportFavoritesWorldbook - 找不到索引为 ${favItem.messageId} 的原始消息，将跳过此条目的世界书导出。`);
            }
        }

        if (exportedEntryCount === 0) {
            toastr.warning('所有收藏项对应的原始消息均无法找到，无法生成世界书文件。');
            console.log(`${pluginName}: handleExportFavoritesWorldbook - 未找到有效的原始消息可导出。`);
            return;
        }

        const exportedJsonText = JSON.stringify(worldbookData, null, 2);
        const blob = new Blob([exportedJsonText], { type: 'application/json;charset=utf-8' });

        const chatName = context.characterId ? context.name2 : (context.groups?.find(g => g.id === context.groupId)?.name || '群聊');
        const filename = generateSafeFilename(chatName, 'FavWorldBook', 'JSONExport', 'json');

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        console.log(`${pluginName}: handleExportFavoritesWorldbook - 成功导出 ${exportedEntryCount} 条收藏消息到 ${filename} (世界书 JSON)`);
        toastr.success(`已成功导出 ${exportedEntryCount} 条收藏消息到文件 "${filename}" (世界书 JSON)`, '导出完成');

    } catch (error) {
        console.error(`${pluginName}: handleExportFavoritesWorldbook - 导出过程中发生错误:`, error);
        toastr.error(`导出收藏 (世界书 JSON) 时发生错误: ${error.message || '未知错误'}`);
    }
}
// --- 世界书导出函数结束 ---

/**
 * 插件的主要入口点
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // --- 新增：加载 html2canvas ---
        try {
            await loadScript(H2C_LIB_PATH); // 使用定义的路径
            html2canvasLoaded = true;
            console.log(`${pluginName}: html2canvas library loaded successfully from ${H2C_LIB_PATH}.`);
            toastr.success('截图功能库已加载。', 'Star 插件', {timeOut: 2000});
        } catch (error) {
            html2canvasLoaded = false;
            console.error(`${pluginName}: Failed to load html2canvas library from ${H2C_LIB_PATH}:`, error);
            toastr.error(`截图功能库 (html2canvas) 加载失败，相关功能将不可用。请检查路径 '${H2C_LIB_PATH}' 是否正确并清理浏览器缓存。`, 'Star 插件错误', {timeOut: 10000, extendedTimeOut: 5000});
        }
        // --- 加载结束 ---

        const styleElement = document.createElement('style');
        styleElement.innerHTML = `
            /* ... (大部分原有样式保持不变) ... */
            #favorites-popup-content { padding: 10px; max-height: 70vh; overflow-y: auto; }
            #favorites-popup-content .favorites-header { display: flex; justify-content: space-between; align-items: center; padding: 0 10px; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            #favorites-popup-content .favorites-header h3 { margin: 0; flex-grow: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
            #favorites-popup-content .favorites-header .favorites-header-buttons { display: flex; align-items: center; gap: 8px; flex-shrink: 0; position: relative; }

            .favorites-export-dropdown { position: relative; display: inline-block; }
            #export-favorites-trigger-btn {}
            #favorites-export-menu {
                display: none; position: absolute; top: 100%; left: 0;
                background-color: var(--SmartThemeBodyBgDarker, #2a2a2e); border: 1px solid var(--SmartThemeBorderColor, #444);
                border-radius: 4px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
                padding: 5px 0; margin: 2px 0 0 0;
                min-width: 150px;
                z-index: 10; list-style: none;
            }
            .favorites-export-item {
                padding: 8px 12px; cursor: pointer; color: var(--SmartThemeFg);
                font-size: 0.9em; white-space: nowrap;
            }
            .favorites-export-item:hover { background-color: var(--SmartThemeHoverBg, rgba(255, 255, 255, 0.1)); }

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
            #favorites-popup-content .fav-actions .favorite-screenshot-icon { color: var(--SmartThemeInfoColor, #4caeff); } /* 新增：截图图标颜色 */
            #favorites-popup-content .fav-actions .favorite-screenshot-icon-disabled { color: #777; cursor: not-allowed; } /* 新增：禁用的截图图标颜色 */
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
            .favorites-preview-controls { display: flex; justify-content: center; align-items: center; gap: 10px; margin: 15px auto; } /* 新增：预览控制按钮容器 */
            .favorites-preview-controls .menu_button { padding: 8px 15px; }
        `;
        document.head.appendChild(styleElement);

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

        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#extensions_settings').append(settingsHtml);
            console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        ensureFavoritesArrayExists();
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();
        restoreNormalChatUI(); // 确保初始状态是正常UI

        eventSource.on(event_types.CHAT_CHANGED, (newChatId) => {
            handleChatChangeForPreview(newChatId); // 这个应该在 ensureFavoritesArrayExists 之前，以正确重置预览状态
            ensureFavoritesArrayExists();
             if (!previewState.isActive) {
                const previewChatsMap = extension_settings[pluginName]?.previewChats;
                if (previewChatsMap && Object.values(previewChatsMap).includes(newChatId)) {
                     toastr.info(
                        `注意：当前聊天 "${newChatId}" 是收藏预览聊天。此聊天仅用于预览收藏消息，内容会在每次<预览>前清空。请勿在此聊天中发送消息。`,
                        '进入收藏预览聊天',
                        { timeOut: 8000, extendedTimeOut: 4000, preventDuplicates: true, positionClass: 'toast-top-center' }
                    );
                }
            }
            setTimeout(() => { // 延迟以确保聊天DOM已更新
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
                    currentPage = 1; // 重置到第一页
                    updateFavoritesPopup();
                }
                 setTimeout(refreshFavoriteIconsInView, 100); // 刷新聊天中的图标
            }
        });
        const handleNewMessage = () => { setTimeout(addFavoriteIconsToMessages, 150); };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        const handleMessageUpdateOrSwipe = () => { setTimeout(refreshFavoriteIconsInView, 150); };
        eventSource.on(event_types.MESSAGE_SWIPED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MESSAGE_UPDATED, handleMessageUpdateOrSwipe);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => { setTimeout(() => { addFavoriteIconsToMessages(); refreshFavoriteIconsInView(); }, 150); });

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

        console.log(`${pluginName}: 插件加载完成! (包含 TXT/JSONL/世界书 导出、截图和预览功能)`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
