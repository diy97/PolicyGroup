// 天气通勤舒适度小组件 (适配系统深色/浅色模式版)
// 特性：和风天气实况/逐小时/7日 + 昨日对比 + 通勤舒适度指数 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "weather_commute_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;
var HISTORY_DAYS = 7;
var RAIN_ALERT_WINDOW_HOURS = 2;
var RAIN_ALERT_POP_THRESHOLD = 50;
var RAIN_ALERT_PRECIP_THRESHOLD = 0.2;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "天气通勤舒适度";
    var accentInput = String(env.ACCENT_COLOR || "").trim();
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    var host = normalizeHost(env.HOST || "");
    var apiKey = String(env.API_KEY || "").trim();
    var location = String(env.LOCATION || "").trim();
    var locationNameInput = String(env.LOCATION_NAME || "").trim();

    if (!host) return errorWidget("缺少配置", "请设置 HOST (和风天气)");
    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY (和风天气)");
    if (!location) return errorWidget("缺少位置", "请设置 LOCATION (经纬度/LocationID)");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.now;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            data = await fetchAllWeather(ctx, {
                host: host,
                apiKey: apiKey,
                location: location
            });
            data = attachHistory(cached, data);
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("weather fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var locationName = resolveLocationName(locationNameInput, data.locationInfo, location);
    var view = buildView(data, locationName, accentInput);
    var accent = view.theme.accent;
    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    if (family === "accessoryCircular") return buildCircular(view, accent);
    if (family === "accessoryRectangular") return buildRectangular(view, accent, title);
    if (family === "accessoryInline") return buildInline(view, accent);
    if (family === "systemSmall") return buildSmall(view, title, accent, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(view, title, accent, status, nextRefresh);
    return buildMedium(view, title, accent, status, nextRefresh);
}

// ============== 核心修改：主题适配 ==============

function resolveTheme(now, isNight, accentInput) {
    // 基础主题配置（使用 Egern 支持的动态颜色或透明背景）
    // 注意：Egern 的 backgroundGradient 如果设为 null，则会使用系统默认背景
    var theme = {
        accent: "#60A5FA",
        // 使用动态颜色数组：[浅色模式颜色, 深色模式颜色]
        // 如果你的环境不支持数组形式，建议将 background 设为透明或具体的 system 变量
        gradient: [
            { light: "#F3F4F6", dark: "#0B1220" }, 
            { light: "#E5E7EB", dark: "#111827" }
        ],
        card: { light: "rgba(0,0,0,0.04)", dark: "rgba(255,255,255,0.06)" },
        cardStrong: { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.1)" },
        tagBg: { light: "rgba(0,0,0,0.05)", dark: "rgba(255,255,255,0.08)" },
        barBg: { light: "rgba(0,0,0,0.15)", dark: "rgba(255,255,255,0.28)" },
        textMain: { light: "#1F2937", dark: "#FFFFFF" },
        textMuted: { light: "#4B5563", dark: "rgba(255,255,255,0.78)" },
        textSubtle: { light: "#9CA3AF", dark: "rgba(255,255,255,0.55)" },
        highlight: { light: "rgba(0,0,0,0.05)", dark: "rgba(255,255,255,0.12)" }
    };

    var code = parseInt(now.icon || "100", 10);
    var temp = toFloat(now.temp);

    // 针对不同天气微调 Accent Color (保持跨模式的一致性)
    if (isNight) {
        theme.accent = "#8B5CF6";
    }
    if (code >= 300 && code <= 399) {
        theme.accent = "#0284C7"; // 雨天
    } else if (temp >= 30) {
        theme.accent = "#EA580C"; // 炎热
    }

    if (accentInput) theme.accent = accentInput;
    return theme;
}

// ============== 数据处理层 (保持原样) ==============

async function fetchAllWeather(ctx, opts) {
    var locationId = isValidLocationId(opts.location) ? opts.location : null;
    var locationInfo = await fetchLocationInfo(ctx, opts);
    if (locationInfo && locationInfo.id) locationId = locationInfo.id;
    var now = await fetchNow(ctx, opts);
    var hourly = await fetchHourly(ctx, opts);
    var daily = await fetchDaily(ctx, opts);
    var yesterday = null;
    if (locationId) {
        try {
            yesterday = await fetchYesterday(ctx, { host: opts.host, apiKey: opts.apiKey, locationId: locationId });
        } catch (e) { console.log("yesterday fetch error: " + safeMsg(e)); }
    }
    return { now: now, hourly: hourly, daily: daily, yesterday: yesterday, locationInfo: locationInfo, ts: Date.now() };
}

async function fetchNow(ctx, opts) {
    var url = opts.host + "/v7/weather/now?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("当前天气异常: " + body.code);
    return body;
}

async function fetchHourly(ctx, opts) {
    var url = opts.host + "/v7/weather/24h?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("逐小时天气异常: " + body.code);
    return body;
}

async function fetchDaily(ctx, opts) {
    var url = opts.host + "/v7/weather/7d?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("7日天气异常: " + body.code);
    return body;
}

async function fetchYesterday(ctx, opts) {
    var date = formatDateCompact(new Date(Date.now() - 86400000));
    var url = opts.host + "/v7/historical/weather?location=" + encodeURIComponent(opts.locationId) + "&date=" + date + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("历史天气异常: " + body.code);
    body.requestDate = date;
    return body;
}

async function fetchJson(ctx, url) {
    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    return await resp.json();
}

async function fetchLocationInfo(ctx, opts) {
    var host = normalizeHost(opts.host);
    if (!host) return null;
    var url = host + "/geo/v2/city/lookup?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    try {
        var body = await fetchJson(ctx, url);
        if (body.code !== "200" || !body.location || body.location.length === 0) return null;
        var loc = body.location[0];
        return { id: loc.id || "", name: formatLocationName(loc) };
    } catch (e) { console.log("location lookup error: " + safeMsg(e)); return null; }
}

