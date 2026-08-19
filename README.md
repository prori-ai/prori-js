# prori

Official JavaScript / TypeScript SDK for [Prori](https://prori.ai).

```bash
npm install prori-ai
```

```js
import { getDailyFeed, HOMEPAGE } from "prori-ai";

const feed = await getDailyFeed({ days: 3 });
console.log(HOMEPAGE, feed.days?.[0]?.date);
```

This package reserves the `prori-ai` name on npm (`prori` is blocked as too similar to existing packages). The client surface will grow as the public API ships.

- Site: https://prori.ai
- Org: https://github.com/prori-ai
- Issues: https://github.com/prori-ai/prori-js/issues
