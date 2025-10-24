// ---------------------------------------------------------------- //
// BOT RECEPTOR DE WHATSAPP PARA AGENDAMIENTO (VERSIÓN CLOUD RUN)
// ---------------------------------------------------------------- //

// 1. EXPRESS PARA CLOUD RUN
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bot de WhatsApp corriendo!'));
app.listen(PORT, () => console.log(`✅ Servidor Express escuchando en puerto ${PORT}`));

// 2. IMPORTACIONES DE NODE
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const xlsx = require('xlsx');
const { google } = require('googleapis');
const chrono = require('chrono-node');
const Database = require('better-sqlite3');

console.log('✅ Librerías cargadas');

// 3. CONFIGURACIÓN DESDE VARIABLES DE ENTORNO
const EXCEL_FILE_PATH = process.env.EXCEL_FILE_PATH;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_FILE_PATH = process.env.CREDENTIALS_FILE_PATH;
const DATABASE_FILE_PATH = process.env.DATABASE_FILE_PATH;

console.log(`✅ Variables cargadas: Excel(${EXCEL_FILE_PATH}) Credentials(${CREDENTIALS_FILE_PATH})`);

// 4. INICIALIZACIÓN DE CLIENTE WHATSAPP
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

let listaClientes = [];
let db;

// 5. FUNCIONES AUXILIARES

function cargarClientesDesdeExcel() {
    try {
        const workbook = xlsx.readFile(EXCEL_FILE_PATH);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        listaClientes = xlsx.utils.sheet_to_json(worksheet).map(cliente => ({
            ...cliente,
            Telefono: String(cliente.Telefono)
        }));
        console.log(`✅ ${listaClientes.length} clientes cargados desde Excel`);
    } catch (error) {
        console.error("❌ Error leyendo Excel:", error.message);
        process.exit(1);
    }
}

function buscarClientePorTelefono(telefono) {
    return listaClientes.find(c => c.Telefono === telefono) || null;
}

async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_FILE_PATH,
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

function setupDatabase() {
    db = new Database(DATABASE_FILE_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversaciones (
            user_id TEXT PRIMARY KEY,
            account_number TEXT,
            step TEXT,
            scheduled_date TEXT,
            last_updated INTEGER
        )
    `);
    console.log('✅ Base de datos SQLite lista');
}

// 6. EVENTOS DEL CLIENTE WHATSAPP

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('✅ QR generado');
});

client.on('ready', () => {
    console.log('✅ Cliente WhatsApp listo');
    cargarClientesDesdeExcel();
    setupDatabase();
});

client.on('message', async message => {
    const user = message.from;
    const userPhoneOnly = user.replace('@c.us', '');
    const text = message.body.toLowerCase().trim();

    try {
        const state = db.prepare(`SELECT * FROM conversaciones WHERE user_id = ?`).get(user) || {};
        const step = state.step || null;

        // Nuevo usuario
        if (!state.user_id) {
            const clienteExcel = buscarClientePorTelefono(userPhoneOnly);
            if (clienteExcel) {
                db.prepare(`INSERT OR REPLACE INTO conversaciones (user_id, account_number, last_updated) VALUES (?, ?, ?)`)
                  .run(user, clienteExcel.Cuenta, Date.now());
                await message.reply(`¡Hola, ${clienteExcel.Nombre}! Gracias por contactarnos. Responde con *Agendar* para iniciar.`);
                return;
            } else {
                console.log(`Número desconocido ${userPhoneOnly} ignorado`);
                return;
            }
        }

        // Flujo de agendamiento
        if (!step && (text === 'agendar' || text.includes('agendar'))) {
            const horaTijuana = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Tijuana', hour: '2-digit', hour12: false }));
            if (horaTijuana >= 17) {
                await message.reply(`Ya no es posible agendar hoy. Indica otra fecha a partir de mañana.`);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_other_date_input', user);
            } else {
                await message.reply(`*🗓️ Elige opción:*\n1) Hoy\n2) Otra fecha`);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_date_choice', user);
            }
        } else if (step === 'awaiting_date_choice') {
            if (text === '1') {
                await message.reply('Muy bien, agenda para hoy. ¿Ya estás en domicilio?\n1) Sí\n2) Llego más tarde');
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_today_confirmation', user);
            } else if (text === '2') {
                await message.reply('Indica la fecha que prefieres.');
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_other_date_input', user);
            } else {
                await message.reply('Opción no válida (1 o 2).');
            }
        } else if (step === 'awaiting_other_date_input') {
            const results = chrono.es.parse(message.body.trim(), new Date(), { forwardDate: true });
            const fechaParseada = results.length > 0 ? results[0].start.date() : null;
            if (fechaParseada) {
                const fechaFormateada = fechaParseada.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                await message.reply(`*⏰ Elige horario*\n1) Matutino\n2) Vespertino\nFecha: ${fechaFormateada}`);
                db.prepare(`UPDATE conversaciones SET step = ?, scheduled_date = ? WHERE user_id = ?`)
                  .run('awaiting_time_slot_choice', fechaFormateada, user);
            } else {
                await message.reply('No entendí la fecha. Intenta con "mañana" o "25 de octubre".');
            }
        } else if (step === 'awaiting_time_slot_choice') {
            const storedDate = state.scheduled_date;
            let chosenTime = '';
            if (text === '1' || text.includes('matutino')) chosenTime = 'Matutino (9 AM - 2 PM)';
            else if (text === '2' || text.includes('vespertino')) chosenTime = 'Vespertino (2 PM - 6 PM)';
            else if (text.includes('cambiar fecha')) {
                await message.reply('Indica la nueva fecha.');
                db.prepare(`UPDATE conversaciones SET step = ?, scheduled_date = NULL WHERE user_id = ?`).run('awaiting_other_date_input', user);
                return;
            } else {
                await message.reply('Respuesta no válida. Responde 1, 2 o "cambiar fecha".');
                return;
            }

            await message.reply(`✅ Visita agendada para ${storedDate} en horario ${chosenTime}`);

            // Guardar en Google Sheets
            try {
                const sheets = await getGoogleSheetsClient();
                const numeroDeCuenta = state.account_number || 'CUENTA_NO_ENCONTRADA';
                const newRow = [new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' }), user, numeroDeCuenta, storedDate, chosenTime];
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'Hoja 2!A:E',
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [newRow] },
                });
                console.log(`📝 Cita guardada en Google Sheets`);
            } catch (error) {
                console.error('❌ Error guardando cita en Google Sheets:', error);
            }

            db.prepare(`UPDATE conversaciones SET step = NULL, scheduled_date = NULL WHERE user_id = ?`).run(user);
        }
    } catch (err) {
        console.error('❌ Error en manejador de mensajes:', err);
    }
});

// 7. INICIALIZAR CLIENTE WHATSAPP
client.initialize();