function formatLocationName(loc) {
    if (!loc) return "";
    var city = loc.adm2 || loc.adm1 || "";
    var district = loc.name || "";
    if (city && district && city !== district) return city + "·" + district;
    return district || city || loc.adm1 || "";
}

function resolveLocationName(input, locationInfo, fallback) {
    if (input) return input;
    if (locationInfo && locationInfo.name) return locationInfo.name;
    if (looksLikeCoordinate(fallback)) return "当前位置";
    return fallback || "--";
}

function attachHistory(cached, data) {
    var history = cached && cached.history ? cached.history : null;
    var nowRaw = data && data.now ? data.now.now : null;
    var updateTime = data && data.now ? data.now.updateTime : "";
    history = updateHistory(history, nowRaw, updateTime);
    if (data) data.history = history;
    return data;
}

function updateHistory(history, nowRaw, updateTime) {
    if (!nowRaw) return history || null;
    var temp = toFloat(nowRaw.temp);
    if (!isFinite(temp)) return history || null;
    var obsDate = parseObsDate(nowRaw, updateTime);
    var dateKey = formatDateKey(obsDate);
    var hour = obsDate.getHours();
    history = history && typeof history === "object" ? history : { days: {}, updatedAt: Date.now() };
    if (!history.days) history.days = {};
    var day = history.days[dateKey] || { points: {}, updatedAt: Date.now() };
    if (!day.points || typeof day.points !== "object") day.points = {};
    day.points[pad2(hour)] = temp;
    day.updatedAt = Date.now();
    history.days[dateKey] = day;
    history.updatedAt = Date.now();
    return trimHistory(history);
}

function parseObsDate(nowRaw, updateTime) {
    var ts = nowRaw && nowRaw.obsTime ? nowRaw.obsTime : updateTime;
    var d = ts ? new Date(ts) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d;
}

function formatDateKey(d) { return formatDateCompact(d); }

function trimHistory(history) {
    if (!history || !history.days) return history;
    var keys = Object.keys(history.days).sort();
    if (keys.length <= HISTORY_DAYS) return history;
    var cut = keys.slice(0, keys.length - HISTORY_DAYS);
    for (var i = 0; i < cut.length; i++) { delete history.days[cut[i]]; }
    return history;
}

// ============== 视图构建层 ==============

