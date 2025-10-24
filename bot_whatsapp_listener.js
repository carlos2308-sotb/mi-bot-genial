// ---------------------------------------------------------------- //
// BOT RECEPTOR DE WHATSAPP PARA AGENDAMIENTO (VERSIÓN FINAL)
// ---------------------------------------------------------------- //

// 1. IMPORTACIONES
console.log('--- PASO 1: Iniciando script ---');
require('dotenv').config();
console.log('--- PASO 2: dotenv cargado ---');
const { Client, LocalAuth } = require('whatsapp-web.js');
console.log('--- PASO 3: whatsapp-web.js cargado ---');
const qrcode = require('qrcode-terminal');
console.log('--- PASO 4: qrcode-terminal cargado ---');
const xlsx = require('xlsx');
console.log('--- PASO 5: xlsx cargado ---');
const { google } = require('googleapis');
console.log('--- PASO 6: googleapis cargado ---');
const chrono = require('chrono-node');
console.log('--- PASO 7: chrono-node cargado ---');
const Database = require('better-sqlite3');
console.log('--- PASO 8: better-sqlite3 cargado ---');

// 2. CONFIGURACIÓN (desde el archivo .env)
console.log('--- PASO 9: Leyendo variables de entorno ---');
const EXCEL_FILE_PATH = process.env.EXCEL_FILE_PATH;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_FILE_PATH = process.env.CREDENTIALS_FILE_PATH;
const DATABASE_FILE_PATH = process.env.DATABASE_FILE_PATH;
console.log(`--- PASO 10: Variables cargadas. Path de Excel: ${EXCEL_FILE_PATH}, Path de Credenciales: ${CREDENTIALS_FILE_PATH}`);

// 3. INICIALIZACIÓN
console.log('--- PASO 11: Iniciando Bot Receptor de WhatsApp... ---');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }
});
console.log('--- PASO 12: Cliente de WhatsApp creado ---');

let listaClientes = [];
let db; // Variable para la conexión a la base de datos

// 4. FUNCIONES AUXILIARES

/**
 * Carga la lista de clientes desde el archivo Excel.
 */
function cargarClientesDesdeExcel() {
    try {
        console.log(`--- PASO 13: Intentando leer el archivo Excel en: ${EXCEL_FILE_PATH} ---`);
        const workbook = xlsx.readFile(EXCEL_FILE_PATH);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        listaClientes = xlsx.utils.sheet_to_json(worksheet).map(cliente => ({
            ...cliente,
            Telefono: String(cliente.Telefono)
        }));
        console.log(`✅ Se cargaron ${listaClientes.length} clientes desde Excel.`);
    } catch (error) {
        console.error("❌ Error fatal al leer el archivo de Excel.", error.message);
        process.exit(1); // Forzamos que se cierre si falla aquí
    }
    }


/**
 * Busca un cliente por su número de teléfono.
 */
function buscarClientePorTelefono(telefono) {
    return listaClientes.find(c => c.Telefono === telefono) || null;
}

/**
 * Obtiene el cliente para interactuar con Google Sheets.
 */
async function getGoogleSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_FILE_PATH,
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

/**
 * Prepara la base de datos SQLite.
 */
function setupDatabase() {
    // CAMBIO 2: Inicialización de la base de datos.
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
    console.log('✅ Base de datos SQLite conectada y lista.');
}


// 5. LÓGICA PRINCIPAL DEL BOT

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ ¡Cliente de WhatsApp listo y conectado!');
    cargarClientesDesdeExcel();
    setupDatabase(); // Ya no necesita 'await'
});

