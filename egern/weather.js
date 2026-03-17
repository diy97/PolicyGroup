// 天气通勤全功能组件 - 适配深浅色模式
// 功能：实况、极值、舒适度、昨日对比、穿衣、风感、湿度

const CACHE_KEY = "weather_full_v3";

export default async function (ctx) {
    const env = ctx.env || {};
    const family = ctx.widgetFamily || "systemMedium";
    const host = normalizeHost(env.HOST || "https://devapi.qweather.com");
    const apiKey = env.API_KEY;
    const location = env.LOCATION;

    if (!apiKey || !location) return errorWidget("配置缺失", "需设置 API_KEY 和 LOCATION");

    try {
        const data = await getAllData(ctx, host, apiKey, location);
        const view = transform(data, env.LOCATION_NAME || "当前位置");
        const theme = view.theme;

        if (family === "systemSmall") return buildSmall(view, theme);
        if (family === "systemLarge") return buildLarge(view, theme);
        return buildMedium(view, theme);
    } catch (e) {
        return errorWidget("获取失败", e.message);
    }
}

// ============== 数据处理 ==============

async function getAllData(ctx, host, apiKey, location) {
    const now = Date.now();
    const cached = loadCache(ctx);
    if (cached && (now - cached.ts < 1800000)) return cached;

    const [nowRes, dailyRes, yesterdayRes] = await Promise.all([
        fetchJson(ctx, `${host}/v7/weather/now?location=${location}&key=${apiKey}`),
        fetchJson(ctx, `${host}/v7/weather/7d?location=${location}&key=${apiKey}`),
        // 这里的昨日对比逻辑：取历史天气或从7日预报的缓存中对比
        fetchJson(ctx, `${host}/v7/historical/weather?location=${location}&date=${getYesterdayDate()}&key=${apiKey}`).catch(() => ({ code: "404" }))
    ]);

    const res = {
        now: nowRes.now,
        today: dailyRes.daily[0],
        yesterday: yesterdayRes.weatherDaily || null,
        ts: now
    };
    saveCache(ctx, res);
    return res;
}

function transform(data, locName) {
    const now = data.now;
    const today = data.today;
    const yest = data.yesterday;
    
    const temp = parseInt(now.temp);
    const yestTemp = yest ? parseInt(yest.tempMax) : (temp - 2); // 兜底逻辑
    const diff = temp - yestTemp;

    // 舒适度算法 (简易版)
    const humidity = parseInt(now.humidity);
    const score = Math.max(0, 100 - Math.abs(temp - 22) * 2 - (humidity > 70 ? (humidity-70)*0.5 : 0));
    
    const isNight = computeIsNight(today);

    return {
        location: locName,
        temp: temp + "°",
        high: today.tempMax + "°",
        low: today.tempMin + "°",
        text: now.text,
        feelsLike: now.feelsLike + "°",
        wind: now.windDir + now.windScale + "级",
        humidity: humidity + "%",
        diffText: `较昨 ${diff >= 0 ? '+' : ''}${diff}°`,
        comfort: score > 80 ? "舒适" : (score > 60 ? "良好" : "一般"),
        advice: getClothing(temp),
        icon: iconForWeather(now.icon, isNight),
        theme: {
            accent: isNight ? "#8B5CF6" : "#3B82F6",
            text: { light: "#111827", dark: "#FFFFFF" },
            textMuted: { light: "#6B7280", dark: "#9CA3AF" },
            bg: [
                { light: "#FFFFFF", dark: "#111827" }, 
                { light: "#F3F4F6", dark: "#0F172A" }
            ],
            card: { light: "#F9FAFB", dark: "rgba(255,255,255,0.05)" }
        }
    };
}

// ============== UI 布局 (中尺寸适配所有需求) ==============

