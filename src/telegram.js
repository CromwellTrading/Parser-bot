const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN,
    { polling: true }
);

const ADMINS = [
    5387882635,
    5376388604
];

function isAdmin(userId) {
    return ADMINS.includes(userId);
}

//COMANDOS 
bot.onText(/\/start/, async (msg) => {

    if (!isAdmin(msg.from.id)) {
        return bot.sendMessage(
            msg.chat.id,
            "⛔ Acceso denegado."
        );
    }

    await bot.sendMessage(
        msg.chat.id,
        "✅ Panel de administración"
    );

});
