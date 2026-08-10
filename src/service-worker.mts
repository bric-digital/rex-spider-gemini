import check from 'check-types'

import { Conversation, DateString } from '@bric/rex-types/types'

import { EventPayload, dispatchEvent } from '@bric/rex-core/service-worker'

import rexSpiderPlugin, { REXSpider, REXSpiderCrawlResult, REXSpiderCrawlInspection } from '@bric/rex-spider/service-worker'

const GEMINI_SPIDER_PAGE_SIZE = 10

export class REXGeminiSpider extends REXSpider {
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

  parseChatList(rawChatListData:string) : Conversation[] | null {
    try {
      if (rawChatListData.startsWith(')]}\'')) {
        rawChatListData = rawChatListData.substring(4).trim()

        const lines = rawChatListData.split(/\r?\n/)

        const parsed:Conversation[] = []
        let foundValidResponse:boolean = false
 
        for (const line of lines) {
          if (line.startsWith('[[')) {
            const parsedLine = JSON.parse(line)

            for (const message of parsedLine) {
              if (message.length > 2 && message[1] === 'MaZiqc') {
                foundValidResponse = true

                const chatList = JSON.parse(message[2])

                if (check.array(chatList[2])) {
                  for (const chat of chatList[2]) {
                    const conversation:Conversation = {
                      identifier: chat[0],
                      turns: [],
                      platform: 'gemini',
                      ended: new DateString(chat[5][0]),
                      metadata: chat
                    }

                    parsed.push(conversation)
                  }
                }
              }
            }
          }
        }

        if (foundValidResponse) {
          return parsed
        }
      }
    } catch (err) {
      console.error(`[rex-spider-gemini] Error parsing conversation:`)
      console.error(err)
    }

    return null
  }

