import { test, expect } from './fixtures';

test('Service worker data parsing tests', async ({serviceWorker}) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      serviceWorker.evaluate(async () => {
        return new Promise((testResolve) => {
          const doTest = () => {
            fetch(chrome.runtime.getURL('data/google-ai-list.txt'))
              .then((response) => {
                response.text().then((textString) => {
                  const conversations = self.rexGoogleAIPlugin.parseListResponse(textString)

                  testResolve(conversations)
                })
              })
          }

          self.setTimeout(doTest, 1000)
        })
      })
      .then((workerResponse) => {
        expect(workerResponse.length).toEqual(23)
        expect(workerResponse[0].metadata['title*']).toEqual('health disparity definition')

        resolve()
      })
    }, 1000)
  })
})
