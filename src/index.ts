import { Hono } from 'hono'
import { getMarketContext, analyzeStock } from './analyzer.js'

const app = new Hono()

const welcomeStrings = [
  'Hello Hono!',
  'To learn more about Hono on Vercel, visit https://vercel.com/docs/frameworks/backend/hono'
]

app.get('/', (c) => {
  return c.text(welcomeStrings.join('\n\n'))
})

// 批量分析接口
app.post('/api/analyze', async (c) => {
  const body = await c.req.json();
  const codes = body.codes;

  if (!codes || !Array.isArray(codes) || codes.length === 0) {
    return c.json({ error: '请提供有效的股票代码数组 (codes)' }, 400);
  }

  console.log(`收到 API 分析请求，股票列表: ${codes.join(', ')}`);

  // 1. 获取大盘基准
  const indexHistory = await getMarketContext();
  if (!indexHistory || indexHistory.length === 0) {
    return c.json({ error: '无法获取大盘数据，服务暂时不可用' }, 503);
  }

  // 2. 批量分析
  const results = [];
  for (const code of codes) {
    const result = await analyzeStock(code, indexHistory);
    results.push(result);
    // 简单限流
    await new Promise(r => setTimeout(r, 1000));
  }

  return c.json({
    success: true,
    timestamp: new Date().toISOString(),
    benchmark_date: indexHistory[indexHistory.length - 1].date,
    results: results
  });
});

export default app
