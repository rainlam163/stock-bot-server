import axios from 'axios';
/**
 * 抓取历史数据
 * @param {string} symbol 代码
 * @param {boolean} isIndex 是否为指数
 * @param {number} recentMonths 获取最近几个月的数据 (0=全部)
 */
async function fetchHistory(symbol, isIndex = false, recentMonths = 3) {
    let prefix;
    // 指数或5/6开头为上海(1)，其余通常为深圳(0)
    if (isIndex || symbol.startsWith('5') || symbol.startsWith('6')) {
        prefix = '1';
    }
    else {
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
                fqt: '1', // 前复权
                beg: startDate,
                end: '20500101',
            },
            headers: { 'Referer': 'https://quote.eastmoney.com/' }
        });
        const data = response.data?.data;
        if (!data || !data.klines)
            return null;
        return {
            code: data.code,
            name: data.name,
            klines: data.klines.map((line) => {
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
        };
    }
    catch (err) {
        console.error(`数据抓取失败 [${symbol}]:`, err.message);
        return null;
    }
}
/**
 * 获取全市场股票列表 (用于选股 Discovery 阶段)
 * @returns {Promise<Array>} 股票基础信息列表
 */
async function fetchAllStocks() {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get';
    const pageSize = 100; // 安全的页容量
    let page = 1;
    let allStocks = [];
    try {
        while (true) {
            const response = await axios.get(url, {
                params: {
                    pn: page.toString(),
                    pz: pageSize.toString(),
                    po: '1',
                    np: '1',
                    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
                    fltt: '2',
                    invt: '2',
                    wbp2u: '|0|0|0|web',
                    fid: 'f3',
                    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
                    // f12:代码, f14:名称, f2:现价, f3:涨幅, f20:总市值, f26:上市日期
                    fields: 'f12,f14,f2,f3,f20,f26',
                    _: Date.now()
                },
                headers: { 'Referer': 'https://quote.eastmoney.com/' }
            });
            const data = response.data?.data;
            if (!data || !data.diff || data.diff.length === 0) {
                break; // 没有更多数据了
            }
            const list = data.diff.map((item) => ({
                code: item.f12,
                name: item.f14,
                price: item.f2,
                changePercent: item.f3,
                marketCap: item.f20,
                listingDate: item.f26
            }));
            allStocks = allStocks.concat(list);
            // 如果返回数量小于页容量，说明是最后一页
            if (data.diff.length < pageSize) {
                break;
            }
            page++;
            // 安全限制：防止死循环，最多抓取 100 页 (100 * 100 = 10000 只)
            if (page > 100)
                break;
        }
        console.log(`全市场扫描完成: 共获取 ${allStocks.length} 只股票`);
        return allStocks;
    }
    catch (err) {
        console.error('获取全市场股票失败:', err.message);
        return allStocks; // 返回已获取的部分
    }
}
export { fetchHistory, fetchAllStocks };
