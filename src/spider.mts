import rexSpiderManager, { REXContentSpider } from '@bric/rex-spider/spider'

export class REXGeminiContentSpider extends REXContentSpider {
  toString():string {
    return 'REXGeminiContentSpider'
  }

  name():string {
    return 'Gemini'
  }

  urlMatches(url:string): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
    return false
  }

  fetchResults() {
  }
}

const spider = new REXGeminiContentSpider()
rexSpiderManager.registerSpider(spider)

export default spider
