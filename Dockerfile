# Usa una imagen oficial de Node.js como base
FROM node:18-slim

# Instala las dependencias que Chromium necesita para funcionar
RUN apt-get update && apt-get install -yq \
    gconf-service \
    libasound2 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \

    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    # Instala las herramientas para compilar paquetes como sqlite3
    build-essential \
    python3 \
    --no-install-recommends

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de tu proyecto al contenedor
COPY package*.json ./
COPY . .

# Instala las dependencias de tu bot
RUN npm install

# El comando que se ejecutará para iniciar tu bot
CMD [ "node", "bot_whatsapp_listener.js" ]