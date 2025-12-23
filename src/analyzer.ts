import { fetchHistory } from './crawler.js'
import { fetchStockNews } from './news.js'
import { getAIAdvice } from './ai.js'

/**
 * 获取大盘行情（通常是上证指数 000001）
 * @returns {Promise<Array>} K线数据
 */
async function getMarketContext() {
    const indexResult = await fetchHistory('000001', true);
    return indexResult?.klines;
}

/**
 * 分析单只股票
 * @param {string} code 股票代码
 * @param {Array} indexHistory 大盘K线（基准）
 * @returns {Promise<Object>} 分析结果 { code, name, advice, error }
 */
async function analyzeStock(code: string, indexHistory: Array<any>): Promise<object> {
    try {
        // 并行抓取：K线数据 + 舆情新闻
        const [stockHistory, newsList] = await Promise.all([
            fetchHistory(code),
            fetchStockNews(code)
        ]);

        if (!stockHistory || stockHistory.length === 0) {
            return { 
                code, 
                error: '数据获取失败，请检查代码是否正确。' 
            };
        }

        // 获取 AI 建议
        const advice = await getAIAdvice(code, stockHistory.name, stockHistory.klines, indexHistory, newsList);
        
        return { 
            code, 
            name: stockHistory.name, 
            advice 
        };

    } catch (error: any) {
        return { 
            code, 
            error: `分析出错: ${error.message}` 
        };
    }
}

export { getMarketContext, analyzeStock };