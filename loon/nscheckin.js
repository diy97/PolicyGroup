/**
 * ============================================================
 * NodeSeek 签到增强版脚本
 * 版本: 2.0.0
 * 日期: 2026-04-08
 * 作者: nobody
 * 适配: Loon
 *
 * 触发方式:
 *   - http-request : 抓取并持久化 NodeSeek Cookie
 *   - cron         : 定时执行签到，支持 TG 推送
 *
 * ── Loon 参数读取说明 ─────────────────────────────────────────
 * Loon 插件 [Argument] 声明的参数有两种读取方式：
 *
 *   方式一：$argument（字符串，内容为 [val1,val2] 格式，不可靠）
 *   方式二：$persistentStore.read(key)
 *           Loon 会将 [Argument] 的每个参数以【变量名】为 key
 *           自动写入持久化存储，这是最稳定的读取方式。
 *
 * 本脚本统一使用 $persistentStore.read(key) 读取所有参数，
 * 彻底避免 $argument 格式歧义导致的解析错误。
 *
 * ── 持久化存储 key 一览 ───────────────────────────────────────
 *   ENABLE_CAPTURE      - 是否开启抓取 "true"/"false"
 *   NS_COOKIE           - 手动填写的 Cookie
 *   TG_BOT_TOKEN        - TG Bot Token
 *   TG_USER_ID          - TG User ID
 *   TG_NOTIFY_ONLY_FAIL - 仅失败时推送 "true"/"false"
 *   RANDOM_REWARD       - 随机奖励模式 "true"/"false"
 *   NS_COOKIE           - 抓取/手动保存的 Cookie（签到使用）
 *   NS_COOKIE_EXPIRY    - Cookie 过期时间戳 (ms)
 * ============================================================
 */

// ============================================================
// 持久化存储 Key 常量
// ============================================================
const COOKIE_CACHE_KEY  = "NS_COOKIE";
const COOKIE_EXPIRY_KEY = "NS_COOKIE_EXPIRY";

// ============================================================
// 全局参数读取
//
// 所有 [Argument] 参数统一通过 $persistentStore.read(key) 读取。
// Loon 在加载插件时会将用户配置的参数值自动写入持久化存储，
// key 即为 [Argument] 中声明的变量名。
// ============================================================

/**
 * 从持久化存储读取参数，并打印调试日志。
 * @param {string} key
 * @returns {string|null}
 */
function readParam(key) {
    const val = $persistentStore.read(key);
    console.log("[NS签到] readParam(" + key + ") = " + val);
    return val;
}

/**
 * 将存储中的字符串值解析为布尔值。
 * Loon switch 类型存储为字符串 "true" 或 "false"。
 * @param {string|null} val
 * @param {boolean} defaultVal
 * @returns {boolean}
 */
function parseBool(val, defaultVal) {
    if (val === null || val === undefined) return defaultVal;
    return val.trim().toLowerCase() === "true";
}

/**
 * 判断字符串参数值是否有效（过滤空值及常见占位符）。
 * @param {string|null} val
 * @returns {boolean}
 */
function isValid(val) {
    if (val === null || val === undefined) return false;
    const s = val.trim();
    return s !== "" && s !== "xxx" && s !== "无" && s.toLowerCase() !== "none";
}

// 读取所有参数
const enableCapture   = parseBool(readParam("ENABLE_CAPTURE"),      true);   // 默认开启抓取
const useRandomReward = parseBool(readParam("RANDOM_REWARD"),        false);  // 默认固定保底
const notifyOnlyFail  = parseBool(readParam("TG_NOTIFY_ONLY_FAIL"),  false);  // 默认全部通知

const rawTgToken  = readParam("TG_BOT_TOKEN");
const rawTgUserId = readParam("TG_USER_ID");
const tgToken     = isValid(rawTgToken)  ? rawTgToken.trim()  : "";
const tgUserId    = isValid(rawTgUserId) ? rawTgUserId.trim() : "";

// 手动填写的 Cookie（若有效则写入存储供签到使用）
const rawManualCookie = readParam("NS_COOKIE");
if (isValid(rawManualCookie)) {
    $persistentStore.write(rawManualCookie.trim(), COOKIE_CACHE_KEY);
    console.log("[NS签到] 手动 Cookie 已写入存储: " + rawManualCookie.trim().substring(0, 30) + "...");
}

