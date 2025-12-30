import { fetchHistory } from './crawler.js';
import { fetchStockNews } from './news.js';
import { getAIAdvice, getAIAdviceStream } from './ai.js';
import TI from 'technicalindicators';
/**
 * 获取大盘行情（通常是上证指数 000001）
 * @returns {Promise<Array>} K线数据
 */
async function getMarketContext() {
    const indexResult = await fetchHistory('000001', true);
    return indexResult?.klines;
}
/**
 * 批量分析股票列表 (用于选股)
 * @param {Array} candidates 候选股票列表 [{code, name, price...}]
 */
async function analyzeBatchStocks(candidates) {
    // 限制并发数，分批处理以平衡速度与稳定性
    const results = [];
    const BATCH_SIZE = 25;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const tasks = batch.map(async (stock) => {
            try {
                // 获取最近 3 个月数据即可
                const history = await fetchHistory(stock.code, false, 3);
                if (!history || !history.klines || history.klines.length < 20)
                    return null;
                const klines = history.klines;
                const closes = klines.map(k => k.close);
                const volumes = klines.map(k => k.volume);
                const lastClose = closes[closes.length - 1];
                // 计算基础指标
                // RSI
                const rsiValues = TI.RSI.calculate({ values: closes, period: 14 });
                const rsi = rsiValues[rsiValues.length - 1] || 50;
                // MACD
                const macdInput = {
                    values: closes,
                    fastPeriod: 12,
                    slowPeriod: 26,
                    signalPeriod: 9,
                    SimpleMAOscillator: false,
                    SimpleMASignal: false
                };
                const macdResults = TI.MACD.calculate(macdInput);
                const macd = macdResults[macdResults.length - 1] || { MACD: 0, signal: 0, histogram: 0 };
                // MA
                const ma5 = (closes.slice(-5).reduce((a, b) => a + b, 0) / 5);
                const ma20 = (closes.slice(-20).reduce((a, b) => a + b, 0) / 20);
                // 量比 (简单的今日量/5日均量)
                const vol5 = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
                const volRatio = vol5 > 0 ? (volumes[volumes.length - 1] / vol5) : 1;
                return {
                    code: stock.code,
                    name: stock.name,
                    price: lastClose,
                    changePercent: stock.changePercent, // 使用榜单上的实时涨幅
                    indicators: {
                        rsi: rsi.toFixed(2),
                        macd_diff: (macd.MACD || 0).toFixed(3),
                        macd_dea: (macd.signal || 0).toFixed(3),
                        macd_hist: (macd.histogram || 0).toFixed(3),
                        ma5: ma5.toFixed(2),
                        ma20: ma20.toFixed(2),
                        vol_ratio: volRatio.toFixed(2),
                        trend: ma5 > ma20 ? 'UP' : 'DOWN'
                    }
                };
            }
            catch (e) {
                console.warn(`Batch analyze error for ${stock.code}:`, e);
                return null;
            }
        });
        const batchResults = await Promise.all(tasks);
        results.push(...batchResults.filter(r => r !== null));
    }
    return results;
}
/**
 * 分析单只股票
 * @param {string} code 股票代码
 * @param {Array} indexHistory 大盘K线（基准）
 * @param {HoldingInfo} holdingInfo 持仓信息（可选）
 * @returns {Promise<Object>} 分析结果 { code, name, advice, error }
 */
async function analyzeStock(code, indexHistory, holdingInfo) {
    try {
        // 并行抓取：K线数据 + 舆情新闻
        const [stockHistory, newsList] = await Promise.all([
            fetchHistory(code),
            fetchStockNews(code)
        ]);
        if (!stockHistory?.klines?.length) {
            return {
                code,
                error: '数据获取失败，请检查代码是否正确。'
            };
        }
        // 获取 AI 建议 — 将 Kline 转换为 OHLCV（添加 turnover 字段，若缺失则默认 0）
        const toOHLCV = (klines = []) => klines.map(k => ({
            date: k.date,
            open: Number(k.open),
            close: Number(k.close),
            high: Number(k.high),
            low: Number(k.low),
            volume: Number(k.volume),
            turnover: typeof k.turnover !== 'undefined' ? Number(k.turnover) : 0
        }));
        const formattedStockHistory = toOHLCV(stockHistory.klines);
        const formattedIndexHistory = toOHLCV(indexHistory || []);
        const advice = await getAIAdvice(code, stockHistory.name, formattedStockHistory, formattedIndexHistory, newsList, holdingInfo);
        return {
            code,
            name: stockHistory.name,
            advice
        };
    }
    catch (error) {
        return {
            code,
            error: `分析出错: ${error.message}`
        };
    }
}
async function* analyzeStockStream(code, indexHistory, holdingInfo) {
    try {
        // 并行抓取：K线数据 + 舆情新闻
        const [stockHistory, newsList] = await Promise.all([
            fetchHistory(code),
            fetchStockNews(code)
        ]);
        if (!stockHistory?.klines?.length) {
            yield JSON.stringify({ type: 'error', data: '数据获取失败，请检查代码是否正确。' }) + "\n";
            return;
        }
        const toOHLCV = (klines = []) => klines.map(k => ({
            date: k.date,
            open: Number(k.open),
            close: Number(k.close),
            high: Number(k.high),
            low: Number(k.low),
            volume: Number(k.volume),
            turnover: typeof k.turnover !== 'undefined' ? Number(k.turnover) : 0
        }));
        const formattedStockHistory = toOHLCV(stockHistory.klines);
        const formattedIndexHistory = toOHLCV(indexHistory || []);
        // Yield start event
        yield JSON.stringify({
            type: 'start',
            data: {
                code,
                name: stockHistory.name
            }
        }) + "\n";
        // Stream AI advice
        const stream = getAIAdviceStream(code, stockHistory.name, formattedStockHistory, formattedIndexHistory, newsList, holdingInfo);
        for await (const chunk of stream) {
            yield JSON.stringify({ type: 'chunk', data: chunk }) + "\n";
        }
    }
    catch (error) {
        yield JSON.stringify({ type: 'error', data: `分析出错: ${error.message}` }) + "\n";
    }
}
export { getMarketContext, analyzeStock, analyzeStockStream, analyzeBatchStocks };