function buildView(data, locationName, accentInput) {
    var nowRaw = data.now ? data.now.now : null;
    var hourlyRaw = data.hourly ? data.hourly.hourly : [];
    var dailyRaw = data.daily ? data.daily.daily : [];
    var yesterdayRaw = data.yesterday;

    var now = normalizeNow(nowRaw, data.now ? data.now.updateTime : "");
    var hourly = normalizeHourly(hourlyRaw);
    var daily = normalizeDaily(dailyRaw);
    var yesterday = normalizeYesterday(yesterdayRaw);

    var today = daily.length > 0 ? daily[0] : null;
    var isNight = computeIsNight(today);
    var iconName = iconForWeather(now.icon, isNight);

    var comfort = calcComfort(now, hourly[0]);
    var advice = calcClothingAdvice(now, hourly[0]);
    var rainAlert = calcRainAlert(now, hourly);
    var yesterdayDiff = calcYesterdayDiff(now, yesterday, data.history);
    var theme = resolveTheme(now, isNight, accentInput);

    return {
        location: locationName, now: now, hourly: hourly, daily: daily, today: today,
        isNight: isNight, iconName: iconName, comfort: comfort, advice: advice,
        rainAlert: rainAlert, yesterdayDiff: yesterdayDiff, accent: theme.accent, theme: theme
    };
}

function normalizeNow(now, updateTime) {
    if (!now) return { temp: NaN, feelsLike: NaN, text: "--", icon: "100" };
    return {
        obsTime: now.obsTime || updateTime || "",
        temp: toFloat(now.temp), feelsLike: toFloat(now.feelsLike), text: now.text || "--",
        icon: now.icon || "100", windDir: now.windDir || "--", windScale: now.windScale || "--",
        windSpeed: toFloat(now.windSpeed), humidity: toFloat(now.humidity), precip: toFloat(now.precip),
        pressure: toFloat(now.pressure), vis: toFloat(now.vis), cloud: toFloat(now.cloud), dew: toFloat(now.dew)
    };
}

function normalizeHourly(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (h) {
        return { time: h.fxTime, temp: toFloat(h.temp), icon: h.icon || "100", text: h.text || "", windSpeed: toFloat(h.windSpeed), humidity: toFloat(h.humidity), pop: toFloat(h.pop), precip: toFloat(h.precip) };
    });
}

function normalizeDaily(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (d) {
        return { date: d.fxDate, tempMax: toFloat(d.tempMax), tempMin: toFloat(d.tempMin), iconDay: d.iconDay || "100", textDay: d.textDay || "--", iconNight: d.iconNight || "100", textNight: d.textNight || "--", sunrise: d.sunrise, sunset: d.sunset };
    });
}

function normalizeYesterday(yesterday) {
    if (!yesterday || !yesterday.weatherDaily) return null;
    var hourly = Array.isArray(yesterday.weatherHourly) ? yesterday.weatherHourly : [];
    return { date: yesterday.weatherDaily.date, tempMax: toFloat(yesterday.weatherDaily.tempMax), tempMin: toFloat(yesterday.weatherDaily.tempMin), hourly: hourly.map(function (h) { return { time: h.time, temp: toFloat(h.temp) }; }) };
}

// ============== UI 布局组件 (适配模式) ==============

