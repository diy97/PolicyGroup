export default async function (ctx) {
  const type = ctx.env.TYPE || "";
  const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;

  // 1. 获取当前系统外观 ('light' 或 'dark')
  const isDark = ctx.config.appearance === "dark";

  // 2. 根据模式定义配色方案
  const theme = isDark 
    ? {
        bg: ["#1C1C1E", "#2C2C2E"], // 深色背景
        text: "#FFFFFF",            // 白色文字
        subText: "#FFFFFF88",       // 半透明白
        icon: "#FFFFFF44"           // 浅白图标
      }
    : {
        bg: ["#FEF3C7", "#FDE68A"], // 浅色背景（原黄色）
        text: "#78350F",            // 深褐文字
        subText: "#92400EAA",       // 半透明褐
        icon: "#92400E66"           // 浅褐图标
      };

  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "未知";

  try {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    const data = await resp.json();
    hitokoto = data.hitokoto;
    from = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
  } catch { /* 保持默认值 */ }

  const refreshTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  return {
    type: "widget",
    padding: 16,
    // 关键：根据主题变量直接注入颜色数组
    backgroundGradient: {
      type: "linear",
      colors: theme.bg, 
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 },
    },
    refreshAfter: refreshTime,
    children: [
      {
        type: "image",
        src: "sf-symbol:quote.opening",
        width: 20,
        height: 20,
        color: theme.icon,
      },
      { type: "spacer" },
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: theme.text,
        maxLines: 4,
        minScale: 0.8,
      },
      { type: "spacer" },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          { type: "spacer" },
          {
            type: "text",
            text: `— ${from}`,
            font: { size: "caption1" },
            textColor: theme.subText,
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}
