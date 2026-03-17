// iOS 风格全功能天气组件 (修复背景色报错版)
// 功能：动态天气背景、实况、极值、舒适度、对比、建议、逐时预报

const CACHE_KEY = "weather_ios_style_v5";

export default async function (ctx) {
    const env = ctx.env || {};
    const family = ctx.widgetFamily || "systemMedium";
    const host = normalizeHost(env.HOST || "https://devapi.qweather.com");
    const apiKey = env.API_KEY;
    const location = env.LOCATION;

    if (!apiKey || !location) return errorWidget("配置缺失", "需设置 API_KEY 和 LOCATION");

    try {
        const data = await getAllData(ctx, host, apiKey, location);
        
        // 关键修复：判断当前系统是否为深色模式
        const isDark = ctx.isDarkMode || (ctx.traitCollection && ctx.traitCollection.userInterfaceStyle === "dark");
        
        const view = transform(data, env.LOCATION_NAME || "当前位置", isDark);
        
        if (family === "systemSmall") return buildSmall(view);
        if (family === "systemLarge") return buildLarge(view);
        return buildMedium(view);
    } catch (e) {
        console.log("Error: " + e.message);
        return errorWidget("获取失败", e.message);
    }
}

// ============== 数据处理 ==============

async function getAllData(ctx, host, apiKey, location) {
    const now = Date.now();
    const cached = loadCache(ctx);
    if (cached && (now - cached.ts < 1800000)) return cached;

    const [nowRes, hourlyRes, dailyRes] = await Promise.all([
        fetchJson(ctx, `${host}/v7/weather/now?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/24h?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/7d?location=${location}&key=${apiKey}`)
    ]);

    const res = {
        now: nowRes.now,
        hourly: hourlyRes.hourly ? hourlyRes.hourly.slice(0, 8) : [], 
        today: dailyRes.daily ? dailyRes.daily[0] : null,
        ts: now
    };
    saveCache(ctx, res);
    return res;
}

function transform(data, locName, isDark) {
    const now = data.now;
    const today = data.today;
    const isNight = computeIsNight(today);
    const temp = parseInt(now.temp);
    
    // 背景颜色逻辑
    const weatherType = getWeatherType(now.icon);
    const theme = getDynamicTheme(weatherType, isNight, isDark);

    return {
        location: locName,
        temp: temp + "°",
        high: today ? today.tempMax + "°" : "--",
        low: today ? today.tempMin + "°" : "--",
        text: now.text,
        feelsLike: now.feelsLike + "°",
        wind: now.windScale + "级",
        humidity: now.humidity + "%",
        advice: getClothing(temp),
        hourly: data.hourly.map(h => ({
            time: h.fxTime.split('T')[1].split(':')[0] + "时",
            icon: iconForWeather(h.icon, false),
            temp: Math.round(h.temp) + "°"
        })),
        theme: theme
    };
}

// ============== 动态主题逻辑 (修复核心) ==============

function getDynamicTheme(type, isNight, isDark) {
    const themes = {
        sunny: { light: ["#4FA1FB", "#80C4F9"], dark: ["#1D3B5A", "#0B1220"] },
        cloudy: { light: ["#89A3B3", "#B1C5D3"], dark: ["#37474F", "#1C252A"] },
        rainy: { light: ["#4A6278", "#728A9E"], dark: ["#1A2632", "#0D131A"] },
        night: { light: ["#1B2845", "#354E71"], dark: ["#0B0E14", "#161B22"] }
    };

    const selected = isNight ? themes.night : (themes[type] || themes.cloudy);
    
    // 修复点：根据 isDark 参数，直接返回一组纯色字符串数组
    const finalBg = isDark ? selected.dark : selected.light;
    const textColor = "#FFFFFF"; // 天气背景下通常白色文字视觉最好
    const cardColor = isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.2)";

    return {
        bg: finalBg, // 这里现在是 ["#color1", "#color2"]
        text: textColor,
        textMuted: "rgba(255,255,255,0.7)",
        card: cardColor
    };
}

// ============== UI 布局 ==============

function buildMedium(view) {
    const theme = view.theme;
    return shell([
        hstack([
            vstack([
                txt(view.location, 14, "bold", theme.text),
                txt(`${view.text}  H:${view.high} L:${view.low}`, 11, "medium", theme.textMuted)
            ]),
            sp(),
            txt(view.temp, 34, "light", theme.text)
        ]),
        sp(8),
        hstack([
            miniItem("体感", view.feelsLike, theme), sp(),
            miniItem("湿度", view.humidity, theme), sp(),
            miniItem("风力", view.wind, theme), sp(),
            miniItem("穿衣", view.advice, theme)
        ], { padding: [6, 10, 6, 10], backgroundColor: theme.card, borderRadius: 10 }),
        sp(10),
        hstack(view.hourly.slice(0, 6).map(h => vstack([
            txt(h.time, 9, "medium", theme.textMuted),
            sp(4),
            icon(h.icon, 14, theme.text),
            sp(4),
            txt(h.temp, 11, "bold", theme.text)
        ], { flex: 1, alignItems: "center" })))
    ], theme);
}

function miniItem(label, value, theme) {
    return vstack([
        txt(label, 8, "medium", theme.textMuted),
        txt(value, 10, "bold", theme.text)
    ], { alignItems: "center", width: 55 });
}

function shell(children, theme) {
    return {
        type: "widget",
        padding: [12, 12, 12, 12],
        backgroundGradient: {
            type: "linear",
            colors: theme.bg, // 确保这里是 Array<String>
            startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 1 }
        },
        children: children
    };
}

// ============== 基础函数 ==============

function getWeatherType(icon) {
    const c = parseInt(icon);
    if (c === 100) return "sunny";
    if (c <= 104) return "cloudy";
    if (c >= 300 && c <= 399) return "rainy";
    if (c >= 400 && c <= 499) return "snowy";
    return "others";
}

function getClothing(temp) {
    if (temp >= 28) return "短袖";
    if (temp >= 20) return "薄衫";
    if (temp >= 12) return "外套";
    return "厚服";
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

function hstack(children, opts = {}) { return { type: "stack", direction: "row", alignItems: "center", children, ...opts }; }
function vstack(children, opts = {}) { return { type: "stack", direction: "column", alignItems: "start", children, ...opts }; }
function txt(text, size, weight, color) { return { type: "text", text: String(text), font: { size, weight }, textColor: color }; }
function icon(name, size, color) { return { type: "image", src: "sf-symbol:" + name, width: size, height: size, color: color }; }
function sp(len) { return { type: "spacer", length: len }; }
async function fetchJson(ctx, url) { const r = await ctx.http.get(url); return await r.json(); }
function normalizeHost(h) { return h.replace(/\/$/, ""); }
function loadCache(ctx) { try { return ctx.storage.getJSON(CACHE_KEY); } catch(e) { return null; } }
function saveCache(ctx, data) { try { ctx.storage.setJSON(CACHE_KEY, data); } catch(e) {} }
function errorWidget(t, m) { return { type: "widget", padding: 16, children: [txt(t, 14, "bold", "#FF3B30"), txt(m, 10, "medium", "#FF3B30")] }; }
function buildSmall(v) { return buildMedium(v); }
function buildLarge(v) { return buildMedium(v); }
