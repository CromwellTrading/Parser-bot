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
    .select("id, name, active, expires_at, role")
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

  const parts = match[1].trim().split(/\s+/);
  let name = parts[0];
  let role = 'client';
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (last === 'admin' || last === 'client') {
      role = last;
      name = parts.slice(0, -1).join(' ');
    }
  }

  if (!name) {
    return bot.sendMessage(msg.chat.id, "❌ Debes indicar un nombre.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  let expiresAt = null;
  if (role === 'client') {
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      token,
      active: true,
      token_used: false,
      expires_at: expiresAt,
      role: role,
    })
    .select()
    .single();

  if (error) {
    return bot.sendMessage(msg.chat.id, `❌ ${error.message}`);
  }

  await bot.sendMessage(
    msg.chat.id,
    `✅ Cliente creado\n\n👤 ${data.name}\n🆔 ${data.id}\n🔑 Token:\n${data.token}\n📅 Expira:\n${data.expires_at ? new Date(data.expires_at).toLocaleDateString() : 'Sin límite (Admin)'}\n👑 Rol: ${role === 'admin' ? 'Administrador' : 'Cliente'}`
  );
});
// ====================
// MANEJO DE MENSAJES (para el flujo del botón "Crear licencia")
// ====================

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAdmin(msg.from.id)) return;

  const userId = msg.from.id;
  const pending = pendingCreates.get(userId);
  if (!pending) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (pending.step === 'name') {
    pendingCreates.set(userId, { step: 'role', name: text });
    await bot.sendMessage(chatId, "Selecciona el rol:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👤 Cliente", callback_data: "role_client" },
            { text: "👑 Administrador", callback_data: "role_admin" }
          ]
        ]
      }
    });
    return;
  }
});

// ====================
// CALLBACK QUERIES
// ====================

bot.on("callback_query", async (query) => {
  if (!isAdmin(query.from.id)) return;

  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Selección de rol para nueva licencia
  if (data === "role_client" || data === "role_admin") {
    const userId = query.from.id;
    const pending = pendingCreates.get(userId);
    if (!pending || pending.step !== 'role') {
      return bot.answerCallbackQuery(query.id, { text: "Error: no hay solicitud pendiente" });
    }

    const name = pending.name;
    const role = data === "role_admin" ? "admin" : "client";
    const token = crypto.randomBytes(32).toString("hex");
    let expiresAt = null;
    if (role === "client") {
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const { data: client, error } = await supabase
      .from("clients")
      .insert({
        name,
        token,
        active: true,
        token_used: false,
        expires_at: expiresAt,
        role: role,
      })
      .select()
      .single();

    pendingCreates.delete(userId);

    if (error) {
      await bot.sendMessage(chatId, `❌ ${error.message}`);
      return;
    }

    await bot.sendMessage(
      chatId,
      `✅ Licencia creada\n\n👤 ${client.name}\n🆔 ${client.id}\n🔑 Token:\n${client.token}\n📅 Expira:\n${client.expires_at ? new Date(client.expires_at).toLocaleDateString() : 'Sin límite (Admin)'}\n👑 Rol: ${role === 'admin' ? 'Administrador' : 'Cliente'}`
    );

    await bot.deleteMessage(chatId, messageId);
    return;
  }

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

    const messageText = `👤 ${client.name}\n\n🆔 ID: ${client.id}\n👑 Rol: ${client.role === 'admin' ? 'Administrador' : 'Cliente'}\n📱 ${client.phone_number || "No definido"}\n💳 Tarjeta 1:\n${client.card1 || "No definida"}\n💳 Tarjeta 2:\n${client.card2 || "No definida"}\n💳 Tarjeta 3:\n${client.card3 || "No definida"}\n👛 Wallet:\n${client.wallet || "No definida"}\n📲 Device:\n${client.device_id || "No registrado"}\n📅 Expira:\n${client.expires_at ? new Date(client.expires_at).toLocaleDateString() : 'Sin límite (Admin)'}\n🟢 Estado:\n${client.active ? "Activo" : "Inactivo"}`;

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
      .select("id, name, active, role")
      .order("created_at", { ascending: false });

    const keyboard = clients.map((client) => [
      {
        text: `${client.active ? "🟢" : "🔴"} ${client.name}`,
        callback_data: `client_${client.id}`,
      },
    ]);

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
    pendingCreates.set(query.from.id, { step: 'name' });
    await bot.sendMessage(chatId, "📝 Envía el nombre del cliente.");
    return;
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

module.exports = { bot, ADMINS };
