/**
 * ============================================================
 * NodeSeek 签到增强版脚本
 * 作者: Roddy-D
 * 更新: 2026-03-16
 * 适配: Loon
 *
 * 功能:
 *   - http-request 类型: 抓取并持久化 NodeSeek Cookie
 *   - cron 类型: 定时执行签到，支持 TG 推送
 *
 * 参数说明 (由插件 [Argument] 通过 $argument 传入):
 *   ENABLE_CAPTURE     - 是否开启 Cookie 抓取 (true/false)
 *   NS_COOKIE          - 手动填写或自动抓取的 Cookie
 *   TG_BOT_TOKEN       - Telegram Bot Token（选填）
 *   TG_USER_ID         - Telegram User ID（选填）
 *   TG_NOTIFY_ONLY_FAIL - 仅失败时发送 TG 通知 (true/false)
 *   RANDOM_REWARD      - 随机奖励模式 (true/false)
 * ============================================================
 */

// ================= 全局参数解析区 =================
let checkinCookie = "";
let tgToken = "";
let tgUserId = "";
let notifyOnlyFail = false;
let enableCapture = true;   // 默认开启抓取
let useRandomReward = false; // 默认关闭随机奖励，走固定保底

const COOKIE_CACHE_KEY = "NS_COOKIE";        // 持久化存储 Cookie 的 Key
const COOKIE_EXPIRY_KEY = "NS_COOKIE_EXPIRY"; // 持久化存储 Cookie 过期时间的 Key

/**
 * Loon 插件参数解析
 *
 * Loon 中 [Argument] 声明的参数通过 $argument 对象传入，
 * 可直接用 $argument.参数名 读取，无需 JSON.parse。
 * switch 类型参数值为布尔值 true/false。
 * input 类型参数值为字符串。
 *
 * 与 Egern 的区别：
 *   Egern: argument 为 JSON 字符串，需要 JSON.parse 解析
 *   Loon:  argument 直接为对象，$argument.KEY 即可取值
 */
if (typeof $argument !== "undefined" && $argument) {
    // 过滤用户可能填写的无效占位符，如 "xxx"、"无"、"none"
    const isValid = (val) =>
        val !== undefined &&
        val !== null &&
        String(val).trim() !== "" &&
        String(val).trim() !== "xxx" &&
        String(val).trim() !== "无" &&
        String(val).trim().toLowerCase() !== "none";

    // Loon 中 $argument 为扁平对象，直接按 key 取值
    checkinCookie   = isValid($argument.NS_COOKIE)      ? String($argument.NS_COOKIE)      : "";
    tgToken         = isValid($argument.TG_BOT_TOKEN)   ? String($argument.TG_BOT_TOKEN)   : "";
    tgUserId        = isValid($argument.TG_USER_ID)     ? String($argument.TG_USER_ID)      : "";

    // Loon switch 类型直接返回布尔值，同时兼容字符串 "true"/"1"
    notifyOnlyFail = ($argument.TG_NOTIFY_ONLY_FAIL === true  ||
                      $argument.TG_NOTIFY_ONLY_FAIL === "true" ||
                      $argument.TG_NOTIFY_ONLY_FAIL === "1");

    if ($argument.ENABLE_CAPTURE !== undefined) {
        enableCapture = ($argument.ENABLE_CAPTURE === true  ||
                         $argument.ENABLE_CAPTURE === "true" ||
                         $argument.ENABLE_CAPTURE === "1");
    }

    if ($argument.RANDOM_REWARD !== undefined) {
        useRandomReward = ($argument.RANDOM_REWARD === true  ||
                           $argument.RANDOM_REWARD === "true" ||
                           $argument.RANDOM_REWARD === "1");
    }
}
// ====================================================

// 判断当前是否为 http-request 触发（即抓取 Cookie 流程）
const isGetHeader = typeof $request !== "undefined";

