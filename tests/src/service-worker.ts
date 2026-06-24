import corePlugin from '@bric/rex-core/service-worker'

import spiderPlugin from '@bric/rex-spider/service-worker'
import geminiSpider from '@bric/rex-spider-gemini/service-worker'

self['rexCorePlugin'] = corePlugin
self['rexSpiderPlugin'] = spiderPlugin
self['rexGeminiPlugin'] = geminiSpider


console.log(`Imported ${spiderPlugin} into service worker context...`)
console.log(`Imported ${geminiSpider} into service worker context...`)

corePlugin.setup()

spiderPlugin.registerSpider(geminiSpider)

self.setTimeout(() => {
    geminiSpider.checkNeedsUpdate().then((updated) => {
        console.log(`EXT: ${updated}`)
    })
}, 1000)

