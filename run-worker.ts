// @ts-ignore
import { runSelectionJob } from './dist/src/worker.js';

// 立即执行任务
runSelectionJob()
    .then((res: any) => {
        console.log('Worker execution result:', res);
        process.exit(res.success ? 0 : 1);
    })
    .catch((err: any) => {
        console.error('Worker execution fatal error:', err);
        process.exit(1);
    });
