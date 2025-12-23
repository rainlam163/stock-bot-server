import { OpenAI } from 'openai';
import TI from 'technicalindicators';

const GlmModel = 'glm-4-flash';

const client = new OpenAI({
    apiKey: 'e08d19b7535344a19b07a4c842ad03f7.kv4mN181BrQcHqDg',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/'
});

/**
 * 核心分析函数：集成 OHLCV + 多因子指标
 */
interface OHLCV {
    date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    turnover: number; // percent value, e.g., 0.12 for 0.12%
}

interface NewsItem {
    date: string;
    title: string;
    content?: string;
}

interface MACDResult {
    MACD: number;
    signal: number;
    histogram: number;
}

interface BollingerResult {
    upper: number;
    middle: number;
    lower: number;
}

async function getAIAdvice(
    symbol: string,
    stockName: string,
    stockHistory: OHLCV[],
    indexHistory: OHLCV[],
    newsList: NewsItem[] = []
): Promise<string> {
    // 1. 准备基础数据（收盘价数组）
    const closes: number[] = stockHistory.map(d => d.close);
    const recent: OHLCV[] = stockHistory.slice(-20);
    const indexRecent: OHLCV[] = indexHistory.slice(-20);
    const volumes: number[] = stockHistory.map(d => d.volume);
    const todayVol: number = volumes[volumes.length - 1];

    // 2. 计算 RSI (14日) - 判断超买超卖
    const rsiValues: number[] = TI.RSI.calculate({ values: closes, period: 14 });
    const currentRSI: number = rsiValues[rsiValues.length - 1] || 50;

    // 3. 计算 MACD - 判断动能背离
    const macdInput: { values: number[]; fastPeriod: number; slowPeriod: number; signalPeriod: number; SimpleMAOscillator: boolean; SimpleMASignal: boolean } = {
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    };
    const macdResults: MACDResult[] = TI.MACD.calculate(macdInput) as MACDResult[];
    const currentMACD: MACDResult = macdResults[macdResults.length - 1] || { MACD: 0, signal: 0, histogram: 0 };

    // 4. 计算 Bollinger Bands (20, 2) - 判断压力位与支撑位
    const bbResults: BollingerResult[] = TI.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }) as BollingerResult[];
    const currentBB: BollingerResult = bbResults[bbResults.length - 1] || { upper: 0, middle: 0, lower: 0 };

    // 5. 计算平均换手率（近5日），用于判断是否放量
    const recentTurnovers: number[] = recent.slice(-5).map(d => d.turnover);
    const avgTurnover5: any = (recentTurnovers.reduce((a, b) => a + b, 0) / 5).toFixed(2);
    const volRatio: any = (todayVol / avgTurnover5).toFixed(2); // 计算量比

    // 6. 计算均线与价格位置 (MA5, MA12, MA72)
    const ma5: string = (closes.slice(-5).reduce((a, b) => a + b, 0) / 5).toFixed(2);
    const ma12: string = (closes.slice(-12).reduce((a, b) => a + b, 0) / 12).toFixed(2);
    const ma20: string = (closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(2);
    const ma72: string = (closes.slice(-72).reduce((a, b) => a + b, 0) / 72).toFixed(2);
    const lastPrice: number = closes[closes.length - 1];

    // 7. 构建近期舆情文本
    const newsContext: string = newsList.length > 0
        ? newsList.map(n => `- [${n.date.slice(0, 10)}] ${n.title}`).join('\n')
        : "暂无近期重大舆情";

    // 8. 构建深度量化 Prompt
    const prompt: string = `你是一名拥有15年经验的 A 股量化交易专家，擅长短线博弈与情绪周期分析。请对 ${stockName} (${symbol}) 进行深度分析。

【深度因子指标】:
- 当前价: ${lastPrice} (MA5: ${ma5}, MA12: ${ma12}, MA20: ${ma20}, MA72: ${ma72})
- RSI (14): ${currentRSI.toFixed(2)} (${currentRSI > 70 ? '超买风险' : currentRSI < 30 ? '超跌机会' : '震荡区间'})
- MACD: DIF(${currentMACD.MACD.toFixed(3)}), DEA(${currentMACD.signal.toFixed(3)}), 柱值(${currentMACD.histogram.toFixed(3)})
- 布林线(Bollinger): 上轨(${currentBB.upper.toFixed(2)}), 中轨(${currentBB.middle.toFixed(2)}), 下轨(${currentBB.lower.toFixed(2)})
- 近5日平均换手率: ${avgTurnover5}% | 量比: ${volRatio}

【近期舆情与公告 (Sentiment)】:
${newsContext}

【近20日详细OHLCV交易数据】:
${recent.map(d => `${d.date}|开:${d.open}|收:${d.close}|高:${d.high}|低:${d.low}|量:${d.volume}|换手:${d.turnover}%`).join('\n')}

【同期大盘(上证指数)参考】:
${indexRecent.map(d => d.close).join(', ')}

【分析任务】:
1. **量价与主力动能**: 结合成交量、量比和 MACD。分析是否存在“放量突破”、“缩量回调”或“高位滞涨”。识别当前是主力吸筹、洗盘还是派发阶段。
2. **舆情与情绪面**: 结合【近期舆情与公告】，判断是否存在利好催化或利空风险（如业绩预告、减持、行业政策）。
3. **形态与波动边界**: 观察布林线张口状态。判断当前价格是否触及压力/支撑位，并结合 A 股 T+1 制度，评估今日买入后的次日溢价可能性。
4. **实战操作指令**: 给出明确的交易计划。
   - **操作评级**: (看多/观望/减仓)
   - **仓位建议**: (0-100%)
   - **具体点位**: 建议买入点、目标卖出点、硬性止损位。

请以专业、简洁的 Markdown 格式输出。

#### ${symbol} (${stockName}) 深度因子与舆情分析报告

#### 1. 量价与动能分析:
...

#### 2. 舆情与情绪面解读:
...

#### 3. 形态与综合研判:
...

#### 4. 操盘手指令 (Trade Plan):
- **策略**: ...
- **入场**: ...
- **止损**: ...
- **仓位**: ...

请在回复时，段落之间务必保留一个完整的空行（即使用两次换行符），以确保 Markdown 渲染正常。
`;

    try {
        const completion: any = await client.chat.completions.create({
            model: GlmModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });
        return completion.choices[0].message.content;
    } catch (err: any) {
        return `AI 深度因子分析出错: ${err.message}`;
    }
}

export { getAIAdvice };