function buildMedium(view, theme) {
    return shell([
        // 第一行：位置与更新时间
        hstack([
            icon("location.fill", 12, theme.accent), sp(4),
            txt(view.location, 13, "bold", theme.text), sp(),
            txt("今日概览", 10, "medium", theme.textMuted)
        ]),
        sp(12),
        // 第二行：大文字温度 + 天气图标
        hstack([
            vstack([
                hstack([
                    txt(view.temp, 42, "bold", theme.text),
                    sp(8),
                    vstack([
                        txt(view.text, 16, "semibold", theme.text),
                        txt(`${view.low} / ${view.high}`, 12, "medium", theme.textMuted)
                    ])
                ]),
            ], { flex: 1 }),
            icon(view.icon, 45, theme.accent)
        ]),
        sp(12),
        // 第三行：数据网格 (体感、风速、湿度、较昨日)
        hstack([
            dataItem("体感", view.feelsLike, theme), sp(),
            dataItem("风速", view.wind, theme), sp(),
            dataItem("湿度", view.humidity, theme), sp(),
            dataItem("对比", view.diffText, theme)
        ]),
        sp(10),
        // 第四行：舒适度与穿衣建议 (高亮条)
        hstack([
            tag("舒适度 " + view.comfort, theme.accent, theme.card, 10),
            sp(8),
            tag("建议: " + view.advice, "#10B981", theme.card, 10),
            sp()
        ])
    ], theme);
}

function buildLarge(view, theme) {
    // 大尺寸可以展开更多细节
    return buildMedium(view, theme); // 此处可根据需要进一步扩展
}

// ============== 辅助组件 ==============

function dataItem(label, value, theme) {
    return vstack([
        txt(label, 10, "medium", theme.textMuted),
        sp(2),
        txt(value, 12, "bold", theme.text)
    ], { alignItems: "center" });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size, "bold", color)], { 
        padding: [4, 8, 4, 8], 
        backgroundColor: bg, 
        borderRadius: 6 
    });
}

function shell(children, theme) {
    return {
        type: "widget",
        padding: [15, 15, 15, 15],
        backgroundGradient: {
            type: "linear",
            colors: theme.bg,
            startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 }
        },
        children: children
    };
}

// ============== 逻辑工具 ==============

function getClothing(temp) {
    if (temp >= 28) return "短袖短裤";
    if (temp >= 22) return "单层长袖";
    if (temp >= 15) return "夹克/薄毛衣";
    if (temp >= 5) return "大衣/厚外套";
    return "羽绒服";
}

function iconForWeather(code, isNight) {
    const c = parseInt(code);
    if (c === 100) return isNight ? "moon.stars.fill" : "sun.max.fill";
    if (c <= 104) return isNight ? "cloud.moon.fill" : "cloud.sun.fill";
    if (c >= 300 && c <= 399) return "cloud.rain.fill";
    if (c >= 400 && c <= 499) return "snowflake";
    return "cloud.fill";
}

function computeIsNight(today) {
    if (!today) return false;
    const now = new Date();
    const ss = new Date(today.fxDate + "T" + today.sunset + ":00");
    const sr = new Date(today.fxDate + "T" + today.sunrise + ":00");
    return now > ss || now < sr;
}

function getYesterdayDate() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

// 标准辅助函数
function hstack(children, opts = {}) { return { type: "stack", direction: "row", alignItems: "center", children, ...opts }; }
function vstack(children, opts = {}) { return { type: "stack", direction: "column", alignItems: "start", children, ...opts }; }
function txt(text, size, weight, color) { return { type: "text", text: String(text), font: { size, weight }, textColor: color }; }
function icon(name, size, color) { return { type: "image", src: "sf-symbol:" + name, width: size, height: size, color: color }; }
function sp(len) { return { type: "spacer", length: len }; }
async function fetchJson(ctx, url) { const r = await ctx.http.get(url); return await r.json(); }
function normalizeHost(h) { return h.replace(/\/$/, ""); }
function loadCache(ctx) { try { return ctx.storage.getJSON(CACHE_KEY); } catch(e) { return null; } }
function saveCache(ctx, data) { try { ctx.storage.setJSON(CACHE_KEY, data); } catch(e) {} }
function errorWidget(t, m) { return { type: "widget", children: [txt(t, 16, "bold", "#EF4444"), txt(m, 12, "medium", "#EF4444")] }; }
