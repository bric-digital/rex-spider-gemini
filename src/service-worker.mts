import check from 'check-types'

import { Conversation, DateString } from '@bric/rex-types/types'

import { EventPayload, dispatchEvent } from '@bric/rex-core/service-worker'

import rexSpiderPlugin, { REXSpider, REXSpiderCrawlResult } from '@bric/rex-spider/service-worker'

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

  fetchChats(): Promise<Conversation[]> {
    return new Promise<Conversation[]>((resolve, reject) => {
      const requestId = Math.floor(Math.random() * (999999 - 10000)) + 10000

      const chatsUrl = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&hl=en&rt=c&_reqid=${requestId}`

      const payloads = [{
        'f.req': `[[["MaZiqc","[${GEMINI_SPIDER_PAGE_SIZE},null,[0,null,1]]",null,"generic"]]]`,
        'at': (this.accessToken as string)
      }, {
        'f.req': `[[["MaZiqc","[${GEMINI_SPIDER_PAGE_SIZE},null,[1,null,1]]",null,"generic"]]]`,
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
                this.signalCrawlComplete(-1, [], `List fetch failed (status ${response.status}) [0001].`)

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

                  const parsed = this.parseChatList(rawBody)

                  if (parsed !== null) {
                    for (const chat of parsed) {
                      chats.push(chat)
                    }

                    setTimeout(fetchNext, this.fetchCrawlDelay())
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
      const homeUrl = 'https://gemini.google.com/app'

      fetch(homeUrl, {
        method: 'GET',
        credentials: 'include', // Crucial property to send cookies
      }).then((response: Response) => {
        const crawledIds:string[] = []

        if (!response.ok) {
          this.signalCrawlComplete(-1, [], `Homepage fetch failed (status ${response.status}).`)

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
                this.signalCrawlComplete(-1, [], `No access token found on homepage.`)

                resolve({
                  sitesCrawled: [this.identifier()],
                  issues: [{
                    url: this.loginUrl(),
                    message: `No access token found on homepage.`
                  }]
                })
              } else {
                this.fetchChats().then((chatList:Conversation[]) => {
                  let dispatched = 0

                  const uploadConversations = () => {
                    if (chatList.length <= 0) {
                      this.signalCrawlComplete(dispatched, crawledIds, 'Fetch successful.')

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

                          this.checkIfAlreadyTransmitted(uploadKey).then((transmitted:boolean) => {
                            if (transmitted === false) {
                              dispatchEvent(payload)

                              dispatched += 1

                              this.logTransmitted(uploadKey).then(() => {
                                uploadConversations()
                              })
                            }
                          })
                        }
                      }
                    }
                  }

                  uploadConversations()
                }).catch((err) => {
                  this.signalCrawlComplete(-1, [], `Error encountered parsing conversations: ${err}.`)

                  resolve({
                    sitesCrawled: [this.identifier()],
                    issues: [{
                      url: this.loginUrl(),
                      message: `Error encountered parsing conversations: ${err}.`
                    }]
                  })
                })
              }
            } else {
              this.signalCrawlComplete(-1, [], `No access token found on homepage.`)

              resolve({
                sitesCrawled: [this.identifier()],
                issues: [{
                  url: this.loginUrl(),
                  message: `No access token found on homepage.`
                }]
              })
            }
          })
          .catch((err) => {
            this.signalCrawlComplete(-1, [], `Error encountered fetching conversations: ${err}.`)

            resolve({
              sitesCrawled: [this.identifier()],
              issues: [{
                url: this.loginUrl(),
                message: `Error fetching conversations: ${err}.`
              }]
            })
          })
        }
      }).catch((err) => {
        this.signalCrawlComplete(-1, [], `Error encountered fetching network resource: ${err}.`)

        resolve({
          sitesCrawled: [this.identifier()],
          issues: [{
            url: this.loginUrl(),
            message: `Error encountered fetching network resource: ${err}.`
          }]
        })
      })
    })
  }
}

const geminiSpider = new REXGeminiSpider()

rexSpiderPlugin.registerSpider(geminiSpider)

export default geminiSpider