// 核心执行入口（异步 IIFE）
// 注意：Loon 中必须在所有逻辑执行完毕后调用 $done()，否则脚本引擎不会释放
(async () => {
    if (isGetHeader) {
        // http-request 类型：抓取 Cookie
        handleCaptureCookie();
    } else {
        // cron 类型：执行签到
        await handleCheckin();
    }
})().finally(() => {
    // 无论成功或失败，最终必须调用 $done({}) 释放资源
    // Loon 与 Egern 在此行为一致：$done({}) 表示继续原请求不做修改
    $done({});
});

// ============================================================
// 1. 抓取与持久化 Cookie 模块（http-request 触发）
// ============================================================
function handleCaptureCookie() {
    if (!enableCapture) {
        console.log("[NS签到] 抓取开关已关闭，跳过抓取流程。");
        return;
    }

    const allHeaders = $request.headers || {};

    // 忽略大小写取 Header（Loon 中 headers key 大小写可能不统一）
    const getHeader = (name) =>
        allHeaders[name] ??
        allHeaders[name.toLowerCase()] ??
        allHeaders[name.toUpperCase()];

    const cookie = getHeader("Cookie") || getHeader("cookie");

    if (!cookie) {
        console.log("[NS签到] ⚠️ 提取 Cookie 为空，完整 Header: " + JSON.stringify(allHeaders));
        // Loon $notification.post 签名：(title, subtitle, body, attach, delay)
        $notification.post("NS Cookie 获取失败", "", "未能从请求中找到 Cookie，请检查抓包逻辑后重新访问个人页面。");
    } else {
        // 持久化保存 Cookie
        // Loon $persistentStore.write(value, key) 返回 true/false
        const success = $persistentStore.write(cookie, COOKIE_CACHE_KEY);

        // 尝试从 smac 字段提取登录时间戳，计算 30 天后的过期时间
        let expiryDateStr = "未知";
        try {
            const smacMatch = cookie.match(/smac\s*=\s*(\d+)-/);
            if (smacMatch && smacMatch[1]) {
                const loginTimestamp = parseInt(smacMatch[1]) * 1000;
                const expiryTimestamp = loginTimestamp + 2592000000; // 30天 ms
                $persistentStore.write(String(expiryTimestamp), COOKIE_EXPIRY_KEY);
                expiryDateStr = formatDate(new Date(expiryTimestamp));
                console.log(`[NS签到] ✨ 自动计算并缓存 Session 过期时间: ${expiryDateStr}`);
            } else {
                console.log("[NS签到] ⚠️ 未能从 Cookie 中找到 smac 字段，无法预估过期时间。");
            }
        } catch (e) {
            console.log(`[NS签到] ⚠️ 计算过期时间出错: ${e.message}`);
        }

        if (success) {
            console.log("[NS签到] ✨ 成功保存 Cookie: " + cookie.substring(0, 30) + "...");
            $notification.post(
                "NS Cookie 获取成功", "",
                `Cookie 已保存。\nSession 预计过期：${expiryDateStr}\n请前往配置关闭【开启Cookie抓取】开关。`
            );
        } else {
            console.log("[NS签到] ❌ 保存 Cookie 失败");
            $notification.post("NS Cookie 保存失败", "", "写入存储失败，请检查存储权限。");
        }
    }
}

