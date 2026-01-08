import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 初始化数据库
// 注意：在 Vercel 等 Serverless 环境中，本地文件系统通常是临时的或只读的。
// 如果要部署上线，建议换成 Supabase 或 Vercel Postgres。
// 但作为本地运行或演示，SQLite 是最轻量的方案。

// 自动判断项目根目录，兼容开发环境(src/)和生产环境(dist/src/)
const rootDir = __dirname.includes(path.join('dist', 'src'))
    ? path.resolve(__dirname, '../../')
    : path.resolve(__dirname, '../');

const dbPath = path.resolve(rootDir, 'stock.db');
console.log(`Database path: ${dbPath}`);
const db = new Database(dbPath);

// 初始化表结构
export function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            score REAL NOT NULL,
            reason TEXT,
            deepReason TEXT,
            price REAL,
            changePercent REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS sector_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sector_name TEXT NOT NULL,
            sector_code TEXT,
            score INTEGER NOT NULL,
            val_prosperity INTEGER,
            val_valuation INTEGER,
            val_inflow INTEGER,
            val_profit_growth INTEGER,
            val_crowding INTEGER,
            val_trend INTEGER,
            prediction_reason TEXT,
            key_factors TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 创建元数据表，记录上次更新时间
    db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
}

export function saveSectorPredictions(predictions: any[]) {
    const insert = db.prepare(`
        INSERT INTO sector_predictions (
            sector_name, sector_code, score, 
            val_prosperity, val_valuation, val_inflow, 
            val_profit_growth, val_crowding, val_trend, 
            prediction_reason, key_factors
        )
        VALUES (
            @sector_name, @sector_code, @score, 
            @val_prosperity, @val_valuation, @val_inflow, 
            @val_profit_growth, @val_crowding, @val_trend, 
            @prediction_reason, @key_factors
        )
    `);

    const updateMeta = db.prepare(`
        INSERT OR REPLACE INTO meta (key, value) VALUES ('sectors_last_updated', @timestamp)
    `);

    const transaction = db.transaction((predictions) => {
        db.prepare('DELETE FROM sector_predictions').run();
        for (const p of predictions) {
            insert.run(p);
        }
        updateMeta.run({ timestamp: new Date().toISOString() });
    });

    transaction(predictions);
}

export function getSectorPredictions() {
    const rows = db.prepare('SELECT * FROM sector_predictions ORDER BY score DESC').all();
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'sectors_last_updated'").get() as any;
    
    return {
        updatedAt: meta ? meta.value : null,
        list: rows
    };
}

export function saveRecommendations(stocks: any[]) {
    // 使用事务确保原子性
    const insert = db.prepare(`
        INSERT INTO recommendations (code, name, score, reason, deepReason, price, changePercent)
        VALUES (@code, @name, @score, @reason, @deepReason, @price, @changePercent)
    `);

    const updateMeta = db.prepare(`
        INSERT OR REPLACE INTO meta (key, value) VALUES ('last_updated', @timestamp)
    `);

    const transaction = db.transaction((stocks) => {
        // 先清空旧数据
        db.prepare('DELETE FROM recommendations').run();
        
        // 插入新数据
        for (const stock of stocks) {
            insert.run(stock);
        }
        
        // 更新时间戳
        updateMeta.run({ timestamp: new Date().toISOString() });
    });

    transaction(stocks);
}

export function getRecommendations() {
    const rows = db.prepare('SELECT * FROM recommendations ORDER BY score DESC').all();
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'last_updated'").get() as any;
    
    return {
        updatedAt: meta ? meta.value : null,
        list: rows
    };
}

// 启动时初始化
initDB();