console.log("[NS签到] 参数加载完成 =>" +
    " enableCapture="    + enableCapture    +
    " | useRandomReward=" + useRandomReward  +
    " | notifyOnlyFail=" + notifyOnlyFail   +
    " | tgToken="        + (tgToken  ? "已配置(" + tgToken.substring(0, 8)  + "...)" : "未配置") +
    " | tgUserId="       + (tgUserId ? "已配置" : "未配置"));

// ============================================================
// 执行入口
// $request 存在   => http-request 触发（抓取 Cookie）
// $request 不存在 => cron 触发（执行签到）
// ============================================================
const isGetHeader = typeof $request !== "undefined";

/**
 * 异步 IIFE 主入口。
 * Loon 要求所有逻辑完成后必须调用 $done()，否则引擎不释放资源。
 * .finally() 确保无论成功或异常都能触发 $done({})。
 */
(async () => {
    if (isGetHeader) {
        handleCaptureCookie();   // http-request：抓取 Cookie
    } else {
        await handleCheckin();   // cron：执行签到
    }
})().finally(() => {
    // http-request: $done({}) 放行原请求，不做任何修改
    // cron:        $done({}) 正常结束，释放引擎资源
    $done({});
});

// ============================================================
// 1. 抓取与持久化请求头模块（http-request 触发）
// ============================================================
function handleCaptureCookie() {
    if (!enableCapture) {
        console.log("[NS签到] 抓取开关已关闭，跳过抓取流程。");
        return;
    }

    const allHeaders = $request.headers || {};

    // 忽略大小写取 Cookie header（Loon 中 header key 大小写不统一）
    const getHeader = (name) =>
        allHeaders[name] ??
        allHeaders[name.toLowerCase()] ??
        allHeaders[name.toUpperCase()];

    const cookie = getHeader("Cookie") || getHeader("cookie");

    if (!cookie) {
        console.log("[NS签到] ⚠️ 提取 Cookie 为空，完整 Header: " + JSON.stringify(allHeaders));
        $notification.post("NS Cookie 获取失败", "", "未能从请求中找到 Cookie，请检查抓包逻辑重新访问个人页面尝试。");
        return;
    }

    // 持久化保存 Cookie
    const success = $persistentStore.write(cookie, COOKIE_CACHE_KEY);

    // 从 smac 字段提取登录时间戳，推算 30 天后过期时间
    let expiryDateStr = "未知";
    try {
        const smacMatch = cookie.match(/smac\s*=\s*(\d+)-/);
        if (smacMatch && smacMatch[1]) {
            const loginTimestamp  = parseInt(smacMatch[1]) * 1000;
            const expiryTimestamp = loginTimestamp + 2592000000; // 30天
            $persistentStore.write(String(expiryTimestamp), COOKIE_EXPIRY_KEY);
            expiryDateStr = formatDate(new Date(expiryTimestamp));
            console.log("[NS签到] ✨ 自动计算并缓存 Session 过期时间: " + expiryDateStr);
        } else {
            console.log("[NS签到] ⚠️ 未能在 Cookie 中找到 smac 字段，无法预估过期时间。");
        }
    } catch (e) {
        console.log("[NS签到] ⚠️ 计算过期时间出错: " + e.message);
    }

    if (success) {
        console.log("[NS签到] ✨ 成功保存 Cookie: " + cookie.substring(0, 30) + "...");
        $notification.post(
            "NS Cookie 获取成功", "",
            "Cookie 已保存。\nSession 预计过期时间：" + expiryDateStr + "\n请前往配置关闭【开启Cookie抓取】开关。"
        );
    } else {
        console.log("[NS签到] ❌ 保存 Cookie 失败");
        $notification.post("NS Cookie 保存失败", "", "写入存储失败，请检查存储权限。");
    }
}

