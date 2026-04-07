/**

- ============================================================
- NodeSeek 签到增强版脚本
- 作者: Roddy-D
- 更新: 2026-04-07a
- 适配: Loon
- 
- 触发方式:
- - http-request : 抓取并持久化 NodeSeek Cookie
- - cron         : 定时执行签到，支持 TG 推送
- 
- ── $argument 说明（来自 Loon 官方文档）─────────────────────
- Plugin [Argument] 中声明的参数通过 argument=[{arg1},{arg2}]
- 传入脚本，$argument 在脚本中是一个【对象】，
- 直接用 $argument.arg1 取值，无需任何解析。
- 
- http-request argument=[{ENABLE_CAPTURE},{NS_COOKIE}]
- $argument.ENABLE_CAPTURE - switch 类型，布尔值 true/false
- $argument.NS_COOKIE      - input 类型，字符串
- 
- cron argument=[{TG_BOT_TOKEN},{TG_USER_ID},{TG_NOTIFY_ONLY_FAIL},{RANDOM_REWARD}]
- $argument.TG_BOT_TOKEN        - input 类型，字符串
- $argument.TG_USER_ID          - input 类型，字符串
- $argument.TG_NOTIFY_ONLY_FAIL - switch 类型，布尔值 true/false
- $argument.RANDOM_REWARD       - switch 类型，布尔值 true/false
- 
- ── 持久化存储 key ────────────────────────────────────────────
- NS_COOKIE        - Cookie 字符串
- NS_COOKIE_EXPIRY - Cookie 过期时间戳 (ms)
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
// 参数解析
//
// 官方文档明确：
//   argument=[{arg1},{arg2}] 传入后，
//   $argument 是对象，直接 $argument.arg1 取值。
//   switch 类型值为布尔值 true/false（非字符串）。
//   input  类型值为字符串。
// ============================================================

/**

- 判断 input 类型参数是否为有效值（过滤空值及占位符）
  */
  const isValid = (val) =>
  val !== undefined &&
  val !== null &&
  String(val).trim() !== “” &&
  String(val).trim() !== “xxx” &&
  String(val).trim() !== “无” &&
  String(val).trim().toLowerCase() !== “none”;

if (typeof $argument !== “undefined” && $argument) {
// $argument 是对象，直接按 key 读取，无需 JSON.parse 或字符串分割
console.log(”[NS签到] $argument 类型: “ + typeof $argument);
console.log(”[NS签到] $argument 内容: “ + JSON.stringify($argument));

```
// ── http-request 阶段参数 ──────────────────────────────
// ENABLE_CAPTURE: switch 类型，布尔值
if ($argument.ENABLE_CAPTURE !== undefined) {
    enableCapture = !!$argument.ENABLE_CAPTURE;
}

// NS_COOKIE: input 类型，字符串
// Cookie 含特殊字符（& = 等），但通过对象属性传递不存在解析问题
// 取到后立即写入 $persistentStore，cron 阶段统一从存储读取
if (isValid($argument.NS_COOKIE)) {
    const manualCookie = String($argument.NS_COOKIE);
    $persistentStore.write(manualCookie, COOKIE_CACHE_KEY);
    console.log("[NS签到] 手动 Cookie 已写入存储: " + manualCookie.substring(0, 30) + "...");
}

// ── cron 阶段参数 ─────────────────────────────────────
// input 类型：字符串
tgToken  = isValid($argument.TG_BOT_TOKEN) ? String($argument.TG_BOT_TOKEN) : "";
tgUserId = isValid($argument.TG_USER_ID)   ? String($argument.TG_USER_ID)   : "";

// switch 类型：布尔值，直接用 !! 转换确保是布尔
notifyOnlyFail  = !!$argument.TG_NOTIFY_ONLY_FAIL;
useRandomReward = !!$argument.RANDOM_REWARD;

console.log("[NS签到] 参数解析完成 =>" +
    " enableCapture="   + enableCapture +
    " | tgToken="       + (tgToken  ? "已配置(" + tgToken.substring(0, 8) + "...)" : "未配置") +
    " | tgUserId="      + (tgUserId ? "已配置" : "未配置") +
    " | notifyOnlyFail=" + notifyOnlyFail +
    " | useRandomReward=" + useRandomReward);
```

}

// ============================================================
// 执行入口
// $request 存在  => http-request 触发（抓取 Cookie）
// $request 不存在 => cron 触发（执行签到）
// ============================================================
const isGetHeader = typeof $request !== “undefined”;

/**

- 异步 IIFE 主入口。
- Loon 要求所有逻辑完成后必须调用 $done()，否则引擎不释放资源。
  */
  (async () => {
  if (isGetHeader) {
  handleCaptureCookie();
  } else {
  await handleCheckin();
  }
  })().finally(() => {
  // http-request: $done({}) 表示放行原请求不做修改
  // cron:        $done({}) 表示脚本正常结束释放资源
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

// 持久化保存抓取到的 Cookie
const success = $persistentStore.write(cookie, COOKIE_CACHE_KEY);

// 从 smac 字段推算 30 天后的过期时间
let expiryDateStr = "未知";
try {
    const smacMatch = cookie.match(/smac\s*=\s*(\d+)-/);
    if (smacMatch && smacMatch[1]) {
        const loginTs  = parseInt(smacMatch[1]) * 1000;
        const expiryTs = loginTs + 2592000000; // 30天 ms
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
// 先检测 Cookie 是否即将/已过期
await checkCookieExpiry();

```
// cron 阶段统一从 $persistentStore 读取 Cookie
// 手动填写的 Cookie 在 http-request 阶段已写入存储
const finalCookie = $persistentStore.read(COOKIE_CACHE_KEY);

if (!finalCookie) {
    const msg = "📉 未检测到 Cookie。\n请打开【开启Cookie抓取】并访问 NodeSeek 个人中心，\n或在插件配置中手动填写 Cookie。";
    console.log("[NS签到] " + msg);
    $notification.post("NS签到结果", "❌ 无法签到", msg);
    await sendTgNotify("<b>❌ NodeSeek 签到失败</b>\n\n原因: <code>未检测到 Cookie，请检查插件配置！</code>");
    return;
}

// useRandomReward 由 $argument.RANDOM_REWARD 布尔值直接赋值
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
    msg = (obj && obj.message) ? String(obj.message) : "";
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
        console.log("[NS签到] notifyOnlyFail=true，成功不推送 TG。");
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
- Loon $httpClient 回调签名：callback(error, response, data)
- error    - 网络错误字符串，成功为 null
- response - { status, headers }
- data     - 响应 body 字符串
  */
  function fetchPromise(request) {
  return new Promise(function(resolve, reject) {
  const method  = (request.method || “GET”).toUpperCase();
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

- 格式化 Date 为本地时间字符串 YYYY-MM-DD HH:mm。
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

- 检测 Cookie 过期状态并推送预警。
- 
- 已过期 (remainMs <= 0)    => 🔴 本地通知 + TG
- 不足 48 小时 (< 48h)      => 🟡 本地通知 + TG
- 正常                      => 仅打印日志
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
  const errStr = (error && (error.error || error.message)) ? (error.error || error.message) : String(error);
  console.log(”[TG_Notify] ❌ 推送网络异常: “ + errStr);
  }
  }