/**
 * ============================================================
 * NodeSeek 签到增强版脚本
 * 作者: Roddy-D、diy97
 * 更新: 2026-4-5
 * 适配: Loon
 *
 * 触发方式:
 *   - http-request : 抓取并持久化 NodeSeek Cookie
 *   - cron         : 定时执行签到，支持 TG 推送
 *
 * ── 参数传递说明 ──────────────────────────────────────────
 * Loon [Argument] 参数通过 argument=key=val&key=val 传入脚本，
 * $argument 在脚本中是一个【字符串】，需手动解析为键值对象。
 *
 * ⚠️ NS_COOKIE 特殊处理：
 *   Cookie 字符串本身含有 & 和 = 等特殊字符，若直接放进
 *   argument query string 会破坏解析。
 *   因此 Cookie 优先从 $persistentStore 持久化存储读取；
 *   用户在插件 UI 手动填写的 Cookie 会在 http-request 阶段
 *   写入 $persistentStore，之后 cron 统一从存储读取，
 *   无需在 cron 的 argument 里传递 Cookie 字符串。
 *
 * ── 参数列表 ──────────────────────────────────────────────
 * http-request argument:
 *   ENABLE_CAPTURE  - 是否开启 Cookie 抓取 (true/false)
 *   NS_COOKIE       - 手动填写的 Cookie，写入存储后生效
 *
 * cron argument:
 *   TG_BOT_TOKEN        - Telegram Bot Token（选填）
 *   TG_USER_ID          - Telegram User ID（选填）
 *   TG_NOTIFY_ONLY_FAIL - 仅失败时推送 TG (true/false)
 *   RANDOM_REWARD       - 随机奖励模式 (true/false)
 * ============================================================
 */

// ============================================================
// 全局变量默认值
// ============================================================
let checkinCookie   = "";
let tgToken         = "";
let tgUserId        = "";
let notifyOnlyFail  = false;
let enableCapture   = true;   // 默认开启抓取
let useRandomReward = false;  // 默认固定保底

const COOKIE_CACHE_KEY  = "NS_COOKIE";         // 持久化存储 Cookie 的 key
const COOKIE_EXPIRY_KEY = "NS_COOKIE_EXPIRY";  // 持久化存储过期时间的 key

// ============================================================
// 参数解析
//
// Loon 中 $argument 是纯字符串，格式为 key=val&key=val。
// 使用自定义解析函数转为对象，再按 key 读取。
//
// ⚠️ 解析规则：
//   - 按第一个 & 之前/之后切割各参数对
//   - 每对按第一个 = 切割 key 和 value
//   - 只取第一个 = 左侧为 key，其余全部归入 value
//     （防止 value 中含 = 被截断，如 base64 / Cookie 片段）
// ============================================================

/**
 * 解析 Loon argument 字符串为键值对象。
 * @param {string} argStr
 * @returns {Object<string, string>}
 */
function parseArgument(argStr) {
    const result = {};
    if (!argStr || typeof argStr !== "string") return result;
    argStr.split("&").forEach(pair => {
        const idx = pair.indexOf("=");
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) result[key] = val;
    });
    return result;
}

/**
 * 判断参数值是否为有效输入（过滤空值及常见占位符）。
 */
const isValid = (val) =>
    val !== undefined &&
    val !== null &&
    String(val).trim() !== "" &&
    String(val).trim() !== "xxx" &&
    String(val).trim() !== "无" &&
    String(val).trim().toLowerCase() !== "none";

/**
 * 将字符串 "true"/"1"/布尔 true 统一解析为布尔值。
 * Loon switch 类型展开后为字符串 "true" 或 "false"，不是布尔值。
 */
const parseBool = (val) =>
    val === true || val === "true" || val === "1";

