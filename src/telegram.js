const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const supabase = require("./supabase");

// Mapa para flujo de creación desde el botón "Crear licencia"
const pendingCreates = new Map();

// IDs de administradores permitidos
const ADMINS = [5387882635, 5376388604];

// Verificar token
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN no configurado");
  process.exit(1);
}

// Inicializar bot con polling
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log("✅ Bot de Telegram iniciado");

// ====================
// UTILIDADES
// ====================

function isAdmin(userId) {
  return ADMINS.includes(Number(userId));
}

async function denyAccess(chatId) {
  return bot.sendMessage(chatId, "⛔ Acceso denegado.");
}

// ====================
// COMANDOS
// ====================

// /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  console.log(`📩 /start recibido de ${userId}`);

  if (!isAdmin(userId)) return denyAccess(msg.chat.id);

  await bot.sendMessage(
    msg.chat.id,
    `🛠 Panel de Administración\n\nID: ${userId}\n\nComandos disponibles:\n/panel`
  );
});

// /panel
bot.onText(/\/panel/, async (msg) => {
  if (!isAdmin(msg.from.id)) return denyAccess(msg.chat.id);

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, active, expires_at")
    .order("created_at", { ascending: false });

  if (error) {
    return bot.sendMessage(msg.chat.id, `❌ Error:\n${error.message}`);
  }

  const activeCount = clients.filter((c) => c.active).length;

  // Construir teclado: una fila por cliente
  const keyboard = clients.map((client) => [
    {
      text: `${client.active ? "🟢" : "🔴"} ${client.name}`,
      callback_data: `client_${client.id}`,
    },
  ]);

  // Añadir fila extra para crear licencia
  keyboard.push([
    { text: "➕ Crear licencia", callback_data: "create_license" },
  ]);

  await bot.sendMessage(
    msg.chat.id,
    `📊 PANEL ADMIN\n\n🟢 Activas: ${activeCount}\n👥 Total: ${clients.length}\n\nSelecciona un cliente:`,
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    }
  );
});

// /nuevo <nombre>
bot.onText(/\/nuevo (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return denyAccess(msg.chat.id);

  const name = match[1].trim();
  if (!name) {
    return bot.sendMessage(msg.chat.id, "❌ Debes indicar un nombre.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      token,
      active: true,
      token_used: false,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    return bot.sendMessage(msg.chat.id, `❌ ${error.message}`);
  }

  await bot.sendMessage(
    msg.chat.id,
    `✅ Cliente creado\n\n👤 ${data.name}\n🆔 ${data.id}\n🔑 Token:\n${data.token}\n📅 Expira:\n${new Date(data.expires_at).toLocaleDateString()}`
  );
});

// ====================
// MANEJO DE MENSAJES (para el flujo del botón "Crear licencia")
// ====================

bot.on("message", async (msg) => {
  // Solo procesar si no es un comando y el usuario está en pendingCreates
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAdmin(msg.from.id)) return;
  if (!pendingCreates.has(msg.from.id)) return;

  // Limpiar estado
  pendingCreates.delete(msg.from.id);

  const name = msg.text.trim();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      token,
      active: true,
      token_used: false,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    return bot.sendMessage(msg.chat.id, `❌ ${error.message}`);
  }

  await bot.sendMessage(
    msg.chat.id,
    `✅ Licencia creada\n\n👤 ${data.name}\n🆔 ${data.id}\n🔑 Token:\n${data.token}\n📅 Expira:\n${new Date(data.expires_at).toLocaleDateString()}`
  );
});

// ====================
// CALLBACK QUERIES
// ====================

bot.on("callback_query", async (query) => {
  if (!isAdmin(query.from.id)) return;

  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Eliminar cliente
  if (data.startsWith("delete_")) {
    const id = data.replace("delete_", "");

    await supabase.from("sms_logs").delete().eq("client_id", id);
    await supabase.from("clients").delete().eq("id", id);

    await bot.editMessageText("🗑 Cliente eliminado", {
      chat_id: chatId,
      message_id: messageId,
    });
    return;
  }

  // Activar/Desactivar
  if (data.startsWith("toggle_")) {
    const id = data.replace("toggle_", "");

    const { data: client } = await supabase
      .from("clients")
      .select("active")
      .eq("id", id)
      .single();

    await supabase
      .from("clients")
      .update({ active: !client.active })
      .eq("id", id);

    await bot.answerCallbackQuery(query.id, { text: "Estado actualizado" });
    return;
  }

  // Ver detalle de cliente
  if (data.startsWith("client_")) {
    const id = data.replace("client_", "");

    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (!client) return;

    const messageText = `👤 ${client.name}\n\n🆔 ID: ${client.id}\n📱 ${client.phone_number || "No definido"}\n💳 Tarjeta 1:\n${client.card1 || "No definida"}\n💳 Tarjeta 2:\n${client.card2 || "No definida"}\n💳 Tarjeta 3:\n${client.card3 || "No definida"}\n👛 Wallet:\n${client.wallet || "No definida"}\n📲 Device:\n${client.device_id || "No registrado"}\n📅 Expira:\n${client.expires_at || "Sin fecha"}\n🟢 Estado:\n${client.active ? "Activo" : "Inactivo"}`;

    const options = {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🔄 Activar/Desactivar",
              callback_data: `toggle_${client.id}`,
            },
          ],
          [{ text: "🗑 Eliminar", callback_data: `delete_${client.id}` }],
          [{ text: "⬅️ Volver", callback_data: "back_panel" }],
        ],
      },
    };

    await bot.editMessageText(messageText, options);
    return;
  }

  // Volver al panel
  if (data === "back_panel") {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, active")
      .order("created_at", { ascending: false });

    const keyboard = clients.map((client) => [
      {
        text: `${client.active ? "🟢" : "🔴"} ${client.name}`,
        callback_data: `client_${client.id}`,
      },
    ]);

    // Añadir opción de crear
    keyboard.push([
      { text: "➕ Crear licencia", callback_data: "create_license" },
    ]);

    await bot.editMessageText("📊 CLIENTES", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // Iniciar creación de licencia (botón "Crear licencia")
  if (data === "create_license") {
    pendingCreates.set(query.from.id, true);
    return bot.sendMessage(chatId, "📝 Envía el nombre del cliente.");
  }
});

// ====================
// ERRORES
// ====================

bot.on("polling_error", (err) => {
  console.error("❌ Polling Error:", err.message);
});

bot.on("error", (err) => {
  console.error("❌ Telegram Error:", err.message);
});

// ====================
// EXPORTAR
// ====================

module.exports = bot;
