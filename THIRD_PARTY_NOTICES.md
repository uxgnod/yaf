# Third-party notices

yaf includes or is derived from the following third-party work.

## openclaw-weixin

`worker/wechat/protocol.ts` and `worker/wechat/media.ts` implement the WeChat ClawBot (iLink) protocol based on the source of
[`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) v2.4.10.

```
Tencent is pleased to support the open source community by making openclaw-weixin available.

Copyright (C) 2026 Tencent.  All rights reserved.

openclaw-weixin is licensed under the MIT.
```

The MIT License:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

yaf is not affiliated with or endorsed by Tencent. The WeChat integration uses an unofficial protocol and may stop working at any time.

## Bundled dependencies

The deployed Worker and web app bundle these npm packages. Each is distributed under its own license, included in the package:

| Package | License |
| --- | --- |
| `@ai-sdk/anthropic`, `ai` | Apache-2.0 |
| `@modelcontextprotocol/server` | Apache-2.0 |
| `@noble/ciphers` | MIT |
| `agents` | MIT |
| `croner` | MIT |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `hono` | MIT |
| `marked` | MIT |
| `qrcode` | MIT |
| `react`, `react-dom` | MIT |
| `silk-wasm` | MIT |
| `workers-ai-provider` | MIT |
| `zod` | MIT |

Fonts (Inter, JetBrains Mono) are loaded from Google Fonts under the SIL Open Font License 1.1.