// 解析 $argument 并赋值到各全局变量
if (typeof $argument !== "undefined" && $argument) {
    const args = parseArgument($argument);
    console.log("[NS签到] 原始 $argument: " + $argument);
    console.log("[NS签到] 解析后参数: " + JSON.stringify(args));

    // ── http-request 阶段参数 ──────────────────────────────
    // ENABLE_CAPTURE: 是否开启 Cookie 抓取
    if (args.ENABLE_CAPTURE !== undefined) {
        enableCapture = parseBool(args.ENABLE_CAPTURE);
    }

    // NS_COOKIE: 用户手动填写的 Cookie
    // 若有效则立即写入 $persistentStore，后续 cron 从存储读取
    // 避免将含特殊字符的 Cookie 直接放在 cron argument 中
    if (isValid(args.NS_COOKIE)) {
        const manualCookie = String(args.NS_COOKIE);
        $persistentStore.write(manualCookie, COOKIE_CACHE_KEY);
        console.log("[NS签到] 手动 Cookie 已写入持久化存储: " + manualCookie.substring(0, 30) + "...");
    }

    // ── cron 阶段参数 ─────────────────────────────────────
    tgToken         = isValid(args.TG_BOT_TOKEN)        ? String(args.TG_BOT_TOKEN)        : "";
    tgUserId        = isValid(args.TG_USER_ID)           ? String(args.TG_USER_ID)           : "";
    notifyOnlyFail  = parseBool(args.TG_NOTIFY_ONLY_FAIL);
    useRandomReward = parseBool(args.RANDOM_REWARD);

    console.log("[NS签到] enableCapture=" + enableCapture +
                " | tgToken=" + (tgToken ? "已配置" : "未配置") +
                " | tgUserId=" + (tgUserId ? "已配置" : "未配置") +
                " | notifyOnlyFail=" + notifyOnlyFail +
                " | useRandomReward=" + useRandomReward);
}

// ============================================================
// 执行入口判断
// $request 存在  => http-request 触发（抓取 Cookie）
// $request 不存在 => cron 触发（执行签到）
// ============================================================
const isGetHeader = typeof $request !== "undefined";

/**
 * 异步 IIFE 主入口。
 * Loon 要求：所有异步逻辑结束后必须调用 $done()，
 * 否则脚本引擎不会释放资源。
 * 使用 .finally() 确保无论成功或异常都能触发 $done({})。
 */
(async () => {
    if (isGetHeader) {
        // http-request 触发：抓取 Cookie 流程
        handleCaptureCookie();
    } else {
        // cron 触发：执行签到流程
        await handleCheckin();
    }
})().finally(() => {
    // http-request 中：$done({}) 表示放行原请求，不做任何修改
    // cron 中：$done({}) 表示脚本正常结束并释放引擎资源
    $done({});
});

// ============================================================
// 1. Cookie 抓取模块（http-request 触发）
// ============================================================
function handleCaptureCookie() {
    // 检查抓取开关
    if (!enableCapture) {
        console.log("[NS签到] 抓取开关已关闭，跳过抓取流程。");
        return;
    }

    const allHeaders = $request.headers || {};

    // 大小写兼容读取 Cookie header
    // Loon 中请求头 key 的大小写可能不统一，三种形式都尝试
    const getHeader = (name) =>
        allHeaders[name] ??
        allHeaders[name.toLowerCase()] ??
        allHeaders[name.toUpperCase()];

    const cookie = getHeader("Cookie") || getHeader("cookie");

    if (!cookie) {
        console.log("[NS签到] ⚠️ 提取 Cookie 为空，完整 Header: " + JSON.stringify(allHeaders));
        $notification.post("NS Cookie 获取失败", "", "未能从请求中找到 Cookie，请重新访问个人页面重试。");
        return;
    }

    // 持久化保存抓取到的 Cookie
    const success = $persistentStore.write(cookie, COOKIE_CACHE_KEY);

    // 尝试从 smac 字段推算登录时间戳，计算 30 天后的过期时间
    let expiryDateStr = "未知";
    try {
        const smacMatch = cookie.match(/smac\s*=\s*(\d+)-/);
        if (smacMatch && smacMatch[1]) {
            const loginTs  = parseInt(smacMatch[1]) * 1000;
            const expiryTs = loginTs + 2592000000; // 30天 = 30*24*60*60*1000 ms
            $persistentStore.write(String(expiryTs), COOKIE_EXPIRY_KEY);
            expiryDateStr = formatDate(new Date(expiryTs));
            console.log(`[NS签到] ✨ 缓存 Session 过期时间: ${expiryDateStr}`);
        } else {
            console.log("[NS签到] ⚠️ 未找到 smac 字段，无法预估过期时间。");
        }
    } catch (e) {
        console.log(`[NS签到] ⚠️ 计算过期时间出错: ${e.message}`);
    }

    if (success) {
        console.log("[NS签到] ✨ 成功保存 Cookie: " + cookie.substring(0, 30) + "...");
        $notification.post(
            "NS Cookie 获取成功", "",
            `Cookie 已保存。\nSession 预计过期：${expiryDateStr}\n请前往插件配置关闭【开启Cookie抓取】开关。`
        );
    } else {
        console.log("[NS签到] ❌ 保存 Cookie 失败");
        $notification.post("NS Cookie 保存失败", "", "写入存储失败，请检查 Loon 存储权限。");
    }
}

