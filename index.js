// "تعديل بالإرسال": بدل تعديل الرسالة (فتظهر «تم التعديل»)، يُرسل النص الجديد كرسالة جديدة ثم تُحذف القديمة.
//
// الاستخدام: في أي محادثة، رُدّ (Reply) على رسالتك القديمة برسالة بهذا الشكل:
//     .edit النص الجديد        أو        .تعديل النص الجديد
// الترتيب: (1) إرسال الجديدة  (2) حذف القديمة  (3) حذف رسالة الأمر.
//
// تعديل عادي (يظهر عند الآخرين «تم التعديل»): اكتب في أي محادثة
//     .e النص الجديد          ← يعدّل آخر رسالة نصية لك في هذه المحادثة
//     (ردّ على رسالة لك) .e النص الجديد   ← يعدّل تلك الرسالة بالذات
//
// اختيار الرسالة من قائمة (تعديل عادي أيضاً):
//     .my            ← يرسل لك في «الرسائل المحفوظة» قائمة مرقّمة بآخر رسائلك النصية في هذه المحادثة فقط
//     .my 20         ← نفس الشيء لآخر 20 رسالة (الافتراضي 10، الأقصى 30)
//     .ed 3 النص الجديد   ← يعدّل الرسالة رقم 3 من آخر قائمة طلبتها في هذه المحادثة
// الإرسال يسبق الحذف دائماً، فلا تضيع رسالتك لو فشل شيء.
import "dotenv/config";
import fs from "node:fs";
import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { startBridge } from "./bridge.js";

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const SESSION_FILE = "./session.txt";
const COMMANDS = (process.env.COMMANDS || ".edit,.تعديل")
  .split(",").map((c) => c.trim()).filter(Boolean);
const EDIT_LAST = (process.env.EDIT_LAST_COMMANDS || ".e,.ع")
  .split(",").map((c) => c.trim()).filter(Boolean);
const LIST_CMDS = (process.env.LIST_COMMANDS || ".my,.لي")
  .split(",").map((c) => c.trim()).filter(Boolean);
const PICK_CMDS = (process.env.PICK_COMMANDS || ".ed,.حدد")
  .split(",").map((c) => c.trim()).filter(Boolean);

// آخر قائمة طلبتها في كل محادثة: chatKey -> [message ids]
const lastLists = new Map();
const chatKey = (m) => String(m.chatId ?? m.peerId?.userId ?? m.peerId?.chatId ?? m.peerId?.channelId);
const oneLine = (t, n = 70) => {
  const x = (t || "").replace(/\s+/g, " ").trim();
  return x.length > n ? x.slice(0, n) + "…" : x;
};
const isCommandText = (t) =>
  [...COMMANDS, ...EDIT_LAST, ...LIST_CMDS, ...PICK_CMDS].some(
    (c) => t === c || t.startsWith(c + " ") || t.startsWith(c + "\n"));

const saved =
  process.env.SESSION ||
  (fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, "utf8").trim() : "");

const client = new TelegramClient(new StringSession(saved), API_ID, API_HASH, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () => await input.text("رقم الهاتف (مع رمز الدولة): "),
  password: async () => await input.text("كلمة مرور التحقق بخطوتين (إن وجدت): "),
  phoneCode: async () => await input.text("الكود الذي وصلك: "),
  onError: (err) => console.error(err),
});
fs.writeFileSync(SESSION_FILE, client.session.save());
if (process.env.BRIDGE !== "off") await startBridge(client);   // نافذة «رسائلي» داخل التطبيق (عطّلها بـ BRIDGE=off)
console.log("تم تسجيل الدخول ✅ — تعديل بالإرسال:", COMMANDS.join("  "), "| تعديل آخر رسالة:", EDIT_LAST.join("  "), "| قائمة:", LIST_CMDS.join("  "), "| اختيار:", PICK_CMDS.join("  "));

function parseCommand(text, list = COMMANDS) {
  for (const cmd of list) {
    if (text === cmd || text.startsWith(cmd + " ") || text.startsWith(cmd + "\n")) {
      return text.slice(cmd.length).trim();
    }
  }
  return null;
}

