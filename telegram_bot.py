# telegram_bot.py
# Bot de Telegram con soporte para /start y recepción de payloads desde SMS Parser

import os
import json
import requests
from flask import Flask, request, jsonify
from datetime import datetime
from dotenv import load_dotenv

# Cargar variables de entorno desde archivo .env
load_dotenv()

# ================= CONFIGURACIÓN DESDE VARIABLES DE ENTORNO =================
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")  # Chat por defecto para notificaciones
SECRET_KEY = os.getenv("SECRET_KEY")  # Secreto compartido con el servicio Flask

# Verificar que las variables necesarias estén configuradas
if not TELEGRAM_BOT_TOKEN:
    print("❌ ERROR: TELEGRAM_BOT_TOKEN no está configurado")
if not TELEGRAM_CHAT_ID:
    print("❌ ERROR: TELEGRAM_CHAT_ID no está configurado")
if not SECRET_KEY:
    print("❌ ERROR: SECRET_KEY no está configurado")
# =============================================================================

app = Flask(__name__)

def send_telegram_message(chat_id, text):
    """Envía un mensaje a un chat específico de Telegram"""
    if not TELEGRAM_BOT_TOKEN:
        print("❌ Telegram no configurado (token faltante)")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            print(f"✅ Mensaje enviado a Telegram (chat {chat_id})")
            return True
        else:
            print(f"❌ Error Telegram: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"❌ Excepción enviando a Telegram: {e}")
        return False

def send_to_default_chat(text):
    """Envía un mensaje al chat por defecto configurado en TELEGRAM_CHAT_ID"""
    if not TELEGRAM_CHAT_ID:
        print("❌ No hay chat por defecto configurado")
        return False
    return send_telegram_message(TELEGRAM_CHAT_ID, text)

def format_transfermovil(payload):
    """Formatea un payload de Transfermóvil para mostrarlo bonito"""
    data = payload.get("data", {})
    tipo = data.get("tipo", "DESCONOCIDO")
    monto = data.get("monto", 0)
    moneda = data.get("currency", "CUP")
    trans_id = data.get("trans_id", "N/A")
    tarjeta = payload.get("card_number", "N/A")
    token_usado = payload.get("token_used", "N/A")
    
    emoji_tipo = {
        "TARJETA_TARJETA": "💳➡️💳",
        "MONEDERO_TARJETA": "📱➡️💳",
        "TARJETA_MONEDERO": "💳➡️📱",
        "MONEDERO_MONEDERO": "📱➡️📱"
    }.get(tipo, "🔄")
    
    texto = f"🔔 <b>Pago Transfermóvil</b> {emoji_tipo}\n"
    texto += f"💰 <b>Monto:</b> {monto:,.2f} {moneda}\n"
    texto += f"🆔 <b>Transacción:</b> <code>{trans_id}</code>\n"
    texto += f"💳 <b>Tarjeta destino:</b> <code>{tarjeta}</code>\n"
    
    if tipo == "TARJETA_TARJETA":
        telefono = data.get('telefono_origen', 'N/A')
        cuenta = data.get('tarjeta_destino', 'N/A')
        texto += f"📞 <b>Teléfono origen:</b> <code>{telefono}</code>\n"
        texto += f"💳 <b>Cuenta destino:</b> <code>{cuenta}</code>\n"
    elif tipo == "MONEDERO_TARJETA":
        telefono = data.get('telefono_origen', 'N/A')
        ultimos_4 = data.get('tarjeta_destino_mask', 'N/A')
        texto += f"📞 <b>Teléfono origen:</b> <code>{telefono}</code>\n"
        texto += f"💳 <b>Cuenta destino (últimos 4):</b> <code>{ultimos_4}</code>\n"
    elif tipo == "TARJETA_MONEDERO":
        texto += "📱 <b>Destino:</b> Monedero MiTransfer\n"
    elif tipo == "MONEDERO_MONEDERO":
        telefono = data.get('telefono_origen', 'N/A')
        texto += f"📞 <b>Teléfono origen:</b> <code>{telefono}</code>\n"
    
    texto += f"\n🔑 <b>Token usado:</b> <code>{token_usado}</code>\n"
    texto += f"⏱ <b>Recibido:</b> {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"
    return texto

def format_cubacel(payload):
    """Formatea un payload de Cubacel"""
    data = payload.get("data", {})
    monto = data.get("monto", 0)
    remitente = data.get("remitente", "N/A")
    token_usado = payload.get("token_used", "N/A")
    
    texto = f"📲 <b>Recarga Cubacel recibida</b>\n"
    texto += f"💰 <b>Monto:</b> {monto:,.2f} CUP\n"
    texto += f"📞 <b>Desde:</b> <code>{remitente}</code>\n"
    texto += f"\n🔑 <b>Token usado:</b> <code>{token_usado}</code>\n"
    texto += f"⏱ <b>Recibido:</b> {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"
    return texto

# ==========================================
# ENDPOINT PARA RECIBIR NOTIFICACIONES DEL FLASK
# ==========================================
@app.route('/webhook', methods=['POST'])
def webhook_receiver():
    """Recibe payload desde el servicio SMS Parser y envía a Telegram"""
    # Verificar autenticación
    auth_header = request.headers.get('X-Auth-Token')
    if not auth_header:
        print("⚠️ Petición sin token de autenticación")
        return jsonify({"error": "Token de autenticación requerido"}), 401
    if auth_header != SECRET_KEY:
        print(f"⚠️ Token inválido: {auth_header}")
        return jsonify({"error": "Token de autenticación inválido"}), 401
    
    try:
        payload = request.get_json()
        if not payload:
            return jsonify({"error": "Payload requerido"}), 400
        
        print("\n" + "="*60)
        print(f"📦 Payload recibido del Flask - {datetime.now()}")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print("="*60)
        
        msg_type = payload.get("type", "")
        if msg_type == "TRANSFERMOVIL_PAGO":
            texto = format_transfermovil(payload)
            print("✅ Tipo: Transfermóvil")
        elif msg_type == "CUBACEL_SALDO_RECIBIDO":
            texto = format_cubacel(payload)
            print("✅ Tipo: Cubacel")
        else:
            texto = f"⚠️ Tipo desconocido:\n<pre>{json.dumps(payload, indent=2, ensure_ascii=False)}</pre>"
            print(f"⚠️ Tipo desconocido: {msg_type}")
        
        # Enviar al chat por defecto
        success = send_to_default_chat(texto)
        if success:
            return jsonify({"status": "ok", "message": "Notificación enviada a Telegram"}), 200
        else:
            return jsonify({"status": "error", "message": "Error enviando a Telegram"}), 500
            
    except Exception as e:
        print(f"❌ Error procesando webhook: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Error interno del servidor"}), 500

