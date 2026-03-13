# telegram_bot.py
# Bot de Telegram que recibe payloads del servicio SMS Parser Unified

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
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
SECRET_KEY = os.getenv("SECRET_KEY")

# Verificar que las variables necesarias estén configuradas
if not TELEGRAM_BOT_TOKEN:
    print("❌ ERROR: TELEGRAM_BOT_TOKEN no está configurado")
if not TELEGRAM_CHAT_ID:
    print("❌ ERROR: TELEGRAM_CHAT_ID no está configurado")
if not SECRET_KEY:
    print("❌ ERROR: SECRET_KEY no está configurado")
# =============================================================================

app = Flask(__name__)

def send_telegram_message(text):
    """Envía un mensaje de texto a Telegram"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("❌ Telegram no configurado correctamente")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            print("✅ Mensaje enviado a Telegram")
            return True
        else:
            print(f"❌ Error Telegram: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"❌ Excepción enviando a Telegram: {e}")
        return False

def format_transfermovil(payload):
    """Formatea un payload de Transfermóvil para mostrarlo bonito"""
    data = payload.get("data", {})
    tipo = data.get("tipo", "DESCONOCIDO")
    monto = data.get("monto", 0)
    moneda = data.get("currency", "CUP")
    trans_id = data.get("trans_id", "N/A")
    tarjeta = payload.get("card_number", "N/A")
    token_usado = payload.get("token_used", "N/A")
    
    # Emoji según el tipo de operación
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

def format_error(payload):
    """Formatea un payload desconocido o error"""
    return f"⚠️ <b>Tipo de notificación desconocido</b>\n<pre>{json.dumps(payload, indent=2, ensure_ascii=False)}</pre>"

@app.route('/webhook', methods=['POST'])
def webhook_receiver():
    """Endpoint que recibe el payload desde el servicio Flask"""
    # Verificar autenticación con X-Auth-Token
    auth_header = request.headers.get('X-Auth-Token')
    
    if not auth_header:
        print("⚠️ Petición sin token de autenticación")
        return jsonify({"error": "Token de autenticación requerido"}), 401
    
    if auth_header != SECRET_KEY:
        print(f"⚠️ Token inválido: {auth_header}")
        return jsonify({"error": "Token de autenticación inválido"}), 401
    
    try:
        # Obtener el payload JSON
        payload = request.get_json()
        
        if not payload:
            print("⚠️ Payload vacío o no JSON")
            return jsonify({"error": "Payload requerido"}), 400
        
        print("\n" + "="*60)
        print(f"📦 Payload recibido - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*60)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print("="*60)
        
        # Determinar el tipo y formatear mensaje
        msg_type = payload.get("type", "")
        
        if msg_type == "TRANSFERMOVIL_PAGO":
            texto = format_transfermovil(payload)
            print("✅ Tipo: Transfermóvil")
        elif msg_type == "CUBACEL_SALDO_RECIBIDO":
            texto = format_cubacel(payload)
            print("✅ Tipo: Cubacel")
        else:
            texto = format_error(payload)
            print(f"⚠️ Tipo desconocido: {msg_type}")
        
        # Enviar a Telegram
        success = send_telegram_message(texto)
        
        if success:
            return jsonify({"status": "ok", "message": "Notificación enviada a Telegram"}), 200
        else:
            return jsonify({"status": "error", "message": "Error enviando a Telegram"}), 500
            
    except Exception as e:
        print(f"❌ Error procesando webhook: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Error interno del servidor"}), 500

@app.route('/webhook/test', methods=['POST'])
def test_webhook():
    """Endpoint de prueba para verificar que el bot funciona"""
    return jsonify({
        "status": "ok",
        "message": "Bot de Telegram funcionando correctamente",
        "endpoints": {
            "webhook_principal": "/webhook (POST)",
            "health": "/health (GET)",
            "info": "/info (GET)"
        }
    }), 200

@app.route('/health', methods=['GET'])
def health():
    """Endpoint para verificar que el bot está vivo"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "Telegram Bot"
    }), 200

@app.route('/info', methods=['GET'])
def info():
    """Muestra información de configuración (sin secretos)"""
    return jsonify({
        "service": "Telegram Bot for SMS Parser",
        "version": "1.0.0",
        "telegram_bot_configured": bool(TELEGRAM_BOT_TOKEN),
        "telegram_chat_configured": bool(TELEGRAM_CHAT_ID),
        "auth_configured": bool(SECRET_KEY),
        "endpoints": {
            "webhook": "/webhook (POST)",
            "test": "/webhook/test (POST)",
            "health": "/health (GET)",
            "info": "/info (GET)"
        }
    }), 200

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint no encontrado"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Método no permitido"}), 405

if __name__ == '__main__':
    # Puerto desde variable de entorno (Render asigna automáticamente)
    port = int(os.getenv("PORT", 5001))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    
    print("\n" + "="*60)
    print("🤖 BOT DE TELEGRAM INICIADO")
    print("="*60)
    print(f"📊 Configuración:")
    print(f"   - Puerto: {port}")
    print(f"   - Modo debug: {debug}")
    print(f"   - Bot token: {'✅ Configurado' if TELEGRAM_BOT_TOKEN else '❌ No configurado'}")
    print(f"   - Chat ID: {'✅ Configurado' if TELEGRAM_CHAT_ID else '❌ No configurado'}")
    print(f"   - Secret key: {'✅ Configurada' if SECRET_KEY else '❌ No configurada'}")
    print(f"\n📬 Endpoints disponibles:")
    print(f"   - POST {port}/webhook (recibir payloads)")
    print(f"   - POST {port}/webhook/test (test)")
    print(f"   - GET  {port}/health (health check)")
    print(f"   - GET  {port}/info (información)")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=port, debug=debug)
