// Sends a plain-text message through the site's own Telegram bot. Used
// for admin notifications (new signups) -- never for anything the user
// hasn't implicitly opted into by using Telegram to log in.
export async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[telegram] sendMessage failed", e);
  }
}
