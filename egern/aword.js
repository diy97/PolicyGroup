export default async function (ctx) {
  const type = ctx.env.TYPE || "";
  const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;

  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "未知";

  try {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    const data = await resp.json();
    hitokoto = data.hitokoto;
    from = data.from_who
      ? `${data.from_who}「${data.from}」`
      : `「${data.from}」`;
  } catch {
    // 使用默认值
  }

  const refreshTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // 定义适配颜色的辅助方法
  const adaptiveColor = (light, dark) => ({ light, dark });

  return {
    type: "widget",
    padding: 16,
    // 背景渐变：浅色模式为暖黄，深色模式为深灰/黑
    backgroundGradient: {
      type: "linear",
      colors: [
        adaptiveColor("#FEF3C7", "#1C1C1E"), 
        adaptiveColor("#FDE68A", "#2C2C2E")
      ],
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
        // 图标透明度适配
        color: adaptiveColor("#92400E66", "#FFFFFF44"),
      },
      { type: "spacer" },
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        // 文字颜色：浅色为深褐，深色为白色
        textColor: adaptiveColor("#78350F", "#FFFFFF"),
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
            // 出处颜色：浅色为半透明褐，深色为半透明白
            textColor: adaptiveColor("#92400EAA", "#FFFFFF88"),
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}
