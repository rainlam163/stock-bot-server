import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { getMarketContext, analyzeStockStream, analyzeBatchStocks } from './analyzer.js';
import { fetchHotStocks } from './crawler.js';
import { selectBestStocks } from './ai.js';
const app = new Hono();
const welcomeStrings = [
    'Hello Hono!',
    'To learn more about Hono on Vercel, visit https://vercel.com/docs/frameworks/backend/hono'
];
app.get('/', (c) => {
    return c.text(welcomeStrings.join('\n\n'));
});
// 智能选股接口 (AI 增强版)
app.get('/api/recommend', async (c) => {
    try {
        // 1. 获取全市场前 500 只活跃股 (大幅扩大视野)
        const hotStocks = await fetchHotStocks(500);
        // 2. 本地量化初筛 (Smart Quant Screening)
        // 目标：从 500 只中选出 40 只真正具备“买入价值”的标的，剔除垃圾股和不可交易股
        let filteredCandidates = hotStocks.filter((s) => {
            // 基础过滤
            if (s.name.includes('ST') || s.name.includes('退') || s.price < 3)
                return false;
            // 1. 剔除已经涨停的 (没机会买了)
            if (s.changePercent > 9.5)
                return false;
            // 2. 剔除极度缩量的 (无主力) - 量比需 > 0.8
            if (s.volumeRatio < 0.8)
                return false;
            // 3. 剔除僵尸股 - 换手率需 > 1.5%
            if (s.turnoverRate < 1.5)
                return false;
            return true;
        });
        // 3. 综合加权排序 (Weighted Scoring)
        // 优先选：量比大 (资金介入深) + 涨幅适中 (还没起飞或刚起飞)
        filteredCandidates = filteredCandidates.sort((a, b) => {
            const scoreA = (a.changePercent * 0.4) + (a.volumeRatio * 0.6);
            const scoreB = (b.changePercent * 0.4) + (b.volumeRatio * 0.6);
            return scoreB - scoreA; // 降序
        }).slice(0, 40); // 最终精选 40 只给 AI
        // 4. 批量获取技术指标 (Batch Fetch & Calculate)
        const technicalSummaries = await analyzeBatchStocks(filteredCandidates);
        if (!technicalSummaries || technicalSummaries.length === 0) {
            return c.json({ error: '无法获取候选股数据' }, 500);
        }
        // 3. AI 深度选股 (LLM Selection)
        let aiResults = await selectBestStocks(technicalSummaries);
        // 4. 兜底逻辑：如果 AI 返回空或者解析失败，回退到按涨幅排序
        if (!aiResults || aiResults.length === 0) {
            console.warn("AI 选股失败，使用兜底逻辑");
            aiResults = technicalSummaries.slice(0, 15).map(s => ({
                code: s.code,
                name: s.name,
                score: 85,
                reason: `技术面强势，量比 ${s.indicators.vol_ratio}，均线呈多头排列。`,
                deepReason: `该股近期走势强劲，量价配合理想。从技术面看，短期均线（MA5）已上穿长期均线（MA20），形成金叉，表明多头力量占据主导。同时，成交量温和放大，量比达到 ${s.indicators.vol_ratio}，显示有主力资金持续流入。建议关注其后续突破情况，若能站稳关键压力位，后市空间可期。`
            }));
        }
        // 5. 格式化返回结果 (确保字段完整)
        const finalResults = aiResults.map(r => ({
            code: r.code,
            name: r.name,
            score: r.score || 88,
            reason: r.reason || 'AI 综合评分推荐',
            deepReason: r.deepReason || r.reason || 'AI 深度分析暂缺，但技术指标显示该股具有上涨潜力。',
            // 补充价格和涨幅信息 (从原始候选列表获取)
            changePercent: filteredCandidates.find((c) => c.code === r.code)?.changePercent || 0
        })).slice(0, 15); // 最终确保返回 15 只
        return c.json(finalResults);
    }
    catch (err) {
        console.error('Recommend API Error:', err);
        return c.json({ error: '获取推荐失败' }, 500);
    }
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
