import corePlugin from '@bric/rex-core/service-worker'

import spiderPlugin from '@bric/rex-spider/service-worker'
import googleSpider from '@bric/rex-spider-google-ai/service-worker'

self['rexCorePlugin'] = corePlugin
self['rexSpiderPlugin'] = spiderPlugin
self['rexGoogleAIPlugin'] = googleSpider


console.log(`Imported ${spiderPlugin} into service worker context...`)
console.log(`Imported ${googleSpider} into service worker context...`)

corePlugin.setup()

spiderPlugin.registerSpider(googleSpider)

