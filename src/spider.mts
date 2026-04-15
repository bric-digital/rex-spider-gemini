import rexSpiderManager, { REXContentSpider } from '@bric/rex-spider/spider'

export class REXGoogleAIContentSpider extends REXContentSpider {
  toString():string {
    return 'REXGoogleAIContentSpider'
  }

  name():string {
    return 'Google AI'
  }

  urlMatches(url:string): boolean { // eslint-disable-line @typescript-eslint/no-unused-vars
    return false
  }

  fetchResults() {
  }
}

const spider = new REXGoogleAIContentSpider()
rexSpiderManager.registerSpider(spider)

export default spider
