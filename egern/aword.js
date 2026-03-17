/**
 * 一言（Hitokoto）小组件 v1.1.1
 * 修复: 根节点 type 缺失报错
 * 功能: 适配深浅模式 + 版本显示
 */

export default async function (ctx) {
  // 1. 基础定义
  const VERSION = "v1.1.1";
  const type = ctx.env.TYPE || "";
  const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;
  
  // 2. 默认内容
  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "未知";

  // 3. 异步获取数据
  try {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    if (resp && resp.status === 200) {
      const data = await resp.json();
      hitokoto = data.hitokoto || hitokoto;
      from = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
    }
  } catch (e) {
    // 捕获网络异常，确保小组件不崩溃
  }

  // 4. 环境检测与色彩分支
  const isDark = ctx.config.appearance === "dark";
  const bgColors = isDark ? ["#1C1C1E", "#000000"] : ["#FEF3C7", "#FDE68A"];
  const mainTextColor = isDark ? "#FFFFFF" : "#78350F";
  const subTextColor = isDark ? "#FFFFFF66" : "#92400EAA";

  // 5. 刷新时间 (30分钟)
  const refreshTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // 6. 返回规范的小组件对象
  return {
    type: "widget", // 必须在根部
    refreshAfter: refreshTime,
    padding: 16,
    backgroundGradient: {
      type: "linear",
      colors: bgColors,
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 },
    },
    children: [
      // 顶部栏：图标与版本
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
            color: subTextColor,
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 10, weight: "regular" },
            textColor: subTextColor,
          }
        ]
      },

      { type: "spacer" },

      // 内容区
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: mainTextColor,
        maxLines: 4,
        minScale: 0.8,
      },

      { type: "spacer" },

      // 底部出处
      {
        type: "stack",
        direction: "row",
        children: [
          { type: "spacer" },
          {
            type: "text",
            text: `— ${from}`,
            font: { size: "caption1" },
            textColor: subTextColor,
            maxLines: 1,
          },
        ],
      },
    ],
  };
}
