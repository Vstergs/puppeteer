/**
 * Copyright 2019 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {IncomingMessage} from 'http';

import expect from 'expect';

import {
  getTestState,
  launch,
  setupTestBrowserHooks,
  setupTestPageAndContextHooks,
} from './mocha-utils.js';
import {waitEvent} from './utils.js';

describe('Chromium-Specific Launcher tests', function () {
  describe('Puppeteer.launch |browserURL| option', function () {
    it('should be able to connect using browserUrl, with and without trailing slash', async () => {
      const {defaultBrowserOptions, puppeteer} = getTestState();

      const {close} = await launch(
        Object.assign({}, defaultBrowserOptions, {
          args: ['--remote-debugging-port=21222'],
        })
      );
      try {
        const browserURL = 'http://127.0.0.1:21222';

        const browser1 = await puppeteer.connect({browserURL});
        const page1 = await browser1.newPage();
        expect(
          await page1.evaluate(() => {
            return 7 * 8;
          })
        ).toBe(56);
        browser1.disconnect();

        const browser2 = await puppeteer.connect({
          browserURL: browserURL + '/',
        });
        const page2 = await browser2.newPage();
        expect(
          await page2.evaluate(() => {
            return 8 * 7;
          })
        ).toBe(56);
        browser2.disconnect();
      } finally {
        await close();
      }
    });
    it('should throw when using both browserWSEndpoint and browserURL', async () => {
      const {defaultBrowserOptions, puppeteer} = getTestState();

      const {browser, close} = await launch(
        Object.assign({}, defaultBrowserOptions, {
          args: ['--remote-debugging-port=21222'],
        })
      );
      try {
        const browserURL = 'http://127.0.0.1:21222';

        let error!: Error;
        await puppeteer
          .connect({
            browserURL,
            browserWSEndpoint: browser.wsEndpoint(),
          })
          .catch(error_ => {
            return (error = error_);
          });
        expect(error.message).toContain(
          'Exactly one of browserWSEndpoint, browserURL or transport'
        );
      } finally {
        await close();
      }
    });
    it('should throw when trying to connect to non-existing browser', async () => {
      const {defaultBrowserOptions, puppeteer} = getTestState();

      const {close} = await launch(
        Object.assign({}, defaultBrowserOptions, {
          args: ['--remote-debugging-port=21222'],
        })
      );
      try {
        const browserURL = 'http://127.0.0.1:32333';

        let error!: Error;
        await puppeteer.connect({browserURL}).catch(error_ => {
          return (error = error_);
        });
        expect(error.message).toContain(
          'Failed to fetch browser webSocket URL from'
        );
      } finally {
        await close();
      }
    });
  });

  describe('Puppeteer.launch |pipe| option', function () {
    it('should support the pipe option', async () => {
      const {defaultBrowserOptions} = getTestState();
      const options = Object.assign({pipe: true}, defaultBrowserOptions);
      const {browser, close} = await launch(options, {createPage: false});
      try {
        expect(await browser.pages()).toHaveLength(1);
        expect(browser.wsEndpoint()).toBe('');
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
      } finally {
        await close();
      }
    });
    it('should support the pipe argument', async () => {
      const {defaultBrowserOptions} = getTestState();
      const options = Object.assign({}, defaultBrowserOptions);
      options.args = ['--remote-debugging-pipe'].concat(options.args || []);
      const {browser, close} = await launch(options);
      try {
        expect(browser.wsEndpoint()).toBe('');
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
      } finally {
        await close();
      }
    });
    it('should fire "disconnected" when closing with pipe', async () => {
      const {defaultBrowserOptions} = getTestState();
      const options = Object.assign({pipe: true}, defaultBrowserOptions);
      const {browser, close} = await launch(options);
      try {
        const disconnectedEventPromise = waitEvent(browser, 'disconnected');
        // Emulate user exiting browser.
        browser.process()!.kill();
        await disconnectedEventPromise;
      } finally {
        await close();
      }
    });
  });
});

describe('Chromium-Specific Page Tests', function () {
  setupTestBrowserHooks();
  setupTestPageAndContextHooks();
  it('Page.setRequestInterception should work with intervention headers', async () => {
    const {server, page} = getTestState();

    server.setRoute('/intervention', (_req, res) => {
      return res.end(`
        <script>
          document.write('<script src="${server.CROSS_PROCESS_PREFIX}/intervention.js">' + '</scr' + 'ipt>');
        </script>
      `);
    });
    server.setRedirect('/intervention.js', '/redirect.js');
    let serverRequest: IncomingMessage | undefined;
    server.setRoute('/redirect.js', (req, res) => {
      serverRequest = req;
      res.end('console.log(1);');
    });

    await page.setRequestInterception(true);
    page.on('request', request => {
      return request.continue();
    });
    await page.goto(server.PREFIX + '/intervention');
    // Check for feature URL substring rather than https://www.chromestatus.com to
    // make it work with Edgium.
    expect(serverRequest!.headers['intervention']).toContain(
      'feature/5718547946799104'
    );
  });
});