// ============================================================
// 2. 签到核心逻辑（cron 触发）
// ============================================================
async function handleCheckin() {
    // 先检测 Cookie 是否即将/已经过期，提前预警
    await checkCookieExpiry();

    // Cookie 读取策略：
    // cron 阶段不从 argument 读 Cookie（避免特殊字符解析问题），
    // 统一从 $persistentStore 持久化存储读取。
    // 手动填写的 Cookie 在 http-request 阶段解析 argument 时已写入存储。
    const finalCookie = $persistentStore.read(COOKIE_CACHE_KEY);

    if (!finalCookie) {
        const msg = "📉 未检测到 Cookie。\n请打开【开启Cookie抓取】并访问 NodeSeek 个人中心自动抓取，\n或在插件配置中手动填写 Cookie。";
        console.log("[NS签到] " + msg);
        $notification.post("NS签到结果", "❌ 无法签到", msg);
        await sendTgNotify("<b>❌ NodeSeek 签到失败</b>\n\n原因: <code>未检测到 Cookie，请检查插件配置！</code>");
        return;
    }

    // 根据随机奖励模式拼接签到 URL
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
    const status = resp.status;
    const body   = resp.body || "";
    let msg = "";

    // 尝试解析 JSON 响应体中的 message 字段
    try {
        const obj = JSON.parse(body);
        msg = obj?.message ? String(obj.message) : "";
        console.log(`[NS签到] JSON 解析 message: ${msg || "无"}`);
    } catch (e) {
        console.log(`[NS签到] 响应体非 JSON: ${body.substring(0, 150)}`);
    }

    const content = msg || body.substring(0, 150) || "服务端未返回有效内容";

    if (status >= 200 && status < 300) {
        // 签到成功
        const notifyStr = msg || "签到成功或今日已签过";
        console.log(`[NS签到] ✅ 签到成功: ${notifyStr}`);
        $notification.post("NS活动签到", "✅ 签到成功", notifyStr);
        // notifyOnlyFail=true 时签到成功不推送 TG
        if (!notifyOnlyFail) {
            await sendTgNotify(`<b>🎉 NodeSeek 自动签到成功</b>\n\n状态码: ${status}\n返回信息：\n<code>${escapeHtml(notifyStr)}</code>`);
        }

    } else if (status === 403) {
        // Cloudflare 或系统风控拦截
        const notifyStr = `遭受 Cloudflare 或系统风控\n详情：${content}`;
        console.log(`[NS签到] ⚠️ 403 风控: ${content}`);
        $notification.post("NS活动签到", "⚠️ 403 风控拦截", notifyStr);
        await sendTgNotify(`<b>⚠️ NodeSeek 签到被风控(403)</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);

    } else if (status === 500) {
        // 服务器内部错误
        const notifyStr = `服务器内部错误(500)\n内容：${content}`;
        console.log(`[NS签到] ❌ 500 服务器错误: ${content}`);
        $notification.post("NS活动签到", "❌ 服务器内部错误", notifyStr);
        await sendTgNotify(`<b>❌ NodeSeek 签到服务器错误(500)</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);

    } else {
        // 其他未预期的状态码
        const notifyStr = `异常状态码: ${status}\n内容：${content}`;
        console.log(`[NS签到] ❓ 未知异常 status=${status}: ${content}`);
        $notification.post("NS活动签到", `❓ 未知异常 (${status})`, notifyStr);
        await sendTgNotify(`<b>❓ NodeSeek 签到未知异常 (${status})</b>\n\n详情：\n<code>${escapeHtml(content)}</code>`);
    }
}

