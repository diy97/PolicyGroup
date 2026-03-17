/**
 * 一言（Hitokoto）小组件 v1.1.2
 * 修复: 彻底解决 MISSING type 报错
 * 功能: 适配深浅模式 + 版本显示 + 容错增强
 */

export default async function (ctx) {
  // 1. 初始化默认值（防止 API 崩溃导致无返回）
  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "「未知」";
  const VERSION = "v1.1.2";
  
  // 2. 环境判断
  const type = ctx.env.TYPE || "";
  const isDark = ctx.config.appearance === "dark";
  
  // 3. 颜色定义 (显式字符串)
  const bgColor = isDark ? "#1C1C1E" : "#FEF3C7";
  const textColor = isDark ? "#FFFFFF" : "#78350F";
  const subColor = isDark ? "#FFFFFF66" : "#92400EAA";

  // 4. 尝试获取 API 数据
  try {
    const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;
    const resp = await ctx.http.get(url, { timeout: 2000 }).catch(() => null);
    
    if (resp && resp.status === 200) {
      const data = await resp.json();
      if (data && data.hitokoto) {
        hitokoto = data.hitokoto;
        from = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
      }
    }
  } catch (err) {
    // 即使出错也保持静默，确保下方 return 执行
    hitokoto = "数据加载暂缓，请刷新重试。";
  }

  // 5. 构造并返回 Widget 对象
  // 注意：type: "widget" 必须是返回对象的第一个属性
  return {
    type: "widget",
    refreshAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    padding: 16,
    // 先用纯色背景测试，解决报错问题
    backgroundColor: bgColor,
    children: [
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
            color: subColor,
          },
          { type: "spacer" },
          {
            type: "text",
            text: VERSION,
            font: { size: 10 },
            textColor: subColor,
          }
        ]
      },
      { type: "spacer" },
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: textColor,
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
            textColor: subColor,
            maxLines: 1,
          },
        ],
      },
    ],
  };
}
