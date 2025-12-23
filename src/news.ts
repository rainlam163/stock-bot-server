import axios from 'axios';

/**
 * 抓取个股相关舆情新闻
 * @param {string} symbol 股票代码 (e.g. '600519')
 * @returns {Promise<Array>} 新闻列表
 */
async function fetchStockNews(symbol: string): Promise<Array<any>> {
    // 东方财富快讯接口
    const url = 'http://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Referer': 'https://www.eastmoney.com/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 5000 // 5秒超时
        });

        let rawData = response.data;
        if (typeof rawData === 'string') {
            // 去除 "var ajaxResult=" 前缀
            rawData = rawData.replace(/^var\s+ajaxResult=/, '');
        }

        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        const items = data?.LivesList;

        if (!items || !Array.isArray(items)) {
            return [];
        }

        // 1. 优先筛选包含股票代码的新闻
        let relevantNews = items.filter(item => {
            const content = (item.title + item.digest).toLowerCase();
            return content.includes(symbol);
        });

        // 2. 如果没有特定个股新闻，则返回最新的财经快讯（大盘环境）
        if (relevantNews.length === 0) {
             relevantNews = items.slice(0, 5).map(item => ({
                ...item,
                title: `[市场快讯] ${item.title}` // 标记为通用快讯
            }));
        }

        // 3. 格式化数据
        return relevantNews.slice(0, 5).map(item => {
            return {
                title: item.title,
                date: item.showtime || '',
                summary: (item.digest || '').replace(/<[^>]+>/g, '').slice(0, 100) + '...'
            };
        });

    } catch (err: any) {
        console.warn(`[${symbol}] 舆情抓取失败 (非阻断性):`, err.message);
        return [];
    }
}

export { fetchStockNews };