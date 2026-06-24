import { test, expect } from './fixtures';

test('Service worker data parsing tests', async ({serviceWorker}) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      serviceWorker.evaluate(async () => {
        return new Promise((testResolve) => {
          const doTest = () => {
            testResolve('TODO: Add Tests')
          }

          self.setTimeout(doTest, 1000)
        })
      })
      .then((workerResponse) => {
        expect(workerResponse).toEqual('TODO: Add Tests')

        resolve()
      })
    }, 1000)
  })
})
