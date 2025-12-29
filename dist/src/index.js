import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { getMarketContext, analyzeStockStream } from './analyzer.js';
const app = new Hono();
const welcomeStrings = [
    'Hello Hono!',
    'To learn more about Hono on Vercel, visit https://vercel.com/docs/frameworks/backend/hono'
];
app.get('/', (c) => {
    return c.text(welcomeStrings.join('\n\n'));
});
// 批量分析接口 (流式)
app.post('/api/analyze', async (c) => {
    try {
        const body = await c.req.json();
        const code = body.code;
        const holdingInfo = body.holdingInfo; // { status, cost, quantity, profit }
        if (!code || typeof code !== 'string') {
            return c.json({ error: '请提供有效的股票代码 (code)' }, 400);
        }
        console.log(`收到 API 分析请求，股票: ${code}, 持仓状态: ${holdingInfo?.status || 'unknown'}`);
        // 1. 获取大盘基准
        const indexHistory = await getMarketContext();
        if (!indexHistory || indexHistory.length === 0) {
            return c.json({ error: '无法获取大盘数据，服务暂时不可用' }, 503);
        }
        // 获取数据中的最新交易日期
        const lastDataPoint = indexHistory[indexHistory.length - 1];
        const tradingDate = lastDataPoint.date;
        const now = new Date();
        // 判断当前运行场景
        let sceneNote = "";
        if (now.getHours() < 9) {
            sceneNote = "【盘前预警】当前为开盘前，以下建议基于上一交易日收盘数据，适用于今日操作。";
        }
        else if (now.getHours() >= 15) {
            sceneNote = "【盘后复盘】今日交易已结束，以下建议适用于下一交易日。";
        }
        else {
            sceneNote = "【盘中参考】当前市场正在交易，数据可能存在波动。";
        }
        let finalReport = `**数据基准日:** ${tradingDate}\n\n`;
        finalReport += `**报告生成时间:** ${now.toLocaleString()}\n\n`;
        finalReport += `**当前场景:** ${sceneNote}\n\n`;
        return streamText(c, async (stream) => {
            // Send meta data
            await stream.write(JSON.stringify({
                type: 'meta',
                data: {
                    finalReport,
                    benchmark_date: tradingDate,
                    timestamp: now.toISOString()
                }
            }) + "\n");
            // Stream stock analysis
            const stockStream = analyzeStockStream(code, indexHistory, holdingInfo);
            for await (const chunk of stockStream) {
                await stream.write(chunk);
            }
            await stream.write(JSON.stringify({ type: 'done' }) + "\n");
        });
    }
    catch (err) {
        console.error('API Error:', err);
        return c.json({ error: err.message }, 500);
    }
});
export default app;
