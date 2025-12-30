import axios from 'axios'

/**
 * 抓取历史数据
 * @param {string} symbol 代码
 * @param {boolean} isIndex 是否为指数
 * @param {number} recentMonths 获取最近几个月的数据 (0=全部)
 */
async function fetchHistory(symbol: string, isIndex: boolean = false, recentMonths: number = 3) {
    let prefix;
    // 指数或5/6开头为上海(1)，其余通常为深圳(0)
    if (isIndex || symbol.startsWith('5') || symbol.startsWith('6')) {
        prefix = '1';
    } else {
        prefix = '0';
    }
    
    // 计算起始日期
    let startDate = '0';
    if (recentMonths > 0) {
        const d = new Date();
        d.setMonth(d.getMonth() - recentMonths);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        startDate = `${y}${m}${day}`;
    }

    const secid = `${prefix}.${symbol}`;
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
    
    try {
        const response = await axios.get(url, {
            params: {
                secid: secid,
                fields1: 'f1,f2,f3,f4,f5,f6,f7',
                // f51:日期, f52:开, f53:收, f54:高, f55:低, f56:成交量, f61:换手率
                fields2: 'f51,f52,f53,f54,f55,f56,f61', 
                klt: '101', // 日线
                fqt: '1',   // 前复权
                beg: startDate,
                end: '20500101',
            },
            headers: { 'Referer': 'https://quote.eastmoney.com/' }
        });

        const data = response.data?.data;
        if (!data || !data.klines) return null;

        interface Kline {
            date: string;
            open: number;
            close: number;
            high: number;
            low: number;
            volume: number;
            turnover: number; // 换手率
        }

        interface FetchHistoryResult {
            code: string;
            name: string;
            klines: Kline[];
        }

        return {
            code: data.code,
            name: data.name,
            klines: data.klines.map((line: string): Kline => {
                const [date, open, close, high, low, volume, turnover] = line.split(',');
                return { 
                    date, // 日期
                    open: parseFloat(open), // 开盘价
                    close: parseFloat(close), // 收盘价
                    high: parseFloat(high), // 最高价
                    low: parseFloat(low), // 最低价
                    volume: parseInt(volume), // 成交量
                    turnover: parseFloat(turnover), // 换手率
                };
            }),
        } as FetchHistoryResult;
    } catch (err: any) {
        console.error(`数据抓取失败 [${symbol}]:`, err.message);
        return null;
    }
}

/**
 * 获取热门/涨幅榜股票 (筛选A股主板)
 * @param {number} limit 获取数量
 */
async function fetchHotStocks(limit: number = 20) {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get';
    try {
        const response = await axios.get(url, {
            params: {
                pn: '1',      // 页码
                pz: limit,    // 每页数量
                po: '1',      // 排序方向：1倒序
                np: '1',
                ut: 'bd1d9ddb04089700cf9c27f6f7426281',
                fltt: '2',
                invt: '2',
                wbp2u: '|0|0|0|web',
                fid: 'f3',    // 排序字段：f3涨跌幅
                fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23', // 筛选板块：沪深A股主板 (大概范围)
                fields: 'f12,f14,f2,f3,f10,f8', // f12代码, f14名称, f2最新价, f3涨幅, f10量比, f8换手率
                _: Date.now()
            },
            headers: { 'Referer': 'https://quote.eastmoney.com/' }
        });

        const list = response.data?.data?.diff;
        if (!list) return [];

        return list.map((item: any) => ({
            code: item.f12,
            name: item.f14,
            price: item.f2,
            changePercent: item.f3,
            volumeRatio: item.f10,
            turnoverRate: item.f8
        }));

    } catch (err: any) {
        console.error('获取热门股票失败:', err.message);
        return [];
    }
}

export{ fetchHistory, fetchHotStocks };