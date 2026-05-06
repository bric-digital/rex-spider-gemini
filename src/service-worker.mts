import { Conversation, Turn, DateString, Citation, Search } from '@bric/rex-types/types'

import rexCorePlugin, { EventPayload } from '@bric/rex-core/service-worker'
import rexSpiderPlugin, { REXSpider } from '@bric/rex-spider/service-worker'

export class REXChatGoogleAISpider extends REXSpider {
  sleepDelayMs:number = 10000
  syncing:boolean = false
  lastSync:number = 0
  syncPeriod:number = 300000
  accessToken:string|null = null

  fetchUrls(): string[] {
    return [
      'https://www.google.com/httpservice/web/AimThreadsService/ListThreads?aep=22&sca_esv=55e9f3c856495c1e&source=hp&udm=50&reqpld=[null,null,0]&msc=gwsclient&opi=89978449',
    ]
  }

  name(): string {
    return 'Google AI'
  }

  loginUrl(): string {
    return 'https://www.google.com/'
  }

  fetchInitialUrls(): string[] {
    return [
      'https://www.google.com/httpservice/web/AimThreadsService/ListThreads?aep=22&sca_esv=55e9f3c856495c1e&source=hp&udm=50&reqpld=[null,null,0]&msc=gwsclient&opi=89978449',
    ]
  }

  checkLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      console.log(`[rex-spider-google-ai] checkLogin`)
      fetch(this.loginUrl())
        .then((response: Response) => {
          if (response.ok) {
            response.text().then((rawHtml) => {
              const lines = rawHtml.match(/Sign In/g)

              console.log(`[rex-spider-google-ai] checkLogin Match: ${lines}`)

              if (lines !== null && lines.length > 0) {
                  resolve(false)
              }

              resolve(true)
            })
          } else {
            resolve(false)
          }
        })
    })
  }

  checkNeedsUpdate(): Promise<boolean> {
    console.log(`[rex-spider-google-ai] checkNeedsUpdate`)

    return new Promise<boolean>((resolve) => {
      if (this.syncing) {
        console.log(`[rex-spider-google-ai] Still syncing. Skipping this round...`)
        resolve(true)

        return
      }

      const fetchLastSync = {
        messageType: 'fetchValue',
        key: 'rex-spider-google-ai-last-sync'
      }

      rexCorePlugin.handleMessage(fetchLastSync, this, (response) => {
        let timestamp = 0

        if (response !== null) {
          timestamp = response
        }

        if (Date.now() < timestamp + this.syncPeriod) {
          console.log(`[rex-spider-google-ai] Too soon to sync again. Skipping this round...`)
          resolve(true)

          return
        }

        const storeMessage = {
          messageType: 'storeValue',
          key: 'rex-spider-google-ai-last-sync',
          value: Date.now()
        }

        rexCorePlugin.handleMessage(storeMessage, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
          this.syncing = true

          fetch(this.fetchInitialUrls()[0])
            .then((response: Response) => {
              if (response.ok) {
                response.text().then((rawResponse) => {
                  console.log(`[rex-spider-google-ai] Fetched list payload (${response.status}: ${response.statusText}):`)
                  console.log(rawResponse)
                })
              }
            })
        })
      })
    })
  }

  parseConversationOff(conversationJson:any):Promise<any|null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return new Promise((resolve) => {
      console.log(`[rex-spider-chatgpt] parseConversation:`)
      console.log(conversationJson)

      const firstWhen = new Date(conversationJson['create_time'] * 1000)

      const latestDate = firstWhen

      const firstWhenString:DateString = new DateString(conversationJson['create_time'])

      const conversation:Conversation = {
        turns:[],
        platform: 'chatgpt',
        identifier: conversationJson['conversation_id'],
        started: firstWhenString,
        ended:firstWhenString,
        metadata: conversationJson // TODO: Pull out so only populated on debug=true
      }

      const convoIds = ['client-created-root']

      while (convoIds.length > 0) {
        const convoId = convoIds.shift()

        if (convoId !== undefined) {
          const turnJson = conversationJson['mapping'][convoId]

          if (turnJson !== undefined) {
            let createTime = firstWhenString

            if (turnJson.message !== null) {
              if (turnJson['create_time'] !== null) {
                createTime = new DateString(`${turnJson['create_time'] * 1000}`)
              }

              const turn:Turn = {
                speaker: turnJson.message.author.role,
                when: createTime,
                identifier: turnJson.message.id,
                'content*': '',
                'metadata*': turnJson,
                'parent': turnJson.parent,
              }

              if (turnJson.message.content.parts !== undefined) {
                turn['content*'] = turnJson.message.content.parts.join('\n')
              } else if (turnJson.message.content.text !== undefined) {
                turn['content*'] = turnJson.message.content.text
              }

              if (turnJson.metadata !== undefined) {
                if (turnJson.metadata['search_result_groups'] !== undefined) {
                  const search:Search = {
                      platform: 'chatgpt',
                      'query*': '?',
                      type: 'web',
                      results: []
                  }

                  for (const searchGroup of turnJson.metadata['search_result_groups']) {
                    for (const entry of (searchGroup.entries as any[])) { // eslint-disable-line @typescript-eslint/no-explicit-any
                      search.results.push({
                        title: entry['title'],
                        url: entry['url'],
                        preview: entry['snippet'],
                        index: entry['ref_id']['ref_index'],
                        metadata: entry,
                      })
                    }
                  }

                  turn.search = search
                }

                if (turnJson.metadata['content_references'] !== undefined) {
                  turn.citations = []

                  for (const contentReference of turnJson.metadata['content_references']) {
                    for (const item of contentReference['items']) {
                      const citation:Citation = {
                        title: item.title,
                        url: item.url,
                        source: item.attribution
                      }

                      if (item.attributions !== null) {
                        citation.source = item.attributions.join(', ')
                      }

                      turn.citations.push(citation)
                    }
                  }
                }
              }

              conversation.turns.push(turn)
            }

            for (const childId of turnJson.children) {
              convoIds.push(childId)
            }

          }
        }
      }

      const lastUpdateKey = `${conversation.platform}-${conversation.identifier}-last-update`

      const message = {
        messageType: 'fetchValue',
        key: lastUpdateKey
      }

      rexCorePlugin.handleMessage(message, this, (response) => {
        let timestamp = 0

        if (response !== null) {
          timestamp = response
        }

        console.log(`[rex-spider-chatgpt] TS TEST ${timestamp} <? ${latestDate.valueOf()}`)

        if (timestamp < latestDate.valueOf()) {
          const payload:EventPayload = {
            name: 'rex-conversation',
            date: firstWhen,
            ...conversation
          }

          console.log(`[rex-spider-chatgpt] log:`)
          console.log(payload)

          const storeMessage = {
            messageType: 'storeValue',
            key: lastUpdateKey,
            value: latestDate.valueOf()
          }

          rexCorePlugin.handleMessage(storeMessage, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
            console.log(`[rex-spider-chatgpt] ${lastUpdateKey} = ${latestDate.valueOf()}`)

            resolve(payload)
          })

          return
        } else {
          resolve(null)
        }
      })
    })
  }
}

const googleAISpider = new REXChatGoogleAISpider()

rexSpiderPlugin.registerSpider(googleAISpider)

export default googleAISpider