client.on('message', async message => {
    console.log(`--- MENSAJE RECIBIDO DE: ${message.from} ---`);
    const user = message.from;
    const userPhoneOnly = user.replace('@c.us', '');
    const text = message.body.toLowerCase().trim();

    try {
        // CAMBIO 3: Actualizamos todos los comandos de la base de datos.
        const state = db.prepare(`SELECT * FROM conversaciones WHERE user_id = ?`).get(user) || {};
        const step = state.step || null;

        if (!state.user_id) {
            const clienteExcel = buscarClientePorTelefono(userPhoneOnly);
            if (clienteExcel) {
                db.prepare(`INSERT OR REPLACE INTO conversaciones (user_id, account_number, last_updated) VALUES (?, ?, ?)`).run(user, clienteExcel.Cuenta, Date.now());
                const bienvenida = `¡Hola, ${clienteExcel.Nombre}! Gracias por contactarnos por el cambio de módem para tu cuenta #${clienteExcel.Cuenta}.\n\nPara iniciar, responde con la palabra *Agendar*.`;
                await message.reply(bienvenida);
                return;
            } else {
                console.log(`Número desconocido ${userPhoneOnly} ignorado`);
                return;
            }
        }

        // --- INICIA EL FLUJO DE CONVERSACIÓN ---

        if (!step && (text === 'agendar' || text.includes('agendar'))) {
            const horaTijuana = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Tijuana', hour: '2-digit', hour12: false }));
            if (horaTijuana >= 17) {
                await message.reply(`¡Hola! Por el momento ya no es posible agendar visitas para hoy.\n\nPor favor, indícanos qué fecha prefieres para tu visita a partir de mañana.`);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_other_date_input', user);
            } else {
                const menuFecha = `*🗓️ ¡Perfecto! Agendemos tu visita técnica*\n-----------------------------------\n\nPor favor, elige una de las siguientes opciones:\n\n*1)* Para hoy mismo\n*2)* Elegir otra fecha`;
                await message.reply(menuFecha);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_date_choice', user);
            }

        } else if (step === 'awaiting_date_choice') {
            if (text === '1') {
                const menuHoy = `Muy bien, hemos generado la solicitud para hoy.\n\n¿Ya te encuentras en domicilio para atender al técnico?\n\n*1)* Sí, ya estoy aquí\n*2)* Llego más tarde`;
                await message.reply(menuHoy);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_today_confirmation', user);
            } else if (text === '2') {
                await message.reply(`Claro. Por favor, indícanos qué fecha prefieres para la visita.`);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_other_date_input', user);
            } else {
                await message.reply('Por favor, selecciona una opción válida (1 o 2).');
            }

        } else if (step === 'awaiting_other_date_input') {
            const results = chrono.es.parse(message.body.trim(), new Date(), { forwardDate: true });
            const fechaParseada = results.length > 0 ? results[0].start.date() : null;

            if (fechaParseada) {
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0);
                if (fechaParseada < hoy) {
                    await message.reply('Esa fecha ya pasó. 😅\n\nPor favor, elige una fecha a partir de hoy.');
                    return;
                }
                const fechaFormateada = fechaParseada.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                const menuHorario = `*⏰ Elige tu bloque de horario preferido*\n-----------------------------------\n\nPara el día: *${fechaFormateada}*\n\n*1)* Matutino (9:00 AM - 2:00 PM)\n*2)* Vespertino (2:00 PM - 6:00 PM)\n\n_O escribe "cambiar fecha" si te equivocaste._`;
                await message.reply(menuHorario);
                db.prepare(`UPDATE conversaciones SET step = ?, scheduled_date = ? WHERE user_id = ?`).run('awaiting_time_slot_choice', fechaFormateada, user);
            } else {
                await message.reply('Lo siento, no pude entender esa fecha. 😕\n\nIntenta de nuevo escribiendo algo como "mañana", "el viernes" o "25 de octubre".');
            }

        } else if (step === 'awaiting_time_slot_choice') {
            const storedDate = state.scheduled_date;
            if (text.includes('cambiar fecha')) {
                await message.reply(`De acuerdo. Por favor, indícanos la nueva fecha que prefieres.`);
                db.prepare(`UPDATE conversaciones SET step = ?, scheduled_date = NULL WHERE user_id = ?`).run('awaiting_other_date_input', user);
            } else if (text === '1' || text.includes('matutino') || text === '2' || text.includes('vespertino')) {
                const chosenTime = (text === '1' || text.includes('matutino')) ? 'Matutino (9 AM - 2 PM)' : 'Vespertino (2 PM - 6 PM)';
                const confirmacionFinal = `✅ *¡Visita Agendada Exitosamente!* ✅\n-----------------------------------\n\nHemos programado a nuestro técnico para el día:\n\n*${storedDate}*\n\nEn el horario: *${chosenTime}*.\n\n¡Gracias por tu tiempo!`;
                await message.reply(confirmacionFinal);
                
                try {
                    const sheets = await getGoogleSheetsClient();
                    const numeroDeCuenta = state.account_number || 'CUENTA_NO_ENCONTRADA';
                    const newRow = [new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' }), user, numeroDeCuenta, storedDate, chosenTime];
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: SPREADSHEET_ID,
                        range: 'Hoja 1!A:E',
                        valueInputOption: 'USER_ENTERED',
                        resource: { values: [newRow] },
                    });
                    console.log(`📝 Cita guardada en Google Sheets para cuenta ${numeroDeCuenta}`);
                } catch (error) {
                    console.error('❌ Error al guardar la cita en Google Sheets:', error);
                }
                db.prepare(`UPDATE conversaciones SET step = NULL, scheduled_date = NULL WHERE user_id = ?`).run(user);
            } else {
                await message.reply('Respuesta no válida. Por favor, responde "1", "2" o "cambiar fecha".');
            }
        
        } else if (step === 'awaiting_today_confirmation') {
            const fechaDeHoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            if (text === '1') {
                await message.reply('Muy bien, le mandamos al tecnico. Solamente te pido que te encuentres disponible para atender la llamada del mismo.');
                try {
                    const sheets = await getGoogleSheetsClient();
                    const numeroDeCuenta = state.account_number || 'CUENTA_NO_ENCONTRADA';
                    const newRow = [new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' }), user, numeroDeCuenta, fechaDeHoy, 'Hoy Mismo (confirmado)'];
                    await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Hoja 1!A:E', valueInputOption: 'USER_ENTERED', resource: { values: [newRow] } });
                    console.log(`📝 Cita (Hoy Mismo) guardada en Google Sheets para cuenta ${numeroDeCuenta}`);
                } catch (error) { console.error('❌ Error al guardar la cita en Google Sheets:', error); }
                db.prepare(`UPDATE conversaciones SET step = NULL, scheduled_date = NULL WHERE user_id = ?`).run(user);
            } else if (text === '2') {
                await message.reply(`De acuerdo, indícanos a partir de qué hora te encuentras en domicilio.\n\n_(El horario máximo es a las 6 PM)_`);
                db.prepare(`UPDATE conversaciones SET step = ? WHERE user_id = ?`).run('awaiting_later_time', user);
            } else {
                await message.reply('Por favor, selecciona una opción válida (1 o 2).');
            }

        } else if (step === 'awaiting_later_time') {
            const horaIndicada = message.body.trim();
            const fechaDeHoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            await message.reply(`Perfecto, agendado para hoy a partir de las *${horaIndicada}*. El técnico se comunicará contigo. ¡Gracias!`);
            try {
                const sheets = await getGoogleSheetsClient();
                const numeroDeCuenta = state.account_number || 'CUENTA_NO_ENCONTRADA';
                const newRow = [new Date().toLocaleString('es-MX', { timeZone: 'America/Tijuana' }), user, numeroDeCuenta, fechaDeHoy, `Hoy Mismo (a partir de ${horaIndicada})`];
                await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: 'Hoja 1!A:E', valueInputOption: 'USER_ENTERED', resource: { values: [newRow] } });
                console.log(`📝 Cita (Hoy Mismo) guardada en Google Sheets para cuenta ${numeroDeCuenta}`);
            } catch (error) { console.error('❌ Error al guardar la cita en Google Sheets:', error); }
            db.prepare(`UPDATE conversaciones SET step = NULL, scheduled_date = NULL WHERE user_id = ?`).run(user);
        }

    } catch (dbError) {
        console.error("Error fatal en el manejador de mensajes:", dbError);
    }
});

client.initialize();