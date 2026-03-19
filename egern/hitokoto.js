// =============================================================
// 一言（Hitokoto）小组件
// 每次刷新展示一条随机名言/语录，支持多种类型筛选。
// 数据来源：hitokoto.cn 公共 API
//
// 版本：1.3.0
//
// 环境变量：
//   TYPE - 句子类型，可选 a(动画) b(漫画) c(游戏) d(文学) e(原创)
//          f(来自网络) g(其他) h(影视) i(诗词) j(网易云) k(哲学)
//          默认不限
// =============================================================

export default async function (ctx) {
  const type = ctx.env.TYPE || "";
  const url = `https://v1.hitokoto.cn/${type ? `?c=${type}` : ""}`;

  let hitokoto = "生活不止眼前的苟且，还有诗和远方。";
  let from = "未知";
  let errorMsg = null;

  try {
    const resp = await ctx.http.get(url, { timeout: 5000 });
    const data = await resp.json();
    hitokoto = data.hitokoto;
    from = data.from_who
      ? `${data.from_who}「${data.from}」`
      : `「${data.from}」`;
  } catch (e) {
    errorMsg = String(e);
  }

  // 30 分钟后刷新
  const refreshTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // ---------------------------------------------------------------
  // 颜色定义
  // 根据官方文档，Color 类型支持自适应对象 { light: "...", dark: "..." }
  // 适用于所有 Color 类型的属性：backgroundColor、textColor、color、borderColor 等
  // ---------------------------------------------------------------

  // 背景色：浅色暖黄 / 深色暗棕
  const bgColor = { light: "#FEF3C7", dark: "#1C1407" };

  // 引号图标色：浅色深棕半透明 / 深色亮黄半透明
  const iconColor = { light: "#92400E66", dark: "#FDE68A66" };

  // 正文颜色：浅色深棕 / 深色亮黄
  const quoteColor = { light: "#78350F", dark: "#FDE68A" };

  // 出处颜色：浅色深棕透明 / 深色亮黄透明
  const fromColor = { light: "#92400EAA", dark: "#FDE68AAA" };

  // 错误提示颜色：浅色红 / 深色浅红
  const errorColor = { light: "#DC2626", dark: "#FCA5A5" };

  return {
    type: "widget",
    padding: 16,
    gap: 0,
    // 使用自适应纯色背景，颜色随系统深色/浅色模式自动切换
    backgroundColor: bgColor,
    refreshAfter: refreshTime,
    children: [
      // 顶部引号图标
      {
        type: "image",
        src: "sf-symbol:quote.opening",
        width: 20,
        height: 20,
        color: iconColor,
      },

      { type: "spacer" },

      // 请求出错时显示错误信息，方便定位问题
      ...(errorMsg
        ? [
            {
              type: "text",
              text: `请求失败：${errorMsg}`,
              font: { size: "caption2" },
              textColor: errorColor,
              maxLines: 3,
              minScale: 0.7,
            },
            { type: "spacer" },
          ]
        : []),

      // 一言正文
      {
        type: "text",
        text: hitokoto,
        font: { size: "callout", weight: "medium" },
        textColor: quoteColor,
        maxLines: 4,
        minScale: 0.8,
      },

      { type: "spacer" },

      // 出处，右对齐
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
            textColor: fromColor,
            maxLines: 1,
            minScale: 0.7,
          },
        ],
      },
    ],
  };
}
