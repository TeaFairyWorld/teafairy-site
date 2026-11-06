const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForHttp(port) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const req = require("node:http").get("http://127.0.0.1:" + port + "/redeem.html", (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - started > 8000) reject(new Error("page status " + res.statusCode));
        else setTimeout(attempt, 100);
      });
      req.on("error", () => {
        if (Date.now() - started > 8000) reject(new Error("server did not start"));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return {
    ready: opened,
    send(method, params, sessionId) {
      const msgId = ++id;
      return new Promise((resolve) => {
        pending.set(msgId, resolve);
        const payload = { id: msgId, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    },
    close() { ws.close(); }
  };
}

test("local gift page shows the closed bilingual form and does not submit", { timeout: 60000 }, async () => {
  const port = await freePort();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "teafairy-gift-"));
  const site = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore"
  });
  const chrome = spawn("/usr/local/bin/google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=" + profile,
    "--remote-allow-origins=*",
    "--remote-debugging-port=" + debugPort,
    "about:blank"
  ], { stdio: "ignore" });
  let client;
  try {
    await waitForHttp(port);
    let version;
    const started = Date.now();
    while (!version) {
      try {
        version = await (await fetch("http://127.0.0.1:" + debugPort + "/json/version")).json();
      } catch (error) {
        if (Date.now() - started > 8000) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    client = cdp(version.webSocketDebuggerUrl);
    await client.ready;
    const target = await client.send("Target.createTarget", { url: "about:blank" });
    const session = await client.send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
    const sessionId = session.result.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__fetches=[]; window.fetch=function(){ window.__fetches.push(String(arguments[0])); return Promise.reject(new Error('blocked')); };"
    }, sessionId);
    await client.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/redeem.html" }, sessionId);
    let seen = null;
    const deadline = Date.now() + 8000;
    while (!seen && Date.now() < deadline) {
      const polled = await client.send("Runtime.evaluate", {
        expression: "document.readyState === 'complete' && !!(window.TeaFairyGiftFlow && window.TEAFAIRY_GIFT_CONFIG)",
        returnByValue: true
      }, sessionId);
      if (polled.result && polled.result.result && polled.result.result.value === true) seen = true;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(seen, true);
    const evaluated = await client.send("Runtime.evaluate", {
      expression: `(async () => {
        const form = document.getElementById('redeem-form');
        document.getElementById('gift-fields-set').disabled = false;
        document.getElementById('code').value = '0123-4567-89AB-CDEF-GHJK-MNPQRS';
        document.getElementById('recipient_name').value = 'Example Person';
        document.getElementById('phone').value = '07000000000';
        document.getElementById('address1').value = '1 Example Street';
        document.getElementById('city').value = 'Exampleton';
        document.getElementById('postcode').value = 'AA1 1AA';
        document.getElementById('consent').checked = true;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
        return {
          inactive: document.getElementById('gift-inactive').hidden,
          inactiveText: document.getElementById('gift-inactive').textContent,
          success: document.getElementById('gift-success').hidden,
          invalid: document.getElementById('gift-invalid').hidden,
          grandIntro: document.body.textContent.includes('大奖不包含标准礼物'),
          tea: document.querySelector('img.redeem-mark').getAttribute('src'),
          cbbc: document.querySelector('img.cbbc-logo').getAttribute('src'),
          button: document.getElementById('submit').textContent,
          closed: document.getElementById('gift-fields-set').disabled,
          fetches: window.__fetches,
          storage: Object.keys(localStorage),
          session: Object.keys(sessionStorage)
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    const value = evaluated.result.result.value;
    assert.equal(value.inactive, false);
    assert.match(value.inactiveText, /cannot accept a real address yet/);
    assert.match(value.inactiveText, /不能接收真实地址/);
    assert.equal(value.success, true);
    assert.equal(value.invalid, true);
    assert.equal(value.grandIntro, true);
    assert.equal(value.tea, "images/logo.png");
    assert.equal(value.cbbc, "images/cbbc-approved-logo.png");
    assert.match(value.button, /尚未开放/);
    assert.equal(value.closed, true);
    assert.deepEqual(value.fetches, []);
    assert.deepEqual(value.storage, []);
    assert.deepEqual(value.session, []);
  } finally {
    if (client) client.close();
    chrome.kill("SIGKILL");
    site.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