// ============================================================
// 2. 核心签到逻辑（cron 触发）
// ============================================================
async function handleCheckin() {
    // 先检查 Cookie 过期情况
    await checkCookieExpiry();

    // 优先级：插件参数传入 > 持久化存储
    let finalCookie = checkinCookie || $persistentStore.read(COOKIE_CACHE_KEY);

    if (!finalCookie) {
        const msg = "📉 未检测到 Cookie，请打开【开启Cookie抓取】开关并访问 NodeSeek 个人中心获取。";
        console.log("[NS签到] " + msg);
        $notification.post("NS签到结果", "❌ 无法签到", msg);
        await sendTgNotify("<b>❌ NodeSeek 签到失败</b>\n\n原因: <code>未检测到 Cookie，请检查配置！</code>");
        return;
    }

    // 根据随机奖励模式决定请求参数
    const url = `https://www.nodeseek.com/api/attendance?random=${useRandomReward}`;

    const headers = {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Origin":          "https://www.nodeseek.com",
        "Referer":         "https://www.nodeseek.com/board",
        "Accept":          "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Length":  "0",
        "Content-Type":    "application/json",
        "Cookie":          finalCookie
    };

    try {
        const resp = await fetchPromise({ url, method: "POST", headers, body: "" });
        await processResponse(resp);
    } catch (error) {
        const errStr = error?.error || error?.message || String(error);
        console.log(`[NS签到] 网络请求异常: ${errStr}`);
        $notification.post("NS签到结果", "⚠️ 网络请求异常", errStr);
        await sendTgNotify(`<b>⚠️ NodeSeek 签到网络异常</b>\n\n详情:\n<code>${escapeHtml(errStr)}</code>`);
    }
}

