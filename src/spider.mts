import $ from 'jquery'

import rexSpiderManager, { REXContentSpider } from '@bric/rex-spider/spider'

export class REXGoogleAIContentSpider extends REXContentSpider {
  toString():string {
    return 'REXGoogleAIContentSpider'
  }

  name():string {
    return 'Google AI'
  }

  urlMatches(url:string): boolean {
    return false
  }

  fetchResults() {
  }
}

const spider = new REXGoogleAIContentSpider()
rexSpiderManager.registerSpider(spider)

export default spider
