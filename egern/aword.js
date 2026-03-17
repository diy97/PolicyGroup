/**
 * 一言（Hitokoto）小组件 v1.1.3
 * 修复策略: 极简同步渲染 + 增强型异步捕获
 */

export default async function (ctx) {
  // --- 1. 立即定义基础 UI 属性 ---
  const VERSION = "v1.1.3";
  const isDark = ctx.config.appearance === "dark";
  
  // 颜色配置
  const theme = {
    bg: isDark ? "#1C1C1E" : "#FEF3C7",
    text: isDark ? "#FFFFFF" : "#78350F",
    sub: isDark ? "#FFFFFF66" : "#92400EAA"
  };

  // --- 2. 预设默认内容 ---
  let content = "生活不止眼前的苟且，还有诗和远方。";
  let author = "「未知」";

  // --- 3. 极其谨慎的异步请求 ---
  try {
    const type = ctx.env.TYPE || "";
    const apiurl = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;
    
    // 使用短超时，防止脚本挂起
    const response = await ctx.http.get({
      url: apiurl,
      timeout: 3000
    }).catch(e => {
        console.log("Network Error: " + e);
        return null; 
    });

    if (response && response.body) {
      const data = JSON.parse(response.body);
      if (data && data.hitokoto) {
        content = data.hitokoto;
        author = data.from_who ? `${data.from_who}「${data.from}」` : `「${data.from}」`;
      }
    }
  } catch (err) {
    // 捕获 JSON 解析等所有可能的错误
    console.log("Script Error: " + err);
  }

  // --- 4. 强制返回合规对象 ---
  // 确保 type: "widget" 是第一个 key
  const widget = {
    type: "widget",
    backgroundColor: theme.bg,
    padding: 16,
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
        text: content,
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
            text: `— ${author}`,
            font: { size: "caption1" },
            textColor: theme.sub,
            maxLines: 1,
          },
        ],
      },
    ],
  };

  return widget;
}
