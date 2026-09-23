# Mobbin references

Mobbin is Home's source of real-world product screens and flows for design work. The reference workflow, citation format, and critique rule live in the [Figma workflow](figma-workflow.md#references).

Facts on this page were checked against Mobbin's own pages on 2026-09-23: [Terms of Service](https://mobbin.com/terms) (effective May 16, 2026), [Mobbin MCP](https://mobbin.com/mcp), [Mobbin docs](https://docs.mobbin.com), [AI credits](https://docs.mobbin.com/ai-credits), and [rate limits](https://docs.mobbin.com/rate-limits). Recheck them when Mobbin changes plans or terms.

## Plan and capabilities

| Surface | Authorization | Plans | Home use |
| --- | --- | --- | --- |
| MCP (`https://api.mobbin.com/mcp`) | OAuth | Pro, Team, Enterprise | The factory's only route, through the Toshi MCP Gateway |
| REST API (`https://api.mobbin.com/v1`) | Workspace API key (Bearer) | Team, Enterprise | Not used and not needed |
| [Figma plugin](https://mobbin.com) (Copy to Figma → paste) | Mobbin sign-in | Works with Jesse's paid seat | Placing selected references in the Home Figma file |

- Jesse holds the paid plan. Before the subscription, the laptop's first MCP search on 2026-09-23 returned `Mobbin MCP requires a paid plan`; that error means the authorized account is not the paid one.
- The MCP exposes `search_screens` (`platform` `ios` or `web`, `query`, optional `task_intent`, `limit` up to 30, `exclude_screen_ids`, and `mode` `deep` (default) or `standard`), `search_flows` (`platform`, `query`, optional `task_intent`, `limit` up to 10, `page`), and `search_sections` (web sections such as pricing or footers). Each result carries `app_name`, a durable `mobbin_url`, and an `image_url` that expires after 30 days.
- Only Deep Search spends AI credits: 5 per successful search, with 300 credits (60 deep searches) a month on Pro and 600 per member on Team. Standard Search, flow search, and browsing cost 0. A grace period starts on 5 October 2026; after it, deep searches are subject to the monthly allowance, which resets monthly and does not roll over. The MCP is limited to 60 requests per 60 seconds per user.

## Access path

Mobbin is configured in the Toshi MCP Gateway, as server `mobbin`, on Jesse's laptop and on the studio host. The Gateway holds the OAuth session; nothing Mobbin-specific lives in `~/.pi/agent/mcp.json`, `~/.config/home-factory/`, or the repository. There is no Mobbin token file. The smoke below proves access on the host that runs it.

A factory worker calls the Gateway's `mux_mcp_call` tool with `tool_id: "mobbin.<tool>"` and the tool's arguments. Discover the tools and schemas with `mux_mcp_search` (query `mobbin`), `mux_mcp_list_tools` (`server_id: "mobbin"`), or `mux_mcp_describe`.

### Smoke

The smoke uses no secret and costs no credits:

```json
{ "tool_id": "mobbin.search_flows", "arguments": { "platform": "ios", "query": "borrow against crypto collateral", "limit": 3 } }
```

A pass returns a `flows` array whose entries have `app_name`, `name`, and a `https://mobbin.com/flows/<id>` `mobbin_url`.

Evidence from issue #790, a factory run on the studio host on 2026-09-23:

- `search_flows` with exactly the arguments above returned OKX `Loan data`, OKX `Apply for a loan`, and Binance `Borrow`.
- `search_screens` with `platform: "ios"` and `query: "finance app borrow against crypto"` in the default `deep` mode and default limit returned 20 screens, including OKX, Crypto.com, Fuse, Binance, Kraken, Wealthsimple, and Coinbase.
- The same screen query with `mode: "standard"` and `limit: 5` returned Perplexity, Lloyds Mobile Banking, Affirm, MoonPay, and PayPal.

Use `deep` for a pattern question worth a credit, and `standard` or `search_flows` for broad browsing. Record results as app names and links, not images.

### When it is unavailable

If the `mobbin` server is missing from the Gateway, the call fails, or Mobbin reports a plan, credit, or authorization problem, the worker continues the design task without references. It writes `Mobbin unavailable: <one-line reason>` in `pr.md` or `.factory/comment.md` and names the one Jesse step: re-authorize `mobbin` in the Toshi MCP Gateway from the affected host's browser, or wait for the credit reset. It never scrapes mobbin.com, signs in through a browser session, or substitutes another scraper.

## Terms constraints

These are Home's working rules. Quoted text and section numbers are Mobbin's; the rest is Home's conservative reading.

- **Internal design reference is the permitted use.** MCP and API services are provided for "your personal or internal business use" or integration into your own products (section 3). Using references to inform Home's own designs is that use. Do not resell or share access, build anything competitive with Mobbin, or "use any content retrieved via the API or MCP Services to create a standalone content repository" (section 3).
- **No scraping or automated bypass.** Access only through the MCP, the Figma plugin, or the Mobbin site as a signed-in user. The terms forbid unauthorized scrapers, bots, and crawlers and bypassing rate limits or authentication (section 3).
- **No copies outside the Home Figma file.** The terms forbid mirroring, caching, archiving, or re-hosting retrieved content on another website, server, or platform without Mobbin's written consent (section 3), and allow citations and images to be "published elsewhere in limited extent, and only if crediting the respective IP Holders" (section 10.3). Home never commits Mobbin images or puts them in `.factory/media/`, PR bodies, issues, or comments; it cites by link. Selected screens live only in the Home Figma file's References section, placed with Mobbin's own Copy to Figma plugin or downloaded from the MCP `image_url` as Mobbin's tool description directs for Figma. The terms do not name Figma; the basis is Mobbin's own plugin. That file must stay limited to Jesse's collaborators, never be shared publicly, and never publish References through a library. Keep a small curated set per pattern, not a mirror.
- **Borrow patterns, do not copy screens.** The terms forbid using AI or machine learning "to create derivative works of any materials" or "to train, test, index, benchmark, or improve" any model (section 3). A worker studies references and names the pattern it adopts; it does not reproduce a referenced screen, its artwork, or its brand, and never uses Mobbin content as training or evaluation data.
- **Third parties own what is pictured.** Screens remain the copyright and trademark of each app's owner (section 10.3); every citation names the app.
- **One seat, one person.** Account sharing is prohibited (section 4.1). Home's reading: the factory uses Jesse's seat only as Jesse's agents on Jesse's hosts through his Gateway session, and no other person uses it.