// ============================================================
// 2. 核心签到逻辑（cron 触发）
// ============================================================
async function handleCheckin() {
    // 先检测 Cookie 是否即将/已过期
    await checkCookieExpiry();

    // 从持久化存储读取 Cookie（抓取或手动填写时已写入）
    const finalCookie = $persistentStore.read(COOKIE_CACHE_KEY);

    if (!finalCookie) {
        const msg = "📉 未检测到 Cookie，请打开 Cookie 抓取开关前往 NodeSeek 登录一次。";
        console.log("[NS签到] " + msg);
        $notification.post("NS签到结果", "❌ 无法签到", msg);
        await sendTgNotify("<b>❌ NodeSeek 签到失败</b>\n\n原因: <code>未检测到 NodeSeek Cookie，请检查配置！</code>");
        return;
    }

    // useRandomReward 由 $persistentStore 读取并正确解析为布尔值
    const url = "https://www.nodeseek.com/api/attendance?random=" + useRandomReward;
    console.log("[NS签到] 签到 URL: " + url);

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
        const resp = await fetchPromise({ url: url, method: "POST", headers: headers, body: "" });
        await processResponse(resp);
    } catch (error) {
        const errStr = (error && (error.error || error.message)) ? (error.error || error.message) : String(error);
        console.log("[NS签到] 网络请求出现异常: " + errStr);
        $notification.post("NS签到结果", "⚠️ 网络请求异常", errStr);
        await sendTgNotify("<b>⚠️ NodeSeek 签到系统/网络异常</b>\n\n详细信息: \n<code>" + escapeHtml(errStr) + "</code>");
    }
}

// ============================================================
// 3. 响应解析模块
// ============================================================
async function processResponse(resp) {
    const status = resp.status;
    const body   = resp.body || "";
    let msg = "";

    try {
        const obj = JSON.parse(body);
        msg = (obj && obj.message) ? String(obj.message) : "";
        console.log("[NS签到] JSON返回报文解析 message: " + (msg || "无"));
    } catch (e) {
        console.log("[NS签到] 响应体非JSON格式或无法解析: " + body.substring(0, 150));
    }

    const content = msg || body.substring(0, 150) || "服务端未返回任何有效内容";

    if (status >= 200 && status < 300) {
        const notifyStr = msg || "您已签到成功或已经签过到了";
        console.log("[NS签到] ✅ 签到响应成功: " + notifyStr);
        $notification.post("NS活动签到", "✅ 签到成功", notifyStr);
        // notifyOnlyFail=true 时签到成功不推送 TG
        if (!notifyOnlyFail) {
            await sendTgNotify("<b>🎉 NodeSeek 自动签到成功</b>\n\n状态码: " + status + "\n返回信息：\n<code>" + escapeHtml(notifyStr) + "</code>");
        } else {
            console.log("[NS签到] notifyOnlyFail=true，签到成功不推送 TG。");
        }

    } else if (status === 403) {
        const notifyStr = "遭受 Cloudflare 或 系统风控，请稍后重试\n拦截详情：" + content;
        console.log("[NS签到] ⚠️ 403风控拦截: " + content);
        $notification.post("NS活动签到", "⚠️ 403 风控拦截", notifyStr);
        await sendTgNotify("<b>⚠️ NodeSeek 签到被风控拦截(403)</b>\n\n拦截信息详情：\n<code>" + escapeHtml(content) + "</code>");

    } else if (status === 500) {
        const notifyStr = "服务器发生内部报错(500)\n内容：" + content;
        console.log("[NS签到] ❌ 500错误: " + content);
        $notification.post("NS活动签到", "❌ 服务器内部错误", notifyStr);
        await sendTgNotify("<b>❌ NodeSeek 签到服务器错误(500)</b>\n\n错误信息详情：\n<code>" + escapeHtml(content) + "</code>");

    } else {
        const notifyStr = "请求返回了异常状态码: " + status + "\n内容：" + content;
        console.log("[NS签到] ❓ 未知异常: status=" + status + " " + content);
        $notification.post("NS活动签到", "❓ 未知请求异常 (" + status + ")", notifyStr);
        await sendTgNotify("<b>❓ NodeSeek 签到未知异常状态 (" + status + ")</b>\n\n异常信息详情：\n<code>" + escapeHtml(content) + "</code>");
    }
}

// ============================================================
// 4. 辅助函数区
// ============================================================

/**
 * 将 $httpClient 回调式 API 封装为 Promise，支持 async/await。
 *
 * Loon $httpClient 回调签名：callback(error, response, data)
 *   error    - 网络错误字符串，成功为 null
 *   response - { status, headers }
 *   data     - 响应 body 字符串
 *
 * @param {{ url, method?, headers?, body? }} request
 * @returns {Promise<{ status, body, headers }>}
 */
