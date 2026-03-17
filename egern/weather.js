// 天气通勤舒适度小组件 (Egern 适配增强版)
// 修复：渲染卡死、深浅色模式变量不兼容、缓存冲突

const CACHE_KEY = "weather_commute_cache_v2"; // 更换 Key 避免旧数据干扰

export default async function (ctx) {
    try {
        const env = ctx.env || {};
        const family = ctx.widgetFamily || "systemMedium";

        // 配置项初始化
        const host = normalizeHost(env.HOST || "https://devapi.qweather.com");
        const apiKey = String(env.API_KEY || "").trim();
        const location = String(env.LOCATION || "").trim();

        if (!apiKey || !location) {
            return errorWidget("配置缺失", "请检查 API_KEY 和 LOCATION");
        }

        // 1. 获取数据 (包含超时控制)
        let data = await getWeatherData(ctx, host, apiKey, location);
        
        // 2. 构造视图模型
        const view = buildView(data, env.LOCATION_NAME || "当前位置", env.ACCENT_COLOR);
        const theme = view.theme;

        // 3. 根据尺寸渲染
        if (family === "systemSmall") return buildSmall(view, theme);
        if (family === "systemLarge") return buildLarge(view, theme);
        
        // 默认返回中尺寸
        return buildMedium(view, theme);

    } catch (e) {
        console.log("Egern Widget Error: " + e.message);
        return errorWidget("运行错误", e.message);
    }
}

// ============== 数据获取逻辑 ==============

async function getWeatherData(ctx, host, apiKey, location) {
    const cached = loadCache(ctx);
    const now = Date.now();
    
    // 如果缓存未过期 (30分钟内)，直接用缓存
    if (cached && (now - (cached.ts || 0) < 1800000)) {
        return cached;
    }

    try {
        // 并行请求核心数据
        const [nowRes, hourlyRes, dailyRes] = await Promise.all([
            fetchJson(ctx, `${host}/v7/weather/now?location=${location}&key=${apiKey}`),
            fetchJson(ctx, `${host}/v7/weather/24h?location=${location}&key=${apiKey}`),
            fetchJson(ctx, `${host}/v7/weather/7d?location=${location}&key=${apiKey}`)
        ]);

        if (nowRes.code !== "200") throw new Error("API Code: " + nowRes.code);

        const data = {
            now: nowRes.now,
            hourly: hourlyRes.hourly || [],
            daily: dailyRes.daily || [],
            ts: now,
            updateTime: nowRes.updateTime
        };

        saveCache(ctx, data);
        return data;
    } catch (e) {
        if (cached) return cached; // 失败则降级使用缓存
        throw e;
    }
}

async function fetchJson(ctx, url) {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    return await resp.json();
}

// ============== 主题与视图逻辑 (关键：适配深浅色) ==============

function buildView(data, locName, accentInput) {
    const now = data.now || {};
    const isNight = computeIsNight(data.daily[0]);
    
    // 定义随系统切换的颜色变量
    const theme = {
        accent: accentInput || (isNight ? "#8B5CF6" : "#3B82F6"),
        bg: [
            { light: "#F9FAFB", dark: "#111827" }, // 浅色背景, 深色背景
            { light: "#F3F4F6", dark: "#0F172A" }
        ],
        text: { light: "#111827", dark: "#FFFFFF" },
        textMuted: { light: "#4B5563", dark: "#9CA3AF" },
        card: { light: "rgba(0,0,0,0.03)", dark: "rgba(255,255,255,0.06)" }
    };

    return {
        location: locName,
        temp: Math.round(parseFloat(now.temp || 0)) + "°",
        text: now.text || "未知",
        icon: iconForWeather(now.icon, isNight),
        humidity: (now.humidity || 0) + "%",
        theme: theme,
        hourly: (data.hourly || []).slice(0, 6)
    };
}

// ============== UI 组件渲染 ==============

function shell(children, theme) {
    return {
        type: "widget",
        padding: [12, 12, 12, 12],
        backgroundGradient: {
            type: "linear",
            colors: theme.bg,
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        children: children
    };
}

function buildMedium(view, theme) {
    return shell([
        // 头部
        hstack([
            icon("location.fill", 12, theme.accent),
            sp(4),
            txt(view.location, 13, "bold", theme.text),
            sp(),
            txt("刚刚更新", 10, "medium", theme.textMuted)
        ]),
        sp(10),
        // 中间主体
        hstack([
            vstack([
                txt(view.temp, 38, "bold", theme.text),
                txt(view.text + " | 湿度 " + view.humidity, 13, "medium", theme.textMuted)
            ], { flex: 1 }),
            icon(view.icon, 40, theme.accent)
        ]),
        sp(10),
        // 底部小时预报
        hstack(view.hourly.map(h => vstack([
            txt(h.fxTime.split('T')[1].substring(0,2) + "时", 9, "medium", theme.textMuted),
            sp(4),
            icon(iconForWeather(h.icon, false), 14, theme.accent),
            sp(4),
            txt(Math.round(h.temp) + "°", 11, "semibold", theme.text)
        ], { flex: 1, alignItems: "center" })))
    ], theme);
}

function buildSmall(view, theme) {
    return shell([
        hstack([icon(view.icon, 20, theme.accent), sp(), txt(view.location, 10, "bold", theme.textMuted)]),
        sp(8),
        txt(view.temp, 32, "bold", theme.text),
        txt(view.text, 14, "semibold", theme.textMuted),
        sp(),
        hstack([
            tag("湿度 " + view.humidity, theme.accent, theme.card, 10),
            sp(),
            tag("实时", "#10B981", "rgba(16,185,129,0.1)", 8)
        ])
    ], theme);
}

// ============== 基础函数库 ==============

function hstack(children, opts = {}) {
    return { type: "stack", direction: "row", alignItems: "center", children, ...opts };
}

function vstack(children, opts = {}) {
    return { type: "stack", direction: "column", alignItems: "start", children, ...opts };
}

function txt(text, size, weight, color) {
    return { type: "text", text: String(text), font: { size, weight }, textColor: color };
}

function icon(name, size, color) {
    return { type: "image", src: "sf-symbol:" + name, width: size, height: size, color: color };
}

function sp(len) { return { type: "spacer", length: len }; }

function tag(text, color, bg, size) {
    return hstack([txt(text, size, "bold", color)], { padding: [2, 6, 2, 6], backgroundColor: bg, borderRadius: 4 });
}

function iconForWeather(code, isNight) {
    const c = parseInt(code || "100");
    if (c === 100) return isNight ? "moon.stars.fill" : "sun.max.fill";
    if (c <= 104) return isNight ? "cloud.moon.fill" : "cloud.sun.fill";
    if (c >= 300 && c <= 399) return "cloud.rain.fill";
    return "cloud.fill";
}

function computeIsNight(today) {
    if (!today || !today.sunrise) return false;
    const now = new Date();
    const sr = new Date(today.fxDate + "T" + today.sunrise + ":00");
    const ss = new Date(today.fxDate + "T" + today.sunset + ":00");
    return now < sr || now > ss;
}

function normalizeHost(h) { return h.startsWith("http") ? h.replace(/\/$/, "") : "https://" + h; }
function loadCache(ctx) { try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; } }
function saveCache(ctx, data) { try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { } }

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        backgroundGradient: { type: "linear", colors: ["#FEF2F2", "#FEE2E2"] },
        children: [
            txt(title, 16, "bold", "#991B1B"),
            sp(4),
            txt(msg, 12, "medium", "#B91C1C")
        ]
    };
}
