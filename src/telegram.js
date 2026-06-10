const TelegramBot = require("node-telegram-bot-api");

// ====================
// CONFIGURACIÓN
// ====================

const ADMINS = [
    5387882635,
    5376388604
];

if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("❌ TELEGRAM_BOT_TOKEN no configurado");
    process.exit(1);
}

// ====================
// BOT
// ====================

const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN,
    {
        polling: true
    }
);

console.log("✅ Bot de Telegram iniciado");

// ====================
// UTILIDADES
// ====================

function isAdmin(userId) {
    return ADMINS.includes(Number(userId));
}

async function denyAccess(chatId) {
    return bot.sendMessage(
        chatId,
        "⛔ Acceso denegado."
    );
}

// ====================
// COMANDO START
// ====================

bot.onText(/\/start/, async (msg) => {

    const userId = msg.from.id;

    console.log(
        `📩 /start recibido de ${userId}`
    );

    if (!isAdmin(userId)) {
        return denyAccess(msg.chat.id);
    }

    await bot.sendMessage(
        msg.chat.id,
        `🛠 Panel de Administración

ID: ${userId}

Comandos disponibles:

/panel
/ping`
    );

});

// ====================
// PANEL
// ====================

bot.onText(/\/panel/, async (msg) => {

    if (!isAdmin(msg.from.id)) {
        return denyAccess(msg.chat.id);
    }

    await bot.sendMessage(
        msg.chat.id,
        "✅ Panel abierto."
    );

});

// ====================
// PING
// ====================

bot.onText(/\/ping/, async (msg) => {

    if (!isAdmin(msg.from.id)) {
        return denyAccess(msg.chat.id);
    }

    await bot.sendMessage(
        msg.chat.id,
        "🏓 Pong"
    );

});

// ====================
// BOTONES INLINE
// ====================

bot.on("callback_query", async (query) => {

    if (!isAdmin(query.from.id)) {

        await bot.answerCallbackQuery(
            query.id,
            {
                text: "Acceso denegado",
                show_alert: true
            }
        );

        return;
    }

    console.log(
        "Botón pulsado:",
        query.data
    );

    await bot.answerCallbackQuery(
        query.id,
        {
            text: "OK"
        }
    );

});

// ====================
// ERRORES
// ====================

bot.on("polling_error", (err) => {
    console.error(
        "❌ Polling Error:",
        err.message
    );
});

bot.on("error", (err) => {
    console.error(
        "❌ Telegram Error:",
        err.message
    );
});

// ====================
// EXPORTAR
// ====================

module.exports = bot;
