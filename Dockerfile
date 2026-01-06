FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Copy all source files (including the src directory and config files)
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Define volume for persistent data
VOLUME /app/data

EXPOSE 3000

CMD ["node", "server.js"]