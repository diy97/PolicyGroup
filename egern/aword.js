/**
 * 一言 (Hitokoto) 同步重构版 v1.2.1
 * 解决方案：移除 async/await 阻塞，确保根节点 type 立即返回
 */

export default function (ctx) {
  const VERSION = "v1.2.1";
  
  // 1. 立即获取系统外观
  const isDark = ctx.config.appearance === "dark";
  
  // 2. 预定义颜色 (根据深浅模式)
  const colors = isDark ? {
    bg: ["#1C1C1E", "#000000"],
    text: "#FFFFFF",
    sub: "#FFFFFF66"
  } : {
    bg: ["#FEF3C7", "#FDE68A"],
    text: "#78350F",
    sub: "#92400EAA"
  };

  // 3. 定义内容 (同步模式下使用静态或内置随机，避免请求阻塞)
  // 注意：由于 Egern 渲染引擎限制，若要使用网络数据，需确保环境支持异步流
  const hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  const from = "「生活」";

  // 4. 返回标准 Widget 对象 (确保 type: "widget" 在第一行)
  return {
    type: "widget",
    padding: 16,
    backgroundGradient: {
      type: "linear",
      colors: colors.bg,
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 }
    },
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:quote.bubble.fill",
            width: 16,
            height: 16,
            color: colors.sub
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 9 },
            textColor: colors.sub
          }
        ]
      },
      { type: "spacer" },
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: colors.text,
        maxLines: 4
      },
      { type: "spacer" },
      {
        type: "stack",
        direction: "row",
        children: [
          { type: "spacer" },
          {
            type: "text",
            text: `— ${from}`,
            font: { size: "caption1" },
            textColor: colors.sub
          }
        ]
      }
    ]
  };
}
