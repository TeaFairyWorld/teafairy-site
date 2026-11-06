import { chromium } from "playwright";
import fs from "node:fs";

const base = "http://127.0.0.1:4173";
const out = "/opt/cursor/artifacts";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desktop.goto(`${base}/index.html`);
if (await desktop.locator("#thank-you").count()) throw new Error("homepage campaign block is still present");
await desktop.goto(`${base}/redeem.html`);
await desktop.getByRole("heading", { name: "Redeem your gift" }).waitFor();
await desktop.locator("img[alt='TeaFairy 茶仙子']").waitFor();
if (await desktop.locator("#email, #instructions").count()) throw new Error("non-essential fields are on the form");
await desktop.screenshot({ path: `${out}/redeem-desktop.png`, fullPage: true });
await desktop.keyboard.press("Tab");
await desktop.getByRole("button", { name: "中文" }).click();
await desktop.getByRole("heading", { name: "领取礼物" }).waitFor();
await desktop.screenshot({ path: `${out}/redeem-chinese.png`, fullPage: true });
await desktop.getByRole("button", { name: "English" }).click();

await desktop.getByLabel("Gift code").fill("TEST-ONLY-CODE-NOT-LIVE-04");
await desktop.getByLabel("Recipient name").fill("Test Recipient");
await desktop.getByLabel("Phone").fill("07700900000");
await desktop.getByLabel("Address line 1").fill("1 Test Lane");
await desktop.getByLabel("City").fill("Testville");
await desktop.getByLabel("Postcode").fill("TE1 1ST");
await desktop.getByLabel("I agree that TeaFairy may use these details only to fulfil this gift and to contact me about its delivery.").check();
await desktop.getByRole("button", { name: "Submit my delivery details" }).click();
await desktop.getByRole("heading", { name: "We have your delivery details" }).waitFor();
const ref = (await desktop.locator("#ref").innerText()).trim();
if (!/^TF-[0-9A-F]{8}$/.test(ref)) throw new Error("bad reference");
const successText = await desktop.locator("#success").innerText();
if (/Test Lane|07700900000|TEST-ONLY/i.test(successText)) throw new Error("success echoed delivery details");
await desktop.screenshot({ path: `${out}/redeem-success.png`, fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${base}/redeem.html`);
await mobile.getByLabel("Gift code").waitFor();
await mobile.screenshot({ path: `${out}/redeem-mobile.png`, fullPage: true });
await browser.close();
console.log("simplified page checked");