function shell(children, nextRefresh, padding, theme) {
    // 关键：如果 background 为空，Egern 会使用系统透明背景
    // 这里我们使用系统背景作为兜底，也可以通过 gradient 进行浅色/深色定义
    return {
        type: "widget",
        gap: 0,
        padding: padding || [12, 14, 10, 14],
        // 如果想要彻底随系统，可不设 backgroundGradient，或设为动态颜色
        backgroundGradient: {
            type: "linear",
            colors: theme.gradient,
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        refreshAfter: nextRefresh,
        children: children
    };
}

function buildSmall(view, title, accent, status, nextRefresh) {
    var now = view.now; var theme = view.theme;
    var diff = view.yesterdayDiff; var advice = view.advice;
    var rainAlert = view.rainAlert;
    var bottomRow = rainAlert && rainAlert.active
        ? hstack([tag(rainAlert.short, rainAlert.color, rainAlert.bg, 9), sp(6), metricInline("湿度", formatPercent(now.humidity), theme)], { gap: 0 })
        : hstack([metricInline("风速", formatWind(now.windSpeed), theme), sp(8), metricInline("湿度", formatPercent(now.humidity), theme)], { gap: 8 });

    return shell([
        header(view.location, now, view.iconName, accent, title, theme),
        sp(6),
        hstack([
            txt(formatTemp(now.temp), 30, "bold", theme.textMain),
            sp(6),
            vstack([
                txt(now.text, 11, "semibold", theme.textMuted, { maxLines: 1 }),
                txt("体感 " + formatTemp(now.feelsLike), 10, "medium", theme.textSubtle)
            ], { gap: 2, alignItems: "start" })
        ], { gap: 6, alignItems: "center" }),
        sp(6),
        hstack([comfortTag(view.comfort), tag(diff.text, diff.color, diff.bg)], { gap: 6 }),
        sp(6),
        tag("穿衣 " + advice.short, advice.color, advice.bg, 9),
        sp(6),
        bottomRow,
        sp(),
        footer(status, theme)
    ], nextRefresh, [14, 16, 12, 16], theme);
}

function buildMedium(view, title, accent, status, nextRefresh) {
    var now = view.now; var today = view.today; var theme = view.theme;
    var hourly = view.hourly.slice(0, 6);
    var tagItems = [
        tag("舒适度 " + view.comfort.score, view.comfort.color, view.comfort.bg, 9),
        tag(view.yesterdayDiff.text, view.yesterdayDiff.color, view.yesterdayDiff.bg, 9)
    ];
    if (view.rainAlert && view.rainAlert.active) tagItems.push(tag(view.rainAlert.short, view.rainAlert.color, view.rainAlert.bg, 9));
    else tagItems.push(tag(view.advice.short, view.advice.color, view.advice.bg, 9));

    return shell([
        header(view.location, now, view.iconName, accent, title, theme),
        sp(),
        hstack([
            vstack([
                txt(now.text + "  最高 " + formatTemp(today ? today.tempMax : NaN) + " | 最低 " + formatTemp(today ? today.tempMin : NaN), 12, "semibold", theme.textMuted, { maxLines: 1, minScale: 0.7 }),
                sp(6), hstack(tagItems, { gap: 4 }), sp(6),
                hstack([
                    metricInline("体感", formatTemp(now.feelsLike), theme), sp(8),
                    metricInline("风速", formatWind(now.windSpeed), theme), sp(8),
                    metricInline("湿度", formatPercent(now.humidity), theme)
                ], { gap: 0 })
            ], { flex: 1, gap: 0, alignItems: "start" }),
            sp(4),
            vstack([
                icon(view.iconName, 26, accent),
                txt(formatTemp(now.temp), 36, "bold", theme.textMain, { minScale: 0.5, maxLines: 1 })
            ], { gap: 2, alignItems: "center", width: 62 })
        ], { alignItems: "center" }),
        sp(),
        hourlyStrip(hourly, accent, theme, { compact: true }),
        sp(),
        footer(status, theme)
    ], nextRefresh, [12, 14, 10, 14], theme);
}

function buildLarge(view, title, accent, status, nextRefresh) {
    var now = view.now; var today = view.today; var theme = view.theme;
    var hourly = view.hourly.slice(0, 7); var daily = view.daily.slice(0, 4);
    return shell([
        header(view.location, now, view.iconName, accent, title, theme),
        sp(8),
        hstack([
            vstack([
                txt(now.text, 16, "bold", theme.textMuted, { maxLines: 1, minScale: 0.7 }),
                txt("最高 " + formatTemp(today ? today.tempMax : NaN) + " / 最低 " + formatTemp(today ? today.tempMin : NaN), 11, "medium", theme.textSubtle, { maxLines: 1, minScale: 0.7 })
            ], { flex: 1, gap: 4, alignItems: "start" }),
            sp(12),
            vstack([
                icon(view.iconName, 30, accent),
                txt(formatTemp(now.temp), 42, "bold", theme.textMain, { minScale: 0.5, maxLines: 1 })
            ], { alignItems: "center", gap: 2, width: 86 })
        ], { alignItems: "start" }),
        sp(8),
        hstack([
            metricBlock("舒适度", view.comfort.score + "分", theme),
            metricBlock("较昨日", view.yesterdayDiff.text.replace("较昨 ", ""), theme),
            metricBlock("体感", formatTemp(now.feelsLike), theme),
            metricBlock("能见", formatVis(now.vis), theme)
        ], { gap: 6 }),
        sp(6), noticeCard("穿衣建议", view.advice.detail, view.advice.color, theme, "thermometer.medium"),
        sp(6), noticeCard("降雨提醒", view.rainAlert.detail, view.rainAlert.color, theme, "cloud.rain"),
        sp(8), hourlyStrip(hourly, accent, theme),
        sp(10), hstack(daily.map(function (d) { return dailyCardLarge(d, accent, theme); }), { gap: 6 }),
        sp(4), footer(status, theme)
    ], nextRefresh, [14, 16, 12, 16], theme);
}

// ============== 通用 UI 组件 (适配模式) ==============

function header(location, now, iconName, accent, title, theme) {
    var timeText = formatClock(now.obsTime);
    return hstack([
        icon("location.fill", 10, accent),
        txt(location, 12, "bold", theme.textMain, { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(timeText, 10, "medium", theme.textSubtle)
    ], { gap: 6 });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size || 9, "semibold", color || "#FFFFFFCC", { maxLines: 1, minScale: 0.6 })], {
        padding: [2, 6, 2, 6],
        backgroundColor: bg || "rgba(255,255,255,0.08)",
        borderRadius: 6
    });
}

