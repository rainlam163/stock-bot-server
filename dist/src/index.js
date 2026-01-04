import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { getMarketContext, analyzeStockStream } from './analyzer.js';
import { getRecommendations } from './db.js';
import { runSelectionJob } from './worker.js';
const app = new Hono();
const welcomeStrings = [
    'Stock-Bot API Service',
    'Current Time: ' + new Date().toISOString()
];
app.get('/', (c) => {
    return c.text(welcomeStrings.join('\n\n'));
});
// 智能选股接口 (读取数据库)
app.get('/api/recommend', async (c) => {
    try {
        const data = getRecommendations();
        // 如果数据库为空（第一次运行），尝试同步触发一次（或者返回空并提示）
        if (!data.list || data.list.length === 0) {
            // Option A: 立即触发一次（由于Vercel超时限制，可能不适合，但本地演示可以）
            // await runSelectionJob(); 
            // return c.json(getRecommendations().list);
            // Option B: 返回空提示
            return c.json([], 200);
        }
        return c.json(data.list);
    }
    catch (err) {
        console.error('Recommend API Error:', err);
        return c.json({ error: '获取推荐失败' }, 500);
    }
});
// 手动触发选股任务 (Admin Only)
// 在实际生产中，这应该是一个受保护的接口或由 Cron Job 触发
app.post('/api/trigger-selection', async (c) => {
    // 异步执行，不阻塞 HTTP 响应 (Vercel 上可能需要等待，这里演示用)
    // 注意：在 Vercel Serverless 上，响应结束后进程可能被冻结。
    // 正确做法是使用 Vercel Cron 或外部定时任务调用此接口。
    const result = await runSelectionJob();
    return c.json(result);
});
// 批量分析接口 (流式) - 保持不变
app.post('/api/analyze', async (c) => {
    try {
        const body = await c.req.json();
        const code = body.code;
        const holdingInfo = body.holdingInfo;
        if (!code || typeof code !== 'string') {
            return c.json({ error: '请提供有效的股票代码 (code)' }, 400);
        }
        console.log(`收到 API 分析请求，股票: ${code}, 持仓状态: ${holdingInfo?.status || 'unknown'}`);
        // 1. 获取大盘基准
        const indexHistory = await getMarketContext();
        if (!indexHistory || indexHistory.length === 0) {
            return c.json({ error: '无法获取大盘数据，服务暂时不可用' }, 503);
        }
        const lastDataPoint = indexHistory[indexHistory.length - 1];
        const tradingDate = lastDataPoint.date;
        const now = new Date();
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
            await stream.write(JSON.stringify({
                type: 'meta',
                data: {
                    finalReport,
                    benchmark_date: tradingDate,
                    timestamp: now.toISOString()
                }
            }) + "\n");
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
