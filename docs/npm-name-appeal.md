# npm support request — release the package name `prori`

Submit at <https://www.npmjs.com/support> → "Report a problem" → choose the
category about publishing / package names. Paste the body below.

Keep the tone factual. The case rests on one thing: `prori` is not a name we
want, it is a name we already own everywhere else, and npm is the only registry
where our own brand is unreachable.

---

**Subject:** Request to release blocked package name `prori` (brand owner, same name already held on PyPI)

**Body:**

Hi npm team,

I maintain the official SDKs for Prori (https://prori.ai) and would like to
publish our JavaScript SDK under the package name `prori`.

Publishing is currently rejected by the similar-name guard, which flags `prori`
as too close to the existing packages `proj4` and `poi`. Neither is related to
our project and we have no interest in their traffic — `prori` is simply our
company name.

Evidence that this is our brand, not a squat:

1. **Domain** — https://prori.ai is registered to us and is the product's
   production site.
2. **PyPI** — we already publish the identically-named official Python SDK at
   https://pypi.org/project/prori/ (author `Prori <hello@prori.ai>`, homepage
   https://prori.ai).
3. **GitHub organization** — https://github.com/prori-ai, which hosts
   https://github.com/prori-ai/prori-js (the source for this package) and
   https://github.com/prori-ai/prori-python.
4. **Already published on npm** — https://www.npmjs.com/package/prori-ai is the
   same SDK, published by us under a fallback name specifically because `prori`
   was blocked. Its `repository`, `homepage` and `author` fields all point at
   the assets above.

We are asking only for our own name. Concretely:

- Please allow the account `jackleeio` to publish `prori`.
- If a name-similarity exception is not something you grant, we would equally
  welcome guidance on the correct process, or confirmation that the block is
  permanent so we can stop pursuing it.

If granted, `prori` becomes the canonical package and `prori-ai` will be
deprecated pointing at it, so there will be exactly one package for users to
find — the same shape we already have on PyPI.

Thanks for taking a look.

Jack Lee — cattuan1399@gmail.com
npm account: jackleeio
