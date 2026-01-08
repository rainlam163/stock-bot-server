import { fetchGlobalMarkets, fetchSectorPerformance, fetchFinancialNewsHeadlines } from './sector-crawler.js';
import { predictSectors } from './ai.js';
import { saveSectorPredictions } from './db.js';
export async function runSectorPredictionJob() {
    console.log(`[${new Date().toISOString()}] 开始执行行业指数推荐任务...`);
    try {
        // 1. 并行抓取数据
        console.log('Step 1: 抓取全球市场、行业板块及新闻...');
        const [globalData, sectorData, news] = await Promise.all([
            fetchGlobalMarkets(),
            fetchSectorPerformance(),
            fetchFinancialNewsHeadlines()
        ]);
        console.log(`- 抓取到全球数据: ${globalData.length} 条`);
        console.log(`- 抓取到行业数据: ${sectorData.length} 条`);
        console.log(`- 抓取到快讯: ${news.length} 条`);
        // 数据完整性检查
        if (sectorData.length === 0 || news.length === 0) {
            throw new Error(`数据采集不完整 (行业: ${sectorData.length}, 新闻: ${news.length})，请检查网络或数据源`);
        }
        // 2. AI 分析预测
        console.log('Step 2: AI 宏观分析与行业预测...');
        const predictions = await predictSectors(globalData, sectorData, news);
        if (!predictions || predictions.length === 0) {
            throw new Error('AI 预测返回为空');
        }
        // 3. 结果存入数据库
        console.log('Step 3: 预测结果入库...');
        saveSectorPredictions(predictions);
        console.log(`✅ 行业推荐任务完成，已更新 ${predictions.length} 条推荐。`);
        return { success: true, count: predictions.length };
    }
    catch (e) {
        console.error('❌ 行业推荐任务失败:', e);
        return { success: false, error: e.message };
    }
}
