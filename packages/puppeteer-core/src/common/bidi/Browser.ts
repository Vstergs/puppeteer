/**
 * Copyright 2022 Google Inc. All rights reserved.
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

import {ChildProcess} from 'child_process';

import * as Bidi from 'chromium-bidi/lib/cjs/protocol/protocol.js';

import {
  Browser as BrowserBase,
  BrowserCloseCallback,
  BrowserContextOptions,
  BrowserEmittedEvents,
} from '../../api/Browser.js';
import {BrowserContext as BrowserContextBase} from '../../api/BrowserContext.js';
import {Viewport} from '../PuppeteerViewport.js';

import {BrowserContext} from './BrowserContext.js';
import {Connection} from './Connection.js';
import {debugError} from './utils.js';

/**
 * @internal
 */
export class Browser extends BrowserBase {
  static readonly subscribeModules = [
    'browsingContext',
    'network',
    'log',
    'cdp',
  ];

  #browserName = '';
  #browserVersion = '';

  static async create(opts: Options): Promise<Browser> {
    let browserName = '';
    let browserVersion = '';

    // TODO: await until the connection is established.
    try {
      const {result} = await opts.connection.send('session.new', {
        capabilities: {
          alwaysMatch: {
            acceptInsecureCerts: opts.ignoreHTTPSErrors,
          },
        },
      });
      browserName = result.capabilities.browserName ?? '';
      browserVersion = result.capabilities.browserVersion ?? '';
    } catch (err) {
      // Chrome does not support session.new.
      debugError(err);
    }

    await opts.connection.send('session.subscribe', {
      events: (browserName.toLocaleLowerCase().includes('firefox')
        ? Browser.subscribeModules.filter(module => {
            return !['cdp'].includes(module);
          })
        : Browser.subscribeModules) as Bidi.Message.EventNames[],
    });

    return new Browser({
      ...opts,
      browserName,
      browserVersion,
    });
  }

  #process?: ChildProcess;
  #closeCallback?: BrowserCloseCallback;
  #connection: Connection;
  #defaultViewport: Viewport | null;

  constructor(
    opts: Options & {
      browserName: string;
      browserVersion: string;
    }
  ) {
    super();
    this.#process = opts.process;
    this.#closeCallback = opts.closeCallback;
    this.#connection = opts.connection;
    this.#defaultViewport = opts.defaultViewport;
    this.#browserName = opts.browserName;
    this.#browserVersion = opts.browserVersion;

    this.#process?.once('close', () => {
      this.#connection.dispose();
      this.emit(BrowserEmittedEvents.Disconnected);
    });
  }

  get connection(): Connection {
    return this.#connection;
  }

  override async close(): Promise<void> {
    if (this.#connection.closed) {
      return;
    }
    this.#connection.dispose();
    await this.#closeCallback?.call(null);
  }

  override isConnected(): boolean {
    return !this.#connection.closed;
  }

  override process(): ChildProcess | null {
    return this.#process ?? null;
  }

  override async createIncognitoBrowserContext(
    _options?: BrowserContextOptions
  ): Promise<BrowserContextBase> {
    return new BrowserContext(this, {
      defaultViewport: this.#defaultViewport,
    });
  }

  override async version(): Promise<string> {
    return `${this.#browserName}/${this.#browserVersion}`;
  }
}

interface Options {
  process?: ChildProcess;
  closeCallback?: BrowserCloseCallback;
  connection: Connection;
  defaultViewport: Viewport | null;
  ignoreHTTPSErrors?: boolean;
}
