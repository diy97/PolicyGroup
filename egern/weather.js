// iOS 风格全功能天气组件 (样式精调版)
// 功能：动态天气背景、逐时预报、风速单位转换(m/s)、极简数据层排布

const CACHE_KEY = "weather_ios_style_v6";

export default async function (ctx) {
    const env = ctx.env || {};
    const family = ctx.widgetFamily || "systemMedium";
    const host = normalizeHost(env.HOST || "https://devapi.qweather.com");
    const apiKey = env.API_KEY;
    const location = env.LOCATION;

    if (!apiKey || !location) return errorWidget("配置缺失", "需设置 API_KEY 和 LOCATION");

    try {
        const data = await getAllData(ctx, host, apiKey, location);
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
    const nowTs = Date.now();
    const cached = loadCache(ctx);
    if (cached && (nowTs - cached.ts < 1800000)) return cached;

    const [nowRes, hourlyRes, dailyRes] = await Promise.all([
        fetchJson(ctx, `${host}/v7/weather/now?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/24h?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/7d?location=${location}&key=${apiKey}`)
    ]);

    const res = {
        now: nowRes.now,
        hourly: hourlyRes.hourly ? hourlyRes.hourly.slice(0, 8) : [], 
        today: dailyRes.daily ? dailyRes.daily[0] : null,
        ts: nowTs
    };
    saveCache(ctx, res);
    return res;
}

function transform(data, locName, isDark) {
    const now = data.now;
    const today = data.today;
    const isNight = computeIsNight(today);
    const temp = parseInt(now.temp);
    
    const weatherType = getWeatherType(now.icon);
    const theme = getDynamicTheme(weatherType, isNight, isDark);

    // 风速转换：和风天气返回的是 km/h，转换为 m/s (1 km/h ≈ 0.28 m/s)
    const windSpeedKmH = parseFloat(now.windSpeed || 0);
    const windSpeedMS = (windSpeedKmH * 0.2778).toFixed(1);

    return {
        location: locName,
        temp: temp + "°",
        high: today ? today.tempMax + "°" : "--",
        low: today ? today.tempMin + "°" : "--",
        text: now.text,
        feelsLike: now.feelsLike + "°",
        windSpeed: windSpeedMS + " m/s",
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

// ============== 动态主题逻辑 ==============

function getDynamicTheme(type, isNight, isDark) {
    const themes = {
        sunny: { light: ["#4FA1FB", "#80C4F9"], dark: ["#1D3B5A", "#0B1220"] },
        cloudy: { light: ["#89A3B3", "#B1C5D3"], dark: ["#37474F", "#1C252A"] },
        rainy: { light: ["#4A6278", "#728A9E"], dark: ["#1A2632", "#0D131A"] },
        night: { light: ["#1B2845", "#354E71"], dark: ["#0B0E14", "#161B22"] }
    };

    const selected = isNight ? themes.night : (themes[type] || themes.cloudy);
    const finalBg = isDark ? selected.dark : selected.light;

    return {
        bg: finalBg,
        text: "#FFFFFF",
        textMuted: "rgba(255,255,255,0.7)"
    };
}

// ============== UI 布局 (中尺寸) ==============

function buildMedium(view) {
    const theme = view.theme;
    return shell([
        // 第一行：位置与实况
        hstack([
            vstack([
                txt(view.location, 14, "bold", theme.text),
                txt(`${view.text}  H:${view.high} L:${view.low}`, 11, "medium", theme.textMuted)
            ]),
            sp(),
            txt(view.temp, 34, "light", theme.text)
        ]),
        sp(12),
        // 第二行：数据展示（去掉了背景框，改为与其他行一致的透明层感）
        hstack([
            miniItem("体感", view.feelsLike, theme),
            sp(),
            miniItem("湿度", view.humidity, theme),
            sp(),
            miniItem("风速", view.windSpeed, theme),
            sp(),
            miniItem("穿衣", view.advice, theme)
        ]),
        sp(15),
        // 第三行：逐时预报
        hstack(view.hourly.slice(0, 6).map(h => vstack([
            txt(h.time, 9, "medium", theme.textMuted),
            sp(4),
            icon(h.icon, 14, theme.text),
            sp(4),
            txt(h.temp, 11, "bold", theme.text)
        ], { flex: 1, alignItems: "center" })))
    ], theme);
}

// ============== 辅助组件 ==============

function miniItem(label, value, theme) {
    return vstack([
        txt(label, 8, "medium", theme.textMuted),
        sp(2),
        txt(value, 10, "bold", theme.text)
    ], { alignItems: "center", width: 55 });
}

function shell(children, theme) {
    return {
        type: "widget",
        padding: [15, 15, 12, 15],
        backgroundGradient: {
            type: "linear",
            colors: theme.bg,
            startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 1 }
        },
        children: children
    };
}

// ============== 逻辑工具 ==============

function getWeatherType(icon) {
    const c = parseInt(icon);
    if (c === 100) return "sunny";
    if (c <= 104) return "cloudy";
    if (c >= 300 && c <= 399) return "rainy";
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

// 标准函数
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