# ==========================================
# ENDPOINT PARA RECIBIR MENSAJES DE TELEGRAM (WEBHOOK)
# ==========================================
@app.route('/telegram-webhook', methods=['POST'])
def telegram_webhook():
    """Recibe actualizaciones de Telegram (mensajes, comandos)"""
    update = request.get_json()
    if not update:
        return "OK", 200
    
    # Procesar mensajes
    if 'message' in update:
        msg = update['message']
        chat_id = msg['chat']['id']
        text = msg.get('text', '')
        
        # Comando /start
        if text == '/start':
            welcome = (
                "👋 ¡Hola! Soy el bot de notificaciones de SMS Parser.\n\n"
                "Estás configurado para recibir notificaciones de pagos y recargas.\n"
                "Si este es tu chat, asegúrate de que el CHAT_ID en las variables de entorno sea:\n"
                f"<code>{chat_id}</code>\n\n"
                "✅ Ya puedes recibir notificaciones automáticas."
            )
            send_telegram_message(chat_id, welcome)
            print(f"📩 Comando /start recibido del chat {chat_id}")
    
    return "OK", 200

# ==========================================
# ENDPOINTS DE UTILIDAD
# ==========================================
@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200

@app.route('/info', methods=['GET'])
def info():
    return jsonify({
        "service": "Telegram Bot for SMS Parser",
        "version": "1.1.0",
        "telegram_bot_configured": bool(TELEGRAM_BOT_TOKEN),
        "default_chat_configured": bool(TELEGRAM_CHAT_ID),
        "auth_configured": bool(SECRET_KEY),
        "endpoints": {
            "webhook_flask": "/webhook (POST)",
            "webhook_telegram": "/telegram-webhook (POST)",
            "health": "/health (GET)",
            "info": "/info (GET)"
        }
    }), 200

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5001))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    print("\n" + "="*60)
    print("🤖 BOT DE TELEGRAM INICIADO")
    print("="*60)
    print(f"📊 Configuración:")
    print(f"   - Puerto: {port}")
    print(f"   - Modo debug: {debug}")
    print(f"   - Bot token: {'✅' if TELEGRAM_BOT_TOKEN else '❌'}")
    print(f"   - Chat ID por defecto: {'✅' if TELEGRAM_CHAT_ID else '❌'}")
    print(f"   - Secret key: {'✅' if SECRET_KEY else '❌'}")
    print(f"\n📬 Endpoints:")
    print(f"   - Flask → {port}/webhook")
    print(f"   - Telegram ← {port}/telegram-webhook")
    print(f"   - Health: {port}/health")
    print(f"   - Info: {port}/info")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=port, debug=debug)
