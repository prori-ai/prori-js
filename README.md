# prori

Official JavaScript / TypeScript SDK for [Prori](https://prori.ai).

```bash
npm install prori
```

```js
import { getDailyFeed, HOMEPAGE } from "prori";

const feed = await getDailyFeed({ days: 3 });
console.log(HOMEPAGE, feed.days?.[0]?.date);
```

This package reserves the `prori` name on npm. The client surface will grow as the public API ships.

- Site: https://prori.ai
- Org: https://github.com/prori-ai
- Issues: https://github.com/prori-ai/prori-js/issues
