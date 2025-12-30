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

export interface HoldingInfo {
    status: 'empty' | 'holding';
    cost?: number;
    quantity?: number;
    profit?: number;
}

function buildAnalysisPrompt(
    symbol: string,
    stockName: string,
    stockHistory: OHLCV[],
    indexHistory: OHLCV[],
    newsList: NewsItem[] = [],
    holdingInfo?: HoldingInfo
): string {
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

    // 8. 构建持仓上下文
    let holdingContext = "用户当前状态: 【空仓观望】。请侧重分析入场机会与风险性价比。";
    if (holdingInfo && holdingInfo.status === 'holding') {
        const cost = holdingInfo.cost || 0;
        const diffRate = cost > 0 ? ((lastPrice - cost) / cost * 100).toFixed(2) : 0;
        holdingContext = `用户当前状态: 【持有底仓】。
- 持仓成本: ${cost} 元
- 当前价格: ${lastPrice} 元
- 持仓数量: ${holdingInfo.quantity || 0} 股
- 当前盈亏浮动: ${diffRate}% (${Number(diffRate) > 0 ? '盈利' : '亏损'})
- 累计盈亏额: ${holdingInfo.profit || '未知'} 元

请务必基于用户的**持仓成本**给出针对性建议：
- 若深套，分析是该“割肉止损”还是“低位补仓做T”。
- 若微利/微亏，分析是“继续持有”还是“落袋为安”。
- 若大幅盈利，分析“止盈保护位”在哪里。`;
    }

    // 9. 构建深度量化 Prompt
    return `你是一名拥有15年经验的 A 股量化交易专家，擅长短线博弈与情绪周期分析。请对 ${stockName} (${symbol}) 进行深度分析。

${holdingContext}

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
2. **舆情与情绪面**: 结合【近期舆情与公告】，判断是否存在利好催化或利空风险。
3. **形态与波动边界**: 观察布林线张口状态。判断当前价格是否触及压力/支撑位。
4. **用户专属操作建议**: **这是最重要的部分**。基于用户的持仓状态（${holdingInfo?.status === 'holding' ? `成本 ${holdingInfo.cost}, 盈亏 ${holdingInfo.profit}` : '空仓'}），给出明确指令。
   - **操作评级**: (看多/观望/减仓/清仓/补仓)
   - **核心策略**: (例如：做T降本 / 止损离场 / 持股待涨 / 逢低吸纳)
   - **具体点位**: 建议买入/补仓点、目标卖出/止盈点、硬性止损位。

请以专业、简洁的 Markdown 格式输出。

#### 1. 量价与动能分析:
...

#### 2. 舆情与情绪面解读:
...

#### 3. 形态与综合研判:
...

#### 4. 账户专属策略 (Action Plan):
- **当前状态**: ${holdingInfo?.status === 'holding' ? `持有 (成本 ${holdingInfo.cost})` : '空仓'}
- **核心指令**: ...
- **关键点位**: ...
- **操作理由**: ...

请在回复时，段落之间务必保留一个完整的空行。
`;
}

async function getAIAdvice(
    symbol: string,
    stockName: string,
    stockHistory: OHLCV[],
    indexHistory: OHLCV[],
    newsList: NewsItem[] = [],
    holdingInfo?: HoldingInfo
): Promise<string> {
    const prompt = buildAnalysisPrompt(symbol, stockName, stockHistory, indexHistory, newsList, holdingInfo);

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

async function* getAIAdviceStream(
    symbol: string,
    stockName: string,
    stockHistory: OHLCV[],
    indexHistory: OHLCV[],
    newsList: NewsItem[] = [],
    holdingInfo?: HoldingInfo
): AsyncGenerator<string, void, unknown> {
    const prompt = buildAnalysisPrompt(symbol, stockName, stockHistory, indexHistory, newsList, holdingInfo);

    try {
        const stream = await client.chat.completions.create({
            model: GlmModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                yield content;
            }
        }
    } catch (err: any) {
        yield `AI 深度因子分析出错: ${err.message}`;
    }
}

async function selectBestStocks(candidates: any[]): Promise<any[]> {
    const prompt = `你是一名资深 A 股基金经理。我为你提供了 ${candidates.length} 只当前市场热门股票的技术面数据。请从量价配合、趋势形态、指标共振等角度，精选出最值得关注的 **Top 15** 股票。

【候选股票池 (JSON 数据)】:
${JSON.stringify(candidates.map(c => ({
    n: c.name,
    c: c.code,
    p: c.price,
    chg: c.changePercent + '%',
    ind: c.indicators // 包含 rsi, macd_diff, ma5, ma20, vol_ratio, trend
})), null, 0)}

【评分规则 (Scoring Rules)】:
请根据以下维度拉开差距 (60-99分)：
1. **90-99分 (极强)**: MA5金叉且多头排列 + 量比>1.5 + MACD红柱扩大 + 热门板块龙头。
2. **80-89分 (强势)**: 趋势向上但量能未明显放大，或处于回调支撑位。
3. **70-79分 (关注)**: 底部启动初期，指标刚修复，风险收益比适中。
4. **60-69分 (观察)**: 趋势未明朗或存在顶背离风险。

【筛选标准】:
1. **多头排列**: 优先选择 MA5 > MA20 且处于上升通道的股票 (trend='UP')。
2. **资金动能**: 优先选择量比 (vol_ratio) > 1 且 MACD 柱值 (macd_hist) 翻红或扩大的标的。
3. **超买超卖**: 避免 RSI > 85 的极端高位股，优选 RSI 在 50-70 强势区的股票。

【输出要求】:
1. 必须返回 **严格的 JSON 数组**。
2. 必须包含 **正好 15 个** 对象，不要少于 15 个。
3. 不要包含 markdown 格式，不要包含其他废话。

数组格式如下：
[
  { 
    "code": "股票代码", 
    "name": "股票名称", 
    "score": 88, 
    "reason": "精炼的一句话点评（10字以内）", 
    "deepReason": "深度入选逻辑（120-150字）。请结合当前技术面形态，从量价结构（如放量突破）、均线系统（如多头排列）、指标状态（MACD/RSI/布林带）及主力资金动向等多维度进行详细剖析，并尝试指出关键的支撑位或压力位。" 
  },
  ...
]
`;

    try {
        const completion: any = await client.chat.completions.create({
            model: GlmModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" } // GLM-4 Flash 支持 JSON Mode
        });
        
        const content = completion.choices[0].message.content;
        // 尝试解析 JSON
        let result = [];
        try {
           const json = JSON.parse(content);
           result = json.results || json.data || json; // 兼容可能的包装结构
           if (!Array.isArray(result)) {
               // 如果 LLM 直接返回数组
               if (Array.isArray(json)) result = json;
           }
        } catch (e) {
           console.error("AI 选股 JSON 解析失败", content);
           return [];
        }

        return result.slice(0, 15);
    } catch (err: any) {
        console.error("AI 选股请求失败:", err);
        return [];
    }
}

export { getAIAdvice, getAIAdviceStream, selectBestStocks };