// ============================================================
// 3. 响应解析模块
// ============================================================
async function processResponse(resp) {
    const status  = resp.status;
    const body    = resp.body || "";
    let msg = "";

    try {
        const obj = JSON.parse(body);
        msg = obj?.message ? String(obj.message) : "";
        console.log(`[NS签到] JSON 解析 message: ${msg || "无"}`);
    } catch (e) {
        console.log(`[NS签到] 响应体非 JSON: ${body.substring(0, 150)}`);
    }

    const content = msg || body.substring(0, 150) || "服务端未返回有效内容";

    if (status >= 200 && status < 300) {
        const notifyStr = msg || "签到成功或已签过到";
        console.log(`[NS签到] ✅ 签到成功: ${notifyStr}`);
        $notification.post("NS活动签到", "✅ 签到成功", notifyStr);
        if (!notifyOnlyFail) {
            await sendTgNotify(`<b>🎉 NodeSeek 自动签到成功</b>\n\n状态码: ${status}\n返回信息：\n<code>${escapeHtml(notifyStr)}</code>`);
        }

    } else if (status === 403) {
        const notifyStr = `遭受 Cloudflare 或系统风控\n详情：${content}`;
        console.log(`[NS签到] ⚠️ 403 风控: ${notifyStr}`);
        $notification.post("NS活动签到", "⚠️ 403 风控拦截", notifyStr);
        await sendTgNotify(`<b>⚠️ NodeSeek 签到被风控(403)</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);

    } else if (status === 500) {
        const notifyStr = `服务器内部错误(500)\n内容：${content}`;
        console.log(`[NS签到] ❌ 500: ${notifyStr}`);
        $notification.post("NS活动签到", "❌ 服务器内部错误", notifyStr);
        await sendTgNotify(`<b>❌ NodeSeek 签到服务器错误(500)</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);

    } else {
        const notifyStr = `异常状态码: ${status}\n内容：${content}`;
        console.log(`[NS签到] ❓ 未知异常: ${notifyStr}`);
        $notification.post("NS活动签到", `❓ 未知异常 (${status})`, notifyStr);
        await sendTgNotify(`<b>❓ NodeSeek 签到未知异常 (${status})</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);
    }
}

// ============================================================
// 4. 辅助函数区
// ============================================================

/**
 * 将 $httpClient 回调式 API 封装为 Promise，统一异步调用方式。
 *
 * Loon 使用 $httpClient.get / $httpClient.post（回调风格），
 * 此处封装后可在 async/await 中统一使用，与 Egern 的 ctx.http 保持一致的调用体验。
 *
 * @param {Object} request - 请求参数 { url, method, headers, body }
 * @returns {Promise<{status, body, headers}>}
 */
function fetchPromise(request) {
    return new Promise((resolve, reject) => {
        const method = (request.method || "GET").toUpperCase();

        const options = {
            url:     request.url,
            headers: request.headers || {}
        };

        // body 仅在有值时传入，避免 GET 请求携带空 body
        if (request.body !== undefined && request.body !== null) {
            options.body = request.body;
        }

        // $httpClient 回调：(error, response, data)
        const callback = (error, response, data) => {
            if (error) {
                reject(error);
            } else {
                resolve({
                    status:  response.status || response.statusCode,
                    body:    data,
                    headers: response.headers
                });
            }
        };

        if (method === "POST") {
            $httpClient.post(options, callback);
        } else {
            $httpClient.get(options, callback);
        }
    });
}

/**
 * 转义 HTML 特殊字符，用于 TG HTML 模式推送时防止格式错乱。
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return unsafe;
    return unsafe
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&#039;");
}

/**
 * 格式化 Date 对象为 YYYY-MM-DD HH:mm 字符串。
 */
function formatDate(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${M}-${d} ${h}:${m}`;
}

/**
 * 检测持久化缓存的 Cookie 过期时间：
 * - 已过期：推送红色警告
 * - 不足 48 小时：推送黄色预警
 * - 正常：仅打印日志
 */
async function checkCookieExpiry() {
    const cachedExpiry = $persistentStore.read(COOKIE_EXPIRY_KEY);
    if (!cachedExpiry) {
        console.log("[NS签到] 未检测到缓存的过期时间，跳过过期检测。");
        return;
    }

    const expiryMs = parseInt(cachedExpiry);
    if (isNaN(expiryMs)) return;

    const now          = Date.now();
    const remainMs     = expiryMs - now;
    const remainHours  = remainMs / (1000 * 60 * 60);
    const expiryDateStr = formatDate(new Date(expiryMs));

    if (remainMs <= 0) {
        const warnMsg = `Cookie 已于 ${expiryDateStr} 过期，请重新登录 NodeSeek 并抓取 Cookie。`;
        console.log(`[NS签到] 🔴 ${warnMsg}`);
        $notification.post("NS签到警告", "🔴 Cookie 已过期", warnMsg);
        await sendTgNotify(`<b>🔴 NodeSeek Cookie 已过期</b>\n\n过期时间: <code>${expiryDateStr}</code>\n请立即重新登录 NodeSeek 并重新抓取 Cookie。`);

    } else if (remainHours < 48) {
        const hours   = Math.floor(remainHours);
        const warnMsg = `Cookie 将在约 ${hours} 小时后过期（${expiryDateStr}），请尽快刷新！`;
        console.log(`[NS签到] 🟡 ${warnMsg}`);
        $notification.post("NS签到警告", "🟡 Cookie 即将过期", warnMsg);
        await sendTgNotify(`<b>🟡 NodeSeek Cookie 即将过期</b>\n\n剩余: <code>约 ${hours} 小时</code>\n过期时间: <code>${expiryDateStr}</code>\n建议重新登录并抓取 Cookie。`);

    } else {
        const days = Math.floor(remainHours / 24);
        console.log(`[NS签到] ✅ Cookie 正常，剩余约 ${days} 天（${expiryDateStr} 过期）`);
    }
}

// ============================================================
// 5. Telegram 推送通知模块
// ============================================================

/**
 * 向 Telegram 发送 HTML 格式通知。
 * tgToken 和 tgUserId 均未配置时静默跳过。
 *
 * @param {string} text - 支持 HTML 标签的消息正文
 */
async function sendTgNotify(text) {
    if (!tgToken || !tgUserId) {
        return; // 未配置 TG 参数，静默跳过
    }

    const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;

    try {
        const resp = await fetchPromise({
            url:    tgUrl,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id:                tgUserId,
                text:                   text,
                parse_mode:             "HTML",
                disable_web_page_preview: true
            })
        });

        if (resp.status !== 200) {
            console.log(`[TG_Notify] ❌ 推送失败，状态码: ${resp.status}，响应: ${resp.body}`);
        }
    } catch (error) {
        const errStr = error?.error || error?.message || String(error);
        console.log(`[TG_Notify] ❌ 推送网络异常: ${errStr}`);
    }
}
