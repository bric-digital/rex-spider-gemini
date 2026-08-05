import check from 'check-types'

import { Conversation, DateString } from '@bric/rex-types/types'

import rexCorePlugin, { EventPayload, dispatchEvent } from '@bric/rex-core/service-worker'

import rexSpiderPlugin, { REXSpider, REXSpiderCrawlResult } from '@bric/rex-spider/service-worker'

export class REXGeminiSpider extends REXSpider {
  sleepDelayMs:number = 10000
  syncing:boolean = false
  lastSync:number = 0
  syncPeriod:number = 300000
  accessToken:string|null = null

  fetchUrls(): string[] {
    return []
  }

  name(): string {
    return 'Gemini'
  }

  identifier(): string {
    return 'gemini'
  }

  loginUrl(): string {
    return 'https://gemini.google.com/app'
  }

  allowedUrls():string[] {
    return [
      '|https://gemini.google.com/app|',
      '|https://gemini.google.com/_/BardChatUi/data/batchexecute?*',
    ]
  }

  fetchInitialUrls(): string[] {
    return []
  }

  checkLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      fetch(this.loginUrl())
        .then((response: Response) => {
          if (response.ok) {
            response.text().then((rawHtml) => {
              if (rawHtml.includes("<span class=\"gb_ie\">Sign in</span>")) {
                  resolve(false)
              } else {
                resolve(true)
              }
            })
          } else {
            resolve(false)
          }
        })
    })
  }

  parseChatList(rawChatListData:string) : Conversation[] {
    const parsed:Conversation[] = []
 
    try {
      if (rawChatListData.startsWith(')]}\'')) {
        rawChatListData = rawChatListData.substring(4).trim()

        const lines = rawChatListData.split(/\r?\n/)

        for (const line of lines) {
          if (line.startsWith('[[')) {
            const parsedLine = JSON.parse(line)

            for (const message of parsedLine) {
              if (message.length > 2 && message[1] === 'MaZiqc') {
                const chatList = JSON.parse(message[2])

                if (check.array(chatList[2])) {
                  for (const chat of chatList[2]) {
                    const conversation:Conversation = {
                      identifier: chat[0],
                      turns: [],
                      platform: 'google-ai-gemini',
                      started: new DateString(chat[5][0]),
                      metadata: chat
                    }

                    parsed.push(conversation)
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[rex-spider-gemini] Error parsing conversation:`)
      console.error(err)
    }

    return parsed
  }

  private signalComplete(crawledCount: number, crawledIds: string[] = [], reason:string = 'None given') {
    setTimeout(() => {
      dispatchEvent({
        name: 'pdk-app-event',
        event_name: 'rex-spider-gemini-complete',
        event_details: {
          crawled_count: crawledCount,
          crawled_ids: crawledIds,
          reason,
          date: Date.now()
        }
      })
    }, 1100)
  }


  fetchChats(): Promise<Conversation[]> {
    return new Promise<Conversation[]>((resolve, reject) => {
      const requestId = Math.floor(Math.random() * (999999 - 10000)) + 10000

      const chatsUrl = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&hl=en&rt=c&_reqid=${requestId}`

      const payloads = [{
        'f.req': '[[["MaZiqc","[100,null,[0,null,1]]",null,"generic"]]]', // 13 -> 5
        'at': (this.accessToken as string)
      }, {
        'f.req': '[[["MaZiqc","[100,null,[1,null,1]]",null,"generic"]]]', // 13 -> 5
        'at': (this.accessToken as string)
      }]

      const chats:Conversation[] = []

      const fetchNext = () => {
        if (payloads.length <= 0) {
          resolve(chats)
        } else {
          const nextPayload = payloads.pop()

          if (nextPayload !== undefined) {
            fetch(chatsUrl, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },        
              body: new URLSearchParams(nextPayload)
            }).then((response: Response) => {
              if (!response.ok) {
                console.log(`[rex-spider-gemini] List fetch failed (status ${response.status}).`)
                this.syncing = false
                this.signalComplete(-1, [], `List fetch failed (status ${response.status}) [0001].`)
                reject(`List fetch failed (status ${response.status}).`)
              } else {
                response.text().then((rawBody) => {
                  console.log(`rawBody: ${rawBody}`)
                  const parsed = this.parseChatList(rawBody)

                  if (parsed !== null) {
                    for (const chat of parsed) {
                      chats.push(chat)
                    }
                  }

                  fetchNext()
                })
              }
            })
          } else {
            fetchNext()
          }        
        }
      }

      fetchNext()
    })
  }

  checkNeedsUpdate(): Promise<boolean> {
    // TODO: Deprecate in favor of cleaner doBackgroundCrawl
    return new Promise<boolean>((resolve) => {
      if (this.syncing) {
        console.log(`[rex-spider-gemini] Still syncing. Skipping this round...`)
        resolve(true)
      } else {
        const fetchLastSync = {
          messageType: 'fetchValue',
          key: 'rex-spider-gemini-last-sync'
        }

        rexCorePlugin.handleMessage(fetchLastSync, this, (response) => {
          let timestamp = 0

          if (response !== null) {
            timestamp = response
          }

          if (Date.now() < timestamp + this.syncPeriod) {
            console.log(`[rex-spider-gemini] Too soon to sync again. Skipping this round...`)
            this.signalComplete(-1, [], `Too soon to sync again.`)
            resolve(true)
          } else {
            const storeMessage = {
              messageType: 'storeValue',
              key: 'rex-spider-gemini-last-sync',
              value: Date.now()
            }

            rexCorePlugin.handleMessage(storeMessage, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
              this.syncing = true

              const homeUrl = 'https://gemini.google.com/app'

              fetch(homeUrl, {
                method: 'GET',
                credentials: 'include', // Crucial property to send cookies
              }).then((response: Response) => {
                if (!response.ok) {
                  console.log(`[rex-spider-gemini] Homepage fetch failed (status ${response.status}).`)

                  this.syncing = false
                  this.signalComplete(-1, [], `Homepage fetch failed (status ${response.status}).`)

                  resolve(true)
                } else {
                  response.text().then((rawHtml) => {
                    if (rawHtml.includes('"SNlM0e":"')) {
                      const startIndex = rawHtml.indexOf('"SNlM0e":"')

                      if (startIndex !== -1) {
                        const prefixStripped = rawHtml.substring(startIndex)

                        const tokens = prefixStripped.split('"')

                        if (tokens.length > 3) {
                          this.accessToken = tokens[3]
                        }
                      }

                      if (this.accessToken === null) {
                        this.syncing = false
                        this.signalComplete(-1, [], `No access token.`)

                        resolve(true)
                      } else {
                        this.fetchChats().then((chatList:Conversation[]) => {
                          let dispatched = 0

                          const crawledIds:string[] = []

                          const uploadConversations = () => {
                            if (chatList.length <= 0) {
                              this.syncing = false
                              this.signalComplete(dispatched, crawledIds, 'Fetch successful.')
                              resolve(false)
                            } else {
                              const conversation = chatList.pop()

                              if (conversation !== undefined) {
                                if (conversation.started.value !== null) {
                                  const payload: EventPayload = {
                                    name: 'rex-conversation',
                                    date: conversation.started.value.epochMilliseconds,
                                    ...conversation
                                  }

                                  crawledIds.push(conversation.identifier)

                                  const uploadKey = `rex-spider-gemini-upload-${conversation.identifier}-${conversation.started.toJSON()}`

                                  const fetchLastUpload = {
                                    messageType: 'fetchValue',
                                    key: uploadKey
                                  }

                                  rexCorePlugin.handleMessage(fetchLastUpload, this, (uploadValue) => {
                                    if (uploadValue === null) {
                                      dispatchEvent(payload)

                                      dispatched += 1

                                      const storeUpload = {
                                        messageType: 'storeValue',
                                        key: uploadKey,
                                        value: Date.now()
                                      }

                                      rexCorePlugin.handleMessage(storeUpload, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
                                        uploadConversations()
                                      })
                                    } else {
                                      uploadConversations()
                                    }
                                  })
                                }
                              }
                            }
                          }

                          uploadConversations()
                        })
                      }
                    }
                  })
                }
              })
              .catch((err) => {
                console.error(`[rex-spider-gemini] Error encountered fetching conversations:`)
                console.error(err)

                this.syncing = false
                this.signalComplete(-1, [], `Error encountered fetching conversations: ${err}`)

                resolve(true)
              })
            })
          }
        })
      }
    })
  }

  doBackgroundCrawl():Promise<REXSpiderCrawlResult> {
    return new Promise<REXSpiderCrawlResult>((resolve) => {
      const fetchLastSync = {
        messageType: 'fetchValue',
        key: 'rex-spider-gemini-last-sync'
      }

      rexCorePlugin.handleMessage(fetchLastSync, this, (response) => {
        let lastSynchTs = 0

        if (response !== null) {
          lastSynchTs = response
        }

        const when:Date = new Date(lastSynchTs)

        if (this.syncing) {
          console.log(`[rex-spider-gemini] Still syncing. Skipping this round...`)

          this.signalComplete(-1, [], `Still synching.`)

          resolve({
            sitesCrawled: [this.identifier()],
            issues: [{
              url: this.loginUrl(),
              message: `Still synching since ${when}.`
            }]
          })
        } else if (Date.now() < lastSynchTs + this.syncPeriod) {
            console.log(`[rex-spider-gemini] Too soon to sync again. Skipping this round...`)
            this.signalComplete(-1, [], `Too soon to sync again.`)

            resolve({
              sitesCrawled: [this.identifier()],
              issues: [{
                url: this.loginUrl(),
                message: `Too soon to synch since ${when} (period = ${this.syncPeriod}).`
              }]
            })
        } else {
          const storeMessage = {
            messageType: 'storeValue',
            key: 'rex-spider-gemini-last-sync',
            value: Date.now()
          }

          rexCorePlugin.handleMessage(storeMessage, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
            this.syncing = true

            const homeUrl = 'https://gemini.google.com/app'

            fetch(homeUrl, {
              method: 'GET',
              credentials: 'include', // Crucial property to send cookies
            }).then((response: Response) => {
              const crawledIds:string[] = []

              if (!response.ok) {
                console.log(`[rex-spider-gemini] Homepage fetch failed (status ${response.status}).`)

                this.syncing = false
                this.signalComplete(-1, [], `Homepage fetch failed (status ${response.status}).`)

                resolve({
                  sitesCrawled: [this.identifier()],
                  issues: [{
                    url: this.loginUrl(),
                    message: `Unable to fetch ${homeUrl}. Status code = ${response.status}.`
                  }]
                })
              } else {
                response.text().then((rawHtml) => {
                  if (rawHtml.includes('"SNlM0e":"')) {
                    const startIndex = rawHtml.indexOf('"SNlM0e":"')

                    if (startIndex !== -1) {
                      const prefixStripped = rawHtml.substring(startIndex)

                      const tokens = prefixStripped.split('"')

                      if (tokens.length > 3) {
                        this.accessToken = tokens[3]
                      }
                    }

                    if (this.accessToken === null) {
                      this.syncing = false
                      this.signalComplete(-1, [], `No access token`)

                      resolve({
                        sitesCrawled: [this.identifier()],
                        issues: []
                      })
                    } else {
                      this.fetchChats().then((chatList:Conversation[]) => {
                        let dispatched = 0

                        const uploadConversations = () => {
                          if (chatList.length <= 0) {
                            this.syncing = false
                            this.signalComplete(dispatched, crawledIds, 'Fetch successful.')

                            resolve({
                              sitesCrawled: [this.identifier()],
                              issues: []
                            })
                          } else {
                            const conversation = chatList.pop()

                            if (conversation !== undefined) {
                              if (conversation.started.value !== null) {
                                const payload: EventPayload = {
                                  name: 'rex-conversation',
                                  date: conversation.started.value.epochMilliseconds,
                                  ...conversation
                                }

                                crawledIds.push(conversation.identifier)

                                const uploadKey = `rex-spider-gemini-upload-${conversation.identifier}-${conversation.started.toJSON()}`

                                const fetchLastUpload = {
                                  messageType: 'fetchValue',
                                  key: uploadKey
                                }

                                rexCorePlugin.handleMessage(fetchLastUpload, this, (uploadValue) => {
                                  if (uploadValue === null) {
                                    dispatchEvent(payload)

                                    dispatched += 1

                                    const storeUpload = {
                                      messageType: 'storeValue',
                                      key: uploadKey,
                                      value: Date.now()
                                    }

                                    rexCorePlugin.handleMessage(storeUpload, this, (response) => { // eslint-disable-line @typescript-eslint/no-unused-vars
                                      uploadConversations()
                                    })
                                  } else {
                                    uploadConversations()
                                  }
                                })
                              }
                            }
                          }
                        }

                        uploadConversations()
                      })
                    }
                  }
                })
              }
            })
            .catch((err) => {
              console.error(`[rex-spider-gemini] Error encountered fetching conversations:`)
              console.error(err)

              this.syncing = false
              this.signalComplete(-1, [], `Error encountered fetching conversations: ${err}`)

              resolve({
                sitesCrawled: [this.identifier()],
                issues: [{
                  url: this.loginUrl(),
                  message: `Error fetching conversations: ${err}.`
                }]
              })
            })
          })
        }
      })
    })
  }
}

const geminiSpider = new REXGeminiSpider()

rexSpiderPlugin.registerSpider(geminiSpider)

export default geminiSpider