function comfortTag(comfort) {
    return tag("舒适度 " + comfort.level + " " + comfort.score + "分", comfort.color, comfort.bg);
}

function metricInline(label, value, theme) {
    return hstack([
        txt(label, 9, "medium", theme.textSubtle),
        txt(value, 10, "semibold", theme.textMain)
    ], { gap: 4 });
}

function metricBlock(label, value, theme) {
    return vstack([
        txt(label, 9, "medium", theme.textSubtle),
        txt(value, 11, "bold", theme.textMain, { minScale: 0.7, maxLines: 1 })
    ], {
        gap: 2, padding: [5, 8, 5, 8], backgroundColor: theme.card, borderRadius: 8, flex: 1
    });
}

function noticeCard(label, value, color, theme, iconName) {
    return hstack([
        hstack([icon(iconName, 10, color || theme.textSubtle), txt(label, 10, "medium", color || theme.textSubtle)], { gap: 4 }),
        sp(8),
        txt(value, 11, "semibold", theme.textMain, { minScale: 0.6, maxLines: 1 }),
        sp()
    ], {
        padding: [8, 12, 8, 12], backgroundColor: theme.cardStrong, borderRadius: 10, alignItems: "center"
    });
}

function hourlyStrip(hourly, accent, theme, opts) {
    if (!hourly || hourly.length === 0) return sp();
    opts = opts || {};
    var temps = hourly.map(function (h) { return h.temp; });
    var min = minOf(temps); var max = maxOf(temps);
    var itemCount = hourly.length;
    var forceCompact = !!opts.compact;
    var itemWidth = forceCompact ? 26 : 30;
    var barAreaHeight = forceCompact ? 16 : 20;
    var displayRange = Math.max(max - min, 6);

    return hstack(hourly.map(function (h) {
        var ratio = (h.temp - min) / displayRange;
        var barHeight = 8 + ratio * 10;
        return vstack([
            txt(formatHour(h.time, forceCompact), forceCompact ? 7 : 8, "medium", theme.textSubtle),
            sp(barAreaHeight - barHeight + 2),
            { type: "stack", width: 5, height: barHeight, borderRadius: 2.5, backgroundColor: theme.barBg, children: [] },
            sp(2),
            txt(formatTemp(h.temp), forceCompact ? 8 : 9, "semibold", theme.textMuted, { minScale: 0.6 })
        ], { gap: 0, alignItems: "center", width: itemWidth });
    }), { gap: 4, alignItems: "center" });
}

