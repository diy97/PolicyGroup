/**

- ============================================================
- NodeSeek 签到增强版脚本
- 作者: Roddy-D
- 更新: 2026-04-07
- 适配: Loon
- 
- 触发方式:
- - http-request : 抓取并持久化 NodeSeek Cookie
- - cron         : 定时执行签到，支持 TG 推送
- 
- ── $argument 解析说明 ────────────────────────────────────
- Loon 中 $argument 是纯字符串，格式为 key=val&key=val。
- 
- ⚠️ NS_COOKIE 特殊处理：
- Cookie 字符串本身含大量 & 和 = 特殊字符，
- 必须放在 argument 末尾，并用专用函数截取，
- 不能用普通的 split(”&”) 解析，否则会被截断。
- 
- ⚠️ TG_BOT_TOKEN 含 : 符号（如 123456:ABCdef），
- 使用 indexOf(”=”) 只切第一个等号，不受影响。
- 
- ── 持久化存储 key ────────────────────────────────────────
- NS_COOKIE        - Cookie 字符串
- NS_COOKIE_EXPIRY - Cookie 过期时间戳(ms)
- ============================================================
  */

// ============================================================
// 全局变量默认值
// ============================================================
let tgToken         = “”;
let tgUserId        = “”;
let notifyOnlyFail  = false;
let enableCapture   = true;   // 默认开启 Cookie 抓取
let useRandomReward = false;  // 默认固定保底奖励

const COOKIE_CACHE_KEY  = “NS_COOKIE”;
const COOKIE_EXPIRY_KEY = “NS_COOKIE_EXPIRY”;

// ============================================================
// 参数解析工具函数
// ============================================================

/**

- 从 argument 字符串中提取普通 key=val 参数（不含特殊字符的值）。
- 只解析 & 分隔的前 N 个参数，遇到含特殊字符的值（如 Cookie）需用专用函数。
- 
- 解析规则：
- - 按 & 分割成多个 pair
- - 每个 pair 按第一个 = 切割为 key 和 value
- - value 中可含 : 等字符（如 TG_BOT_TOKEN），不影响解析
- 
- @param {string} argStr - $argument 原始字符串
- @returns {Object<string, string>}
  */
  function parseArgument(argStr) {
  const result = {};
  if (!argStr || typeof argStr !== “string”) return result;
  argStr.split(”&”).forEach(pair => {
  const idx = pair.indexOf(”=”);
  if (idx === -1) return;
  const key = pair.slice(0, idx).trim();
  const val = pair.slice(idx + 1).trim();
  if (key) result[key] = val;
  });
  return result;
  }

/**

- 从 argument 字符串中安全提取 NS_COOKIE 的值。
- 
- Cookie 字符串含大量 & 和 = 特殊字符，普通 split(”&”) 会把 Cookie 截断。
- 此函数定位 “NS_COOKIE=” 的起始位置，取其后全部内容作为 Cookie 值，
- 再截止到下一个已知参数 key（如有）之前，确保完整性。
- 
- 设计约定：NS_COOKIE 必须放在 argument 的末尾，这样直接取到字符串结尾即可。
- 
- @param {string} argStr - $argument 原始字符串
- @returns {string} Cookie 值，未找到时返回空字符串
  */
  function extractCookie(argStr) {
  if (!argStr || typeof argStr !== “string”) return “”;
  const marker = “NS_COOKIE=”;
  const idx = argStr.indexOf(marker);
  if (idx === -1) return “”;
  // NS_COOKIE 放末尾，直接取到字符串结尾
  return argStr.slice(idx + marker.length).trim();
  }

/**

- 判断参数值是否为有效输入（过滤空值及常见无效占位符）。
  */
  const isValid = (val) =>
  val !== undefined &&
  val !== null &&
  String(val).trim() !== “” &&
  String(val).trim() !== “xxx” &&
  String(val).trim() !== “无” &&
  String(val).trim().toLowerCase() !== “none”;

/**

- 将各种形式的布尔表示统一解析为 JS 布尔值。
- 
- Loon switch 参数展开后为字符串 “true” 或 “false”，
- 不是 JS 布尔值，必须显式转换。
- 同时兼容 true/“true”/“1”/1（兼容不同 Loon 版本行为）。
  */
  const parseBool = (val) => {
  if (val === true  || val === 1)       return true;
  if (val === false || val === 0)       return false;
  if (typeof val === “string”) {
  const s = val.trim().toLowerCase();
  return s === “true” || s === “1”;
  }
  return false;
  };

