// Egern 动态天气全功能组件 v4
// 特性：动态天气背景（仿iOS）、深浅色适配、逐时预报、全量指标

const CACHE_KEY = "weather_dynamic_v4";

export default async function (ctx) {
    const env = ctx.env || {};
    const family = ctx.widgetFamily || "systemMedium";
    const host = normalizeHost(env.HOST || "https://devapi.qweather.com");
    const { API_KEY: apiKey, LOCATION: location } = env;

    if (!apiKey || !location) return errorWidget("配置缺失", "需设置 API_KEY 和 LOCATION");

    try {
        const data = await getAllData(ctx, host, apiKey, location);
        const view = transform(data, env.LOCATION_NAME || "当前位置");
        
        if (family === "systemSmall") return buildSmall(view);
        if (family === "systemLarge") return buildLarge(view);
        return buildMedium(view);
    } catch (e) {
        console.log("Error: " + e.message);
        return errorWidget("获取失败", e.message);
    }
}

// ============== 数据获取与转换 ==============

async function getAllData(ctx, host, apiKey, location) {
    const nowTs = Date.now();
    const cached = loadCache(ctx);
    if (cached && (nowTs - cached.ts < 900000)) return cached; // 15分钟缓存

    const [nowRes, dailyRes, hourlyRes] = await Promise.all([
        fetchJson(ctx, `${host}/v7/weather/now?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/7d?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/24h?location=${location}&key=${apiKey}`)
    ]);

    const res = {
        now: nowRes.now,
        today: dailyRes.daily[0],
        hourly: hourlyRes.hourly.slice(0, 6),
        ts: nowTs
    };
    saveCache(ctx, res);
    return res;
}

function transform(data, locName) {
    const { now, today, hourly } = data;
    const isNight = computeIsNight(today);
    const iconCode = parseInt(now.icon);

    // 计算背景颜色 (模仿 iOS 原生)
    const theme = getDynamicTheme(iconCode, isNight);

    return {
        location: locName,
        temp: parseInt(now.temp) + "°",
        high: today.tempMax + "°",
        low: today.tempMin + "°",
        text: now.text,
        feelsLike: now.feelsLike + "°",
        wind: now.windScale + "级",
        humidity: now.humidity + "%",
        comfort: calcComfort(now),
        advice: getClothing(parseInt(now.temp)),
        icon: iconForWeather(now.icon, isNight),
        hourly: hourly.map(h => ({
            time: h.fxTime.split('T')[1].substring(0, 2) + "时",
            temp: Math.round(h.temp) + "°",
            icon: iconForWeather(h.icon, false)
        })),
        theme: theme
    };
}

// ============== 动态背景算法 ==============

function getDynamicTheme(code, isNight) {
    let colors = { light: ["#4FA1E4", "#1E6EBE"], dark: ["#1A2A44", "#0D1424"] }; // 默认晴天蓝

    if (isNight) {
        colors = { light: ["#1D2B4D", "#0F1930"], dark: ["#0B1220", "#050912"] };
    } else if (code >= 300 && code <= 399) { // 雨天
        colors = { light: ["#637893", "#3D4E66"], dark: ["#2C3E50", "#1A252F"] };
    } else if (code >= 101 && code <= 104) { // 多云/阴
        colors = { light: ["#87A1B0", "#5A7687"], dark: ["#37474F", "#263238"] };
    } else if (code >= 400) { // 雪
        colors = { light: ["#A0C4DE", "#7BA8C9"], dark: ["#2C3E50", "#1A252F"] };
    }

    return {
        bg: colors,
        text: { light: "#FFFFFF", dark: "#FFFFFF" }, // 动态背景下文字统一用白色最佳
        textMuted: { light: "rgba(255,255,255,0.7)", dark: "rgba(255,255,255,0.5)" },
        card: { light: "rgba(255,255,255,0.15)", dark: "rgba(0,0,0,0.2)" }
    };
}

// ============== UI 布局 (中尺寸) ==============

