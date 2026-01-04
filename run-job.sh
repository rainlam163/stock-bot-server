#!/bin/bash

# 定位到脚本所在目录
cd "$(dirname "$0")"

# 加载环境变量 (如果有 .env 文件)
# if [ -f .env ]; then
#   export $(cat .env | xargs)
# fi

# 打印开始时间日志
echo "[$(date)] Starting Scheduled Selection Job..." >> cron.log

# 执行 Worker 脚本
# 这一步需要我们在 package.json 里加一个命令来直接运行 runSelectionJob
# 或者我们直接用 node 执行编译后的文件
node dist/run-worker.js >> cron.log 2>&1

echo "[$(date)] Job Finished." >> cron.log