// ============================================================
// 解析 $argument
// ============================================================
if (typeof $argument !== “undefined” && $argument) {
console.log(”[NS签到] 原始 $argument: “ + $argument);

```
// 先用通用解析器提取所有 key=val 参数
// NS_COOKIE 因含特殊字符，由专用函数单独提取
const args = parseArgument($argument);
console.log("[NS签到] 通用解析结果: " + JSON.stringify(args));

// ── http-request 阶段参数 ──────────────────────────────
// ENABLE_CAPTURE: switch 类型，Loon 展开后为字符串 "true"/"false"
if (args.ENABLE_CAPTURE !== undefined) {
    enableCapture = parseBool(args.ENABLE_CAPTURE);
}

// NS_COOKIE: 含特殊字符，用专用函数安全提取
// 提取后立即写入 $persistentStore，cron 阶段直接从存储读取
const rawCookie = extractCookie($argument);
if (isValid(rawCookie)) {
    $persistentStore.write(rawCookie, COOKIE_CACHE_KEY);
    console.log("[NS签到] 手动 Cookie 已写入存储: " + rawCookie.substring(0, 30) + "...");
}

// ── cron 阶段参数 ─────────────────────────────────────
// TG_BOT_TOKEN: input 类型，含 : 符号，但 parseArgument 按首个 = 切割，不受影响
tgToken  = isValid(args.TG_BOT_TOKEN) ? String(args.TG_BOT_TOKEN) : "";
tgUserId = isValid(args.TG_USER_ID)   ? String(args.TG_USER_ID)   : "";

// switch 类型参数必须用 parseBool 转换，不能直接判断字符串真值
// 因为字符串 "false" 在 JS 中是 truthy，直接 if("false") 永远为 true
notifyOnlyFail  = parseBool(args.TG_NOTIFY_ONLY_FAIL);
useRandomReward = parseBool(args.RANDOM_REWARD);

console.log("[NS签到] 参数解析完成 =>" +
    " enableCapture=" + enableCapture +
    " | tgToken=" + (tgToken ? "已配置(" + tgToken.substring(0, 8) + "...)" : "未配置") +
    " | tgUserId=" + (tgUserId ? "已配置" : "未配置") +
    " | notifyOnlyFail=" + notifyOnlyFail +
    " | useRandomReward=" + useRandomReward);
```

}

// ============================================================
// 执行入口判断
// $request 存在  => http-request 触发（抓取 Cookie）
// $request 不存在 => cron 触发（执行签到）
// ============================================================
const isGetHeader = typeof $request !== “undefined”;

/**

- 异步 IIFE 主入口。
- Loon 要求：所有异步逻辑完成后必须调用 $done()，
- 否则脚本引擎不释放资源。
- .finally() 确保无论成功或异常都会触发。
  */
  (async () => {
  if (isGetHeader) {
  handleCaptureCookie();
  } else {
  await handleCheckin();
  }
  })().finally(() => {
  $done({});
  });

// ============================================================
// 1. Cookie 抓取模块（http-request 触发）
// ============================================================
function handleCaptureCookie() {
if (!enableCapture) {
console.log(”[NS签到] 抓取开关已关闭，跳过。”);
return;
}

```
const allHeaders = $request.headers || {};

// 大小写兼容读取 Cookie header
const getHeader = (name) =>
    allHeaders[name] ??
    allHeaders[name.toLowerCase()] ??
    allHeaders[name.toUpperCase()];

const cookie = getHeader("Cookie") || getHeader("cookie");

if (!cookie) {
    console.log("[NS签到] ⚠️ Cookie 为空，Header: " + JSON.stringify(allHeaders));
    $notification.post("NS Cookie 获取失败", "", "未找到 Cookie，请重新访问 NodeSeek 个人页面。");
    return;
}

const success = $persistentStore.write(cookie, COOKIE_CACHE_KEY);

// 从 smac 字段推算 30 天后的过期时间
let expiryDateStr = "未知";
try {
    const smacMatch = cookie.match(/smac\s*=\s*(\d+)-/);
    if (smacMatch && smacMatch[1]) {
        const loginTs  = parseInt(smacMatch[1]) * 1000;
        const expiryTs = loginTs + 2592000000; // 30天
        $persistentStore.write(String(expiryTs), COOKIE_EXPIRY_KEY);
        expiryDateStr = formatDate(new Date(expiryTs));
        console.log("[NS签到] ✨ 过期时间: " + expiryDateStr);
    } else {
        console.log("[NS签到] ⚠️ 未找到 smac 字段，无法计算过期时间。");
    }
} catch (e) {
    console.log("[NS签到] ⚠️ 计算过期时间出错: " + e.message);
}

if (success) {
    console.log("[NS签到] ✨ Cookie 已保存: " + cookie.substring(0, 30) + "...");
    $notification.post(
        "NS Cookie 获取成功", "",
        "Cookie 已保存。\nSession 预计过期：" + expiryDateStr + "\n请关闭【开启Cookie抓取】开关。"
    );
} else {
    console.log("[NS签到] ❌ Cookie 保存失败");
    $notification.post("NS Cookie 保存失败", "", "写入存储失败，请检查 Loon 存储权限。");
}
```

}

