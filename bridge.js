// جسر صغير بين نافذة «رسائلي» داخل التطبيق وبين حسابك على تيليجرام.
// يعرض لك رسائلك أنت فقط في المحادثات التي أرسلت فيها مؤخراً، ويعدّل الرسالة التي تختارها.
// التعديل حقيقي: يظهر عند الآخرين «تم التعديل».
//
// الأمان: كل طلب يلزمه رمز (token). الرمز يُولَّد مرة واحدة ويُحفظ في bridge-token.txt.
// الاتصال HTTP عادي (بدون تشفير)، فاستعمله على شبكتك المنزلية أو VPN فقط ولا تفتح المنفذ للإنترنت.
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { NewMessage } from "telegram/events/index.js";

const TOKEN_FILE = "./bridge-token.txt";

function loadToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  const t = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(TOKEN_FILE, t);
  return t;
}

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

const keyOf = (m) => String(m.chatId ?? m.peerId?.userId ?? m.peerId?.chatId ?? m.peerId?.channelId);

export async function startBridge(client) {
  const PORT = Number(process.env.BRIDGE_PORT || 8787);
  const HOST = process.env.BRIDGE_HOST || "0.0.0.0";
  const TOKEN = loadToken();
  const me = await client.getMe();
  const meKey = String(me.id);

  // آخر المحادثات التي أرسلت فيها (الأحدث أولاً). لا تشمل «الرسائل المحفوظة».
  const chats = new Map();   // key -> { key, peer, title, ts }
  client.addEventHandler(async (event) => {
    try {
      const m = event.message;
      const key = keyOf(m);
      if (key === meKey) return;
      let c = chats.get(key);
      if (!c) {
        const ent = await m.getChat().catch(() => null);
        const title = ent?.title || [ent?.firstName, ent?.lastName].filter(Boolean).join(" ") || key;
        c = { key, peer: m.peerId, title };
      }
      c.ts = Date.now();
      chats.set(key, c);
      if (chats.size > 12) {
        const oldest = [...chats.values()].sort((a, b) => a.ts - b.ts)[0];
        chats.delete(oldest.key);
      }
    } catch {}
  }, new NewMessage({ outgoing: true }));

  const send = (res, code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };
  const authed = (req, url) => {
    const given = String(req.headers["x-token"] || url.searchParams.get("token") || "");
    const a = Buffer.from(given), b = Buffer.from(TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 20000) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      if (!authed(req, url)) return send(res, 401, { ok: false, error: "unauthorized" });

      if (req.method === "GET" && url.pathname === "/chats") {
        const list = [...chats.values()].sort((a, b) => b.ts - a.ts).map((c) => ({ key: c.key, title: c.title }));
        return send(res, 200, { ok: true, chats: list });
      }

      if (req.method === "GET" && url.pathname === "/messages") {
        const c = chats.get(url.searchParams.get("chat") || "");
        if (!c) return send(res, 404, { ok: false, error: "chat not found" });
        const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 15));
        const recent = await client.getMessages(c.peer, { limit: 150 });
        const mine = recent
          .filter((m) => m.out && m.message)
          .slice(0, limit)
          .map((m) => ({ id: m.id, text: m.message, ts: m.date }));
        return send(res, 200, { ok: true, title: c.title, messages: mine });
      }

      if (req.method === "POST" && url.pathname === "/edit") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const c = chats.get(String(body.chat || ""));
        const id = Number(body.id);
        const text = String(body.text || "").trim();
        if (!c || !Number.isInteger(id)) return send(res, 400, { ok: false, error: "bad request" });
        if (!text || text.length > 4096) return send(res, 400, { ok: false, error: "bad text" });
        const [orig] = await client.getMessages(c.peer, { ids: [id] });
        if (!orig || !orig.out) return send(res, 403, { ok: false, error: "not your message" });   // لا نعدّل إلا رسائلك
        await client.editMessage(c.peer, { message: id, text });
        return send(res, 200, { ok: true });
      }

      send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      send(res, 500, { ok: false, error: String(e?.message || e) });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log("──────────── جسر «رسائلي» ────────────");
    for (const ip of lanIPs()) console.log(`الرابط داخل التطبيق: http://${ip}:${PORT}`);
    console.log("الرمز (Token):", TOKEN);
    console.log("أدخلهما في نافذة «رسائلي» ⚙︎ داخل التطبيق. لا تشاركهما.");
  });
}
