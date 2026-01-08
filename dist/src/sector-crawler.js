import axios from 'axios';
/**
 * 获取全球核心指数表现
 */
export async function fetchGlobalMarkets() {
    // 采用更宽泛的代码组合，确保抓取到核心指数
    const symbols = [
        '100.NDX', // 纳斯达克100 (东财代码)
        'gb.ixic', // 纳斯达克综合 (新浪/通用格式)
        '100.HXC', // 中概金龙
        '100.UDI', // 美元指数
        '1.000001', // 上证
        '0.399001', // 深成
        '103.HSI', // 恒生
        '100.A50M', // A50
        'gb.dji' // 道琼斯
    ];
    try {
        const response = await axios.get('https://push2.eastmoney.com/api/qt/ulist.np/get', {
            params: {
                secids: symbols.join(','),
                fields: 'f12,f14,f2,f3',
                ut: 'bd1d9ddb04089700cf9c27f6f7426281',
                _: Date.now()
            },
            timeout: 8000
        });
        const list = response.data?.data?.diff || [];
        const result = list.map((item) => ({
            name: item.f14,
            code: item.f12,
            price: item.f2,
            change: item.f3
        }));
        console.log(`[Crawler] 全球数据抓取完成: ${result.length} 条`);
        return result;
    }
    catch (e) {
        console.error('[Crawler] 全球数据失败:', e.message);
        return [];
    }
}
/**
 * 获取行业板块表现 (申万一级行业)
 */
export async function fetchSectorPerformance() {
    try {
        const response = await axios.get('https://push2.eastmoney.com/api/qt/clist/get', {
            params: {
                pn: '1', pz: '100', po: '1', np: '1', ut: 'bd1d9ddb04089700cf9c27f6f7426281',
                fltt: '2', invt: '2', fid: 'f3',
                fs: 'm:94,m:90+t:2', // 同时抓取申万和东财行业板块，取并集
                fields: 'f12,f14,f2,f3,f62,f164,f8,f109',
                _: Date.now()
            },
            timeout: 8000
        });
        const list = response.data?.data?.diff || [];
        const result = list.map((item) => ({
            name: item.f14,
            code: item.f12,
            change: item.f3,
            mainForceInflow: item.f62,
            pe: item.f164,
            turnover: item.f8,
            recent20dChange: item.f109
        }));
        console.log(`[Crawler] 行业数据抓取完成: ${result.length} 条`);
        return result;
    }
    catch (e) {
        console.error('[Crawler] 行业抓取失败:', e.message);
        return [];
    }
}
/**
 * 获取财联社实时电报 (财经快讯的最优源)
 */
export async function fetchFinancialNewsHeadlines() {
    try {
        // 财联社电报接口，非常稳定且为纯 JSON
        const response = await axios.get('https://www.cls.cn/nodeapi/telegraphList', {
            params: {
                refresh_type: '1',
                rn: '30',
                last_time: Math.floor(Date.now() / 1000)
            },
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });
        const news = response.data?.data?.roll_data || [];
        const result = news.map((n) => n.title || n.content)
            .filter((t) => !!t)
            .map((t) => t.slice(0, 150)); // 适当保留长度供AI分析
        console.log(`[Crawler] 财联社快讯抓取完成: ${result.length} 条`);
        return result;
    }
    catch (e) {
        console.error('[Crawler] 财联社快讯抓取失败，尝试兜底逻辑...', e.message);
        return ["市场情绪平稳，关注各板块基本面变化。"]; // 极简兜底
    }
}
