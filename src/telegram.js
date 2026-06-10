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
/cliente
`
    );

});

const supabase = require("./supabase");

bot.onText(/\/panel/, async (msg) => {

    if (!isAdmin(msg.from.id)) {
        return denyAccess(msg.chat.id);
    }

    const { data: clients, error } = await supabase
        .from("clients")
        .select(`
            id,
            name,
            active,
            expires_at
        `)
        .order("created_at", { ascending: false });

    if (error) {
        return bot.sendMessage(
            msg.chat.id,
            `❌ Error:\n${error.message}`
        );
    }

    const activeCount =
        clients.filter(c => c.active).length;

    const keyboard = clients.map(client => [
        {
            text: `${client.active ? "🟢" : "🔴"} ${client.name}`,
            callback_data: `client_${client.id}`
        }
    ]);

    await bot.sendMessage(
        msg.chat.id,
`📊 PANEL ADMIN

🟢 Activas: ${activeCount}
👥 Total: ${clients.length}

Selecciona un cliente:`,
        {
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );

});



bot.on("callback_query", async (query) => {

    if (!isAdmin(query.from.id)) {
        return;
    }

    const data = query.data;

    if (data.startsWith("delete_")) {

        const id =
            data.replace("delete_","");

        await supabase
            .from("sms_logs")
            .delete()
            .eq("client_id", id);

        await supabase
            .from("clients")
            .delete()
            .eq("id", id);

        await bot.editMessageText(
            "🗑 Cliente eliminado",
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            }
        );

        return;
    }

    if (data.startsWith("toggle_")) {

        const id =
            data.replace("toggle_","");

        const { data: client } =
            await supabase
                .from("clients")
                .select("active")
                .eq("id", id)
                .single();

        await supabase
            .from("clients")
            .update({
                active: !client.active
            })
            .eq("id", id);

        await bot.answerCallbackQuery(
            query.id,
            {
                text:"Estado actualizado"
            }
        );

        return;
    }

    if (data.startsWith("client_")) {

    const id = data.replace("client_", "");

    const { data: client } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .single();

    if (!client) {
        return;
    }

    await bot.editMessageText(
`👤 ${client.name}

🆔 ID: ${client.id}

📱 ${client.phone_number || "No definido"}

💳 Tarjeta 1:
${client.card1 || "No definida"}

💳 Tarjeta 2:
${client.card2 || "No definida"}

💳 Tarjeta 3:
${client.card3 || "No definida"}

👛 Wallet:
${client.wallet || "No definida"}

📲 Device:
${client.device_id || "No registrado"}

📅 Expira:
${client.expires_at || "Sin fecha"}

🟢 Estado:
${client.active ? "Activo" : "Inactivo"}`,
{
chat_id: query.message.chat.id,
message_id: query.message.message_id,
reply_markup:{
inline_keyboard:[
[
{
text:"🔄 Activar/Desactivar",
callback_data:`toggle_${client.id}`
}
],
[
{
text:"🗑 Eliminar",
callback_data:`delete_${client.id}`
}
],
[
{
text:"⬅️ Volver",
callback_data:"back_panel"
}
]
]
}
}
);

return;
    }
    if (data === "back_panel") {

    const { data: clients } = await supabase
        .from("clients")
        .select("id,name,active")
        .order("created_at", { ascending: false });

    const keyboard = clients.map(client => [
        {
            text: `${client.active ? "🟢" : "🔴"} ${client.name}`,
            callback_data: `client_${client.id}`
        }
    ]);

    await bot.editMessageText(
        "📊 CLIENTES",
        {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );

    return;
    }

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