function fetchPromise(request) {
    return new Promise(function(resolve, reject) {
        const method  = (request.method || "GET").toUpperCase();
        const options = { url: request.url, headers: request.headers || {} };
        if (request.body !== undefined && request.body !== null) {
            options.body = request.body;
        }
        const callback = function(error, response, data) {
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
 * 转义 HTML 特殊字符，防止 Telegram HTML 模式格式错乱。
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return String(unsafe);
    return unsafe
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&#039;");
}

/**
 * 格式化 Date 为本地时间字符串 YYYY-MM-DD HH:mm。
 */
function formatDate(date) {
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return y + "-" + M + "-" + d + " " + h + ":" + m;
}

/**
 * 检查 Cookie 过期时间，不足 48 小时或已过期则推送提醒。
 *
 * 已过期 (remainMs <= 0)  => 🔴 本地通知 + TG
 * 不足 48 小时 (< 48h)    => 🟡 本地通知 + TG
 * 正常                    => 仅打印日志
 */
async function checkCookieExpiry() {
    const cachedExpiry = $persistentStore.read(COOKIE_EXPIRY_KEY);
    if (!cachedExpiry) {
        console.log("[NS签到] 未检测到缓存的 Cookie 过期时间，跳过过期检测。");
        return;
    }

    const expiryMs = parseInt(cachedExpiry);
    if (isNaN(expiryMs)) return;

    const now           = Date.now();
    const remainMs      = expiryMs - now;
    const remainHours   = remainMs / (1000 * 60 * 60);
    const expiryDateStr = formatDate(new Date(expiryMs));

    if (remainMs <= 0) {
        const warnMsg = "Session Cookie 已于 " + expiryDateStr + " 过期，签到可能失败！请重新登录 NodeSeek 并抓取 Cookie。";
        console.log("[NS签到] 🔴 " + warnMsg);
        $notification.post("NS签到警告", "🔴 Cookie 已过期", warnMsg);
        await sendTgNotify("<b>🔴 NodeSeek Cookie 已过期</b>\n\n过期时间: <code>" + expiryDateStr + "</code>\n请立即重新登录 NodeSeek 并重新抓取 Cookie。");

    } else if (remainHours < 48) {
        const hours   = Math.floor(remainHours);
        const warnMsg = "Session Cookie 将在约 " + hours + " 小时后过期（" + expiryDateStr + "），请尽快重新登录 NodeSeek 刷新 Cookie！";
        console.log("[NS签到] 🟡 " + warnMsg);
        $notification.post("NS签到警告", "🟡 Cookie 即将过期", warnMsg);
        await sendTgNotify("<b>🟡 NodeSeek Cookie 即将过期</b>\n\n剩余时间: <code>约 " + hours + " 小时</code>\n过期时间: <code>" + expiryDateStr + "</code>\n建议重新登录 NodeSeek 并重新抓取 Cookie。");

    } else {
        const days = Math.floor(remainHours / 24);
        console.log("[NS签到] ✅ Cookie 过期检测正常，剩余约 " + days + " 天 (" + expiryDateStr + " 过期)");
    }
}

// ============================================================
// 5. Telegram 推送通知模块
// ============================================================

/**
 * 向 Telegram 发送 HTML 格式通知。
 * tgToken 或 tgUserId 任意一个为空时静默跳过。
 *
 * @param {string} text - 支持 Telegram HTML 标签的消息正文
 */
async function sendTgNotify(text) {
    if (!tgToken || !tgUserId) {
        console.log("[TG_Notify] 未配置 TG 参数，跳过推送。token=" + (tgToken ? "有" : "无") + " userId=" + (tgUserId ? "有" : "无"));
        return;
    }

    const tgUrl = "https://api.telegram.org/bot" + tgToken + "/sendMessage";
    console.log("[TG_Notify] 开始推送，userId=" + tgUserId);

    try {
        const resp = await fetchPromise({
            url:    tgUrl,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id:                  tgUserId,
                text:                     text,
                parse_mode:               "HTML",
                disable_web_page_preview: true
            })
        });
        if (resp.status === 200) {
            console.log("[TG_Notify] ✅ TG 推送成功");
        } else {
            console.log("[TG_Notify] ❌ TG 推送失败, HTTP 状态码: " + resp.status + ", 响应: " + resp.body);
        }
    } catch (error) {
        const errStr = (error && (error.error || error.message)) ? (error.error || error.message) : String(error);
        console.log("[TG_Notify] ❌ TG 推送环节发生网络异常: " + errStr);
    }
}