client.addEventHandler(async (event) => {
  const msg = event.message;
  const raw = (msg.message || "").trim();

  // ── .my : قائمة برسائلي الأخيرة في هذه المحادثة (تُرسل لـ «الرسائل المحفوظة» فقط) ──
  const listArg = parseCommand(raw, LIST_CMDS);
  if (listArg !== null) {
    const chat = msg.peerId;
    try {
      const n = Math.min(30, Math.max(1, parseInt(listArg, 10) || 10));
      const recent = await client.getMessages(chat, { limit: 150 });
      const mine = recent
        .filter((m) => m.out && m.message && m.id !== msg.id && !isCommandText(m.message.trim()))
        .slice(0, n);
      lastLists.set(chatKey(msg), mine.map((m) => m.id));
      const ent = await msg.getChat().catch(() => null);
      const title = ent?.title || [ent?.firstName, ent?.lastName].filter(Boolean).join(" ") || "المحادثة";
      const lines = mine.map((m, i) => {
        const d = new Date(m.date * 1000);
        const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        return `${i + 1}. [${hh}] ${oneLine(m.message)}`;
      });
      const body = mine.length
        ? `📝 رسائلك في «${title}»:\n\n${lines.join("\n")}\n\nللتعديل اكتب في تلك المحادثة:\n.ed رقم النص_الجديد`
        : `لا توجد رسائل نصية لك حديثة في «${title}».`;
      await client.sendMessage("me", { message: body });   // لا يظهر لأحد غيرك
      await client.deleteMessages(chat, [msg.id], { revoke: true });
    } catch (e) {
      console.error("فشل القائمة:", e?.message || e);
    }
    return;
  }

  // ── .ed N نص : تعديل الرسالة رقم N من آخر قائمة ──
  const pickArg = parseCommand(raw, PICK_CMDS);
  if (pickArg !== null) {
    const chat = msg.peerId;
    try {
      const m = pickArg.match(/^(\d{1,2})\s+([\s\S]+)$/);
      const ids = lastLists.get(chatKey(msg));
      if (!m) {
        await client.sendMessage(chat, { message: "✍️ الصيغة: .ed رقم النص_الجديد" });
        return;
      }
      if (!ids || !ids.length) {
        await client.sendMessage(chat, { message: "اكتب .my أولاً في هذه المحادثة لتظهر لك القائمة." });
        return;
      }
      const idx = parseInt(m[1], 10) - 1;
      if (idx < 0 || idx >= ids.length) {
        await client.sendMessage(chat, { message: `⛔ الرقم خارج القائمة (1–${ids.length}).` });
        return;
      }
      await client.editMessage(chat, { message: ids[idx], text: m[2].trim() });
      await client.deleteMessages(chat, [msg.id], { revoke: true });
    } catch (e) {
      console.error("فشل التعديل:", e?.message || e);
      try { await client.sendMessage(chat, { message: "⚠️ فشل التعديل: " + (e?.message || e) }); } catch {}
    }
    return;
  }

  // ── تعديل عادي لآخر رسالة (أو للرسالة المردود عليها) ──
  const editText = parseCommand(raw, EDIT_LAST);
  if (editText !== null) {
    const chat = msg.peerId;
    try {
      if (!editText) {
        await client.sendMessage(chat, { message: "✍️ اكتب النص الجديد بعد الأمر." });
        return;
      }
      let target;
      if (msg.replyTo?.replyToMsgId) {
        [target] = await client.getMessages(chat, { ids: [msg.replyTo.replyToMsgId] });
      } else {
        const recent = await client.getMessages(chat, { limit: 15 });
        target = recent.find((m) => m.out && m.id !== msg.id && m.message);   // آخر رسالة نصية لك
      }
      if (!target || !target.out) {
        await client.sendMessage(chat, { message: "⛔ لم أجد رسالة لك لتعديلها." });
        return;
      }
      await client.editMessage(chat, { message: target.id, text: editText });
      await client.deleteMessages(chat, [msg.id], { revoke: true });   // احذف رسالة الأمر فقط
    } catch (e) {
      console.error("فشل التعديل:", e?.message || e);
      try { await client.sendMessage(chat, { message: "⚠️ فشل التعديل: " + (e?.message || e) }); } catch {}
    }
    return;
  }

  const newText = parseCommand(raw);
  if (newText === null) return;                       // ليست رسالة أمر

  const chat = msg.peerId;
  try {
    if (!msg.replyTo?.replyToMsgId) {
      await client.sendMessage(chat, { message: "↩️ رُدّ على رسالتك القديمة مع النص الجديد بعد الأمر." });
      return;
    }
    if (!newText) {
      await client.sendMessage(chat, { message: "✍️ اكتب النص الجديد بعد الأمر." });
      return;
    }

    const [orig] = await client.getMessages(chat, { ids: [msg.replyTo.replyToMsgId] });
    if (!orig) return;
    if (!orig.out) {                                   // لا نحذف رسائل غيرك أبداً
      await client.sendMessage(chat, { message: "⛔ هذه ليست رسالتك." });
      return;
    }

    // (1) أرسل الجديدة أولاً — وتحافظ على رد الرسالة القديمة إن كانت ردّاً على شيء
    await client.sendMessage(chat, {
      message: newText,
      replyTo: orig.replyTo?.replyToMsgId,
    });

    // (2)+(3) احذف القديمة ورسالة الأمر للجميع
    await client.deleteMessages(chat, [orig.id, msg.id], { revoke: true });
  } catch (e) {
    console.error("فشل:", e?.message || e);
    try { await client.sendMessage(chat, { message: "⚠️ فشل التنفيذ: " + (e?.message || e) }); } catch {}
  }
}, new NewMessage({ outgoing: true }));
