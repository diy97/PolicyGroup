// 修正后的 URL，加上引号
const url = `https://api.jijinhao.com/quoteCenter/realTime.htm?codes=JO_92233&_=${Date.now()}`;
const headers = {
  "Referer": "https://m.cngold.org/",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
};

// 品牌模拟数据
const brands = [
  { name: "周大福", price: 1060 },
  { name: "老凤祥", price: 1063 },
  { name: "周生生", price: 1060 },
  { name: "周大生", price: 1060 },
  { name: "六福珠宝", price: 1060 },
  { name: "老庙", price: 1063 },
  { name: "金至尊", price: 1060 },
  { name: "潮宏基", price: 1060 },
  { name: "艺品尚", price: 1059 },
  { name: "老银匠", price: 1059 }
];

$httpClient.get({ url, headers }, function (error, response, data) {
  if (error) {
    $notification.post("黄金价格查询失败", "", error);
    $done();
    return;
  }

  try {
    // 更加稳妥的 JSON 提取方式
    const jsonMatch = data.match(/\{.*\}/);
    if (!jsonMatch) throw new Error("无法提取 JSON 数据");
    
    const json = JSON.parse(jsonMatch[0]);
    const gold = json["JO_92233"];

    // 修正逻辑运算符：!gold || !gold.q63 ...
    if (!gold || gold.q63 === undefined || gold.q80 === undefined) {
      $notification.post("黄金价格解析失败", "", "接口返回数据异常");
      $done();
      return;
    }

    const spotPrice = parseFloat(gold.q63).toFixed(2);
    const change = parseFloat(gold.q80).toFixed(2);
    const symbol = change >= 0 ? "📈" : "📉";

    const now = new Date();
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`; // 使用反引号

    // 构建排行榜
    const list = brands.map((b, i) => {
      const arrow = b.price > 1060 ? "↑" : (b.price < 1060 ? "↓" : "");
      return `${i + 1}. ${b.name} ${b.price}${arrow}`;
    }).join("\n");

    // 格式化内容
    const content = `现货黄金: ${spotPrice} 元\n涨跌幅: ${symbol} ${change}%\n\n${list}`;

    $notification.post(`黄金价格 · ${dateStr}`, "", content);
  } catch (e) {
    $notification.post("脚本运行错误", "", e.message);
  }

  $done();
});