function buildMedium(view) {
    const { theme } = view;
    return shell([
        // Header
        hstack([
            icon("location.fill", 10, "#FFFFFF"), sp(4),
            txt(view.location, 12, "bold", "#FFFFFF"), sp(),
            txt("今日概览", 10, "medium", theme.textMuted)
        ]),
        sp(10),
        // Main Temp
        hstack([
            vstack([
                hstack([
                    txt(view.temp, 42, "bold", "#FFFFFF"),
                    sp(8),
                    vstack([
                        txt(view.text, 16, "semibold", "#FFFFFF"),
                        txt(`${view.low} / ${view.high}`, 12, "medium", theme.textMuted)
                    ])
                ]),
            ], { flex: 1 }),
            icon(view.icon, 45, "#FFFFFF")
        ]),
        sp(12),
        // Hourly (逐时天气)
        hstack(view.hourly.map(h => vstack([
            txt(h.time, 9, "medium", theme.textMuted),
            sp(4),
            icon(h.icon, 14, "#FFFFFF"),
            sp(4),
            txt(h.temp, 11, "bold", "#FFFFFF")
        ], { flex: 1, alignItems: "center" }))),
        sp(12),
        // Metrics Grid
        hstack([
            miniItem("体感", view.feelsLike, theme), sp(),
            miniItem("风速", view.wind, theme), sp(),
            miniItem("湿度", view.humidity, theme), sp(),
            miniItem("穿衣", view.advice, theme)
        ]),
    ], theme);
}

function buildLarge(view) { return buildMedium(view); }
function buildSmall(view) {
    return shell([
        txt(view.location, 10, "bold", view.theme.textMuted),
        txt(view.temp, 32, "bold", "#FFFFFF"),
        txt(view.text, 14, "semibold", "#FFFFFF"),
        sp(),
        tag(view.advice, "#FFFFFF", view.theme.card, 10)
    ], view.theme);
}

// ============== 辅助组件 ==============

function miniItem(label, value, theme) {
    return vstack([
        txt(label, 9, "medium", theme.textMuted),
        txt(value, 11, "bold", "#FFFFFF")
    ], { alignItems: "center", backgroundColor: theme.card, padding: [4, 8, 4, 8], borderRadius: 6 });
}

function shell(children, theme) {
    return {
        type: "widget",
        padding: [15, 15, 15, 15],
        backgroundGradient: {
            type: "linear",
            colors: theme.bg,
            startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 1 }
        },
        children: children
    };
}

// ============== 业务逻辑 ==============

function calcComfort(now) {
    const t = parseInt(now.temp);
    if (t >= 20 && t <= 26) return "舒服";
    if (t > 26) return "闷热";
    return "微凉";
}

function getClothing(temp) {
    if (temp >= 28) return "短袖";
    if (temp >= 18) return "外套";
    if (temp >= 8) return "夹克";
    return "棉衣";
}

function iconForWeather(code, isNight) {
    const c = parseInt(code);
    if (c === 100) return isNight ? "moon.stars.fill" : "sun.max.fill";
    if (c <= 104) return isNight ? "cloud.moon.fill" : "cloud.sun.fill";
    if (c >= 300 && c <= 399) return "cloud.rain.fill";
    return "cloud.fill";
}

function computeIsNight(today) {
    if (!today) return false;
    const now = new Date();
    const ss = new Date(today.fxDate + "T" + today.sunset + ":00");
    const sr = new Date(today.fxDate + "T" + today.sunrise + ":00");
    return now > ss || now < sr;
}

// 基础工具
function hstack(children, opts = {}) { return { type: "stack", direction: "row", alignItems: "center", children, ...opts }; }
function vstack(children, opts = {}) { return { type: "stack", direction: "column", alignItems: "start", children, ...opts }; }
function txt(text, size, weight, color) { return { type: "text", text: String(text), font: { size, weight }, textColor: color }; }
function icon(name, size, color) { return { type: "image", src: "sf-symbol:" + name, width: size, height: size, color: color }; }
function sp(len) { return { type: "spacer", length: len }; }
function tag(text, color, bg, size) { return hstack([txt(text, size, "bold", color)], { padding: [2, 6, 2, 6], backgroundColor: bg, borderRadius: 4 }); }
async function fetchJson(ctx, url) { const r = await ctx.http.get(url); return await r.json(); }
function normalizeHost(h) { return h.replace(/\/$/, ""); }
function loadCache(ctx) { try { return ctx.storage.getJSON(CACHE_KEY); } catch(e) { return null; } }
function saveCache(ctx, data) { try { ctx.storage.setJSON(CACHE_KEY, data); } catch(e) {} }
function errorWidget(t, m) { return { type: "widget", padding: 15, backgroundGradient: { type: "linear", colors: ["#333", "#000"] }, children: [txt(t, 14, "bold", "#FF4500"), txt(m, 10, "medium", "#AAA")] }; }
