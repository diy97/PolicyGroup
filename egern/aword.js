/**
 * 一言（Hitokoto）小组件 v1.1.0
 * 适配系统深浅模式 + 版本显示
 */

export default async function (ctx) {
  // 1. 获取基础配置
  const type = ctx.env.TYPE || "";
  const VERSION = "v1.1.0";
  const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;

  // 2. 检测系统外观 (Egern 核心判断)
  const isDark = ctx.config.appearance === "dark";

  // 3. 配置配色方案 (强制显式赋值)
  const colors = isDark 
    ? {
        bg: ["#1C1C1E", "#000000"], // 深色模式：深灰到全黑
        text: "#FFFFFF",            // 白色文字
        sub: "#EBEBF599",           // 次级文字（iOS标准半透明白）
        quote: "#FFFFFF4D"          // 引号图标（更淡的白色）
      }
    : {
        bg: ["#FEF3C7", "#FDE68A"], // 浅色模式：原黄色渐变
        text: "#78350F",            // 深褐色文字
        sub: "#92400EAA",           // 次级文字
        quote: "#92400E66"          // 引号图标
      };

  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "未知";

  // 4. 获取数据
  try {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    const data = await resp.json();
    hitokoto = data.hitokoto;
    from = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
  } catch (e) {
    // 失败时保持默认
  }

  const refreshTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  return {
    type: "widget",
    padding: 16,
    // 强制使用当前模式对应的背景
    backgroundGradient: {
      type: "linear",
      colors: colors.bg,
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 },
    },
    refreshAfter: refreshTime,
    children: [
      // 顶部：引号图标 + 版本号
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:quote.opening",
            width: 18,
            height: 18,
            color: colors.quote,
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 9, weight: "light" },
            textColor: colors.quote, // 与图标同色，降低视觉干扰
          }
        ]
      },

      { type: "spacer" },

      // 中间：引文内容
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: colors.text,
        maxLines: 4,
        minScale: 0.8,
      },

      { type: "spacer" },

      // 底部：出处
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
            textColor: colors.sub,
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}