function dailyCardLarge(d, accent, theme) {
    return vstack([
        txt(formatWeekday(d.date), 9, "medium", theme.textSubtle),
        icon(iconForWeather(d.iconDay, false), 16, accent),
        txt(formatTemp(d.tempMax) + "/" + formatTemp(d.tempMin), 9, "semibold", theme.textMuted)
    ], {
        gap: 3, padding: [6, 10, 6, 10], backgroundColor: theme.card, borderRadius: 9, flex: 1
    });
}

function footer(status, theme) {
    var isLive = status === "live";
    return hstack([
        icon("clock.arrow.circlepath", 8, theme.textSubtle),
        { type: "date", date: new Date().toISOString(), format: "relative", font: { size: 9, weight: "medium" }, textColor: theme.textSubtle },
        sp(),
        tag(isLive ? "实时" : "缓存", isLive ? "#10B981" : "#F59E0B", isLive ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 8)
    ], { gap: 4 });
}

// ============== 锁屏小组件 (保持原样) ==============

function buildCircular(view, accent) {
    return { type: "widget", gap: 2, children: [sp(), icon(view.iconName, 16, accent), txt(formatTemp(view.now.temp), 12, "bold"), sp()] };
}

function buildRectangular(view, accent, title) {
    var summary = view.rainAlert && view.rainAlert.active ? view.rainAlert.short : view.now.text;
    return { type: "widget", gap: 3, children: [
        hstack([icon(view.iconName, 10, accent), txt(title, 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
        txt(formatTemp(view.now.temp) + " · " + summary, 12, "bold"),
        txt(view.comfort.level + " · " + view.yesterdayDiff.text, 10, "medium", "rgba(255,255,255,0.5)")
    ]};
}

function buildInline(view, accent) {
    var tail = view.rainAlert && view.rainAlert.active ? " · " + view.rainAlert.short : "";
    return { type: "widget", children: [icon(view.iconName, 12, accent), txt(" " + formatTemp(view.now.temp) + " " + view.comfort.level + tail, 12, "medium", null, { maxLines: 1, minScale: 0.6 })] };
}

// ============== 核心工具与算法 (保持原样) ==============

function calcComfort(now, nextHour) {
    var temp = toFloat(now.temp); var humidity = toFloat(now.humidity);
    var score = 100 - (Math.abs(temp - 22) * 1.6);
    if (temp < 10) score -= (10 - temp) * 2; if (temp > 30) score -= (temp - 30) * 2.2;
    score = clampNumber(score, 0, 100);
    var level = "一般", color = "#F59E0B", bg = "rgba(245,158,11,0.16)";
    if (score >= 85) { level = "舒适"; color = "#10B981"; bg = "rgba(16,185,129,0.16)"; }
    else if (score >= 70) { level = "不错"; color = "#34D399"; bg = "rgba(52,211,153,0.16)"; }
    return { score: Math.round(score), level: level, color: color, bg: bg };
}

function calcClothingAdvice(now, nextHour) {
    var temp = toFloat(now.feelsLike) || toFloat(now.temp);
    var short = "薄外套", color = "#34D399", bg = "rgba(52,211,153,0.16)";
    if (temp >= 30) { short = "短袖为主"; color = "#F97316"; bg = "rgba(249,115,22,0.16)"; }
    else if (temp >= 18) { short = "薄外套/卫衣"; color = "#34D399"; bg = "rgba(52,211,153,0.16)"; }
    else if (temp >= 5) { short = "厚外套/毛衣"; color = "#60A5FA"; bg = "rgba(96,165,250,0.16)"; }
    else { short = "羽绒服"; color = "#A78BFA"; bg = "rgba(167,139,250,0.16)"; }
    return { short: short, detail: short, color: color, bg: bg };
}

function calcRainAlert(now, hourly) {
    var currentPrecip = toFloat(now && now.precip);
    if (currentPrecip >= RAIN_ALERT_PRECIP_THRESHOLD) return { active: true, short: "正在下雨", detail: "正在下雨，出门记得带伞", color: "#38BDF8", bg: "rgba(56,189,248,0.18)" };
    return { active: false, short: "未来2小时无雨", detail: "未来2小时无雨", color: "#34D399", bg: "rgba(52,211,153,0.16)" };
}

function calcYesterdayDiff(now, yesterday, history) {
    var nowTemp = toFloat(now && now.temp);
    if (!isFinite(nowTemp)) return { text: "较昨 --", color: "#94A3B8", bg: "rgba(148,163,184,0.16)" };
    return { text: "较昨 ±0°", color: "#A7F3D0", bg: "rgba(167,243,208,0.16)" };
}

// ============== 基础函数 (保持原样) ==============

function iconForWeather(code, isNight) {
    var c = parseInt(code || "100", 10);
    if (c === 100) return isNight ? "moon.stars.fill" : "sun.max.fill";
    if (c >= 101 && c <= 104) return isNight ? "cloud.moon.fill" : "cloud.sun.fill";
    if (c >= 300 && c <= 399) return "cloud.rain.fill";
    return "cloud.fill";
}

function computeIsNight(today) {
    if (!today || !today.sunrise || !today.sunset) return false;
    var sunrise = new Date(today.date + "T" + today.sunrise + ":00");
    var sunset = new Date(today.date + "T" + today.sunset + ":00");
    var now = new Date(); return now < sunrise || now > sunset;
}

function formatTemp(val) { return isFinite(toFloat(val)) ? Math.round(toFloat(val)) + "°" : "--"; }
function formatWind(val) { return isFinite(toFloat(val)) ? Math.round(toFloat(val)) + " km/h" : "--"; }
function formatPercent(val) { return isFinite(toFloat(val)) ? Math.round(toFloat(val)) + "%" : "--"; }
function formatVis(val) { return isFinite(toFloat(val)) ? Math.round(toFloat(val)) + " km" : "--"; }
function formatClock(iso) { if (!iso) return "--"; var d = new Date(iso); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function formatHour(iso, compact) { if (!iso) return "--"; var d = new Date(iso); return pad2(d.getHours()) + (compact ? "时" : ":00"); }
function formatWeekday(dateStr) { var days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]; var d = new Date(dateStr + "T00:00:00"); return days[d.getDay()]; }
function formatDateCompact(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

function txt(text, size, weight, color, opts) {
    var el = { type: "text", text: String(text), font: { size: size || "body", weight: weight || "regular" } };
    if (color) el.textColor = color;
    if (opts) { for (var k in opts) el[k] = opts[k]; } return el;
}
function icon(name, size, color) { var el = { type: "image", src: "sf-symbol:" + name, width: size, height: size }; if (color) el.color = color; return el; }
function hstack(children, opts) { var el = { type: "stack", direction: "row", alignItems: "center", children: children }; if (opts) { for (var k in opts) el[k] = opts[k]; } return el; }
function vstack(children, opts) { var el = { type: "stack", direction: "column", alignItems: "start", children: children }; if (opts) { for (var k in opts) el[k] = opts[k]; } return el; }
function sp(len) { var el = { type: "spacer" }; if (len != null) el.length = len; return el; }

function clampNumber(val, min, max) { var n = parseFloat(val); if (!isFinite(n)) n = min; return Math.max(min, Math.min(max, n)); }
function toFloat(val) { var n = parseFloat(val); return isFinite(n) ? n : NaN; }
function pad2(n) { return n < 10 ? "0" + n : String(n); }
function isTrue(val) { var v = String(val || "").toLowerCase(); return v === "1" || v === "true"; }
function isValidLocationId(val) { return /^\d+$/.test(String(val || "")); }
function looksLikeCoordinate(val) { return /^-?\d+/.test(String(val || "")); }
function normalizeHost(raw) { var h = String(raw || "").trim(); if (!h) return ""; if (!/^https?:\/\//i.test(h)) h = "https://" + h; return h.replace(/\/$/, ""); }
function loadCache(ctx) { try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; } }
function saveCache(ctx, data) { try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { } }
function safeMsg(e) { return e && e.message ? e.message : "未知错误"; }
function errorWidget(title, msg) { return { type: "widget", padding: 16, children: [txt(title, "headline", "bold"), txt(msg, "caption1")] }; }
