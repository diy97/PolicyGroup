/**
 * 一言 (Hitokoto) 自动适配版 v1.2.2
 * 修复：解决 ctx.config.appearance 为 undefined 导致的崩溃
 * 方案：使用 Egern 原生 { light, dark } 颜色对象
 */

export default async function (ctx) {
  const VERSION = "v1.2.2";
  
  // 1. 定义自动适配的颜色对象
  // Egern 渲染引擎会自动根据系统模式选择对应的字符串
  const adaptiveColor = (light, dark) => ({ light, dark });

  const theme = {
    // 背景渐变适配
    bg: [
      adaptiveColor("#FEF3C7", "#1C1C1E"), 
      adaptiveColor("#FDE68A", "#000000")
    ],
    text: adaptiveColor("#78350F", "#FFFFFF"),
    sub: adaptiveColor("#92400EAA", "#FFFFFF66")
  };

  // 2. 默认内容
  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "「未知」";

  // 3. 安全获取网络数据
  try {
    const type = ctx.env.TYPE || "";
    const url = `https://v1.hitokoto.cn/?c=${type}`;
    
    // 使用 Egern 推荐的请求方式
    const response = await ctx.http.get(url).catch(() => null);
    
    if (response && response.body) {
      const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (data && data.hitokoto) {
        hitokoto = data.hitokoto;
        from = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
      }
    }
  } catch (e) {
    // 忽略错误，确保渲染
  }

  // 4. 返回 Widget 对象
  return {
    type: "widget",
    padding: 16,
    // 将适配对象直接传给 colors
    backgroundGradient: {
      type: "linear",
      colors: theme.bg,
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 }
    },
    refreshAfter: new Date(Date.now() + 1000 * 60 * 20).toISOString(),
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "image",
            src: "sf-symbol:quote.opening",
            width: 16,
            height: 16,
            color: theme.sub,
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 9 },
            textColor: theme.sub,
          }
        ]
      },
      { type: "spacer" },
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: theme.text,
        maxLines: 4,
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
            textColor: theme.sub,
            maxLines: 1,
          }
        ]
      }
    ]
  };
}