// ============================================================
// 2. 签到核心逻辑（cron 触发）
// ============================================================
async function handleCheckin() {
await checkCookieExpiry();

```
// cron 阶段统一从 $persistentStore 读取 Cookie
// 不从 argument 传入，避免 Cookie 含特殊字符导致解析错误
const finalCookie = $persistentStore.read(COOKIE_CACHE_KEY);

if (!finalCookie) {
    const msg = "📉 未检测到 Cookie。\n请打开【开启Cookie抓取】并访问 NodeSeek 个人中心，\n或在插件配置中手动填写 Cookie。";
    console.log("[NS签到] " + msg);
    $notification.post("NS签到结果", "❌ 无法签到", msg);
    await sendTgNotify("<b>❌ NodeSeek 签到失败</b>\n\n原因: <code>未检测到 Cookie，请检查插件配置！</code>");
    return;
}

// useRandomReward 由 parseBool 正确解析，此处直接使用
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
    const errStr = error && (error.error || error.message) ? (error.error || error.message) : String(error);
    console.log("[NS签到] 网络请求异常: " + errStr);
    $notification.post("NS签到结果", "⚠️ 网络请求异常", errStr);
    await sendTgNotify("<b>⚠️ NodeSeek 签到网络异常</b>\n\n详情:\n<code>" + escapeHtml(errStr) + "</code>");
}
```

}

// ============================================================
// 3. 响应解析模块
// ============================================================
async function processResponse(resp) {
const status = resp.status;
const body   = resp.body || “”;
let msg = “”;

```
try {
    const obj = JSON.parse(body);
    msg = obj && obj.message ? String(obj.message) : "";
    console.log("[NS签到] JSON message: " + (msg || "无"));
} catch (e) {
    console.log("[NS签到] 响应体非 JSON: " + body.substring(0, 150));
}

const content = msg || body.substring(0, 150) || "服务端未返回有效内容";

if (status >= 200 && status < 300) {
    const notifyStr = msg || "签到成功或今日已签过";
    console.log("[NS签到] ✅ 签到成功: " + notifyStr);
    $notification.post("NS活动签到", "✅ 签到成功", notifyStr);
    // notifyOnlyFail=true 时成功不推送 TG
    if (!notifyOnlyFail) {
        await sendTgNotify("<b>🎉 NodeSeek 自动签到成功</b>\n\n状态码: " + status + "\n返回信息：\n<code>" + escapeHtml(notifyStr) + "</code>");
    } else {
        console.log("[NS签到] notifyOnlyFail=true，签到成功不推送 TG。");
    }

} else if (status === 403) {
    console.log("[NS签到] ⚠️ 403 风控: " + content);
    $notification.post("NS活动签到", "⚠️ 403 风控拦截", "遭受 Cloudflare 或系统风控\n详情：" + content);
    await sendTgNotify("<b>⚠️ NodeSeek 签到被风控(403)</b>\n\n详情：\n<code>" + escapeHtml(content) + "</code>");

} else if (status === 500) {
    console.log("[NS签到] ❌ 500: " + content);
    $notification.post("NS活动签到", "❌ 服务器内部错误", "服务器内部错误(500)\n内容：" + content);
    await sendTgNotify("<b>❌ NodeSeek 签到服务器错误(500)</b>\n\n详情：\n<code>" + escapeHtml(content) + "</code>");

} else {
    console.log("[NS签到] ❓ 未知 status=" + status + ": " + content);
    $notification.post("NS活动签到", "❓ 未知异常 (" + status + ")", "异常状态码: " + status + "\n内容：" + content);
    await sendTgNotify("<b>❓ NodeSeek 签到未知异常 (" + status + ")</b>\n\n详情：\n<code>" + escapeHtml(content) + "</code>");
}
```

}

// ============================================================
// 4. 辅助函数
// ============================================================

/**

- 将 $httpClient 回调 API 封装为 Promise，支持 async/await。
- 
- Loon $httpClient 回调签名：(error, response, data)
- error    - 网络错误字符串，成功为 null
- response - { status, headers }
- data     - 响应 body（字符串或二进制）
  */
  function fetchPromise(request) {
  return new Promise(function(resolve, reject) {
  const method = (request.method || “GET”).toUpperCase();
  const options = {
  url:     request.url,
  headers: request.headers || {}
  };
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
  if (method === “POST”) {
  $httpClient.post(options, callback);
  } else {
  $httpClient.get(options, callback);
  }
  });
  }

