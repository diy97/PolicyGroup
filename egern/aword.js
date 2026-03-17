/**
 * 一言 (Hitokoto) 官方标准重构版 v1.2.0
 * 适配：系统深浅模式、全量 API 参数、版本显示
 * 修复：彻底解决 Egern 渲染引擎的 type 缺失异常
 */

export default async function (ctx) {
  const VERSION = "v1.2.0";
  
  // 1. 优先级最高：获取系统外观
  const isDark = ctx.config.appearance === "dark";
  
  // 2. 预定义 UI 配色
  const theme = {
    bg: isDark ? ["#1C1C1E", "#000000"] : ["#FEF3C7", "#FDE68A"],
    text: isDark ? "#FFFFFF" : "#78350F",
    sub: isDark ? "#EBEBF599" : "#92400EAA"
  };

  // 3. 构建请求参数 (参考官方文档)
  // 可在环境变量中设置 TYPE (如 a,b,c) 和 MIN_LEN, MAX_LEN
  const params = new URLSearchParams();
  if (ctx.env.TYPE) params.append("c", ctx.env.TYPE);
  if (ctx.env.MIN_LEN) params.append("min_length", ctx.env.MIN_LEN);
  if (ctx.env.MAX_LEN) params.append("max_length", ctx.env.MAX_LEN);
  params.append("charset", "utf-8");

  const url = `https://v1.hitokoto.cn/?${params.toString()}`;

  // 4. 默认兜底数据
  let data = {
    hitokoto: "生活不止眼前的苟且，还有诗和远方。",
    from: "生活",
    from_who: "佚名"
  };

  // 5. 异步请求 (增强容错)
  try {
    const response = await ctx.http.get({ url, timeout: 3000 });
    if (response && response.body) {
      // 官方文档返回的是字符串，需确保解析安全
      const json = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (json && json.hitokoto) {
        data = json;
      }
    }
  } catch (err) {
    console.log(`[Hitokoto Error] ${err}`);
  }

  // 6. 格式化来源显示
  const sourceText = data.from_who 
    ? `${data.from_who}「${data.from}」` 
    : `「${data.from}」`;

  // 7. 最终返回 (严格遵循 Egern Widget JSON 规范)
  return {
    type: "widget",
    padding: 16,
    refreshAfter: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    backgroundGradient: {
      type: "linear",
      colors: theme.bg,
      stops: [0, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 }
    },
    children: [
      // 顶部栏
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
            color: theme.sub
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 9, weight: "light" },
            textColor: theme.sub
          }
        ]
      },
      { type: "spacer" },
      // 语录主体
      {
        type: "text",
        text: data.hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: theme.text,
        maxLines: 4,
        minScale: 0.8
      },
      { type: "spacer" },
      // 底部来源
      {
        type: "stack",
        direction: "row",
        children: [
          { type: "spacer" },
          {
            type: "text",
            text: `— ${sourceText}`,
            font: { size: "caption1" },
            textColor: theme.sub,
            maxLines: 1
          }
        ]
      }
    ]
  };
}