// ============================================================
// 4. 辅助函数
// ============================================================

/**
 * 将 Loon 的 $httpClient 回调式 API 封装为 Promise。
 *
 * Loon 的网络请求 API 为回调风格：
 *   $httpClient.post(options, (error, response, data) => { ... })
 * 封装后可用 async/await 调用，简化异步逻辑。
 *
 * @param {{ url: string, method?: string, headers?: object, body?: string }} request
 * @returns {Promise<{ status: number, body: string, headers: object }>}
 */
function fetchPromise(request) {
    return new Promise((resolve, reject) => {
        const method = (request.method || "GET").toUpperCase();

        const options = {
            url:     request.url,
            headers: request.headers || {}
        };

        // 仅在明确传入 body 时附加，避免 GET 请求携带空 body
        if (request.body !== undefined && request.body !== null) {
            options.body = request.body;
        }

        // $httpClient 回调参数：(error, response, data)
        //   error    - 网络层错误字符串，成功时为 null
        //   response - { status, headers }
        //   data     - 响应 body 字符串（或二进制）
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
 * 转义 HTML 特殊字符。
 * 用于 Telegram HTML 模式推送，防止 < > & 等字符破坏消息格式。
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
 * 格式化 Date 对象为本地时间字符串 YYYY-MM-DD HH:mm。
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
 * 检测持久化存储中的 Cookie 过期状态并推送预警。
 *
 * 判断逻辑：
 *   remainMs <= 0     => 🔴 已过期，推送本地通知 + TG
 *   remainHours < 48  => 🟡 即将过期，推送本地通知 + TG
 *   否则              => ✅ 正常，仅打印日志
 */
async function checkCookieExpiry() {
    const cachedExpiry = $persistentStore.read(COOKIE_EXPIRY_KEY);
    if (!cachedExpiry) {
        console.log("[NS签到] 未检测到缓存的过期时间，跳过过期检测。");
        return;
    }

    const expiryMs = parseInt(cachedExpiry);
    if (isNaN(expiryMs)) return;

    const now           = Date.now();
    const remainMs      = expiryMs - now;
    const remainHours   = remainMs / (1000 * 60 * 60);
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
        await sendTgNotify(`<b>🟡 NodeSeek Cookie 即将过期</b>\n\n剩余: <code>约 ${hours} 小时</code>\n过期时间: <code>${expiryDateStr}</code>\n建议尽快重新抓取 Cookie。`);

    } else {
        const days = Math.floor(remainHours / 24);
        console.log(`[NS签到] ✅ Cookie 正常，剩余约 ${days} 天（${expiryDateStr} 过期）`);
    }
}

// ============================================================
// 5. Telegram 推送模块
// ============================================================

/**
 * 向 Telegram 发送 HTML 格式通知。
 * tgToken 或 tgUserId 任意一个未配置时静默跳过，不报错。
 *
 * @param {string} text - 支持 Telegram HTML 标签的消息正文
 */
async function sendTgNotify(text) {
    if (!tgToken || !tgUserId) {
        console.log("[TG_Notify] TG 参数未配置，跳过推送。token=" + (tgToken ? "有" : "无") + " userId=" + (tgUserId ? "有" : "无"));
        return;
    }

    const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;

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
            console.log(`[TG_Notify] ❌ 推送失败，状态码: ${resp.status}，响应: ${resp.body}`);
        }
    } catch (error) {
        const errStr = error?.error || error?.message || String(error);
        console.log(`[TG_Notify] ❌ 推送网络异常: ${errStr}`);
    }
}