/**

- 转义 HTML 特殊字符，防止 Telegram HTML 模式格式错乱。
  */
  function escapeHtml(unsafe) {
  if (typeof unsafe !== “string”) return String(unsafe);
  return unsafe
  .replace(/&/g,  “&”)
  .replace(/</g,  “<”)
  .replace(/>/g,  “>”)
  .replace(/”/g,  “"”)
  .replace(/’/g,  “'”);
  }

/**

- 格式化 Date 为本地时间 YYYY-MM-DD HH:mm。
  */
  function formatDate(date) {
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, “0”);
  const d = String(date.getDate()).padStart(2, “0”);
  const h = String(date.getHours()).padStart(2, “0”);
  const m = String(date.getMinutes()).padStart(2, “0”);
  return y + “-” + M + “-” + d + “ “ + h + “:” + m;
  }

/**

- 检测 Cookie 过期状态并推送预警通知。
- 
- 已过期 (remainMs <= 0)  => 🔴 本地通知 + TG
- 不足48小时 (< 48h)      => 🟡 本地通知 + TG
- 正常                    => 仅打印日志
  */
  async function checkCookieExpiry() {
  const cachedExpiry = $persistentStore.read(COOKIE_EXPIRY_KEY);
  if (!cachedExpiry) {
  console.log(”[NS签到] 未检测到过期时间缓存，跳过检测。”);
  return;
  }
  const expiryMs = parseInt(cachedExpiry);
  if (isNaN(expiryMs)) return;
  
  const now           = Date.now();
  const remainMs      = expiryMs - now;
  const remainHours   = remainMs / (1000 * 60 * 60);
  const expiryDateStr = formatDate(new Date(expiryMs));
  
  if (remainMs <= 0) {
  const warnMsg = “Cookie 已于 “ + expiryDateStr + “ 过期，请重新登录 NodeSeek 并抓取 Cookie。”;
  console.log(”[NS签到] 🔴 “ + warnMsg);
  $notification.post(“NS签到警告”, “🔴 Cookie 已过期”, warnMsg);
  await sendTgNotify(”<b>🔴 NodeSeek Cookie 已过期</b>\n\n过期时间: <code>” + expiryDateStr + “</code>\n请立即重新登录并重新抓取 Cookie。”);
  
  } else if (remainHours < 48) {
  const hours   = Math.floor(remainHours);
  const warnMsg = “Cookie 将在约 “ + hours + “ 小时后过期（” + expiryDateStr + “），请尽快刷新！”;
  console.log(”[NS签到] 🟡 “ + warnMsg);
  $notification.post(“NS签到警告”, “🟡 Cookie 即将过期”, warnMsg);
  await sendTgNotify(”<b>🟡 NodeSeek Cookie 即将过期</b>\n\n剩余: <code>约 “ + hours + “ 小时</code>\n过期时间: <code>” + expiryDateStr + “</code>\n建议尽快重新抓取 Cookie。”);
  
  } else {
  const days = Math.floor(remainHours / 24);
  console.log(”[NS签到] ✅ Cookie 正常，剩余约 “ + days + “ 天（” + expiryDateStr + “ 过期）”);
  }
  }

// ============================================================
// 5. Telegram 推送模块
// ============================================================

/**

- 向 Telegram 发送 HTML 格式通知。
- tgToken 或 tgUserId 任意一个为空时静默跳过。
- 
- @param {string} text - 支持 Telegram HTML 标签的消息正文
  */
  async function sendTgNotify(text) {
  if (!tgToken || !tgUserId) {
  console.log(”[TG_Notify] 未配置 TG 参数，跳过推送。token=” + (tgToken ? “有” : “无”) + “ userId=” + (tgUserId ? “有” : “无”));
  return;
  }
  
  const tgUrl = “https://api.telegram.org/bot” + tgToken + “/sendMessage”;
  console.log(”[TG_Notify] 开始推送，userId=” + tgUserId);
  
  try {
  const resp = await fetchPromise({
  url:    tgUrl,
  method: “POST”,
  headers: { “Content-Type”: “application/json” },
  body: JSON.stringify({
  chat_id:                  tgUserId,
  text:                     text,
  parse_mode:               “HTML”,
  disable_web_page_preview: true
  })
  });
  
  ```
   if (resp.status === 200) {
       console.log("[TG_Notify] ✅ 推送成功");
   } else {
       console.log("[TG_Notify] ❌ 推送失败，状态码: " + resp.status + "，响应: " + resp.body);
   }
  ```
  
  } catch (error) {
  const errStr = error && (error.error || error.message) ? (error.error || error.message) : String(error);
  console.log(”[TG_Notify] ❌ 推送网络异常: “ + errStr);
  }
  }