  fetchNextPageToken(rawChatListData:string) : string | null {
    // Raw payload:
    // [["wrb.fr","MaZiqc","[null,\"TOKEN\",[[CONVERSATIONS]]]", ...]]

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

                // Return string serving as next page token.

                if (chatList.length > 2) {
                  return chatList[1]
                }

                return null
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[rex-spider-gemini] Error parsing conversation:`)
      console.error(err)
    }

    return null
  }

  fetchChats(): Promise<REXSpiderCrawlInspection[]> {
    return new Promise<REXSpiderCrawlInspection[]>((resolve, reject) => {
      const requestId = Math.floor(Math.random() * (999999 - 10000)) + 10000

      const chatsUrl = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&hl=en&rt=c&_reqid=${requestId}`

      const payloads = [{
        'f.req': `[[["MaZiqc","[${GEMINI_SPIDER_PAGE_SIZE},null,[0,null,1]]",null,"generic"]]]`,
        'at': (this.accessToken as string)
      }, {
        'f.req': `[[["MaZiqc","[${GEMINI_SPIDER_PAGE_SIZE},null,[1,null,1]]",null,"generic"]]]`,
        'at': (this.accessToken as string)
      }]

      const checkedRecords:REXSpiderCrawlInspection[] = []

      const fetchNext = () => {
        if (payloads.length == 0) {
          resolve(checkedRecords)
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
                this.signalCrawlComplete(-1, [], `List fetch failed (status ${response.status}).`)

                reject(`List fetch failed (status ${response.status}).`)
              } else {
                response.text().then((rawBody) => {
                  const nextToken:string|null = this.fetchNextPageToken(rawBody)

                  if (nextToken !== null) {
                    const newRequestWrapper = JSON.parse(nextPayload['f.req'])

                    const newRequest = JSON.parse(newRequestWrapper[0][0][1])

                    newRequest[1] = nextToken

                    newRequestWrapper[0][0][1] = JSON.stringify(newRequest)

                    const newPayload = {
                      'at': nextPayload['at'],
                      'f.req': JSON.stringify(newRequestWrapper)
                    }

                    payloads.push(newPayload)
                  }

                  const parsed:Conversation[] | null = this.parseChatList(rawBody)

                  if (parsed !== null) {
                    const checkNextConversation = () => {
                      if (parsed.length === 0) {
                        setTimeout(fetchNext, this.fetchCrawlDelay())
                      } else {
                        const nextConvo:Conversation | undefined = parsed.pop()

                        if (nextConvo !== undefined && nextConvo.ended !== undefined) {
                          this.crawlWindowContains(nextConvo.ended.timestamp()).then((include) => {
                            if (include && nextConvo.ended !== undefined) {
                              const uploadKey = `rex-spider-gemini-upload-${nextConvo.identifier}-${nextConvo.ended.toJSON()}`

                              this.checkIfAlreadyTransmitted(uploadKey).then((transmitted:boolean) => {
                                if (transmitted) {
                                  checkedRecords.push({
                                    id: nextConvo.identifier,
                                    refresh: false,
                                    conversation: nextConvo
                                  })
                                } else {
                                  checkedRecords.push({
                                    id: nextConvo.identifier,
                                    refresh: true,
                                    conversation: nextConvo
                                  })
                                }

                                checkNextConversation()
                              })
                            } else {
                              checkNextConversation()
                            }
                          })
                        } else {
                          checkNextConversation()
                        }
                      }
                    }

                    checkNextConversation()
                  } else {
                    this.signalCrawlComplete(-1, [], `Received invalid response for conversation API. Request: ${JSON.stringify(nextPayload)}`)
                    
                    reject(`Received invalid response for conversation API. Request: ${JSON.stringify(nextPayload)}`)
                  }
                })
              }
            })
          } else {
            setTimeout(fetchNext, this.fetchCrawlDelay())
          }        
        }
      }

      fetchNext()
    })
  }

  doBackgroundCrawl():Promise<REXSpiderCrawlResult> {
    return new Promise<REXSpiderCrawlResult>((resolve) => {
      super.doBackgroundCrawl().then((crawlResult:REXSpiderCrawlResult) => {
        const homeUrl = 'https://gemini.google.com/app'

        fetch(homeUrl, {
          method: 'GET',
          credentials: 'include', // Crucial property to send cookies
        }).then((response: Response) => {
          const crawledIds:string[] = []

          if (!response.ok) {
            this.signalCrawlComplete(-1, [], `Homepage fetch failed (status ${response.status}).`)

            crawlResult.issues.push({
              url: this.loginUrl(),
              message: `Unable to fetch ${homeUrl}. Status code = ${response.status}.`
            })

            resolve(crawlResult)
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
                  this.signalCrawlComplete(-1, [], `No access token found on homepage.`)

                  crawlResult.issues.push({
                    url: this.loginUrl(),
                    message: `No access token found on homepage.`
                  })

                  resolve(crawlResult)
                } else {
                  this.fetchChats().then((inspectionRecords:REXSpiderCrawlInspection[]) => {
                    let dispatched = 0

                    const processNextConversation = () => {
                      if (inspectionRecords.length <= 0) {
                        this.signalCrawlComplete(dispatched, crawledIds, 'Fetch successful.')

                        resolve(crawlResult)
                      } else {
                        const inspectionRecord:REXSpiderCrawlInspection | undefined = inspectionRecords.pop()

                        if (inspectionRecord !== undefined && inspectionRecord.conversation !== undefined) {
                          crawledIds.push(inspectionRecord.id)

                          const conversation:Conversation = inspectionRecord.conversation

                          if (conversation.ended !== undefined) {
                            const ended:DateString = conversation.ended

                            if (inspectionRecord.refresh) {
                              const uploadKey = `rex-spider-gemini-upload-${conversation.identifier}-${conversation.ended.toJSON()}`

                              this.checkIfAlreadyTransmitted(uploadKey).then((transmitted:boolean) => {
                                if (transmitted === false && ended.value !== null) {
                                  const payload: EventPayload = {
                                    name: 'rex-conversation',
                                    date: ended.value.epochMilliseconds,
                                    ...conversation
                                  }

                                  dispatchEvent(payload)

                                  dispatched += 1

                                  this.logTransmitted(uploadKey).then(() => {
                                    processNextConversation()
                                  })
                                } else {
                                  processNextConversation()
                                }
                              })
                            } else {
                              processNextConversation()
                            }
                          } else {
                            processNextConversation()
                          }
                        } else {
                          processNextConversation()
                        }
                      }
                    }

                    processNextConversation()
                  }).catch((err) => {
                    this.signalCrawlComplete(-1, [], `Error encountered parsing conversations: ${err}.`)

                    crawlResult.issues.push({
                      url: this.loginUrl(),
                      message: `Error encountered parsing conversations: ${err}.`
                    })

                    resolve(crawlResult)
                  })
                }
              } else {
                this.signalCrawlComplete(-1, [], `No access token found on homepage.`)

                crawlResult.issues.push({
                  url: this.loginUrl(),
                  message: `No access token found on homepage.`
                })

                resolve(crawlResult)
              }
            })
            .catch((err) => {
              this.signalCrawlComplete(-1, [], `Error encountered fetching conversations: ${err}.`)

              crawlResult.issues.push({
                url: this.loginUrl(),
                message: `Error fetching conversations: ${err}.`
              })

              resolve(crawlResult)
            })
          }
        }).catch((err) => {
          this.signalCrawlComplete(-1, [], `Error encountered fetching network resource: ${err}.`)

          crawlResult.issues.push({
            url: this.loginUrl(),
            message: `Error encountered fetching network resource: ${err}.`
          })

          resolve(crawlResult)
        })
      })
    })
  }
}

const geminiSpider = new REXGeminiSpider()

rexSpiderPlugin.registerSpider(geminiSpider)

export default geminiSpider
