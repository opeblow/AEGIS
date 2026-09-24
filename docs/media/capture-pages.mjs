import fs from "node:fs";
const { chromium } = await import("file:///C:/Users/USER/Documents/AEGIS/frontend/node_modules/playwright/index.mjs");

const OUT = "C:/Users/USER/Documents/AEGIS/docs/media/";
const BASE = "http://localhost:3003";
const SHIM = "https://canton-testnet.rpc.wallet.metatarz.xyz";

const u256 = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");

const WALLET = `(() => {
  const account = "0x1D403a10F304FB9104d6aE9b2b8C4f21f2f1Bf8D";
  window.ethereum = {
    isMetatarz: true,
    request: ({ method, params }) => {
      switch (method) {
        case "eth_requestAccounts": return [account];
        case "eth_chainId": return "0x7679";
        case "eth_sendTransaction": return "0x" + "9c41".padEnd(64, "ab");
        case "personal_sign": return "0xdead";
        default: return null;
      }
    },
    on: () => undefined,
    removeListener: () => undefined,
  };
})();`;

const fixtures = {
  session: {
    user: { id: "usr-capture", email: "ops@magnitude-captial.io", name: "Aria Chen", role: "ADMIN" },
    organizations: [{ organizationId: "org-magnitude", role: "OWNER", organization: { id: "org-magnitude", name: "Magnitude Capital", slug: "magnitude" } }],
  },
  pools: [
    { id: "po-cc-usdcx", poolId: "po-cc-usdcx", token0Symbol: "CC", token1Symbol: "USDCx", inSymbol: "CC", outSymbol: "USDCx", tvlUsd: 4812000 },
    { id: "po-usdcx-handl", poolId: "po-usdcx-handl", token0Symbol: "USDCx", token1Symbol: "HANDL", inSymbol: "USDCx", outSymbol: "HANDL", tvlUsd: 912400 },
    { id: "po-cbtc-usdcx", poolId: "po-cbtc-usdcx", token0Symbol: "CBTC", token1Symbol: "USDCx", inSymbol: "CBTC", outSymbol: "USDCx", tvlUsd: 3021000 },
    { id: "po-ceth-usdcx", poolId: "po-ceth-usdcx", token0Symbol: "cETH", token1Symbol: "USDCx", inSymbol: "cETH", outSymbol: "USDCx", tvlUsd: 1815000 },
  ],
  tokens: [
    { symbol: "CC", name: "Canton Coin", address: "0x0000000000000000000000000000000000000000", decimals: 18, native: true },
    { symbol: "USDCx", name: "USDC on Canton", address: "0xDE40000000000000000000000000000000000001", decimals: 6, native: false },
    { symbol: "HANDL", name: "Handle", address: "0xDE50000000000000000000000000000000000001", decimals: 6, native: false },
    { symbol: "CBTC", name: "Canton Bitcoin", address: "0xDE60000000000000000000000000000000000001", decimals: 8, native: false },
    { symbol: "cETH", name: "Canton Ether", address: "0xDE70000000000000000000000000000000000001", decimals: 18, native: false },
  ],
  deal: {
    id: "dl-mag-001", name: "Cross-Border Trade Finance Line", reference: "MAG-2026-0142", status: "SETTLEMENT_PENDING",
    type: "TRADE_FINANCE", currency: "USD", notionalAmount: 12500000, version: 4,
    settlementDate: new Date("2026-12-15T12:00:00Z").toISOString(),
    createdAt: new Date("2026-08-02T09:00:00Z").toISOString(),
    updatedAt: new Date("2026-09-24T14:30:00Z").toISOString(),
    description: "Demand-funded trade line with OneSwap USDCx proceeds.",
  },
};

function json(route, body) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

const browser = await chromium.launch();

async function capture(name, path, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(WALLET);
  const page = await ctx.newPage();

  await page.route("**/api/v1/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const m = pathname.replace(/^\/api\/v1/, "");
    if (/^\/auth\/me$/.test(m)) return json(route, { user: fixtures.session.user });
    if (/^\/organizations$/.test(m)) return json(route, { organizations: fixtures.session.organizations });
    if (/^\/organizations\/[^/]+$/.test(m)) return json(route, { organization: fixtures.session.organizations[0].organization });
    if (/^\/organizations\/[^/]+\/deals$/.test(m)) return json(route, { deals: [{ ...fixtures.deal, id: "dl-mag-001" }], total: 1 });
    if (/^\/organizations\/[^/]+\/deals\/[^/]+$/.test(m)) return json(route, { deal: fixtures.deal });
    if (/^\/organizations\/[^/]+\/approval-workflows$/.test(m)) return json(route, { workflows: [] });
    if (/^\/organizations\/[^/]+\/security-events$/.test(m)) return json(route, { events: [] });
    if (/^\/deals\/[^/]+\/readiness$/.test(m)) return json(route, { readiness: { satisfied: 4, required: 5, requirements: [] } });
    if (/^\/deals\/[^/]+\/oneswap\/tokens$/.test(m)) return json(route, { tokens: fixtures.tokens });
    if (/^\/deals\/[^/]+\/oneswap\/pools$/.test(m)) return json(route, { pools: fixtures.pools });
    if (/^\/deals\/[^/]+\/oneswap\/pool\/[^/]+\/ticker$/.test(m)) return json(route, { ticker: { lastPrice: 1.0214, priceChangePercent24: 0.42, volume24: 1284000 } });
    return json(route, {});
  });

  await page.route("**/" + SHIM.replace(/^https?:\/\//, "") + "/**", (route) => {
    const body = route.request().postDataJSON?.() ?? {};
    const method = body?.method;
    if (method === "eth_getBalance") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0DE0B6B3A7640000" }) });
    if (method === "eth_call") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: u256(520000000000) }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }) });
  });

  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(opts.wait ?? 2200);

  if (opts.connectWallet) {
    const btn = page.getByRole("button", { name: /^Connect$/ }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.waitForTimeout(3200);
  }
  if (opts.clickTickers) {
    for (const b of await page.getByRole("button", { name: "Ticker" }).all()) {
      await b.click().catch(() => undefined);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1200);
  }

  if (opts.selector) {
    const el = page.locator(opts.selector).first();
    await el.screenshot({ path: OUT + name + ".png" });
  } else {
    await page.screenshot({ path: OUT + name + ".png", fullPage: true });
  }
  await ctx.close();
  console.log("captured", name);
}

await capture("landing-page", "/", { wait: 3200 });
await capture("sign-in", "/auth/sign-in", { wait: 1500 });
await capture("sign-up", "/auth/sign-up", { wait: 1500 });
await capture("onboarding", "/onboarding", { wait: 2500 });
await capture("deal-flow", "/", { selector: "svg[aria-labelledby='deal-flow-title']" });
await capture("canton-wallet", "/app/deals/dl-mag-001/canton", { wait: 2200, connectWallet: true, clickTickers: true });

await browser.close();
console.log("DONE");