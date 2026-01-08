import nodeCron from 'node-cron';
import { runSelectionJob } from './worker.js';
import { runSectorPredictionJob } from './sector-worker.js';

// 每个交易日开盘前 08:30 和收盘后 15:30 执行行业推荐任务
nodeCron.schedule('0 30 8,15 * * 1-5', async () => {
    console.log(`[${new Date().toISOString()}] 定时任务触发: 行业推荐`);

    try {
        const sectorResult = await runSectorPredictionJob();
        console.log('定时行业推荐任务结果:', sectorResult);
    } catch (err: any) {
        console.error('定时行业推荐任务失败:', err);
    }
});

// 每个交易日开盘前 08:00 和收盘后 16:00 执行智能选股任务
nodeCron.schedule('0 0 8,16 * * 1-5', async () => {
    console.log(`[${new Date().toISOString()}] 定时任务触发: 智能选股`);

    try {
        const selectionResult = await runSelectionJob();
        console.log('定时选股任务结果:', selectionResult);
    } catch (err: any) {
        console.error('定时选股任务失败:', err);
    }
});