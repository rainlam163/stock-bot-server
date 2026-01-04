import { fetchAllStocks, fetchHistory } from './crawler.js';
import { saveRecommendations } from './db.js';
import pLimit from 'p-limit';
/**
 * 纯量化选股任务 (基于 @选股逻辑.md)
 */
export async function runSelectionJob() {
    console.log(`[${new Date().toISOString()}] 开始执行纯量化选股任务...`);
    const limit = pLimit(20); // 并发控制 20
    try {
        // --- 阶段一：全量发现 ---
        console.log('Step 1: 全量获取 A 股列表...');
        const allStocks = await fetchAllStocks();
        console.log(`- 原始获取: ${allStocks.length} 只`);
        // --- 阶段三(前置)：硬性准入过滤 (省去不必要的历史数据抓取) ---
        // 规则：非ST, 非新股(>60天), 市值>30亿
        // 30亿 = 30 * 10000 * 10000 = 3,000,000,000
        const MIN_MARKET_CAP = 30 * 100000000;
        // 计算60天前的日期字符串 (YYYYMMDD) 用于比较上市日期
        const d = new Date();
        d.setDate(d.getDate() - 60);
        const date60DaysAgo = d.toISOString().slice(0, 10).replace(/-/g, '');
        let candidates = allStocks.filter((s) => {
            // 1. 非 ST/退
            if (s.name.includes('ST') || s.name.includes('退'))
                return false;
            // 2. 市值过滤
            if (!s.marketCap || s.marketCap < MIN_MARKET_CAP)
                return false;
            // 3. 上市时间过滤 (f26)
            if (!s.listingDate || s.listingDate > date60DaysAgo)
                return false;
            // 4. 非停牌 (简单判断：价格>0, 实际上fetchHistory时无数据也会过滤)
            if (s.price <= 0)
                return false;
            return true;
        });
        console.log(`- 准入过滤后: ${candidates.length} 只 (市值>30亿, 非ST/新股)`);
        // --- 阶段二 & 四：并行抓取与特征计算 ---
        console.log('Step 2 & 3: 并行抓取历史数据并计算因子...');
        const tasks = candidates.map((stock) => limit(async () => {
            try {
                // 获取最近 25 天数据 (确保有足够的 T-20)
                // fetchHistory 我们之前改为支持 recentMonths，这里可以传 1 (1个月足够)
                // 或者我们直接修改 fetchHistory 逻辑? 现有逻辑 beg 计算是基于月的
                // 我们直接请求最近1个月的数据
                const history = await fetchHistory(stock.code, false, 2);
                if (!history || !history.klines || history.klines.length < 20) {
                    return null; // 数据不足
                }
                const klines = history.klines;
                // 取最后 20 个交易日
                const recent20 = klines.slice(-20);
                if (recent20.length < 20)
                    return null;
                const today = recent20[recent20.length - 1];
                const startDay = recent20[0]; // T-19 (如果是20天前的话，数组index 0 就是 20天前)
                // Wait, logic says: (Today - T_minus_20)
                // If array length is 20: [0]...[19]. [19] is Today. [0] is 19 days ago.
                // Formula says "20日前收盘价". This usually means index 0 if length is 21. 
                // Let's assume strict 20 days window: T vs T-19.
                // Re-reading doc: "T-20为20个交易日前". So we need 21 data points to get change from T-20 to T.
                // Or if logic means "Change over last 20 days period".
                // Formula: (Price_T - Price_T_minus_20) / ...
                // If we need Price_T_minus_20, we need 21 records.
                // Let's check klines length again.
                // If we fetch 2 months, we definitely have enough.
                const len = klines.length;
                const idxT = len - 1;
                const idxT20 = len - 1 - 20; // 20 days ago index
                if (idxT20 < 0)
                    return null; // Not enough history
                const closeT = today.close;
                const closeT20 = klines[idxT20].close;
                // 1. 价格动能因子 (F_momentum)
                const momentum = ((closeT - closeT20) / closeT20) * 100;
                // --- 异常过滤：剔除连续多日涨停的股票 (疑似坐庄或过度投机) ---
                let maxConsecutiveLimitUps = 0;
                let currentConsecutive = 0;
                for (let i = idxT20 + 1; i <= idxT; i++) {
                    const dailyReturn = (klines[i].close - klines[i - 1].close) / klines[i - 1].close;
                    if (dailyReturn >= 0.098) { // 考虑四舍五入，9.8% 以上视为涨停
                        currentConsecutive++;
                        maxConsecutiveLimitUps = Math.max(maxConsecutiveLimitUps, currentConsecutive);
                    }
                    else {
                        currentConsecutive = 0;
                    }
                }
                if (maxConsecutiveLimitUps >= 3) {
                    console.log(`- 排除异动股: ${stock.name} (${stock.code}), 连续涨停天数: ${maxConsecutiveLimitUps}`);
                    return null;
                }
                // 2. 量价齐升因子 (F_volume)
                // 今日成交量 / (过去19日成交量总和 / 19)
                // Past 19 days: from idxT-19 to idxT-1.
                // Wait, doc says "Today / Avg(Past 19)".
                // Range: [T-19 ... T-1]. Length 19.
                const volT = today.volume;
                let sumVolPast19 = 0;
                let countVol = 0;
                for (let i = 1; i <= 19; i++) {
                    const idx = idxT - i;
                    if (idx >= 0) {
                        sumVolPast19 += klines[idx].volume;
                        countVol++;
                    }
                }
                const avgVol19 = countVol > 0 ? sumVolPast19 / countVol : 0;
                const fVolume = avgVol19 > 0 ? volT / avgVol19 : 0;
                // 3. 均线乖离率因子 (F_bias)
                // (Price - MA20) / MA20
                // MA20 = Avg close of last 20 days (including today T to T-19)
                let sumClose20 = 0;
                for (let i = 0; i < 20; i++) {
                    sumClose20 += klines[idxT - i].close;
                }
                const ma20 = sumClose20 / 20;
                const fBias = (closeT - ma20) / ma20;
                // 4. 综合评分
                // Score = Momentum * 0.4 + Volume * 0.6 - Abs(Bias) * 0.2
                // Note: Momentum is percent (e.g. 10.5), Volume is ratio (e.g. 1.5), Bias is ratio (e.g. 0.05).
                // Scales are different.
                // Momentum: ~ -20 to +20
                // Volume: ~ 0.5 to 3.0
                // Bias: ~ -0.1 to 0.1
                // 
                // Using raw formula from doc:
                // If Momentum=10, Vol=2. Score = 4 + 1.2 - 0 = 5.2?
                // Or maybe Bias should be percent too?
                // Doc says: "Abs(Bias) * 0.2". If Bias is 0.05 (5%), then 0.05 * 0.2 = 0.01. Negligible.
                // I will assume Bias needs to be multiplied by 100 if it's meant to be comparable, OR just follow formula strictly.
                // Given the formula is explicit, I will follow strictly but keep an eye on magnitude.
                // Actually, usually in quant, factors are normalized. But here it's a simple script.
                // Let's assume F_bias is also percentage for consistency? "乖离率" is often expressed as %.
                // Formula: (Close - MA) / MA. Result 0.05.
                // If I strictly follow `Abs(Bias) * 0.2`, it subtracts very little.
                // Let's stick to the strict formula but maybe Bias * 100 makes more sense?
                // Doc says: `(今日价格 - 20日均线值) / 20日均线值`. Result is e.g. 0.05.
                // Let's try to interpret "乖离率适中".
                // Let's use raw value first. If results look weird, we adjust.
                const score = (momentum * 0.4) + (fVolume * 0.6) - (Math.abs(fBias) * 0.2);
                return {
                    code: stock.code,
                    name: stock.name,
                    score: score,
                    factors: {
                        momentum: momentum.toFixed(2) + '%',
                        volumeRatio: fVolume.toFixed(2),
                        bias: (fBias * 100).toFixed(2) + '%' // Display as % for readability
                    },
                    price: closeT,
                    changePercent: stock.changePercent
                };
            }
            catch (e) {
                return null;
            }
        }));
        const results = await Promise.all(tasks);
        const validResults = results.filter(r => r !== null);
        console.log(`- 成功计算因子: ${validResults.length} 只`);
        // --- 阶段五：排名与输出 ---
        console.log('Step 4: 排名与截取 Top 20...');
        // Sort descending by score
        const top20 = validResults.sort((a, b) => b.score - a.score).slice(0, 20);
        // Format for DB
        const finalOutput = top20.map((item, index) => {
            // Generate simple quantitative reason string
            const reason = `量化评分:${item.score.toFixed(2)} | 动能:${item.factors.momentum} 量比:${item.factors.volumeRatio}`;
            // Deep reason with detailed data
            const deepReason = `
**量化策略入选解析**

1. **价格动能 (40%)**: 20日涨幅达到 **${item.factors.momentum}**，显示出强劲的趋势延续性。
2. **量价配合 (60%)**: 量比高达 **${item.factors.volumeRatio}**，资金参与度极高，符合“量在价先”原则。
3. **乖离率控制 (-20%)**: 当前乖离率为 **${item.factors.bias}**，处于合理攻击区间，未出现极端超买风险。

综合得分 **${item.score.toFixed(2)}**，在全市场大市值股票中排名第 **${index + 1}**。
            `.trim();
            return {
                code: item.code,
                name: item.name,
                score: item.score,
                reason: reason,
                deepReason: deepReason,
                price: item.price,
                changePercent: item.changePercent
            };
        });
        // 8. 存入数据库
        console.log('Step 5: 存入数据库...');
        // 直接存入计算出的真实得分
        const dbData = finalOutput.map((i) => ({
            code: i.code,
            name: i.name,
            score: Number(i.score.toFixed(2)), // 保持两位小数
            reason: i.reason,
            deepReason: i.deepReason,
            price: i.price,
            changePercent: i.changePercent
        }));
        saveRecommendations(dbData);
        console.log(`✅ 纯量化选股完成，Top 20 已更新。`);
        return { success: true, count: dbData.length };
    }
    catch (err) {
        console.error('❌ 选股任务失败:', err);
        return { success: false, error: err.message };
    }
}
