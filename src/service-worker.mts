import check from 'check-types'

import { Conversation, DateString } from '@bric/rex-types/types'

import rexCorePlugin, { EventPayload, dispatchEvent } from '@bric/rex-core/service-worker'

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
                  this.parseListResponse(rawResponse).then((conversations) => {

                    for (const conversation of conversations) {
                      const payload: EventPayload = {
                        name: 'rex-conversation',
                        date: conversation.started,
                        ...conversation
                      }

                      this.logSeen(conversation).then(() => {
                        dispatchEvent(payload)
                      })
                    }
                  })
                })
              }
            })
        })
      })
    })
  }

  checkSeen(conversation:Conversation) {
    return new Promise<boolean>((resolve) => {
      chrome.storage.local.get('rexSeenGoogleAIConversations').then((result) => {
        if (result.rexSeenGoogleAIConversations === undefined) {
          result.rexSeenGoogleAIConversations = []
        }

        resolve(result.rexSeenGoogleAIConversations.includes(`${conversation.identifier}-${conversation.started.toJSON()}`))
      })
    })
  }

  logSeen(conversation:Conversation) {
    return new Promise<void>((resolve) => {
      chrome.storage.local.get('rexSeenGoogleAIConversations').then((result) => {
        if (result.rexSeenGoogleAIConversations === undefined) {
          result.rexSeenGoogleAIConversations = []
        }

        result.rexSeenGoogleAIConversations.push(`${conversation.identifier}-${conversation.started.toJSON()}`)

        chrome.storage.local.set(result).then(() => {
          resolve()
        })
      })
    })
  }

  parseListResponse(rawContent:string):Promise<Conversation[]> {
    const cleanedResponse = rawContent.substring(6)

    console.log(cleanedResponse)

    const responseObject = JSON.parse(cleanedResponse)

    console.log('responseObject')
    console.log(responseObject)

    const pending = [... responseObject[0]]

    const parsed:Conversation[] = []

    return new Promise((resolve) => {
      const nextConvo = () => {
        if (pending.length == 0) {
          resolve(parsed)
        }

        const next = pending.pop()

        this.parseConversation(next)
          .then((parsedConvo) => {
            if (parsedConvo !== null) {
              this.checkSeen(parsedConvo).then((include:boolean) => {
                if (include) {
                  parsed.push(parsedConvo)
                }
              })
            }

            nextConvo()
          })
      }

      nextConvo()
    })
  }

  parseConversation(conversationJson:any):Promise<Conversation|null> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return new Promise((resolve) => {
      if (check.array(conversationJson)) {
        const conversation:Conversation = {
          turns: [],
          platform: 'google-ai',
          identifier: `${conversationJson[0][0]}_${conversationJson[0][1]}`,
          started: new DateString(conversationJson[5][0]),
          metadata: {
            'title*': conversationJson[1],
            'src': conversationJson
          }
        }

        resolve(conversation)
      } else {
        resolve(null)
      }
    })
  }
}

const googleAISpider = new REXChatGoogleAISpider()

rexSpiderPlugin.registerSpider(googleAISpider)

export default googleAISpider