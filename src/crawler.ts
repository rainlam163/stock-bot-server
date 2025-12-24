import axios from 'axios'

/**
 * 抓取历史数据
 * @param {string} symbol 代码
 * @param {boolean} isIndex 是否为指数
 */
async function fetchHistory(symbol: string, isIndex: boolean = false) {
    let prefix;
    // 指数或5/6开头为上海(1)，其余通常为深圳(0)
    if (isIndex || symbol.startsWith('5') || symbol.startsWith('6')) {
        prefix = '1';
    } else {
        prefix = '0';
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
                beg: '0',
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

export{ fetchHistory };